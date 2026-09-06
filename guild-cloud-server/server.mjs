import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

const loadEnvFile = () => {
  try {
    const contents = fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
      if (!match || match[1] in process.env) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

loadEnvFile();

const HOST = process.env.GUILD_CLOUD_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.GUILD_CLOUD_PORT || '8787', 10);
const GUILD = process.env.GUILD_CLOUD_GUILD || 'Room Forty';
const DISCORD_CLIENT_ID = process.env.GUILD_CLOUD_DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET =
  process.env.GUILD_CLOUD_DISCORD_CLIENT_SECRET || '';
const DISCORD_GUILD_ID = process.env.GUILD_CLOUD_DISCORD_GUILD_ID || '';
const DISCORD_BOT_TOKEN =
  process.env.GUILD_CLOUD_DISCORD_BOT_TOKEN || '';
const DISCORD_ALLOWED_ROLES = (process.env.GUILD_CLOUD_DISCORD_ALLOWED_ROLES || '')
  .split(',')
  .map((role) => role.trim().toLowerCase())
  .filter(Boolean);
const DISCORD_REDIRECT_URI =
  process.env.GUILD_CLOUD_DISCORD_REDIRECT_URI || '';
const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const STORAGE = path.resolve(
  process.env.GUILD_CLOUD_STORAGE_PATH || path.join(SERVER_DIR, 'data'),
);
const VIDEO_DIR = path.join(STORAGE, 'videos');
const STATE_FILE = path.join(STORAGE, 'state.json');
const LIMIT_GB = Number.parseFloat(process.env.GUILD_CLOUD_LIMIT_GB || '1800');
const SECRET = process.env.GUILD_CLOUD_SECRET || `${GUILD}:${DISCORD_CLIENT_ID}`;
const PUBLIC_URL = process.env.GUILD_CLOUD_PUBLIC_URL?.replace(/\/+$/, '');
const CDN_URL = process.env.GUILD_CLOUD_CDN_URL?.replace(/\/+$/, '') || '';
const BUNNY_API_KEY = process.env.GUILD_CLOUD_BUNNY_API_KEY || '';
const TOKEN_TTL_SECONDS = 60 * 60;


if (
  !DISCORD_CLIENT_ID ||
  !DISCORD_CLIENT_SECRET ||
  !DISCORD_GUILD_ID ||
  !DISCORD_BOT_TOKEN ||
  DISCORD_ALLOWED_ROLES.length === 0 ||
  !DISCORD_REDIRECT_URI
) {
  console.warn(
    '[guild-cloud] Discord OAuth is not configured; set the Discord values before starting the client',
  );
}

let state = {
  videos: [],
  chats: [],
  links: [],
  nextMessageId: 1,
};
let saveQueue = Promise.resolve();

const json = (res, status, body, headers = {}) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
};

const text = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
};

const fail = (res, status, message) => json(res, status, { error: message });

const withCors = (headers = {}) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  ...headers,
});

const constantTimeEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const oauthStates = new Map();
const loginCodes = new Map();

const authorized = (req, res) => {
  const match = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');

  if (!match) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Guild Cloud"');
    fail(res, 401, 'Discord sign-in required');
    return false;
  }

  try {
    const session = decodeToken(match[1], 'session');
    if (session.guild !== GUILD || !session.userName) {
      throw new Error('Invalid session');
    }
    req.cloudUserName = session.userName;
    req.cloudUserId = session.discordId;
    return true;
  } catch {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Guild Cloud"');
    fail(res, 401, 'Invalid or expired Discord session');
    return false;
  }
};

const encodeToken = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
};

const decodeToken = (token, action) => {
  const [body, signature] = String(token).split('.');
  if (!body || !signature) throw new Error('Invalid token');

  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');
  if (!constantTimeEqual(signature, expected)) throw new Error('Invalid token');

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.action !== action || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token');
  }

  return payload;
};

const discordConfigured = () =>
  Boolean(
    DISCORD_CLIENT_ID &&
      DISCORD_CLIENT_SECRET &&
      DISCORD_GUILD_ID &&
      DISCORD_BOT_TOKEN &&
      DISCORD_ALLOWED_ROLES.length > 0 &&
      DISCORD_REDIRECT_URI,
  );

