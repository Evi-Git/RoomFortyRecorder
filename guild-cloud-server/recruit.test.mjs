import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BOSSES,
  analyzeBossReport,
  mergeBossTotals,
  parseSummary,
  playerKey,
  progressionFights,
  raidAverages,
  serverSlug,
  specsFromPlayerDetails,
} from './recruit-analyze.mjs';
import { rankCandidates } from './recruit-score.mjs';

const altar = DEFAULT_BOSSES.find((b) => b.name === 'The Coiled Altar');
const ulatek = DEFAULT_BOSSES.find((b) => b.name === "Ula'tek");

const abilities = [
  { gameID: 1, name: 'Venom Rupture' },
  { gameID: 2, name: 'Toxic Spit' },
  { gameID: 3, name: 'Volatile Venom' },
  { gameID: 4, name: 'Mutagenic Venom' },
  { gameID: 5, name: 'Wail of Terror' },
  { gameID: 6, name: 'Pummel' },
  { gameID: 7, name: 'Noxious Shell' },
];
const actors = [
  { id: 10, name: 'Armsguy', server: "Kel'Thuzad", subType: 'Warrior' },
  { id: 11, name: 'Locky', server: 'Area 52', subType: 'Warlock' },
  { id: 12, name: 'Other', server: 'Illidan', subType: 'Mage' },
];

test('server slugs match Warcraft Logs', () => {
  assert.equal(serverSlug("Kel'Thuzad"), 'kelthuzad');
  assert.equal(serverSlug('Area 52'), 'area-52');
  assert.equal(playerKey('Armsguy', "Kel'Thuzad"), 'Armsguy-kelthuzad');
});

test('early deaths skip excused abilities and deaths after the wipe call', () => {
  const fights = [
    { id: 1, startTime: 0, endTime: 300000, kill: false, wipeCalledTime: 200000, friendlyPlayers: [10, 11, 12] },
  ];
  const deaths = [
    // Rupture victim first: excused, doesn't use up the cutoff.
    { type: 'death', fight: 1, timestamp: 50000, targetID: 12, killingAbilityGameID: 1 },
    { type: 'death', fight: 1, timestamp: 60000, targetID: 10, killingAbilityGameID: 2 },
    { type: 'death', fight: 1, timestamp: 70000, targetID: 11, killingAbilityGameID: 2 },
    // Third real death: past the cutoff of 2.
    { type: 'death', fight: 1, timestamp: 80000, targetID: 12, killingAbilityGameID: 2 },
    // After the wipe call.
    { type: 'death', fight: 1, timestamp: 210000, targetID: 10, killingAbilityGameID: 2 },
  ];
  const result = analyzeBossReport({
    boss: altar,
    fights,
    actors,
    abilities,
    specs: new Map([[10, 'Arms'], [11, 'Affliction']]),
    deaths,
    deathCutoff: 2,
  });
  const arms = result.players['Armsguy-kelthuzad'];
  const lock = result.players['Locky-area-52'];
  const other = result.players['Other-illidan'];
  assert.equal(arms.earlyDeaths, 1);
  assert.equal(arms.lateDeaths, 1);
  assert.equal(arms.spec, 'Arms');
  assert.equal(lock.earlyDeaths, 1);
  assert.equal(other.excusedDeaths, 1);
  assert.equal(other.earlyDeaths, 0);
  assert.equal(other.lateDeaths, 1);
  assert.deepEqual(arms.deathCauses, { 'Toxic Spit': 1 });
});

test('orbs and Wail of Terror kicks count per eligible pull', () => {
  const fights = [
    { id: 1, startTime: 0, kill: false, friendlyPlayers: [10, 11, 12] },
    { id: 2, startTime: 400000, kill: false, friendlyPlayers: [10, 11, 12] },
    // A short wipe with no mechanics: not eligible.
    { id: 3, startTime: 800000, kill: false, friendlyPlayers: [10, 11, 12] },
  ];
  const debuffs = [
    { type: 'applydebuff', fight: 1, timestamp: 10000, targetID: 10, abilityGameID: 3 },
    { type: 'applydebuff', fight: 1, timestamp: 20000, targetID: 10, abilityGameID: 4 },
    { type: 'applydebuff', fight: 2, timestamp: 410000, targetID: 11, abilityGameID: 3 },
    { type: 'removedebuff', fight: 2, timestamp: 420000, targetID: 11, abilityGameID: 3 },
  ];
  const interrupts = [
    { type: 'interrupt', fight: 1, timestamp: 30000, sourceID: 10, abilityGameID: 6, extraAbilityGameID: 5 },
    // Interrupting something else doesn't count.
    { type: 'interrupt', fight: 2, timestamp: 430000, sourceID: 10, abilityGameID: 6, extraAbilityGameID: 2 },
  ];
  const result = analyzeBossReport({ boss: altar, fights, actors, abilities, specs: new Map(), debuffs, interrupts });
  assert.equal(result.mechanicPulls.orbs, 2);
  assert.equal(result.mechanicPulls.kicks, 1);
  const arms = result.players['Armsguy-kelthuzad'];
  assert.deepEqual(arms.mechanics.orbs, { count: 2, pulls: 2, pullsDone: 1 });
  assert.deepEqual(arms.mechanics.kicks, { count: 1, pulls: 1, pullsDone: 1 });
  assert.equal(result.players['Locky-area-52'].mechanics.orbs.count, 1);
  assert.equal(arms.pulls, 3);
});

