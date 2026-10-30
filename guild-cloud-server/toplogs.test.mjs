import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { SPECS, hasAmounts, createTopLogs, cumulative, deriveCooldowns, parseRankings, wclDifficulty } from './toplogs.mjs';

test('specs: 40, each once, healers ranked by healing', () => {
  assert.equal(SPECS.length, 40);
  assert.equal(new Set(SPECS.map((s) => s.specId)).size, 40);
  assert.equal(SPECS.filter((s) => s.role === 'healer').length, 7);
  assert.equal(wclDifficulty(233), 5);
  assert.equal(wclDifficulty(15), 4);
});

test('rankings: top rows with report and fight, junk dropped', () => {
  const rows = parseRankings({
    rankings: [
      { name: 'Aa', amount: 2000000.5, duration: 312345, server: { name: 'Area 52', region: 'US' }, guild: { name: 'G' }, report: { code: 'abcdEFGH1234', fightID: 7 }, bracketData: 720 },
      { name: 'Bb', amount: 1, report: { code: 'bad code!', fightID: 3 } },
      { name: 'Cc', amount: 1900000, duration: 300000, reportID: 'zzzzYYYY9999', fightID: 2 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.rank, r.name, r.code, r.fight, r.duration, r.ilvl]),
    [
      [1, 'Aa', 'abcdEFGH1234', 7, 312.3, 720],
      [3, 'Cc', 'zzzzYYYY9999', 2, 300, null],
    ],
  );
  assert.equal(parseRankings({ rankings: Array.from({ length: 40 }, (_, i) => ({ name: `P${i}`, report: { code: 'abcdEFGH1234', fightID: 1 } })) }).length, 25);
});

test('main cooldowns: pressed by most, at least 45 s apart; filler left out', () => {
  const player = (offset) => ({
    duration: 300,
    casts: [
      // A 2-minute cooldown, pressed on pull and every 2 minutes.
      [1 + offset, 100],
      [121 + offset, 100],
      [242 + offset, 100],
      // A potion, once.
      [5, 200],
      // Filler every 3 s.
      ...Array.from({ length: 90 }, (_, i) => [i * 3, 300]),
    ],
  });
  const tracks = [player(0), player(2), player(4), { duration: 300, casts: [[10, 999]] }];
  const cds = deriveCooldowns(tracks);
  assert.deepEqual(
    cds.map((c) => c.spellId),
    [100, 200],
  );
  assert.equal(cds[0].cooldown, 120);
  assert.equal(cds[0].medianCasts, 3);
  assert.deepEqual(deriveCooldowns(tracks.slice(0, 2)), [], 'needs 3 players');
});

test('cumulative: second by second, absorbed counts', () => {
  const start = 1000;
  assert.deepEqual(
    cumulative(
      [
        { timestamp: 1100, amount: 10 },
        { timestamp: 1900, amount: 5, absorbed: 5 },
        { timestamp: 3500, amount: 1 },
        { timestamp: 500, amount: 99 },
      ],
      start,
      3.2,
    ),
    [20, 20, 21, 21],
  );
});

const damageSources = [];
const fakeWcl = () => {
  const calls = [];
  return {
    calls,
    configured: true,
    query: async (text, vars) => {
      calls.push(text.includes('characterRankings') ? 'rankings' : text.includes('dataType: Casts') ? 'casts' : text.includes('DamageDone') ? 'damage' : 'head');
      if (text.includes('characterRankings')) {
        assert.equal(vars.cls, 'Warrior');
        assert.equal(vars.spec, 'Arms');
        assert.equal(vars.diff, 5);
        assert.equal(vars.metric, 'dps');
        return {
          worldData: {
            encounter: {
              characterRankings: {
                rankings: [
                  { name: 'Topwar', amount: 3e6, duration: 300000, report: { code: 'AAAAbbbb1111', fightID: 4 } },
                  { name: 'Nextwar', amount: 2e6, duration: 300000, report: { code: 'CCCCdddd2222', fightID: 9 } },
                ],
              },
            },
          },
        };
      }
      if (text.includes('masterData')) {
        return {
          reportData: {
            report: {
              fights: [{ id: vars.fight, startTime: 10000, endTime: 310000, encounterID: 3129, kill: true, phaseTransitions: [{ id: 1, startTime: 10000 }, { id: 2, startTime: 130000 }] }],
              phases: [{ encounterID: 3129, phases: [{ id: 1, name: 'Stage One' }, { id: 2, name: 'Stage Two' }] }],
              masterData: {
                actors: [
                  { id: 5, name: 'Topwar', server: 'Area52', type: 'Player' },
                  { id: 6, name: 'Nextwar', server: 'Area52', type: 'Player' },
                  { id: 40, name: 'Pet', type: 'Pet', petOwner: 5 },
                ],
              },
            },
          },
        };
      }
      if (text.includes('dataType: Casts')) {
        return {
          reportData: {
            report: {
              events: {
                data: [
                  { timestamp: 11000, type: 'begincast', abilityGameID: 1 },
                  { timestamp: 11500, type: 'cast', abilityGameID: 107574 },
                  { timestamp: 20000, type: 'cast', abilityGameID: 12294 },
                ],
                nextPageTimestamp: null,
              },
            },
          },
        };
      }
      damageSources.push(vars.src);
      if (vars.src !== 5) return { reportData: { report: { events: { data: [], nextPageTimestamp: null } } } };
      return {
        reportData: {
          report: {
            events: {
              data: [
                { timestamp: 10500, type: 'damage', amount: 100, absorbed: 20 },
                { timestamp: 12500, type: 'damage', amount: 50 },
                { timestamp: 12600, type: 'removebuff' },
              ],
              nextPageTimestamp: null,
            },
          },
        },
      };
    },
  };
};

const respond = () => {
  const out = {};
  return {
    out,
    json: (_res, status, body) => Object.assign(out, { status, body }),
    fail: (_res, status, error) => Object.assign(out, { status, body: { error } }),
  };
};

test('routes: rankings on demand, casts fetched for each row, then a trial with amounts', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-'));
  const wcl = fakeWcl();
  const r = respond();
  const top = createTopLogs({ storage, env: {}, json: r.json, fail: r.fail, wcl, season: { zone: async () => null } });
  const ask = async (route, params) => {
    const url = new URL(`http://x/${route}?${new URLSearchParams(params)}`);
    await top.handle({ method: 'GET' }, {}, route ? route.split('/') : [], url);
    return { ...r.out };
  };

  const first = await ask('rankings', { encounterId: 3129, difficulty: 16, specId: 71 });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.rows.map((x) => [x.name, x.state]), [
    ['Topwar', 'queued'],
    ['Nextwar', 'queued'],
  ]);
  assert.equal(first.body.pending, 2);
  await new Promise((done) => setTimeout(done, 50));

  const second = await ask('rankings', { encounterId: 3129, difficulty: 16, specId: 71 });
  assert.equal(second.body.pending, 0);
  assert.deepEqual(second.body.rows[0].casts, [
    [1.5, 107574],
    [10, 12294],
  ]);
  assert.deepEqual(second.body.rows[0].phases, [
    [0, 1],
    [120, 2],
  ]);
  assert.equal(wcl.calls.filter((c) => c === 'rankings').length, 1, 'rankings kept');

  const trial = await ask('trial', { code: 'AAAAbbbb1111', fight: 4, name: 'Topwar' });
  assert.equal(trial.body.state, 'ready');
  assert.equal(trial.body.track.duration, 300);
  assert.deepEqual(trial.body.track.amounts.slice(0, 4), [120, 120, 170, 170]);
  assert.equal(trial.body.track.phaseNames[2], 'Stage Two');
  assert.deepEqual(damageSources, [5, 40], 'the player, then their pet, by sourceID');
  const calls = wcl.calls.length;
  await ask('trial', { code: 'AAAAbbbb1111', fight: 4, name: 'Topwar' });
  assert.equal(wcl.calls.length, calls, 'trial kept');

  assert.equal((await ask('trial', { code: 'bad', fight: 4, name: 'Topwar' })).status, 400);
  assert.equal((await ask('rankings', { encounterId: 3129 })).status, 400);
});

