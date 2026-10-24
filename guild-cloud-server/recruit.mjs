// Recruiting: officer-only web page at /recruit plus its JSON API.
//
//   GET  /recruit                 the page (Discord sign-in, Officer role)
//   GET  /recruit/score.mjs       scoring module, shared with the server tests
//   GET  /recruit/logout          sign out of the page
//   GET  /api/recruit/state       crawl status, settings, last run
//   GET  /api/recruit/results     last crawl's candidates
//   POST /api/recruit/crawl       start a crawl ({ test: true } = one guild)
//   POST /api/recruit/stop        stop a running crawl
//   PUT  /api/recruit/settings    save settings
//
// Env:
//   GUILD_CLOUD_WCL_CLIENT_ID / GUILD_CLOUD_WCL_CLIENT_SECRET  Warcraft Logs API client
//   GUILD_CLOUD_RECRUIT_ROLES   Discord roles allowed in (default: Officer)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWclClient } from './recruit-clients.mjs';
import { createRecruitCrawler } from './recruit-crawl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SESSION_COOKIE = 'rf_session';

export const parseCookies = (header = '') =>
  Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key]) => key)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join('='))]),
  );

/**
 * @param {object} options
 * @param {string} options.storage
 * @param {(req) => Promise<object>} options.readBody
 * @param {Function} options.json
 * @param {Function} options.fail
 * @param {(token: string) => object|null} options.sessionFromToken
 * @param {(discordId: string) => Promise<string[]|null>} options.memberRoleNames
 * @param {object} options.env
 */
