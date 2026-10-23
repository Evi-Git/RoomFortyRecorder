import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createPermissions, EVERYONE } from './permissions.mjs';

const ROLES = { '1': ['officer'], '2': ['raider'], '3': ['trial'], '9': ['evi', 'officer'] };

const setup = async (env = {}) => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'perm-'));
  const perms = createPermissions({
    storage,
    env: { GUILD_CLOUD_OWNER_IDS: '99999', ...env },
    memberRoleNames: async (id) => ROLES[id] ?? [],
    guildRoles: async () => [
      { id: 'a', name: 'Officer', position: 3, color: 0 },
      { id: 'b', name: 'Raider', position: 2, color: 0 },
      { id: 'c', name: 'Trial', position: 1, color: 0 },
    ],
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

test('only the owner reads and saves the table; saved grants apply', async () => {
  const { perms, call, storage } = await setup();
  assert.equal((await call('1', 'GET', [])).status, 403);
  const table = await call('99999', 'GET', []);
  assert.equal(table.status, 200);
  assert.ok(table.body.columns.includes('trial'));
  assert.ok(table.body.columns.includes(EVERYONE));
  assert.equal(table.body.roles.length, 3);
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
