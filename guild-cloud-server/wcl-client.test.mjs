import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWclClient, wclHandle } from './recruit-clients.mjs';

// A fake Warcraft Logs: counts sign-ins and answers every query with the
// hour's spend from `spent`.
const fakeWcl = ({ limit = 1000, spent = () => 0, resetIn = 1800 } = {}) => {
  const calls = { token: 0, query: 0 };
  const fetchImpl = async (url) => {
    if (url.endsWith('/oauth/token')) {
      calls.token += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true, status: 200, json: async () => ({ access_token: `t${calls.token}`, expires_in: 3600 }) };
    }
    calls.query += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { x: 1, rateLimitData: { limitPerHour: limit, pointsSpentThisHour: spent(), pointsResetIn: resetIn } },
      }),
    };
  };
  return { calls, fetchImpl };
};

test('handles share one sign-in, even when they ask at once', async () => {
  const fake = fakeWcl();
  const client = createWclClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake.fetchImpl });
  const one = client.forConsumer();
  const two = client.forConsumer();
  await Promise.all([one.query('{ a }'), two.query('{ b }'), client.query('{ c }')]);
  assert.equal(fake.calls.token, 1);
  assert.equal(fake.calls.query, 3);
});

test('every handle sees the hour spent through any of them; queries are counted per handle', async () => {
  let spent = 100;
  const fake = fakeWcl({ spent: () => spent });
  const client = createWclClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake.fetchImpl });
  const crawl = client.forConsumer();
  const desk = client.forConsumer();
  await crawl.query('{ a }');
  spent = 400;
  await crawl.query('{ a }');
  assert.equal(desk.usage.spentThisHour, 400);
  assert.equal(desk.usage.limitPerHour, 1000);
  assert.equal(desk.usage.queries, 0);
  assert.equal(crawl.usage.queries, 2);
  assert.equal(crawl.usage.spentByUs, 400); // as before: the first answer counts the hour so far
  // Copies (status routes spread or serialise it) carry the numbers.
  const copy = { ...crawl.usage };
  assert.deepEqual(Object.keys(copy).sort(), ['limitPerHour', 'queries', 'resetIn', 'spentByUs', 'spentThisHour']);
  assert.equal(JSON.parse(JSON.stringify(crawl.usage)).spentThisHour, 400);
  assert.ok(copy.resetIn > 1700 && copy.resetIn <= 1800);
});

test('a crawl pauses at its share while the pull desk handle still runs', async () => {
  const fake = fakeWcl({ spent: () => 900 });
  const logs = [];
  const client = createWclClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake.fetchImpl });
  const crawl = client.forConsumer({ log: (m) => logs.push(m) });
  const desk = client.forConsumer({ budgetShare: 0.95 });
  await desk.query('{ a }'); // learns 900 of 1000 spent

  const paused = crawl.query('{ b }');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(logs.join('\n'), /Used 900 of 1000 points this hour; pausing/);
  await desk.query('{ c }'); // 90% < 95%: goes straight through
  assert.equal(fake.calls.query, 2);

  crawl.stop();
  // The paused crawl notices Stop at its next check (within a second).
  await assert.rejects(paused, /Stopped/);
  // Stopping the crawl doesn't stop the pull desk.
  await desk.query('{ d }');
  assert.equal(fake.calls.query, 3);
});

test('stop and resume are per handle', async () => {
  const fake = fakeWcl();
  const client = createWclClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake.fetchImpl });
  const one = client.forConsumer();
  const two = client.forConsumer();
  one.stop();
  await assert.rejects(one.query('{ a }'), /Stopped/);
  await two.query('{ a }');
  one.resume();
  await one.query('{ a }');
  assert.equal(fake.calls.query, 2);
});

test('wclHandle: a handle of the given client, the given fake as is, or a client of its own', () => {
  const client = createWclClient({ clientId: 'a', clientSecret: 'b' });
  const handle = wclHandle(client, {}, { log: () => {} });
  assert.notEqual(handle, client);
  assert.equal(typeof handle.query, 'function');
  assert.equal(handle.configured, true);

  const fake = { configured: false };
  assert.equal(wclHandle(fake, {}), fake);

  const own = wclHandle(null, { clientId: '', clientSecret: '' });
  assert.equal(own.configured, false);
  assert.equal(typeof own.forConsumer, 'function');
});

test('after the hour resets, last hour\'s spend no longer pauses anyone', async () => {
  let spent = 950;
  const fake = fakeWcl({ spent: () => spent, resetIn: 0.05 }); // resets 50 ms after each answer
  const logs = [];
  const client = createWclClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake.fetchImpl, log: (m) => logs.push(m) });
  const crawl = client.forConsumer();
  await crawl.query('{ a }');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(crawl.usage.spentThisHour, 0);
  spent = 10;
  const started = Date.now();
  await crawl.query('{ b }');
  assert.ok(Date.now() - started < 1000, 'no wait');
  assert.deepEqual(logs, []);
  assert.equal(crawl.usage.spentThisHour, 10);
});

test('budget() says whether a handle would pause, and when the hour resets', async () => {
  const fake = fakeWcl({ spent: () => 900, resetIn: 600 });
  const client = createWclClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake.fetchImpl });
  const crawl = client.forConsumer({ budgetShare: 0.85 });
  const page = client.forConsumer({ budgetShare: 0.95 });
  assert.equal(crawl.budget().exhausted, false, 'nothing known yet');
  await page.query('{ a }');
  assert.equal(crawl.budget().exhausted, true);
  assert.equal(page.budget().exhausted, false);
  const resumes = crawl.budget().resumesAt - Date.now();
  assert.ok(resumes > 590000 && resumes <= 606000, `resumes in about 10 minutes (${resumes} ms)`);
  assert.equal(page.budget().resumesAt, null);
});
