import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { pullsFromReport, reportCode } from './pulldesk-import.mjs';
import { createPullDesk } from './pulldesk.mjs';

const T0 = Date.parse('2026-10-20T00:30:00Z');
const KITHIX = 3500;

// A Warcraft Logs report: three Mythic pulls on one boss (wipe, mass-death
// wipe, kill) plus a Heroic pull that isn't tracked.
const wclReport = {
  code: 'aBcD1234EfGh5678',
  startTime: T0,
  title: 'Kithix progress',
  fights: [
    { id: 1, encounterID: KITHIX, name: "Kith'ix", difficulty: 5, startTime: 0, endTime: 180000, kill: false, fightPercentage: 62.4, friendlyPlayers: [1, 2, 3, 4, 5, 6] },
    { id: 2, encounterID: KITHIX, name: "Kith'ix", difficulty: 5, startTime: 300000, endTime: 520000, kill: false, fightPercentage: 31.0, friendlyPlayers: [1, 2, 3, 4, 5, 6] },
    { id: 3, encounterID: KITHIX, name: "Kith'ix", difficulty: 5, startTime: 600000, endTime: 960000, kill: true, fightPercentage: 0, friendlyPlayers: [1, 2, 3, 4, 5, 6] },
    { id: 4, encounterID: KITHIX, name: "Kith'ix", difficulty: 4, startTime: 1000000, endTime: 1100000, kill: true, friendlyPlayers: [1] },
    { id: 5, encounterID: 0, name: 'Trash', difficulty: 5, startTime: 1200000, endTime: 1210000, friendlyPlayers: [1] },
  ],
  masterData: {
    actors: ['Evi', 'Tank', 'Mage', 'Rogue', 'Hunter', 'Priest'].map((name, i) => ({ id: i + 1, name })),
    abilities: [{ gameID: 900, name: 'Rending Swarm' }, { gameID: 901, name: 'Unbinding' }],
  },
  playerDetails: { data: { playerDetails: { tanks: [{ name: 'Tank' }], healers: [{ name: 'Evi' }, { name: 'Priest' }], dps: [] } } },
};
const deathEvents = [
  { fight: 1, timestamp: 40000, targetID: 3, killingAbilityGameID: 900 },
  { fight: 1, timestamp: 52000, targetID: 2, killingAbilityGameID: 900 },
  // Pull 2: five die to Unbinding within 2 s.
  ...[1, 2, 3, 4, 5].map((id, i) => ({ fight: 2, timestamp: 500000 + i * 300, targetID: id, killingAbilityGameID: 901 })),
];

test('report links and codes', () => {
  assert.equal(reportCode('https://www.warcraftlogs.com/reports/aBcD1234EfGh5678#fight=3&type=damage-done'), 'aBcD1234EfGh5678');
  assert.equal(reportCode('aBcD1234EfGh5678'), 'aBcD1234EfGh5678');
  assert.equal(reportCode('https://example.com/nope'), null);
});

test('pulls from a report: Mythic boss fights with roster, roles and deaths', () => {
  const pulls = pullsFromReport(wclReport, deathEvents, new Set([16]));
  assert.equal(pulls.length, 3);
  assert.deepEqual(pulls.map((p) => [p.result, p.bossPercent]), [['wipe', 62.4], ['wipe', 31], ['kill', 0]]);
  assert.equal(pulls[0].startedAt, T0);
  assert.equal(pulls[0].report.deaths[0].name, 'Mage');
  assert.equal(pulls[0].report.deaths[0].t, 40);
  assert.equal(pulls[0].report.deaths[1].role, 'tank');
  assert.equal(pulls[0].report.roster.find((p) => p.name === 'Evi').role, 'healer');
  assert.equal(pulls[1].report.wipe.massDeath.spellName, 'Unbinding');
  assert.equal(pulls[2].report.wipe.massDeath, undefined);
});

test('import adds pulls to the summaries, skips duplicates, fills stale claims', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-import-'));
  const fakeWcl = {
    configured: true,
    query: async (text) => {
      if (text.includes('playerDetails')) return { reportData: { report: { playerDetails: wclReport.playerDetails } } };
      if (text.includes('events(')) return { reportData: { report: { events: { data: deathEvents, nextPageTimestamp: null } } } };
      return { reportData: { report: wclReport } };
    },
  };
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    wcl: fakeWcl,
  });
  await desk.ready();
  const call = async (method, rest, body, query = '') => {
    const res = {};
    await desk.handle({ method, body, cloudUserId: '1', cloudUserName: 'Evi' }, res, rest, new URL(`http://x/${query}`));
    return res;
  };

  // The app saw pull 2 start but nobody uploaded a log: a stale claim.
  const claimed = await call('POST', ['claim'], { encounterId: KITHIX, difficultyId: 16, duration: 220, encounterName: "Kith'ix", startedAt: T0 + 300000, bossPercent: 29.5 });
  assert.equal(claimed.status, 200);

  const first = await call('POST', ['import'], { reports: [`https://www.warcraftlogs.com/reports/${wclReport.code}`] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.results[0].bosses, ["Kith'ix"]);
  assert.equal(first.body.results[0].added + first.body.results[0].filled, 3);
  assert.equal(first.body.results[0].filled, 1); // the claim got the imported report

  const again = await call('POST', ['import'], { reports: [wclReport.code] });
  assert.equal(again.body.results[0].skipped, 3);

  const prog = await call('GET', ['summary', 'boss', String(KITHIX)], undefined, '?difficulty=16');
  assert.equal(prog.status, 200, JSON.stringify(prog.body));
  assert.equal(prog.body.pulls, 3);
  assert.deepEqual(prog.body.firstKill, { pull: 3, night: prog.body.series[2].night });
  // The app's boss % (from the claim) wins over Warcraft Logs'.
  assert.deepEqual(prog.body.series.map((s) => s.percent), [62.4, 29.5, 0]);
  assert.ok(prog.body.series.every((s) => s.source === 'wcl'));
  assert.equal(prog.body.causes.find((c) => c.name === 'Unbinding (raid-wide)').count, 1);
  assert.equal(prog.body.raiders.find((r) => r.name === 'Mage').earlyDeaths, 1); // 3rd to die in pull 2
  assert.equal(prog.body.raiders.find((r) => r.name === 'Evi').earlyDeaths, 1);

  // Imported pulls stay out of the Pulls list (they have no app report).
  const list = await call('GET', ['pulls'], undefined, '?days=120');
  assert.equal(list.body.pulls.length, 0);

  assert.equal((await call('POST', ['import'], { reports: ['nope'] })).status, 400);
});

