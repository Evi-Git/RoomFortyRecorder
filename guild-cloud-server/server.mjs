import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

// Only chat/links/metadata live on local disk now -- videos live entirely in
// R2. This directory holds just state.json.
const STORAGE = path.resolve(
  process.env.GUILD_CLOUD_STORAGE_PATH || path.join(SERVER_DIR, 'data'),
);
const STATE_FILE = path.join(STORAGE, 'state.json');

const LIMIT_GB = Number.parseFloat(process.env.GUILD_CLOUD_LIMIT_GB || '1000');
const SECRET = process.env.GUILD_CLOUD_SECRET || `${GUILD}:${DISCORD_CLIENT_ID}`;
const ADMIN_SECRET = process.env.GUILD_CLOUD_ADMIN_SECRET || '';

// Public HTTPS hostname for THIS server's own API (auth, chat, admin,
// metadata). No video bytes are served from here anymore.
const PUBLIC_URL = process.env.GUILD_CLOUD_PUBLIC_URL?.replace(/\/+$/, '');

// The deployed Cloudflare Worker that verifies download tokens and streams
// from R2 -- e.g. https://roomforty-r2-download.<subdomain>.workers.dev, or
// a custom domain routed to it. This is where every signed download URL
// points; this server no longer serves video bytes itself.
const WORKER_URL = process.env.GUILD_CLOUD_WORKER_URL?.replace(/\/+$/, '') || '';

// R2 (S3-compatible) config -- used for presigning uploads and for
// housekeeping/deletion. Playback never goes through this SDK; it's Worker
// + the R2 binding for that.
const R2_ACCOUNT_ID = process.env.GUILD_CLOUD_R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.GUILD_CLOUD_R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.GUILD_CLOUD_R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.GUILD_CLOUD_R2_BUCKET || '';

const TOKEN_TTL_SECONDS = 60 * 60;
// Download tokens live much longer than a typical API token. The URL is
// handed to a <video> element and the app polls metadata every 30 seconds;
// keeping the URL stable across that polling avoids remounting the player
// and cancelling an in-flight HTTP range mid-scrub. The real access gate is
// the Discord-authenticated session needed to obtain the key in the first
// place, so a long-lived download token here doesn't weaken that.
const DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

if (!WORKER_URL) {
  console.warn(
    '[guild-cloud] GUILD_CLOUD_WORKER_URL is not set; signed download URLs will be broken',
  );
}

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.warn(
    '[guild-cloud] R2 is not fully configured; uploads and housekeeping will fail',
  );
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  // Recent @aws-sdk/client-s3 versions default to attaching checksum
  // headers/trailers to more requests than before ("WHEN_SUPPORTED").
  // R2's S3-compatible layer doesn't reliably support this on every
  // operation, which can cause specific calls (notably DeleteObjects) to
  // fail against R2 even though the same code works fine against real S3.
  // Reverting to the older, narrower default avoids that.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

let state = {
  videos: [],
  chats: [],
  links: [],
  nextMessageId: 1,
  // Discord users seen at least once, so the host can identify who to revoke.
  knownUsers: {},
  // discordId -> epoch seconds; any session issued before this is rejected,
  // forcing a fresh Discord sign-in (and therefore a fresh role check).
  revokedUsers: {},
  // Epoch seconds; any session issued before this, for anyone, is rejected.
  revokedAllBefore: 0,
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
    const revokedAt = state.revokedUsers[session.discordId];
    if (
      session.iat < state.revokedAllBefore ||
      (revokedAt && session.iat < revokedAt)
    ) {
      throw new Error('Session revoked');
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
    const state_ = crypto.randomBytes(24).toString('base64url');
    oauthStates.set(state_, {
      callback: callback.toString(),
      expires: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    });

    const authorize = new URL('https://discord.com/oauth2/authorize');
    authorize.search = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: DISCORD_REDIRECT_URI,
      scope: 'identify',
      state: state_,
    }).toString();
    return redirect(res, authorize.toString());
  }

  if (parts[2] === 'callback') {
    if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
    const stateParam = url.searchParams.get('state');
    const pending = stateParam && oauthStates.get(stateParam);
    if (!pending) return fail(res, 400, 'Invalid or expired OAuth state');
    oauthStates.delete(stateParam);

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

// ---- R2 helpers -----------------------------------------------------------
// These are the only places server.mjs touches R2 directly. Playback never
// comes through here -- that's the Worker, reading R2 straight from
// Cloudflare's own network. This server only presigns uploads and manages
// housekeeping/deletion.

const r2HeadObject = async (key) => {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') {
      return null;
    }
    throw error;
  }
};

