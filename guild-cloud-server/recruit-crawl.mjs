// Recruiting crawler: Raider.IO guild list -> each guild's Warcraft Logs
// reports -> progression pulls (up to and including the first kill) on the
// chosen bosses -> per-player deaths and mechanics -> parses -> results.json.
//
// Everything is cached under <storage>/recruit so later runs only fetch new
// reports. Old reports never change, so their analysis is kept forever.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_BOSSES,
  analyzeBossReport,
  mergeBossTotals,
  parseSummary,
  progressionFights,
  raidAverages,
  serverSlug,
  roleForSpec,
  rolesFromPlayerDetails,
  specsFromPlayerDetails,
} from './recruit-analyze.mjs';
import { fetchRaiderIoGuilds } from './recruit-clients.mjs';

export const DEFAULT_SETTINGS = {
  raidSlug: 'the-venomous-abyss',
  zoneName: 'The Venomous Abyss',
  region: 'us',
  minRank: 200,
  maxRank: 600,
  difficulty: 5, // Mythic
  bosses: DEFAULT_BOSSES.map((boss) => ({
    ...boss,
    rioSlug: boss.name === 'The Coiled Altar' ? 'the-coiled-altar' : 'ulatek',
  })),
  // Who to rank. A group is either a role (every DPS spec) or a class with
  // optional specs, e.g. { label: 'Arms Warrior', className: 'Warrior', specs: ['Arms'] }.
  specGroups: [{ label: 'DPS', role: 'dps' }],
  deathCutoff: 2,
  minPulls: 15,
  parseKind: 'median',
  weights: { parse: 50, deaths: 30, mechanics: 20 },
  maxReportsPerGuild: 60,
  // Hour of the day (server's local time) for the automatic daily crawl.
  // Set to -1 to only crawl when started from the page.
  autoCrawlHour: 5,
};

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DAY = 24 * 60 * 60 * 1000;

