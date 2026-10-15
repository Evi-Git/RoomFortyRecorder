// RoomFortyRecorder R2 download Worker
//
// This deliberately re-implements only the token-verification + range-serving
// half of server.mjs's handleDownload -- nothing else. server.mjs remains the
// only place that ISSUES tokens (via signedDownloadUrl); this Worker only
// verifies and serves them. Same shared secret, same token format, so a
// token minted by server.mjs today will just work here unmodified.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64urlToBytes = (base64url) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const importHmacKey = (secret) =>
  crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

// Mirrors server.mjs's decodeToken() exactly: same base64url body + HMAC
// signature format, same action/exp checks. Verification uses
// crypto.subtle.verify, which is constant-time by construction -- no manual
// timing-safe-compare needed here the way server.mjs uses
// crypto.timingSafeEqual.
const decodeToken = async (token, expectedAction, secret) => {
  const [body, signature] = String(token).split('.');
  if (!body || !signature) throw new Error('Invalid token');

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlToBytes(signature),
    textEncoder.encode(body),
  );
  if (!valid) throw new Error('Invalid token');

  const payload = JSON.parse(textDecoder.decode(base64urlToBytes(body)));
  if (
    payload.action !== expectedAction ||
    typeof payload.exp !== 'number' ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new Error('Expired token');
  }
  return payload;
};

const withCors = (headers = {}) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  ...headers,
});

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json; charset=utf-8' }),
  });

// Same key-safety rule as server.mjs's isSafeKey/fileForKey -- belt and
// braces even though the token itself already constrains this.
const isSafeKey = (key) =>
  typeof key === 'string' &&
  key.length > 0 &&
  key.length <= 255 &&
  key.endsWith('.mp4') &&
  !key.includes('..') &&
  !key.includes('/') &&
  !key.includes('\0');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (url.pathname === '/health') {
      return json(200, { ok: true, worker: 'r2-download' });
    }

    // Expected path shape: /download/<token>  (mirrors server.mjs's route)
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] !== 'download' || request.method !== 'GET') {
      return json(404, { error: 'Not found' });
    }

    let payload;
    try {
      payload = await decodeToken(parts[1], 'download', env.GUILD_CLOUD_SECRET);
    } catch {
      return json(403, { error: 'Invalid or expired download URL' });
    }

    if (payload.guild !== env.GUILD_CLOUD_GUILD) {
      return json(404, { error: 'Unknown guild' });
    }

    if (!isSafeKey(payload.key)) {
      return json(400, { error: 'Invalid video key' });
    }

    // Same range-parsing logic as handleDownload's regex on the Range header.
    let offset = 0;
    let length;
    let status = 200;
    const rangeHeader = request.headers.get('range');

    const head = await env.VIDEOS.head(payload.key);
    if (!head) return json(404, { error: 'Video not found' });
    const size = head.size;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (!match) return json(416, { error: 'Invalid range' });

      let start;
      let end;
      if (match[1] === '') {
        const suffix = Number.parseInt(match[2], 10);
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else {
        start = Number.parseInt(match[1], 10);
        end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
      }
      end = Math.min(end, size - 1);

      if (start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: withCors({ 'Content-Range': `bytes */${size}` }),
        });
      }

      offset = start;
      length = end - start + 1;
      status = 206;
    }

    const object = await env.VIDEOS.get(
      payload.key,
      length !== undefined ? { range: { offset, length } } : undefined,
    );
    if (!object || !object.body) return json(404, { error: 'Video not found' });

    const headers = withCors({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Content-Length': String(length !== undefined ? length : size),
      'Cache-Control': 'private, max-age=0, no-store',
    });
    if (status === 206) {
      headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${size}`;
    }

    return new Response(object.body, { status, headers });
  },
};