export const createRecruit = ({ storage, readBody, json, fail, sessionFromToken, memberRoleNames, env, canUser = null }) => {
  const roles = String(env.GUILD_CLOUD_RECRUIT_ROLES ?? 'Officer')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);

  const wcl = createWclClient({
    clientId: env.GUILD_CLOUD_WCL_CLIENT_ID || '',
    clientSecret: env.GUILD_CLOUD_WCL_CLIENT_SECRET || '',
    baseUrl: env.GUILD_CLOUD_WCL_URL || undefined,
    log: (m) => crawler && crawler.status && crawler.status.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`),
  });
  const crawler = createRecruitCrawler({
    storage,
    wcl,
    rioBaseUrl: env.GUILD_CLOUD_RAIDERIO_URL || undefined,
    homeGuildName: env.GUILD_CLOUD_GUILD || 'Room Forty',
  });

  const sessionFor = (req) => {
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const bearer = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '')?.[1];
    const token = cookie || bearer;
    return token ? sessionFromToken(token) : null;
  };

  const isRecruiter = async (session) => {
    if (!session) return false;
    if (canUser) return canUser(session.discordId, 'recruit');
    if (roles.length === 0) return true;
    const names = await memberRoleNames(session.discordId);
    return Array.isArray(names) && names.some((n) => roles.includes(String(n).toLowerCase()));
  };

  const sendFile = async (res, file, type) => {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  };

  const html = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  };

  const messagePage = (title, message, link) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#171412;color:#e6ded1;font:15px/1.5 system-ui,sans-serif}
    .card{max-width:420px;padding:28px;border:1px solid #39322d;border-radius:12px;background:#201c19}
    h1{margin:0 0 8px;font:600 20px Georgia,serif;color:#cca85c}a{color:#cca85c}</style></head>
    <body><div class="card"><h1>${title}</h1><p>${message}</p>${link || ''}</div></body></html>`;

  /** Pages under /recruit. */
  const handlePage = async (req, res, parts, url) => {
    if (parts[1] === 'score.mjs') {
      return sendFile(res, path.join(HERE, 'recruit-score.mjs'), 'text/javascript; charset=utf-8');
    }
    if (parts[1] === 'logout') {
      res.writeHead(302, {
        'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        Location: '/recruit',
      });
      return res.end();
    }
    if (parts.length > 1) return html(res, 404, messagePage('Not found', 'That page does not exist.'));

    const session = sessionFor(req);
    if (!session) {
      res.writeHead(302, { Location: `/auth/discord/start?web=1&next=${encodeURIComponent(url.pathname)}` });
      return res.end();
    }
    if (!(await isRecruiter(session))) {
      return html(
        res,
        403,
        messagePage(
          'Officers only',
          `Signed in as ${escapeHtml(session.userName)}, but recruiting needs one of these Discord roles: ${roles.map(escapeHtml).join(', ')}.`,
          '<p><a href="/recruit/logout">Sign out</a></p>',
        ),
      );
    }
    const page = await fs.readFile(path.join(HERE, 'recruit-page.html'), 'utf8');
    return html(res, 200, page.replace('__USER__', escapeHtml(session.userName)));
  };

  /** JSON API under /api/recruit. */
  const handleApi = async (req, res, parts) => {
    const session = sessionFor(req);
    if (!session) return fail(res, 401, 'Sign in with Discord first');
    if (!(await isRecruiter(session))) return fail(res, 403, 'Recruiting is for officers');

    const action = parts[2];
    if (action === 'state' && req.method === 'GET') {
      return json(res, 200, {
        configured: wcl.configured,
        status: crawler.status,
        usage: wcl.usage,
        lastRun: await crawler.lastRun(),
        settings: await crawler.getSettings(),
      });
    }
    if (action === 'results' && req.method === 'GET') {
      const results = await crawler.results();
      return json(res, 200, results || { candidates: [], guilds: [] });
    }
    if (action === 'crawl' && req.method === 'POST') {
      if (!wcl.configured) {
        return fail(res, 400, 'Add GUILD_CLOUD_WCL_CLIENT_ID and GUILD_CLOUD_WCL_CLIENT_SECRET to the server .env first.');
      }
      if (crawler.status.running) return fail(res, 409, 'A crawl is already running');
      const body = await readBody(req, 16 * 1024).catch(() => ({}));
      crawler.run({ guildLimit: body?.test ? 1 : 0 }).catch(() => {});
      return json(res, 202, { started: true });
    }
    if (action === 'stop' && req.method === 'POST') {
      crawler.stop();
      return json(res, 200, { stopping: true });
    }
    if (action === 'settings' && req.method === 'PUT') {
      const body = await readBody(req, 64 * 1024);
      const patch = validateSettings(body);
      if (patch.error) return fail(res, 400, patch.error);
      return json(res, 200, await crawler.saveSettings(patch));
    }
    return fail(res, 404, 'Unknown recruiting route');
  };

  // Daily crawl at the configured hour (server's local time).
  const timer = setInterval(async () => {
    try {
      const settings = await crawler.getSettings();
      if (!wcl.configured || crawler.status.running || settings.autoCrawlHour < 0) return;
      const now = new Date();
      if (now.getHours() !== settings.autoCrawlHour) return;
      const last = await crawler.lastRun();
      if (last?.startedAt && Date.now() - last.startedAt < 20 * 60 * 60 * 1000) return;
      crawler.run().catch(() => {});
    } catch {
      // Try again next tick.
    }
  }, 10 * 60 * 1000);
  timer.unref?.();

  return { handlePage, handleApi, crawler, wcl };
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const clampInt = (value, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

const stringList = (value, max = 20) =>
  (Array.isArray(value) ? value : String(value || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, max)
    .map((s) => s.slice(0, 80));

/** Only known fields, sane ranges. */
export const validateSettings = (body) => {
  if (!body || typeof body !== 'object') return { error: 'Invalid settings' };
  const out = {};
  if (body.region !== undefined) {
    if (!['us', 'eu', 'kr', 'tw', 'cn'].includes(String(body.region))) return { error: 'Unknown region' };
    out.region = String(body.region);
  }
  [
    ['minRank', 1, 5000],
    ['maxRank', 1, 5000],
    ['deathCutoff', 1, 10],
    ['minPulls', 0, 500],
    ['maxReportsPerGuild', 5, 200],
    ['autoCrawlHour', -1, 23],
  ].forEach(([key, min, max]) => {
    if (body[key] !== undefined) {
      const n = clampInt(body[key], min, max);
      if (n !== null) out[key] = n;
    }
  });
  if (out.minRank && out.maxRank && out.minRank > out.maxRank) return { error: 'Min rank is above max rank' };
  if (body.parseKind !== undefined) out.parseKind = body.parseKind === 'best' ? 'best' : 'median';
  if (body.weights && typeof body.weights === 'object') {
    out.weights = {
      parse: clampInt(body.weights.parse, 0, 100) ?? 50,
      deaths: clampInt(body.weights.deaths, 0, 100) ?? 30,
      mechanics: clampInt(body.weights.mechanics, 0, 100) ?? 20,
    };
  }
  if (body.homeGuild && typeof body.homeGuild === 'object') {
    out.homeGuild = {
      name: String(body.homeGuild.name || '').slice(0, 60),
      realm: String(body.homeGuild.realm || '').slice(0, 60),
    };
  }
  if (Array.isArray(body.specGroups)) {
    out.specGroups = body.specGroups.slice(0, 12).map((g) =>
      ['dps', 'healer', 'tank'].includes(g.role)
        ? { label: String(g.label || g.role).slice(0, 40), role: g.role }
        : {
            label: String(g.label || g.className || 'Group').slice(0, 40),
            className: String(g.className || '').slice(0, 30),
            specs: stringList(g.specs, 4),
          },
    );
  }
  if (Array.isArray(body.bosses)) {
    out.bosses = body.bosses.slice(0, 10).map((b) => ({
      name: String(b.name || '').slice(0, 80),
      rioSlug: String(b.rioSlug || '').slice(0, 80),
      excusedDeaths: stringList(b.excusedDeaths),
      mechanics: (Array.isArray(b.mechanics) ? b.mechanics : []).slice(0, 8).map((m, i) => ({
        id: String(m.id || `m${i}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || `m${i}`,
        label: String(m.label || 'Mechanic').slice(0, 60),
        kind: m.kind === 'interrupt' ? 'interrupt' : 'debuff',
        abilities: stringList(m.abilities, 8),
        beforeSeconds: m.beforeSeconds ? clampInt(m.beforeSeconds, 1, 3600) : undefined,
        assignedShare: m.assignedShare ? Math.min(1, Math.max(0.05, Number(m.assignedShare) || 0.5)) : undefined,
      })),
    }));
  }
  return out;
};
