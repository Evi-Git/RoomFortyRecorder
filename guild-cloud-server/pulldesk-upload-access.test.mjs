// Who may upload a pull's logs, and what a full log must be before it
// replaces anything. Real Mythic log from tests/logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createPullDesk } from './pulldesk.mjs';
import { mayUploadFor, scanFullLog } from './pull-upload-access.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = fs.readFileSync(path.join(here, '../tests/logs/retail/beloren_boss_hp.txt'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.includes('  ENCOUNTER_START,'));
const end = lines.findIndex((l) => l.includes('  ENCOUNTER_END,'));
const slice = `${lines.slice(start, end + 1).join('\n')}\n`;
const encounterId = 3182;
const encounterName = "Belo'ren, Child of Al'ar";
const difficultyId = 16;
const METERS = { v: 4, source: 'app', bucketSeconds: 5, duration: 172, damage: [], healing: [], taken: [], mitigation: [] };
const LOG = zlib.gzipSync(`${slice}ROOMFORTY_METERS ${JSON.stringify(METERS)}\n`);
const FULL = zlib.gzipSync(slice);

const setup = async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-access-'));
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
  const call = async (method, rest, body, who = '1') => {
    const req = body instanceof Buffer ? Object.assign(Readable.from([body]), { method }) : { method, body };
    Object.assign(req, { cloudUserId: who, cloudUserName: `Raider${who}` });
    const res = {};
    await desk.handle(req, res, rest, new URL('http://x/'));
    return res;
  };
  return { call, storage };
};

// Moves the server's clock (claim window, stale chosen raider) without waiting.
const withClock = async (fn) => {
  const real = Date.now;
  let offset = 0;
  Date.now = () => real() + offset;
  try {
    return await fn((ms) => {
      offset += ms;
    });
  } finally {
    Date.now = real;
  }
};

const claimBody = (lineCount) => ({ encounterId, encounterName, difficultyId, duration: 172, result: false, lines: lineCount });
const put = (call, id, part, bytes, who) => call('PUT', ['pulls', id, part], bytes, who);

test('mayUploadFor: only the chosen or backfilling raider, never an empty id', () => {
  assert.equal(mayUploadFor({ chosen: '1' }, '1'), true);
  assert.equal(mayUploadFor({ chosen: '1' }, '2'), false);
  assert.equal(mayUploadFor({ backfillBy: '2' }, '2'), true);
  assert.equal(mayUploadFor({ chosen: '1', backfillBy: '2' }, '2'), true);
  assert.equal(mayUploadFor({ chosen: '1', backfillBy: '2' }, '3'), false);
  assert.equal(mayUploadFor({ chosen: null, backfillBy: undefined }, ''), false);
  assert.equal(mayUploadFor({ chosen: '', backfillBy: '' }, ''), false);
  assert.equal(mayUploadFor({}, 'x'), false);
  assert.equal(mayUploadFor(null, 'x'), false);
});

test('scanFullLog reads encounter ids, specs and buffs, and enforces the output cap', async () => {
  const scan = await scanFullLog(FULL);
  assert.deepEqual([...scan.encounterIds], [encounterId]);
  assert.equal(scan.textBytes, Buffer.byteLength(slice));
  assert.ok(scan.specs.size > 0);

  const two = zlib.gzipSync('1/1/2026 10:00:00.000  ENCOUNTER_START,11,"A",16,20,1\r\n1/1/2026 10:01:00.000  ENCOUNTER_START,22,"B",16,20,1\r\n');
  assert.deepEqual([...(await scanFullLog(two)).encounterIds].sort(), [11, 22]);

  // 1 MB of zeros is a few hundred bytes gzipped: a small cap stops it.
  const bomb = zlib.gzipSync(Buffer.alloc(1024 * 1024));
  assert.ok(bomb.length < 2000);
  await assert.rejects(scanFullLog(bomb, { maxOutputBytes: 64 * 1024 }), (error) => error.status === 413);
  await assert.rejects(scanFullLog(Buffer.concat([Buffer.from([0x1f, 0x8b]), crypto.randomBytes(100)])), (error) => error.status === 400);
});

