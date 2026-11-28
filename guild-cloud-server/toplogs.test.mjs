import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { SPECS, hasAmounts, hasExtras, createTopLogs, cumulative, deriveCooldowns, explainError, parseRankings, wclDifficulty } from './toplogs.mjs';

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

test("main cooldowns: one name is one cooldown (Frostwyrm's Fury has two spell IDs)", () => {
  // 3 of 7 players press 279302, 4 of 7 press 1265870: neither alone reaches 60%.
  const names = { 279302: "Frostwyrm's Fury", 1265870: "Frostwyrm's Fury" };
  const player = (id, n) => ({ duration: 300, names, casts: Array.from({ length: n }, (_, i) => [5 + i * 90, id]) });
  const tracks = [player(279302, 4), player(279302, 4), player(279302, 4), player(1265870, 4), player(1265870, 3), player(1265870, 4), player(1265870, 4)];
  const cds = deriveCooldowns(tracks);
  assert.equal(cds.length, 1);
  assert.equal(cds[0].name, "Frostwyrm's Fury");
  assert.equal(cds[0].spellId, 1265870, 'the ID pressed most');
  assert.deepEqual(cds[0].spellIds, [1265870, 279302]);
  assert.equal(cds[0].share, 1);
  // Without names they stay apart (and both fall under 60%).
  assert.deepEqual(deriveCooldowns(tracks.map((t) => ({ ...t, names: undefined }))), []);
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
                abilities: [
                  { gameID: 107574, name: 'Avatar' },
                  { gameID: 12294, name: 'Mortal Strike' },
                  { gameID: 9999, name: 'Boss Smash' },
                ],
              },
            },
          },
        };
      }
      if (text.includes('hostilityType: Enemies')) {
        return { reportData: { report: { events: { data: [{ timestamp: 140000, type: 'cast', abilityGameID: 9999 }, { timestamp: 140000, type: 'begincast', abilityGameID: 9999 }], nextPageTimestamp: null } } } };
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
  // The casts are fetched in the background: ask again until they're in (a
  // fixed 50 ms wait failed now and then on a slow CI runner).
  let second;
  for (let i = 0; i < 100; i += 1) {
    await new Promise((done) => setTimeout(done, 20));
    second = await ask('rankings', { encounterId: 3129, difficulty: 16, specId: 71 });
    if (second.body.pending === 0) break;
  }
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
  assert.deepEqual(trial.body.track.enemy, [[130, 9999]], "the enemies' casts, for our phases");
  assert.equal(trial.body.track.names[9999], 'Boss Smash');
  assert.equal(trial.body.track.names[12294], 'Mortal Strike');
  assert.ok(hasExtras(trial.body.track));
  assert.equal(second.body.rows[0].names[107574], 'Avatar', 'rows carry spell names');
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
  const top = createTopLogs({ storage, env: {}, json: r.json, fail: r.fail, wcl, season: { zone: async () => null }, retryDelaysMs: [5, 5] });
  const ask = async () => {
    const url = new URL('http://x/trial?code=EEEEffff3333&fight=2&name=Zerowar');
    await top.handle({ method: 'GET' }, {}, ['trial'], url);
    return { ...r.out };
  };
  assert.equal(hasAmounts({ amounts: [0, 0] }), false);
  assert.equal(hasAmounts({ amounts: [0, 5] }), true);

  const failed = await ask();
  assert.equal(failed.body.state, 'failed');
  assert.equal(failed.body.error, 'Warcraft Logs had no events for this fight', 'a plain reason, after the tries');
  const kept = JSON.parse(await fsp.readFile(path.join(storage, 'toplogs', 'tracks', 'EEEEffff3333-2-zerowar.json'), 'utf8'));
  assert.equal(hasAmounts(kept), false, 'zeros not written over as a result');
});

// ---- Rows that never finish (1.9.169) ---------------------------------------