const r2Exists = async (key) => Boolean(await r2HeadObject(key));

const r2PresignedPutUrl = async (key, expiresInSeconds = 60 * 60) =>
  getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );

const r2DeleteObject = async (key) => {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (error) {
    console.error(`[guild-cloud] R2 delete failed for ${key}`, error.message);
  }
};

const r2DeleteObjects = async (keys) => {
  if (keys.length === 0) return [];
  const failed = [];
  // DeleteObjects accepts at most 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      // A 200 response can still contain per-object failures here -- this
      // was previously never checked, so a partial failure looked
      // identical to full success.
      for (const error of result.Errors || []) {
        console.error(
          `[guild-cloud] R2 delete failed for ${error.Key}: ${error.Code} ${error.Message}`,
        );
        failed.push(error.Key);
      }
    } catch (error) {
      console.error('[guild-cloud] R2 bulk delete request failed', error.message);
      failed.push(...batch);
    }
  }
  return failed;
};

// Lists every object actually sitting in the bucket, with real sizes --
// this is the source of truth for usage/quota, never the client-declared
// size at upload time.
const r2ListAllObjects = async () => {
  const objects = [];
  let continuationToken;
  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of response.Contents || []) {
      objects.push({ key: item.Key, size: item.Size, lastModified: item.LastModified });
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
};

// ---- Bucket listing cache -------------------------------------------------
// Every video-list / usage poll from every open app used to list the whole
// bucket (a billable Class A operation each time). Read-only polling paths
// now share one listing for up to LISTING_CACHE_MS. Paths that DECIDE things
// from the listing (housekeeping/eviction, the upload quota check, the orphan
// scanner) always pass { fresh: true } and never trust a cached snapshot.
// Anything this server does that changes the bucket calls
// invalidateListingCache() so polls never show stale results afterward.
// Set GUILD_CLOUD_LISTING_CACHE_SECONDS=0 to disable caching entirely.
const LISTING_CACHE_MS =
  Math.max(0, Number.parseFloat(process.env.GUILD_CLOUD_LISTING_CACHE_SECONDS || '60')) * 1000;
let listingCache = { objects: null, fetchedAt: 0 };
let listingInFlight = null;
let listingGeneration = 0;

const invalidateListingCache = () => {
  listingGeneration += 1;
  listingCache = { objects: null, fetchedAt: 0 };
  listingInFlight = null;
};

const r2ListAllObjectsCached = async ({ fresh = false } = {}) => {
  const useCache = !fresh && LISTING_CACHE_MS > 0;
  if (useCache) {
    if (listingCache.objects && Date.now() - listingCache.fetchedAt < LISTING_CACHE_MS) {
      return listingCache.objects;
    }
    // Concurrent cache misses share one request instead of each listing.
    if (listingInFlight) return listingInFlight;
  }

  const generation = listingGeneration;
  const promise = r2ListAllObjects()
    .then((objects) => {
      // If something invalidated the cache while this listing was in flight,
      // its snapshot may already be stale -- return it to the caller but
      // don't let it become the shared cached copy.
      if (generation === listingGeneration && LISTING_CACHE_MS > 0) {
        listingCache = { objects, fetchedAt: Date.now() };
      }
      return objects;
    })
    .finally(() => {
      if (listingInFlight === promise) listingInFlight = null;
    });
  if (LISTING_CACHE_MS > 0) listingInFlight = promise;
  return promise;
};

// An upload lands in R2 (via the presigned PUT) BEFORE the app registers it
// with POST /video -- so a video mid-upload is briefly a legitimate "orphan"
// with no state.videos entry yet. Excluding anything younger than this
// avoids ever deleting something still in that narrow in-between window.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000; // 1 hour

