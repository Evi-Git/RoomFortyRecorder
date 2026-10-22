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
import { analyzePull, formatTime, parseNote } from './pulldesk-analyze.mjs';
import { summarizeNight, summarizeProgression } from './pulldesk-summary.mjs';
import { fetchReportPulls, reportCode } from './pulldesk-import.mjs';
import { createWclClient } from './recruit-clients.mjs';

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
const MAX_NOTE_CHARS = 100 * 1024;

const DIFFICULTY_NAMES = { 14: 'normal', 15: 'heroic', 16: 'mythic', 17: 'lfr' };

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
  const dir = path.join(options.storage, 'pulldesk');
  const indexFile = path.join(dir, 'index.json');
  const reportFile = (id) => path.join(dir, 'reports', `${id}.json`);
  const logFile = (id) => path.join(dir, 'logs', `${id}.log.gz`);

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

  let index = { pulls: [], bosses: {} };
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
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };

  const ready = () => {
    loaded ??= load();
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

  const canEdit = async (req) => {
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
    return results;
  };

  // ---- Analysis -------------------------------------------------------------

  const runAnalysis = async (pull) => {
    const gz = await fsp.readFile(logFile(pull.id));
    const text = zlib.gunzipSync(gz, { maxOutputLength: MAX_LOG_TEXT_BYTES }).toString('utf8');
    const settings = bossSettings(pull.encounterId);
    const report = analyzePull(text, {
      note: settings.note,
      avoidable: settings.avoidable.map((spell) => spell.id),
    });

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
    await fsp.writeFile(reportFile(pull.id), JSON.stringify(report));

    Object.assign(pull, {
      status: 'ready',
      error: null,
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
    if (pull.hasLog) return json(res, 200, { status: pull.status });

    const gz = await readRawBody(req, MAX_LOG_BYTES);
    // Validate before storing: it must gunzip and contain an encounter.
    let text;
    try {
      text = zlib.gunzipSync(gz, { maxOutputLength: MAX_LOG_TEXT_BYTES }).toString('utf8');
    } catch {
      return fail(res, 400, 'Upload is not a gzipped log');
    }
    if (!text.includes('ENCOUNTER_START')) return fail(res, 400, 'Log has no ENCOUNTER_START');

    await fsp.writeFile(logFile(pull.id), gz);
    pull.hasLog = true;
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
    return json(res, 200, { reanalyzed, avoidable: settings.avoidable });
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
        canEdit: await canEdit(req),
        trackedDifficulties: [...trackedDifficulties],
      });
    }

    if (first === 'claim' && req.method === 'POST') return claim(req, res);

    if (first === 'import' && req.method === 'POST') {
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
        if (!pull.hasLog) return fail(res, 409, 'This pull has no stored log');
        await runAnalysis(pull);
        await persist();
        return json(res, 200, summaryOf(pull));
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
          if (pull.result === 'kill') boss.kills += 1;
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
        const pulls = counted.filter(
          (pull) => pull.encounterId === encounterId && (!difficultyId || pull.difficultyId === difficultyId),
        );
        if (!pulls.length) return fail(res, 404, 'No pulls on that boss yet');
        const data = await cached(`boss:${encounterId}:${difficultyId}`, async () =>
          summarizeProgression(await withReports(pulls)),
        );
        return json(res, 200, data);
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
          channelId: settings.channelId || '',
          effectiveChannelId: channelFor(encounterId) || '',
        });
      }

      if (req.method === 'PUT') {
        if (!(await canEdit(req))) return fail(res, 403, 'Your Discord role cannot edit the pull desk');
        if (third === 'note') return setNote(req, res, encounterId);
        if (third === 'avoidable') return setAvoidable(req, res, encounterId);
        if (third === 'channel') return setChannel(req, res, encounterId);
      }
    }

    return fail(res, 404, 'Unknown pull desk route');
  };

  return { handle, ready, analyze: runAnalysis };
};
