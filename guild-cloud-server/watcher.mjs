// Top-guild watcher: 1-3 guilds that log publicly on Warcraft Logs, crawled
// for their Mythic progression on the current raid (every pull up to and
// including each boss's first kill), so the Pull desk's Progression view can
// draw their curve next to ours.
//
// It is "frozen" by default: no automatic crawls until an officer unfreezes
// it at the start of a tier. "Crawl now" always works, for testing.
//
// Routes, under /api/guild/<guild>/pulldesk/watcher:
//   GET  (none)     settings, crawl status and results
//   PUT  settings   officers: { guilds, zoneName, frozen }
//   POST crawl      officers: start a crawl
//   POST stop       officers: stop it
//
// Stored in <storage>/watcher/ (settings.json, results.json, reports/).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { createWclClient } from './recruit-clients.mjs';
import { serverSlug } from './recruit-analyze.mjs';

const DAY = 24 * 60 * 60 * 1000;
const MAX_GUILDS = 3;
const MAX_REPORT_PAGES = 12; // 25 reports a page
const NIGHT_CUTOFF_HOURS = 6;

export const DEFAULT_WATCHER_SETTINGS = {
  zoneName: 'The Venomous Abyss',
  difficulty: 5, // Mythic
  guilds: [], // [{ name, realm, region }]
  frozen: true,
  autoCrawlHour: 6, // server local time, when not frozen
};

