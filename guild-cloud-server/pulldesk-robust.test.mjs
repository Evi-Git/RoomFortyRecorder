// A repeated log PUT while a pull is analysing, one Discord post per pull, and
// the cached patched report. Real Mythic log from tests/logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createPullDesk } from './pulldesk.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = fs.readFileSync(path.join(here, '../tests/logs/retail/beloren_boss_hp.txt'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.includes('  ENCOUNTER_START,'));
const end = lines.findIndex((l) => l.includes('  ENCOUNTER_END,'));
const slice = `${lines.slice(start, end + 1).join('\n')}\n`;
const encounterId = 3182;
const METERS = { v: 4, source: 'app', bucketSeconds: 5, duration: 172, damage: [], healing: [], taken: [], mitigation: [] };
const LOG = zlib.gzipSync(`${slice}ROOMFORTY_METERS ${JSON.stringify(METERS)}\n`);
const backfillBody = {
  encounterId,
  encounterName: "Belo'ren, Child of Al'ar",
  difficultyId: 16,
  // Recent: a pull older than the log retention would have its log pruned.
  startedAt: Date.now() - 60 * 60 * 1000,
  duration: 172,
  result: false,
  bossPercent: 61,
};
// The backfill route hands the pull to the asker at once (no claim window).
const newPull = async (call) => (await call('POST', ['backfill'], backfillBody, '1')).body.pullId;

// A Discord that counts the messages posted to it.
// `answer(n)` (n = how many posts so far, this one included) can return
// { status, body } to fail it.
const discordStub = async (answer = () => ({ status: 200, body: {} })) => {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      posts.push({ url: req.url, body });
      const { status, body: reply } = answer(posts.length);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { posts, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
};

const setup = async (env = {}, botToken = '', existing = null, journalOverride = {}) => {
  const storage = existing || (await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-robust-')));
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    journal: { configured: false, talents: async () => null, spells: async () => ({ spells: {} }), ...journalOverride },
    botToken,
    env,
    wcl: { configured: false },
  });
  await desk.ready();
  const call = async (method, rest, body, who = '1') => {
    const req = body instanceof Buffer ? Object.assign(Readable.from([body]), { method }) : { method, body };
    Object.assign(req, { cloudUserId: who, cloudUserName: `Raider${who}` });
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(data) {
        this.raw = data;
      },
    };
    await desk.handle(req, res, rest, new URL('http://x/'));
    return res;
  };
  return { call, storage, desk };
};

test('a second PUT of the log while the pull is analysing is answered without a second analysis or post', async () => {
  const discord = await discordStub();
  const { call } = await setup(
    {
      GUILD_CLOUD_PULLDESK_POST_PULLS: '1',
      GUILD_CLOUD_PULLDESK_DEFAULT_CHANNEL: '555',
      GUILD_CLOUD_PULLDESK_DISCORD_API: discord.url,
    },
    'bot-token',
  );
  try {
    const id = await newPull(call);
    // Both uploads arrive together (a retry after a client timeout).
    const [a, b] = await Promise.all([
      call('PUT', ['pulls', id, 'log'], LOG, '1'),
      call('PUT', ['pulls', id, 'log'], LOG, '1'),
    ]);
    const statuses = [a.body.status, b.body.status].sort();
    assert.deepEqual(statuses, ['analyzing', 'ready']);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(discord.posts.length, 1, 'one Discord post');
  } finally {
    discord.close();
  }
});

const postEnv = (discord) => ({
  GUILD_CLOUD_PULLDESK_POST_PULLS: '1',
  GUILD_CLOUD_PULLDESK_DEFAULT_CHANNEL: '555',
  GUILD_CLOUD_PULLDESK_DISCORD_API: discord.url,
});
const PLAIN = zlib.gzipSync(slice); // a log without meters
const readIndex = (storage) => JSON.parse(fs.readFileSync(path.join(storage, 'pulldesk', 'index.json'), 'utf8'));
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

test('postedAt is saved, and a later log with meters for the same pull does not post again', async () => {
  const discord = await discordStub();
  const { call, storage } = await setup(postEnv(discord), 'bot-token');
  try {
    const id = await newPull(call);
    assert.equal((await call('PUT', ['pulls', id, 'log'], PLAIN, '1')).body.status, 'ready');
    await settle();
    assert.equal(discord.posts.length, 1);
    assert.ok(readIndex(storage).pulls[0].postedAt > 0, 'postedAt is saved with the index');
    // The repeat: the pull has a log but no meters, so this one is analysed again.
    assert.equal((await call('PUT', ['pulls', id, 'log'], LOG, '1')).body.status, 'ready');
    await settle();
    assert.equal(discord.posts.length, 1, 'still one post');
  } finally {
    discord.close();
  }
});

test('a pull from before postedAt existed is not posted again by a meters re-send', async () => {
  const discord = await discordStub();
  const first = await setup({});
  const id = await newPull(first.call);
  await first.call('PUT', ['pulls', id, 'log'], PLAIN, '1');
  const index = readIndex(first.storage);
  delete index.pulls[0].postedAt;
  fs.writeFileSync(path.join(first.storage, 'pulldesk', 'index.json'), JSON.stringify(index));
  const { call, storage } = await setup(postEnv(discord), 'bot-token', first.storage);
  try {
    assert.equal((await call('PUT', ['pulls', id, 'log'], LOG, '1')).body.status, 'ready');
    await settle();
    assert.equal(discord.posts.length, 0);
    assert.ok(readIndex(storage).pulls[0].postedAt > 0);
  } finally {
    discord.close();
  }
});

