import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressKey,
  clientAddress,
  createLimiter,
  createRateLimits,
  createSeenOnce,
  limitFor,
} from './rate-limit.mjs';

const req = (remoteAddress, forwarded, method = 'GET') => ({
  method,
  socket: { remoteAddress },
  headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
});

test('clientAddress: loopback without X-Forwarded-For is local', () => {
  for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.deepEqual(clientAddress(req(remote)), { address: remote, local: true });
  }
});

test('clientAddress: through Caddy, the last X-Forwarded-For entry is the visitor', () => {
  assert.deepEqual(clientAddress(req('127.0.0.1', '203.0.113.9')), { address: '203.0.113.9', local: false });
  // A visitor can put anything in front; Caddy's own entry is last.
  assert.deepEqual(clientAddress(req('127.0.0.1', '10.0.0.1, 1.1.1.1 ,203.0.113.9')), {
    address: '203.0.113.9',
    local: false,
  });
  assert.deepEqual(clientAddress(req('::1', ['10.0.0.1', '198.51.100.4'])), { address: '198.51.100.4', local: false });
  // An empty header from loopback is still not trusted as local.
  assert.equal(clientAddress(req('127.0.0.1', ' , ')).local, false);
});

test('clientAddress: a direct outside connection is keyed by its socket, X-Forwarded-For ignored', () => {
  assert.deepEqual(clientAddress(req('198.51.100.7', '127.0.0.1')), { address: '198.51.100.7', local: false });
  assert.deepEqual(clientAddress({ headers: {} }), { address: 'unknown', local: false });
});

test('addressKey: IPv4 as is, IPv6 by /64, mapped IPv4 as IPv4', () => {
  assert.equal(addressKey('203.0.113.9'), '203.0.113.9');
  assert.equal(addressKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'));
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.equal(addressKey('fe80::1%eth0'), addressKey('fe80::2'));
  assert.equal(addressKey(''), 'unknown');
});

test('limitFor: sign-in, like, api and everything else', () => {
  assert.equal(limitFor('GET', ['auth', 'discord', 'start']), 'auth');
  assert.equal(limitFor('POST', ['api', 'auth', 'discord', 'exchange']), 'auth');
  assert.equal(limitFor('POST', ['link', 'abc', 'like']), 'like');
  assert.equal(limitFor('GET', ['link', 'abc', 'like']), 'public');
  assert.equal(limitFor('GET', ['link', 'abc', 'video']), 'media');
  assert.equal(limitFor('GET', ['link', 'abc', 'thumb.jpg']), 'media');
  assert.equal(limitFor('GET', ['api', 'guild', 'Room Forty', 'pulldesk', 'pulls']), 'api');
  assert.equal(limitFor('GET', ['api', 'recruit', 'state']), 'api');
  assert.equal(limitFor('GET', ['link', 'abc']), 'public');
  assert.equal(limitFor('GET', ['health']), 'public');
  assert.equal(limitFor('GET', []), 'public');
});

test('createLimiter: a burst of `capacity`, then refills at `perSecond`', () => {
  let at = 1000000;
  const limiter = createLimiter({ capacity: 3, perSecond: 0.5, now: () => at });
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('a').ok, true);
  const refused = limiter.take('a');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 2); // one token takes 2 s at 0.5/s
  assert.equal(limiter.take('b').ok, true); // other keys are separate
  at += 1999;
  assert.equal(limiter.take('a').ok, false);
  at += 1;
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
  at += 60000; // refills to capacity, not past it
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
});

test('createLimiter: refused requests do not dig a deeper hole', () => {
  let at = 0;
  const limiter = createLimiter({ capacity: 1, perSecond: 1, now: () => at });
  assert.equal(limiter.take('a').ok, true);
  for (let i = 0; i < 50; i++) assert.equal(limiter.take('a').ok, false);
  at += 1000;
  assert.equal(limiter.take('a').ok, true);
});

test('createLimiter: drops the least recently used keys past maxKeys', () => {
  const limiter = createLimiter({ capacity: 1, perSecond: 0.001, maxKeys: 2, now: () => 0 });
  limiter.take('a');
  limiter.take('b');
  limiter.take('a'); // refused, but a is now the most recent
  limiter.take('c'); // b goes
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.take('b').ok, true); // b starts over (and a goes)
  assert.equal(limiter.take('c').ok, false);
});

