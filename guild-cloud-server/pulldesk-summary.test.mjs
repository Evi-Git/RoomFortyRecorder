import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abilityStats,
  summarizeNight,
  summarizeProgression,
  summarizePulls,
  wipeCause,
} from './pulldesk-summary.mjs';

const pull = (night, n, result, pct, deaths = [], extra = {}) => ({
  summary: {
    id: `${night}-${n}`,
    encounterId: 3429,
    encounterName: 'The Coiled Altar',
    difficultyId: 16,
    night,
    pullNumber: n,
    totalPullNumber: n,
    result,
    bossPercent: pct,
    duration: 200,
    startedAt: Date.parse(`${night}T20:00:00Z`) + n * 300000,
  },
  report: {
    result,
    duration: 200,
    roster: [
      { name: 'Evi', role: 'healer', specId: 65 },
      { name: 'Tank', role: 'tank', specId: 73 },
      { name: 'Mage', role: 'dps', specId: 63 },
    ],
    deaths: deaths.map(([name, spell], i) => ({
      t: 10 + i,
      name,
      role: 'dps',
      killingBlow: { spellName: spell, spellId: spell.length * 1000 },
    })),
    wipe: extra.mass
      ? { massDeath: { spellName: extra.mass, spellId: 777, count: 6, t: 100 } }
      : {},
    plan: { items: extra.plan || [] },
    avoidable: extra.avoidable || [],
    defensives: { players: extra.defensives || [] },
  },
});

test('wipe cause: raid-wide mechanic, else first death, else reset', () => {
  assert.equal(
    wipeCause(
      { result: 'wipe' },
      { deaths: [], wipe: { massDeath: { spellName: 'Venom Rupture' } } },
    ),
    'Venom Rupture (raid-wide)',
  );
  assert.equal(
    wipeCause(
      { result: 'wipe' },
      { deaths: [{ killingBlow: { spellName: 'Toxic Spit' } }], wipe: {} },
    ),
    'Toxic Spit',
  );
  assert.equal(
    wipeCause({ result: 'wipe', duration: 8 }, { deaths: [], wipe: {} }),
    'Reset',
  );
  assert.equal(wipeCause({ result: 'kill' }, {}), null);
});

test('night summary per boss with raider table', () => {
  const pulls = [
    pull(
      '2026-10-14',
      1,
      'wipe',
      60,
      [
        ['Mage', 'Toxic Spit'],
        ['Tank', 'Crush'],
        ['Evi', 'Toxic Spit'],
      ],
      {
        plan: [
          { name: 'Evi', status: 'missed' },
          { name: 'Evi', status: 'ontime' },
          { name: 'Tank', status: 'late' },
        ],
        avoidable: [{ name: 'Mage', hits: 3, damage: 900 }],
        defensives: [
          {
            name: 'Mage',
            role: 'dps',
            personal: 2,
            external: 0,
            potions: 1,
            healthstones: 1,
          },
        ],
      },
    ),
    pull('2026-10-14', 2, 'wipe', 41, [['Mage', 'Toxic Spit']], {
      mass: 'Venom Rupture',
    }),
    pull('2026-10-14', 3, 'kill', 0),
  ];
  const [boss] = summarizeNight(pulls);
  assert.equal(boss.pulls, 3);
  assert.equal(boss.kills, 1);
  assert.equal(boss.bestPercent, 0);
  assert.equal(boss.medianPercent, 50.5);
  assert.deepEqual(
    boss.causes.map(({ name, count }) => ({ name, count })),
    [
      { name: 'Toxic Spit', count: 1 },
      { name: 'Venom Rupture (raid-wide)', count: 1 },
    ],
  );
  const mage = boss.raiders.find((r) => r.name === 'Mage');
  assert.equal(mage.pulls, 3);
  assert.equal(mage.earlyDeaths, 2);
  assert.equal(mage.firstDeaths, 2);
  assert.equal(mage.avoidableHits, 3);
  assert.equal(mage.potions, 1);
  const evi = boss.raiders.find((r) => r.name === 'Evi');
  assert.equal(evi.deaths, 1);
  assert.equal(evi.earlyDeaths, 0); // third death of the pull
  assert.equal(evi.planMissed, 1);
  assert.equal(evi.planChecked, 2);
  assert.equal(boss.raiders.find((r) => r.name === 'Tank').planOff, 1);
});

test('progression: nights, pull series, first kill, raider trend', () => {
  const pulls = [
    pull('2026-10-13', 1, 'wipe', 80, [['Mage', 'Toxic Spit']]),
    pull('2026-10-13', 2, 'wipe', 70, [['Tank', 'Crush']]),
    pull('2026-10-14', 1, 'wipe', 30, [['Mage', 'Toxic Spit']]),
    pull('2026-10-14', 2, 'kill', 0),
  ];
  const p = summarizeProgression(pulls);
  assert.equal(p.nights.length, 2);
  assert.equal(p.nights[0].bestPercent, 70);
  assert.equal(p.nights[1].kills, 1);
  assert.deepEqual(
    p.series.map((s) => s.percent),
    [80, 70, 30, 0],
  );
  assert.deepEqual(p.firstKill, { pull: 4, night: '2026-10-14' });
  const mage = p.trend.find((t) => t.name === 'Mage');
  assert.equal(mage.nights['2026-10-13'].earlyDeaths, 1);
  assert.equal(mage.nights['2026-10-14'].rate, 0.5);
  assert.equal(p.causes[0].name, 'Toxic Spit');
});