test('live: only the picked raider may send the logs; a standby raider after takeover', async () => {
  await withClock(async (advance) => {
    const { call } = await setup();
    const a = await call('POST', ['claim'], claimBody(500), '1');
    const b = await call('POST', ['claim'], claimBody(100), '2');
    const id = a.body.pullId;
    assert.equal(b.body.pullId, id);
    assert.ok(a.body.waitMs);
    // Nothing is accepted from anyone before the server has picked.
    assert.equal((await put(call, id, 'log', LOG, '1')).status, 403);
    advance(3500);
    assert.equal((await call('POST', ['claim'], claimBody(100), '2')).body.standby, true);
    assert.equal((await call('POST', ['claim'], claimBody(500), '1')).body.upload, true);

    const refusedLog = await put(call, id, 'log', LOG, '2');
    assert.equal(refusedLog.status, 403);
    assert.match(refusedLog.body.error, /Another raider/);
    assert.equal((await put(call, id, 'full', FULL, '2')).status, 403);
    assert.equal((await put(call, id, 'log', LOG, '3')).status, 403);

    const ok = await put(call, id, 'log', LOG, '1');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'ready');
    assert.equal((await put(call, id, 'full', FULL, '1')).body.status, 'stored');
  });
});

test('live: the uploader is stored by id next to the name', async () => {
  await withClock(async (advance) => {
    const { call, storage } = await setup();
    const a = await call('POST', ['claim'], claimBody(500), '7');
    advance(3500);
    await call('POST', ['claim'], claimBody(500), '7');
    assert.equal((await put(call, a.body.pullId, 'log', LOG, '7')).status, 200);
    const index = JSON.parse(await fsp.readFile(path.join(storage, 'pulldesk', 'index.json'), 'utf8'));
    assert.equal(index.pulls[0].uploadedBy, 'Raider7');
    assert.equal(index.pulls[0].uploadedById, '7');
  });
});

test('live: when the picked raider never uploads, the standby raider claims again and may upload', async () => {
  await withClock(async (advance) => {
    const { call } = await setup();
    const a = await call('POST', ['claim'], claimBody(500), '1');
    await call('POST', ['claim'], claimBody(100), '2');
    const id = a.body.pullId;
    advance(3500);
    assert.equal((await call('POST', ['claim'], claimBody(500), '1')).body.upload, true);
    assert.equal((await call('POST', ['claim'], claimBody(100), '2')).body.standby, true);
    assert.equal((await put(call, id, 'log', LOG, '2')).status, 403);

    advance(61 * 1000);
    const takeover = await call('POST', ['claim'], claimBody(100), '2');
    assert.equal(takeover.body.upload, true);
    assert.equal((await put(call, id, 'log', LOG, '2')).status, 200);
    assert.equal((await put(call, id, 'full', FULL, '2')).body.status, 'stored');
    // The first raider is no longer the one the server asked.
    assert.equal((await put(call, id, 'full', FULL, '1')).status, 403);
  });
});

test('backfill: the raider who asked may send the log and the full log; a third raider may not', async () => {
  const { call } = await setup();
  const at = Date.parse('2026-10-21T20:05:00');
  const pull = { encounterId, encounterName, difficultyId, startedAt: at, duration: 172, result: false, bossPercent: 61 };
  const taken = await call('POST', ['backfill'], pull, '2');
  assert.equal(taken.body.upload, true);
  const id = taken.body.pullId;

  assert.equal((await put(call, id, 'log', LOG, '3')).status, 403);
  assert.equal((await put(call, id, 'full', FULL, '3')).status, 403);
  // Nothing was stored by the refused uploads.
  assert.equal((await call('GET', ['pulls', id, 'full'])).status, 404);

  assert.equal((await put(call, id, 'log', LOG, '2')).body.status, 'ready');
  assert.equal((await put(call, id, 'full', FULL, '2')).body.status, 'stored');
});

