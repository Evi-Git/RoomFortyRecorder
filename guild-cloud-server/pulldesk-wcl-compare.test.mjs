import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createWclCompare } from './pulldesk-wcl-compare.mjs';
import { createPullDesk } from './pulldesk.mjs';

const T0 = Date.parse('2026-10-20T00:30:00Z');
const report = {
  code: 'bH7Mh4AQpxfP3Gkq',
  title: 'Mythic',
  startTime: T0,
  fights: [
    { id: 1, name: 'Trash', encounterID: 0, difficulty: 0, startTime: 0, endTime: 1000 },
    { id: 3, name: "Kith'ix", encounterID: 3500, difficulty: 5, kill: false, startTime: 60000, endTime: 660000, fightPercentage: 40 },
  ],
  masterData: { actors: [{ id: 7, name: 'Evipaladin', subType: 'Paladin' }] },
};

const fakeWcl = () => {
  const calls = [];
  return {
    calls,
    configured: true,
    query: async (text, vars) => {
      calls.push(vars);
      if (text.includes('table(')) {
        return { reportData: { report: { table: JSON.stringify({ data: { entries: [{ name: 'Evipaladin', total: 5, type: vars.type }] } }) } } };
      }
      return { reportData: { report } };
    },
  };
};

test('fights: boss fights only, with absolute start; cached', async () => {
  const wcl = fakeWcl();
  const c = createWclCompare({ wcl });
  const f = await c.fights('https://www.warcraftlogs.com/reports/bH7Mh4AQpxfP3Gkq#fight=3');
  assert.equal(f.fights.length, 1);
  assert.equal(f.fights[0].start, T0 + 60000);
  assert.equal(f.fights[0].seconds, 600);
  assert.equal(f.players[0].name, 'Evipaladin');
  await c.fights('bH7Mh4AQpxfP3Gkq');
  assert.equal(wcl.calls.length, 1);
});

test('table: checks its arguments and passes them on', async () => {
  const wcl = fakeWcl();
  const c = createWclCompare({ wcl });
  const t = await c.table('bH7Mh4AQpxfP3Gkq', { fight: 3, type: 'DamageTaken', source: 7, view: 'Ability' });
  assert.equal(t.entries[0].type, 'DamageTaken');
  assert.deepEqual(wcl.calls[0], { code: 'bH7Mh4AQpxfP3Gkq', fight: 3, type: 'DamageTaken', source: 7, view: 'Ability', side: 'Friendlies' });
  await assert.rejects(c.table('bH7Mh4AQpxfP3Gkq', { fight: 3, type: 'Nope' }), /Unknown table/);
  await assert.rejects(c.table('nope', { fight: 3, type: 'Casts' }), /report link/);
});

test('compare routes are owner-only', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-wcl-'));
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    wcl: fakeWcl(),
    isOwner: (id) => id === '99',
  });
  await desk.ready();
  const call = async (who, rest, body) => {
    const res = {};
    await desk.handle({ method: 'POST', body, headers: {}, cloudUserId: who, cloudUserName: who }, res, rest, new URL('http://x/'));
    return res;
  };
  assert.equal((await call('1', ['wcl', 'fights'], { report: 'bH7Mh4AQpxfP3Gkq' })).status, 403);
  const ok = await call('99', ['wcl', 'fights'], { report: 'bH7Mh4AQpxfP3Gkq' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.fights[0].id, 3);
  const t = await call('99', ['wcl', 'table'], { report: 'bH7Mh4AQpxfP3Gkq', fight: 3, type: 'Casts' });
  assert.equal(t.body.table.entries[0].type, 'Casts');
});
