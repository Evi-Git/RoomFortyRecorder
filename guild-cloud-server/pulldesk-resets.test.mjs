import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { isReset, numberPulls, RESET_SECONDS } from './pulldesk-resets.mjs';
import { abilityStats, listNights, summarizeNight, summarizeProgression } from './pulldesk-summary.mjs';
import { createPullDesk } from './pulldesk.mjs';

const NIGHT = '2026-10-14';
const at = (n) => Date.parse(`${NIGHT}T20:00:00Z`) + n * 300000;
const mk = (n, duration, result = 'wipe', pct = 50, deaths = [], mass = null) => ({
  summary: { id: `p${n}`, encounterId: 1, encounterName: 'Boss', difficultyId: 16, night: NIGHT, result, bossPercent: pct, duration, startedAt: at(n) },
  report: {
    result,
    duration,
    roster: [{ name: 'Mage', role: 'dps', specId: 63 }],
    deaths: deaths.map((spell, i) => ({ t: i, name: 'Mage', role: 'dps', killingBlow: { spellName: spell, spellId: 5 } })),
    wipe: mass ? { massDeath: { spellName: mass, spellId: 9, count: 6, t: 1 } } : {},
    plan: { items: [] },
    avoidable: [],
    defensives: { players: [] },
  },
});

test('the reset rule: under 10 s, unknown durations are real pulls', () => {
  assert.equal(RESET_SECONDS, 10);
  assert.equal(isReset({ duration: 0 }), true);
  assert.equal(isReset({ duration: 9.9 }), true);
  assert.equal(isReset({ duration: 10 }), false);
  assert.equal(isReset({ duration: null }), false);
  assert.equal(isReset({}), false);
});

test('pull numbers skip resets; a reset carries the last real number', () => {
  const pulls = [
    { id: 'a', night: 'n1', startedAt: 1, duration: 0 },
    { id: 'b', night: 'n1', startedAt: 2, duration: 120 },
    { id: 'c', night: 'n1', startedAt: 3, duration: 4 },
    { id: 'd', night: 'n1', startedAt: 4, duration: 200 },
    { id: 'e', night: 'n2', startedAt: 5, duration: 1 },
    { id: 'f', night: 'n2', startedAt: 6, duration: 90 },
  ];
  numberPulls(pulls);
  assert.deepEqual(pulls.map((p) => [p.id, p.pullNumber, p.totalPullNumber]), [
    ['a', 0, 0],
    ['b', 1, 1],
    ['c', 1, 1],
    ['d', 2, 2],
    ['e', 0, 2],
    ['f', 1, 3],
  ]);
});

test('night and boss counts leave resets out but still list them flagged', () => {
  const pulls = [
    mk(1, 0, 'wipe', 100),
    mk(2, 150, 'wipe', 60, ['Spit']),
    mk(3, 3, 'wipe', 100),
    mk(4, 200, 'wipe', 30, ['Crush']),
    mk(5, 250, 'kill', 0),
  ];
  const [boss] = summarizeNight(pulls);
  assert.equal(boss.pulls, 3);
  assert.equal(boss.resets, 2);
  assert.equal(boss.kills, 1);
  assert.equal(boss.medianPercent, 45); // 60 and 30; the 100% resets don't count
  assert.equal(boss.combatSeconds, 600);
  assert.equal(boss.longestPull, 250);
  assert.deepEqual(boss.causes.map((c) => c.name).sort(), ['Crush', 'Spit']); // no "Reset" row
  assert.equal(boss.pullsList.length, 5);
  assert.deepEqual(boss.pullsList.map((p) => p.reset), [true, false, true, false, false]);
  assert.equal(boss.raiders.find((r) => r.name === 'Mage').pulls, 3);

  const prog = summarizeProgression(pulls);
  assert.equal(prog.pulls, 3);
  assert.deepEqual(prog.series.map((s) => [s.n, s.percent]), [[1, 60], [2, 30], [3, 0]]);
  assert.deepEqual(prog.firstKill, { pull: 3, night: NIGHT });

  const [night] = listNights(pulls.map((p) => p.summary));
  assert.equal(night.bosses[0].pulls, 3);
  assert.equal(night.bosses[0].resets, 2);
  assert.equal(night.bosses[0].bestPercent, 30); // best wipe
  assert.equal(abilityStats([mk(1, 2, 'wipe', 100, ['Crush'])]).length, 0);
});

test('one ability is one cause row, with its raid-wide wipes counted on it', () => {
  const pulls = [
    mk(1, 100, 'wipe', 50, ['Venom Roar'], 'Venom Roar'),
    mk(2, 100, 'wipe', 40, ['Venom Roar']),
    mk(3, 100, 'wipe', 30, ['Venom Roar'], 'Venom Roar'),
  ];
  const [boss] = summarizeNight(pulls);
  assert.equal(boss.causes.length, 1);
  assert.deepEqual(boss.causes[0], { name: 'Venom Roar', count: 3, raidWide: 2, spellId: 5 });
  assert.deepEqual(boss.pullsList.map((p) => [p.cause, p.raidWide]), [['Venom Roar', true], ['Venom Roar', false], ['Venom Roar', true]]);
  assert.equal(abilityStats(pulls).find((s) => s.name === 'Venom Roar').wipes, 3);
});

test('the server numbers claims without counting resets, and flags them', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-resets-'));
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    noTimers: true,
  });
  await desk.ready();
  const call = async (method, rest, body) => {
    const res = {};
    await desk.handle({ method, body, cloudUserId: '1', cloudUserName: 'Evi' }, res, rest, new URL('http://x/'));
    return res;
  };
  const base = Date.now() - 3600000;
  const durations = [0, 150, 8, 200]; // the claims are more than 3 s apart: separate pulls
  const ids = [];
  for (let i = 0; i < durations.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call('POST', ['claim'], { encounterId: 77, difficultyId: 16, duration: durations[i], encounterName: 'Boss', startedAt: base + i * 400000, bossPercent: 50 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.push(r.body.pullId);
  }
  // A claim that has no report yet answers with its summary entry.
  const rows = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    rows.push((await call('GET', ['pulls', id])).body);
  }
  assert.deepEqual(rows.map((p) => [p.reset, p.pullNumber, p.totalPullNumber]), [
    [true, 0, 0],
    [false, 1, 1],
    [true, 1, 1],
    [false, 2, 2],
  ]);
});