const pruneOAuth = () => {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, value] of oauthStates) {
    if (value.expires < now) oauthStates.delete(key);
  }
  for (const [key, value] of loginCodes) {
    if (value.expires < now) loginCodes.delete(key);
  }
};

const redirect = (res, target) => {
  res.writeHead(302, { Location: target });
  res.end();
};

const localCallback = (value) => {
  const callback = new URL(value);
  if (
    callback.protocol !== 'http:' ||
    callback.hostname !== '127.0.0.1' ||
    callback.pathname !== '/callback' ||
    callback.username ||
    callback.password
  ) {
    throw new Error('Invalid callback');
  }
  return callback;
};

const callbackResult = (callback, values) => {
  const result = new URL(callback);
  Object.entries(values).forEach(([key, value]) => {
    result.searchParams.set(key, value);
  });
  return result.toString();
};

const discordJson = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Discord request failed: ${response.status}`);
  return data;
};

const handleDiscordAuth = async (req, res, url, parts) => {
  if (parts[2] === 'start') {
    if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

    let callback;
    try {
      callback = localCallback(url.searchParams.get('callback') || '');
    } catch {
      return fail(res, 400, 'Invalid OAuth callback');
    }

    if (!discordConfigured()) {
      return redirect(
        res,
        callbackResult(callback, { error: 'discord_not_configured' }),
      );
    }

    pruneOAuth();
    const state = crypto.randomBytes(24).toString('base64url');
    oauthStates.set(state, {
      callback: callback.toString(),
      expires: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    });

    const authorize = new URL('https://discord.com/oauth2/authorize');
    authorize.search = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: DISCORD_REDIRECT_URI,
      scope: 'identify',
      state,
    }).toString();
    return redirect(res, authorize.toString());
  }

  if (parts[2] === 'callback') {
    if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
    const state = url.searchParams.get('state');
    const pending = state && oauthStates.get(state);
    if (!pending) return fail(res, 400, 'Invalid or expired OAuth state');
    oauthStates.delete(state);

    if (url.searchParams.get('error') || !url.searchParams.get('code')) {
      return redirect(
        res,
        callbackResult(pending.callback, { error: 'discord_denied' }),
      );
    }

    try {
      const token = await discordJson(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: url.searchParams.get('code'),
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      });
      const accessToken = token.access_token;
      if (typeof accessToken !== 'string') throw new Error('Missing Discord token');

      const headers = { Authorization: `Bearer ${accessToken}` };
      const user = await discordJson(`${DISCORD_API}/users/@me`, { headers });
      const userName = user.global_name || user.username;
      if (typeof user.id !== 'string' || typeof userName !== 'string') {
        throw new Error('Invalid Discord user');
      }

      const botHeaders = {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      };
      const memberResponse = await fetch(
        `${DISCORD_API}/guilds/${encodeURIComponent(DISCORD_GUILD_ID)}/members/${encodeURIComponent(user.id)}`,
        { headers: botHeaders },
      );
      if (memberResponse.status === 404) {
        return redirect(
          res,
          callbackResult(pending.callback, { error: 'not_room_forty_member' }),
        );
      }
      if (!memberResponse.ok) {
        throw new Error(`Discord member request failed: ${memberResponse.status}`);
      }

      const member = await memberResponse.json();
      const roles = await discordJson(
        `${DISCORD_API}/guilds/${encodeURIComponent(DISCORD_GUILD_ID)}/roles`,
        { headers: botHeaders },
      );
      const roleNames = new Map(
        Array.isArray(roles)
          ? roles.map((role) => [
              role.id,
              String(role.name || '').trim().toLowerCase(),
            ])
          : [],
      );
      const hasAllowedRole =
        Array.isArray(member.roles) &&
        member.roles.some((roleId) =>
          DISCORD_ALLOWED_ROLES.includes(roleNames.get(roleId)),
        );
      if (!hasAllowedRole) {
        return redirect(
          res,
          callbackResult(pending.callback, { error: 'missing_room_forty_role' }),
        );
      }

      pruneOAuth();
      const loginCode = crypto.randomBytes(32).toString('base64url');
      loginCodes.set(loginCode, {
        discordId: user.id,
        userName,
        expires: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
      });
      return redirect(
        res,
        callbackResult(pending.callback, { code: loginCode }),
      );
    } catch (error) {
      console.error('[guild-cloud] Discord OAuth failed', error.message);
      return redirect(
        res,
        callbackResult(pending.callback, { error: 'discord_auth_failed' }),
      );
    }
  }

  return fail(res, 404, 'Unknown Discord route');
};

const publicBaseUrl = (req) => {
  if (PUBLIC_URL) return PUBLIC_URL;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${req.headers.host}`;
};

