// A restart during analysis, and analyses that keep failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createPullDesk, PREP_VERSION } from './pulldesk.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = fs.readFileSync(path.join(here, '../tests/logs/retail/beloren_boss_hp.txt'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.includes('  ENCOUNTER_START,'));
const end = lines.findIndex((l) => l.includes('  ENCOUNTER_END,'));
const slice = `${lines.slice(start, end + 1).join('\n')}\n`;
const METERS = { v: 4, source: 'app', bucketSeconds: 5, duration: 172, damage: [], healing: [], taken: [], mitigation: [] };
const LOG = zlib.gzipSync(`${slice}ROOMFORTY_METERS ${JSON.stringify(METERS)}\n`);
const startedAt = Date.parse('2026-10-21T20:05:00');

const basePull = (fields) => ({
  id: 'p1',
  encounterId: 3182,
  encounterName: "Belo'ren, Child of Al'ar",
  difficultyId: 16,
  night: '2026-10-21',
  pullNumber: 1,
  totalPullNumber: 1,
  createdAt: startedAt,
  startedAt,
  result: 'wipe',
  duration: 172,
  bossPercent: 61,
  hasLog: true,
  ...fields,
});

/** A server whose storage already holds `pulls` (and p1's log). */
const serverWith = async (pulls) => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-recovery-'));
  const dir = path.join(storage, 'pulldesk');
  await fsp.mkdir(path.join(dir, 'logs'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'logs', 'p1.log.gz'), LOG);
  await fsp.writeFile(path.join(dir, 'index.json'), JSON.stringify({ pulls, bosses: {}, settings: {} }));
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
  await desk.idle();
  const call = async (method, rest, body, query = '') => {
    const res = {};
    const req = { method, body, cloudUserId: '1', cloudUserName: 'Evi' };
    await desk.handle(req, res, rest, new URL(`http://x/${query}`));
    return res;
  };
  return { call, dir };
};

const check = (call) =>
  call('POST', ['backfill', 'check'], {
    pulls: [{ encounterId: 3182, difficultyId: 16, startedAt }],
  });

test('a pull a restart left analyzing is finished from its log', async () => {
  const { call, dir } = await serverWith([basePull({ status: 'analyzing' })]);
  const index = JSON.parse(await fsp.readFile(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(index.pulls[0].status, 'ready');
  const list = await call('GET', ['pulls'], undefined, '?days=120');
  assert.equal(list.body.pulls[0].status, 'ready');
  assert.ok(list.body.pulls[0].deaths > 0);
});

test('a failed pull is asked for again, until it has failed too often', async () => {
  const once = await serverWith([basePull({ status: 'failed', failures: 1, failedPrep: PREP_VERSION })]);
  assert.deepEqual((await check(once.call)).body.missing, [0]);

  const often = await serverWith([basePull({ status: 'failed', failures: 3, failedPrep: PREP_VERSION })]);
  assert.deepEqual((await check(often.call)).body.missing, []);

  // New analysis code (another PREP_VERSION) tries again.
  const older = await serverWith([basePull({ status: 'failed', failures: 3, failedPrep: PREP_VERSION - 1 })]);
  assert.deepEqual((await check(older.call)).body.missing, [0]);
});