export const createRecruitCrawler = ({ storage, wcl, rioBaseUrl, log: baseLog = console.log }) => {
  const dir = path.join(storage, 'recruit');
  const reportsDir = path.join(dir, 'reports');
  const file = (name) => path.join(dir, name);

  const status = {
    running: false,
    phase: 'idle',
    startedAt: null,
    finishedAt: null,
    guildIndex: 0,
    guildCount: 0,
    currentGuild: null,
    error: null,
    log: [],
  };

  const log = (message) => {
    const line = `${new Date().toISOString().slice(11, 19)} ${message}`;
    status.log.push(line);
    if (status.log.length > 300) status.log.splice(0, status.log.length - 300);
    baseLog(`[recruit] ${message}`);
  };

  const readJson = async (name, fallback) => {
    try {
      return JSON.parse(await fs.readFile(name, 'utf8'));
    } catch {
      return fallback;
    }
  };
  const writeJson = async (name, value) => {
    await fs.mkdir(path.dirname(name), { recursive: true });
    const tmp = `${name}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, name);
  };

  // The first version ranked only Arms Warriors and Warlocks; settings saved
  // with exactly that list move to the new all-DPS default.
  const OLD_DEFAULT_GROUPS = JSON.stringify([
    { label: 'Arms Warrior', className: 'Warrior', specs: ['Arms'] },
    { label: 'Warlock', className: 'Warlock', specs: [] },
  ]);
  const getSettings = async () => {
    const saved = await readJson(file('settings.json'), {});
    if (JSON.stringify(saved.specGroups) === OLD_DEFAULT_GROUPS) delete saved.specGroups;
    return { ...DEFAULT_SETTINGS, ...saved };
  };
  const saveSettings = async (patch) => {
    const next = { ...(await getSettings()), ...patch };
    await writeJson(file('settings.json'), next);
    return next;
  };

  // ---- Warcraft Logs lookups ------------------------------------------------

  const resolveEncounters = async (settings) => {
    const data = await wcl.query('query { worldData { zones { id name encounters { id name } } } }');
    const zones = data.worldData?.zones || [];
    const zone = zones
      .filter((z) => norm(z.name) === norm(settings.zoneName))
      .sort((a, b) => b.id - a.id)[0];
    if (!zone) throw new Error(`Warcraft Logs has no zone called "${settings.zoneName}".`);
    const encounters = {};
    settings.bosses.forEach((boss) => {
      const match = (zone.encounters || []).find((e) => norm(e.name) === norm(boss.name));
      if (!match) throw new Error(`"${boss.name}" isn't an encounter in ${zone.name}.`);
      encounters[boss.name] = match.id;
    });
    return { zoneId: zone.id, encounters };
  };

  // Warcraft Logs wants the region in capitals ("US") and its own realm
  // slug, which doesn't always match Raider.IO's. Try the likely spellings,
  // then use the guild's ID for everything after.
  const resolveGuild = async (guild) => {
    const region = String(guild.region || '').toUpperCase();
    const slugs = [...new Set([guild.realmSlug, serverSlug(guild.realm), serverSlug(guild.realmSlug)].filter(Boolean))];
    for (const slug of slugs) {
      let data = {};
      try {
        // eslint-disable-next-line no-await-in-loop
        data = await wcl.query(
          `query($name: String!, $slug: String!, $region: String!) {
            guildData { guild(name: $name, serverSlug: $slug, serverRegion: $region) { id name } } }`,
          { name: guild.name, slug, region },
          { quiet: true },
        );
      } catch (error) {
        // "No guild exists..." comes back as an error: try the next spelling.
        if (error.message === 'Stopped') throw error;
      }
      const found = data.guildData?.guild;
      if (found?.id) return found.id;
    }
    return null;
  };

  const listReports = async (guildId, zoneId, endTime, settings) => {
    const reports = [];
    for (let page = 1; page <= 10 && reports.length < settings.maxReportsPerGuild; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const data = await wcl.query(
        `query($guild: Int!, $zone: Int, $page: Int!, $end: Float) {
          reportData { reports(guildID: $guild, zoneID: $zone, limit: 25, page: $page, endTime: $end) {
            has_more_pages data { code startTime endTime zone { id name } } } } }`,
        { guild: guildId, zone: zoneId ?? null, page, end: endTime ?? null },
      );
      const result = data.reportData?.reports;
      (result?.data || []).forEach((r) => reports.push(r));
      if (!result?.has_more_pages) break;
    }
    return reports.slice(0, settings.maxReportsPerGuild);
  };

  // Reports to scan for a guild. Normally: this raid's zone, up to the last
  // first kill. If that finds nothing, fall back to their reports without
  // the zone filter (the fights check below still keeps only these bosses)
  // and log what we saw, so a filter mismatch can't silently hide a guild.
  const findReports = async (guild, guildId, zoneId, endTime, settings) => {
    const filtered = await listReports(guildId, zoneId, endTime, settings);
    if (filtered.length) return filtered;

    const anyZone = await listReports(guildId, null, endTime, settings);
    const recent = anyZone.length ? anyZone : await listReports(guildId, null, null, settings);
    const zones = {};
    recent.forEach((r) => {
      const name = r.zone?.name || 'no zone';
      zones[`${name}${r.zone?.id ? ` #${r.zone.id}` : ''}`] = (zones[`${name}${r.zone?.id ? ` #${r.zone.id}` : ''}`] || 0) + 1;
    });
    const summary = Object.entries(zones).map(([z, n]) => `${z} ×${n}`).join(', ') || 'none';
    // Only reports that could hold these bosses: this zone, or no zone set.
    // A guild whose logs are all older raids or Mythic+ isn't worth scanning.
    const usable = recent.filter((r) => !r.zone?.id || r.zone.id === zoneId);
    log(
      `${guild.name}: no reports in zone #${zoneId}${endTime ? ` before ${new Date(endTime).toISOString().slice(0, 10)}` : ''}; ` +
        `${anyZone.length ? `${anyZone.length} in any zone before that date` : `${recent.length} recent in any zone`} (${summary})` +
        `${usable.length ? `; scanning ${usable.length} that could hold these bosses.` : '; none from this raid, skipping (not logged publicly).'}`,
    );
    return usable;
  };

  // Mythic fights on the chosen bosses in one report (cached; reports older
  // than a day are final).
  const reportFights = async (report, encounterIds, settings) => {
    const cachePath = path.join(reportsDir, `${report.code}.json`);
    const cached = await readJson(cachePath, null);
    if (cached?.fights && cached.final) return cached;

    const data = await wcl.query(
      `query($code: String!, $diff: Int!) { reportData { report(code: $code) {
        startTime fights(difficulty: $diff) { id encounterID startTime endTime kill wipeCalledTime friendlyPlayers } } } }`,
      { code: report.code, diff: settings.difficulty },
    );
    const r = data.reportData?.report;
    const wanted = new Set(Object.values(encounterIds));
    const entry = {
      code: report.code,
      startTime: r?.startTime ?? report.startTime,
      endTime: report.endTime,
      final: Date.now() - report.endTime > DAY,
      fights: (r?.fights || []).filter((f) => wanted.has(f.encounterID)),
      analyses: cached?.analyses || {},
    };
    await writeJson(cachePath, entry);
    return entry;
  };

  const allEvents = async (code, field, args) => {
    const out = [];
    let start = null;
    for (let page = 0; page < 20; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const data = await wcl.query(
        `query($code: String!, $fights: [Int]!, $start: Float, $filter: String) { reportData { report(code: $code) {
          events(${args}, fightIDs: $fights, startTime: $start, filterExpression: $filter, limit: 10000) { data nextPageTimestamp } } } }`,
        { code, fights: field.fights, start, filter: field.filter || null },
      );
      const events = data.reportData?.report?.events;
      (events?.data || []).forEach((e) => out.push(e));
      if (!events?.nextPageTimestamp) break;
      start = events.nextPageTimestamp;
    }
    return out;
  };

  const debuffFilter = (boss) => {
    const names = boss.mechanics
      .filter((m) => m.kind === 'debuff')
      .flatMap((m) => m.abilities)
      .map((n) => JSON.stringify(n));
    return names.length ? `type = "applydebuff" and ability.name in (${names.join(', ')})` : null;
  };

  const analyzeReport = async (entry, boss, fightIds, encounterId, settings) => {
    const fightKey = crypto
      .createHash('sha1')
      .update(`${[...fightIds].sort().join(',')}|${JSON.stringify(boss)}|${settings.deathCutoff}`)
      .digest('hex');
    const cached = entry.analyses?.[boss.name];
    if (cached && cached.fightKey === fightKey) return cached.part;

    const fights = [...fightIds];
    const data = await wcl.query(
      `query($code: String!, $fights: [Int]!, $enc: Int!) { reportData { report(code: $code) {
        masterData { abilities { gameID name } actors(type: "Player") { id name server subType } }
        playerDetails(fightIDs: $fights, encounterID: $enc)
        deaths: events(dataType: Deaths, fightIDs: $fights, hostilityType: Friendlies, limit: 10000) { data nextPageTimestamp }
      } } }`,
      { code: entry.code, fights, enc: encounterId },
    );
    const report = data.reportData?.report || {};
    let deaths = report.deaths?.data || [];
    if (report.deaths?.nextPageTimestamp) {
      deaths = await allEvents(entry.code, { fights }, 'dataType: Deaths, hostilityType: Friendlies');
    }
    const hasDebuffs = boss.mechanics.some((m) => m.kind === 'debuff');
    const hasInterrupts = boss.mechanics.some((m) => m.kind === 'interrupt');
    const debuffs = hasDebuffs
      ? await allEvents(entry.code, { fights, filter: debuffFilter(boss) }, 'dataType: Debuffs, hostilityType: Friendlies')
      : [];
    const interrupts = hasInterrupts
      ? await allEvents(entry.code, { fights }, 'dataType: Interrupts')
      : [];

    const part = analyzeBossReport({
      boss,
      fights: entry.fights.filter((f) => fightIds.has(f.id)),
      actors: report.masterData?.actors || [],
      abilities: report.masterData?.abilities || [],
      specs: specsFromPlayerDetails(report.playerDetails),
      roles: rolesFromPlayerDetails(report.playerDetails),
      deaths,
      debuffs,
      interrupts,
      deathCutoff: settings.deathCutoff,
    });

    entry.analyses = { ...(entry.analyses || {}), [boss.name]: { fightKey, part } };
    await writeJson(path.join(reportsDir, `${entry.code}.json`), entry);
    return part;
  };

  // ---- Parses ---------------------------------------------------------------------

  const fetchParses = async (candidates, encounters, settings) => {
    const cache = await readJson(file('parses.json'), {});
    const stale = candidates.filter((c) => {
      const hit = cache[c.parseKey];
      return !hit || Date.now() - hit.at > 3 * DAY;
    });
    log(`Looking up parses for ${stale.length} raiders (${candidates.length - stale.length} cached).`);

    const bossEntries = Object.entries(encounters);
    for (let i = 0; i < stale.length; i += 6) {
      if (!status.running) break;
      const batch = stale.slice(i, i + 6);
      const fields = batch
        .map(
          (c, n) => `c${n}: character(name: ${JSON.stringify(c.name)}, serverSlug: ${JSON.stringify(serverSlug(c.server))}, serverRegion: ${JSON.stringify(settings.region.toUpperCase())}) {
            ${bossEntries.map(([, id], b) => `e${b}: encounterRankings(encounterID: ${id}, difficulty: ${settings.difficulty}, metric: dps)`).join('\n')}
          }`,
        )
        .join('\n');
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await wcl.query(`query { characterData { ${fields} } }`);
        batch.forEach((c, n) => {
          const character = data.characterData?.[`c${n}`];
          const byBoss = {};
          bossEntries.forEach(([bossName], b) => {
            byBoss[bossName] = character?.[`e${b}`] || null;
          });
          cache[c.parseKey] = { at: Date.now(), byBoss };
        });
      } catch (error) {
        log(`Parse lookup failed for ${batch.map((c) => c.name).join(', ')}: ${error.message}`);
      }
      // eslint-disable-next-line no-await-in-loop
      if (i % 60 === 0) await writeJson(file('parses.json'), cache);
    }
    await writeJson(file('parses.json'), cache);
    return cache;
  };

  // ---- The crawl ------------------------------------------------------------------

  const inGroup = (player, group) => {
    if (group.role) {
      return (player.role || roleForSpec(player.className, player.spec)) === group.role;
    }
    return (
      norm(player.className) === norm(group.className) &&
      (!group.specs?.length || group.specs.some((s) => norm(s) === norm(player.spec)))
    );
  };

  const run = async ({ guildLimit = 0 } = {}) => {
    if (status.running) return false;
    if (!wcl.configured) throw new Error('Warcraft Logs API credentials are not set on the server.');
    Object.assign(status, {
      running: true,
      phase: 'starting',
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      guildIndex: 0,
      guildCount: 0,
      currentGuild: null,
    });
    wcl.resume();

    try {
      const settings = await getSettings();
      log(`Crawl started${guildLimit ? ` (test: first ${guildLimit} guild${guildLimit === 1 ? '' : 's'})` : ''}.`);

      status.phase = 'encounters';
      const { zoneId, encounters } = await resolveEncounters(settings);
      log(`Zone ${zoneId}; bosses ${Object.entries(encounters).map(([n, id]) => `${n} (${id})`).join(', ')}.`);

      status.phase = 'guilds';
      let guilds = await fetchRaiderIoGuilds({
        raid: settings.raidSlug,
        region: settings.region,
        minRank: settings.minRank,
        maxRank: settings.maxRank,
        baseUrl: rioBaseUrl,
        log,
      });
      log(`Raider.IO: ${guilds.length} ${settings.region.toUpperCase()} guilds ranked ${settings.minRank}-${settings.maxRank} world.`);
      // A test crawl keeps trying guilds until one has public logs on these
      // bosses (up to 10 tries), instead of stopping at the first.
      if (guildLimit) guilds = guilds.slice(0, guildLimit + 9);
      status.guildCount = guilds.length;
      let guildsWithPulls = 0;

      const guildResults = [];
      const players = new Map(); // guild|playerKey -> candidate

      for (const guild of guilds) {
        if (!status.running) throw new Error('Stopped');
        if (guildLimit && guildsWithPulls >= guildLimit) break;
        status.guildIndex += 1;
        status.currentGuild = `${guild.name} (${guild.worldRank})`;
        status.phase = 'reports';
        try {
          // Skip farm: only reports up to the last of the first kills.
          const kills = settings.bosses.map((b) => guild.kills[b.rioSlug]?.firstDefeated).filter(Boolean);
          const allKilled = kills.length === settings.bosses.length;
          const endTime = allKilled
            ? Math.max(...kills.map((d) => Date.parse(d))) + 2 * DAY
            : null;

          // eslint-disable-next-line no-await-in-loop
          const guildId = await resolveGuild(guild);
          if (!guildId) {
            log(`${guild.name} (${guild.realm}): not found on Warcraft Logs, skipped.`);
            guildResults.push({ name: guild.name, realm: guild.realm, worldRank: guild.worldRank, error: 'Not found on Warcraft Logs' });
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          const reports = await findReports(guild, guildId, zoneId, endTime, settings);
          const entries = [];
          let sawBoss = false;
          let emptyRun = 0;
          for (const report of reports) {
            if (!status.running) throw new Error('Stopped');
            // eslint-disable-next-line no-await-in-loop
            const entry = await reportFights(report, encounters, settings);
            entries.push(entry);
            if (entry.fights.length) {
              sawBoss = true;
              emptyRun = 0;
            } else if (sawBoss && (emptyRun += 1) >= 6) {
              break; // Past the start of progression on these bosses.
            }
          }

          status.phase = 'pulls';
          const summary = {
            name: guild.name,
            realm: guild.realm,
            worldRank: guild.worldRank,
            regionRank: guild.regionRank,
            profileUrl: guild.profileUrl,
            reports: entries.length,
            bosses: {},
          };

          for (const boss of settings.bosses) {
            const encounterId = encounters[boss.name];
            const withBoss = entries
              .map((e) => ({
                code: e.code,
                reportStart: e.startTime,
                entry: e,
                fights: e.fights.filter((f) => f.encounterID === encounterId),
              }))
              .filter((e) => e.fights.length);
            const { selected, firstKill } = progressionFights(withBoss);
            let totals = null;
            for (const item of withBoss) {
              const ids = selected.get(item.code);
              if (!ids) continue;
              // eslint-disable-next-line no-await-in-loop
              const part = await analyzeReport(item.entry, boss, ids, encounterId, settings);
              totals = mergeBossTotals(totals, part);
            }
            if (!totals) continue;
            const averages = raidAverages(totals, boss);
            summary.bosses[boss.name] = {
              pulls: totals.pulls,
              firstKill,
              reports: [...selected.keys()],
            };

            Object.values(totals.players).forEach((p) => {
              const group = settings.specGroups.find((g) => inGroup(p, g));
              if (!group) return;
              const id = `${guild.name}|${p.key}`;
              const candidate = players.get(id) || {
                key: id,
                parseKey: p.key,
                name: p.name,
                server: p.server,
                className: p.className,
                spec: p.spec,
                role: p.role || roleForSpec(p.className, p.spec),
                group: group.label,
                guild: {
                  name: guild.name,
                  realm: guild.realm,
                  worldRank: guild.worldRank,
                  regionRank: guild.regionRank,
                  profileUrl: guild.profileUrl,
                },
                bosses: {},
              };
              candidate.bosses[boss.name] = {
                pulls: p.pulls,
                kills: p.kills,
                earlyDeaths: p.earlyDeaths,
                excusedDeaths: p.excusedDeaths,
                lateDeaths: p.lateDeaths,
                deathCauses: p.deathCauses,
                reports: [...selected.keys()].slice(0, 6),
                mechanics: Object.fromEntries(
                  boss.mechanics.map((m) => [
                    m.id,
                    {
                      ...(p.mechanics[m.id] || { count: 0, pulls: 0, pullsDone: 0 }),
                      raidAvg: averages[m.id],
                      label: m.label,
                      assignedShare: m.assignedShare || null,
                    },
                  ]),
                ),
              };
              players.set(id, candidate);
            });
          }
          guildResults.push(summary);
          if (Object.keys(summary.bosses).length) guildsWithPulls += 1;
          log(`${guild.name}: ${entries.length} reports, ${Object.entries(summary.bosses).map(([b, s]) => `${s.pulls} ${b} pulls`).join(', ') || 'no pulls on these bosses (private logs?)'}.`);
        } catch (error) {
          if (error.message === 'Stopped') throw error;
          log(`${guild.name}: skipped (${error.message}).`);
          guildResults.push({ name: guild.name, realm: guild.realm, worldRank: guild.worldRank, error: error.message });
        }
      }

      status.phase = 'parses';
      status.currentGuild = null;
      const candidates = [...players.values()];
      const parses = await fetchParses(candidates, encounters, settings);
      candidates.forEach((c) => {
        Object.keys(c.bosses).forEach((bossName) => {
          c.bosses[bossName].parse = parseSummary(parses[c.parseKey]?.byBoss?.[bossName], c.spec);
        });
      });

      await writeJson(file('results.json'), {
        generatedAt: Date.now(),
        test: Boolean(guildLimit),
        settings,
        zoneId,
        encounters,
        guilds: guildResults,
        candidates,
        points: { ...wcl.usage },
      });
      status.phase = 'done';
      log(`Done: ${candidates.length} candidates from ${guildResults.length} guilds; ${Math.round(wcl.usage.spentByUs)} points used, ${wcl.usage.queries} queries.`);
      return true;
    } catch (error) {
      status.error = error.message;
      status.phase = error.message === 'Stopped' ? 'stopped' : 'failed';
      log(`Crawl ${status.phase}: ${error.message}`);
      return false;
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
      await writeJson(file('last-run.json'), {
        startedAt: status.startedAt,
        finishedAt: status.finishedAt,
        phase: status.phase,
        error: status.error,
      }).catch(() => {});
    }
  };

  const stop = () => {
    if (!status.running) return;
    log('Stopping...');
    status.running = false;
    wcl.stop();
  };

  return {
    run,
    stop,
    status,
    getSettings,
    saveSettings,
    results: () => readJson(file('results.json'), null),
    lastRun: () => readJson(file('last-run.json'), null),
  };
};
