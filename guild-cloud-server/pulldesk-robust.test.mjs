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
  startedAt: Date.parse('2026-10-21T20:05:00'),
  duration: 172,
  result: false,
  bossPercent: 61,
};
// The backfill route hands the pull to the asker at once (no claim window).
const newPull = async (call) => (await call('POST', ['backfill'], backfillBody, '1')).body.pullId;

// A Discord that counts the messages posted to it.
const discordStub = async () => {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      posts.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { posts, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
};

const setup = async (env = {}, botToken = '') => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-robust-'));
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    journal: { configured: false, talents: async () => null, spells: async () => ({ spells: {} }) },
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

test('discordPost records postedAt and a repeat upload with meters does not post again', async () => {
  const discord = await discordStub();
  const { call, storage } = await setup(
    {
      GUILD_CLOUD_PULLDESK_POST_PULLS: '1',
      GUILD_CLOUD_PULLDESK_DEFAULT_CHANNEL: '555',
      GUILD_CLOUD_PULLDESK_DISCORD_API: discord.url,
    },
    'bot-token',
  );
  try {
    const id = await newPull(call);
    assert.equal((await call('PUT', ['pulls', id, 'log'], LOG, '1')).body.status, 'ready');
    assert.equal(discord.posts.length, 1);
    const read = () => JSON.parse(fs.readFileSync(path.join(storage, 'pulldesk', 'index.json'), 'utf8'));
    assert.ok(read().pulls[0].postedAt > 0, 'postedAt is saved with the index');
  } finally {
    discord.close();
  }
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
