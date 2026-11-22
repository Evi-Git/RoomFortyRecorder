import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_KINDS, ROUTES, createMatcher, deniedMessage, matchRoute } from './routes.mjs';
import { capabilities } from './permissions.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const harness = path.join(dir, '..', 'tools', 'harness');
const CAPABILITY_KEYS = capabilities({}).map((c) => c.key);

// ---- The table ------------------------------------------------------------------

test('the table has no duplicate method + path and only known access kinds', () => {
  const seen = new Set();
  for (const route of ROUTES) {
    const id = `${route.method} ${route.path}`;
    assert.ok(!seen.has(id), `${id} is listed twice`);
    seen.add(id);
    assert.ok(/^[A-Z]+$/.test(route.method), `${id}: method`);
    assert.ok(route.path.startsWith('/'), `${id}: path starts with /`);
    if (Array.isArray(route.access)) {
      // Any one of several capabilities: each must exist, and the 403 needs its own words.
      assert.ok(route.access.length > 1, `${id}: a list of one capability should be a plain key`);
      for (const key of route.access) assert.ok(CAPABILITY_KEYS.includes(key), `${id}: unknown capability '${key}'`);
      assert.ok(route.denied, `${id}: a list of capabilities needs a denied message`);
    } else {
      assert.ok(
        ACCESS_KINDS.includes(route.access) || CAPABILITY_KEYS.includes(route.access),
        `${id}: unknown access '${route.access}'`,
      );
    }
    if (route.access === 'other') assert.ok(route.note, `${id}: an 'other' route needs a note`);
    if (route.denied) assert.ok(!['public', 'adminSecret', 'member', 'other'].includes(route.access), `${id}: denied without a gate`);
    const stars = route.path.split('/').filter((s) => s === '*');
    if (stars.length) {
      assert.ok(route.path.endsWith('/*') && stars.length === 1, `${id}: * only as the last segment`);
      assert.ok(route.note, `${id}: a * route says why in its note`);
    }
  }
});

test('every capability that gates a route exists, and the messages stay what the app sees', () => {
  const find = (method, p) => ROUTES.find((r) => r.method === method && r.path === p);
  const pd = '/api/guild/:guild/pulldesk';
  assert.equal(deniedMessage(find('POST', `${pd}/wcl/fights`)), 'Only the owner can compare with Warcraft Logs');
  assert.equal(deniedMessage(find('POST', `${pd}/import/tier`)), 'Only the owner can import a whole tier');
  assert.equal(deniedMessage(find('GET', `${pd}/season`)), 'Your Discord role cannot see Analysis');
  assert.equal(deniedMessage(find('PUT', `${pd}/progression-list`)), 'Your Discord role cannot edit the pull desk');
  assert.equal(deniedMessage(find('PUT', `${pd}/analyze-presets/:specId`)), 'Your Discord role cannot edit guild presets');
  assert.equal(deniedMessage(find('PUT', `${pd}/watcher/settings`)), 'Only officers can change the guild watcher');
  assert.equal(deniedMessage(find('POST', `${pd}/toplogs/crawl`)), 'Officers only');
  assert.equal(deniedMessage(find('PUT', '/api/guild/:guild/permissions')), 'Only the owner can change permissions');
});

// ---- matchRoute -----------------------------------------------------------------

test('matchRoute fills params from decoded parts', () => {
  const hit = matchRoute('GET', '/api/guild/Room%20Forty/pulldesk/pulls/abc');
  assert.equal(hit.route.path, '/api/guild/:guild/pulldesk/pulls/:id');
  assert.deepEqual(hit.params, { guild: 'Room Forty', id: 'abc' });
  // Already-split parts are used as they are (not decoded again).
  const parts = matchRoute('GET', ['api', 'guild', 'g', 'pulldesk', 'pulls', '100%25']);
  assert.equal(parts.params.id, '100%25');
});

