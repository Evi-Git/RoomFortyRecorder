// Pull desk import from Warcraft Logs: backfills pulls the app didn't
// capture (nobody had "Send my pull logs" on, or it happened before the
// Pull desk existed). Each imported pull gets a light report built from the
// Warcraft Logs data: result, boss %, duration, roster with roles, and
// deaths with killing blows. That is enough for the Night summary and
// Progression views (wipe causes, early deaths); the cooldown plan,
// avoidable hits and defensives need the app's own log, so they're empty.

// Warcraft Logs difficulty -> game difficulty ID.
const WCL_TO_GAME = { 1: 17, 3: 14, 4: 15, 5: 16 };
const GAME_NAMES = { 14: 'normal', 15: 'heroic', 16: 'mythic', 17: 'lfr' };

/** "https://www.warcraftlogs.com/reports/AbC123xyz#fight=3" -> "AbC123xyz". */
export const reportCode = (value) => {
  const text = String(value || '').trim();
  const fromUrl = /reports\/(?:a:)?([A-Za-z0-9]{8,40})/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9]{8,40}$/.test(text) ? text : null;
};

// Same rule as pulldesk-analyze.mjs: 5+ deaths within 2 s to one ability.
const massDeathOf = (deaths) => {
  for (let i = 0; i < deaths.length; i += 1) {
    const spell = deaths[i].killingBlow?.spellName;
    if (!spell) continue;
    const group = deaths.filter(
      (d) => d.t >= deaths[i].t && d.t - deaths[i].t <= 2 && d.killingBlow?.spellName === spell,
    );
    if (group.length >= 5) return { t: deaths[i].t, spellName: spell, count: group.length };
  }
  return null;
};

const roleSets = (playerDetails) => {
  const details = playerDetails?.data?.playerDetails || playerDetails?.playerDetails || {};
  const roles = new Map();
  ['tanks', 'healers', 'dps'].forEach((key) => {
    (details[key] || []).forEach((p) => {
      roles.set(p.name, key === 'tanks' ? 'tank' : key === 'healers' ? 'healer' : 'dps');
    });
  });
  return roles;
};

/**
 * Build pulls from one report's Warcraft Logs data.
 * @param {object} report  { code, startTime, fights, masterData, playerDetails }
 * @param {object[]} deathEvents  Deaths events ({ timestamp, fight, targetID, killingAbilityGameID })
 * @param {Set<number>} gameDifficulties  difficulties to keep (game IDs)
 */
export const pullsFromReport = (report, deathEvents, gameDifficulties) => {
  const actors = new Map((report.masterData?.actors || []).map((a) => [a.id, a.name]));
  const abilities = new Map((report.masterData?.abilities || []).map((a) => [a.gameID, a.name]));
  const roles = roleSets(report.playerDetails);

  return (report.fights || [])
    .filter((fight) => fight.encounterID > 0 && gameDifficulties.has(WCL_TO_GAME[fight.difficulty]))
    .map((fight) => {
      const duration = Math.round((fight.endTime - fight.startTime) / 100) / 10;
      const roster = (fight.friendlyPlayers || [])
        .map((id) => actors.get(id))
        .filter(Boolean)
        .map((name) => ({ name, role: roles.get(name) || 'dps', specId: 0 }));
      const deaths = deathEvents
        .filter((e) => e.fight === fight.id && actors.has(e.targetID))
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((e) => {
          const name = actors.get(e.targetID);
          return {
            t: Math.round((e.timestamp - fight.startTime) / 100) / 10,
            name,
            role: roles.get(name) || 'dps',
            killingBlow: {
              spellName: abilities.get(e.killingAbilityGameID) || null,
              spellId: e.killingAbilityGameID || null,
            },
          };
        });
      const kill = Boolean(fight.kill);
      const raw = Number(fight.fightPercentage ?? 100);
      const bossPercent = kill ? 0 : Math.round((raw > 100 ? raw / 100 : raw) * 10) / 10;
      const massDeath = kill ? null : massDeathOf(deaths);
      return {
        startedAt: report.startTime + fight.startTime,
        encounterId: fight.encounterID,
        encounterName: fight.name,
        difficultyId: WCL_TO_GAME[fight.difficulty],
        result: kill ? 'kill' : 'wipe',
        bossPercent,
        duration,
        report: {
          source: 'wcl',
          wclReport: report.code,
          wclFight: fight.id,
          result: kill ? 'kill' : 'wipe',
          duration,
          encounterName: fight.name,
          roster,
          deaths,
          wipe: massDeath ? { massDeath } : {},
          plan: { items: [] },
          avoidable: [],
          defensives: { players: [] },
        },
      };
    });
};

/**
 * Fetch one report and turn it into pulls.
 * @param {{ query: Function }} wcl  client from recruit-clients.mjs
 */
export const fetchReportPulls = async (wcl, code, gameDifficulties) => {
  const data = await wcl.query(
    `query($code: String!) { reportData { report(code: $code) {
      code startTime title
      fights { id encounterID name difficulty startTime endTime kill fightPercentage friendlyPlayers }
      masterData { actors(type: "Player") { id name } abilities { gameID name } }
    } } }`,
    { code },
  );
  const report = data.reportData?.report;
  if (!report) throw new Error(`Report ${code} not found (is it private?)`);
  const fightIds = (report.fights || [])
    .filter((f) => f.encounterID > 0 && gameDifficulties.has(WCL_TO_GAME[f.difficulty]))
    .map((f) => f.id);
  if (!fightIds.length) return { title: report.title, pulls: [] };

  const details = await wcl.query(
    `query($code: String!, $fights: [Int]!) { reportData { report(code: $code) {
      playerDetails(fightIDs: $fights) } } }`,
    { code, fights: fightIds },
  );
  report.playerDetails = details.reportData?.report?.playerDetails;

  const deaths = [];
  let start = null;
  for (let page = 0; page < 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await wcl.query(
      `query($code: String!, $fights: [Int]!, $start: Float) { reportData { report(code: $code) {
        events(dataType: Deaths, fightIDs: $fights, startTime: $start, limit: 10000) { data nextPageTimestamp } } } }`,
      { code, fights: fightIds, start },
    );
    const events = result.reportData?.report?.events;
    (events?.data || []).forEach((e) => deaths.push(e));
    if (!events?.nextPageTimestamp) break;
    start = events.nextPageTimestamp;
  }
  return { title: report.title, pulls: pullsFromReport(report, deaths, gameDifficulties) };
};

export { GAME_NAMES };
