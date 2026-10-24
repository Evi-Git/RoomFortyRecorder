import fs from 'fs';
import path from 'path';
import { lineSeconds, StoreBuilder } from '../../renderer/logs/store';
import {
  DEFAULT_FILTERS,
  makeCtx,
  meterRows,
  viewSeconds,
} from '../../renderer/logs/query';
import { compileExpression } from '../../renderer/logs/expression';

/** [RoomFortyRecorder] The Logs page's event store and queries on a real pull. */

const lines = fs
  .readFileSync(
    path.join(__dirname, '../../../tests/logs/retail/beloren_boss_hp.txt'),
    'utf8',
  )
  .split('\n');

const build = (transform: (l: string) => string = (l) => l) => {
  const b = new StoreBuilder();
  lines.forEach((l) => b.feed(transform(l)));
  return b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3182,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
};

test('reads timestamps with and without a time zone', () => {
  expect(lineSeconds('4/30/2026 20:05:17.7771  X')).toBeCloseTo(
    lineSeconds('4/30/2026 20:05:17.7771-4  X'),
  );
  expect(Number.isFinite(lineSeconds('4/30/2026 20:05:17.7771+10  X'))).toBe(
    true,
  );
});

test('times, deaths cut-off and slices work with time zone stamps', () => {
  const p = build((l) => l.replace(/^(\S+ [\d:.]+) {2}/, '$1-4  '));
  expect(p.t.every((t) => Number.isFinite(t))).toBe(true);
  expect(p.deaths.length).toBeGreaterThan(2);
  const total = (f: Partial<typeof DEFAULT_FILTERS>) =>
    meterRows(makeCtx([p], { ...DEFAULT_FILTERS, ...f }), 'damage').reduce(
      (n, r) => n + r.total,
      0,
    );
  const all = total({});
  expect(total({ deathCutoff: 1 })).toBeLessThan(all);
  expect(total({ range: [30, 60] })).toBeLessThan(all / 3);
  expect(
    viewSeconds(makeCtx([p], { ...DEFAULT_FILTERS, deathCutoff: 1 })),
  ).toBeCloseTo(p.deaths[0].t, 1);
});

test('filter expressions', () => {
  const p = build();
  const count = (src: string) => {
    const fn = compileExpression(src)!;
    let n = 0;
    for (let i = 0; i < p.n; i += 1) if (fn(p, i)) n += 1;
    return n;
  };
  expect(count('type = death')).toBeGreaterThan(0);
  expect(count('type = damage and target.type = player')).toBeGreaterThan(
    count('type = damage and target.type = player and amount > 100k'),
  );
  expect(() => compileExpression('bogus = 1')).toThrow(/Unknown field/);
});

test('active time never passes the fight, enemy filters and multi-ability filter', () => {
  const p = build();
  const ctx = makeCtx([p], DEFAULT_FILTERS);
  const rows = meterRows(ctx, 'damage');
  rows.forEach((r) =>
    expect(r.active).toBeLessThanOrEqual(viewSeconds(ctx) + 0.001),
  );
  const total = (f: Partial<typeof DEFAULT_FILTERS>) =>
    meterRows(makeCtx([p], { ...DEFAULT_FILTERS, ...f }), 'damage').reduce(
      (n, r) => n + r.total,
      0,
    );
  const all = total({});
  const bosses = total({ enemy: { kind: 'bosses' } });
  const adds = total({ enemy: { kind: 'adds' } });
  expect(bosses).toBeGreaterThan(0);
  expect(Math.round(bosses + adds)).toBe(Math.round(all));
  const [a, b] = [...rows[0].abilities.values()].map((x) => x.spellId);
  const one = total({ abilities: [a] });
  expect(total({ abilities: [a, b] })).toBeGreaterThan(one);
});

test('passive reduction talents read from their descriptions', () => {
  // eslint-disable-next-line global-require
  const {
    parseReduction,
    talentSpells,
  } = require('../../renderer/logs/talents');
  expect(parseReduction('Reduces all magic damage taken by 4%.')).toEqual({
    r: 0.04,
    schools: 126,
  });
  expect(
    parseReduction(
      'Damage taken from Fire, Frost, and Nature effects reduced by 3%.',
    ),
  ).toEqual({
    r: 0.03,
    schools: 4 | 8 | 16,
  });
  expect(parseReduction('Reduces damage taken by 40% for 12 sec.')).toBeNull();
  expect(parseReduction('Increases your Haste by 5%.')).toBeNull();
  const tree = {
    specId: 264,
    nodes: {
      1: [
        {
          rank: 1,
          options: [
            {
              entryId: 11,
              spellId: 100,
              name: 'Warding',
              text: 'Reduces all magic damage taken by 2%.',
            },
          ],
        },
        {
          rank: 2,
          options: [
            {
              entryId: 11,
              spellId: 100,
              name: 'Warding',
              text: 'Reduces all magic damage taken by 4%.',
            },
          ],
        },
      ],
      2: [
        {
          rank: 1,
          options: [
            { entryId: 21, spellId: 200, name: 'A', text: '' },
            { entryId: 22, spellId: 201, name: 'B', text: '' },
          ],
        },
      ],
    },
  };
  const picked = talentSpells(
    [
      [1, 11, 2],
      [2, 22, 1],
      [9, 99, 1],
    ],
    tree,
  );
  expect(
    picked.map((t: { name: string; text: string }) => `${t.name}:${t.text}`),
  ).toEqual(['Warding:Reduces all magic damage taken by 4%.', 'B:']);
});
