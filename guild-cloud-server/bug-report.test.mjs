import test from 'node:test';
import assert from 'node:assert/strict';
import { createBugReport, BUG_COOLDOWN_MS } from './bug-report.mjs';

const fakeFetch = (ok = true) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status: ok ? 204 : 403 };
  };
  fn.calls = calls;
  return fn;
};

test('not configured without a webhook or channel', async () => {
  const bugs = createBugReport({ env: {}, fetchImpl: fakeFetch() });
  assert.equal(bugs.configured(), false);
  const r = await bugs.send({ discordId: '1', userName: 'a', text: 'broken' });
  assert.equal(r.status, 404);
});

test('posts to the webhook with no mentions', async () => {
  const fetchImpl = fakeFetch();
  const bugs = createBugReport({
    env: { GUILD_CLOUD_BUG_WEBHOOK: 'https://discord.example/hook' },
    fetchImpl,
  });
  const r = await bugs.send({
    discordId: '1',
    userName: 'Evi',
    text: 'Logs page\n@everyone crashes',
    version: '1.9.81',
    page: 'Logs',
  });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls[0].url, 'https://discord.example/hook');
  assert.deepEqual(fetchImpl.calls[0].body.allowed_mentions, { parse: [] });
  assert.match(fetchImpl.calls[0].body.content, /^\*\*Bug report\*\* from Evi · v1\.9\.81 · Logs\n> Logs page\n> @everyone crashes$/);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, undefined);
});

test('posts to the channel with the bot when no webhook', async () => {
  const fetchImpl = fakeFetch();
  const bugs = createBugReport({
    env: { GUILD_CLOUD_BUG_CHANNEL_ID: '123' },
    botToken: 'tok',
    fetchImpl,
  });
  const r = await bugs.send({ discordId: '1', userName: 'Evi', text: 'broken' });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls[0].url, 'https://discord.com/api/v10/channels/123/messages');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bot tok');
});

test('short text, cooldown and Discord failure', async () => {
  let t = 1000;
  const fetchImpl = fakeFetch();
  const bugs = createBugReport({
    env: { GUILD_CLOUD_BUG_WEBHOOK: 'https://h' },
    fetchImpl,
    now: () => t,
  });
  assert.equal((await bugs.send({ discordId: '1', text: ' a ' })).status, 400);
  assert.equal((await bugs.send({ discordId: '1', text: 'first' })).status, 200);
  assert.equal((await bugs.send({ discordId: '1', text: 'second' })).status, 429);
  assert.equal((await bugs.send({ discordId: '2', text: 'other raider' })).status, 200);
  t += BUG_COOLDOWN_MS;
  assert.equal((await bugs.send({ discordId: '1', text: 'third' })).status, 200);

  const failing = createBugReport({
    env: { GUILD_CLOUD_BUG_WEBHOOK: 'https://h' },
    fetchImpl: fakeFetch(false),
  });
  assert.equal((await failing.send({ discordId: '1', text: 'broken' })).status, 502);
});

test('long reports are cut to fit Discord', () => {
  const bugs = createBugReport({ env: { GUILD_CLOUD_BUG_WEBHOOK: 'https://h' } });
  const m = bugs.message({ userName: 'x', text: 'y'.repeat(5000) });
  assert.ok(m.length <= 2000);
});

test('a Discord that never answers gives a 502 after the timeout, and does not use up the cooldown', async () => {
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  const bugs = createBugReport({
    env: { GUILD_CLOUD_BUG_WEBHOOK: 'https://discord.example/hook' },
    fetchImpl,
    timeoutMs: 50,
  });
  const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout timers don't hold the loop open
  const r = await bugs.send({ discordId: '1', userName: 'a', text: 'broken' });
  clearTimeout(keepAlive);
  assert.equal(r.status, 502);
  const keepAlive2 = setTimeout(() => {}, 5000);
  const again = await bugs.send({ discordId: '1', userName: 'a', text: 'broken' });
  clearTimeout(keepAlive2);
  assert.equal(again.status, 502); // not 429: the failed send didn't count
});

test('two reports sent at the same moment: only one goes', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    await gate;
    return { ok: true, status: 204 };
  };
  const bugs = createBugReport({ env: { GUILD_CLOUD_BUG_WEBHOOK: 'https://h' }, fetchImpl });
  const a = bugs.send({ discordId: '1', userName: 'a', text: 'broken' });
  const b = bugs.send({ discordId: '1', userName: 'a', text: 'broken' });
  release();
  const statuses = (await Promise.all([a, b])).map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 429]);
  assert.equal(calls.length, 1);
});
