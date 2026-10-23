// Pull desk: the server side of per-pull wipe reports.
//
// Flow for one pull:
//   1. When a raid encounter ends, every raider's app POSTs /claim. The first
//      one is told to upload; the rest are told it's already handled.
//   2. That app PUTs the pull's filtered, gzipped combat log to /pulls/:id/log.
//   3. This server analyzes it (pulldesk-analyze.mjs), stores the report,
//      and posts a summary to the boss's Discord channel.
//
// Everything lives under <storage>/pulldesk/:
//   index.json         pull summaries + per-boss settings (note, avoidable
//                      spells, Discord channel)
//   reports/<id>.json  full reports
//   logs/<id>.log.gz   uploaded log slices, kept LOG_RETENTION_DAYS so reports
//                      can be recomputed after a note or avoidable list change

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { analyzePull, formatTime, METERS_LINE_PREFIX, parseNote } from './pulldesk-analyze.mjs';
import { abilityStats, summarizeNight, summarizeProgression, wipeCause } from './pulldesk-summary.mjs';
import { createJournal, journalAbilities, norm } from './journal.mjs';
import { fetchReportExtras, fetchReportPulls, reportCode } from './pulldesk-import.mjs';
import { createWclClient } from './recruit-clients.mjs';
import { serverSlug } from './recruit-analyze.mjs';
import { buildPrep, RAID_BUFFS, rawPrep } from './consumables.mjs';

// Bump to refetch extras (consumables, avoidable hits) for imported pulls.
const WCL_EXTRAS_VERSION = 2;

// Bump to recheck old pulls (with logs still kept) for new report fields.
const PREP_VERSION = 3;
const KNOWN_AURAS = new Set(RAID_BUFFS.flatMap((b) => b.ids));

const MAX_LOG_BYTES = 40 * 1024 * 1024; // gzipped upload
const MAX_LOG_TEXT_BYTES = 400 * 1024 * 1024; // after gunzip
const CLAIM_MATCH_SECONDS = 120; // claims this close together are one pull
const CLAIM_DURATION_SLACK = 3; // seconds of disagreement on pull length
const CLAIM_STALE_MS = 60 * 1000; // a chosen uploader that never uploaded
// Raiders' apps claim a pull within a second or two of each other. Wait this
// long, then pick the one with the most complete log (most kept lines):
// someone who disconnected or stood far away has a partial log.
const CLAIM_WINDOW_MS = 3000;
const NIGHT_CUTOFF_HOURS = 6; // pulls before 6am count as the night before
// A claim with no log after this long never got one (nobody uploading): it
// still counts in the summaries, from what the claim said.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// An imported pull within this of an existing one is the same pull.
const IMPORT_MATCH_MS = 60 * 1000;
const MAX_IMPORT_REPORTS = 10;
// Several raiders' apps may backfill the same night: the first gets the
// pull for this long, the rest skip it (and retry later if it never lands).
const BACKFILL_LOCK_MS = 5 * 60 * 1000;
const MAX_BACKFILL_CHECK = 500;
const MAX_NOTE_CHARS = 100 * 1024;

// 233 is flex Mythic (raids like Kith'ix whose Mythic takes 10-30 players):
// tracked and labelled as Mythic.
const DIFFICULTY_NAMES = { 14: 'normal', 15: 'heroic', 16: 'mythic', 17: 'lfr', 233: 'mythic' };

const parseChannelMap = (value) => {
  const map = {};
  for (const pair of String(value || '').split(',')) {
    const [encounterId, channelId] = pair.split(':').map((part) => part.trim());
    if (/^\d+$/.test(encounterId) && /^\d+$/.test(channelId || '')) {
      map[encounterId] = channelId;
    }
  }
  return map;
};

