// Top logs (1.9.96): Warcraft Logs' top 25 kills per boss, difficulty and
// spec, Lorrgs-style, plus "trial tracks" to race them (Time trial).
//
// Data, all from Warcraft Logs with the guild's API client (the Platinum
// key the recruiting crawler uses), spending at most 85% of the hourly
// points like the crawler:
//   - rankings: encounter.characterRankings, top 25 per boss (the raid's
//     bosses from season.mjs) x difficulty x spec x region, once a day;
//   - casts: each ranked player's casts in that fight, fetched when someone
//     opens that spec on the Top logs page (then kept for good: reports
//     don't change);
//   - amounts: their damage (or healing) second by second, fetched on Race me.
//
// "Main cooldowns" per spec come from the data, not hand-made lists, so
// they survive patches: abilities most of the top players cast, with a
// median gap of 45 s or more between casts (see deriveCooldowns).
//
// Routes, under /api/guild/<guild>/pulldesk/toplogs (Analysis viewers):
//   GET  (none)        settings, crawl status, what's cached
//   GET  rankings      ?encounterId&difficulty&specId&region: top 25 rows with
//                      casts (queued when missing), derived cooldowns
//   GET  trial         ?code&fight&name: one player's track (casts + amounts)
//   POST crawl         officers: crawl rankings now
//
// Stored in <storage>/toplogs/ (rankings.json, tracks/<code>-<fight>-<name>.json).
//
//   GUILD_CLOUD_TOPLOGS               "off" turns it off
//   GUILD_CLOUD_TOPLOGS_DIFFICULTIES  default "mythic,heroic"
//   GUILD_CLOUD_TOPLOGS_REGIONS       default "world" (e.g. "world,US,EU")
//   GUILD_CLOUD_TOPLOGS_HOUR          daily crawl hour, server time (default 5)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { createWclClient } from './recruit-clients.mjs';

const DAY = 24 * 60 * 60 * 1000;
export const TOP_N = 25;

/** Blizzard spec ID -> Warcraft Logs class and spec slug, and role. */
export const SPECS = [
  [250, 'DeathKnight', 'Blood', 'tank'],
  [251, 'DeathKnight', 'Frost', 'dps'],
  [252, 'DeathKnight', 'Unholy', 'dps'],
  [577, 'DemonHunter', 'Havoc', 'dps'],
  [581, 'DemonHunter', 'Vengeance', 'tank'],
  [1480, 'DemonHunter', 'Devourer', 'dps'],
  [102, 'Druid', 'Balance', 'dps'],
  [103, 'Druid', 'Feral', 'dps'],
  [104, 'Druid', 'Guardian', 'tank'],
  [105, 'Druid', 'Restoration', 'healer'],
  [1467, 'Evoker', 'Devastation', 'dps'],
  [1468, 'Evoker', 'Preservation', 'healer'],
  [1473, 'Evoker', 'Augmentation', 'dps'],
  [253, 'Hunter', 'BeastMastery', 'dps'],
  [254, 'Hunter', 'Marksmanship', 'dps'],
  [255, 'Hunter', 'Survival', 'dps'],
  [62, 'Mage', 'Arcane', 'dps'],
  [63, 'Mage', 'Fire', 'dps'],
  [64, 'Mage', 'Frost', 'dps'],
  [268, 'Monk', 'Brewmaster', 'tank'],
  [270, 'Monk', 'Mistweaver', 'healer'],
  [269, 'Monk', 'Windwalker', 'dps'],
  [65, 'Paladin', 'Holy', 'healer'],
  [66, 'Paladin', 'Protection', 'tank'],
  [70, 'Paladin', 'Retribution', 'dps'],
  [256, 'Priest', 'Discipline', 'healer'],
  [257, 'Priest', 'Holy', 'healer'],
  [258, 'Priest', 'Shadow', 'dps'],
  [259, 'Rogue', 'Assassination', 'dps'],
  [260, 'Rogue', 'Outlaw', 'dps'],
  [261, 'Rogue', 'Subtlety', 'dps'],
  [262, 'Shaman', 'Elemental', 'dps'],
  [263, 'Shaman', 'Enhancement', 'dps'],
  [264, 'Shaman', 'Restoration', 'healer'],
  [265, 'Warlock', 'Affliction', 'dps'],
  [266, 'Warlock', 'Demonology', 'dps'],
  [267, 'Warlock', 'Destruction', 'dps'],
  [71, 'Warrior', 'Arms', 'dps'],
  [72, 'Warrior', 'Fury', 'dps'],
  [73, 'Warrior', 'Protection', 'tank'],
].map(([specId, className, specName, role]) => ({ specId, className, specName, role }));
const SPEC_BY_ID = new Map(SPECS.map((s) => [s.specId, s]));

