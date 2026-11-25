import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createPermissions, EVERYONE, IMPLIES } from './permissions.mjs';

const ROLES = { '1': ['officer'], '2': ['raider'], '3': ['trial'], '9': ['evi', 'officer'] };

const setup = async (env = {}, extra = {}) => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'perm-'));
  const perms = createPermissions({
    storage,
    env: { GUILD_CLOUD_OWNER_IDS: '99999', ...env },
    memberRoleNames: async (id) => ROLES[id] ?? [],
    guildRoles: async () => [
      { id: 'a', name: 'Officer', position: 3, color: 0 },
      { id: 'b', name: 'Raider', position: 2, color: 0 },
      { id: 'c', name: 'Trial', position: 1, color: 0 },
      { id: 'd', name: 'Evi', position: 9, color: 0 },
    ],
    ...extra,
  });
  const res = () => ({});
  const io = {
    readBody: async (req) => req.body,
    json: (r, status, body) => Object.assign(r, { status, body }),
    fail: (r, status, error) => Object.assign(r, { status, body: { error } }),
  };
  const call = async (who, method, rest, body, headers = {}) =>
    perms.handle({ method, body, headers, cloudUserId: who, cloudUserName: who }, res(), rest, io);
  return { storage, perms, call };
};

const req = (id, viewAs) => ({ cloudUserId: id, headers: viewAs ? { 'x-view-as-role': viewAs } : {} });

test('defaults follow the old .env role lists', async () => {
  const { perms } = await setup({ GUILD_CLOUD_LIVE_VIEWER_ROLES: 'Raider,Officer' });
  assert.equal(await perms.can(req('2'), 'liveWatch'), true);
  assert.equal(await perms.can(req('3'), 'liveWatch'), false);
  assert.equal(await perms.can(req('3'), 'analysisView'), true); // everyone
  assert.equal(await perms.can(req('2'), 'clipSendAny'), false);
  assert.equal(await perms.can(req('1'), 'clipSendAny'), true);
  assert.equal(await perms.can(req('1'), 'nonsense'), false);
});

test('owner can do everything; view as a role answers as that role only', async () => {
  const { perms, call } = await setup();
  assert.equal(await perms.can(req('99999'), 'recruit'), true);
  assert.equal(await perms.can(req('99999', 'Trial'), 'clipSendAny'), false);
  assert.equal(await perms.can(req('99999', 'officer'), 'clipSendAny'), true);
  assert.equal(await perms.can(req('99999', EVERYONE), 'analysisView'), true);
  // Someone else can't use the header.
  assert.equal(await perms.can(req('3', 'officer'), 'clipSendAny'), false);
  const me = await call('99999', 'GET', ['me'], undefined, { 'x-view-as-role': 'trial' });
  assert.equal(me.body.owner, true);
  assert.equal(me.body.viewAs, 'trial');
  assert.equal(me.body.can.liveWatch, false);
  assert.equal(me.body.can.analysisView, true);
});

test('Edit Analysis needs See Analysis too (1.9.159)', async () => {
  const { perms, call } = await setup();
  // Officers may edit, trials may only see; then trials lose See Analysis
  // while keeping Edit: they can do neither.
  const saved = await call('99999', 'PUT', [], {
    grants: { analysisView: ['officer', 'trial'], analysisEdit: ['officer', 'trial'] },
  });
  assert.equal(saved.status, 200);
  assert.equal(await perms.can(req('3'), 'analysisEdit'), true);
  await call('99999', 'PUT', [], { grants: { analysisView: ['officer'], analysisEdit: ['officer', 'trial'] } });
  assert.equal(await perms.can(req('3'), 'analysisEdit'), false);
  assert.equal(await perms.canUser('3', 'analysisEdit'), false);
  assert.equal(await perms.can(req('1'), 'analysisEdit'), true);
  // "View as" trial answers the same; the owner themselves keeps everything.
  assert.equal(await perms.can(req('99999', 'trial'), 'analysisEdit'), false);
  assert.equal(await perms.can(req('99999'), 'analysisEdit'), true);
  const me = await call('3', 'GET', ['me']);
  assert.equal(me.body.can.analysisEdit, false);
});

