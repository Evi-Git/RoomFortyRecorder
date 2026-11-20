import fs from 'fs';
import path from 'path';
import { StoreBuilder } from '../../renderer/logs/store';
import { compileExpression } from '../../renderer/logs/expression';
import { PRESETS } from '../../renderer/logs/queryPresets';

/** [RoomFortyRecorder] Logs page numbers that must agree between tabs. */

const build = (file: string) => {
  const b = new StoreBuilder();
  fs.readFileSync(
    path.join(__dirname, '../../../tests/logs/retail', file),
    'utf8',
  )
    .split('\n')
    .forEach((l) => b.feed(l));
  return b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 1,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
};

const count = (p: ReturnType<typeof build>, src: string) => {
  const fn = compileExpression(src)!;
  let n = 0;
  for (let i = 0; i < p.n; i += 1) if (fn(p, i)) n += 1;
  return n;
};

describe.each(['raid_wipe.txt', 'raid_holy_priest_angel_death.txt'])(
  'Deaths query preset on %s',
  (file) => {
    const p = build(file);
    const preset = PRESETS.find((x) => x.name === 'Deaths')!.expr;

    test('counts what the Deaths tab counts', () => {
      expect(count(p, preset)).toBe(p.deaths.length);
    });

    test('does not count enemy deaths', () => {
      expect(count(p, 'type = death')).toBeGreaterThanOrEqual(p.deaths.length);
      expect(count(p, 'type = death and target.raider = false')).toBe(
        count(p, 'type = death') - p.deaths.length,
      );
    });
  },
);