test('matchRoute: trailing slashes and empty segments act like the server\'s parts', () => {
  assert.equal(matchRoute('GET', '/api/guild/g/usage/').route.path, '/api/guild/:guild/usage');
  assert.equal(matchRoute('GET', '//api//guild/g//usage').route.path, '/api/guild/:guild/usage');
  // An extra or missing segment is not a match.
  assert.equal(matchRoute('GET', '/api/guild/g/usage/extra'), null);
  assert.equal(matchRoute('GET', '/api/guild'), null);
  assert.equal(matchRoute('GET', '/api'), null);
  assert.equal(matchRoute('GET', '/'), null);
});

test('matchRoute: a known path with another method is 405, an unknown path is null', () => {
  assert.deepEqual(matchRoute('DELETE', '/api/guild/g/usage'), { methodNotAllowed: true });
  assert.deepEqual(matchRoute('POST', '/api/auth/discord/exchange').route.access, 'public');
  assert.deepEqual(matchRoute('GET', '/api/auth/discord/exchange'), { methodNotAllowed: true });
  assert.equal(matchRoute('GET', '/api/guild/g/nothing-here'), null);
  assert.equal(matchRoute('GET', '/api/admin/whatever'), null);
});

test('matchRoute: a literal beats a :param, a :param beats *, whatever the order', () => {
  const routes = [
    { method: 'GET', path: '/a/*', access: 'member', note: 'any depth' },
    { method: 'GET', path: '/a/:x/c', access: 'owner' },
    { method: 'GET', path: '/a/b/c', access: 'public' },
    { method: 'GET', path: '/a/:x/:y', access: 'analysisView' },
    { method: 'POST', path: '/a/b/c', access: 'adminSecret' },
  ];
  const expected = [
    ['GET', '/a/b/c', 'public'],
    ['GET', '/a/q/c', 'owner'],
    ['GET', '/a/b/d', 'analysisView'],
    ['GET', '/a/q/d/e', 'member'],
    ['GET', '/a/q', 'member'],
    ['POST', '/a/b/c', 'adminSecret'],
  ];
  const shuffle = (list, seed) => {
    const copy = [...list];
    let s = seed;
    for (let i = copy.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  for (let seed = 1; seed <= 12; seed++) {
    const match = createMatcher(shuffle(routes, seed));
    for (const [method, p, access] of expected) assert.equal(match(method, p).route.access, access, `${method} ${p} (seed ${seed})`);
    assert.deepEqual(match('GET', '/a/b/c/d/e').params['*'], ['b', 'c', 'd', 'e']);
    assert.equal(match('GET', '/a'), null);
  }
});

test('the real table gives the same answer in any order', () => {
  const reversed = createMatcher([...ROUTES].reverse());
  for (const route of ROUTES) {
    const p = route.path.replace(/:\w+/g, 'v1');
    assert.equal(reversed(route.method, p)?.route, matchRoute(route.method, p)?.route, `${route.method} ${p}`);
    assert.equal(matchRoute(route.method, p)?.route, route, `${route.method} ${p} finds its own entry`);
  }
});

// ---- What the app asks for --------------------------------------------------------

const G = '/api/guild/Room%20Forty';
const PD = `${G}/pulldesk`;
// One example of every request the app makes to the guild server, with the
// file that makes it. A route the app calls that the table lacks fails here.
const APP_CALLS = [
  // src/storage/CloudClient.ts
  ['POST', '/api/auth/discord/exchange'],
  ['GET', `${G}/video`],
  ['POST', `${G}/video`],
  ['PUT', `${G}/video/abc.mp4/timeline`],
  ['GET', `${G}/video/abc.mp4/timeline`],
  ['GET', `${G}/video/abc.mp4/size`],
  ['POST', `${G}/video/abc.mp4/link`],
  ['POST', `${G}/upload`],
  ['POST', `${G}/bulk/delete`],
  ['POST', `${G}/bulk/protect`],
  ['POST', `${G}/bulk/tag`],
  ['GET', `${G}/usage`],
  ['GET', `${G}/limit`],
  ['POST', `${G}/housekeeper`],
  ['GET', '/api/user/affiliations'],
  ['GET', G],
  ['POST', `${G}/chat/abcdef/12.5`],
  ['POST', `${G}/named-chat/Boss%20-%2030.00`],
  ['GET', `${G}/chat/guild-abc`],
  ['POST', `${G}/chat/guild-abc`],
  ['DELETE', `${G}/chat/7`],
  // src/main/BugReport.ts, LiveStreamer.ts, LiveViewer.ts
  ['POST', '/api/bug-report'],
  ['GET', '/api/live/publish'],
  ['GET', '/api/live/streams'],
  // src/main/PullDesk.ts (pullDeskRequest, area 'pulldesk')
  ['GET', `${PD}/config`],
  ['POST', `${PD}/claim`],
  ['POST', `${PD}/backfill`],
  ['GET', `${PD}/pulls?days=7`],
  ['GET', `${PD}/pulls/p1`],
  ['GET', `${PD}/pulls/p1/meters`],
  ['GET', `${PD}/pulls/p1/full`],
  ['POST', `${PD}/pulls/p1/reanalyze`],
  ['GET', `${PD}/meters/trends?encounterId=1`],
  ['GET', `${PD}/bosses/2900`],
  ['PUT', `${PD}/bosses/2900/note`],
  ['PUT', `${PD}/bosses/2900/avoidable`],
  ['PUT', `${PD}/bosses/2900/channel`],
  ['PUT', `${PD}/bosses/2900/avoidable-toggle`],
  ['PUT', `${PD}/bosses/2900/journal`],
  ['PUT', `${PD}/bosses/2900/killed-before`],
  ['GET', `${PD}/summary/nights`],
  ['GET', `${PD}/summary/night/2026-11-18`],
  ['GET', `${PD}/summary/boss/2900?phase=progression`],
  ['GET', `${PD}/season`],
  ['GET', `${PD}/toplogs`],
  ['GET', `${PD}/toplogs/rankings?encounterId=1`],
  ['GET', `${PD}/toplogs/trial?code=a`],
  ['POST', `${PD}/toplogs/crawl`],
  ['GET', `${PD}/toplogs/ours?encounterId=1`],
  ['GET', `${PD}/journal/boss/2900`],
  ['GET', `${PD}/journal/spell/1234`],
  ['GET', `${PD}/journal/talents/262`],
  ['GET', `${PD}/journal/icon/inv_misc_questionmark`],
  ['POST', `${PD}/journal/names`],
  ['POST', `${PD}/journal/items`],
  ['POST', `${PD}/journal/spells`],
  ['POST', `${PD}/wcl/fights`],
  ['POST', `${PD}/wcl/table`],
  ['POST', `${PD}/import`],
  ['GET', `${PD}/import/guild`],
  ['POST', `${PD}/import/guild/scan`],
  ['POST', `${PD}/import/tier`],
  ['PUT', `${PD}/progression-list`],
  ['GET', `${PD}/analyze-presets`],
  ['PUT', `${PD}/analyze-presets/262`],
  ['DELETE', `${PD}/analyze-presets/262`],
  ['GET', `${PD}/settings`],
  ['PUT', `${PD}/settings`],
  ['GET', `${PD}/watcher`],
  ['PUT', `${PD}/watcher/settings`],
  ['POST', `${PD}/watcher/crawl`],
  ['POST', `${PD}/watcher/stop`],
  ['GET', `${PD}/coach/config`],
  ['PUT', `${PD}/coach/mapping`],
  ['POST', `${PD}/coach/send`],
  ['GET', `${PD}/coach/flags?days=7`],
  ['POST', `${PD}/coach/flags`],
  ['PATCH', `${PD}/coach/flags/f1`],
  ['DELETE', `${PD}/coach/flags/f1`],
  // src/main/PullDesk.ts (area 'permissions')
  ['GET', `${G}/permissions/me`],
  ['GET', `${G}/permissions`],
  ['PUT', `${G}/permissions`],
  ['GET', `${G}/permissions/members`],
  ['POST', `${G}/permissions/sign-out`],
  ['POST', `${G}/permissions/reset`],
  // src/main/PullBackfill.ts, PullDesk.ts (uploads)
  ['POST', `${PD}/backfill/check`],
  ['PUT', `${PD}/pulls/p1/log`],
  ['PUT', `${PD}/pulls/p1/full`],
  // src/main/SpellIcons.ts
  ['POST', `${PD}/journal/spells`],
];
// The app also calls these, and the server has never had a route for them
// (CloudClient.ts: multipart uploads, which the server's /upload refuses to
// need; the Warcraft Recorder keystone timer). They stay 404.
const APP_CALLS_WITHOUT_ROUTE = [
  ['POST', `${G}/create-multipart-upload`],
  ['POST', `${G}/complete-multipart-upload`],
  ['GET', '/api/keystone/timer/1234'],
];

test('every request the app makes has a route in the table', () => {
  for (const [method, url] of APP_CALLS) {
    const hit = matchRoute(method, url.split('?')[0]);
    assert.ok(hit?.route, `${method} ${url} is not in routes.mjs`);
  }
  for (const [method, url] of APP_CALLS_WITHOUT_ROUTE) {
    assert.equal(matchRoute(method, url), null, `${method} ${url}`);
  }
});

// ---- The real server ----------------------------------------------------------------

const SECRET = 'routes-test-secret-value-long-enough';
const ADMIN = 'routes-test-admin-secret';
const GUILD = 'Room Forty';
const OWNER = '100000000000000001';
const BOB = '100000000000000003';

const tokenFor = (discordId, userName) => {
  const now = Math.floor(Date.now() / 1000);
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

const startServer = async ({ countFile } = {}) => {
  const port = await freePort();
  const fixtureFile = path.join(os.tmpdir(), `rf-discord-routes-${port}.json`);
  fs.writeFileSync(
    fixtureFile,
    JSON.stringify({ roles: [{ id: '1', name: 'Raider' }], members: { [BOB]: ['1'] } }),
  );
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-routes-gate-'));
  fs.writeFileSync(
    path.join(storage, 'state.json'),
    JSON.stringify({
      videos: [{ videoKey: 'bob.mp4', videoName: 'bob', uploadedBy: BOB, uploadedByName: 'Bob' }],
      chats: [],
      links: [],
      knownUsers: { [BOB]: { userName: 'Bob' } },
      nextMessageId: 1,
    }),
  );
  const child = spawn(
    process.execPath,
    [
      '--import', path.join(harness, 'aws-stub.mjs'),
      '--import', path.join(harness, 'discord-stub.mjs'),
      ...(countFile ? ['--import', countFile] : []),
      path.join(dir, 'server.mjs'),
    ],
    {
      env: {
        PATH: process.env.PATH,
        RF_HARNESS_AWS_STUB: '1',
        RF_HARNESS_R2_KEYS: 'bob.mp4',
        RF_HARNESS_DISCORD_FIXTURE: fixtureFile,
        GUILD_CLOUD_DISCORD_BOT_TOKEN: 'stub',
        GUILD_CLOUD_DISCORD_GUILD_ID: '1234',
        GUILD_CLOUD_DISCORD_ALLOWED_ROLES: 'Raider',
        GUILD_CLOUD_HOST: '127.0.0.1',
        GUILD_CLOUD_PORT: String(port),
        GUILD_CLOUD_STORAGE_PATH: storage,
        GUILD_CLOUD_SECRET: SECRET,
        GUILD_CLOUD_ADMIN_SECRET: ADMIN,
        GUILD_CLOUD_GUILD: GUILD,
        GUILD_CLOUD_OWNER_IDS: OWNER,
        ...(countFile ? { RF_COUNT_FILE: `${countFile}.count` } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
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
  const call = async (method, url, { who, headers = {}, body } = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(who ? { Authorization: `Bearer ${tokenFor(...who)}` } : {}),
        ...headers,
      },
      body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const stop = () => {
    child.removeAllListeners('exit');
    child.kill();
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(fixtureFile, { force: true });
  };
  return { call, stop };
};

// The route's path with dummy values in the params: numbers where the
// handler parses a number, a date where it wants one.
const fill = (route) =>
  route.path
    .replace(':guild', encodeURIComponent(GUILD))
    .replace(/(journal\/(?:boss|spell|talents|raw)|bosses|summary\/boss|analyze-presets)\/:\w+/, '$1/2900')
    .replace('/chat/:id', '/chat/7')
    .replace(':date', '2026-11-18')
    .replace(':key', 'bob.mp4')
    .replace(/:\w+/g, 'dummy1');

// A handler's own "no such route" answer (the gate's 404 is the same text).
const noSuchRoute = (r) => /^Unknown .* route$|^Unknown summary$/.test(r.body?.error || '');

const gated = ROUTES.filter((r) => r.access !== 'other');
const owner = [OWNER, 'Owner'];
const bob = [BOB, 'Bob'];
const unknownRoute = (r) => r.status === 404 && r.body?.error === 'Unknown API route';

test('the gate: signed out, no grants, unknown paths and wrong methods, for every route', { timeout: 240000 }, async () => {
  const { call, stop } = await startServer();
  try {
    // Nobody is granted anything: every capability list is emptied.
    const emptied = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, []]));
    const saved = await call('PUT', `${G}/permissions`, { who: owner, body: { grants: emptied } });
    assert.equal(saved.status, 200);

    for (const route of gated) {
      const url = fill(route);
      const label = `${route.method} ${route.path}`;

      // Signed out.
      const out = await call(route.method, url);
      if (route.access === 'public') {
        assert.ok(!noSuchRoute(out) && out.status !== 405, `${label} (signed out) reaches its handler`);
      } else if (route.access === 'adminSecret') {
        assert.equal(out.status, 401, `${label} (no secret)`);
        assert.equal(out.body?.error, 'Invalid admin secret', `${label} (no secret)`);
        const wrong = await call(route.method, url, { headers: { 'x-admin-secret': 'nope' } });
        assert.equal(wrong.status, 401, `${label} (wrong secret)`);
      } else {
        assert.equal(out.status, 401, `${label} (signed out)`);
        assert.equal(out.body?.error, 'Discord sign-in required', `${label} (signed out)`);
      }

      // A member whose roles grant nothing.
      const member = await call(route.method, url, { who: bob });
      const gatedOff = !['public', 'adminSecret', 'member'].includes(route.access);
      if (gatedOff) {
        assert.equal(member.status, 403, `${label} (member with no grants) -> ${member.status} ${JSON.stringify(member.body)}`);
        assert.equal(member.body?.error, deniedMessage(route), `${label} message`);
      } else if (route.access === 'member') {
        assert.ok(member.status !== 401 && member.status !== 405 && !noSuchRoute(member), `${label} (member) reaches its handler: ${member.status} ${JSON.stringify(member.body)}`);
      }
    }

    // A path nobody serves: the gate's 404, signed in or not.
    for (const url of [`${G}/nothing`, `${PD}/nothing`, '/api/nothing', '/api', `${G}/usage/extra`, '/api/admin/nothing']) {
      for (const who of [undefined, bob]) {
        const r = await call('GET', url, { who });
        assert.ok(unknownRoute(r), `GET ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
      }
    }

    // A known path with a method it doesn't have: 405, whoever asks.
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const paths = [...new Set(gated.map((r) => r.path))];
    for (const p of paths) {
      // Paths that differ only in a param's name (chat/:correlator, chat/:id) are one path.
      const shape = (x) => x.replace(/:\w+/g, ':');
      const taken = new Set(gated.filter((r) => shape(r.path) === shape(p)).map((r) => r.method));
      const method = methods.find((m) => !taken.has(m));
      const r = await call(method, fill({ path: p }), { who: bob });
      assert.equal(r.status, 405, `${method} ${p} -> ${r.status}`);
      assert.equal(r.body?.error, 'Method not allowed');
    }
  } finally {
    stop();
  }
});

test('the gate: owners, "view as", and the admin secret', { timeout: 120000 }, async () => {
  const { call, stop } = await startServer();
  try {
    // The owner reaches owner routes, and a "view as" owner reaches only the
    // permissions ones (so they can switch back).
    assert.equal((await call('GET', `${G}/permissions`, { who: owner })).status, 200);
    assert.equal((await call('GET', `${PD}/import/guild`, { who: owner })).status, 200);
    const asRaider = { who: owner, headers: { 'X-View-As-Role': 'raider' } };
    assert.equal((await call('GET', `${G}/permissions`, asRaider)).status, 200);
    const blocked = await call('GET', `${PD}/import/guild`, asRaider);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'Only the owner can import a whole tier');
    // Someone who isn't an owner gets nothing from the header.
    assert.equal((await call('GET', `${G}/permissions`, { who: bob })).status, 403);

    // A capability everyone has by default is open; one the owner revokes is
    // shut, and "view as" a role without it shuts it for the owner too.
    assert.equal((await call('GET', `${PD}/season`, { who: bob })).status, 200);
    const noView = await call('PUT', `${G}/permissions`, { who: owner, body: { grants: { analysisView: [] } } });
    assert.equal(noView.status, 200);
    const denied = await call('GET', `${PD}/season`, { who: bob });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Your Discord role cannot see Analysis');
    assert.equal((await call('GET', `${PD}/season`, { who: owner })).status, 200);
    assert.equal((await call('GET', `${PD}/season`, asRaider)).status, 403);

    // 1.9.159: the watcher follows See Analysis like the rest of Analysis.
    const watcher = await call('GET', `${PD}/watcher`, { who: bob });
    assert.equal(watcher.status, 403);
    assert.equal(watcher.body.error, 'Your Discord role cannot see Analysis');

    // Flagged moments: Watch live or See Analysis is enough to read them,
    // making one needs Watch live, and with neither they're shut.
    const flagBody = { at: Date.now(), streamer: 'Evi', note: 'swirl' };
    const liveOnly = await call('PUT', `${G}/permissions`, { who: owner, body: { grants: { analysisView: [], liveWatch: ['raider'] } } });
    assert.equal(liveOnly.status, 200);
    assert.equal((await call('GET', `${PD}/coach/flags`, { who: bob })).status, 200, 'Watch live alone reads flags');
    assert.equal((await call('POST', `${PD}/coach/flags`, { who: bob, body: flagBody })).status, 200);
    const shut = await call('PUT', `${G}/permissions`, { who: owner, body: { grants: { analysisView: [], liveWatch: [] } } });
    assert.equal(shut.status, 200);
    const noFlags = await call('GET', `${PD}/coach/flags`, { who: bob });
    assert.equal(noFlags.status, 403);
    assert.equal(noFlags.body.error, 'Your Discord role cannot see flagged moments');
    const noFlagging = await call('POST', `${PD}/coach/flags`, { who: bob, body: flagBody });
    assert.equal(noFlagging.status, 403);
    assert.equal(noFlagging.body.error, 'Your Discord role cannot flag moments');
    const viewOnly = await call('PUT', `${G}/permissions`, { who: owner, body: { grants: { analysisView: ['@everyone'], liveWatch: [] } } });
    assert.equal(viewOnly.status, 200);
    assert.equal((await call('GET', `${PD}/coach/flags`, { who: bob })).status, 200, 'See Analysis alone reads flags');
    assert.equal((await call('POST', `${PD}/coach/flags`, { who: bob, body: flagBody })).status, 403);

    // Edit Analysis without See Analysis edits nothing.
    const blind = await call('PUT', `${G}/permissions`, {
      who: owner,
      body: { grants: { analysisView: [], analysisEdit: ['@everyone'] } },
    });
    assert.equal(blind.status, 200);
    const blindEdit = await call('PUT', `${PD}/progression-list`, { who: bob, body: { shown: [] } });
    assert.equal(blindEdit.status, 403);
    assert.equal(blindEdit.body.error, 'Your Discord role cannot edit the pull desk');
    const both = await call('PUT', `${G}/permissions`, {
      who: owner,
      body: { grants: { analysisView: ['@everyone'], analysisEdit: ['@everyone'] } },
    });
    assert.equal(both.status, 200);
    assert.notEqual((await call('PUT', `${PD}/progression-list`, { who: bob, body: { shown: [] } })).status, 403);

    // The admin secret: right one in, the rest of the route behaves as before.
    const admin = { headers: { 'x-admin-secret': ADMIN } };
    const users = await call('GET', '/api/admin/users', admin);
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(users.body.users));
    assert.equal((await call('GET', '/api/admin/users', { who: owner })).status, 401);
    assert.equal((await call('POST', '/api/admin/revoke', admin)).status, 400);
  } finally {
    stop();
  }
});

// Someone who has every capability (the owner) gets past the gate on every
// route, and every route reaches a handler that serves it.
const GRANTED_SKIPS = {
  'POST /api/guild/:guild/pulldesk/wcl/fights': 'calls Warcraft Logs for real',
  'POST /api/guild/:guild/pulldesk/wcl/table': 'calls Warcraft Logs for real',
  'POST /api/guild/:guild/pulldesk/import/tier': 'starts a Warcraft Logs import',
  'POST /api/guild/:guild/pulldesk/import/guild/scan': 'calls Warcraft Logs for real',
  'POST /api/admin/orphans/delete': 'deletes R2 objects',
  'POST /api/admin/revoke-all': 'signs every session out, ending the test',
  'POST /api/auth/discord/exchange': 'has no session to grant (public)',
};

test('the gate: a caller with every capability reaches a handler on every route', { timeout: 240000 }, async () => {
  const { call, stop } = await startServer();
  try {
    for (const route of gated) {
      const label = `${route.method} ${route.path}`;
      if (GRANTED_SKIPS[label]) continue;
      const url = fill(route);
      const adminOnly = route.access === 'adminSecret';
      const r = await call(route.method, url, adminOnly ? { headers: { 'x-admin-secret': ADMIN } } : { who: owner });
      const detail = `${label} -> ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`;
      assert.ok(![401, 403, 405].includes(r.status), detail);
      assert.ok(!noSuchRoute(r), detail);
    }
  } finally {
    stop();
  }
});

// `authorized` (the token check, then the Discord role lookup) runs once per
// request, in the gate. The role lookup is cached for 5 minutes, so a second
// call would not show there; the token check HMACs the token on every call,
// so this counts HMACs through a preload that wraps crypto.createHmac.
test('the gate: the session is checked once per request', { timeout: 60000 }, async () => {
  const countFile = path.join(os.tmpdir(), `rf-hmac-count-${process.pid}.mjs`);
  fs.writeFileSync(
    countFile,
    `import crypto from 'node:crypto';
import fs from 'node:fs';
const real = crypto.createHmac;
crypto.createHmac = (...args) => { if (process.env.RF_COUNT_FILE) fs.appendFileSync(process.env.RF_COUNT_FILE, 'x'); return real.apply(crypto, args); };
`,
  );
  const counter = `${countFile}.count`;
  fs.writeFileSync(counter, '');
  const { call, stop } = await startServer({ countFile });
  const counted = async (method, url, options) => {
    const before = fs.readFileSync(counter, 'utf8').length;
    const r = await call(method, url, options);
    return { r, checks: fs.readFileSync(counter, 'utf8').length - before };
  };
  try {
    const cases = [
      ['member', 'GET', `${G}/usage`, { who: bob }, 200],
      ['capability', 'GET', `${PD}/season`, { who: bob }, 200],
      ['owner', 'GET', `${PD}/import/guild`, { who: owner }, 200],
      ['owner always', 'GET', `${G}/permissions`, { who: owner }, 200],
      ['refused (403)', 'PUT', `${PD}/settings`, { who: bob }, 403],
      ['signed out', 'GET', `${G}/usage`, {}, 401],
    ];
    for (const [name, method, url, options, status] of cases) {
      const { r, checks } = await counted(method, url, options);
      assert.equal(r.status, status, name);
      // A request with a token is checked exactly once; one without has none to check.
      assert.equal(checks, options.who ? 1 : 0, `${name}: token checks`);
    }
  } finally {
    stop();
    fs.rmSync(countFile, { force: true });
    fs.rmSync(counter, { force: true });
  }
});