const signedUrl = (req, action, guild, key, bytes, expires, baseOverride) => {
  const token = encodeToken({
    action,
    guild,
    key,
    bytes,
    exp: expires || Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
  const base = baseOverride || publicBaseUrl(req);
  return `${base}/${action}/${token}`;
};

const downloadUrlCache = new Map();
const downloadBase = (req) => CDN_URL || publicBaseUrl(req);
const signedDownloadUrl = (req, guild, key) => {
  const base = downloadBase(req);
  const cacheKey = `${base}\0${guild}\0${key}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = downloadUrlCache.get(cacheKey);

  // HTTP polling refreshes metadata every 30 seconds. Keep the URL stable so
  // the renderer does not remount the video and cancel its active HTTP range,
  // and so the CDN sees repeated requests to the same URL (required to cache).
  if (cached && cached.expires > now + 5 * 60) return cached.url;

  const expires = now + TOKEN_TTL_SECONDS;
  const url = signedUrl(req, 'download', guild, key, undefined, expires, base);
  downloadUrlCache.set(cacheKey, { expires, url });
  return url;
};

// Fire a request for a freshly uploaded video through the CDN hostname so it's
// already cached at the edge before anyone clicks play (post-pull review is
// the worst case for a cold cache, since every file is brand new).
const warmCdnCache = async (guild, key) => {
  if (!CDN_URL) return;
  try {
    const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const url = signedUrl({}, 'download', guild, key, undefined, expires, CDN_URL);
    downloadUrlCache.set(`${CDN_URL}\0${guild}\0${key}`, { expires, url });

    const response = await fetch(url);
    if (response.body) {
      for await (const _chunk of response.body) {
        // Drain the body so the CDN pulls and caches the full file, not just headers.
      }
    }
    console.log(`[guild-cloud] Warmed CDN cache for ${key}`);
  } catch (error) {
    console.error(`[guild-cloud] CDN warm failed for ${key}`, error.message);
  }
};

// Ask Bunny to drop its cached copy so a deleted/evicted video doesn't keep
// serving from the edge after it's gone from origin.
const purgeCdnUrl = async (guild, key) => {
  if (!CDN_URL || !BUNNY_API_KEY) return;
  const cacheKey = `${CDN_URL}\0${guild}\0${key}`;
  const cached = downloadUrlCache.get(cacheKey);
  if (!cached) return;
  try {
    await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(cached.url)}`, {
      method: 'POST',
      headers: { AccessKey: BUNNY_API_KEY },
    });
    downloadUrlCache.delete(cacheKey);
  } catch (error) {
    console.error(`[guild-cloud] CDN purge failed for ${key}`, error.message);
  }
};

const isSafeKey = (key) =>
  typeof key === 'string' &&
  key.length > 0 &&
  key.length <= 255 &&
  key.endsWith('.mp4') &&
  path.basename(key) === key &&
  !key.includes('\0');

const requireGuild = (value) => {
  if (value !== GUILD) throw new Error('Unknown guild');
};

const fileForKey = (key) => {
  if (!isSafeKey(key)) throw new Error('Invalid video key');
  return path.join(VIDEO_DIR, key);
};

const exists = async (target) => {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
};

