// Logs → Analyze guild presets: shared per spec, cleaned, editors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanWidgets, createPullDesk } from './pulldesk.mjs';

const setup = async (roles = ['officer']) => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-presets-'));
  const make = () =>
    createPullDesk({
      storage,
      readBody: async (req) => req.body || {},
      json: (res, status, body) => Object.assign(res, { status, body }),
      fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
      memberRoleNames: async (id) => (id === '1' ? roles : ['raider']),
      editorRoles: ['officer'],
      botToken: '',
      env: { GUILD_CLOUD_PULLDESK_EDITOR_ROLES: 'officer' },
      wcl: { configured: false },
      noTimers: true,
    });
  const desk = make();
  await desk.ready();
  const call = async (method, rest, body, who = '1', d = desk) => {
    const res = {};
    await d.handle({ method, body, cloudUserId: who, cloudUserName: who === '1' ? 'Evi' : 'Raider' }, res, rest, new URL('http://x/'));
    return res;
  };
  return { call, make };
};

test('clean widgets: known fields only, bad lists refused', () => {
  const [w] = cleanWidgets([
    { id: 'a', kind: 'castEfficiency', spell: { name: ' Stasis ', id: 370537, x: 1 }, cooldown: 90, target: 0.9, talent: [1, 'x'], junk: 'no', optional: 'yes' },
  ]);
  assert.deepEqual(w, { id: 'a', kind: 'castEfficiency', spell: { name: 'Stasis', id: 370537 }, cooldown: 90, talent: [1], target: 0.9 });
  assert.equal(cleanWidgets([{ id: 'a', kind: 'nope' }]), null);
  assert.equal(cleanWidgets([{ id: 'a', kind: 'count' }, { id: 'a', kind: 'count' }]), null);
  assert.equal(cleanWidgets('x'), null);
  assert.equal(cleanWidgets(Array.from({ length: 41 }, (_, i) => ({ id: `w${i}`, kind: 'count' }))), null);
});

test('guild presets: set, read, kept after a restart, cleared', async () => {
  const { call, make } = await setup();
  const widgets = [{ id: 'active', kind: 'activeTime' }, { id: 'ce', kind: 'castEfficiency', spell: { name: 'Stasis' } }];
  const put = await call('PUT', ['analyze-presets', '1468'], { widgets });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const got = await call('GET', ['analyze-presets'], undefined, '2');
  assert.deepEqual(got.body.presets['1468'].widgets, widgets);
  assert.equal(got.body.presets['1468'].updatedBy, 'Evi');
  // A raider can't change them.
  assert.equal((await call('PUT', ['analyze-presets', '1468'], { widgets: [] }, '2')).status, 403);
  assert.equal((await call('PUT', ['analyze-presets', '1468'], { widgets: [{ kind: 'x' }] })).status, 400);
  // Saved with the pull desk's settings.
  const again = make();
  await again.ready();
  assert.deepEqual((await call('GET', ['analyze-presets'], undefined, '2', again)).body.presets['1468'].widgets, widgets);
  const del = await call('DELETE', ['analyze-presets', '1468']);
  assert.deepEqual(del.body.presets, {});
});