test('eggs only count before 2:30 into the pull', () => {
  const fights = [{ id: 1, startTime: 1000000, kill: false, friendlyPlayers: [10, 11] }];
  const debuffs = [
    { type: 'applydebuff', fight: 1, timestamp: 1000000 + 60000, targetID: 10, abilityGameID: 7 },
    { type: 'applydebuff', fight: 1, timestamp: 1000000 + 140000, targetID: 10, abilityGameID: 7 },
    // After 2:30: free-for-all eggs, ignored.
    { type: 'applydebuff', fight: 1, timestamp: 1000000 + 200000, targetID: 11, abilityGameID: 7 },
  ];
  const result = analyzeBossReport({ boss: ulatek, fights, actors, abilities, specs: new Map(), debuffs });
  assert.equal(result.players['Armsguy-kelthuzad'].mechanics.eggs.count, 2);
  assert.equal(result.players['Locky-area-52'].mechanics.eggs.count, 0);
});

test('progression pulls stop at the first kill across reports', () => {
  const reports = [
    { code: 'B', reportStart: 2000, fights: [{ id: 1, startTime: 100, kill: false }, { id: 2, startTime: 200, kill: true }, { id: 3, startTime: 300, kill: true }] },
    { code: 'A', reportStart: 1000, fights: [{ id: 5, startTime: 100, kill: false }] },
    { code: 'C', reportStart: 9000, fights: [{ id: 1, startTime: 100, kill: true }] },
  ];
  const { selected, firstKill } = progressionFights(reports);
  assert.equal(firstKill, 2200);
  assert.deepEqual([...selected.get('B')], [1, 2]);
  assert.deepEqual([...selected.get('A')], [5]);
  assert.equal(selected.has('C'), false);
});

test('merging reports and raid averages', () => {
  const fights = [{ id: 1, startTime: 0, kill: false, friendlyPlayers: [10, 11] }];
  const debuffs = [{ type: 'applydebuff', fight: 1, timestamp: 5000, targetID: 10, abilityGameID: 3 }];
  const part = analyzeBossReport({ boss: altar, fights, actors, abilities, specs: new Map(), debuffs });
  const total = mergeBossTotals(mergeBossTotals(null, part), part);
  assert.equal(total.pulls, 2);
  assert.equal(total.players['Armsguy-kelthuzad'].mechanics.orbs.count, 2);
  const avg = raidAverages(total, altar);
  assert.equal(avg.orbs, 0.5); // Armsguy 1/pull, Locky 0/pull
});

test('specs and parses from API JSON', () => {
  const specs = specsFromPlayerDetails({
    data: { playerDetails: { dps: [{ id: 10, specs: [{ spec: 'Arms', count: 5 }, { spec: 'Fury', count: 1 }] }] } },
  });
  assert.equal(specs.get(10), 'Arms');
  const parse = parseSummary(
    { ranks: [{ rankPercent: 90, spec: 'Arms' }, { rankPercent: 70, spec: 'Arms' }, { rankPercent: 99, spec: 'Fury' }] },
    'Arms',
  );
  assert.deepEqual(parse, { best: 90, median: 80, kills: 2 });
});

test('ranking favours parse + few deaths + assigned mechanics', () => {
  const make = (name, median, earlyDeaths, eggs) => ({
    key: name,
    name,
    bosses: {
      "Ula'tek": {
        pulls: 40,
        earlyDeaths,
        parse: { best: median + 5, median },
        mechanics: { eggs: { count: eggs, pulls: 40, pullsDone: eggs, raidAvg: 10 / 40, assignedShare: 0.5, label: 'Eggs' } },
      },
    },
  });
  const ranked = rankCandidates(
    [make('Star', 90, 2, 36), make('Parser', 95, 12, 0), make('Average', 60, 6, 8), make('Weak', 40, 14, 0)],
    { minPulls: 10 },
  );
  assert.equal(ranked[0].name, 'Star');
  assert.equal(ranked.at(-1).name, 'Weak');
  assert.ok(ranked[0].metrics.assigned.length === 1);
  assert.ok(ranked[0].reasons.some((r) => r.includes('assigned')));
  // Weights change the order: pure parse puts Parser first.
  const byParse = rankCandidates(
    [make('Star', 90, 2, 36), make('Parser', 95, 12, 0)],
    { minPulls: 10, weights: { parse: 100, deaths: 0, mechanics: 0 } },
  );
  assert.equal(byParse[0].name, 'Parser');
});
