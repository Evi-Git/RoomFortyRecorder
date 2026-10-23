// Pull desk import from Warcraft Logs: backfills pulls the app didn't
// capture (nobody had "Send my pull logs" on, or it happened before the
// Pull desk existed). Each imported pull gets a light report built from the
// Warcraft Logs data: result, boss %, duration, roster with roles, and
// deaths with killing blows. That is enough for the Night summary and
// Progression views (wipe causes, early deaths); the cooldown plan,
// avoidable hits and defensives need the app's own log, so they're empty.

// Warcraft Logs difficulty -> game difficulty ID.
// 233 = flex Mythic (Kith'ix), in case Warcraft Logs passes it through.
const WCL_TO_GAME = { 1: 17, 3: 14, 4: 15, 5: 16, 233: 233 };
const GAME_NAMES = { 14: 'normal', 15: 'heroic', 16: 'mythic', 17: 'lfr', 233: 'mythic' };

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

// ---- Extras for imported pulls: consumables, avoidable hits, potions -------

const quoted = (name) => `"${String(name).replace(/["\\]/g, '')}"`;

/** A Warcraft Logs filter expression matching abilities by ID or name. */
export const abilityFilter = (ids = [], names = []) => {
  const parts = [];
  const cleanIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (cleanIds.length) parts.push(`ability.id in (${cleanIds.join(', ')})`);
  [...new Set(names.filter(Boolean))].forEach((n) => parts.push(`ability.name = ${quoted(n)}`));
  return parts.join(' or ');
};

/**
 * A combatantinfo event as COMBATANT_INFO args (see consumables.rawPrep):
 * gear [itemId, ilvl, [perm, temp, onUse], [bonusIds], [gemId, ilvl, ...]]
 * at [28], auras [source, spellId, stacks, ...] at [29].
 */
export const combatantArgs = (event) => {
  const args = [];
  args[28] = (event.gear || []).map((g) => [
    String(g?.id || 0),
    String(g?.itemLevel || 0),
    [String(g?.permanentEnchant || 0), String(g?.temporaryEnchant || 0), '0'],
    (g?.bonusIDs || []).map(String),
    (g?.gems || []).flatMap((gem) => [String(gem?.id || 0), String(gem?.itemLevel || 0)]),
  ]);
  args[29] = (event.auras || []).flatMap((a) => [String(a.source ?? ''), String(a.ability || 0), String(a.stacks || 1)]);
  return args;
};

const allEvents = async (wcl, code, fightIds, dataType, filter) => {
  const out = [];
  let start = null;
  for (let page = 0; page < 30; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await wcl.query(
      `query($code: String!, $fights: [Int]!, $start: Float, $filter: String) { reportData { report(code: $code) {
        events(dataType: ${dataType}, fightIDs: $fights, startTime: $start, filterExpression: $filter, limit: 10000) { data nextPageTimestamp } } } }`,
      { code, fights: fightIds, start, filter: filter || null },
    );
    const events = result.reportData?.report?.events;
    (events?.data || []).forEach((e) => out.push(e));
    if (!events?.nextPageTimestamp) break;
    start = events.nextPageTimestamp;
  }
  return out;
};

/**
 * Gear and buffs at each pull, hits from the given abilities, and combat
 * potions cast, for fights of one Warcraft Logs report.
 * @returns {Map<number, { players, auraNames, avoidable, potions }>} by fight ID
 */
export const fetchReportExtras = async (wcl, code, fightIds, { abilityIds = [], abilityNames = [], potionNames = [] } = {}) => {
  const meta = await wcl.query(
    `query($code: String!) { reportData { report(code: $code) {
      fights { id startTime }
      masterData { actors(type: "Player") { id name } abilities { gameID name } }
    } } }`,
    { code },
  );
  const report = meta.reportData?.report;
  if (!report) throw new Error(`Report ${code} not found (is it private?)`);
  const actors = new Map((report.masterData?.actors || []).map((a) => [a.id, a.name]));
  const abilities = new Map((report.masterData?.abilities || []).map((a) => [a.gameID, a.name]));
  const fightStart = new Map((report.fights || []).map((f) => [f.id, f.startTime]));

  const byFight = new Map(
    fightIds.map((id) => [id, { players: [], auraNames: {}, avoidable: new Map(), potions: {} }]),
  );

  const infos = await allEvents(wcl, code, fightIds, 'CombatantInfo');
  infos.forEach((e) => {
    const slot = byFight.get(e.fight);
    const name = actors.get(e.sourceID);
    if (!slot || !name || slot.players.some((p) => p.name === name)) return;
    slot.players.push({ guid: String(e.sourceID), name, specId: Number(e.specID) || 0, args: combatantArgs(e) });
    (e.auras || []).forEach((a) => {
      const auraName = a.name || abilities.get(a.ability);
      if (auraName) slot.auraNames[a.ability] = auraName;
    });
  });

  const hitFilter = abilityFilter(abilityIds, abilityNames);
  if (hitFilter) {
    const hits = await allEvents(wcl, code, fightIds, 'DamageTaken', hitFilter);
    hits.forEach((e) => {
      if (e.type !== 'damage') return;
      const slot = byFight.get(e.fight);
      const name = actors.get(e.targetID);
      if (!slot || !name || actors.has(e.sourceID)) return; // players only, from enemies
      const spellId = e.abilityGameID;
      const amount = Number(e.amount) || 0;
      const row = slot.avoidable.get(name) || { name, hits: 0, damage: 0, bySpell: {}, spells: {} };
      row.hits += 1;
      row.damage += amount;
      row.bySpell[spellId] = (row.bySpell[spellId] || 0) + 1;
      const spell = row.spells[spellId] || { hits: 0, damage: 0, times: [] };
      spell.hits += 1;
      spell.damage += amount;
      const t = Math.round((e.timestamp - (fightStart.get(e.fight) || 0)) / 100) / 10;
      const last = spell.times[spell.times.length - 1];
      if (!last || t - (last.end ?? last.t) > 5) {
        if (spell.times.length < 40) spell.times.push({ t, end: t });
      } else last.end = t;
      row.spells[spellId] = spell;
      slot.avoidable.set(name, row);
    });
  }

  const potionFilter = abilityFilter([], potionNames);
  if (potionFilter) {
    const casts = await allEvents(wcl, code, fightIds, 'Casts', potionFilter);
    casts.forEach((e) => {
      if (e.type !== 'cast') return;
      const slot = byFight.get(e.fight);
      const name = actors.get(e.sourceID);
      if (slot && name) slot.potions[name] = (slot.potions[name] || 0) + 1;
    });
  }

  const out = new Map();
  byFight.forEach((slot, fightId) => {
    out.set(fightId, {
      players: slot.players,
      auraNames: slot.auraNames,
      // Who cast buffs, for raiders without their own combatant info.
      sourceNames: Object.fromEntries([...actors.entries()].map(([id, n]) => [String(id), n])),
      potions: slot.potions,
      avoidable: [...slot.avoidable.values()]
        .map((row) => ({
          ...row,
          spells: Object.entries(row.spells)
            .map(([spellId, spell]) => ({
              spellId: Number(spellId),
              spellName: abilities.get(Number(spellId)) || null,
              ...spell,
            }))
            .sort((a, b) => b.hits - a.hits),
        }))
        .sort((a, b) => b.hits - a.hits),
    });
  });
  return out;
};
