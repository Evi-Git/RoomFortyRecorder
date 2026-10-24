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