const nightOf = (ms) => {
  const date = new Date(ms - NIGHT_CUTOFF_HOURS * 60 * 60 * 1000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const readRawBody = async (req, maxBytes) => {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Progression = every pull up to and including the first kill on each
 * difficulty (in all recorded history, Warcraft Logs imports included);
 * reclears = everything after. `killedBefore` (a boss setting) makes it
 * all reclears.
 */
export const splitAtFirstKill = (pulls, killedBefore) => {
  const ordered = [...pulls].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  if (killedBefore) return { progression: [], reclear: ordered };
  const firstKill = new Map();
  ordered.forEach((pull) => {
    if (pull.result === 'kill' && !firstKill.has(pull.difficultyId)) firstKill.set(pull.difficultyId, pull.startedAt || 0);
  });
  const progression = [];
  const reclear = [];
  ordered.forEach((pull) => {
    const kill = firstKill.get(pull.difficultyId);
    (kill === undefined || (pull.startedAt || 0) <= kill ? progression : reclear).push(pull);
  });
  return { progression, reclear };
};

/**
 * @param {object} options
 * @param {string} options.storage        the guild cloud storage directory
 * @param {Function} options.readBody     server.mjs JSON body reader
 * @param {Function} options.json         server.mjs JSON responder
 * @param {Function} options.fail         server.mjs error responder
 * @param {(discordId: string) => Promise<string[]|null>} options.memberRoleNames
 * @param {string} options.botToken       Discord bot token, for channel posts
 * @param {object} options.env            process.env
 */
export const createPullDesk = (options) => {
  const { readBody, json, fail, memberRoleNames, botToken, env } = options;
  // Central permission check (permissions.mjs); without it, the .env roles.
  const can = options.can || null;
  const dir = path.join(options.storage, 'pulldesk');
  const indexFile = path.join(dir, 'index.json');
  const reportFile = (id) => path.join(dir, 'reports', `${id}.json`);
  // Meters live in their own file: summaries read many reports, and the
  // meters are the bulk of one.
  const metersFile = (id) => path.join(dir, 'meters', `${id}.json`);
  const logFile = (id) => path.join(dir, 'logs', `${id}.log.gz`);

  // Blizzard's Encounter Journal, for the Journal view and ability cards.
  const journal = options.journal || createJournal({ storage: options.storage, env });

  // Warcraft Logs, for importing pulls the app didn't capture.
  const wcl = options.wcl ||
    createWclClient({
      clientId: env.GUILD_CLOUD_WCL_CLIENT_ID || '',
      clientSecret: env.GUILD_CLOUD_WCL_CLIENT_SECRET || '',
      baseUrl: env.GUILD_CLOUD_WCL_URL || undefined,
    });

  const trackedDifficulties = new Set(
    String(env.GUILD_CLOUD_PULLDESK_DIFFICULTIES ?? 'mythic')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  // Who can edit notes, avoidable spells and channels. Defaults to the live
  // viewer roles, which already means "raider+ and officers" here.
  const editorRoles = String(
    env.GUILD_CLOUD_PULLDESK_EDITOR_ROLES ?? env.GUILD_CLOUD_LIVE_VIEWER_ROLES ?? 'Raider+,Officer',
  )
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  const envChannels = parseChannelMap(env.GUILD_CLOUD_PULLDESK_CHANNELS);
  const defaultChannel = String(env.GUILD_CLOUD_PULLDESK_DEFAULT_CHANNEL || '').trim();
  // Per-pull Discord posts are off by default: the app's Pull desk page has
  // the detail, and Discord gets the nightly summary and coaching clips.
  const postPulls = /^(1|true|yes|on)$/i.test(String(env.GUILD_CLOUD_PULLDESK_POST_PULLS || '').trim());
  const logRetentionDays = Number.parseFloat(env.GUILD_CLOUD_PULLDESK_LOG_DAYS || '30');
  // Only overridden by tests.
  const discordApi = env.GUILD_CLOUD_PULLDESK_DISCORD_API || 'https://discord.com/api/v10';

  // Guild-wide analysis settings (editable by the owner in the admin view).
    // Midnight's combat potions, by spell name (every quality and the
  // cauldron version share it). Kept in code; a saved list adds to it.
  const COMBAT_POTIONS = [
    "Light's Potential",
    'Potion of Recklessness',
    'Potion of Zealotry',
    'Draught of Rampant Abandon',
    // Patch 12.1. Liquid Luster's buff is called Lustrous Gleam (a pre-pot).
    'Liquid Luster',
    'Lustrous Gleam',
    'Alluring Nostrum',
  ];
  const DEFAULT_SETTINGS = { combatPotions: COMBAT_POTIONS };
  let index = { pulls: [], bosses: {}, settings: { ...DEFAULT_SETTINGS } };
  let saveQueue = Promise.resolve();
  let loaded = null;

  const load = async () => {
    await fsp.mkdir(path.join(dir, 'reports'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'logs'), { recursive: true });
    try {
      const parsed = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
      index = {
        pulls: Array.isArray(parsed.pulls) ? parsed.pulls : [],
        bosses: parsed.bosses && typeof parsed.bosses === 'object' ? parsed.bosses : {},
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) },
      };
      index.settings.combatPotions = [
        ...new Set([...COMBAT_POTIONS, ...(Array.isArray(index.settings.combatPotions) ? index.settings.combatPotions : [])]),
      ];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };

  const ready = () => {
    loaded ??= load().then(() => {
      const n = recheckForPrep();
      if (n) console.info(`[pulldesk] Rechecking ${n} pulls for consumables`);
      const w = queueWclExtras((pull) => (pull.wclExtras || 0) < WCL_EXTRAS_VERSION, true);
      if (w) console.info(`[pulldesk] Fetching consumables and avoidable hits for ${w} imported pulls`);
    });
    return loaded;
  };

  // Summaries read many reports; cache them until the index changes.
  let indexVersion = 0;
  const summaryCache = new Map();
  const cached = async (key, build) => {
    const hit = summaryCache.get(key);
    if (hit && hit.version === indexVersion) return hit.data;
    const data = await build();
    summaryCache.set(key, { version: indexVersion, data });
    if (summaryCache.size > 50) summaryCache.delete(summaryCache.keys().next().value);
    return data;
  };
  const withReports = (pulls) =>
    Promise.all(
      pulls.map(async (pull) => {
        let report = null;
        if (pull.status === 'ready') {
          try {
            report = JSON.parse(await fsp.readFile(reportFile(pull.id), 'utf8'));
          } catch {
            report = null;
          }
        }
        return { summary: summaryOf(pull), report };
      }),
    );

  const persist = () => {
    indexVersion += 1;
    const snapshot = JSON.stringify(index);
    const temp = `${indexFile}.${process.pid}.tmp`;
    saveQueue = saveQueue
      .then(async () => {
        await fsp.writeFile(temp, snapshot, 'utf8');
        await fsp.rename(temp, indexFile);
      })
      .catch((error) => console.error('[pulldesk] Failed to save index', error));
    return saveQueue;
  };

  const bossSettings = (encounterId) => {
    const key = String(encounterId);
    index.bosses[key] ??= { note: '', avoidable: [], channelId: '' };
    return index.bosses[key];
  };

  const canView = async (req) => (can ? can(req, 'analysisView') : true);
  // Owner-only tools (whole-tier import). Without the permissions module
  // (tests), editors.
  const ownerOnly = async (req) =>
    options.isOwner ? options.isOwner(req.cloudUserId) && !req.headers?.['x-view-as-role'] : canEdit(req);
  const canEdit = async (req) => {
    if (can) return can(req, 'analysisEdit');
    if (editorRoles.length === 0) return true;
    const names = await memberRoleNames(req.cloudUserId);
    return Boolean(names?.some((name) => editorRoles.includes(name)));
  };

  const summaryOf = (pull) => ({
    id: pull.id,
    encounterId: pull.encounterId,
    encounterName: pull.encounterName,
    difficultyId: pull.difficultyId,
    night: pull.night,
    pullNumber: pull.pullNumber,
    totalPullNumber: pull.totalPullNumber,
    createdAt: pull.createdAt,
    startedAt: pull.startedAt,
    uploadedBy: pull.uploadedBy || null,
    status: pull.status,
    result: pull.result,
    duration: pull.duration,
    bossPercent: pull.bossPercent,
    deaths: pull.deaths ?? null,
    wipeText: pull.wipeText ?? null,
    plan: pull.plan ?? null,
    avoidableHits: pull.avoidableHits ?? null,
    error: pull.error || null,
    source: pull.source || 'app',
  });

  // Pulls the summaries count: analyzed ones, imported ones, and claims that
  // never got a log (from what the claim said).
  const countedPulls = () => {
    const now = Date.now();
    return index.pulls.filter(
      (pull) => pull.status !== 'claimed' || now - pull.createdAt > STALE_CLAIM_MS,
    );
  };

  // Pull numbers in time order for one boss and difficulty, per night and
  // overall. Needed after an import fills in earlier pulls.
  const renumber = (encounterId, difficultyId) => {
    const pulls = index.pulls
      .filter((p) => p.encounterId === encounterId && p.difficultyId === difficultyId)
      .sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt));
    const perNight = {};
    pulls.forEach((p, i) => {
      perNight[p.night] = (perNight[p.night] || 0) + 1;
      p.pullNumber = perNight[p.night];
      p.totalPullNumber = i + 1;
    });
  };

  // A pull uploaded later from a raider's saved combat log (the app's
  // "Upload from combat log"). Placed by its real start time; returns the
  // pull to upload to, or upload: false if it already has a log.
  const backfill = async (req, res) => {
    const body = await readBody(req, 16 * 1024);
    const encounterId = Number(body.encounterId);
    const difficultyId = Number(body.difficultyId);
    const startedAt = Number(body.startedAt);
    const duration = Number(body.duration);
    if (
      !Number.isInteger(encounterId) ||
      !Number.isInteger(difficultyId) ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(duration) ||
      startedAt > Date.now() + 60000
    ) {
      return fail(res, 400, 'Invalid pull');
    }
    if (!trackedDifficulties.has(DIFFICULTY_NAMES[difficultyId])) {
      return json(res, 200, { skip: true });
    }
    const bossPercent = Number.isFinite(Number(body.bossPercent)) ? Number(body.bossPercent) : null;
    let pull = index.pulls.find(
      (p) =>
        p.encounterId === encounterId &&
        p.difficultyId === difficultyId &&
        Math.abs((p.startedAt ?? p.createdAt) - startedAt) <= IMPORT_MATCH_MS,
    );
    if (pull?.hasLog && pull.appMeters) return json(res, 200, { pullId: pull.id, upload: false });
    const who = String(req.cloudUserId || req.cloudUserName);
    if (pull && pull.backfillBy && pull.backfillBy !== who && Date.now() - (pull.backfillAt || 0) < BACKFILL_LOCK_MS) {
      return json(res, 200, { pullId: pull.id, upload: false, busy: true });
    }

    if (!pull) {
      pull = {
        id: `${Math.round(startedAt).toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
        encounterId,
        encounterName: String(body.encounterName || `Encounter ${encounterId}`).slice(0, 100),
        difficultyId,
        night: nightOf(startedAt),
        createdAt: startedAt,
        startedAt,
        claimDuration: duration,
        candidates: {},
        chosen: null,
        hasLog: false,
        result: body.result ? 'kill' : 'wipe',
        duration,
        bossPercent: body.result ? 0 : bossPercent,
        appBossPercent: body.result ? 0 : bossPercent,
        status: 'claimed',
      };
      index.pulls.push(pull);
      index.pulls.sort((a, b) => a.createdAt - b.createdAt);
      renumber(encounterId, difficultyId);
    } else if (pull.appBossPercent == null && bossPercent !== null && !body.result) {
      pull.appBossPercent = bossPercent;
    }
    pull.backfillBy = who;
    pull.backfillAt = Date.now();
    await persist();
    return json(res, 200, { pullId: pull.id, upload: true });
  };

  // Which of these pulls (from a raider's saved log) does the server still
  // need a log for? Lets the app's automatic backfill upload only those.
  const backfillCheck = async (req, res) => {
    const body = await readBody(req, 256 * 1024);
    const pulls = Array.isArray(body?.pulls) ? body.pulls.slice(0, MAX_BACKFILL_CHECK) : [];
    const who = String(req.cloudUserId || req.cloudUserName);
    const now = Date.now();
    const missing = [];
    pulls.forEach((item, i) => {
      const encounterId = Number(item?.encounterId);
      const difficultyId = Number(item?.difficultyId);
      const startedAt = Number(item?.startedAt);
      if (!trackedDifficulties.has(DIFFICULTY_NAMES[difficultyId]) || !Number.isFinite(startedAt)) return;
      const pull = index.pulls.find(
        (p) =>
          p.encounterId === encounterId &&
          p.difficultyId === difficultyId &&
          Math.abs((p.startedAt ?? p.createdAt) - startedAt) <= IMPORT_MATCH_MS,
      );
      // Has a log and the app's meters: nothing to send.
      if (pull?.hasLog && pull.appMeters) return;
      // Another raider's app is sending it right now.
      if (pull?.backfillBy && pull.backfillBy !== who && now - (pull.backfillAt || 0) < BACKFILL_LOCK_MS) return;
      // A live pull still in its claim window: the live upload will come.
      if (pull && pull.status === 'claimed' && now - pull.createdAt < STALE_CLAIM_MS) return;
      missing.push(i);
    });
    return json(res, 200, { missing });
  };

  const importReports = async (codes) => {
    if (!wcl.configured) {
      throw Object.assign(new Error('Set GUILD_CLOUD_WCL_CLIENT_ID and GUILD_CLOUD_WCL_CLIENT_SECRET in the server .env (same as recruiting).'), { status: 400 });
    }
    const gameDifficulties = new Set(
      Object.entries(DIFFICULTY_NAMES)
        .filter(([, name]) => trackedDifficulties.has(name))
        .map(([id]) => Number(id)),
    );
    const results = [];
    const touched = new Set();
    for (const code of codes) {
      let fetched;
      try {
        // eslint-disable-next-line no-await-in-loop
        fetched = await fetchReportPulls(wcl, code, gameDifficulties);
      } catch (error) {
        results.push({ code, error: error.message });
        continue;
      }
      let added = 0;
      let skipped = 0;
      let filled = 0;
      for (const item of fetched.pulls) {
        // Warcraft Logs calls flex Mythic plain Mythic: keep it with the
        // app's own pulls of that boss (difficulty 233).
        if (item.difficultyId === 16 && index.pulls.some((p) => p.encounterId === item.encounterId && p.difficultyId === 233)) {
          item.difficultyId = 233;
          item.report.difficultyId = 233;
        }
        const same = index.pulls.find(
          (p) =>
            p.encounterId === item.encounterId &&
            p.difficultyId === item.difficultyId &&
            Math.abs((p.startedAt ?? p.createdAt) - item.startedAt) <= IMPORT_MATCH_MS,
        );
        // Already here with a report (from the app, or imported before).
        if (same && same.status !== 'claimed') {
          skipped += 1;
          continue;
        }
        const pull = same || {
          id: `${item.startedAt.toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
          candidates: {},
          chosen: null,
          hasLog: false,
        };
        Object.assign(pull, {
          encounterId: item.encounterId,
          encounterName: item.encounterName,
          difficultyId: item.difficultyId,
          night: nightOf(item.startedAt),
          createdAt: same?.createdAt ?? item.startedAt,
          startedAt: item.startedAt,
          result: item.result,
          // The app's boss % (phases, rebirths) wins if a claim had one.
          bossPercent: same?.appBossPercent ?? item.bossPercent,
          duration: item.duration,
          deaths: item.report.deaths.length,
          wipeText: null,
          status: 'ready',
          source: 'wcl',
          uploadedBy: 'Warcraft Logs',
          error: null,
        });
        // eslint-disable-next-line no-await-in-loop
        await fsp.writeFile(
          reportFile(pull.id),
          JSON.stringify({ ...item.report, id: pull.id, night: pull.night, startedAt: pull.startedAt, bossPercent: pull.bossPercent }),
        );
        if (same) filled += 1;
        else {
          index.pulls.push(pull);
          added += 1;
        }
        touched.add(`${item.encounterId}:${item.difficultyId}`);
      }
      const bosses = [...new Set(fetched.pulls.map((p) => p.encounterName))];
      results.push({ code, title: fetched.title, bosses, added, filled, skipped });
    }
    touched.forEach((key) => {
      const [encounterId, difficultyId] = key.split(':').map(Number);
      renumber(encounterId, difficultyId);
    });
    index.pulls.sort((a, b) => a.createdAt - b.createdAt);
    await persist();
    // Then consumables and avoidable hits for the new ones.
    queueWclExtras((pull) => (pull.wclExtras || 0) < WCL_EXTRAS_VERSION, true);
    return results;
  };

  // ---- Whole-tier import from Warcraft Logs ----------------------------------

  // The guild's reports on Warcraft Logs, grouped by raid zone.
  const guildReportsByZone = async ({ name, realm, region, months }) => {
    if (!wcl.configured) {
      throw Object.assign(new Error('Set GUILD_CLOUD_WCL_CLIENT_ID and GUILD_CLOUD_WCL_CLIENT_SECRET in the server .env (same as recruiting).'), { status: 400 });
    }
    const slugs = [...new Set([serverSlug(realm), String(realm || '').toLowerCase().replace(/\s+/g, '-')].filter(Boolean))];
    let guildId = null;
    for (const slug of slugs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await wcl.query(
          `query($name: String!, $slug: String!, $region: String!) {
            guildData { guild(name: $name, serverSlug: $slug, serverRegion: $region) { id } } }`,
          { name, slug, region: String(region || 'us').toUpperCase() },
        );
        guildId = data.guildData?.guild?.id || null;
      } catch {
        guildId = null;
      }
      if (guildId) break;
    }
    if (!guildId) {
      throw Object.assign(new Error(`${name}-${realm} (${String(region).toUpperCase()}) isn't on Warcraft Logs. Check the realm and region.`), { status: 404 });
    }
    const since = Date.now() - Math.min(Math.max(Number(months) || 4, 1), 12) * 30 * 86400000;
    const zones = new Map();
    for (let page = 1; page <= 40; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const data = await wcl.query(
        `query($guild: Int!, $start: Float!, $page: Int!) {
          reportData { reports(guildID: $guild, startTime: $start, limit: 100, page: $page) {
            has_more_pages data { code title startTime zone { id name } } } } }`,
        { guild: guildId, start: since, page },
      );
      const result = data.reportData?.reports;
      (result?.data || []).forEach((r) => {
        if (!r.zone?.id) return;
        const z = zones.get(r.zone.id) || { zoneId: r.zone.id, zoneName: r.zone.name, codes: [], first: r.startTime, last: r.startTime };
        z.codes.push(r.code);
        z.first = Math.min(z.first, r.startTime);
        z.last = Math.max(z.last, r.startTime);
        zones.set(r.zone.id, z);
      });
      if (!result?.has_more_pages) break;
    }
    return [...zones.values()].sort((a, b) => b.last - a.last);
  };

  // One import at a time, in the background; the app polls its progress.
  let tierJob = { running: false, total: 0, done: 0, added: 0, skipped: 0, errors: [], finishedAt: null };
  const startTierImport = (codes) => {
    if (tierJob.running) return false;
    tierJob = { running: true, total: codes.length, done: 0, added: 0, skipped: 0, errors: [], finishedAt: null, startedAt: Date.now() };
    backgroundQueue = backgroundQueue.then(async () => {
      for (let i = 0; i < codes.length; i += 5) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const results = await importReports(codes.slice(i, i + 5));
          results.forEach((r) => {
            if (r.error) tierJob.errors.push(`${r.code}: ${r.error}`);
            tierJob.added += (r.added || 0) + (r.filled || 0);
            tierJob.skipped += r.skipped || 0;
          });
        } catch (error) {
          tierJob.errors.push(error.message);
        }
        tierJob.done = Math.min(codes.length, i + 5);
      }
      tierJob.running = false;
      tierJob.finishedAt = Date.now();
    });
    return true;
  };

  // ---- Analysis -------------------------------------------------------------

  const runAnalysis = async (pull) => {
    const gz = await fsp.readFile(logFile(pull.id));
    const text = zlib.gunzipSync(gz, { maxOutputLength: MAX_LOG_TEXT_BYTES }).toString('utf8');
    const settings = bossSettings(pull.encounterId);
    const report = analyzePull(text, {
      note: settings.note,
      avoidable: settings.avoidable,
      combatPotions: index.settings.combatPotions,
    });

    // Name what raiders had at the pull (food, flask, runes...): aura names
    // and tooltips from Wowhead, cached on the server for good.
    try {
      report.prep = await namePrep(report);
    } catch (error) {
      console.warn('[pulldesk] Consumables lookup failed', error.message);
      report.prep = buildPrep(report, (id) => auraInfo(report, {}, id), index.settings.combatPotions);
    }

    // The app knows encounter-specific progress (phases, rebirths) that a
    // plain "lowest boss HP" can't see, so its number wins.
    if (Number.isFinite(pull.appBossPercent) && report.result !== 'kill') {
      report.bossPercent = pull.appBossPercent;
    }

    // Fill in names for avoidable spells we now know.
    let namesChanged = false;
    settings.avoidable.forEach((spell) => {
      const name = report.spellNames[spell.id];
      if (name && !spell.name) {
        spell.name = name;
        namesChanged = true;
      }
    });

    report.id = pull.id;
    report.night = pull.night;
    report.pullNumber = pull.pullNumber;
    report.totalPullNumber = pull.totalPullNumber;
    report.startedAt = pull.startedAt;
    report.createdAt = pull.createdAt;
    report.uploadedBy = pull.uploadedBy;
    report.noteUpdatedAt = settings.noteUpdatedAt || null;
    // Meters only come from the app (worked out from every line); a log
    // without them keeps any meters it had.
    if (report.meters) {
      await fsp.mkdir(path.dirname(metersFile(pull.id)), { recursive: true });
      await fsp.writeFile(metersFile(pull.id), JSON.stringify(report.meters));
      delete report.meters;
      pull.appMeters = true;
    }
    report.hasMeters = Boolean(pull.appMeters);
    await fsp.writeFile(reportFile(pull.id), JSON.stringify(report));

    Object.assign(pull, {
      status: 'ready',
      error: null,
      prepVersion: PREP_VERSION,
      result: report.result,
      duration: report.duration,
      bossPercent: report.bossPercent,
      deaths: report.deaths.length,
      wipeText: report.wipe?.text || null,
      plan: report.plan.items.length > 0 ? report.plan.summary : null,
      avoidableHits: report.avoidable.reduce((total, row) => total + row.hits, 0),
    });
    if (namesChanged) await persist();
    return report;
  };

  // Recompute recent reports for a boss after its note or avoidable list
  // changed, so tonight's pulls reflect the new plan.
  const reanalyzeRecent = async (encounterId) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const pulls = index.pulls.filter(
      (pull) =>
        pull.encounterId === encounterId &&
        pull.status === 'ready' &&
        pull.source !== 'wcl' &&
        pull.createdAt >= cutoff,
    );
    for (const pull of pulls) {
      try {
        await runAnalysis(pull);
      } catch (error) {
        console.warn('[pulldesk] Reanalysis failed', pull.id, error.message);
      }
    }
    await persist();
    return pulls.length;
  };

  // After an avoidable or potion change: recheck the older pulls too (those
  // with a log still kept), one at a time in the background.
  let backgroundQueue = Promise.resolve();
  const auraInfo = (report, looked, id) => {
    if (looked[id]) return looked[id];
    const name = report.prepRaw?.auraNames?.[id];
    return name ? { name, text: '' } : null;
  };

  const namePrep = async (report) => {
    const ids = [
      ...new Set((report.prepRaw?.players || []).flatMap((p) => p.auras.map(([, id]) => id))),
    ].filter((id) => !KNOWN_AURAS.has(id));
    // Wowhead tooltips (no Blizzard keys needed, but tests run without
    // either, so only when the journal is set up).
    const looked = journal.configured && ids.length ? (await journal.spells(ids, 0, ids.length)).spells : {};
    return buildPrep(report, (id) => auraInfo(report, looked, id), index.settings.combatPotions);
  };

  /**
   * Imported pulls get consumables, avoidable hits and potion counts from
   * Warcraft Logs (one report at a time, in the background).
   */
  const fetchWclExtras = async (pulls) => {
    const byReport = new Map();
    for (const pull of pulls) {
      let report;
      try {
        // eslint-disable-next-line no-await-in-loop
        report = JSON.parse(await fsp.readFile(reportFile(pull.id), 'utf8'));
      } catch {
        continue;
      }
      if (!report.wclReport || !report.wclFight) continue;
      const list = byReport.get(report.wclReport) || [];
      list.push({ pull, report });
      byReport.set(report.wclReport, list);
    }
    for (const [code, items] of byReport) {
      const avoid = [...new Set(items.map((i) => i.pull.encounterId))].flatMap((id) => bossSettings(id).avoidable);
      let extras;
      try {
        // eslint-disable-next-line no-await-in-loop
        extras = await fetchReportExtras(wcl, code, items.map((i) => i.report.wclFight), {
          abilityIds: avoid.map((a) => a.id),
          abilityNames: avoid.map((a) => a.name).filter(Boolean),
          potionNames: index.settings.combatPotions,
        });
      } catch (error) {
        console.warn(`[pulldesk] Warcraft Logs extras for ${code} failed`, error.message);
        continue;
      }
      for (const { pull, report } of items) {
        const x = extras.get(report.wclFight);
        if (!x) continue;
        report.prepRaw = {
          players: x.players.map((p) => ({ guid: p.guid, name: p.name, specId: p.specId, ...rawPrep(p.args) })),
          auraNames: x.auraNames,
          sourceNames: x.sourceNames,
        };
        report.combatPotionsUsed = x.potions;
        report.avoidable = x.avoidable;
        try {
          // eslint-disable-next-line no-await-in-loop
          report.prep = await namePrep(report);
        } catch {
          report.prep = buildPrep(report, (id) => auraInfo(report, {}, id), index.settings.combatPotions);
        }
        // eslint-disable-next-line no-await-in-loop
        await fsp.writeFile(reportFile(pull.id), JSON.stringify(report));
        pull.wclExtras = WCL_EXTRAS_VERSION;
      }
    }
  };

  // `onlyMissing`: skip pulls that got their extras while this waited.
  const queueWclExtras = (filter = () => true, onlyMissing = false) => {
    if (!wcl.configured) return 0;
    const pulls = index.pulls.filter((pull) => pull.source === 'wcl' && pull.status === 'ready' && filter(pull));
    if (!pulls.length) return 0;
    backgroundQueue = backgroundQueue.then(async () => {
      const todo = onlyMissing ? pulls.filter((p) => (p.wclExtras || 0) < WCL_EXTRAS_VERSION) : pulls;
      if (!todo.length) return;
      try {
        await fetchWclExtras(todo);
      } catch (error) {
        console.warn('[pulldesk] Warcraft Logs extras failed', error.message);
      }
      await persist();
    });
    return pulls.length;
  };

  // Pulls analyzed before consumables existed, with their logs still kept.
  const recheckForPrep = () => {
    const pulls = index.pulls.filter(
      (pull) => pull.status === 'ready' && pull.hasLog && pull.source !== 'wcl' && (pull.prepVersion || 0) < PREP_VERSION,
    );
    if (!pulls.length) return 0;
    backgroundQueue = backgroundQueue.then(async () => {
      for (const pull of pulls) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await runAnalysis(pull);
        } catch {
          pull.prepVersion = PREP_VERSION; // log gone: don't retry forever
        }
      }
      await persist();
    });
    return pulls.length;
  };

  /**
   * Night by night: each raider's total and time in pulls per meter, and the
   * raid's, from the stored meters. The app turns these into rates.
   */
  const metersTrends = async (pulls) => {
    const KINDS = ['damage', 'healing', 'taken', 'mitigation'];
    const nights = new Map(); // night -> { pulls, seconds, raid: {kind: total} }
    const raiders = new Map(); // name -> { specId, nights: { night: { seconds, pulls, kind: total } } }
    for (const pull of pulls) {
      let meters;
      try {
        // eslint-disable-next-line no-await-in-loop
        meters = JSON.parse(await fsp.readFile(metersFile(pull.id), 'utf8'));
      } catch {
        continue;
      }
      const seconds = Number(meters.duration) || pull.duration || 0;
      if (!seconds) continue;
      const night = nights.get(pull.night) || { night: pull.night, pulls: 0, kills: 0, seconds: 0, raid: {} };
      night.pulls += 1;
      if (pull.result === 'kill') night.kills += 1;
      night.seconds += seconds;
      const present = new Set();
      KINDS.forEach((kind) => {
        (meters[kind] || []).forEach((row) => {
          night.raid[kind] = (night.raid[kind] || 0) + row.total;
          const r = raiders.get(row.name) || { name: row.name, specId: row.specId || 0, nights: {} };
          const n = r.nights[pull.night] || { seconds: 0, pulls: 0 };
          if (!present.has(row.name)) {
            n.seconds += seconds;
            n.pulls += 1;
            present.add(row.name);
          }
          n[kind] = (n[kind] || 0) + row.total;
          r.nights[pull.night] = n;
          raiders.set(row.name, r);
        });
      });
      nights.set(pull.night, night);
    }
    return {
      nights: [...nights.values()].sort((a, b) => a.night.localeCompare(b.night)),
      raiders: [...raiders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  };

  const reanalyzeOlder = (filter) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const pulls = index.pulls.filter(
      (pull) =>
        pull.status === 'ready' && pull.hasLog && pull.source !== 'wcl' && pull.createdAt < cutoff && filter(pull),
    );
    backgroundQueue = backgroundQueue.then(async () => {
      for (const pull of pulls) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await runAnalysis(pull);
        } catch {
          // Its log may have been cleaned up; the old report stays.
        }
      }
      if (pulls.length) await persist();
    });
    return pulls.length;
  };

  // ---- Discord -----------------------------------------------------------------

  const channelFor = (encounterId) =>
    bossSettings(encounterId).channelId || envChannels[String(encounterId)] || defaultChannel;

  const discordPost = async (pull, report) => {
    const channelId = channelFor(pull.encounterId);
    if (!channelId || !botToken) return;

    const kill = report.result === 'kill';
    const title = `Pull ${pull.pullNumber} · ${report.encounterName} (${report.difficulty}) · ${
      kill ? 'KILL' : `Wipe at ${report.bossPercent ?? '?'}%`
    } · ${formatTime(report.duration)}`;

    const fields = [];
    if (report.deaths.length > 0) {
      const lines = report.deaths
        .slice(0, 6)
        .map(
          (death) =>
            `\`${formatTime(death.t)}\` ${death.name} · ${death.killingBlow?.spellName || 'unknown'}`,
        );
      if (report.deaths.length > 6) lines.push(`…and ${report.deaths.length - 6} more`);
      fields.push({ name: `Deaths (${report.deaths.length})`, value: lines.join('\n') });
    }

    if (report.plan.items.length > 0) {
      const { summary } = report.plan;
      const problems = report.plan.items
        .filter((item) => item.status !== 'ontime')
        .slice(0, 6)
        .map((item) => {
          const spell = item.spellName || `spell ${item.spellId}`;
          const detail =
            item.status === 'late' || item.status === 'early'
              ? `${item.status} by ${Math.abs(item.delta)}s`
              : item.status;
          return `\`${formatTime(item.t)}\` ${item.name} · ${spell} · ${detail}`;
        });
      fields.push({
        name: `Cooldown plan: ${summary.ontime} on time, ${summary.late + summary.early} off, ${summary.missed} missed`,
        value: problems.join('\n') || 'Everything on time.',
      });
    }

    if (report.avoidable.length > 0) {
      fields.push({
        name: 'Avoidable hits',
        value: report.avoidable
          .slice(0, 5)
          .map((row) => `${row.name} · ${row.hits}`)
          .join('\n'),
      });
    }

    const body = {
      embeds: [
        {
          title,
          description: kill ? 'Boss down.' : report.wipe?.text || undefined,
          color: kill ? 0x2ecc71 : 0xe74c3c,
          fields: fields.map((field) => ({ ...field, value: field.value.slice(0, 1024) })),
          footer: { text: `Uploaded by ${pull.uploadedBy || 'unknown'} · open the Pull desk in the app for details` },
        },
      ],
      allowed_mentions: { parse: [] },
    };

    try {
      const response = await fetch(
        `${discordApi}/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) {
        console.warn(
          `[pulldesk] Discord post to ${channelId} failed: ${response.status} ${await response.text().catch(() => '')}`,
        );
      }
    } catch (error) {
      console.warn('[pulldesk] Discord post failed', error.message);
    }
  };

  // ---- Housekeeping ------------------------------------------------------------

  const pruneLogs = async () => {
    if (!(logRetentionDays > 0)) return;
    const cutoff = Date.now() - logRetentionDays * 24 * 60 * 60 * 1000;
    const old = index.pulls.filter((pull) => pull.createdAt < cutoff && pull.hasLog);
    for (const pull of old) {
      await fsp.unlink(logFile(pull.id)).catch(() => {});
      pull.hasLog = false;
    }
    if (old.length > 0) await persist();
  };

  // ---- Routes ----------------------------------------------------------------------

  const claim = async (req, res) => {
    const body = await readBody(req, 16 * 1024);
    const encounterId = Number(body.encounterId);
    const difficultyId = Number(body.difficultyId);
    const duration = Number(body.duration);
    if (!Number.isInteger(encounterId) || !Number.isInteger(difficultyId) || !Number.isFinite(duration)) {
      return fail(res, 400, 'Invalid pull');
    }

    if (!trackedDifficulties.has(DIFFICULTY_NAMES[difficultyId])) {
      return json(res, 200, { skip: true });
    }

    const now = Date.now();
    const lines = Math.max(0, Number(body.lines) || 0);
    let pull = index.pulls.find(
      (entry) =>
        entry.encounterId === encounterId &&
        entry.difficultyId === difficultyId &&
        Math.abs(entry.createdAt - now) <= CLAIM_MATCH_SECONDS * 1000 &&
        Math.abs((entry.claimDuration ?? 0) - duration) <= CLAIM_DURATION_SLACK,
    );

    if (!pull) {
      const night = nightOf(now);
      const sameBoss = index.pulls.filter(
        (entry) => entry.encounterId === encounterId && entry.difficultyId === difficultyId,
      );
      const bossPercent = Number.isFinite(Number(body.bossPercent)) ? Number(body.bossPercent) : null;
      pull = {
        id: `${now.toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
        encounterId,
        encounterName: String(body.encounterName || `Encounter ${encounterId}`).slice(0, 100),
        difficultyId,
        night,
        pullNumber: sameBoss.filter((other) => other.night === night).length + 1,
        totalPullNumber: sameBoss.length + 1,
        createdAt: now,
        startedAt: Number.isFinite(Number(body.startedAt)) ? Number(body.startedAt) : null,
        claimDuration: duration,
        windowEndsAt: now + CLAIM_WINDOW_MS,
        candidates: {},
        chosen: null,
        chosenAt: 0,
        appBossPercent: bossPercent,
        result: body.result ? 'kill' : 'wipe',
        duration,
        bossPercent,
        status: 'claimed',
        hasLog: false,
      };
      index.pulls.push(pull);
    }

    const who = String(req.cloudUserId || req.cloudUserName);
    pull.candidates ??= {};
    const previous = pull.candidates[who];
    pull.candidates[who] = {
      name: req.cloudUserName,
      lines: Math.max(previous?.lines ?? 0, lines),
      at: previous?.at ?? now,
    };
    // The app's boss % only comes from raiders recording the fight; keep any.
    if (pull.appBossPercent === null && Number.isFinite(Number(body.bossPercent)) && !body.result) {
      pull.appBossPercent = Number(body.bossPercent);
      pull.bossPercent = pull.appBossPercent;
    }

    const reply = (decision) => json(res, 200, { pullId: pull.id, ...decision });

    if (pull.hasLog) return reply({ upload: false });

    if (now < (pull.windowEndsAt ?? 0)) {
      await persist();
      return reply({ upload: false, waitMs: pull.windowEndsAt - now + 250 });
    }

    // Choose once the window closes. If the chosen raider never uploads
    // (crashed, closed the app), the next best gets it on their standby check.
    const chosenStale = pull.chosen && now - pull.chosenAt > CLAIM_STALE_MS;
    if (!pull.chosen || chosenStale) {
      let best = null;
      for (const [id, candidate] of Object.entries(pull.candidates)) {
        if (chosenStale && id === pull.chosen) continue;
        if (
          !best ||
          candidate.lines > best.candidate.lines ||
          (candidate.lines === best.candidate.lines && candidate.at < best.candidate.at)
        ) {
          best = { id, candidate };
        }
      }
      pull.chosen = best ? best.id : who;
      pull.chosenAt = now;
    }
    await persist();

    if (pull.chosen === who) return reply({ upload: true });
    return reply({ upload: false, standby: true });
  };

  const uploadLog = async (req, res, pull) => {
    if (pull.hasLog && pull.appMeters) return json(res, 200, { status: pull.status });

    const gz = await readRawBody(req, MAX_LOG_BYTES);
    // Validate before storing: it must gunzip and contain an encounter.
    let text;
    try {
      text = zlib.gunzipSync(gz, { maxOutputLength: MAX_LOG_TEXT_BYTES }).toString('utf8');
    } catch {
      return fail(res, 400, 'Upload is not a gzipped log');
    }
    if (!text.includes('ENCOUNTER_START')) return fail(res, 400, 'Log has no ENCOUNTER_START');
    // A pull that already has a log only takes a new one that brings meters.
    if (pull.hasLog && !text.includes(`\n${METERS_LINE_PREFIX}`)) return json(res, 200, { status: pull.status });

    await fsp.writeFile(logFile(pull.id), gz);
    pull.hasLog = true;
    // A Warcraft Logs import gets the full report from the real log.
    if (pull.source === 'wcl') delete pull.source;
    pull.uploadedBy = req.cloudUserName;
    pull.status = 'analyzing';
    await persist();

    let report;
    try {
      report = await runAnalysis(pull);
    } catch (error) {
      console.error('[pulldesk] Analysis failed', pull.id, error);
      pull.status = 'failed';
      pull.error = error.message;
      await persist();
      return json(res, 200, { status: 'failed' });
    }
    await persist();
    json(res, 200, { status: 'ready' });

    // After responding: Discord and housekeeping don't hold up the app.
    if (postPulls) await discordPost(pull, report);
    await pruneLogs();
    return undefined;
  };

  const setNote = async (req, res, encounterId) => {
    const body = await readBody(req, MAX_NOTE_CHARS * 4);
    if (typeof body.note !== 'string' || body.note.length > MAX_NOTE_CHARS) {
      return fail(res, 400, 'Invalid note');
    }
    const settings = bossSettings(encounterId);
    settings.note = body.note;
    settings.noteUpdatedAt = Date.now();
    settings.noteUpdatedBy = req.cloudUserName;
    await persist();
    const reanalyzed = await reanalyzeRecent(encounterId);
    // wowutils exports start with "EncounterID:<id>"; catch a note pasted
    // under the wrong boss.
    const noteBoss = parseNote(body.note, []).encounterId;
    const warning =
      noteBoss && noteBoss !== encounterId
        ? `This note's header says encounter ${noteBoss}, but it was saved for encounter ${encounterId}. Check you picked the right boss.`
        : null;
    return json(res, 200, { reanalyzed, warning });
  };

  const setAvoidable = async (req, res, encounterId) => {
    const body = await readBody(req, 64 * 1024);
    if (!Array.isArray(body.spells) || body.spells.length > 200) {
      return fail(res, 400, 'Invalid avoidable list');
    }
    const settings = bossSettings(encounterId);
    const known = new Map(settings.avoidable.map((spell) => [spell.id, spell.name]));
    settings.avoidable = body.spells
      .map((spell) => ({
        id: Number(typeof spell === 'object' ? spell.id : spell),
        name: typeof spell === 'object' && typeof spell.name === 'string' ? spell.name.slice(0, 100) : null,
      }))
      .filter((spell) => Number.isInteger(spell.id) && spell.id > 0)
      .map((spell) => ({ id: spell.id, name: spell.name || known.get(spell.id) || null }));
    await persist();
    const reanalyzed = await reanalyzeRecent(encounterId);
    const older = reanalyzeOlder((pull) => pull.encounterId === encounterId);
    const imported = queueWclExtras((pull) => pull.encounterId === encounterId);
    return json(res, 200, { reanalyzed, older, imported, avoidable: settings.avoidable });
  };

  // One ability on or off a boss's avoidable list (the Journal view and
  // ability cards).
  const toggleAvoidable = async (req, res, encounterId) => {
    const body = await readBody(req, 4 * 1024);
    const id = Number(body.spellId);
    if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid spell ID');
    const settings = bossSettings(encounterId);
    const name = typeof body.name === 'string' ? body.name.slice(0, 100) : null;
    // Off removes the ability under any of its IDs (the journal's cast ID
    // and the IDs it hits as share a name).
    const same = (spell) =>
      spell.id === id || (!body.on && name && spell.name && norm(spell.name) === norm(name));
    const without = settings.avoidable.filter((spell) => !same(spell));
    settings.avoidable = body.on ? [...without, { id, name }] : without;
    await persist();
    const reanalyzed = await reanalyzeRecent(encounterId);
    const older = reanalyzeOlder((pull) => pull.encounterId === encounterId);
    const imported = queueWclExtras((pull) => pull.encounterId === encounterId);
    return json(res, 200, { reanalyzed, older, imported, avoidable: settings.avoidable });
  };

  const setJournalId = async (req, res, encounterId) => {
    const body = await readBody(req, 4 * 1024);
    const raw = String(body.journalId ?? '').trim();
    // Accept a journal link too (".../#encounter=2896" or ".../journal-encounter/2896").
    const journalId = Number((/(\d+)\s*$/.exec(raw) || [])[1]) || null;
    bossSettings(encounterId).journalId = journalId;
    await persist();
    return json(res, 200, { journalId });
  };

  // Pulls on one boss (and difficulty) with their reports, for ability stats.
  const bossStats = async (encounterId, difficultyId) => {
    const pulls = countedPulls().filter(
      (p) => p.encounterId === encounterId && (!difficultyId || p.difficultyId === difficultyId),
    );
    return cached(`abilities:${encounterId}:${difficultyId}`, async () => abilityStats(await withReports(pulls)));
  };

  const bossName = (encounterId) =>
    index.pulls.find((p) => p.encounterId === encounterId)?.encounterName || null;

  // Journal routes: /journal/boss/:encounterId, /journal/spell/:spellId,
  // /journal/spells, /journal/raw/:journalId.
  const handleJournal = async (req, res, rest, url) => {
    const [, kind, idText] = rest;
    const q = (k) => url?.searchParams.get(k);

    if (kind === 'boss' && /^\d+$/.test(idText || '') && req.method === 'GET') {
      const encounterId = Number(idText);
      const difficultyId = Number(q('difficulty')) || null;
      const settings = bossSettings(encounterId);
      const name = bossName(encounterId) || q('name');
      let data = null;
      let error = '';
      if (journal.configured && name) {
        try {
          data = await journal.encounter({ name, journalId: settings.journalId || null, refresh: q('refresh') === '1' });
        } catch (e) {
          error = e.message;
        }
      }
      return json(res, 200, {
        configured: journal.configured,
        encounterId,
        encounterName: name,
        journalId: settings.journalId || data?.journalId || null,
        journal: data,
        error,
        stats: await bossStats(encounterId, difficultyId),
        avoidable: settings.avoidable,
      });
    }

    if (kind === 'spell' && /^\d+$/.test(idText || '') && req.method === 'GET') {
      const spellId = Number(idText);
      const encounterId = Number(q('encounterId')) || null;
      const difficultyId = Number(q('difficulty')) || null;
      const wantedName = q('name') || '';
      let section = null;
      let info = null;
      let error = '';
      try {
        if (journal.configured && encounterId) {
          const name = bossName(encounterId);
          const j = name
            ? await journal.encounter({ name, journalId: bossSettings(encounterId).journalId || null })
            : null;
          const abilities = journalAbilities(j);
          section =
            abilities.find((a) => a.spellId === spellId) ||
            (wantedName ? abilities.find((a) => norm(a.title) === norm(wantedName)) : null) ||
            null;
        }
        // Tooltip text for this difficulty (Wowhead; works without Blizzard keys).
        info = await journal.spell(spellId, difficultyId);
      } catch (e) {
        error = e.message;
      }
      const stats = encounterId ? await bossStats(encounterId, difficultyId) : [];
      const stat =
        stats.find((s) => s.spellId === spellId) ||
        (wantedName ? stats.find((s) => norm(s.name) === norm(wantedName)) : null) ||
        null;
      const avoidable = encounterId ? bossSettings(encounterId).avoidable : [];
      const cardNames = [section?.title, info?.name, wantedName].filter(Boolean).map(norm);
      return json(res, 200, {
        configured: journal.configured,
        spellId,
        name: section?.title || info?.name || wantedName || null,
        // An icon name, e.g. "ability_creature_poison_02".
        icon: info?.icon || null,
        text: info?.text || section?.text || '',
        source: info?.text ? 'tooltip' : section?.text ? 'journal' : null,
        tags: section?.tags || [],
        stats: stat,
        // On the list by this ID, or by name (added from the journal under
        // its cast ID while this card is for an ID it hits as).
        avoidable: avoidable.some(
          (a) => a.id === spellId || (a.name && cardNames.includes(norm(a.name))),
        ),
        error,
      });
    }

    // Tooltip text and icons for many spells (the Journal view). Returns
    // what's ready; `pending` > 0 means call again for the rest.
    if (kind === 'spells' && req.method === 'POST') {
      const body = await readBody(req, 32 * 1024);
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      return json(res, 200, await journal.spells(ids, Number(body?.difficulty) || null));
    }

    if (kind === 'raw' && /^\d+$/.test(idText || '') && req.method === 'GET') {
      if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
      const raw = await journal.raw(idText);
      return raw ? json(res, 200, raw) : fail(res, 404, 'Not fetched yet');
    }

    return fail(res, 404, 'Unknown journal route');
  };

  const setChannel = async (req, res, encounterId) => {
    const body = await readBody(req, 4 * 1024);
    const channelId = String(body.channelId ?? '').trim();
    if (channelId && !/^\d{5,25}$/.test(channelId)) return fail(res, 400, 'Invalid channel ID');
    bossSettings(encounterId).channelId = channelId;
    await persist();
    return json(res, 200, {});
  };

  /**
   * Handles /api/guild/:guild/pulldesk/... once the caller is signed in.
   * `rest` is the path after "pulldesk".
   */
  const handle = async (req, res, rest, url) => {
    await ready();
    const [first, second, third] = rest;

    if (first === 'config' && req.method === 'GET') {
      return json(res, 200, {
        canView: await canView(req),
        canEdit: await canEdit(req),
        owner: await ownerOnly(req),
        trackedDifficulties: [...trackedDifficulties],
        // Non-Mythic bosses shown in Progression / Reclears (null: not set).
        progressionShown: Array.isArray(index.settings.progressionShown) ? index.settings.progressionShown : null,
      });
    }

    if (first === 'claim' && req.method === 'POST') return claim(req, res);

    // Reading reports and summaries needs "See Analysis"; sending logs
    // (claims, uploads, backfill) works for everyone signed in.
    if ((req.method === 'GET' || first === 'journal') && !(await canView(req))) {
      return fail(res, 403, 'Your Discord role cannot see Analysis');
    }

    if (first === 'journal') return handleJournal(req, res, rest, url);

    if (first === 'settings' && req.method === 'GET') {
      return json(res, 200, index.settings);
    }
    if (first === 'settings' && req.method === 'PUT') {
      if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
      const body = await readBody(req, 16 * 1024);
      if (body.combatPotions !== undefined) {
        if (!Array.isArray(body.combatPotions) || body.combatPotions.length > 50) {
          return fail(res, 400, 'Expected a list of up to 50 potion names');
        }
        index.settings.combatPotions = [
          ...new Set(body.combatPotions.map((n) => String(n).trim().slice(0, 80)).filter(Boolean)),
        ];
      }
      await persist();
      // Recount potions in every report whose log is still kept.
      const day = Date.now() - 24 * 60 * 60 * 1000;
      const recent = index.pulls.filter(
        (p) => p.status === 'ready' && p.hasLog && p.source !== 'wcl' && p.createdAt >= day,
      );
      recent.forEach((p) => {
        backgroundQueue = backgroundQueue.then(() => runAnalysis(p).catch(() => {}));
      });
      const older = reanalyzeOlder(() => true);
      return json(res, 200, { settings: index.settings, rechecking: recent.length + older });
    }

    if (first === 'backfill' && second === 'check' && req.method === 'POST') return backfillCheck(req, res);
    if (first === 'backfill' && !second && req.method === 'POST') return backfill(req, res);

    if (first === 'progression-list' && req.method === 'PUT') {
      if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
      const body = await readBody(req, 16 * 1024);
      const list = Array.isArray(body?.shown) ? body.shown : [];
      index.settings.progressionShown = [
        ...new Set(list.map(String).filter((k) => /^\d+:\d+$/.test(k))),
      ].slice(0, 200);
      await persist();
      return json(res, 200, { progressionShown: index.settings.progressionShown });
    }

    // Logs trends: each raider's rates night by night on one boss.
    if (first === 'meters' && second === 'trends' && req.method === 'GET') {
      const encounterId = Number(url?.searchParams.get('encounterId'));
      const difficultyId = Number(url?.searchParams.get('difficulty')) || null;
      const pulls = countedPulls().filter(
        (p) => p.appMeters && p.encounterId === encounterId && (!difficultyId || p.difficultyId === difficultyId),
      );
      const data = await cached(`trends:${encounterId}:${difficultyId}`, () => metersTrends(pulls));
      return json(res, 200, data);
    }

    if (first === 'import' && second === 'guild' && !(await ownerOnly(req))) {
      return fail(res, 403, 'Only the owner can import a whole tier');
    }
    if (first === 'import' && second === 'tier' && !(await ownerOnly(req))) {
      return fail(res, 403, 'Only the owner can import a whole tier');
    }
    if (first === 'import' && second === 'guild' && req.method === 'GET') {
      return json(res, 200, {
        guild: index.settings.wclGuild || { name: env.GUILD_CLOUD_GUILD || 'Room Forty', realm: '', region: 'us' },
        job: tierJob,
      });
    }
    if (first === 'import' && second === 'guild' && third === 'scan' && req.method === 'POST') {
      if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
      const body = await readBody(req, 4 * 1024);
      const guild = {
        name: String(body?.name || '').trim().slice(0, 60),
        realm: String(body?.realm || '').trim().slice(0, 60),
        region: ['us', 'eu', 'kr', 'tw', 'cn'].includes(String(body?.region).toLowerCase()) ? String(body.region).toLowerCase() : 'us',
      };
      if (!guild.name || !guild.realm) return fail(res, 400, 'Enter the guild name and realm');
      try {
        const zones = await guildReportsByZone({ ...guild, months: body?.months });
        index.settings.wclGuild = guild;
        await persist();
        return json(res, 200, { guild, zones });
      } catch (error) {
        return fail(res, error.status || 502, error.message);
      }
    }
    if (first === 'import' && second === 'tier' && req.method === 'POST') {
      if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
      const body = await readBody(req, 256 * 1024);
      const codes = [...new Set((Array.isArray(body?.codes) ? body.codes : []).map(reportCode).filter(Boolean))].slice(0, 500);
      if (!codes.length) return fail(res, 400, 'No reports picked');
      if (!startTierImport(codes)) return fail(res, 409, 'An import is already running');
      return json(res, 200, { job: tierJob });
    }

    if (first === 'import' && !second && req.method === 'POST') {
      if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
      const body = await readBody(req, 64 * 1024);
      const codes = [...new Set((Array.isArray(body?.reports) ? body.reports : []).map(reportCode).filter(Boolean))];
      if (!codes.length) return fail(res, 400, 'Paste one or more Warcraft Logs report links');
      if (codes.length > MAX_IMPORT_REPORTS) return fail(res, 400, `Up to ${MAX_IMPORT_REPORTS} reports at a time`);
      try {
        return json(res, 200, { results: await importReports(codes) });
      } catch (error) {
        return fail(res, error.status || 502, error.message);
      }
    }

    if (first === 'pulls' && !second && req.method === 'GET') {
      const days = Math.min(Math.max(Number(url?.searchParams.get('days')) || 7, 1), 120);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const pulls = index.pulls
        // Imported pulls have no app report; they show in the summaries.
        .filter((pull) => pull.createdAt >= cutoff && pull.status !== 'claimed' && pull.source !== 'wcl')
        .map(summaryOf)
        .reverse();
      return json(res, 200, { pulls });
    }

    if (first === 'pulls' && second) {
      const pull = index.pulls.find((entry) => entry.id === second);
      if (!pull) return fail(res, 404, 'Pull not found');

      if (third === 'log' && req.method === 'PUT') {
        try {
          return await uploadLog(req, res, pull);
        } catch (error) {
          if (error.status === 413) return fail(res, 413, 'Log upload too large');
          throw error;
        }
      }

      if (third === 'reanalyze' && req.method === 'POST') {
        if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
        if (!pull.hasLog) return fail(res, 409, 'This pull has no stored log');
        await runAnalysis(pull);
        await persist();
        return json(res, 200, summaryOf(pull));
      }

      if (third === 'meters' && req.method === 'GET') {
        if (!pull.appMeters) {
          return fail(
            res,
            404,
            pull.source === 'wcl'
              ? "Imported from Warcraft Logs: meters need a raider's app log."
              : 'No meters yet: they come from the app (1.9.30 or newer). Raiders with "Send my pull logs" on re-send last week\'s pulls automatically.',
          );
        }
        try {
          const meters = JSON.parse(await fsp.readFile(metersFile(pull.id), 'utf8'));
          // What the Logs page needs besides the meters: when the pull
          // started (to open recordings) and who died when.
          let deaths = [];
          try {
            const report = JSON.parse(await fsp.readFile(reportFile(pull.id), 'utf8'));
            deaths = (report.deaths || []).map((d) => ({ t: d.t, name: d.name, spell: d.killingBlow?.spellName || null }));
          } catch {
            // No report: no death markers.
          }
          return json(res, 200, {
            ...meters,
            pull: {
              id: pull.id,
              encounterId: pull.encounterId,
              difficultyId: pull.difficultyId,
              startedAt: pull.startedAt ?? pull.createdAt,
              pullNumber: pull.pullNumber,
              result: pull.result,
            },
            deaths,
          });
        } catch {
          return fail(res, 404, pull.source === 'wcl' ? 'Meters need the app\'s own log; this pull was imported from Warcraft Logs' : 'No meters for this pull yet');
        }
      }

      if (!third && req.method === 'GET') {
        if (pull.status !== 'ready') return json(res, 200, { pending: true, ...summaryOf(pull) });
        try {
          const body = await fsp.readFile(reportFile(pull.id));
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': body.length,
          });
          return res.end(body);
        } catch {
          return fail(res, 404, 'Report missing');
        }
      }
    }

    // Night summary and progression views.
    if (first === 'summary' && req.method === 'GET') {
      const counted = countedPulls();
      if (second === 'nights') {
        const nights = new Map();
        counted.forEach((pull) => {
          const night = nights.get(pull.night) || new Map();
          const key = `${pull.encounterId}:${pull.difficultyId}`;
          const boss = night.get(key) || {
            encounterId: pull.encounterId,
            encounterName: pull.encounterName,
            difficultyId: pull.difficultyId,
            pulls: 0,
            kills: 0,
          };
          boss.pulls += 1;
          if (pull.result === 'kill') {
            boss.kills += 1;
            // When it first died that night (orders bosses by first kill).
            boss.firstKillAt = Math.min(boss.firstKillAt ?? Infinity, pull.startedAt || pull.createdAt || Infinity);
          }
          night.set(key, boss);
          nights.set(pull.night, night);
        });
        return json(res, 200, {
          nights: [...nights.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([night, bosses]) => ({ night, bosses: [...bosses.values()] })),
        });
      }
      if (second === 'night' && /^\d{4}-\d{2}-\d{2}$/.test(third || '')) {
        const data = await cached(`night:${third}`, async () =>
          summarizeNight(await withReports(counted.filter((pull) => pull.night === third))),
        );
        return json(res, 200, { night: third, bosses: data });
      }
      if (second === 'boss' && /^\d+$/.test(third || '')) {
        const encounterId = Number(third);
        const difficultyId = Number(url?.searchParams.get('difficulty')) || null;
        const phase = url?.searchParams.get('phase') === 'reclear' ? 'reclear' : 'progression';
        const pulls = counted.filter(
          (pull) => pull.encounterId === encounterId && (!difficultyId || pull.difficultyId === difficultyId),
        );
        if (!pulls.length) return fail(res, 404, 'No pulls on that boss yet');
        // The old "killed before we tracked it" setting is retired: imports
        // from Warcraft Logs give the real first kill.
        const split = splitAtFirstKill(pulls, false);
        const chosen = split[phase];
        // Wipe causes left out (e.g. a fluke raid wipe), "|"-separated.
        const excluded = String(url?.searchParams.get('exclude') || '')
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 50);
        const meta = {
          phase,
          counts: { progression: split.progression.length, reclear: split.reclear.length },
          excludedCauses: excluded,
        };
        if (!chosen.length) return json(res, 200, { ...meta, empty: true, encounterId, difficultyId, causeOptions: [] });
        const data = await cached(`boss:${encounterId}:${difficultyId}:${phase}:${excluded.join('|')}`, async () => {
          const all = await withReports(chosen);
          const counts = new Map();
          const kept = all.filter((p) => {
            const cause = wipeCause(p.summary, p.report);
            if (cause) counts.set(cause, (counts.get(cause) || 0) + 1);
            return !cause || !excluded.includes(cause);
          });
          return {
            ...summarizeProgression(kept.length ? kept : all),
            causeOptions: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
            excludedPulls: all.length - kept.length,
          };
        });
        return json(res, 200, { ...data, ...meta });
      }
      return fail(res, 404, 'Unknown summary');
    }

    if (first === 'bosses' && /^\d+$/.test(second || '')) {
      const encounterId = Number(second);

      if (!third && req.method === 'GET') {
        const settings = bossSettings(encounterId);
        return json(res, 200, {
          encounterId,
          note: settings.note,
          noteUpdatedAt: settings.noteUpdatedAt || null,
          noteUpdatedBy: settings.noteUpdatedBy || null,
          avoidable: settings.avoidable,
          killedBefore: Boolean(settings.killedBefore),
          channelId: settings.channelId || '',
          effectiveChannelId: channelFor(encounterId) || '',
        });
      }

      if (req.method === 'PUT') {
        if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
        if (third === 'note') return setNote(req, res, encounterId);
        if (third === 'avoidable') return setAvoidable(req, res, encounterId);
        if (third === 'channel') return setChannel(req, res, encounterId);
        if (third === 'avoidable-toggle') return toggleAvoidable(req, res, encounterId);
        if (third === 'journal') return setJournalId(req, res, encounterId);
        if (third === 'killed-before') {
          // "We killed it before the app tracked it": every pull is a reclear.
          const body = await readBody(req, 1024);
          bossSettings(encounterId).killedBefore = Boolean(body?.on);
          await persist();
          return json(res, 200, { killedBefore: bossSettings(encounterId).killedBefore });
        }
      }
    }

    return fail(res, 404, 'Unknown pull desk route');
  };

  return { handle, ready, analyze: runAnalysis };
};