const findOrphanedR2Objects = async () => {
  const objects = await r2ListAllObjectsCached({ fresh: true });
  const knownKeys = new Set(state.videos.map((video) => video.videoKey));
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  return objects.filter(
    (object) =>
      !knownKeys.has(object.key) &&
      (!object.lastModified || object.lastModified.getTime() < cutoff),
  );
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
  await fsp.mkdir(STORAGE, { recursive: true });

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
  state.knownUsers =
    state.knownUsers && typeof state.knownUsers === 'object'
      ? state.knownUsers
      : {};
  state.revokedUsers =
    state.revokedUsers && typeof state.revokedUsers === 'object'
      ? state.revokedUsers
      : {};
  state.revokedAllBefore = Number.isFinite(state.revokedAllBefore)
    ? state.revokedAllBefore
    : 0;
};

const limitBytes = () =>
  LIMIT_GB > 0 ? LIMIT_GB * 1024 ** 3 : Number.MAX_SAFE_INTEGER;

// Cross-references state.videos against what's REALLY in R2 right now.
// Sizes always come from R2 itself, never from a client-declared value.
const videoEntries = async ({ fresh = false } = {}) => {
  const objects = await r2ListAllObjectsCached({ fresh });
  const bySize = new Map(objects.map((object) => [object.key, object]));
  const entries = [];
  for (const video of state.videos) {
    const object = bySize.get(video.videoKey);
    if (object) entries.push({ video, size: object.size, lastModified: object.lastModified });
  }
  return entries;
};

const usageBytes = async (options) => {
  const entries = await videoEntries(options);
  return entries.reduce((total, entry) => total + entry.size, 0);
};

