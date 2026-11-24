// Per-address request limits for the guild server (audit S14).
//
// Caddy runs on the same PC and proxies every outside request to this server
// on loopback, so the visitor's address is the last entry of X-Forwarded-For
// (Caddy writes it; it overwrites or appends to whatever the visitor sent, so
// the last entry is always Caddy's own view). A loopback request with no
// X-Forwarded-For comes from this PC (MediaMTX, the updater, the test
// harness) and is never limited. Anything else that isn't loopback is keyed
// by its socket address.
//
// Each limit is a token bucket: `capacity` requests at once, refilled at
// `perSecond`. Buckets live in memory only (a restart forgets them) and the
// oldest are dropped past `maxKeys`, so a flood of addresses can't grow memory
// without bound.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The key an address is limited under. IPv6 addresses count by their /64
 * (one home or one server gets a whole /64, so a visitor could otherwise
 * switch addresses at will); IPv4-mapped IPv6 counts as the IPv4 address.
 */
export const addressKey = (address) => {
  const text = String(address || '').trim().toLowerCase().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) return mapped[1];
  if (!text.includes(':')) return text || 'unknown';
  const [head, tail, ...more] = text.split('::');
  if (more.length) return text; // not an address; still a stable key
  const front = head ? head.split(':') : [];
  const back = tail === undefined ? [] : tail ? tail.split(':') : [];
  const missing = 8 - front.length - back.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) return text;
  const groups = [...front, ...Array(missing).fill('0'), ...back];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
};

/**
 * Who sent the request: `{ address, local }`. `local` is true only for a
 * loopback request without X-Forwarded-For.
 */
export const clientAddress = (req) => {
  const remote = req.socket?.remoteAddress || '';
  const header = req.headers?.['x-forwarded-for'];
  const forwarded = Array.isArray(header) ? header.join(',') : header;
  if (LOOPBACK.has(remote)) {
    if (!forwarded) return { address: remote, local: true };
    const entries = String(forwarded)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const last = entries[entries.length - 1];
    return { address: last ? last.slice(0, 64) : remote, local: false };
  }
  return { address: remote || 'unknown', local: false };
};

/**
 * A token-bucket limiter. take(key) answers `{ ok: true }`, or
 * `{ ok: false, retryAfterSec }` once the key has used its burst.
 */
export const createLimiter = ({ capacity, perSecond, maxKeys = 20000, now = Date.now }) => {
  const buckets = new Map();
  const take = (key) => {
    const at = now();
    let bucket = buckets.get(key);
    if (bucket) {
      buckets.delete(key); // re-inserted below, so the Map stays oldest-first
      bucket.tokens = Math.min(capacity, bucket.tokens + ((at - bucket.at) / 1000) * perSecond);
      bucket.at = at;
    } else {
      bucket = { tokens: capacity, at };
    }
    buckets.set(key, bucket);
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / perSecond)) };
  };
  return { take, size: () => buckets.size };
};

/**
 * Remembers which (address, key) pairs were seen in the last `ttlMs`, for
 * one like per address per share link. Oldest first, capped at `maxKeys`.
 */
export const createSeenOnce = ({ ttlMs, maxKeys = 20000, now = Date.now }) => {
  const seen = new Map();
  /** True the first time in `ttlMs`; false for a repeat. */
  const first = (key) => {
    const at = now();
    const until = seen.get(key);
    if (until !== undefined && until > at) return false;
    seen.delete(key);
    seen.set(key, at + ttlMs);
    while (seen.size > maxKeys) seen.delete(seen.keys().next().value);
    return true;
  };
  return { first, size: () => seen.size };
};

// The limits, per address. `api` allows a burst big enough for the Logs page
// fetching a few hundred spell icons at once, then 10 a second.
export const LIMITS = {
  auth: { capacity: 20, perSecond: 20 / 60 }, // Discord sign-in and the code exchange
  like: { capacity: 10, perSecond: 10 / 60 }, // the share page's Like button
  public: { capacity: 120, perSecond: 2 }, // share pages, previews, /health, the recruiting page
  api: { capacity: 600, perSecond: 10 }, // the app's /api calls
};

/** Which limit a request falls under, from its decoded path parts. */
export const limitFor = (method, parts) => {
  if (parts[0] === 'auth') return 'auth';
  if (parts[0] === 'api' && parts[1] === 'auth') return 'auth';
  if (parts[0] === 'link' && parts[2] === 'like' && method === 'POST') return 'like';
  if (parts[0] === 'api') return 'api';
  return 'public';
};

/**
 * The server's limits. check(req, parts) answers `{ ok: true }` or
 * `{ ok: false, retryAfterSec, limit, address }`. `enabled: false` (the
 * GUILD_CLOUD_RATE_LIMIT=off setting) lets everything through. `log` is told
 * once a minute per address and limit while it is being refused.
 */
export const createRateLimits = ({ enabled = true, limits = LIMITS, now = Date.now, log = () => {} } = {}) => {
  const limiters = Object.fromEntries(
    Object.entries(limits).map(([name, spec]) => [name, createLimiter({ ...spec, now })]),
  );
  const lastLogged = new Map();
  const check = (req, parts) => {
    if (!enabled) return { ok: true };
    const { address, local } = clientAddress(req);
    if (local) return { ok: true };
    const limit = limitFor(req.method, parts);
    const result = limiters[limit].take(addressKey(address));
    if (result.ok) return result;
    const key = `${limit} ${address}`;
    const at = now();
    if (!(lastLogged.get(key) > at - 60000)) {
      lastLogged.delete(key);
      lastLogged.set(key, at);
      while (lastLogged.size > 1000) lastLogged.delete(lastLogged.keys().next().value);
      log(`Too many requests from ${address} (${limit}); refusing for ${result.retryAfterSec} s`);
    }
    return { ...result, limit, address };
  };
  return { check };
};