test('a pull saved as analyzing with no log is not stuck: it becomes claimed and takes an upload', async () => {
  const first = await setup({});
  const id = await newPull(first.call);
  const index = readIndex(first.storage);
  index.pulls[0].status = 'analyzing';
  index.pulls[0].hasLog = false;
  fs.writeFileSync(path.join(first.storage, 'pulldesk', 'index.json'), JSON.stringify(index));
  const { call } = await setup({}, '', first.storage);
  assert.equal((await call('PUT', ['pulls', id, 'log'], LOG, '1')).body.status, 'ready');
});

test('a re-analysis that is already running answers analyzing instead of starting another', async () => {
  const first = await setup({});
  const id = await newPull(first.call);
  assert.equal((await first.call('PUT', ['pulls', id, 'log'], LOG, '1')).body.status, 'ready');
  // The same server again, with a journal that holds the analysis open.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  let armed = false;
  const { call } = await setup({}, '', first.storage, {
    configured: true,
    spells: async () => {
      if (!armed) return { spells: {} };
      started();
      await gate;
      return { spells: {} };
    },
  });
  armed = true;
  const slow = call('POST', ['pulls', id, 'reanalyze'], {}, '1');
  await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 2000))]);
  const second = await call('POST', ['pulls', id, 'reanalyze'], {}, '1');
  release();
  const done = await slow;
  assert.deepEqual(second.body, { status: 'analyzing' });
  assert.equal(done.body.id, id);
});

test('a Discord post answered with 429 waits and tries once more', async () => {
  const discord = await discordStub((n) => (n === 1 ? { status: 429, body: { retry_after: 0.05 } } : { status: 200, body: {} }));
  const { call, storage } = await setup(postEnv(discord), 'bot-token');
  try {
    const id = await newPull(call);
    await call('PUT', ['pulls', id, 'log'], LOG, '1');
    await settle();
    assert.equal(discord.posts.length, 2);
    assert.ok(readIndex(storage).pulls[0].postedAt > 0);
  } finally {
    discord.close();
  }
});

test('a Discord post that fails is not counted as posted, so a later upload posts it', async () => {
  const discord = await discordStub((n) => (n === 1 ? { status: 500, body: {} } : { status: 200, body: {} }));
  const { call, storage } = await setup(postEnv(discord), 'bot-token');
  try {
    const id = await newPull(call);
    await call('PUT', ['pulls', id, 'log'], PLAIN, '1');
    await settle();
    assert.equal(discord.posts.length, 1);
    assert.equal(readIndex(storage).pulls[0].postedAt, undefined);
    await call('PUT', ['pulls', id, 'log'], LOG, '1');
    await settle();
    assert.equal(discord.posts.length, 2);
    assert.ok(readIndex(storage).pulls[0].postedAt > 0);
  } finally {
    discord.close();
  }
});

test('a Discord that refuses the connection does not count as posted', async () => {
  // A port that was just closed: connections are refused.
  const closed = await discordStub();
  closed.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const dead = { url: closed.url, posts: [] };
  const { call, storage } = await setup(postEnv(dead), 'bot-token');
  const id = await newPull(call);
  await call('PUT', ['pulls', id, 'log'], LOG, '1');
  await settle();
  assert.equal(readIndex(storage).pulls[0].postedAt, undefined);
});

test('the patched report is cached per pull and rebuilt when the stored report changes', async () => {
  const { call, storage } = await setup();
  const id = await newPull(call);
  assert.equal((await call('PUT', ['pulls', id, 'log'], LOG, '1')).body.status, 'ready');

  const first = await call('GET', ['pulls', id]);
  assert.equal(first.status, 200);
  const second = await call('GET', ['pulls', id]);
  assert.equal(second.raw, first.raw, 'repeat request returns the same bytes');
  assert.equal(second.raw, first.raw);
  const parsed = JSON.parse(first.raw.toString('utf8'));
  assert.equal(parsed.reset, false);
  assert.equal(typeof parsed.pullNumber, 'number');

  // A report rewritten on disk (re-analysis) is picked up.
  const file = path.join(storage, 'pulldesk', 'reports', `${id}.json`);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.marker = 'changed';
  fs.writeFileSync(file, JSON.stringify(stored));
  const third = await call('GET', ['pulls', id]);
  assert.equal(JSON.parse(third.raw.toString('utf8')).marker, 'changed');
});

test('the cached report is much cheaper than parsing and re-serialising a large one', async () => {
  const { call, storage } = await setup();
  const id = await newPull(call);
  await call('PUT', ['pulls', id, 'log'], LOG, '1');
  const file = path.join(storage, 'pulldesk', 'reports', `${id}.json`);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.padding = Array.from({ length: 60000 }, (_, i) => ({ t: i, name: `Raider${i % 20}`, spell: `Spell ${i}`, amount: i * 3 }));
  fs.writeFileSync(file, JSON.stringify(stored));
  const mb = (fs.statSync(file).size / 1e6).toFixed(1);

  const time = async () => {
    const t0 = process.hrtime.bigint();
    await call('GET', ['pulls', id]);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const cold = await time(); // reads, parses, re-serialises
  const warm = [];
  for (let i = 0; i < 5; i += 1) warm.push(await time());
  const best = Math.min(...warm);
  console.log(`report ${mb} MB: first request ${cold.toFixed(1)} ms, repeat ${best.toFixed(1)} ms`);
  assert.ok(best < cold, `repeat ${best} ms should beat first ${cold} ms`);
});