/** Healers are ranked by healing, everyone else by damage. */
export const metricOf = (spec) => (spec.role === 'healer' ? 'hps' : 'dps');

/** Our difficulty IDs (combat log) -> Warcraft Logs' (5 Mythic, 4 Heroic, 3 Normal, 1 LFR). */
export const wclDifficulty = (difficultyId) =>
  ({ 16: 5, 233: 5, 15: 4, 14: 3, 17: 1 })[Number(difficultyId)] ?? Number(difficultyId);
const DIFFICULTY_NAMES = { mythic: 16, heroic: 15, normal: 14, lfr: 17 };

const SAFE_NAME = /^[\p{L}\p{M}'\- ]{1,40}$/u;
const SAFE_CODE = /^[A-Za-z0-9]{8,32}$/;

/**
 * Warcraft Logs' characterRankings JSON -> our rows (top `n`).
 * @param {any} json
 */
export const parseRankings = (json, n = TOP_N) =>
  (json?.rankings || [])
    .map((r, i) => ({
      rank: i + 1,
      name: String(r.name || ''),
      server: String(r.server?.name || r.serverName || ''),
      region: String(r.server?.region || r.regionName || ''),
      guild: r.guild?.name ? String(r.guild.name) : null,
      amount: Number(r.amount ?? r.total) || 0,
      duration: Math.round((Number(r.duration) || 0) / 100) / 10,
      ilvl: Number(r.bracketData ?? r.itemLevel) || null,
      startTime: Number(r.startTime) || 0,
      code: String(r.report?.code || r.reportID || ''),
      fight: Number(r.report?.fightID ?? r.fightID) || 0,
    }))
    .filter((r) => r.name && SAFE_CODE.test(r.code) && r.fight > 0)
    .slice(0, n);

const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A spec's "main cooldowns" from what top players actually press: abilities
 * cast by at least `minShare` of them whose median gap between casts is at
 * least `minGap` seconds (one cast in a fight counts as the whole fight).
 * The cooldown is estimated from the shortest gap anyone left.
 *
 * Spells of one name are one cooldown (1.9.102): Frostwyrm's Fury has two
 * spell IDs and was two rows, each pressed by fewer players. A track's
 * `names` (spell ID -> name, from Warcraft Logs) decides; without a name a
 * spell stands on its own. `spellId` is the ID pressed most, `spellIds` all.
 * @param {{ duration: number, casts: [number, number][], names?: Record<string, string> }[]} tracks casts as [seconds, spellId]
 */
export const deriveCooldowns = (tracks, { minShare = 0.6, minGap = 45, max = 12 } = {}) => {
  const usable = tracks.filter((t) => t && Array.isArray(t.casts));
  if (usable.length < 3) return [];
  const nameOf = new Map();
  usable.forEach((t) =>
    Object.entries(t.names || {}).forEach(([id, name]) => {
      if (name && !nameOf.has(Number(id))) nameOf.set(Number(id), String(name));
    }),
  );
  const keyOf = (id) => (nameOf.has(id) ? `n:${nameOf.get(id).toLowerCase()}` : `#${id}`);
  const by = new Map(); // key -> { players, gaps: [], counts: [], firsts: [], ids: Map<id, casts> }
  usable.forEach((t) => {
    const times = new Map();
    t.casts.forEach(([at, id]) => {
      const key = keyOf(id);
      if (!times.has(key)) times.set(key, { list: [], ids: new Map() });
      const e = times.get(key);
      e.list.push(at);
      e.ids.set(id, (e.ids.get(id) || 0) + 1);
    });
    times.forEach(({ list, ids }, key) => {
      list.sort((a, b) => a - b);
      const entry = by.get(key) || { players: 0, gaps: [], counts: [], firsts: [], shortest: Infinity, ids: new Map() };
      entry.players += 1;
      entry.counts.push(list.length);
      entry.firsts.push(list[0]);
      ids.forEach((n, id) => entry.ids.set(id, (entry.ids.get(id) || 0) + n));
      if (list.length === 1) entry.gaps.push(Math.max(minGap, t.duration || 0));
      for (let i = 1; i < list.length; i += 1) {
        const gap = list[i] - list[i - 1];
        entry.gaps.push(gap);
        if (gap > 1) entry.shortest = Math.min(entry.shortest, gap);
      }
      by.set(key, entry);
    });
  });
  const need = Math.ceil(usable.length * minShare);
  return [...by.values()]
    .map((e) => {
      const ids = [...e.ids.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
      return {
        spellId: ids[0],
        spellIds: ids,
        name: nameOf.get(ids[0]) || '',
        share: e.players / usable.length,
        medianGap: median(e.gaps),
        medianCasts: median(e.counts),
        medianFirst: median(e.firsts),
        cooldown: Number.isFinite(e.shortest) ? Math.round(e.shortest) : null,
        players: e.players,
      };
    })
    .filter((c) => c.players >= need && c.medianGap >= minGap)
    .sort((a, b) => b.share - a.share || a.medianFirst - b.medianFirst)
    .slice(0, max)
    .map((c) => ({ ...c, share: Math.round(c.share * 100) / 100, medianGap: Math.round(c.medianGap) }));
};

/**
 * Seconds -> cumulative amount, one point per second, from amount events.
 * @param {{ timestamp: number, amount?: number, absorbed?: number }[]} events
 */
export const cumulative = (events, fightStart, duration) => {
  const seconds = Math.max(1, Math.ceil(duration));
  const per = new Array(seconds).fill(0);
  events.forEach((e) => {
    const at = (e.timestamp - fightStart) / 1000;
    if (at < 0) return;
    const slot = Math.min(seconds - 1, Math.floor(at));
    per[slot] += (Number(e.amount) || 0) + (Number(e.absorbed) || 0);
  });
  let sum = 0;
  return per.map((v) => {
    sum += v;
    return Math.round(sum);
  });
};

/**
 * A track with usable amounts. 1.9.96 saved all-zero amounts when Warcraft
 * Logs answered with no events; those are fetched again.
 */
export const hasAmounts = (track) => Boolean(track?.amounts?.length && track.amounts[track.amounts.length - 1] > 0);

/**
 * A track with what Time trial needs besides amounts (1.9.102): spell names
 * (to merge cooldowns by name) and the enemies' casts in their fight (to
 * find where each of their phases starts in our own log).
 */
export const hasExtras = (track) => Boolean(track?.names && Array.isArray(track.enemy));

/** Warcraft Logs' masterData abilities -> names of the IDs asked for. */
export const namesFor = (abilities, ids) => {
  const want = new Set(ids.map(Number));
  const out = {};
  (abilities || []).forEach((a) => {
    const id = Number(a?.gameID);
    if (want.has(id) && a.name) out[id] = String(a.name);
  });
  return out;
};

export const createTopLogs = ({ storage, env, readBody, json, fail, season, isOfficer = async () => false, fetchImpl, wcl: givenWcl }) => {
  const enabled = String(env.GUILD_CLOUD_TOPLOGS ?? 'on').toLowerCase() !== 'off';
  const dir = path.join(storage, 'toplogs');
  const difficulties = String(env.GUILD_CLOUD_TOPLOGS_DIFFICULTIES || 'mythic,heroic')
    .split(',')
    .map((d) => DIFFICULTY_NAMES[d.trim().toLowerCase()])
    .filter(Boolean);
  const regions = [
    ...new Set(
      String(env.GUILD_CLOUD_TOPLOGS_REGIONS || 'world')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => (r.toLowerCase() === 'world' ? 'world' : r.toUpperCase())),
    ),
  ];
  const crawlHour = Math.min(23, Math.max(0, Number(env.GUILD_CLOUD_TOPLOGS_HOUR ?? 5) || 0));

  const status = { running: false, startedAt: null, finishedAt: null, done: 0, total: 0, log: [], error: '' };
  const log = (message) => {
    status.log.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
    if (status.log.length > 200) status.log.splice(0, status.log.length - 200);
  };

  const wcl =
    givenWcl ||
    createWclClient({
      clientId: env.GUILD_CLOUD_WCL_CLIENT_ID || '',
      clientSecret: env.GUILD_CLOUD_WCL_CLIENT_SECRET || '',
      baseUrl: env.GUILD_CLOUD_WCL_URL || undefined,
      log,
      ...(fetchImpl ? { fetchImpl } : {}),
    });

  // ---- Storage -------------------------------------------------------------
  const readJson = async (file, fallback) => {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      return fallback;
    }
  };
  const writeJson = async (file, value) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(value));
    await fsp.rename(`${file}.tmp`, file);
  };
  const rankingsFile = path.join(dir, 'rankings.json');
  let rankings = null; // { lastCrawl, sets: { key: { at, rows } } }
  const loadRankings = async () => {
    rankings ??= await readJson(rankingsFile, { lastCrawl: 0, sets: {} });
    return rankings;
  };
  let saveTimer = null;
  const saveRankings = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeJson(rankingsFile, rankings).catch(() => {}), 500);
    saveTimer.unref?.();
  };
  const setKey = (encounterId, difficultyId, specId, region) =>
    `${encounterId}:${wclDifficulty(difficultyId)}:${specId}:${region}`;
  const trackFile = (code, fight, name) =>
    path.join(dir, 'tracks', `${code}-${fight}-${encodeURIComponent(name.toLowerCase())}.json`);
  const trackMemo = new Map();
  const readTrack = async (code, fight, name) => {
    const key = `${code}:${fight}:${name.toLowerCase()}`;
    if (trackMemo.has(key)) return trackMemo.get(key);
    const track = await readJson(trackFile(code, fight, name), null);
    if (track) trackMemo.set(key, track);
    return track;
  };
  const writeTrack = async (code, fight, name, track) => {
    trackMemo.set(`${code}:${fight}:${name.toLowerCase()}`, track);
    await writeJson(trackFile(code, fight, name), track);
  };

  // ---- Warcraft Logs ------------------------------------------------------
  const fetchRankings = async (encounterId, difficultyId, spec, region) => {
    const data = await wcl.query(
      `query($id: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!, $region: String) {
        worldData { encounter(id: $id) { characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, serverRegion: $region, page: 1) } } }`,
      {
        id: Number(encounterId),
        cls: spec.className,
        spec: spec.specName,
        diff: wclDifficulty(difficultyId),
        metric: metricOf(spec),
        region: region === 'world' ? null : region,
      },
      { quiet: true },
    );
    const rows = parseRankings(data.worldData?.encounter?.characterRankings);
    const all = await loadRankings();
    all.sets[setKey(encounterId, difficultyId, spec.specId, region)] = { at: Date.now(), rows };
    saveRankings();
    return rows;
  };

  // The fight, the player (and their pets), then their casts; with `amounts`
  // also their damage or healing second by second.
  // Each report's ability names, kept while the server runs (one report
  // holds many ranked players).
  const reportAbilities = new Map();
  const abilitiesOf = async (code) => {
    if (reportAbilities.has(code)) return reportAbilities.get(code);
    const data = await wcl.query(
      `query($code: String!) { reportData { report(code: $code) { masterData { abilities { gameID name } } } } }`,
      { code },
      { quiet: true },
    );
    const list = data.reportData?.report?.masterData?.abilities || [];
    reportAbilities.set(code, list);
    return list;
  };

  // Names for a track saved before 1.9.102 (cheap: one query per report).
  const fetchNames = async (code, fight, name) => {
    const track = await readTrack(code, fight, name);
    if (!track || track.names) return track;
    const names = namesFor(await abilitiesOf(code), (track.casts || []).map((c) => c[1]));
    const next = { ...track, names };
    await writeTrack(code, fight, name, next);
    return next;
  };

  // The enemies' casts in their fight (Time trial finds our phases with them).
  const fetchEnemy = async (track) => {
    const enemy = [];
    const end = track.fightStart + track.duration * 1000;
    let start = track.fightStart;
    for (let page = 0; page < 10 && start !== null && start !== undefined; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const data = await wcl.query(
        `query($code: String!, $fight: Int!, $start: Float!, $end: Float!) { reportData { report(code: $code) {
          events(fightIDs: [$fight], dataType: Casts, hostilityType: Enemies, startTime: $start, endTime: $end, limit: 10000) { data nextPageTimestamp }
        } } }`,
        { code: track.code, fight: track.fight, start, end },
        { quiet: true },
      );
      const events = data.reportData?.report?.events;
      (events?.data || []).forEach((e) => {
        if (e.type === 'cast' && e.abilityGameID) {
          enemy.push([Math.round((e.timestamp - track.fightStart) / 100) / 10, Number(e.abilityGameID)]);
        }
      });
      start = events?.nextPageTimestamp ?? null;
    }
    const abilities = await abilitiesOf(track.code);
    const names = namesFor(abilities, [...(track.casts || []).map((c) => c[1]), ...enemy.map((c) => c[1])]);
    return { ...track, enemy, names: { ...(track.names || {}), ...names } };
  };

  const fetchTrack = async (code, fight, name, { amounts = false, metric = 'dps' } = {}) => {
    const old = await readTrack(code, fight, name);
    if (old && (!amounts || (hasAmounts(old) && hasExtras(old)))) return old;
    let track = old;
    if (!track) {
      const head = await wcl.query(
        `query($code: String!, $fight: Int!) { reportData { report(code: $code) {
          fights(fightIDs: [$fight]) { id startTime endTime encounterID kill phaseTransitions { id startTime } }
          phases { encounterID phases { id name isIntermission } }
          masterData { actors { id name server type subType petOwner } abilities { gameID name } }
        } } }`,
        { code, fight: Number(fight) },
        { quiet: true },
      );
      const report = head.reportData?.report;
      const f = report?.fights?.[0];
      if (!f) throw new Error(`Fight ${fight} not found in report ${code}`);
      const actors = report.masterData?.actors || [];
      const player =
        actors.find((a) => a.type === 'Player' && a.name.toLowerCase() === name.toLowerCase()) || null;
      if (!player) throw new Error(`${name} not found in report ${code}`);
      const pets = actors.filter((a) => a.petOwner === player.id).map((a) => a.id);
      const duration = Math.round((f.endTime - f.startTime) / 100) / 10;
      const casts = [];
      let start = f.startTime;
      for (let page = 0; page < 10 && start !== null && start !== undefined; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const data = await wcl.query(
          `query($code: String!, $fight: Int!, $src: Int!, $start: Float!, $end: Float!) { reportData { report(code: $code) {
            events(fightIDs: [$fight], dataType: Casts, sourceID: $src, startTime: $start, endTime: $end, limit: 10000) { data nextPageTimestamp }
          } } }`,
          { code, fight: Number(fight), src: player.id, start, end: f.endTime },
          { quiet: true },
        );
        const events = data.reportData?.report?.events;
        (events?.data || []).forEach((e) => {
          if (e.type === 'cast' && e.abilityGameID) {
            casts.push([Math.round((e.timestamp - f.startTime) / 100) / 10, Number(e.abilityGameID)]);
          }
        });
        start = events?.nextPageTimestamp ?? null;
      }
      const phaseInfo = (report.phases || []).find((p) => p.encounterID === f.encounterID);
      track = {
        code,
        fight: Number(fight),
        name: player.name,
        server: player.server || '',
        playerId: player.id,
        pets,
        fightStart: f.startTime,
        duration,
        encounterId: f.encounterID,
        kill: Boolean(f.kill),
        casts,
        phases: (f.phaseTransitions || []).map((p) => [Math.round((p.startTime - f.startTime) / 100) / 10, p.id]),
        phaseNames: Object.fromEntries((phaseInfo?.phases || []).map((p) => [p.id, p.name])),
        names: namesFor(report.masterData?.abilities, casts.map((c) => c[1])),
        at: Date.now(),
      };
      reportAbilities.set(code, report.masterData?.abilities || []);
    }
    if (amounts && !hasAmounts(track)) {
      // One query per actor (the player, then each pet) with the plain
      // sourceID argument. 1.9.96 used a filter expression
      // (`source.id IN (...)`), which came back empty on the real server:
      // the race chart's "them" line lay flat at zero.
      const ids = [track.playerId, ...(track.pets || [])];
      const events = [];
      const end = track.fightStart + track.duration * 1000;
      const dataType = metric === 'hps' ? 'Healing' : 'DamageDone';
      for (const src of ids) {
        let start = track.fightStart;
        for (let page = 0; page < 20 && start !== null && start !== undefined; page += 1) {
          // eslint-disable-next-line no-await-in-loop
          const data = await wcl.query(
            `query($code: String!, $fight: Int!, $src: Int!, $start: Float!, $end: Float!) { reportData { report(code: $code) {
              events(fightIDs: [$fight], dataType: ${dataType}, sourceID: $src, startTime: $start, endTime: $end, limit: 10000) { data nextPageTimestamp }
            } } }`,
            { code, fight: track.fight, src, start, end },
            { quiet: true },
          );
          const page_ = data.reportData?.report?.events;
          (page_?.data || []).forEach((e) => {
            // Damage done: hits (and their absorbed part) on enemies. Healing:
            // heals and shields' absorbs; overheal isn't in `amount`.
            if (dataType === 'DamageDone' && e.type !== 'damage') return;
            if (dataType === 'Healing' && e.type !== 'heal' && e.type !== 'absorbed') return;
            // Heals' `absorbed` is healing a heal-absorb ate: not counted.
            events.push(dataType === 'Healing' ? { timestamp: e.timestamp, amount: e.amount } : e);
          });
          start = page_?.nextPageTimestamp ?? null;
        }
      }
      const sums = cumulative(events, track.fightStart, track.duration);
      log(`${track.name} (${code} #${track.fight}): ${events.length} ${metric === 'hps' ? 'heals' : 'hits'} from ${ids.length} actor(s)`);
      // Nothing at all is a fetch problem, not a result: don't keep it.
      if (!sums[sums.length - 1]) {
        throw new Error(`Warcraft Logs returned no ${metric === 'hps' ? 'healing' : 'damage'} for ${track.name}`);
      }
      track = { ...track, metric, amounts: sums };
    }
    if (amounts && !hasExtras(track)) track = await fetchEnemy(track);
    await writeTrack(code, fight, name, track);
    return track;
  };

  // ---- Job queue: page requests first, the daily crawl after -------------
  const urgent = [];
  const background = [];
  const queued = new Map(); // key -> promise
  const failed = new Map(); // key -> { at, error }
  let working = false;
  const pump = async () => {
    if (working) return;
    working = true;
    try {
      while (urgent.length || background.length) {
        const job = urgent.shift() || background.shift();
        try {
          // eslint-disable-next-line no-await-in-loop
          job.resolve(await job.run());
          failed.delete(job.key);
        } catch (error) {
          failed.set(job.key, { at: Date.now(), error: error.message });
          if (error.message !== 'Stopped') log(`${job.key}: ${error.message}`);
          job.resolve(null);
        } finally {
          queued.delete(job.key);
        }
      }
    } finally {
      working = false;
    }
  };
  const enqueue = (key, run, { first = true } = {}) => {
    if (queued.has(key)) return queued.get(key);
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    (first ? urgent : background).push({ key, run, resolve });
    queued.set(key, promise);
    pump();
    return promise;
  };
  // Don't hammer a fight Warcraft Logs refused; try again after an hour.
  const recentlyFailed = (key) => {
    const f = failed.get(key);
    return f && Date.now() - f.at < 60 * 60 * 1000 ? f.error : null;
  };

  // ---- Daily crawl ---------------------------------------------------------
  const bosses = async () => {
    const zone = await season?.zone().catch(() => null);
    return zone?.encounters || [];
  };
  const crawl = async () => {
    if (status.running || !enabled || !wcl.configured) return;
    const list = await bosses();
    if (!list.length) {
      log('No raid bosses yet (set GUILD_CLOUD_RAID_ZONE); skipping.');
      return;
    }
    status.running = true;
    status.startedAt = Date.now();
    status.error = '';
    const jobs = [];
    list.forEach((boss) =>
      difficulties.forEach((difficultyId) =>
        SPECS.forEach((spec) =>
          regions.forEach((region) => jobs.push({ boss, difficultyId, spec, region })),
        ),
      ),
    );
    status.total = jobs.length;
    status.done = 0;
    log(`Crawling ${jobs.length} rankings (${list.length} bosses, ${difficulties.length} difficulties, ${SPECS.length} specs, ${regions.join('/')}).`);
    try {
      await Promise.all(
        jobs.map(({ boss, difficultyId, spec, region }) =>
          enqueue(
            `rankings:${setKey(boss.id, difficultyId, spec.specId, region)}`,
            () => fetchRankings(boss.id, difficultyId, spec, region),
            { first: false },
          ).then(() => {
            status.done += 1;
          }),
        ),
      );
      const all = await loadRankings();
      all.lastCrawl = Date.now();
      saveRankings();
      log('Crawl done.');
    } catch (error) {
      status.error = error.message;
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
    }
  };
  let timer = null;
  const start = () => {
    if (!enabled || timer) return;
    const tick = async () => {
      const all = await loadRankings();
      const due = Date.now() - (all.lastCrawl || 0) > 20 * 60 * 60 * 1000;
      if (due && (new Date().getHours() >= crawlHour || !all.lastCrawl)) crawl().catch(() => {});
    };
    timer = setInterval(tick, 30 * 60 * 1000);
    timer.unref?.();
    setTimeout(tick, 60 * 1000).unref?.();
  };

  // ---- Routes ---------------------------------------------------------------
  const rowState = async (row) => {
    const track = await readTrack(row.code, row.fight, row.name);
    if (track) return { ...row, casts: track.casts, phases: track.phases, names: track.names || null, state: 'ready' };
    const key = `track:${row.code}:${row.fight}:${row.name.toLowerCase()}`;
    const error = recentlyFailed(key);
    if (error) return { ...row, casts: null, state: 'failed', error };
    return { ...row, casts: null, state: 'queued' };
  };

  const handle = async (req, res, rest, url) => {
    const [first] = rest;
    const q = (k) => url?.searchParams.get(k) || '';
    if (!enabled) return fail(res, 404, 'Top logs are turned off on this server');

    if (!first && req.method === 'GET') {
      const all = await loadRankings();
      return json(res, 200, {
        configured: wcl.configured,
        regions,
        difficulties,
        specs: SPECS,
        lastCrawl: all.lastCrawl || null,
        sets: Object.keys(all.sets).length,
        status: { ...status, log: status.log.slice(-30) },
        usage: wcl.usage || null,
      });
    }

    if (first === 'crawl' && req.method === 'POST') {
      if (!(await isOfficer(req))) return fail(res, 403, 'Officers only');
      crawl().catch(() => {});
      return json(res, 202, { started: true });
    }

    if (first === 'rankings' && req.method === 'GET') {
      const encounterId = Number(q('encounterId'));
      const difficultyId = Number(q('difficulty')) || 16;
      const spec = SPEC_BY_ID.get(Number(q('specId')));
      const region = regions.includes(q('region')) ? q('region') : regions[0];
      if (!encounterId || !spec) return fail(res, 400, 'Expected encounterId and specId');
      if (!wcl.configured) return fail(res, 503, 'Warcraft Logs API keys are not set on the server');
      const all = await loadRankings();
      const key = setKey(encounterId, difficultyId, spec.specId, region);
      let set = all.sets[key];
      if (!set) {
        // Not crawled yet: ask now (a few seconds).
        const rkey = `rankings:${key}`;
        const error = recentlyFailed(rkey);
        if (error) return fail(res, 502, error);
        await enqueue(rkey, () => fetchRankings(encounterId, difficultyId, spec, region));
        set = all.sets[key];
        if (!set) return fail(res, 502, recentlyFailed(rkey) || 'Warcraft Logs had no rankings');
      }
      const rows = await Promise.all(set.rows.map(rowState));
      // Fetch missing casts in rank order (page requests go first).
      rows
        .filter((r) => r.state === 'queued')
        .forEach((r) =>
          enqueue(`track:${r.code}:${r.fight}:${r.name.toLowerCase()}`, () => fetchTrack(r.code, r.fight, r.name)),
        );
      // Tracks saved before 1.9.102 have no spell names: fetch them after
      // the casts (cooldowns merge by name once they're in).
      rows
        .filter((r) => r.state === 'ready' && !r.names)
        .forEach((r) =>
          enqueue(`names:${r.code}:${r.fight}:${r.name.toLowerCase()}`, () => fetchNames(r.code, r.fight, r.name), {
            first: false,
          }),
        );
      const ready = rows.filter((r) => r.state === 'ready');
      return json(res, 200, {
        encounterId,
        difficultyId,
        specId: spec.specId,
        metric: metricOf(spec),
        region,
        at: set.at,
        rows,
        pending: rows.filter((r) => r.state === 'queued').length,
        cooldowns: deriveCooldowns(ready.map((r) => ({ duration: r.duration, casts: r.casts, names: r.names }))),
      });
    }

    if (first === 'trial' && req.method === 'GET') {
      const code = q('code');
      const fight = Number(q('fight'));
      const name = q('name');
      const metric = q('metric') === 'hps' ? 'hps' : 'dps';
      if (!SAFE_CODE.test(code) || !(fight > 0) || !SAFE_NAME.test(name)) return fail(res, 400, 'Bad trial');
      const have = await readTrack(code, fight, name);
      if (hasAmounts(have) && hasExtras(have)) return json(res, 200, { state: 'ready', track: have });
      const key = `trial:${code}:${fight}:${name.toLowerCase()}`;
      const error = recentlyFailed(key);
      if (error) return json(res, 200, { state: 'failed', error });
      const job = enqueue(key, () => fetchTrack(code, fight, name, { amounts: true, metric }));
      // Answer within a few seconds either way; the app asks again.
      const track = await Promise.race([job, new Promise((r) => setTimeout(() => r(undefined), 8000))]);
      if (hasAmounts(track) && hasExtras(track)) return json(res, 200, { state: 'ready', track });
      const failedNow = recentlyFailed(key);
      if (failedNow) return json(res, 200, { state: 'failed', error: failedNow });
      return json(res, 200, { state: 'queued' });
    }

    return fail(res, 404, 'Unknown API route');
  };

  return { handle, start, crawl, status, enabled };
};