test('createSeenOnce: true once per key within ttl, capped', () => {
  let at = 0;
  const seen = createSeenOnce({ ttlMs: 1000, maxKeys: 2, now: () => at });
  assert.equal(seen.first('x'), true);
  assert.equal(seen.first('x'), false);
  assert.equal(seen.first('y'), true);
  at += 1000;
  assert.equal(seen.first('x'), true); // expired
  seen.first('z');
  assert.equal(seen.size(), 2);
});

test('createRateLimits: local requests pass, outside ones are limited per address and logged once a minute', () => {
  let at = 0;
  const logs = [];
  const limits = createRateLimits({
    limits: { auth: { capacity: 1, perSecond: 1 }, like: { capacity: 1, perSecond: 1 }, public: { capacity: 2, perSecond: 1 }, media: { capacity: 1, perSecond: 1 }, api: { capacity: 1, perSecond: 1 } },
    now: () => at,
    log: (m) => logs.push(m),
  });
  for (let i = 0; i < 10; i++) assert.equal(limits.check(req('127.0.0.1'), ['health']).ok, true);

  const visitor = req('127.0.0.1', '203.0.113.9');
  assert.equal(limits.check(visitor, ['link', 'x']).ok, true);
  assert.equal(limits.check(visitor, ['link', 'x']).ok, true);
  const refused = limits.check(visitor, ['link', 'x']);
  assert.deepEqual(refused, { ok: false, retryAfterSec: 1, limit: 'public', address: '203.0.113.9' });
  assert.equal(limits.check(visitor, ['api', 'guild']).ok, true); // its own bucket
  assert.equal(limits.check(req('127.0.0.1', '198.51.100.1'), ['link', 'x']).ok, true);

  limits.check(visitor, ['link', 'x']);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /203\.0\.113\.9 \(public\)/);
  at += 61000;
  limits.check(visitor, ['link', 'x']);
  limits.check(visitor, ['link', 'x']);
  limits.check(visitor, ['link', 'x']);
  assert.equal(logs.length, 2);
});

test('createRateLimits: off lets everything through', () => {
  const limits = createRateLimits({ enabled: false, limits: { auth: { capacity: 0, perSecond: 1 }, like: { capacity: 0, perSecond: 1 }, public: { capacity: 0, perSecond: 1 }, media: { capacity: 0, perSecond: 1 }, api: { capacity: 0, perSecond: 1 } } });
  assert.equal(limits.check(req('203.0.113.9'), ['api']).ok, true);
});

test('createLimiter: a clock that steps back does not lock anyone out', () => {
  let at = 10_000_000;
  const limiter = createLimiter({ capacity: 2, perSecond: 1, now: () => at });
  assert.equal(limiter.take('a').ok, true);
  at -= 60 * 60 * 1000; // a time resync moves the clock back an hour
  assert.equal(limiter.take('a').ok, true); // the one token left
  const refused = limiter.take('a');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 1);
  at += 1000;
  assert.equal(limiter.take('a').ok, true);
});

test('createRateLimits: one log line per /64, and at most maxLogsPerMinute in all', () => {
  let at = 0;
  const logs = [];
  const one = { capacity: 0, perSecond: 1 };
  const limits = createRateLimits({
    limits: { auth: one, like: one, public: one, media: one, api: one },
    now: () => at,
    log: (m) => logs.push(m),
    maxLogsPerMinute: 3,
  });
  for (let i = 1; i <= 50; i++) limits.check(req('127.0.0.1', `2001:db8:1:2::${i.toString(16)}`), ['link']);
  assert.equal(logs.length, 1); // one /64, one line
  for (let i = 1; i <= 50; i++) limits.check(req('127.0.0.1', `198.51.100.${i}`), ['link']);
  assert.equal(logs.length, 3); // capped
  at += 60000;
  limits.check(req('127.0.0.1', '192.0.2.1'), ['link']);
  assert.match(logs[3], /^48 more refused addresses not logged/);
  assert.equal(logs.length, 5);
});