const readBody = async (req, maxBytes = 2 * 1024 * 1024) => {
  const chunks = [];
  let length = 0;

  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }

  if (length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const persist = () => {
  const snapshot = JSON.stringify(state, null, 2);
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  saveQueue = saveQueue
    .then(async () => {
      await fsp.writeFile(temp, snapshot, 'utf8');
      await fsp.rename(temp, STATE_FILE);
    })
    .catch((error) => {
      console.error('[guild-cloud] Failed to save state', error);
    });
  return saveQueue;
};

const loadState = async () => {
  await fsp.mkdir(VIDEO_DIR, { recursive: true });

  try {
    state = JSON.parse(await fsp.readFile(STATE_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persist();
  }

  state.videos = Array.isArray(state.videos) ? state.videos : [];
  state.chats = Array.isArray(state.chats) ? state.chats : [];
  state.links = Array.isArray(state.links) ? state.links : [];
  state.nextMessageId = Number.isInteger(state.nextMessageId)
    ? state.nextMessageId
    : 1;
};

const limitBytes = () =>
  LIMIT_GB > 0 ? LIMIT_GB * 1024 ** 3 : Number.MAX_SAFE_INTEGER;

const videoFiles = async () => {
  const entries = [];
  for (const video of state.videos) {
    try {
      const key = video.videoKey;
      const file = fileForKey(key);
      const stat = await fsp.stat(file);
      entries.push({ video, file, stat });
    } catch {
      // A missing file is cleaned from metadata by the housekeeper.
    }
  }
  return entries;
};

const usageBytes = async () => {
  const entries = await videoFiles();
  return entries.reduce((total, entry) => total + entry.stat.size, 0);
};

const housekeep = async () => {
  let entries = await videoFiles();
  let usage = entries.reduce((total, entry) => total + entry.stat.size, 0);
  let changed = false;

  state.videos = state.videos.filter((video) =>
    entries.some((entry) => entry.video.videoKey === video.videoKey),
  );

  entries = entries
    .filter((entry) => !entry.video.protected)
    .sort(
      (left, right) =>
        Number(left.video.start || left.stat.mtimeMs) -
        Number(right.video.start || right.stat.mtimeMs),
    );

  for (const entry of entries) {
    if (usage <= limitBytes()) break;
    await fsp.rm(entry.file, { force: true });
    state.videos = state.videos.filter(
      (video) => video.videoKey !== entry.video.videoKey,
    );
    purgeCdnUrl(GUILD, entry.video.videoKey).catch(() => {});
    usage -= entry.stat.size;
    changed = true;
  }

  if (changed) await persist();
  return usage;
};

const chatFor = (correlator) => {
  let chat = state.chats.find((entry) => entry.correlator === correlator);
  if (!chat) {
    chat = { correlator, messages: [] };
    state.chats.push(chat);
  }
  return chat;
};

const createCorrelator = (value) =>
  `guild-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;

const parseParts = (pathname) =>
  pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

const handleUpload = async (req, res, token) => {
  let payload;
  try {
    payload = decodeToken(token, 'upload');
  } catch {
    return fail(res, 403, 'Invalid or expired upload URL');
  }

  try {
    requireGuild(payload.guild);
    const file = fileForKey(payload.key);
    const temp = path.join(VIDEO_DIR, `.upload-${crypto.randomUUID()}.tmp`);
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
    });

    try {
      await pipeline(req, fs.createWriteStream(temp, { flags: 'wx' }));
    } catch (error) {
      await fsp.rm(temp, { force: true });
      throw error;
    }

    if (received !== payload.bytes) {
      await fsp.rm(temp, { force: true });
      return fail(res, 400, 'Upload size did not match the signed size');
    }

    await fsp.rm(file, { force: true });
    await fsp.rename(temp, file);
    return res.writeHead(204).end();
  } catch (error) {
    console.error('[guild-cloud] Upload failed', error.message);
    return fail(res, 500, 'Upload failed');
  }
};

const handleDownload = async (req, res, token) => {
  let payload;
  try {
    payload = decodeToken(token, 'download');
  } catch {
    return fail(res, 403, 'Invalid or expired download URL');
  }

  try {
    requireGuild(payload.guild);
    const file = fileForKey(payload.key);
    const stat = await fsp.stat(file);
    let start = 0;
    let end = stat.size - 1;
    let status = 200;

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return fail(res, 416, 'Invalid range');

      if (match[1] === '') {
        const suffix = Number.parseInt(match[2], 10);
        start = Math.max(0, stat.size - suffix);
      } else {
        start = Number.parseInt(match[1], 10);
        if (match[2]) end = Number.parseInt(match[2], 10);
      }

      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) {
        res.writeHead(416, {
          'Content-Range': `bytes */${stat.size}`,
          ...withCors(),
        });
        return res.end();
      }
      status = 206;
    }

    const headers = withCors({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
    });

    if (status === 206) {
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }

    res.writeHead(status, headers);
    const stream = fs.createReadStream(file, { start, end });
    const closeStream = () => {
      if (!res.writableFinished) stream.destroy();
    };
    res.once('close', closeStream);
    stream.once('close', () => res.off('close', closeStream));
    return stream.pipe(res);
  } catch {
    return fail(res, 404, 'Video not found');
  }
};

const metadataFor = (req, video) => ({
  ...video,
  signedVideoKey: signedDownloadUrl(req, GUILD, video.videoKey),
});

const handleApi = async (req, res, url, parts) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, withCors());
    return res.end();
  }

  if (
    parts[1] === 'auth' &&
    parts[2] === 'discord' &&
    parts[3] === 'exchange'
  ) {
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

    pruneOAuth();
    const body = await readBody(req, 64 * 1024);
    const login = typeof body.code === 'string' ? loginCodes.get(body.code) : null;
    if (!login) return fail(res, 401, 'Invalid or expired Discord login');
    loginCodes.delete(body.code);

    const token = encodeToken({
      action: 'session',
      guild: GUILD,
      discordId: login.discordId,
      userName: login.userName,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
    return json(res, 200, {
      token,
      userName: login.userName,
      guildName: GUILD,
    });
  }

  if (!authorized(req, res)) return;

  if (parts[1] === 'user' && parts[2] === 'affiliations') {
    return json(res, 200, [
      {
        id: 1,
        userName: req.cloudUserName,
        guildName: GUILD,
        read: true,
        write: true,
        del: true,
        admin: true,
      },
    ]);
  }

  if (parts[1] !== 'guild' || parts[2] === undefined) {
    return fail(res, 404, 'Unknown API route');
  }

  try {
    requireGuild(parts[2]);
  } catch {
    return fail(res, 404, 'Unknown guild');
  }

  const guild = parts[2];

  if (parts.length === 3 && req.method === 'GET') {
    const usage = await usageBytes();
    return json(res, 200, {
      guildName: GUILD,
      usageGB: usage / 1024 ** 3,
      limitGB: LIMIT_GB,
      mtime: Date.now(),
      expiry: 0,
      region: 'guild-server',
      disabled: false,
      migrated: false,
    });
  }

  if (parts[3] === 'video' && parts.length === 4) {
    if (req.method === 'GET') {
      const entries = await videoFiles();
      return json(
        res,
        200,
        entries.map((entry) => metadataFor(req, entry.video)),
      );
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const key = body.videoKey;
      if (!isSafeKey(key) || typeof body.videoName !== 'string') {
        return fail(res, 400, 'Invalid video metadata');
      }

      const file = fileForKey(key);
      if (!(await exists(file))) return fail(res, 409, 'Video upload missing');

      state.videos = state.videos.filter((video) => video.videoKey !== key);
      state.videos.push({ ...body, videoKey: key });
      await persist();
      await housekeep();
      warmCdnCache(guild, key).catch(() => {});
      return json(res, 200, {});
    }
  }

  if (parts[3] === 'video' && parts[4] && parts[5] === 'size') {
    if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
    try {
      const stat = await fsp.stat(fileForKey(parts[4]));
      return json(res, 200, { bytes: stat.size });
    } catch {
      return fail(res, 404, 'Video not found');
    }
  }

  if (parts[3] === 'video' && parts[4] && parts[5] === 'link') {
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
    const video = state.videos.find(
      (entry) => entry.videoName === parts[4] || entry.videoKey === parts[4],
    );
    if (!video) return fail(res, 404, 'Video not found');

    const id = crypto.randomBytes(9).toString('base64url');
    state.links.push({ id, guild, key: video.videoKey, likes: 0 });
    await persist();
    return json(res, 200, { id });
  }

  if (parts[3] === 'upload' && req.method === 'POST') {
    const body = await readBody(req, 64 * 1024);
    if (!isSafeKey(body.key) || !Number.isSafeInteger(body.bytes) || body.bytes < 1) {
      return fail(res, 400, 'Invalid upload request');
    }

    await housekeep();
    if ((await usageBytes()) + body.bytes > limitBytes()) {
      return fail(res, 413, 'Guild storage limit reached');
    }

    return json(res, 200, {
      signed: signedUrl(req, 'upload', guild, body.key, body.bytes),
    });
  }

  if (parts[3] === 'usage' && req.method === 'GET') {
    return json(res, 200, { bytes: await usageBytes() });
  }

  if (parts[3] === 'limit' && req.method === 'GET') {
    return json(res, 200, { bytes: limitBytes() });
  }

  if (parts[3] === 'housekeeper' && req.method === 'POST') {
    return json(res, 200, { bytes: await housekeep() });
  }

  if (parts[3] === 'bulk' && parts[4] === 'delete' && req.method === 'POST') {
    const names = await readBody(req, 2 * 1024 * 1024);
    if (!Array.isArray(names)) return fail(res, 400, 'Expected video names');

    for (const name of names) {
      const video = state.videos.find((entry) => entry.videoName === name);
      if (!video) continue;
      await fsp.rm(fileForKey(video.videoKey), { force: true });
      state.videos = state.videos.filter(
        (entry) => entry.videoKey !== video.videoKey,
      );
      purgeCdnUrl(guild, video.videoKey).catch(() => {});
    }
    await persist();
    return json(res, 200, {});
  }

  if (parts[3] === 'bulk' && parts[4] === 'protect' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.videos) || typeof body.protect !== 'boolean') {
      return fail(res, 400, 'Invalid protection request');
    }
    state.videos.forEach((video) => {
      if (body.videos.includes(video.videoName)) video.protected = body.protect;
    });
    await persist();
    return json(res, 200, {});
  }

  if (parts[3] === 'bulk' && parts[4] === 'tag' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.videos) || typeof body.tag !== 'string') {
      return fail(res, 400, 'Invalid tag request');
    }
    state.videos.forEach((video) => {
      if (body.videos.includes(video.videoName)) video.tag = body.tag || undefined;
    });
    await persist();
    return json(res, 200, {});
  }

  if (parts[3] === 'chat') {
    if (parts.length === 6 && req.method === 'POST') {
      const correlator = createCorrelator(`${parts[4]}:${parts[5]}`);
      chatFor(correlator);
      await persist();
      return json(res, 200, { correlator });
    }

    if (parts.length === 5 && req.method === 'GET') {
      return json(res, 200, chatFor(parts[4]).messages);
    }

    if (parts.length === 5 && req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.message !== 'string' || !body.message.trim()) {
        return fail(res, 400, 'Message must not be empty');
      }
      const chat = chatFor(parts[4]);
      const message = {
        id: state.nextMessageId++,
        correlator: parts[4],
        message: body.message.trim().slice(0, 2000),
        userName: req.cloudUserName,
        timestamp: Date.now(),
      };
      chat.messages.push(message);
      await persist();
      return json(res, 200, {});
    }

    if (parts.length === 5 && req.method === 'DELETE') {
      const id = Number.parseInt(parts[4], 10);
      state.chats.forEach((chat) => {
        chat.messages = chat.messages.filter((message) => message.id !== id);
      });
      await persist();
      return json(res, 200, {});
    }
  }

  if (parts[3] === 'named-chat' && parts.length === 5 && req.method === 'POST') {
    const correlator = createCorrelator(`named:${parts[4]}`);
    chatFor(correlator);
    await persist();
    return json(res, 200, { correlator });
  }

  return fail(res, 404, 'Unknown API route');
};

const htmlEscape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ],
  );

const findLink = (id) => state.links.find((entry) => entry.id === id);

const linkLikes = (link) =>
  Number.isSafeInteger(link.likes) && link.likes >= 0 ? link.likes : 0;

const handleLink = async (res, id) => {
  const link = findLink(id);
  if (!link) return text(res, 404, 'Link not found');
  if (!(await exists(fileForKey(link.key)))) return text(res, 404, 'Video not found');

  const video = state.videos.find((entry) => entry.videoKey === link.key);
  const title = video?.videoName || 'RoomFortyRecorder video';
  const source = `/link/${encodeURIComponent(id)}/video`;
  const likes = linkLikes(link);
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="${htmlEscape(title)}"><title>${htmlEscape(title)}</title>
<style>
:root{color-scheme:dark}body{margin:2rem;background:#111;color:#eee;font:16px system-ui,sans-serif;text-align:center}main{margin:auto;max-width:1200px}h1{font-size:1.25rem;font-weight:500;overflow-wrap:anywhere}video{display:block;margin:1.5rem auto;max-width:100%;max-height:78vh}button{border:1px solid #555;border-radius:.5rem;background:#222;color:#eee;cursor:pointer;font:inherit;padding:.6rem 1rem}button:hover:not(:disabled){background:#333}button.liked{border-color:#e85d75;color:#ff8ca0}button:disabled{cursor:default;opacity:.9}#status{min-height:1.5em;color:#aaa;font-size:.9rem}
</style></head><body><main>
<h1>${htmlEscape(title)}</h1>
<video controls playsinline src="${htmlEscape(source)}"></video>
<button id="like" type="button" aria-pressed="false"><span id="like-label">Like</span> ♥ <span id="likes">${likes}</span></button>
<p id="status" aria-live="polite"></p>
</main><script>
const id = ${JSON.stringify(id).replace(/</g, '\\u003c')};
const button = document.getElementById('like');
const label = document.getElementById('like-label');
const count = document.getElementById('likes');
const status = document.getElementById('status');
const storageKey = 'roomforty-liked-' + id;
const markLiked = () => {
  label.textContent = 'Liked';
  button.classList.add('liked');
  button.setAttribute('aria-pressed', 'true');
  button.disabled = true;
};
// ponytail: browser-local like dedupe; add account/rate limiting if abuse matters.
try { if (localStorage.getItem(storageKey) === '1') markLiked(); } catch {}
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const response = await fetch('/link/' + encodeURIComponent(id) + '/like', { method: 'POST' });
    if (!response.ok) throw new Error('Like failed');
    const body = await response.json();
    count.textContent = String(body.likes);
    try { localStorage.setItem(storageKey, '1'); } catch {}
    markLiked();
    status.textContent = 'Thanks for the like!';
  } catch {
    button.disabled = false;
    status.textContent = 'Could not save your like. Please try again.';
  }
});
</script></body></html>`;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(page),
  });
  return res.end(page);
};

