import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  logUnhandledRejections,
  secretProblem,
  secretWarning,
  sendFile,
} from './startup.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

test('a missing, example or guessable secret is refused', () => {
  assert.match(secretProblem(undefined), /not set/);
  assert.match(secretProblem(''), /not set/);
  assert.match(secretProblem('   '), /not set/);
  assert.match(secretProblem('replace-with-a-long-random-value'), /example value/);
  assert.match(secretProblem('ChangeMe'), /example value/);
  assert.match(secretProblem('Room Forty:1234', ['Room Forty:1234']), /guessed/);
  // An empty guessable value never matches anything.
  assert.equal(secretProblem('k3Jq-real-value', ['']), null);
  assert.equal(secretProblem('k3Jq-real-value', ['Room Forty:1234']), null);
});

test('a short secret still works but is pointed out', () => {
  assert.equal(secretProblem('short-but-set'), null);
  assert.match(secretWarning('short-but-set'), /short \(13 characters\)/);
  assert.equal(secretWarning('x'.repeat(32)), null);
  assert.equal(secretWarning(''), null);
});

const fakeResponse = () => {
  const res = new EventEmitter();
  res.headersSent = false;
  res.status = null;
  res.body = '';
  res.destroyed = false;
  res.writeHead = (status) => {
    res.status = status;
    res.headersSent = true;
  };
  res.write = (chunk) => {
    res.body += chunk;
    return true;
  };
  res.end = (chunk) => {
    if (chunk) res.body += chunk;
    res.emit('finish');
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  return res;
};

test('sendFile answers 500 for a file that is gone instead of throwing', async () => {
  const res = fakeResponse();
  const logged = [];
  await new Promise((resolve) => {
    res.on('finish', resolve);
    sendFile(path.join(os.tmpdir(), 'rf-no-such-file.bin'), res, (...a) => logged.push(a));
  });
  assert.equal(res.status, 500);
  assert.equal(logged.length, 1);
});

test('sendFile cuts the response when reading fails after the headers went out', async () => {
  const res = fakeResponse();
  res.writeHead(200);
  const stream = sendFile(path.join(os.tmpdir(), 'rf-no-such-file.bin'), res, () => {});
  await new Promise((resolve) => stream.on('close', resolve));
  assert.equal(res.status, 200);
  assert.equal(res.destroyed, true);
});

test('sendFile sends a file that is there', async () => {
  const file = path.join(os.tmpdir(), `rf-startup-${process.pid}.txt`);
  fs.writeFileSync(file, 'hello');
  const res = fakeResponse();
  await new Promise((resolve) => {
    res.on('finish', resolve);
    sendFile(file, res);
  });
  fs.unlinkSync(file);
  assert.equal(res.body, 'hello');
});

test('an unhandled rejection is logged, not fatal', () => {
  const proc = new EventEmitter();
  const logged = [];
  logUnhandledRejections(proc, (...a) => logged.push(a));
  proc.emit('unhandledRejection', new Error('disk full'));
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][1]), /disk full/);
});

// The real server as a child process. The AWS SDK isn't installed in the
// repo (the server PC has its own), so the harness's stub stands in for it.
const awsStub = path.join(dir, '..', 'tools', 'harness', 'aws-stub.mjs');
const startServer = (env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', awsStub, path.join(dir, 'server.mjs')], {
      env: {
        PATH: process.env.PATH,
        RF_HARNESS_AWS_STUB: '1',
        GUILD_CLOUD_HOST: '127.0.0.1',
        GUILD_CLOUD_PORT: '0',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });

test('the server exits with a clear line when the secret is missing', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-startup-'));
  const { code, out } = await startServer({ GUILD_CLOUD_STORAGE_PATH: storage });
  fs.rmSync(storage, { recursive: true, force: true });
  assert.equal(code, 1);
  assert.match(out, /GUILD_CLOUD_SECRET is not set/);
  assert.doesNotMatch(out, /Listening on/);
});

test('the server exits when the secret is the example value', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-startup-'));
  const { code, out } = await startServer({
    GUILD_CLOUD_STORAGE_PATH: storage,
    GUILD_CLOUD_SECRET: 'replace-with-a-long-random-value',
  });
  fs.rmSync(storage, { recursive: true, force: true });
  assert.equal(code, 1);
  assert.match(out, /still the example value/);
});
