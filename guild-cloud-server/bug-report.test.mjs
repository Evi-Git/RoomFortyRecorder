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
