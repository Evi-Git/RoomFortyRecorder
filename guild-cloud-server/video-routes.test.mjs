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

const start = async () => {
  const port = await freePort();
  const fixtureFile = path.join(os.tmpdir(), `rf-discord-${port}.json`);
  const setFixture = (changes = {}) =>
    fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, ...changes }));
  setFixture();
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-routes-'));
  fs.writeFileSync(
    path.join(storage, 'state.json'),
    JSON.stringify({
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
    }),
  );
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
      RF_HARNESS_R2_KEYS: 'evi.mp4,old.mp4,bob.mp4,new.mp4,forged.mp4',
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
  const stop = () => {
    child.removeAllListeners('exit');
    child.kill();
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(fixtureFile, { force: true });
  };
  const library = () => JSON.parse(fs.readFileSync(path.join(storage, 'state.json'), 'utf8'));
  return { call, stop, library, setFixture };
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
    // A forged owner in the body is ignored.
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