test('whole-tier import: find the guild, group reports by zone, import in the background', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-tier-'));
  const fakeWcl = {
    configured: true,
    query: async (text, vars) => {
      if (text.includes('guildData')) return { guildData: { guild: vars.slug === 'area-52' ? { id: 77 } : null } };
      if (text.includes('reports(guildID')) {
        return { reportData: { reports: { has_more_pages: false, data: [
          { code: 'aBcD1234EfGh5678', title: 'Kithix progress', startTime: T0, zone: { id: 46, name: 'The Unbinding' } },
          { code: 'zzzz1234EfGh5678', title: 'Old tier', startTime: T0 - 1000, zone: { id: 40, name: 'Old Raid' } },
        ] } } };
      }
      if (text.includes('playerDetails')) return { reportData: { report: { playerDetails: wclReport.playerDetails } } };
      if (text.includes('events(')) return { reportData: { report: { events: { data: deathEvents, nextPageTimestamp: null } } } };
      return { reportData: { report: wclReport } };
    },
  };
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    wcl: fakeWcl,
  });
  await desk.ready();
  const call = async (method, rest, body) => {
    const res = {};
    await desk.handle({ method, body, cloudUserId: '1', cloudUserName: 'Evi' }, res, rest, new URL('http://x/'));
    return res;
  };
  // The app already saw Kith'ix as flex Mythic (233).
  await call('POST', ['claim'], { encounterId: KITHIX, difficultyId: 233, duration: 61, encounterName: "Kith'ix", startedAt: T0 + 10 * 86400000 });

  const missing = await call('POST', ['import', 'guild', 'scan'], { name: 'Room Forty', realm: 'Nowhere', region: 'us' });
  assert.equal(missing.status, 404);
  const scan = await call('POST', ['import', 'guild', 'scan'], { name: 'Room Forty', realm: 'Area 52', region: 'us' });
  assert.equal(scan.status, 200, JSON.stringify(scan.body));
  assert.deepEqual(scan.body.zones.map((z) => z.zoneName), ['The Unbinding', 'Old Raid']);
  assert.equal((await call('GET', ['import', 'guild'])).body.guild.realm, 'Area 52');

  const start = await call('POST', ['import', 'tier'], { codes: scan.body.zones[0].codes });
  assert.equal(start.status, 200);
  assert.equal((await call('POST', ['import', 'tier'], { codes: ['aBcD1234EfGh5678'] })).status, 409);
  for (let i = 0; i < 50 && (await call('GET', ['import', 'guild'])).body.job.running; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 20));
  }
  const job = (await call('GET', ['import', 'guild'])).body.job;
  assert.equal(job.done, 1);
  assert.equal(job.added, 3);
  // Mythic from Warcraft Logs joined the app's flex Mythic pulls.
  const prog = await call('GET', ['summary', 'boss', String(KITHIX)], undefined);
  const res = {};
  await desk.handle({ method: 'GET', cloudUserId: '1' }, res, ['summary', 'boss', String(KITHIX)], new URL('http://x/?difficulty=233'));
  assert.equal(res.body.counts.progression, 3);
  assert.ok(prog.status === 200);
});

test('whole-tier import is owner-only; the Progression list setting saves', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-owner-'));
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    wcl: { configured: true, query: async () => ({}) },
    isOwner: (id) => id === '99',
  });
  await desk.ready();
  const call = async (who, method, rest, body, headers = {}) => {
    const res = {};
    await desk.handle({ method, body, headers, cloudUserId: who, cloudUserName: who }, res, rest, new URL('http://x/'));
    return res;
  };
  assert.equal((await call('1', 'GET', ['import', 'guild'])).status, 403);
  assert.equal((await call('1', 'POST', ['import', 'tier'], { codes: ['aBcD1234EfGh5678'] })).status, 403);
  assert.equal((await call('99', 'GET', ['import', 'guild'])).status, 200);
  assert.equal((await call('99', 'GET', ['import', 'guild'], undefined, { 'x-view-as-role': 'trial' })).status, 403);
  assert.equal((await call('99', 'GET', ['config'])).body.owner, true);
  assert.equal((await call('1', 'GET', ['config'])).body.progressionShown, null);
  await call('1', 'PUT', ['progression-list'], { shown: ['3180:15', 'bad', '3180:15'] });
  assert.deepEqual((await call('1', 'GET', ['config'])).body.progressionShown, ['3180:15']);
});