test('pulls without a report still count', () => {
  const s = summarizePulls([
    {
      summary: {
        id: 'x',
        night: 'n',
        result: 'wipe',
        bossPercent: 50,
        duration: 100,
        deaths: 4,
      },
      report: null,
    },
  ]);
  assert.equal(s.pulls, 1);
  assert.equal(s.pullsList[0].cause, 'Not analyzed');
  assert.equal(s.pullsList[0].deaths, 4);
});

test('spell IDs for ability names, and per-ability stats for the journal', () => {
  const pulls = [
    pull('2026-10-14', 1, 'wipe', 60, [
      ['Mage', 'Toxic Spit'],
      ['Tank', 'Crush'],
      ['Evi', 'Toxic Spit'],
    ]),
    pull('2026-10-14', 2, 'wipe', 41, [['Mage', 'Toxic Spit']], {
      mass: 'Venom Rupture',
    }),
  ];
  const [boss] = summarizeNight(pulls);
  assert.equal(boss.spellIds['Toxic Spit'], 10000);
  assert.equal(boss.spellIds['Venom Rupture'], 777);
  assert.equal(
    boss.causes.find((c) => c.name === 'Venom Rupture (raid-wide)').spellId,
    777,
  );
  assert.equal(boss.causes.find((c) => c.name === 'Toxic Spit').spellId, 10000);

  const stats = abilityStats(pulls);
  const spit = stats.find((s) => s.name === 'Toxic Spit');
  assert.deepEqual([spit.wipes, spit.deaths, spit.earlyDeaths], [1, 3, 2]);
  const rupture = stats.find((s) => s.name === 'Venom Rupture');
  assert.deepEqual(
    [rupture.wipes, rupture.deaths, rupture.spellId],
    [1, 0, 777],
  );
});

test('avoidable section: per ability (all its spell IDs), raiders, deaths', () => {
  const withAvoid = (night, n, avoidable, deaths = []) => {
    const p = pull(night, n, 'wipe', 50, deaths);
    p.report.avoidable = avoidable;
    return p;
  };
  const pulls = [
    withAvoid(
      '2026-10-21',
      1,
      [
        {
          name: 'Mage',
          hits: 3,
          damage: 300,
          spells: [
            { spellId: 1302914, spellName: 'Venom Roar', hits: 2, damage: 200 },
            { spellId: 1302917, spellName: 'Venom Roar', hits: 1, damage: 100 },
          ],
        },
        {
          name: 'Evi',
          hits: 1,
          damage: 50,
          spells: [
            { spellId: 1302914, spellName: 'Venom Roar', hits: 1, damage: 50 },
          ],
        },
      ],
      [
        ['Mage', 'Venom Roar'],
        ['Tank', 'Crush'],
      ],
    ),
    withAvoid('2026-10-21', 2, [
      {
        name: 'Mage',
        hits: 1,
        damage: 100,
        spells: [
          { spellId: 1302914, spellName: 'Venom Roar', hits: 1, damage: 100 },
        ],
      },
    ]),
  ];
  const [boss] = summarizeNight(pulls);
  const roar = boss.avoidable.find((a) => a.name === 'Venom Roar');
  assert.deepEqual(roar.spellIds.sort(), [1302914, 1302917]);
  assert.equal(roar.hits, 5);
  assert.equal(roar.damage, 450);
  assert.equal(roar.pulls, 2);
  assert.equal(roar.raidersHit, 2);
  assert.equal(roar.deaths, 1);
  assert.deepEqual(roar.raiders[0], {
    name: 'Mage',
    hits: 4,
    damage: 400,
    deaths: 1,
    pulls: [0, 1],
  });
  // Crush isn't avoidable: not in the section.
  assert.equal(boss.avoidable.length, 1);
  assert.equal(summarizeProgression(pulls).avoidable[0].hits, 5);
});

test('progression ends at the first kill per difficulty; the rest are reclears', async () => {
  const { splitAtFirstKill } = await import('./pulldesk.mjs');
  const p = (id, startedAt, result, difficultyId = 16) => ({
    id,
    startedAt,
    result,
    difficultyId,
  });
  const pulls = [
    p('c', 3, 'kill'),
    p('a', 1, 'wipe'),
    p('b', 2, 'wipe'),
    p('d', 4, 'wipe'),
    p('e', 5, 'kill'),
    p('h1', 2, 'wipe', 15),
    p('h2', 6, 'wipe', 15),
  ];
  const split = splitAtFirstKill(pulls, false);
  assert.deepEqual(
    split.progression.map((x) => x.id),
    ['a', 'b', 'h1', 'c', 'h2'],
  );
  assert.deepEqual(
    split.reclear.map((x) => x.id),
    ['d', 'e'],
  );
  const before = splitAtFirstKill(pulls, true);
  assert.equal(before.progression.length, 0);
  assert.equal(before.reclear.length, 7);
});