// fightPercentage is 0-100 in API v2; older data used hundredths (0-10000).
const toPercent = (value) => {
  const v = Number(value ?? 100);
  return Math.round((v > 100 ? v / 100 : v) * 10) / 10;
};

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The raid night a pull belongs to (pulls after midnight count as the night
// before), in UTC, which is close enough for a comparison chart.
const nightOf = (at) => new Date(at - NIGHT_CUTOFF_HOURS * 3600000).toISOString().slice(0, 10);

/**
 * Turn a guild's report fights into per-boss progression: every pull in
 * time order up to and including the first kill.
 * @param {{ startTime: number, fights: { encounterID, startTime, endTime, kill, fightPercentage }[] }[]} reports
 * @param {Record<number, string>} encounterNames
 */
export const buildProgress = (reports, encounterNames) => {
  const pulls = [];
  reports.forEach((report) => {
    (report.fights || []).forEach((fight) => {
      pulls.push({
        encounterId: fight.encounterID,
        at: report.startTime + fight.startTime,
        duration: Math.round((fight.endTime - fight.startTime) / 1000),
        kill: Boolean(fight.kill),
        // Boss health left when the pull ended, 0-100 (whole-fight progress
        // on multi-phase bosses).
        percent: fight.kill ? 0 : toPercent(fight.fightPercentage),
      });
    });
  });
  // The same pull can appear in two reports (two loggers): keep one.
  pulls.sort((a, b) => a.at - b.at);
  const unique = pulls.filter(
    (p, i) => !pulls.slice(Math.max(0, i - 3), i).some((q) => q.encounterId === p.encounterId && Math.abs(q.at - p.at) < 20000),
  );

  const bosses = {};
  unique.forEach((p) => {
    const boss = (bosses[p.encounterId] ??= {
      encounterId: p.encounterId,
      name: encounterNames[p.encounterId] || String(p.encounterId),
      series: [],
      kill: null,
    });
    if (boss.kill) return; // farm after the first kill
    const n = boss.series.length + 1;
    boss.series.push({ n, at: p.at, night: nightOf(p.at), percent: p.percent, kill: p.kill });
    if (p.kill) boss.kill = { pull: n, at: p.at, night: nightOf(p.at) };
  });
  Object.values(bosses).forEach((boss) => {
    boss.pulls = boss.series.length;
    boss.nights = new Set(boss.series.map((s) => s.night)).size;
    boss.best = boss.kill ? 0 : Math.min(...boss.series.map((s) => s.percent));
  });
  return bosses;
};

export const createWatcher = ({ storage, readBody, json, fail, memberRoleNames, env, fetchImpl }) => {
  const dir = path.join(storage, 'watcher');
  const file = (name) => path.join(dir, name);
  const officerRoles = String(env.GUILD_CLOUD_COACH_OFFICER_ROLES ?? 'Officer')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const status = { running: false, startedAt: null, finishedAt: null, log: [], error: '' };
  const log = (message) => {
    status.log.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
    if (status.log.length > 300) status.log.splice(0, status.log.length - 300);
  };

  const wcl = createWclClient({
    clientId: env.GUILD_CLOUD_WCL_CLIENT_ID || '',
    clientSecret: env.GUILD_CLOUD_WCL_CLIENT_SECRET || '',
    baseUrl: env.GUILD_CLOUD_WCL_URL || undefined,
    log,
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  const readJson = async (name, fallback) => {
    try {
      return JSON.parse(await fsp.readFile(name, 'utf8'));
    } catch {
      return fallback;
    }
  };
  const writeJson = async (name, value) => {
    await fsp.mkdir(path.dirname(name), { recursive: true });
    await fsp.writeFile(`${name}.tmp`, JSON.stringify(value));
    await fsp.rename(`${name}.tmp`, name);
  };

  const getSettings = async () => ({ ...DEFAULT_WATCHER_SETTINGS, ...(await readJson(file('settings.json'), {})) });

  const isOfficer = async (req) => {
    if (!officerRoles.length) return true;
    const names = await memberRoleNames(req.cloudUserId);
    return Boolean(names?.some((name) => officerRoles.includes(name)));
  };

  const resolveZone = async (settings) => {
    const data = await wcl.query('query { worldData { zones { id name encounters { id name } } } }');
    const zone = (data.worldData?.zones || [])
      .filter((z) => norm(z.name) === norm(settings.zoneName))
      .sort((a, b) => b.id - a.id)[0];
    if (!zone) throw new Error(`Warcraft Logs has no zone called "${settings.zoneName}".`);
    return zone;
  };

  const resolveGuild = async (guild) => {
    const region = String(guild.region || 'us').toUpperCase();
    const slugs = [...new Set([serverSlug(guild.realm), String(guild.realm || '').toLowerCase().replace(/\s+/g, '-')].filter(Boolean))];
    for (const slug of slugs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await wcl.query(
          `query($name: String!, $slug: String!, $region: String!) {
            guildData { guild(name: $name, serverSlug: $slug, serverRegion: $region) { id name } } }`,
          { name: guild.name, slug, region },
          { quiet: true },
        );
        if (data.guildData?.guild?.id) return data.guildData.guild.id;
      } catch (error) {
        if (error.message === 'Stopped') throw error;
      }
    }
    return null;
  };

  const guildReports = async (guildId, zoneId) => {
    const reports = [];
    for (let page = 1; page <= MAX_REPORT_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const data = await wcl.query(
        `query($guild: Int!, $zone: Int!, $page: Int!) {
          reportData { reports(guildID: $guild, zoneID: $zone, limit: 25, page: $page) {
            has_more_pages data { code startTime endTime } } } }`,
        { guild: guildId, zone: zoneId, page },
      );
      const result = data.reportData?.reports;
      (result?.data || []).forEach((r) => reports.push(r));
      if (!result?.has_more_pages) break;
    }
    return reports;
  };

  const reportFights = async (report, difficulty) => {
    const cachePath = file(path.join('reports', `${report.code}.json`));
    const cached = await readJson(cachePath, null);
    if (cached?.final) return cached;
    const data = await wcl.query(
      `query($code: String!, $diff: Int!) { reportData { report(code: $code) {
        startTime fights(difficulty: $diff) { encounterID startTime endTime kill fightPercentage } } } }`,
      { code: report.code, diff: difficulty },
    );
    const r = data.reportData?.report;
    const entry = {
      code: report.code,
      startTime: r?.startTime ?? report.startTime,
      final: Date.now() - report.endTime > DAY,
      fights: (r?.fights || []).filter((f) => f.encounterID > 0),
    };
    await writeJson(cachePath, entry);
    return entry;
  };

  const crawl = async () => {
    if (status.running) return;
    Object.assign(status, { running: true, startedAt: Date.now(), finishedAt: null, log: [], error: '' });
    wcl.resume();
    try {
      if (!wcl.configured) throw new Error('Set GUILD_CLOUD_WCL_CLIENT_ID and GUILD_CLOUD_WCL_CLIENT_SECRET in .env.');
      const settings = await getSettings();
      if (!settings.guilds.length) throw new Error('Add a guild to watch first.');
      const zone = await resolveZone(settings);
      const names = Object.fromEntries((zone.encounters || []).map((e) => [e.id, e.name]));
      log(`${zone.name} (#${zone.id}): ${Object.keys(names).length} bosses.`);

      const previous = await readJson(file('results.json'), { guilds: [] });
      const guilds = [];
      for (const guild of settings.guilds) {
        // eslint-disable-next-line no-await-in-loop
        const id = await resolveGuild(guild);
        const label = `${guild.name}-${guild.realm} (${String(guild.region).toUpperCase()})`;
        if (!id) {
          log(`${label}: not found on Warcraft Logs. Check the name, realm and region.`);
          const old = previous.guilds.find((g) => norm(g.name) === norm(guild.name) && norm(g.realm) === norm(guild.realm));
          if (old) guilds.push(old);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const reports = await guildReports(id, zone.id);
        log(`${label}: ${reports.length} reports in ${zone.name}.`);
        const withFights = [];
        for (const report of reports) {
          // eslint-disable-next-line no-await-in-loop
          withFights.push(await reportFights(report, settings.difficulty));
        }
        const bosses = buildProgress(withFights, names);
        const killed = Object.values(bosses).filter((b) => b.kill).length;
        log(`${label}: ${Object.keys(bosses).length} bosses pulled, ${killed} killed.`);
        guilds.push({ ...guild, guildId: id, updatedAt: Date.now(), bosses });
      }
      await writeJson(file('results.json'), { zone: { id: zone.id, name: zone.name }, updatedAt: Date.now(), guilds });
      log(`Done. ${wcl.usage.spentByUs.toFixed(0)} points used.`);
    } catch (error) {
      status.error = error.message;
      log(`Stopped: ${error.message}`);
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
    }
  };

  // Daily crawl while not frozen.
  let lastAutoDay = '';
  const timer = setInterval(async () => {
    const settings = await getSettings();
    const now = new Date();
    const day = now.toDateString();
    if (settings.frozen || !settings.guilds.length || settings.autoCrawlHour < 0) return;
    if (now.getHours() !== settings.autoCrawlHour || lastAutoDay === day) return;
    lastAutoDay = day;
    crawl();
  }, 5 * 60 * 1000);
  timer.unref?.();

  const validate = (body, current) => {
    const next = { ...current };
    if (body.zoneName !== undefined) {
      const zoneName = String(body.zoneName).trim().slice(0, 100);
      if (!zoneName) throw new Error('Zone name is required');
      next.zoneName = zoneName;
    }
    if (body.frozen !== undefined) next.frozen = Boolean(body.frozen);
    if (body.autoCrawlHour !== undefined) {
      const hour = Number(body.autoCrawlHour);
      if (!Number.isInteger(hour) || hour < -1 || hour > 23) throw new Error('Crawl hour must be -1 to 23');
      next.autoCrawlHour = hour;
    }
    if (body.guilds !== undefined) {
      if (!Array.isArray(body.guilds) || body.guilds.length > MAX_GUILDS) {
        throw new Error(`Watch up to ${MAX_GUILDS} guilds`);
      }
      next.guilds = body.guilds.map((g) => {
        const name = String(g?.name || '').trim().slice(0, 80);
        const realm = String(g?.realm || '').trim().slice(0, 80);
        const region = String(g?.region || 'us').trim().toLowerCase();
        if (!name || !realm) throw new Error('Each guild needs a name and realm');
        if (!['us', 'eu', 'kr', 'tw', 'cn'].includes(region)) throw new Error(`Unknown region "${region}"`);
        return { name, realm, region };
      });
    }
    return next;
  };

  const handle = async (req, res, rest) => {
    const [first] = rest;
    if (!first && req.method === 'GET') {
      const results = await readJson(file('results.json'), { guilds: [] });
      return json(res, 200, {
        settings: await getSettings(),
        officer: await isOfficer(req),
        configured: wcl.configured,
        status: { ...status, log: status.log.slice(-60) },
        usage: wcl.usage,
        results,
      });
    }
    if (!(await isOfficer(req))) return fail(res, 403, 'Only officers can change the guild watcher');
    if (first === 'settings' && req.method === 'PUT') {
      try {
        const next = validate(await readBody(req, 64 * 1024), await getSettings());
        await writeJson(file('settings.json'), next);
        return json(res, 200, next);
      } catch (error) {
        return fail(res, 400, error.message);
      }
    }
    if (first === 'crawl' && req.method === 'POST') {
      if (status.running) return fail(res, 409, 'A crawl is already running');
      crawl();
      return json(res, 200, { started: true });
    }
    if (first === 'stop' && req.method === 'POST') {
      wcl.stop();
      return json(res, 200, { stopping: true });
    }
    return fail(res, 404, 'Unknown watcher route');
  };

  return { handle, crawl, status };
};