test('backfill that only needs the full log: the log call is a no-op and the full log is stored', async () => {
  const { call } = await setup();
  const at = Date.parse('2026-10-21T20:05:00');
  const pull = { encounterId, encounterName, difficultyId, startedAt: at, duration: 172, result: false };
  const first = await call('POST', ['backfill'], pull, '2');
  const id = first.body.pullId;
  await put(call, id, 'log', LOG, '2');

  // A different raider's app sees the missing full log and backfills it.
  const again = await call('POST', ['backfill'], pull, '3');
  // (inside the other raider's 5 minute lock the first raider keeps it)
  assert.equal(again.body.busy, true);
  await withClock(async (advance) => {
    advance(6 * 60 * 1000);
    const second = await call('POST', ['backfill'], pull, '3');
    assert.equal(second.body.upload, true);
    assert.equal(second.body.pullId, id);
    assert.equal((await put(call, id, 'log', LOG, '3')).body.status, 'ready');
    assert.equal((await put(call, id, 'full', FULL, '3')).body.status, 'stored');
  });
});

test('a full log that is not a real log of this boss never replaces the stored one', async () => {
  const { call, storage } = await setup();
  const at = Date.parse('2026-10-21T20:05:00');
  const pull = { encounterId, encounterName, difficultyId, startedAt: at, duration: 172, result: false };
  const id = (await call('POST', ['backfill'], pull, '2')).body.pullId;
  assert.equal((await put(call, id, 'log', LOG, '2')).status, 200);
  assert.equal((await put(call, id, 'full', FULL, '2')).body.status, 'stored');
  const file = path.join(storage, 'pulldesk', 'full', `${id}.log.gz`);
  const before = await fsp.readFile(file);

  // Bigger, with a valid gzip header, but not a gzip stream.
  const garbage = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), crypto.randomBytes(FULL.length * 2)]);
  const bad = await put(call, id, 'full', garbage, '2');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not a gzipped log/);

  // Bigger, gzipped, but no ENCOUNTER_START.
  const noEncounter = zlib.gzipSync(crypto.randomBytes(FULL.length * 2).toString('hex'));
  const none = await put(call, id, 'full', noEncounter, '2');
  assert.equal(none.status, 400);
  assert.match(none.body.error, /no ENCOUNTER_START/);

  // Bigger, a valid log, but of another boss.
  const other = zlib.gzipSync(`${slice.replaceAll(`ENCOUNTER_START,${encounterId},`, 'ENCOUNTER_START,9999,')}${crypto.randomBytes(FULL.length * 2).toString('hex')}\n`);
  const wrong = await put(call, id, 'full', other, '2');
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /different boss/);

  assert.ok((await fsp.readFile(file)).equals(before));
  assert.equal((await fsp.readdir(path.dirname(file))).filter((n) => n.endsWith('.tmp')).length, 0);

  // A genuine, bigger log of the same boss still replaces it.
  const bigger = zlib.gzipSync(`${slice}${crypto.randomBytes(FULL.length * 2).toString('hex')}\n`);
  assert.equal((await put(call, id, 'full', bigger, '2')).body.status, 'stored');
  assert.ok((await fsp.readFile(file)).equals(bigger));
});

test('a filtered log for another boss is refused', async () => {
  const { call } = await setup();
  const at = Date.parse('2026-10-21T20:05:00');
  const pull = { encounterId, encounterName, difficultyId, startedAt: at, duration: 172, result: false };
  const id = (await call('POST', ['backfill'], pull, '2')).body.pullId;
  const other = zlib.gzipSync(slice.replaceAll(`ENCOUNTER_START,${encounterId},`, 'ENCOUNTER_START,9999,'));
  const wrong = await put(call, id, 'log', other, '2');
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /different boss/);
});
