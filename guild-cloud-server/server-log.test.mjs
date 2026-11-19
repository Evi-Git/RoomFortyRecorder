import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installServerLog, oldLogs, redact } from './server-log.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-log-'));

// A stand-in console that remembers what it printed.
const fakeConsole = () => {
  const printed = [];
  const make = (level) => (...args) => printed.push([level, ...args]);
  return { printed, log: make('log'), info: make('info'), warn: make('warn'), error: make('error') };
};

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('console output is copied to a daily file with a timestamp and level, and still printed', () => {
  const dir = tmp();
  const target = fakeConsole();
  const log = installServerLog({ dir, target, now: () => new Date(2026, 10, 19, 20, 30, 0) });
  target.log('hello', 'world', 3);
  target.info('[x] info');
  target.warn('careful %s', 'now');
  target.error('bad', new Error('boom'));
  log.close();
  const text = read(dir, 'server-2026-11-19.log');
  const lines = text.split('\n');
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO hello world 3$/);
  assert.match(lines[1], / INFO \[x\] info$/);
  assert.match(lines[2], / WARN careful now$/);
  assert.match(lines[3], / ERROR bad Error: boom$/);
  assert.match(text, /\n\s+at /); // the stack is in the file
  assert.equal(target.printed.length, 4); // and the real console printed all four
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the real console still prints while installed', () => {
  const dir = tmp();
  const target = fakeConsole();
  const log = installServerLog({ dir, target });
  target.log('a');
  target.error('b');
  assert.deepEqual(target.printed, [['log', 'a'], ['error', 'b']]);
  log.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a new day starts a new file', () => {
  const dir = tmp();
  const target = fakeConsole();
  let at = new Date(2026, 10, 19, 23, 59, 0);
  const log = installServerLog({ dir, target, now: () => at });
  target.log('late');
  at = new Date(2026, 10, 20, 0, 1, 0);
  target.log('early');
  log.close();
  assert.match(read(dir, 'server-2026-11-19.log'), /late/);
  assert.doesNotMatch(read(dir, 'server-2026-11-19.log'), /early/);
  assert.match(read(dir, 'server-2026-11-20.log'), /early/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('files older than keepDays are deleted at start and when the day changes', () => {
  const dir = tmp();
  for (const day of ['2026-10-01', '2026-11-04', '2026-11-05', '2026-11-18']) {
    fs.writeFileSync(path.join(dir, `server-${day}.log`), 'x');
  }
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep');
  const target = fakeConsole();
  let at = new Date(2026, 10, 19, 12, 0, 0);
  const log = installServerLog({ dir, target, keepDays: 14, now: () => at });
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    'notes.txt',
    'server-2026-11-05.log',
    'server-2026-11-18.log',
    'server-2026-11-19.log',
  ]);
  at = new Date(2026, 10, 20, 12, 0, 0); // 11-05 is now 15 days old
  target.log('next day');
  log.close();
  assert.equal(fs.existsSync(path.join(dir, 'server-2026-11-05.log')), false);
  assert.equal(fs.existsSync(path.join(dir, 'server-2026-11-18.log')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('oldLogs only picks server-*.log files past the limit', () => {
  const now = new Date(2026, 10, 19);
  assert.deepEqual(
    oldLogs(['server-2026-11-05.log', 'server-2026-11-04.log', 'other.log', 'server-x.log'], now, 14),
    ['server-2026-11-04.log'],
  );
});

test('a folder that cannot be written does not throw, warns once and still prints', () => {
  const dir = tmp();
  // A file where the folder should be: mkdir fails whoever runs the test.
  const blocked = path.join(dir, 'blocked');
  fs.writeFileSync(blocked, 'x');
  const target = fakeConsole();
  const log = installServerLog({ dir: path.join(blocked, 'logs'), target });
  assert.doesNotThrow(() => {
    target.log('one');
    target.error('two');
    target.warn('three');
  });
  const status = log.status();
  assert.equal(status.writable, false);
  assert.ok(status.lastError);
  const warnings = target.printed.filter((p) => p[0] === 'warn' && /Could not write the log file/.test(p[1]));
  assert.equal(warnings.length, 1);
  assert.equal(target.printed.filter((p) => p[1] === 'one' || p[1] === 'two').length, 2);
  log.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('status reports the file and that it is writable', () => {
  const dir = tmp();
  const target = fakeConsole();
  const log = installServerLog({ dir, target, now: () => new Date(2026, 10, 19, 1, 0, 0) });
  const status = log.status();
  assert.equal(status.writable, true);
  assert.equal(status.lastError, null);
  assert.equal(path.basename(status.file), 'server-2026-11-19.log');
  log.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('secrets, bearer tokens and URL query strings never reach the file', () => {
  const dir = tmp();
  const target = fakeConsole();
  const log = installServerLog({ dir, target, secrets: ['super-secret-value'], now: () => new Date(2026, 10, 19) });
  target.log('key super-secret-value used');
  target.error('Authorization: Bearer abc.def-123');
  target.warn('PUT https://bucket.r2.example.com/a.mp4?X-Amz-Signature=deadbeef&X-Amz-Credential=zzz failed');
  log.close();
  const text = read(dir, 'server-2026-11-19.log');
  assert.doesNotMatch(text, /super-secret-value|abc\.def|deadbeef|Credential/);
  assert.match(text, /https:\/\/bucket\.r2\.example\.com\/a\.mp4\?\[query hidden\] failed/);
  assert.equal(redact('no secrets here'), 'no secrets here');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a day stops being written at the byte cap, says so once, and starts again the next day', () => {
  const dir = tmp();
  const target = fakeConsole();
  let at = new Date(2026, 10, 19, 12, 0, 0);
  const log = installServerLog({ dir, target, maxBytes: 600, now: () => at });
  for (let i = 0; i < 50; i += 1) target.error(`failure number ${i} of many`);
  const text = read(dir, 'server-2026-11-19.log');
  assert.ok(Buffer.byteLength(text) < 900);
  assert.equal(text.split('log capped for today').length - 1, 1);
  assert.equal(target.printed.length, 50); // the console kept printing
  at = new Date(2026, 10, 20, 0, 5, 0);
  target.log('new day');
  log.close();
  assert.match(read(dir, 'server-2026-11-20.log'), /new day/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Basic and Bot credentials, a webhook URL and a short password are redacted', () => {
  const dir = tmp();
  const target = fakeConsole();
  const hook = 'https://discord.com/api/webhooks/123456/tok-abc_DEF';
  const log = installServerLog({ dir, target, secrets: [hook, 'pw12'], now: () => new Date(2026, 10, 19) });
  target.log(`post to ${hook} failed`);
  target.log('Authorization: Basic dXNlcjpwYXNz and Bot MTIz.abc.def');
  target.log('password was pw12');
  log.close();
  const text = read(dir, 'server-2026-11-19.log');
  assert.doesNotMatch(text, /tok-abc|123456|dXNlcjpwYXNz|MTIz|pw12/);
  assert.match(text, /Basic \[hidden\]/);
  assert.match(text, /Bot \[hidden\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed write after a successful open warns once, not every retry', () => {
  const dir = tmp();
  const target = fakeConsole();
  let at = new Date(2026, 10, 19, 12, 0, 0);
  const log = installServerLog({ dir, target, now: () => at });
  // Writes fail from now on (as on a full disk) though the file opens.
  const realWrite = fs.writeSync;
  fs.writeSync = () => { throw new Error('ENOSPC'); };
  try {
    for (let i = 0; i < 4; i += 1) {
      at = new Date(at.getTime() + 61000);
      target.log('x');
    }
  } finally {
    fs.writeSync = realWrite;
  }
  assert.equal(target.printed.filter((p) => p[0] === 'warn').length, 1);
  log.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