const until = async (check, what, tries = 400) => {
  for (let i = 0; i < tries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const value = await check();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

/** A report's head answer for one player, and casts for them. */
const reportAnswer = (vars) => ({
  reportData: {
    report: {
      fights: [{ id: vars.fight, startTime: 0, endTime: 100000, encounterID: 1, kill: true, phaseTransitions: [] }],
      phases: [],
      masterData: { actors: ['Aa', 'Bb', 'Cc'].map((name, i) => ({ id: 5 + i, name, type: 'Player' })), abilities: [{ gameID: 1, name: 'Avatar' }] },
    },
  },
});
const rankingsAnswer = (names) => ({
  worldData: {
    encounter: {
      characterRankings: {
        rankings: names.map((name, i) => ({ name, amount: 3e6, duration: 100000, report: { code: `REPORT${String(i).padStart(4, '0')}abcd`, fightID: 2 } })),
      },
    },
  },
});
const castsAnswer = { reportData: { report: { events: { data: [{ timestamp: 1000, type: 'cast', abilityGameID: 1 }], nextPageTimestamp: null } } } };

/**
 * A Warcraft Logs stand-in whose answers a test decides. `handles` records
 * each consumer share it was asked for; `paused` says which shares are paused.
 */
const stubWcl = ({ names = ['Aa', 'Bb'], head = async (vars) => reportAnswer(vars), paused = {} } = {}) => {
  const log = { heads: [], handles: [] };
  const base = (share) => ({
    configured: true,
    query: async (text, vars) => {
      if (text.includes('characterRankings')) return rankingsAnswer(names);
      if (text.includes('masterData') && !text.includes('events(')) {
        log.heads.push(vars.code);
        return head(vars);
      }
      return castsAnswer;
    },
    budget: () => {
      const until_ = paused[share];
      return until_ && until_() ? { exhausted: true, resumesAt: Date.now() + 60000, share } : { exhausted: false, resumesAt: null, share };
    },
    forConsumer: ({ budgetShare }) => {
      log.handles.push(budgetShare);
      return base(budgetShare);
    },
  });
  return { ...base(0.95), log };
};

const makeTop = async (wcl, extra = {}) => {
  const storage = extra.storage || (await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-')));
  const r = respond();
  const top = createTopLogs({
    storage, env: {}, json: r.json, fail: r.fail, wcl, season: { zone: async () => null }, retryDelaysMs: [5, 10], ...extra,
  });
  const ask = async (route, params = {}, method = 'GET', body) => {
    const url = new URL(`http://x/${route}?${new URLSearchParams(params)}`);
    r.out.status = undefined;
    await top.handle({ method, body }, {}, [route], url);
    return { ...r.out };
  };
  return { top, ask, storage, r };
};
const RANK = { encounterId: 1, difficulty: 16, specId: 71 };

test('explainError: plain reasons, and which could pass on a second try', () => {
  assert.deepEqual(explainError(new Error('Fight 3 not found in report abc')), { reason: 'The report is private or was deleted', retriable: false });
  assert.equal(explainError(new Error('Warcraft Logs query error: You do not have permission to view this report.')).retriable, false);
  assert.equal(explainError(new Error('Timed out')).reason, 'Warcraft Logs took too long to answer');
  assert.equal(explainError(new Error('Warcraft Logs request failed (502).')).retriable, true);
  assert.equal(explainError(new Error('Warcraft Logs rejected the API credentials.')).retriable, false);
});

test('a fetch that throws is tried again, and the row finishes', async () => {
  let calls = 0;
  const wcl = stubWcl({ names: ['Aa'], head: async (vars) => { calls += 1; if (calls < 3) throw new Error('Warcraft Logs request failed (502).'); return reportAnswer(vars); } });
  const { ask } = await makeTop(wcl);
  const first = await ask('rankings', RANK);
  assert.equal(first.body.rows[0].state, 'queued');
  const done = await until(async () => { const a = await ask('rankings', RANK); return a.body.rows[0].state === 'ready' && a; }, 'the row to be ready');
  assert.equal(calls, 3, 'two failures, then the third try worked');
  assert.equal(done.body.pending, 0);
  assert.deepEqual(done.body.progress, { total: 1, ready: 1, queued: 0, waiting: 0, failed: 0, retrying: 0 });
});

test('a fetch that keeps failing ends as failed with a plain reason, after three tries', async () => {
  const broken = true;
  let calls = 0;
  const wcl = stubWcl({ names: ['Aa'], head: async (vars) => { calls += 1; if (broken) throw new Error('Warcraft Logs request failed (500).'); return reportAnswer(vars); } });
  const { ask } = await makeTop(wcl);
  await ask('rankings', RANK);
  const failedAnswer = await until(async () => { const a = await ask('rankings', RANK); return a.body.rows[0].state === 'failed' && a; }, 'the row to fail');
  assert.equal(calls, 3, 'three tries, no more');
  assert.equal(failedAnswer.body.rows[0].error, 'Warcraft Logs returned an error');
  assert.equal(failedAnswer.body.pending, 0, 'the app stops polling');
  assert.equal(failedAnswer.body.progress.failed, 1);
  // Not tried again by every poll...
  await ask('rankings', RANK);
  await new Promise((done) => setTimeout(done, 40));
  assert.equal(calls, 3);
  assert.equal(broken, true);
});

test('a private report fails at once (no useless tries), and Retry is a route', async () => {
  let calls = 0;
  const wcl = stubWcl({ names: ['Aa'], head: async () => { calls += 1; throw new Error('Warcraft Logs query error: You do not have permission to view this report.'); } });
  const { ask, top } = await makeTop(wcl);
  await ask('rankings', RANK);
  const a = await until(async () => { const x = await ask('rankings', RANK); return x.body.rows[0].state === 'failed' && x; }, 'failure');
  assert.equal(calls, 1);
  assert.equal(a.body.rows[0].error, 'The report is private or was deleted');
  assert.ok(top);
});

test('Retry route: a failed row goes back in the queue and can finish', async () => {
  let broken = true;
  const wcl = stubWcl({ names: ['Aa'], head: async (vars) => { if (broken) throw new Error('Warcraft Logs query error: private'); return reportAnswer(vars); } });
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-'));
  const r = respond();
  const top = createTopLogs({ storage, env: {}, json: r.json, fail: r.fail, wcl, season: { zone: async () => null }, retryDelaysMs: [5], readBody: async () => ({ rows: [{ code: 'REPORT0000abcd', fight: 2, name: 'Aa' }, { code: 'bad code', fight: 1, name: 'Zz' }] }) });
  const get = async () => {
    await top.handle({ method: 'GET' }, {}, ['rankings'], new URL(`http://x/rankings?${new URLSearchParams(RANK)}`));
    return { ...r.out };
  };
  await get();
  const a = await until(async () => { const x = await get(); return x.body.rows[0].state === 'failed' && x; }, 'failure');
  assert.equal(a.body.rows[0].state, 'failed');
  broken = false;
  await top.handle({ method: 'POST' }, {}, ['retry'], new URL('http://x/retry'));
  assert.equal(r.out.status, 200);
  assert.equal(r.out.body.queued, 1, 'the bad code was skipped');
  await until(async () => (await get()).body.rows[0].state === 'ready', 'the retried row');
});

test('the hourly limit shows as waiting with a resume time, then the row finishes', async () => {
  let paused = true;
  const wcl = stubWcl({ names: ['Aa', 'Bb'], paused: { 0.9: () => paused } });
  // The rankings are already stored (a crawl made them); only casts are missing.
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-'));
  await fsp.mkdir(path.join(storage, 'toplogs'), { recursive: true });
  const rows = ['Aa', 'Bb'].map((name, i) => ({ rank: i + 1, name, server: '', region: '', guild: null, amount: 1, duration: 100, ilvl: null, startTime: 0, code: `REPORT000${i}abcd`, fight: 2 }));
  await fsp.writeFile(path.join(storage, 'toplogs', 'rankings.json'), JSON.stringify({ lastCrawl: 1, sets: { '1:5:71:world': { at: 1, rows } } }));
  const { ask } = await makeTop(wcl, { storage });
  const a = await ask('rankings', RANK);
  assert.deepEqual(a.body.rows.map((r) => r.state), ['waiting', 'waiting']);
  assert.ok(a.body.rows[0].resumesAt > Date.now());
  assert.equal(a.body.waiting.reason, 'Warcraft Logs hourly limit');
  assert.equal(a.body.pending, 2, 'still coming');
  assert.equal(a.body.progress.waiting, 2);
  assert.equal(wcl.log.heads.length, 0, 'nothing was asked of Warcraft Logs while paused');
  paused = false;
  const done = await until(async () => { const x = await ask('rankings', RANK); return x.body.pending === 0 && x; }, 'rows after the reset', 800);
  assert.deepEqual(done.body.rows.map((r) => r.state), ['ready', 'ready']);
  assert.equal(done.body.waiting, null);
});

test('a crawl that used its share does not freeze page requests (they have a bigger share)', async () => {
  // 0.85 is the crawl's share: paused. 0.9 is the page's: free.
  const wcl = stubWcl({ names: ['Aa'], paused: { 0.85: () => true } });
  const { ask, top } = await makeTop(wcl, { storage: await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-')) });
  assert.ok(top);
  assert.ok(wcl.log.handles.includes(0.85) && wcl.log.handles.includes(0.9), 'two handles: crawl and page');
  await ask('rankings', RANK);
  await until(async () => (await ask('rankings', RANK)).body.rows[0].state === 'ready', 'the page request to finish while the crawl is paused');
});

test('a fetch that never answers times out and fails instead of blocking the queue forever', async () => {
  const wcl = stubWcl({ names: ['Aa', 'Bb'], head: (vars) => (vars.code.endsWith('0000abcd') ? new Promise(() => {}) : Promise.resolve(reportAnswer(vars))) });
  const { ask } = await makeTop(wcl, { jobTimeoutMs: 30, retryDelaysMs: [5, 5] });
  await ask('rankings', RANK);
  const a = await until(async () => { const x = await ask('rankings', RANK); return x.body.pending === 0 && x; }, 'both rows to finish');
  assert.deepEqual(a.body.rows.map((r) => r.state), ['failed', 'ready'], 'the hung one failed, the other was not blocked');
  assert.equal(a.body.rows[0].error, 'Warcraft Logs took too long to answer');
});

test('after a restart the same page asks again and the rows finish', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-'));
  const hung = stubWcl({ names: ['Aa'], head: () => new Promise(() => {}) });
  const one = await makeTop(hung, { storage, jobTimeoutMs: 50 });
  const first = await one.ask('rankings', RANK);
  assert.equal(first.body.rows[0].state, 'queued');
  // "Restart": a new instance on the same storage, a working Warcraft Logs.
  const two = await makeTop(stubWcl({ names: ['Aa'] }), { storage });
  await two.ask('rankings', RANK);
  await until(async () => (await two.ask('rankings', RANK)).body.rows[0].state === 'ready', 'the row after a restart');
});

test('rankings that take too long answer 503 and finish in the background', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const wcl = stubWcl({ names: ['Aa'] });
  const gated = (client) => ({
    ...client,
    query: async (text, vars) => { if (text.includes('characterRankings')) await gate; return client.query(text, vars); },
    forConsumer: (o) => gated(client.forConsumer(o)),
  });
  const slow = gated(wcl);
  const { ask } = await makeTop(slow, { rankingsWaitMs: 30 });
  const a = await ask('rankings', RANK);
  assert.equal(a.status, 503);
  assert.match(a.body.error, /still loading/);
  release();
  await until(async () => (await ask('rankings', RANK)).status === 200, 'rankings after the slow answer');
});

test('the newest page request goes first, in rank order', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const order = [];
  const wcl = stubWcl({
    names: ['Aa', 'Bb', 'Cc'],
    head: async (vars) => {
      order.push(vars.code);
      if (order.length === 1) await gate;
      return reportAnswer(vars);
    },
  });
  const { ask } = await makeTop(wcl);
  await ask('rankings', RANK); // Aa runs (held), Bb and Cc wait
  await until(async () => order.length === 1, 'the first fetch to start');
  // A second request for the same rows must not re-queue them behind others;
  // a retry of a later row brings it forward.
  await ask('rankings', RANK);
  release();
  await until(async () => (await ask('rankings', RANK)).body.pending === 0, 'all rows');
  assert.deepEqual(order, ['REPORT0000abcd', 'REPORT0001abcd', 'REPORT0002abcd'], 'rank order');
});

test('opening another spec puts its logs ahead of the one you left', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const order = [];
  const wcl = stubWcl({
    head: async (vars) => {
      order.push(vars.code);
      if (order.length === 1) await gate;
      return reportAnswer(vars);
    },
  });
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'toplogs-'));
  await fsp.mkdir(path.join(storage, 'toplogs'), { recursive: true });
  const rowsOf = (letter) => ['Aa', 'Bb', 'Cc'].map((name, i) => ({ rank: i + 1, name, server: '', region: '', guild: null, amount: 1, duration: 100, ilvl: null, startTime: 0, code: `${letter}${letter}${letter}${letter}0000${i}`, fight: 2 }));
  await fsp.writeFile(
    path.join(storage, 'toplogs', 'rankings.json'),
    JSON.stringify({ lastCrawl: 1, sets: { '1:5:71:world': { at: 1, rows: rowsOf('X') }, '1:5:72:world': { at: 1, rows: rowsOf('Y') } } }),
  );
  const { ask } = await makeTop(wcl, { storage });
  await ask('rankings', RANK); // X0 runs (held), X1 and X2 wait
  await until(async () => order.length === 1, 'the first fetch to start');
  await ask('rankings', { ...RANK, specId: 72 });
  release();
  await until(async () => (await ask('rankings', { ...RANK, specId: 72 })).body.pending === 0, 'the new spec');
  assert.deepEqual(order.slice(0, 4), ['XXXX00000', 'YYYY00000', 'YYYY00001', 'YYYY00002'], 'the page you are on first, in rank order');
});