test('only the owner reads and saves the table; saved grants apply', async () => {
  const { perms, call, storage } = await setup();
  assert.equal((await call('1', 'GET', [])).status, 403);
  const table = await call('99999', 'GET', []);
  assert.equal(table.status, 200);
  // The owner is "99999" here; as "Evi", their own role is left out.
  const asEvi = await perms.handle(
    { method: 'GET', headers: {}, cloudUserId: '99999', cloudUserName: 'Evi' },
    {},
    [],
    { readBody: async () => ({}), json: (r, status, body) => Object.assign(r, { status, body }), fail: () => {} },
  );
  assert.ok(!asEvi.body.roles.some((r) => r.name === 'Evi'));
  assert.ok(table.body.columns.includes('trial'));
  assert.ok(table.body.columns.includes(EVERYONE));
  assert.equal(table.body.roles.length, 4);
  const grants = Object.fromEntries(table.body.capabilities.map((c) => [c.key, c.grants]));
  grants.liveWatch = ['Trial', 'raider+', 'officer'];
  const put = await call('99999', 'PUT', [], { grants, columns: ['officer', 'raider', 'trial', 'trial'] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.columns, ['officer', 'raider', 'trial']);
  assert.equal(await perms.can(req('3'), 'liveWatch'), true);
  // Survives a restart.
  const again = createPermissions({ storage, env: {}, memberRoleNames: async (id) => ROLES[id] ?? [] });
  assert.equal(await again.canUser('3', 'liveWatch'), true);
  assert.equal((await call('99999', 'POST', ['reset'])).status, 200);
  assert.equal(await perms.can(req('3'), 'liveWatch'), false);
});

test('recording and chat moderation default to officers and can be granted', async () => {
  const { perms, call } = await setup();
  for (const key of ['videoManage', 'chatModerate']) {
    assert.equal(await perms.can(req('1'), key), true); // officer
    assert.equal(await perms.can(req('2'), key), false); // raider
    assert.equal(await perms.can(req('99999'), key), true); // owner
  }
  const table = await call('99999', 'GET', []);
  const video = table.body.capabilities.find((c) => c.key === 'videoManage');
  assert.equal(video.group, 'Recordings');
  assert.deepEqual(video.grants, ['officer']);

  const grants = Object.fromEntries(table.body.capabilities.map((c) => [c.key, c.grants]));
  grants.videoManage = ['raider'];
  assert.equal((await call('99999', 'PUT', [], { grants })).status, 200);
  assert.equal(await perms.can(req('2'), 'videoManage'), true);
  assert.equal(await perms.can(req('2'), 'chatModerate'), false);
});

test('only the owner lists members and signs one out', async () => {
  const signedOut = [];
  const known = ['1', '2', '99999'];
  const { call } = await setup(
    {},
    {
      listMembers: () => ({
        now: 500,
        members: [
          { discordId: '1', userName: 'Old', lastLogin: 100, signedOut: false },
          { discordId: '99999', userName: 'Boss', lastLogin: 300, signedOut: false },
          { discordId: '2', userName: 'New', lastLogin: 200, signedOut: true },
        ],
      }),
      signOutMember: async (id) => {
        if (!known.includes(id)) return false;
        signedOut.push(id);
        return true;
      },
    },
  );

  let r = await call('99999', 'GET', ['members'], undefined, { 'x-view-as-role': 'trial' });
  assert.equal(r.status, 200);
  assert.equal(r.body.now, 500);
  assert.deepEqual(r.body.members.map((m) => m.userName), ['Boss', 'New', 'Old']);
  assert.deepEqual(r.body.members.map((m) => m.owner), [true, undefined, undefined]);

  for (const who of ['1', '9']) {
    r = await call(who, 'GET', ['members']);
    assert.equal(r.status, 403);
    r = await call(who, 'POST', ['sign-out'], { discordId: '2' });
    assert.equal(r.status, 403);
  }
  assert.deepEqual(signedOut, []);

  r = await call('99999', 'POST', ['sign-out'], { discordId: '2' });
  assert.equal(r.status, 200);
  assert.deepEqual(signedOut, ['2']);

  r = await call('99999', 'POST', ['sign-out'], { discordId: '777' });
  assert.equal(r.status, 400);
  r = await call('99999', 'POST', ['sign-out'], {});
  assert.equal(r.status, 400);
  r = await call('99999', 'POST', ['sign-out'], { discordId: '99999' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "The owner can't be signed out here.");
  assert.deepEqual(signedOut, ['2']);
});

test("the app's Admin grid shows the same needs as IMPLIES", async () => {
  const file = new URL('../src/renderer/admin/capabilityNeeds.ts', import.meta.url);
  const text = await fsp.readFile(file, 'utf8');
  // Comments out first, so a commented-out entry can't count.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const body = code.match(/CAPABILITY_NEEDS[^=]*=\s*\{([^}]*)\}/)?.[1];
  assert.ok(body, 'CAPABILITY_NEEDS object not found');
  const needs = {};
  for (const line of body.split('\n').filter((l) => l.trim())) {
    // Every line must be one `key: ['needed', ...],` pair, so nothing slips past.
    const match = line.match(/^\s*(\w+):\s*\[((?:\s*'\w+',?)*)\s*\],?\s*$/);
    assert.ok(match, `Unexpected line in CAPABILITY_NEEDS: ${line.trim()}`);
    needs[match[1]] = [...match[2].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  }
  assert.deepEqual(needs, IMPLIES);
});