const housekeep = async () => {
  // Only videos already tracked BEFORE the bucket listing starts may be
  // dropped for "missing from R2". The listing is a snapshot from the moment
  // it was requested; a video uploaded and registered while it was in flight
  // is not in that snapshot, and dropping it would leave its file orphaned in
  // R2 with no library entry (this happened on busy raid nights).
  const trackedBeforeListing = new Set(state.videos.map((video) => video.videoKey));
  let entries = await videoEntries({ fresh: true });
  let usage = entries.reduce((total, entry) => total + entry.size, 0);
  let changed = false;

  // Drop metadata for anything that no longer actually exists in R2.
  state.videos = state.videos.filter(
    (video) =>
      !trackedBeforeListing.has(video.videoKey) ||
      entries.some((entry) => entry.video.videoKey === video.videoKey),
  );

  entries = entries
    .filter((entry) => !entry.video.protected)
    .sort(
      (left, right) =>
        Number(left.video.start || left.lastModified?.getTime() || 0) -
        Number(right.video.start || right.lastModified?.getTime() || 0),
    );

  const toDelete = [];
  for (const entry of entries) {
    if (usage <= limitBytes()) break;
    toDelete.push(entry.video.videoKey);
    state.videos = state.videos.filter(
      (video) => video.videoKey !== entry.video.videoKey,
    );
    usage -= entry.size;
    changed = true;
  }
  if (toDelete.length > 0) {
    await r2DeleteObjects(toDelete);
    invalidateListingCache();
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

// ---- Download URLs (served entirely by the Worker + R2) -------------------

const downloadUrlCache = new Map();
const signedDownloadUrl = (guild, key) => {
  const cacheKey = `${guild}\0${key}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = downloadUrlCache.get(cacheKey);

  // See DOWNLOAD_TOKEN_TTL_SECONDS above for why this stays stable for a
  // long time rather than being reissued on every metadata poll.
  if (cached && cached.expires > now + 5 * 60) return cached.url;

  const expires = now + DOWNLOAD_TOKEN_TTL_SECONDS;
  const token = encodeToken({ action: 'download', guild, key, exp: expires });
  const url = `${WORKER_URL}/download/${token}`;
  downloadUrlCache.set(cacheKey, { expires, url });
  return url;
};

const metadataFor = (video) => ({
  ...video,
  signedVideoKey: signedDownloadUrl(GUILD, video.videoKey),
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

    const now = Math.floor(Date.now() / 1000);
    state.knownUsers[login.discordId] = {
      userName: login.userName,
      lastLogin: now,
    };
    await persist();

    const token = encodeToken({
      action: 'session',
      guild: GUILD,
      discordId: login.discordId,
      userName: login.userName,
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
    });
    return json(res, 200, {
      token,
      userName: login.userName,
      guildName: GUILD,
    });
  }

  if (parts[1] === 'admin') {
    if (!ADMIN_SECRET) return fail(res, 404, 'Admin API is not configured');

    const provided = req.headers['x-admin-secret'] || '';
    if (!constantTimeEqual(String(provided), ADMIN_SECRET)) {
      return fail(res, 401, 'Invalid admin secret');
    }

    if (parts[2] === 'users' && req.method === 'GET') {
      const now = Math.floor(Date.now() / 1000);
      const users = Object.entries(state.knownUsers).map(([discordId, info]) => ({
        discordId,
        userName: info.userName,
        lastLogin: info.lastLogin,
        revoked: Boolean(
          (state.revokedUsers[discordId] &&
            state.revokedUsers[discordId] > (info.lastLogin || 0)) ||
            state.revokedAllBefore > (info.lastLogin || 0),
        ),
      }));
      return json(res, 200, { now, users });
    }

    if (parts[2] === 'revoke' && req.method === 'POST') {
      const body = await readBody(req, 4 * 1024);
      if (typeof body.discordId !== 'string' || !body.discordId) {
        return fail(res, 400, 'discordId is required');
      }
      state.revokedUsers[body.discordId] = Math.floor(Date.now() / 1000);
      await persist();
      return json(res, 200, {});
    }

    if (parts[2] === 'revoke-all' && req.method === 'POST') {
      state.revokedAllBefore = Math.floor(Date.now() / 1000);
      await persist();
      return json(res, 200, {});
    }

    // Preview only -- lists what a delete pass would remove, without
    // touching anything. Run this first and actually look at it.
    if (parts[2] === 'orphans' && parts.length === 3 && req.method === 'GET') {
      const orphans = await findOrphanedR2Objects();
      return json(res, 200, {
        count: orphans.length,
        totalBytes: orphans.reduce((total, o) => total + o.size, 0),
        orphans: orphans.map((o) => ({
          key: o.key,
          size: o.size,
          lastModified: o.lastModified,
        })),
      });
    }

    // Re-scans (rather than trusting a client-supplied list) and actually
    // deletes whatever is still orphaned and still older than
    // ORPHAN_MIN_AGE_MS at the moment this runs.
    if (parts[2] === 'orphans' && parts[3] === 'delete' && req.method === 'POST') {
      const orphans = await findOrphanedR2Objects();
      const keys = orphans.map((o) => o.key);
      const failedKeys = new Set(await r2DeleteObjects(keys));
      invalidateListingCache();
      const deletedBytes = orphans
        .filter((o) => !failedKeys.has(o.key))
        .reduce((total, o) => total + o.size, 0);
      return json(res, 200, {
        deletedCount: keys.length - failedKeys.size,
        deletedBytes,
        failedCount: failedKeys.size,
        failedKeys: [...failedKeys],
      });
    }

    return fail(res, 404, 'Unknown admin route');
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
      const entries = await videoEntries();
      return json(
        res,
        200,
        entries.map((entry) => metadataFor(entry.video)),
      );
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const key = body.videoKey;
      if (!isSafeKey(key) || typeof body.videoName !== 'string') {
        return fail(res, 400, 'Invalid video metadata');
      }

      // Confirm the upload actually landed in R2 before trusting the client.
      if (!(await r2Exists(key))) return fail(res, 409, 'Video upload missing');

      state.videos = state.videos.filter((video) => video.videoKey !== key);
      state.videos.push({ ...body, videoKey: key });
      // New object in the bucket: any cached listing is now out of date.
      invalidateListingCache();
      await persist();
      await housekeep();
      return json(res, 200, {});
    }
  }

  if (parts[3] === 'video' && parts[4] && parts[5] === 'size') {
    if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
    const head = await r2HeadObject(parts[4]);
    if (!head) return fail(res, 404, 'Video not found');
    return json(res, 200, { bytes: head.ContentLength });
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
    if ((await usageBytes({ fresh: true })) + body.bytes > limitBytes()) {
      return fail(res, 413, 'Guild storage limit reached');
    }

    // The client PUTs the file straight to R2 with this URL -- never
    // touching this server. Same interface the client already used for the
    // old home-server upload URL, so no app changes needed on this side.
    const signed = await r2PresignedPutUrl(body.key, TOKEN_TTL_SECONDS);
    return json(res, 200, { signed });
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

    const matched = names
      .map((name) => state.videos.find((entry) => entry.videoName === name))
      .filter(Boolean);

    const failedKeys = new Set(await r2DeleteObjects(matched.map((video) => video.videoKey)));
    invalidateListingCache();

    // Only drop metadata for videos actually confirmed deleted from R2 --
    // a video that failed to delete stays visible in the app (and keeps
    // counting against quota) rather than silently disappearing from the
    // library while the bytes are still sitting in the bucket, unreachable
    // and unaccounted for.
    const failedVideos = matched.filter((video) => failedKeys.has(video.videoKey));
    state.videos = state.videos.filter(
      (video) => !matched.some((m) => m.videoKey === video.videoKey) || failedKeys.has(video.videoKey),
    );
    await persist();

    if (failedVideos.length > 0) {
      return fail(
        res,
        502,
        `Failed to delete ${failedVideos.length} of ${matched.length} video(s) from storage -- please retry`,
      );
    }
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
  if (!(await r2Exists(link.key))) return text(res, 404, 'Video not found');

  const video = state.videos.find((entry) => entry.videoKey === link.key);
  const title = video?.videoName || 'RoomFortyRecorder video';
  const source = `/link/${encodeURIComponent(id)}/video`;
  const likes = linkLikes(link);
  // Discord's link unfurler (and most other chat apps) reads these tags
  // from the raw HTML -- no JS execution -- to decide whether to render an
  // inline playable video instead of a plain link card. It needs the
  // og:video* trio pointed at a direct, unauthenticated, range-request-
  // capable video URL, which the Worker already provides.
  //
  // Width/height are a hint for the embed's aspect ratio, not something
  // Discord validates against the actual file -- if your guild mostly
  // records at a different resolution than 1920x1080, update these two
  // values to match, but a mismatch won't break playback.
  const embedVideoUrl = signedDownloadUrl(link.guild, link.key);
  const embedWidth = 1920;
  const embedHeight = 1080;
  const canonicalUrl = `${PUBLIC_URL || ''}/link/${encodeURIComponent(id)}`;
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="video.other">
<meta property="og:title" content="${htmlEscape(title)}">
<meta property="og:url" content="${htmlEscape(canonicalUrl)}">
<meta property="og:video" content="${htmlEscape(embedVideoUrl)}">
<meta property="og:video:secure_url" content="${htmlEscape(embedVideoUrl)}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${embedWidth}">
<meta property="og:video:height" content="${embedHeight}">
<meta name="twitter:card" content="player">
<title>${htmlEscape(title)}</title>
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

// Public share links now redirect straight to the Worker instead of this
// server streaming the bytes itself -- same as every other download.
const handleLinkVideo = async (req, res, id) => {
  const link = findLink(id);
  if (!link) return fail(res, 404, 'Link not found');
  if (!(await r2Exists(link.key))) return fail(res, 404, 'Video not found');

  return redirect(res, signedDownloadUrl(link.guild, link.key));
};

const handleLike = async (res, id) => {
  const link = findLink(id);
  if (!link) return fail(res, 404, 'Link not found');
  if (!(await r2Exists(link.key))) return fail(res, 404, 'Video not found');

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
  // Note: no /upload or /download routes anymore -- uploads go straight to
  // R2 via a presigned URL, and downloads go straight to the Worker. This
  // server never touches video bytes.
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
    console.log(`[guild-cloud] Metadata storage: ${STORAGE}`);
    console.log(`[guild-cloud] Video storage: R2 bucket "${R2_BUCKET}"`);
    console.log(`[guild-cloud] Playback via Worker: ${WORKER_URL || '(not set!)'}`);
    console.log(`[guild-cloud] Guild: ${GUILD}`);
  });
};

main().catch((error) => {
  console.error('[guild-cloud] Failed to start', error);
  process.exitCode = 1;
});
