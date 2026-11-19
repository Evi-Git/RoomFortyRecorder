import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHealth } from './health.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-health-'));
const good = { loaded: true, restoredAt: null, saveError: false };
const make = (opts) => {
  const warnings = [];
  const health = createHealth({
    version: 'v1.9.134',
    warn: (m) => warnings.push(m),
    logStatus: () => ({ writable: true, lastError: null }),
    getState: () => good,
    ...opts,
  });
  return { health, warnings };
};

test('healthy: 200, ok, checks, version and no paths', async () => {
  const storage = tmp();
  const { health } = make({ storage });
  const { status, body } = await health.check();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.version, 'v1.9.134');
  assert.deepEqual(body.checks, { storage: { ok: true }, state: { ok: true }, log: { ok: true } });
  assert.equal(typeof body.uptimeSec, 'number');
  assert.equal(JSON.stringify(body).includes(storage), false);
  assert.deepEqual(fs.readdirSync(storage), []); // the probe file is gone
  fs.rmSync(storage, { recursive: true, force: true });
});

test('a storage folder that is gone is a 503', async () => {
  const storage = path.join(tmp(), 'missing');
  const { health, warnings } = make({ storage });
  const { status, body } = await health.check();
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.checks.storage.ok, false);
  assert.equal(JSON.stringify(body).includes(storage), false);
  assert.equal(warnings.length, 1);
  await health.check();
  assert.equal(warnings.length, 1); // said once, not per poll
});

test('a storage folder that cannot be written is a 503', async () => {
  const dir = tmp();
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x'); // a file where a folder should be
  const { health } = make({ storage: file });
  assert.equal((await health.check()).status, 503);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('state not loaded, or the last save failed, is a 503', async () => {
  const storage = tmp();
  let state = { loaded: false, restoredAt: null, saveError: false };
  const { health } = make({ storage, getState: () => state });
  let r = await health.check();
  assert.equal(r.status, 503);
  assert.equal(r.body.checks.state.ok, false);
  state = { loaded: true, restoredAt: null, saveError: true };
  r = await health.check();
  assert.equal(r.status, 503);
  state = good;
  r = await health.check();
  assert.equal(r.status, 200);
  fs.rmSync(storage, { recursive: true, force: true });
});

test('warnings (log file, restored state) do not fail health', async () => {
  const storage = tmp();
  const { health } = make({
    storage,
    logStatus: () => ({ writable: false, lastError: 'EACCES' }),
    getState: () => ({ loaded: true, restoredAt: 1, saveError: false }),
  });
  const { status, body } = await health.check();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.checks.log.warning);
  assert.ok(body.checks.state.warning);
  fs.rmSync(storage, { recursive: true, force: true });
});

test('the storage probe is cached for a few seconds', async () => {
  const storage = tmp();
  let at = 1000000;
  const { health } = make({ storage, now: () => at });
  assert.equal((await health.check()).status, 200);
  fs.rmSync(storage, { recursive: true, force: true });
  at += 5000;
  assert.equal((await health.check()).status, 200); // still the cached answer
  at += 6000;
  assert.equal((await health.check()).status, 503);
});
