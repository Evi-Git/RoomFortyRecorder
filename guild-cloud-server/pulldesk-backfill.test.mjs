// Upload from combat log: pulls the app didn't send live, backfilled from a
// raider's saved log. Uses the real Mythic log in tests/logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
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
const encounterName = "Belo'ren, Child of Al'ar";
const difficultyId = 16;

const setup = async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-backfill-'));
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    wcl: { configured: false },
  });
  await desk.ready();
  const call = async (method, rest, body, query = '', who = '1') => {
    const res = {};
    const req = body instanceof Buffer ? Object.assign(Readable.from([body]), { method }) : { method, body };
    Object.assign(req, { cloudUserId: who, cloudUserName: who === '1' ? 'Evi' : `Raider${who}` });
    await desk.handle(req, res, rest, new URL(`http://x/${query}`));
    return res;
  };
  return { call };
};

test('backfill a pull from a saved log, then skip it the second time', async () => {
  const { call } = await setup();
  const startedAt = Date.parse('2026-10-21T20:05:00');
  const pull = { encounterId: Number(encounterId), encounterName, difficultyId: Number(difficultyId), startedAt, duration: 172, result: false, bossPercent: 61 };

  const first = await call('POST', ['backfill'], pull);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.upload, true);

  const uploaded = await call('PUT', ['pulls', first.body.pullId, 'log'], zlib.gzipSync(slice));
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.status, 'ready');

  const again = await call('POST', ['backfill'], { ...pull, startedAt: startedAt + 2000 });
  assert.equal(again.body.upload, false);

  // It's a full report on the right night, with the recording's boss %.
  const list = await call('GET', ['pulls'], undefined, '?days=120');
  assert.equal(list.body.pulls.length, 1);
  assert.equal(list.body.pulls[0].night, '2026-10-21');
  assert.equal(list.body.pulls[0].bossPercent, 61);
  assert.ok(list.body.pulls[0].deaths > 0);

  const night = await call('GET', ['summary', 'night', '2026-10-21']);
  assert.equal(night.body.bosses[0].pulls, 1);
});

test('backfill skips untracked difficulties and rejects bad input', async () => {
  const { call } = await setup();
  assert.equal((await call('POST', ['backfill'], { encounterId: 1, difficultyId: 15, startedAt: Date.now() - 1e6, duration: 10 })).body.skip, true);
  assert.equal((await call('POST', ['backfill'], { encounterId: 1, difficultyId: 16, startedAt: Date.now() + 3600e3, duration: 10 })).status, 400);
});

test('automatic backfill: check finds only missing pulls; one raider at a time', async () => {
  const { call } = await setup();
  const at = Date.parse('2026-10-21T20:05:00');
  const pulls = [
    { encounterId, difficultyId, startedAt: at },
    { encounterId, difficultyId, startedAt: at + 600000 },
    { encounterId, difficultyId: 15, startedAt: at + 900000 }, // not tracked
  ];
  assert.deepEqual((await call('POST', ['backfill', 'check'], { pulls })).body.missing, [0, 1]);

  // Raider 2's app takes pull 0; raider 3's app is told to leave it.
  const taken = await call('POST', ['backfill'], { ...pulls[0], encounterName, duration: 172 }, '', '2');
  assert.equal(taken.body.upload, true);
  assert.deepEqual((await call('POST', ['backfill', 'check'], { pulls }, '', '3')).body.missing, [1]);
  const busy = await call('POST', ['backfill'], { ...pulls[0], encounterName, duration: 172 }, '', '3');
  assert.equal(busy.body.upload, false);
  assert.equal(busy.body.busy, true);

  // Once the log lands, nobody needs it.
  await call('PUT', ['pulls', taken.body.pullId, 'log'], zlib.gzipSync(slice), '', '2');
  assert.deepEqual((await call('POST', ['backfill', 'check'], { pulls }, '', '2')).body.missing, [1]);
});
