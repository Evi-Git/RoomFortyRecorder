import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_GAP_MS,
  KEEP_DAYS,
  KEEP_RECENT,
  backupDirOf,
  backupNow,
  backupsToPrune,
  listBackups,
  readJsonSafe,
  writeFileAtomic,
  writeJsonSafe,
} from './safe-json.mjs';
import { createCoach } from './coach.mjs';

const HOUR = 3600000;
const DAY = 86400000;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-safe-json-'));
const quiet = () => {};

test('a save replaces the file and leaves no temp file behind', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'deep', 'state.json');
  await writeJsonSafe(file, { a: 1 });
  await writeJsonSafe(file, '{"a":2}');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json']);
});

test('saves at the same moment do not trip over each other', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'cache.json');
  await Promise.all(Array.from({ length: 25 }, (_, i) => writeJsonSafe(file, { i })));
  assert.equal(typeof JSON.parse(fs.readFileSync(file, 'utf8')).i, 'number');
  assert.deepEqual(fs.readdirSync(dir), ['cache.json']);
});

test('a failed save keeps the old file and cleans up', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  await writeJsonSafe(file, { ok: true });
  // A folder where the file should go makes the rename fail.
  const blocked = path.join(dir, 'blocked.json');
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(blocked, 'x'), '');
  await assert.rejects(writeFileAtomic(blocked, '{}'));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['blocked.json', 'state.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
});

test('backups: one an hour, holding the file as it was before the save', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  const t0 = Date.parse('2026-11-15T20:00:00Z');
  await writeJsonSafe(file, { v: 1 }, { backup: true, now: t0 });
  assert.equal((await listBackups(file)).length, 0, 'nothing to copy on the first save');
  await writeJsonSafe(file, { v: 2 }, { backup: true, now: t0 + 1000 });
  await writeJsonSafe(file, { v: 3 }, { backup: true, now: t0 + 2000 });
  let backups = await listBackups(file);
  assert.equal(backups.length, 1, 'no second copy inside the hour');
  assert.deepEqual(JSON.parse(fs.readFileSync(backups[0].file, 'utf8')), { v: 1 });
  await writeJsonSafe(file, { v: 4 }, { backup: true, now: t0 + 1000 + BACKUP_GAP_MS });
  backups = await listBackups(file);
  assert.equal(backups.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(backups[0].file, 'utf8')), { v: 3 });
  assert.equal(path.dirname(backups[0].file), backupDirOf(file));
});

test('backups of two files in one folder stay apart', async () => {
  const dir = tempDir();
  const a = path.join(dir, 'coach.json');
  const b = path.join(dir, 'coach.extra.json');
  fs.writeFileSync(a, '{"a":1}');
  fs.writeFileSync(b, '{"b":1}');
  await backupNow(a, { now: Date.parse('2026-11-15T20:00:00Z') });
  await backupNow(b, { now: Date.parse('2026-11-15T21:00:00Z') });
  assert.equal((await listBackups(a)).length, 1);
  assert.equal((await listBackups(b)).length, 1);
});

test('a damaged file is never copied over good backups', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{"videos": [');
  assert.equal(await backupNow(file, { log: quiet }), null);
  assert.equal((await listBackups(file)).length, 0);
});

test('pruning keeps the newest copies, then one a day for two weeks', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  // One copy an hour for 30 days, newest first.
  const backups = Array.from({ length: 30 * 24 }, (_, i) => ({ file: `b${i}`, at: now - i * HOUR }));
  const pruned = new Set(backupsToPrune(backups, now).map((b) => b.file));
  const kept = backups.filter((b) => !pruned.has(b.file));
  for (let i = 0; i < KEEP_RECENT; i += 1) assert.ok(!pruned.has(`b${i}`));
  assert.ok(kept.length >= KEEP_RECENT + KEEP_DAYS - 1 && kept.length <= KEEP_RECENT + KEEP_DAYS + 1, String(kept.length));
  assert.ok(kept.every((b) => now - b.at <= KEEP_DAYS * DAY));
});

test('loading: a normal file reads and gets a start-up copy', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{"videos":[1,2]}');
  const read = await readJsonSafe(file, { log: quiet });
  assert.equal(read.from, 'file');
  assert.deepEqual(read.value, { videos: [1, 2] });
  assert.equal((await listBackups(file)).length, 1);
});

test('loading: no file and no backups is a first run', async () => {
  const read = await readJsonSafe(path.join(tempDir(), 'state.json'), { log: quiet });
  assert.deepEqual(read, { value: null, from: 'none' });
});

test('loading: a damaged file comes back from the newest copy that reads', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  const t0 = Date.parse('2026-11-15T20:00:00Z');
  fs.writeFileSync(file, '{"v":"old"}');
  await backupNow(file, { now: t0 });
  fs.writeFileSync(file, '{"v":"good"}');
  await backupNow(file, { now: t0 + 2 * HOUR });
  // The newest copy is damaged too (half-written by a dying disk).
  fs.writeFileSync(path.join(backupDirOf(file), 'state.2026-11-16T00-00-00.json'), '{"v":');
  fs.writeFileSync(file, '{"v":"cut off');
  const logged = [];
  const read = await readJsonSafe(file, { log: (m) => logged.push(m), now: t0 + 5 * HOUR });
  assert.equal(read.from, 'backup');
  assert.deepEqual(read.value, { v: 'good' });
  assert.equal(read.at, t0 + 2 * HOUR);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 'good' });
  const aside = fs.readdirSync(dir).find((n) => n.startsWith('state.json.damaged-'));
  assert.ok(aside, 'the damaged file is kept');
  assert.equal(fs.readFileSync(path.join(dir, aside), 'utf8'), '{"v":"cut off');
  assert.equal(logged.length, 2);
});

test('loading: a deleted file comes back from its backup', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{"videos":[1]}');
  await backupNow(file);
  fs.unlinkSync(file);
  const read = await readJsonSafe(file, { log: quiet });
  assert.equal(read.from, 'backup');
  assert.deepEqual(read.value, { videos: [1] });
  assert.ok(fs.existsSync(file));
});

test('loading: damaged with no usable copy stops, and the file is left alone', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{"videos": [');
  await assert.rejects(readJsonSafe(file, { log: quiet }), /is damaged .* no backup that reads/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"videos": [');
});

test('coach: a failed save is reported and the next one still works', async () => {
  const storage = tempDir();
  const coach = createCoach({ storage, env: {}, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await coach.ready();
  const file = path.join(storage, 'coach.json');
  // A folder in the file's place makes the save fail.
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'x'), '');
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    await assert.rejects(coach.persist());
    await fsp.rm(file, { recursive: true });
    await coach.persist();
  } finally {
    console.error = original;
  }
  assert.ok(errors.length >= 1);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).flags);
});
