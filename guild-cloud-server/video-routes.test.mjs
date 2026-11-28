import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The real server with a seeded library. Discord and R2 are the harness
// stubs (tools/harness): roles come from a fixture the test can rewrite.
const dir = path.dirname(fileURLToPath(import.meta.url));
const harness = path.join(dir, '..', 'tools', 'harness');
const SECRET = 'video-routes-test-secret-value';
const GUILD = 'Room Forty';
const OWNER = '100000000000000001';
const EVI = '100000000000000002';
const BOB = '100000000000000003';
const OFFICER = '100000000000000004';
const FIRED = '100000000000000005';
const STRANGER = '100000000000000006';
const NEWBIE = '100000000000000007';
const OFFICER2 = '100000000000000008';

const fixture = {
  fail: false,
  roles: [
    { id: '1', name: 'Raider' },
    { id: '2', name: 'Officer' },
    { id: '3', name: 'Trial' },
  ],
  members: {
    [EVI]: ['1'],
    [BOB]: ['1'],
    [OFFICER]: ['1', '2'],
    [FIRED]: ['3'],
    [NEWBIE]: ['1'],
    [OFFICER2]: ['2'],
  },
};

const tokenFor = (discordId, userName, iat = Math.floor(Date.now() / 1000)) => {
  const now = iat;
  const body = Buffer.from(
    JSON.stringify({ action: 'session', guild: GUILD, discordId, userName, iat: now, exp: now + 3600 }),
  ).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// `bucket` (key -> { size, lastModified }) gives R2 objects of a chosen size
// and age that a test can read and rewrite while the server runs; without it
// the bucket is the five fixed 1000-byte keys. `state` is merged into the
// seeded state.json; `restored` makes the server load it from a backup, as
// after a damaged state.json; `env` adds server settings. `reuse` (the
// `storage` and `bucketFile` of a server stopped with stop(true)) starts a
// new server on the same files, as a restart does.
const start = async ({ bucket, state: extraState, restored = false, env = {}, reuse } = {}) => {
  const port = await freePort();
  const fixtureFile = path.join(os.tmpdir(), `rf-discord-${port}.json`);
  const setFixture = (changes = {}) =>
    fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, ...changes }));
  setFixture();
  const bucketFile = reuse?.bucketFile ?? path.join(os.tmpdir(), `rf-r2-${port}.json`);
  if (bucket) fs.writeFileSync(bucketFile, JSON.stringify(bucket));
  const storage = reuse?.storage ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rf-routes-'));
  const seeded = {
      videos: [
        { videoKey: 'evi.mp4', videoName: 'evi', uploadedBy: EVI, uploadedByName: 'Evi' },
        { videoKey: 'old.mp4', videoName: 'old' },
        { videoKey: 'bob.mp4', videoName: 'bob', uploadedBy: BOB, uploadedByName: 'Bob' },
      ],
      chats: [
        {
          correlator: 'c1',
          messages: [
            { id: 1, correlator: 'c1', message: 'hi', userName: 'Evi', discordId: EVI, timestamp: 1 },
            { id: 2, correlator: 'c1', message: 'old', userName: 'Bob', timestamp: 1 },
            { id: 3, correlator: 'c1', message: 'ghost', userName: 'Ghost', timestamp: 1 },
          ],
        },
      ],
      links: [],
      knownUsers: { [EVI]: { userName: 'Evi' }, [BOB]: { userName: 'Bob' } },
      nextMessageId: 4,
      ...extraState,
  };
  if (reuse) {
    // Keep the files as the last server left them.
  } else if (restored) {
    fs.mkdirSync(path.join(storage, 'backups'));
    fs.writeFileSync(path.join(storage, 'backups', 'state.2026-01-01T00-00-00.json'), JSON.stringify(seeded));
    fs.writeFileSync(path.join(storage, 'state.json'), 'damaged {');
  } else {
    fs.writeFileSync(path.join(storage, 'state.json'), JSON.stringify(seeded));
  }
  const child = spawn(process.execPath, [
    '--import',
    path.join(harness, 'aws-stub.mjs'),
    '--import',
    path.join(harness, 'discord-stub.mjs'),
    path.join(dir, 'server.mjs'),
  ], {
    env: {
      PATH: process.env.PATH,
      RF_HARNESS_AWS_STUB: '1',
      ...(bucket || reuse?.bucketFile
        ? { RF_HARNESS_R2_FILE: bucketFile }
        : { RF_HARNESS_R2_KEYS: 'evi.mp4,old.mp4,bob.mp4,new.mp4,forged.mp4' }),
      RF_HARNESS_DISCORD_FIXTURE: fixtureFile,
      GUILD_CLOUD_DISCORD_BOT_TOKEN: 'stub',
      GUILD_CLOUD_DISCORD_GUILD_ID: '1234',
      GUILD_CLOUD_DISCORD_ALLOWED_ROLES: 'Raider,Officer',
      GUILD_CLOUD_HOST: '127.0.0.1',
      GUILD_CLOUD_PORT: String(port),
      GUILD_CLOUD_STORAGE_PATH: storage,
      GUILD_CLOUD_SECRET: SECRET,
      GUILD_CLOUD_GUILD: GUILD,
      GUILD_CLOUD_OWNER_IDS: OWNER,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start\n${out}`)), 20000);
    const onData = (d) => {
      out += d;
      const m = /Listening on (http:\/\/\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => reject(new Error(`server exited\n${out}`)));
  });
  const call = async (who, method, route, body) => {
    const [id, name, iat] = who;
    const res = await fetch(`${base}/api/guild/${encodeURIComponent(GUILD)}${route}`, {
      method,
      headers: { Authorization: `Bearer ${tokenFor(id, name, iat)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const stop = async (keep = false) => {
    child.removeAllListeners('exit');
    child.kill();
    if (keep) {
      await new Promise((resolve) => (child.exitCode === null ? child.once('exit', resolve) : resolve()));
      return;
    }
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(fixtureFile, { force: true });
    fs.rmSync(bucketFile, { force: true });
  };
  const library = () => JSON.parse(fs.readFileSync(path.join(storage, 'state.json'), 'utf8'));
  const objects = () => {
    const { failDeletes, ...rest } = JSON.parse(fs.readFileSync(bucketFile, 'utf8'));
    return rest;
  };
  const get = async (route) => {
    const res = await fetch(`${base}${route}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { base, call, get, stop, library, setFixture, objects, storage, bucketFile };
};

const owner = [OWNER, 'Owner'];
const evi = [EVI, 'Evi'];
const bob = [BOB, 'Bob'];
const officer = [OFFICER, 'Officer'];

test('members whose Discord role is gone are turned away; a Discord outage is not', async () => {
  const { call, stop, setFixture, library } = await start();
  try {
    assert.equal((await call(bob, 'GET', '/usage')).status, 200);
    assert.equal((await call(owner, 'GET', '/usage')).status, 200); // not in the guild list
    let r = await call([FIRED, 'Fired'], 'GET', '/usage');
    assert.equal(r.status, 401);
    assert.match(r.body.error, /roles no longer allow access/);
    r = await call([STRANGER, 'Stranger'], 'GET', '/usage');
    assert.equal(r.status, 401);

    // Discord down, nothing cached for this member: carry on, but never
    // grant the officer capability on a guess.
    setFixture({ fail: true });
    assert.equal((await call([NEWBIE, 'Newbie'], 'GET', '/usage')).status, 200);
    r = await call([OFFICER2, 'Officer Two'], 'POST', '/bulk/protect', { videos: ['old'], protect: true });
    assert.equal(r.status, 403);
    assert.equal(library().videos[1].protected, undefined);
  } finally {
    stop();
  }
});

test('a Discord that never answers does not hang requests: the role lookup times out like an outage', async () => {
  const { call, stop, setFixture } = await start();
  try {
    setFixture({ hang: true });
    const started = Date.now();
    // Nothing cached for this member: carry on after the lookup's timeout.
    assert.equal((await call([NEWBIE, 'Newbie'], 'GET', '/usage')).status, 200);
    assert.ok(Date.now() - started < 9000, `took ${Date.now() - started} ms`);
    // Discord answering again is picked up once the retry pause is over (the
    // member's cached failure just expires); the server is still responsive.
    setFixture({ hang: false });
    assert.equal((await call(bob, 'GET', '/usage')).status, 200);
  } finally {
    await stop();
  }
});

test('officers manage anyone\'s recordings, raiders only their own', async () => {
  const { call, stop, library } = await start();
  try {
    const r = await call(bob, 'POST', '/bulk/protect', { videos: ['old'], protect: true });
    assert.equal(r.status, 403);
    assert.equal((await call(officer, 'POST', '/bulk/protect', { videos: ['old'], protect: true })).status, 200);
    assert.equal((await call(officer, 'POST', '/bulk/tag', { videos: ['old'], tag: 'kept' })).status, 200);
    assert.deepEqual([library().videos[1].protected, library().videos[1].tag], [true, 'kept']);
    // ...and officers moderate chat.
    assert.equal((await call(officer, 'DELETE', '/chat/3')).status, 200);
  } finally {
    stop();
  }
});

test('the video routes stamp owners and refuse changes to other people\'s recordings', async () => {
  const { call, stop, library } = await start();
  const meta = (extra) => ({ videoName: 'x', videoKey: 'x.mp4', ...extra });
  try {
    // A forged owner in the body is ignored. (A new recording needs the
    // upload URL first: that is what makes it his.)
    assert.equal((await call(bob, 'POST', '/upload', { key: 'new.mp4', bytes: 1000 })).status, 200);
    let r = await call(bob, 'POST', '/video', meta({ videoName: 'new', videoKey: 'new.mp4', uploadedBy: EVI, uploadedByName: 'Evi' }));
    assert.equal(r.status, 200);
    const added = library().videos.find((v) => v.videoKey === 'new.mp4');
    assert.deepEqual([added.uploadedBy, added.uploadedByName], [BOB, 'Bob']);

    // Taking someone else's name or key is refused; nothing changes.
    r = await call(bob, 'POST', '/video', meta({ videoName: 'evi', videoKey: 'forged.mp4' }));
    assert.equal(r.status, 403);
    assert.equal(library().videos.some((v) => v.videoKey === 'forged.mp4'), false);
    assert.equal((await call(bob, 'POST', '/video', meta({ videoName: 'evi', videoKey: 'evi.mp4' }))).status, 403);
    assert.equal((await call(bob, 'POST', '/upload', { key: 'evi.mp4', bytes: 10 })).status, 403);

    // Own key: a presigned URL. An officer's replace keeps the first owner.
    r = await call(evi, 'POST', '/upload', { key: 'evi.mp4', bytes: 10 });
    assert.equal(r.status, 200);
    r = await call(officer, 'POST', '/video', meta({ videoName: 'evi', videoKey: 'evi.mp4', uploadedBy: OFFICER }));
    assert.equal(r.status, 200);
    const replaced = library().videos.find((v) => v.videoKey === 'evi.mp4');
    assert.deepEqual([replaced.uploadedBy, replaced.uploadedByName], [EVI, 'Evi']);

    // Bulk delete: only Bob's own go, and he is told about the rest.
    r = await call(bob, 'POST', '/bulk/delete', ['bob', 'new', 'evi', 'old']);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { refused: ['old', 'evi'] });
    assert.deepEqual(library().videos.map((v) => v.videoName).sort(), ['evi', 'old']);
  } finally {
    stop();
  }
});

test('recordings and chat messages can only be changed by their owner or an officer', async () => {
  const { call, stop, library } = await start();
  try {
    // Bob owns nothing here: every change is refused and nothing changes.
    let r = await call(bob, 'POST', '/bulk/protect', { videos: ['evi', 'old'], protect: true });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /only protect your own/);
    r = await call(bob, 'POST', '/bulk/tag', { videos: ['evi'], tag: 'x' });
    assert.equal(r.status, 403);
    r = await call(bob, 'POST', '/bulk/delete', ['evi', 'old']);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /only delete your own/);
    r = await call(bob, 'PUT', '/video/old.mp4/timeline', { v: 1, casts: [] });
    assert.equal(r.status, 403);
    assert.ok(library().videos.every((v) => !v.protected && !v.tag));

    // Evi may change her own and is told about the others.
    r = await call(evi, 'POST', '/bulk/protect', { videos: ['evi', 'old', 'nothing'], protect: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { refused: ['old'] });
    assert.deepEqual(
      library().videos.map((v) => [v.videoName, Boolean(v.protected)]),
      [['evi', true], ['old', false], ['bob', false]],
    );

    // The owner may change anyone's, including a recording with no stamp.
    r = await call(owner, 'POST', '/bulk/protect', { videos: ['old'], protect: true });
    assert.deepEqual([r.status, r.body], [200, {}]);
    assert.equal(library().videos[1].protected, true);

    // Chat: stamped with the writer's id. Old messages were matched to Bob
    // by his name at startup; one nobody can be matched to is officers only.
    r = await call(bob, 'POST', '/chat/c1', { message: 'gg' });
    assert.equal(r.status, 200);
    const messages = () => library().chats[0].messages;
    assert.equal(messages().find((m) => m.message === 'gg').discordId, BOB);
    assert.equal(messages().find((m) => m.id === 2).discordId, BOB);
    assert.equal((await call(bob, 'DELETE', '/chat/1')).status, 403); // Evi's
    assert.equal((await call(evi, 'DELETE', '/chat/2')).status, 403); // Bob's
    assert.equal((await call(bob, 'DELETE', '/chat/3')).status, 403); // nobody's
    assert.equal((await call(bob, 'DELETE', '/chat/2')).status, 200);
    assert.equal((await call(bob, 'DELETE', '/chat/99')).status, 200); // unknown stays fine
    assert.equal((await call(owner, 'DELETE', '/chat/1')).status, 200);
    assert.deepEqual(messages().map((m) => m.message), ['ghost', 'gg']);
  } finally {
    stop();
  }
});

test('the owner signs a member out: old sessions stop, a later sign-in works', async () => {
  const { call, stop } = await start();
  try {
    // Sessions are whole seconds and only those issued before the sign-out
    // are refused, so mint one clearly in the past and one clearly after.
    const now = Math.floor(Date.now() / 1000);
    const before = [BOB, 'Bob', now - 60];
    const after = [BOB, 'Bob', now + 60];
    assert.equal((await call(before, 'GET', '/usage')).status, 200);

    let r = await call(bob, 'GET', '/permissions/members');
    assert.equal(r.status, 403);
    r = await call(bob, 'POST', '/permissions/sign-out', { discordId: EVI });
    assert.equal(r.status, 403);
    assert.equal((await call(before, 'GET', '/usage')).status, 200);

    r = await call(owner, 'GET', '/permissions/members');
    assert.equal(r.status, 200);
    assert.equal(r.body.members.find((m) => m.discordId === BOB).signedOut, false);

    r = await call(owner, 'POST', '/permissions/sign-out', { discordId: BOB });
    assert.equal(r.status, 200);
    r = await call(before, 'GET', '/usage');
    assert.equal(r.status, 401);
    assert.equal((await call(after, 'GET', '/usage')).status, 200);
    assert.equal((await call(evi, 'GET', '/usage')).status, 200); // others untouched

    // Their last sign-in is older than the sign-out until they sign in again.
    r = await call(owner, 'GET', '/permissions/members');
    assert.equal(r.body.members.find((m) => m.discordId === BOB).signedOut, true);
    assert.equal(r.body.members.find((m) => m.discordId === EVI).signedOut, false);

    r = await call(owner, 'POST', '/permissions/sign-out', { discordId: '1' });
    assert.equal(r.status, 400);
    r = await call(owner, 'POST', '/permissions/sign-out', { discordId: OWNER });
    assert.equal(r.status, 400);
  } finally {
    stop();
  }
});

// ---- Upload reservations (1.9.130) -----------------------------------------

const HOUR = 60 * 60 * 1000;
const GIB = 1024 ** 3;
const old = (hours) => new Date(Date.now() - hours * HOUR).toISOString();
const expiredFor = (userId, userName) => ({ userId, userName, bytes: 1000, at: 1, expiresAt: 2 });
const meta = (key) => ({ videoName: key.replace(/\.mp4$/, ''), videoKey: key });

test('a new recording can only be registered by the member who asked for its upload URL', async () => {
  const { call, stop, library } = await start({
    bucket: { 'night.mp4': { size: 1000 }, 'big.mp4': { size: 1000 } },
  });
  try {
    // Nothing reserved: refused for everyone, officers and owner included.
    for (const who of [bob, officer, owner]) {
      const r = await call(who, 'POST', '/video', meta('night.mp4'));
      assert.equal(r.status, 403);
      assert.match(r.body.error, /Start the upload again/);
    }
    assert.equal(library().videos.some((v) => v.videoKey === 'night.mp4'), false);

    // Evi asks for a URL. Nobody else can get one for that name or register it.
    let r = await call(evi, 'POST', '/upload', { key: 'night.mp4', bytes: 1000 });
    assert.equal(r.status, 200);
    assert.match(r.body.signed, /night\.mp4/);
    assert.equal(library().uploadReservations['night.mp4'].userId, EVI);
    r = await call(bob, 'POST', '/upload', { key: 'night.mp4', bytes: 1000 });
    assert.deepEqual([r.status, r.body.error], [409, 'Another member is uploading a file with this name.']);
    r = await call(officer, 'POST', '/upload', { key: 'night.mp4', bytes: 1000 });
    assert.equal(r.status, 409);
    for (const who of [bob, officer, owner]) {
      assert.equal((await call(who, 'POST', '/video', meta('night.mp4'))).status, 403);
    }
    assert.equal(library().uploadReservations['night.mp4'].userId, EVI); // untouched

    // Evi registers it: hers, and the reservation is used up.
    r = await call(evi, 'POST', '/video', { ...meta('night.mp4'), uploadedBy: BOB });
    assert.equal(r.status, 200);
    const added = library().videos.find((v) => v.videoKey === 'night.mp4');
    assert.deepEqual([added.uploadedBy, added.uploadedByName], [EVI, 'Evi']);
    assert.deepEqual(library().uploadReservations, {});

    // A second try with no new URL is refused (it is in the list now: only
    // the owner may replace it, and Bob is not).
    assert.equal((await call(bob, 'POST', '/video', meta('night.mp4'))).status, 403);

    // Over 5 GiB is refused: the app cannot send that in one piece.
    r = await call(evi, 'POST', '/upload', { key: 'huge.mp4', bytes: 5 * GIB + 1 });
    assert.equal(r.status, 413);
    assert.equal(library().uploadReservations['huge.mp4'], undefined);
    assert.equal((await call(evi, 'POST', '/upload', { key: 'huge.mp4', bytes: 5 * GIB })).status, 200);
  } finally {
    stop();
  }
});

test('a file bigger than the size declared is deleted and refused; a smaller one is fine', async () => {
  const { call, stop, library, objects } = await start({
    bucket: {
      'big.mp4': { size: 5000 },
      'small.mp4': { size: 400 },
      'evi.mp4': { size: 9000 },
      'bob.mp4': { size: 1000 },
      'old.mp4': { size: 1000 },
    },
  });
  try {
    let r = await call(evi, 'POST', '/upload', { key: 'big.mp4', bytes: 1000 });
    assert.equal(r.status, 200);
    r = await call(evi, 'POST', '/video', meta('big.mp4'));
    assert.equal(r.status, 413);
    assert.match(r.body.error, /bigger than you said/);
    assert.equal('big.mp4' in objects(), false);
    assert.equal(library().videos.some((v) => v.videoKey === 'big.mp4'), false);
    assert.equal(library().uploadReservations['big.mp4'], undefined);
    // Nothing is left to register.
    assert.equal((await call(evi, 'POST', '/video', meta('big.mp4'))).status, 403);

    r = await call(evi, 'POST', '/upload', { key: 'small.mp4', bytes: 1000 });
    assert.equal(r.status, 200);
    assert.equal((await call(evi, 'POST', '/video', meta('small.mp4'))).status, 200);
    assert.ok('small.mp4' in objects());

    // Replacing her own recording with a file bigger than she declared: the
    // file is gone from R2, so the entry goes from the list too.
    r = await call(evi, 'POST', '/upload', { key: 'evi.mp4', bytes: 1000 });
    assert.equal(r.status, 200);
    r = await call(evi, 'POST', '/video', meta('evi.mp4'));
    assert.equal(r.status, 413);
    assert.equal('evi.mp4' in objects(), false);
    assert.equal(library().videos.some((v) => v.videoKey === 'evi.mp4'), false);
    assert.equal(library().uploadReservations['evi.mp4'], undefined);
    assert.ok(library().videos.some((v) => v.videoKey === 'bob.mp4')); // others untouched
  } finally {
    stop();
  }
});

test('replacing an existing recording works with or without an upload URL', async () => {
  const { call, stop, library, objects } = await start({
    bucket: { 'evi.mp4': { size: 1000 }, 'bob.mp4': { size: 1000 }, 'old.mp4': { size: 1000 } },
  });
  try {
    // The owner, as the app does it: URL, then register.
    assert.equal((await call(evi, 'POST', '/upload', { key: 'evi.mp4', bytes: 1000 })).status, 200);
    assert.equal((await call(evi, 'POST', '/video', { ...meta('evi.mp4'), tag: 'v2' })).status, 200);
    assert.equal(library().videos.find((v) => v.videoKey === 'evi.mp4').tag, 'v2');
    assert.deepEqual(library().uploadReservations, {});
    assert.ok('evi.mp4' in objects());

    // No reservation needed for an existing entry (today's rule: own or officer).
    assert.equal((await call(evi, 'POST', '/video', { ...meta('evi.mp4'), tag: 'v3' })).status, 200);
    assert.equal((await call(officer, 'POST', '/video', { ...meta('bob.mp4'), tag: 'x' })).status, 200);
    assert.equal(library().videos.find((v) => v.videoKey === 'bob.mp4').uploadedBy, BOB);
    assert.equal((await call(bob, 'POST', '/video', meta('evi.mp4'))).status, 403);
    // An unstamped old recording is officers' only.
    assert.equal((await call(bob, 'POST', '/video', meta('old.mp4'))).status, 403);
    assert.equal((await call(officer, 'POST', '/video', meta('old.mp4'))).status, 200);
  } finally {
    stop();
  }
});

test('the housekeeper removes the file of an upload nobody registered, and nothing that is in use', async () => {
  const { call, stop, library, objects } = await start({
    bucket: {
      'abandoned.mp4': { size: 1000 },
      'evi.mp4': { size: 1000 },
      'evil.mp4': { size: 1000 }, // named after a registered recording, never registered itself
      'shared.mp4': { size: 1000 },
      'bob.mp4': { size: 1000 },
      'old.mp4': { size: 1000 },
      'a.mp4': { size: 1000 },
      'live.mp4': { size: 1000 },
      'grace.mp4': { size: 1000 },
      'unreserved.mp4': { size: 1000 }, // no reservation at all: the orphan route's job
    },
    state: {
      links: [{ id: 'l1', guild: GUILD, key: 'shared.mp4', likes: 0 }],
      // A member can name a recording anything: `videoName: 'evil'` must not
      // shield an unregistered evil.mp4.
      videos: [
        { videoKey: 'evi.mp4', videoName: 'evi', uploadedBy: EVI, uploadedByName: 'Evi' },
        { videoKey: 'old.mp4', videoName: 'old' },
        { videoKey: 'bob.mp4', videoName: 'bob', uploadedBy: BOB, uploadedByName: 'Bob' },
        { videoKey: 'a.mp4', videoName: 'evil', uploadedBy: BOB, uploadedByName: 'Bob' },
      ],
      uploadReservations: {
        'abandoned.mp4': expiredFor(BOB, 'Bob'),
        'evi.mp4': expiredFor(EVI, 'Evi'),
        'evil.mp4': expiredFor(BOB, 'Bob'),
        'shared.mp4': expiredFor(EVI, 'Evi'),
        'gone.mp4': expiredFor(EVI, 'Evi'), // not in R2: just dropped
        // One still live, one past its day but inside the grace hours: both kept.
        'live.mp4': { userId: BOB, userName: 'Bob', bytes: 1000, at: Date.now(), expiresAt: Date.now() + HOUR },
        'grace.mp4': { userId: BOB, userName: 'Bob', bytes: 1000, at: 1, expiresAt: Date.now() - HOUR },
      },
    },
  });
  try {
    const r = await call(bob, 'POST', '/housekeeper');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(objects()).sort(), [
      'a.mp4', 'bob.mp4', 'evi.mp4', 'grace.mp4', 'live.mp4', 'old.mp4', 'shared.mp4', 'unreserved.mp4',
    ]);
    assert.deepEqual(Object.keys(library().uploadReservations).sort(), ['grace.mp4', 'live.mp4']);
    assert.equal(library().videos.length, 4);
  } finally {
    stop();
  }
});

test('after a state restore the housekeeper deletes no files, even after a restart', async () => {
  const first = await start({
    restored: true,
    bucket: { 'abandoned.mp4': { size: 1000 }, 'evi.mp4': { size: 1000 } },
    state: { uploadReservations: { 'abandoned.mp4': expiredFor(BOB, 'Bob') } },
  });
  let second;
  try {
    // No housekeeper run here: loading from the backup must itself drop and
    // save the reservations.
    assert.deepEqual(first.library().uploadReservations, {});
    await first.stop(true);

    // A normal restart (stateRestoredAt is gone) must not revive anything:
    // the restored reservation was dropped and saved at load.
    second = await start({ reuse: first });
    assert.deepEqual(second.library().uploadReservations, {});
    assert.equal((await second.call(bob, 'POST', '/housekeeper')).status, 200);
    assert.ok('abandoned.mp4' in second.objects());
  } finally {
    second?.stop();
    if (!second) first.stop();
  }
});

test('a file that will not delete keeps its reservation and goes on the next run', async () => {
  const { call, stop, library, objects, bucketFile } = await start({
    bucket: { 'abandoned.mp4': { size: 1000 }, failDeletes: ['abandoned.mp4'] },
    state: { uploadReservations: { 'abandoned.mp4': expiredFor(BOB, 'Bob') } },
    // Two runs from the route back to back (normally a minute apart).
    env: { GUILD_CLOUD_HOUSEKEEPER_GAP_MS: '0' },
  });
  try {
    assert.equal((await call(bob, 'POST', '/housekeeper')).status, 200);
    assert.ok('abandoned.mp4' in objects());
    assert.equal(library().uploadReservations['abandoned.mp4'].userId, BOB);

    // Deletes work again: the next run removes it and the reservation.
    fs.writeFileSync(bucketFile, JSON.stringify({ 'abandoned.mp4': objects()['abandoned.mp4'] }));
    assert.equal((await call(bob, 'POST', '/housekeeper')).status, 200);
    assert.equal('abandoned.mp4' in objects(), false);
    assert.deepEqual(library().uploadReservations, {});
  } finally {
    stop();
  }
});

test('the housekeeper route runs at most once per gap and answers with the last result', async () => {
  const { call, stop, library, objects, bucketFile } = await start({
    bucket: { 'abandoned.mp4': { size: 1000 }, failDeletes: ['abandoned.mp4'] },
    state: { uploadReservations: { 'abandoned.mp4': expiredFor(BOB, 'Bob') } },
    // A short gap instead of a minute.
    env: { GUILD_CLOUD_HOUSEKEEPER_GAP_MS: '1500' },
  });
  try {
    // First run: the abandoned upload won't delete, so it stays for the next run.
    const first = await call(bob, 'POST', '/housekeeper');
    assert.equal(first.status, 200);
    assert.ok('abandoned.mp4' in objects());

    // Deletes work again. Within the gap the route doesn't run (and answers
    // with the last result); a run now would delete the file.
    fs.writeFileSync(bucketFile, JSON.stringify({ 'abandoned.mp4': objects()['abandoned.mp4'] }));
    const together = await Promise.all([1, 2, 3].map(() => call(bob, 'POST', '/housekeeper')));
    assert.deepEqual(together.map((r) => r.status), [200, 200, 200]);
    assert.deepEqual(together.map((r) => r.body.bytes), [first.body.bytes, first.body.bytes, first.body.bytes]);
    assert.ok('abandoned.mp4' in objects(), 'no run within the gap');

    // After the gap it runs again.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal((await call(bob, 'POST', '/housekeeper')).status, 200);
    assert.equal('abandoned.mp4' in objects(), false);
    assert.deepEqual(library().uploadReservations, {});
  } finally {
    stop();
  }
});

test('the housekeeper evicts by when a file reached R2, not by the start the client wrote', async () => {
  const { call, stop, library, objects } = await start({
    // 3 recordings of 1000 bytes; room for two.
    env: { GUILD_CLOUD_LIMIT_GB: String(2500 / GIB) },
    bucket: {
      'evi.mp4': { size: 1000, lastModified: old(1) },
      'old.mp4': { size: 1000, lastModified: old(48) }, // oldest upload, newest `start` below
      'bob.mp4': { size: 1000, lastModified: old(24) },
    },
    state: {
      videos: [
        { videoKey: 'evi.mp4', videoName: 'evi', uploadedBy: EVI, uploadedByName: 'Evi', start: 1 },
        { videoKey: 'old.mp4', videoName: 'old', start: Date.now() + 10 * HOUR },
        { videoKey: 'bob.mp4', videoName: 'bob', uploadedBy: BOB, uploadedByName: 'Bob', start: 2 },
      ],
    },
  });
  try {
    assert.equal((await call(bob, 'POST', '/housekeeper')).status, 200);
    assert.deepEqual(Object.keys(objects()).sort(), ['bob.mp4', 'evi.mp4']);
    assert.deepEqual(library().videos.map((v) => v.videoKey), ['evi.mp4', 'bob.mp4']);
  } finally {
    stop();
  }
});

// ---- Signed upload size (1.9.132) ------------------------------------------

test('the upload URL is signed for the declared size, unless that is switched off', async () => {
  let server = await start({ bucket: {} });
  try {
    const r = await server.call(evi, 'POST', '/upload', { key: 'sized.mp4', bytes: 123456 });
    assert.equal(r.status, 200);
    // The stub shows the ContentLength the server asked the presigner to sign.
    assert.match(r.body.signed, /sized\.mp4\?signed-content-length=123456$/);
  } finally {
    server.stop();
  }
  server = await start({ bucket: {}, env: { GUILD_CLOUD_SIGN_UPLOAD_SIZE: 'off' } });
  try {
    const r = await server.call(evi, 'POST', '/upload', { key: 'sized.mp4', bytes: 123456 });
    assert.equal(r.status, 200);
    assert.match(r.body.signed, /sized\.mp4$/);
  } finally {
    server.stop();
  }
});

test('/health checks storage and state, and writes the log file', async () => {
  const { get, stop, storage } = await start({
    env: { GUILD_CLOUD_HEALTH_CACHE_MS: '0', GUILD_CLOUD_LOG_DAYS: '3' },
  });
  try {
    let r = await get('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.checks, { storage: { ok: true }, state: { ok: true }, log: { ok: true } });
    assert.equal(typeof r.body.uptimeSec, 'number');
    assert.equal(JSON.stringify(r.body).includes(storage), false);

    // The server's own start-up lines are in today's log file.
    const logs = fs.readdirSync(path.join(storage, 'logs'));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^server-\d{4}-\d{2}-\d{2}\.log$/);
    assert.match(fs.readFileSync(path.join(storage, 'logs', logs[0]), 'utf8'), / INFO \[guild-cloud\] Listening on /);

    // Storage goes away (a drive that dropped off): not healthy.
    fs.rmSync(storage, { recursive: true, force: true });
    r = await get('/health');
    assert.equal(r.status, 503);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.checks.storage.ok, false);
    assert.equal(typeof r.body.version === 'string' || r.body.version === null, true);
  } finally {
    await stop();
  }
});

test('/health is still ok, with a warning, when the log folder cannot be written', async () => {
  const blocker = path.join(os.tmpdir(), `rf-log-blocker-${process.pid}`);
  fs.writeFileSync(blocker, 'x');
  const { get, stop } = await start({ env: { GUILD_CLOUD_LOG_DIR: path.join(blocker, 'logs') } });
  try {
    const r = await get('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.checks.log.warning);
  } finally {
    await stop();
    fs.rmSync(blocker, { force: true });
  }
});

test('a bad %-escape in the path is a quiet 400, not a logged error', async () => {
  const { stop, get, storage } = await start();
  try {
    const r = await get('/%ZZ');
    assert.equal(r.status, 400);
    const logs = fs.readdirSync(path.join(storage, 'logs'));
    const text = fs.readFileSync(path.join(storage, 'logs', logs[0]), 'utf8');
    assert.doesNotMatch(text, /Request failed|URIError/);
  } finally {
    await stop();
  }
});

// ---- 1.9.160: per-address limits and likes (rate-limit.mjs) -------------------

const from = (address) => (address ? { 'X-Forwarded-For': address } : {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('likes count once per address per link and are saved together, not per press', async () => {
  const server = await start({
    state: { links: [{ id: 'l1', guild: GUILD, key: 'evi.mp4', likes: 0 }] },
    env: { GUILD_CLOUD_LIKE_SAVE_MS: '3000' },
  });
  try {
    const like = async (address) => {
      const res = await fetch(`${server.base}/link/l1/like`, { method: 'POST', headers: from(address) });
      return { status: res.status, body: await res.json() };
    };
    assert.deepEqual(await like('203.0.113.9'), { status: 200, body: { likes: 1, counted: true } });
    assert.deepEqual(await like('203.0.113.9'), { status: 200, body: { likes: 1, counted: false } });
    // Same /64 is the same visitor.
    assert.deepEqual((await like('2001:db8:1:2::1')).body, { likes: 2, counted: true });
    assert.deepEqual((await like('2001:db8:1:2::99')).body, { likes: 2, counted: false });
    assert.deepEqual((await like('198.51.100.4')).body, { likes: 3, counted: true });
    assert.equal(server.library().links[0].likes, 0); // not written yet
    await sleep(4500);
    assert.equal(server.library().links[0].likes, 3); // one save for the lot
    assert.equal((await fetch(`${server.base}/link/nope/like`, { method: 'POST' })).status, 404);
  } finally {
    await server.stop();
  }
});

test('outside addresses get a 429 past their limit; this PC and other addresses do not', async () => {
  const server = await start();
  try {
    const page = (address) => fetch(`${server.base}/link/nope`, { headers: from(address) });
    // 120 at once, plus whatever refilled (2 a second) while they were sent.
    let served = 0;
    let refused;
    while (served < 200) {
      const res = await page('203.0.113.9');
      if (res.status === 429) {
        refused = res;
        break;
      }
      assert.equal(res.status, 404);
      served += 1;
    }
    assert.ok(refused && served >= 120, `served ${served}`);
    assert.equal(refused.headers.get('retry-after'), '1');
    assert.match((await refused.json()).error, /Too many requests\. Try again in 1 s\./);
    assert.equal((await page('198.51.100.4')).status, 404); // someone else
    for (let i = 0; i < 130; i++) assert.equal((await page()).status, 404); // MediaMTX, the updater
    // The app's own calls have their own, bigger bucket.
    const api = await fetch(`${server.base}/api/guild/${encodeURIComponent(GUILD)}/video`, { headers: from('203.0.113.9') });
    assert.equal(api.status, 401);

    // Sign-in: 20 at once.
    const exchange = () =>
      fetch(`${server.base}/api/auth/discord/exchange`, {
        method: 'POST',
        headers: { ...from('192.0.2.50'), 'Content-Type': 'application/json' },
        body: '{}',
      });
    for (let i = 0; i < 20; i++) assert.notEqual((await exchange()).status, 429);
    const tooMany = await exchange();
    assert.equal(tooMany.status, 429);
    assert.match(tooMany.headers.get('retry-after'), /^[123]$/); // 3 s for one, less any refill while sending
    assert.equal(tooMany.headers.get('access-control-allow-origin'), '*');
  } finally {
    await server.stop();
  }
});

test('GUILD_CLOUD_RATE_LIMIT=off turns the limits and the per-address like check off', async () => {
  const server = await start({
    env: { GUILD_CLOUD_RATE_LIMIT: 'off' },
    state: { links: [{ id: 'l1', guild: GUILD, key: 'evi.mp4', likes: 0 }] },
  });
  try {
    for (let i = 1; i <= 2; i++) {
      const res = await fetch(`${server.base}/link/l1/like`, { method: 'POST', headers: from('203.0.113.9') });
      assert.deepEqual(await res.json(), { likes: i, counted: true });
    }
    for (let i = 0; i < 130; i++) {
      const res = await fetch(`${server.base}/link/nope`, { headers: from('203.0.113.9') });
      assert.equal(res.status, 404);
    }
  } finally {
    await server.stop();
  }
});

// ---- 1.9.161: share links you can stop, and the daily clean-up --------------

test('Stop sharing takes down the recording link and the clips the caller may stop (1.9.167)', async () => {
  const state = {
    links: [
      { id: 'v1', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'video', createdBy: BOB },
      { id: 'cb', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'clip', createdBy: BOB },
      { id: 'ce', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'clip', createdBy: EVI },
      { id: 'cn', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'clip', createdBy: '100000000000000099' },
    ],
  };
  const ids = (server) =>
    server
      .library()
      .links.map((link) => link.id)
      .sort();
  const listed = async (server, who) =>
    Object.fromEntries((await server.call(who, 'GET', '/video')).body.map((v) => [v.videoKey, v]));
  const newbie = [NEWBIE, 'Newbie'];
  const stranger = newbie; // a raider with no rights over Evi's recording

  // The uploader stops the recording link and every clip.
  let server = await start({ state });
  try {
    const eviRow = (await listed(server, evi))['evi.mp4'];
    assert.equal(eviRow.shared, true);
    assert.equal(eviRow.clipLinks, 3);
    assert.equal(eviRow.canStopSharing, true);
    const bobRow = (await listed(server, bob))['evi.mp4']; // made the video link and a clip
    assert.equal(bobRow.canStopSharing, true);
    const strangerRow = (await listed(server, stranger))['evi.mp4'];
    assert.equal(strangerRow.shared, true);
    assert.equal(strangerRow.clipLinks, 3);
    assert.equal(strangerRow.canStopSharing, false);
    const unshared = (await listed(server, evi))['bob.mp4'];
    assert.equal(unshared.shared, false);
    assert.equal(unshared.clipLinks, 0);
    assert.equal(unshared.canStopSharing, false);
    assert.equal((await listed(server, officer))['evi.mp4'].canStopSharing, true);

    // Someone with no rights is refused and nothing changes.
    const refused = await server.call(stranger, 'DELETE', '/video/evi/link');
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /Only the person who shared it/);
    assert.equal(ids(server).length, 4);

    assert.deepEqual((await server.call(evi, 'DELETE', '/video/evi/link')).body, { removed: 1, clips: 3 });
    assert.deepEqual(ids(server), []);
    assert.deepEqual((await server.call(evi, 'DELETE', '/video/evi/link')).body, { removed: 0, clips: 0 });
    assert.equal((await listed(server, evi))['evi.mp4'].canStopSharing, false);
  } finally {
    await server.stop();
  }

  // A clip's sender who isn't the uploader stops only their own clip.
  server = await start({
    state: {
      links: state.links
        .filter((link) => link.id !== 'v1')
        .map((link) => (link.id === 'cn' ? { ...link, createdBy: NEWBIE } : link)),
    },
  });
  try {
    assert.equal((await listed(server, newbie))['evi.mp4'].canStopSharing, true);
    assert.deepEqual((await server.call(newbie, 'DELETE', '/video/evi/link')).body, { removed: 0, clips: 1 });
    assert.deepEqual(ids(server), ['cb', 'ce']);
    assert.equal((await listed(server, newbie))['evi.mp4'].canStopSharing, false);
    assert.equal((await server.call(newbie, 'DELETE', '/video/evi/link')).status, 403);
    assert.deepEqual(ids(server), ['cb', 'ce']);
  } finally {
    await server.stop();
  }
});

test('one share link per recording; clips are separate; stopping it is for the sharer, uploader or an officer', async () => {
  const server = await start({
    state: {
      links: [{ id: 'clip1', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'clip', createdBy: BOB }],
    },
  });
  try {
    const first = await server.call(bob, 'POST', '/video/evi/link');
    assert.equal(first.status, 200);
    assert.notEqual(first.body.id, 'clip1'); // a clip link is not the recording's link
    const again = await server.call(evi, 'POST', '/video/evi.mp4/link');
    assert.equal(again.body.id, first.body.id); // same recording, same link, whoever asks

    const listed = async (who) =>
      Object.fromEntries((await server.call(who, 'GET', '/video')).body.map((v) => [v.videoKey, v.shared]));
    assert.equal((await listed(evi))['evi.mp4'], true);
    assert.equal((await listed(evi))['bob.mp4'], false);

    // Someone else can't stop it (the sharer was Bob; the uploader is Evi).
    const other = [NEWBIE, 'Newbie'];
    let r = await server.call(other, 'DELETE', '/video/evi/link');
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Only the person who shared it, the uploader or an officer/);
    assert.equal((await server.get(`/link/${first.body.id}`)).status, 200);

    // The sharer can (Bob does not own evi.mp4).
    r = await server.call(bob, 'DELETE', '/video/evi/link');
    assert.deepEqual(r.body, { removed: 1, clips: 1 }); // and the clip Bob sent
    assert.equal((await server.get(`/link/${first.body.id}`)).status, 404);
    assert.equal((await listed(evi))['evi.mp4'], false);
    assert.ok(!server.library().links.some((link) => link.id === 'clip1')); // 1.9.167: clips stop too

    // A new share is a new link; the uploader may stop it, so may an officer.
    const second = await server.call(bob, 'POST', '/video/evi/link');
    assert.notEqual(second.body.id, first.body.id);
    assert.deepEqual((await server.call(evi, 'DELETE', '/video/evi/link')).body, { removed: 1, clips: 0 });
    await server.call(bob, 'POST', '/video/evi/link');
    assert.deepEqual((await server.call(officer, 'DELETE', '/video/evi/link')).body, { removed: 1, clips: 0 });
    assert.deepEqual((await server.call(officer, 'DELETE', '/video/evi/link')).body, { removed: 0, clips: 0 });
  } finally {
    await server.stop();
  }
});

test('share redirects live 2 hours; the app\'s download URLs live a day', async () => {
  const server = await start({ state: { links: [{ id: 'l1', guild: GUILD, key: 'evi.mp4', likes: 0 }] } });
  try {
    const exp = (url) => {
      const token = url.split('/download/')[1];
      return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).exp - Date.now() / 1000;
    };
    const redirect = await fetch(`${server.base}/link/l1/video`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    const shareLife = exp(redirect.headers.get('location'));
    assert.ok(shareLife > 7100 && shareLife <= 7200, `share ${shareLife}`);
    const listed = (await server.call(evi, 'GET', '/video')).body.find((v) => v.videoKey === 'evi.mp4');
    const appLife = exp(listed.signedVideoKey);
    assert.ok(appLife > 86300 && appLife <= 86400, `app ${appLife}`);
  } finally {
    await server.stop();
  }
});

test('the share page\'s Discord embed points at the link\'s own /video address', async () => {
  const server = await start({
    state: { links: [{ id: 'l1', guild: GUILD, key: 'evi.mp4', likes: 0 }] },
    env: { GUILD_CLOUD_PUBLIC_URL: 'https://example.test/' },
  });
  try {
    const page = await (await fetch(`${server.base}/link/l1`)).text();
    assert.match(page, /<meta property="og:video" content="https:\/\/example\.test\/link\/l1\/video">/);
    assert.equal(page.includes('/download/'), false); // no long-lived signed URL in a page Discord caches
  } finally {
    await server.stop();
  }
});

test('reading a chat that does not exist does not create it', async () => {
  const server = await start();
  try {
    const before = server.library().chats.length;
    const r = await server.call(evi, 'GET', '/chat/guild-nothing-here');
    assert.deepEqual(r.body, []);
    await server.call(evi, 'POST', '/video/evi/link'); // forces a save of state.json
    assert.equal(server.library().chats.length, before);
    // Posting still creates it.
    await server.call(evi, 'POST', '/chat/guild-new', { message: 'hello' });
    assert.equal((await server.call(evi, 'GET', '/chat/guild-new')).body.length, 1);
  } finally {
    await server.stop();
  }
});

test('the daily clean-up drops dead links, orphan previews, empty chats and old pull logs', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cleanup-'));
  const pulldesk = path.join(storage, 'pulldesk');
  fs.mkdirSync(path.join(pulldesk, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(storage, 'coach-thumbs'));
  const day = 24 * 60 * 60 * 1000;
  fs.writeFileSync(
    path.join(pulldesk, 'index.json'),
    JSON.stringify({
      pulls: [
        { id: 'old1', createdAt: Date.now() - 40 * day, hasLog: true, status: 'ready', postedAt: 1 },
        { id: 'new1', createdAt: Date.now() - day, hasLog: true, status: 'ready', postedAt: 1 },
      ],
    }),
  );
  fs.writeFileSync(path.join(pulldesk, 'logs', 'old1.log.gz'), 'x');
  fs.writeFileSync(path.join(pulldesk, 'logs', 'new1.log.gz'), 'x');
  const thumbs = path.join(storage, 'coach-thumbs');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const id of ['live1', 'dead1', 'orphan1']) {
    fs.writeFileSync(path.join(thumbs, `${id}.jpg`), 'x');
    fs.utimesSync(path.join(thumbs, `${id}.jpg`), twoHoursAgo, twoHoursAgo);
  }
  fs.writeFileSync(path.join(thumbs, 'justsent.jpg'), 'x'); // a clip being sent right now
  // `reuse` starts the server on these files as they are.
  fs.writeFileSync(
    path.join(storage, 'state.json'),
    JSON.stringify({
      videos: [{ videoKey: 'evi.mp4', videoName: 'evi', uploadedBy: EVI }],
      chats: [
        { correlator: 'empty', messages: [] },
        { correlator: 'full', messages: [{ id: 1, correlator: 'full', message: 'hi', userName: 'Evi', timestamp: 1 }] },
      ],
      links: [
        { id: 'live1', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'clip' },
        { id: 'dead1', guild: GUILD, key: 'gone.mp4', likes: 0 },
      ],
      knownUsers: {},
      nextMessageId: 2,
    }),
  );
  const second = await start({
    reuse: { storage },
    env: { GUILD_CLOUD_CLEANUP_DELAY_MS: '200', GUILD_CLOUD_PULLDESK_LOG_DAYS: '30' },
  });
  try {
    const deadline = Date.now() + 10000;
    while (second.library().links.length > 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const state = second.library();
    assert.deepEqual(state.links.map((link) => link.id), ['live1']);
    assert.deepEqual(state.chats.map((chat) => chat.correlator), ['full']);
    assert.deepEqual(fs.readdirSync(thumbs).sort(), ['justsent.jpg', 'live1.jpg']);
    assert.deepEqual(fs.readdirSync(path.join(pulldesk, 'logs')).sort(), ['new1.log.gz']);
  } finally {
    await second.stop();
  }
});

test('links from before 1.9.161: ones with a coaching preview become clips, the rest stay the recording\'s link', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-oldlinks-'));
  fs.mkdirSync(path.join(storage, 'coach-thumbs'));
  fs.writeFileSync(path.join(storage, 'coach-thumbs', 'clip1.jpg'), 'x');
  fs.writeFileSync(
    path.join(storage, 'state.json'),
    JSON.stringify({
      videos: [
        { videoKey: 'evi.mp4', videoName: 'evi', uploadedBy: EVI, uploadedByName: 'Evi' },
        { videoKey: 'bob.mp4', videoName: 'bob', uploadedBy: BOB, uploadedByName: 'Bob' },
      ],
      chats: [],
      links: [
        { id: 'clip1', guild: GUILD, key: 'evi.mp4', likes: 0 },
        { id: 'share1', guild: GUILD, key: 'bob.mp4', likes: 4 },
      ],
      knownUsers: {},
      nextMessageId: 1,
    }),
  );
  const server = await start({ reuse: { storage } });
  try {
    const kinds = Object.fromEntries(server.library().links.map((link) => [link.id, link.kind]));
    assert.deepEqual(kinds, { clip1: 'clip', share1: 'video' });
    const listed = (await server.call(evi, 'GET', '/video')).body;
    assert.equal(listed.find((v) => v.videoKey === 'evi.mp4').shared, false); // only a clip
    assert.equal(listed.find((v) => v.videoKey === 'bob.mp4').shared, true);
    // The link button makes Evi's recording a link of its own, not the clip's.
    const made = await server.call(evi, 'POST', '/video/evi/link');
    assert.notEqual(made.body.id, 'clip1');
    // Since 1.9.167 stopping Evi's share takes the clip down too.
    assert.deepEqual((await server.call(evi, 'DELETE', '/video/evi/link')).body, { removed: 1, clips: 1 });
    assert.equal((await fetch(`${server.base}/link/clip1/video`, { redirect: 'manual' })).status, 404);
    // Nothing left to stop: anyone gets removed 0 rather than a refusal.
    assert.deepEqual((await server.call(bob, 'DELETE', '/video/evi/link')).body, { removed: 0, clips: 0 });
  } finally {
    await server.stop();
  }
});

test('a share link\'s video redirect skips the R2 check and may be cached a minute', async () => {
  const server = await start({ state: { links: [{ id: 'l1', guild: GUILD, key: 'evi.mp4', likes: 0, kind: 'video' }] } });
  try {
    const res = await fetch(`${server.base}/link/l1/video`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
    assert.equal((await fetch(`${server.base}/link/nope/video`, { redirect: 'manual' })).status, 404);
  } finally {
    await server.stop();
  }
});