test('trial: all-zero amounts are never kept, and old all-zero tracks are fetched again', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-'));
  // A 1.9.96 track saved with all-zero amounts.
  await fsp.mkdir(path.join(storage, 'toplogs', 'tracks'), { recursive: true });
  const base = {
    code: 'EEEEffff3333', fight: 2, name: 'Zerowar', server: '', playerId: 5, pets: [], fightStart: 10000,
    duration: 300, encounterId: 3129, kill: true, casts: [], phases: [], phaseNames: {}, at: 1,
  };
  await fsp.writeFile(
    path.join(storage, 'toplogs', 'tracks', 'EEEEffff3333-2-zerowar.json'),
    JSON.stringify({ ...base, metric: 'dps', amounts: new Array(300).fill(0) }),
  );
  const wcl = {
    configured: true,
    query: async () => ({
      reportData: {
        report: {
          events: {
            data: [],
            nextPageTimestamp: null,
          },
        },
      },
    }),
  };
  const r = respond();
  const top = createTopLogs({ storage, env: {}, json: r.json, fail: r.fail, wcl, season: { zone: async () => null } });
  const ask = async () => {
    const url = new URL('http://x/trial?code=EEEEffff3333&fight=2&name=Zerowar');
    await top.handle({ method: 'GET' }, {}, ['trial'], url);
    return { ...r.out };
  };
  assert.equal(hasAmounts({ amounts: [0, 0] }), false);
  assert.equal(hasAmounts({ amounts: [0, 5] }), true);

  const failed = await ask();
  assert.equal(failed.body.state, 'failed');
  assert.match(failed.body.error, /no damage for Zerowar/);
  const kept = JSON.parse(await fsp.readFile(path.join(storage, 'toplogs', 'tracks', 'EEEEffff3333-2-zerowar.json'), 'utf8'));
  assert.equal(hasAmounts(kept), false, 'zeros not written over as a result');
});