const handleLinkVideo = async (req, res, id) => {
  const link = findLink(id);
  if (!link) return fail(res, 404, 'Link not found');
  if (!(await exists(fileForKey(link.key)))) return fail(res, 404, 'Video not found');

  // Keep the public link stable while still reusing the range-requested stream.
  const token = encodeToken({
    action: 'download',
    guild: link.guild,
    key: link.key,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
  return handleDownload(req, res, token);
};

const handleLike = async (res, id) => {
  const link = findLink(id);
  if (!link) return fail(res, 404, 'Link not found');
  if (!(await exists(fileForKey(link.key)))) return fail(res, 404, 'Video not found');

  if (linkLikes(link) < Number.MAX_SAFE_INTEGER) link.likes = linkLikes(link) + 1;
  await persist();
  return json(res, 200, { likes: link.likes });
};

const requestHandler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = parseParts(url.pathname);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, withCors());
    return res.end();
  }

  if (parts[0] === 'auth' && parts[1] === 'discord') {
    return handleDiscordAuth(req, res, url, parts);
  }

  if (parts[0] === 'health') return json(res, 200, { ok: true });
  if (parts[0] === 'upload' && req.method === 'PUT') {
    return handleUpload(req, res, parts[1]);
  }
  if (parts[0] === 'download' && req.method === 'GET') {
    return handleDownload(req, res, parts[1]);
  }
  if (parts[0] === 'link' && parts[2] === 'video' && req.method === 'GET') {
    return handleLinkVideo(req, res, parts[1]);
  }
  if (parts[0] === 'link' && parts[2] === 'like' && req.method === 'POST') {
    return handleLike(res, parts[1]);
  }
  if (parts[0] === 'link' && parts.length === 2 && req.method === 'GET') {
    return handleLink(res, parts[1]);
  }
  if (parts[0] === 'api') return handleApi(req, res, url, parts);

  return text(res, 404, 'Not found');
};

const main = async () => {
  await loadState();
  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[guild-cloud] Request failed', error);
      if (!res.headersSent) fail(res, 500, 'Internal server error');
      else res.destroy();
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[guild-cloud] Listening on http://${HOST}:${PORT}`);
    console.log(`[guild-cloud] Storage: ${STORAGE}`);
    console.log(`[guild-cloud] Guild: ${GUILD}`);
  });
};

main().catch((error) => {
  console.error('[guild-cloud] Failed to start', error);
  process.exitCode = 1;
});
