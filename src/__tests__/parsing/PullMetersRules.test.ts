import fs from 'fs';
import path from 'path';
import PullMeters from '../../parsing/PullMeters';
import { logLineEpochMs } from '../../parsing/PullLogCapture';
import { StoreBuilder } from '../../renderer/logs/store';
import { DEFAULT_FILTERS, makeCtx, meterRows } from '../../renderer/logs/query';

/**
 * [RoomFortyRecorder] The app-side meters (Trends, fallback view) count the
 * way the Logs page does (MeterRules): same per-raider totals on real logs.
 */

const read = (file: string) =>
  fs
    .readFileSync(
      path.join(__dirname, '../../../tests/logs/retail', file),
      'utf8',
    )
    .split('\n')
    .filter(Boolean);

const both = (lines: string[]) => {
  const start = lines.findIndex((l) => l.includes('  ENCOUNTER_START,'));
  const from = Math.max(0, start);
  const startMs = logLineEpochMs(lines[from]);
  const meters = new PullMeters(startMs, logLineEpochMs);
  const b = new StoreBuilder();
  lines.slice(from).forEach((l) => {
    meters.feed(l);
    b.feed(l);
  });
  const p = b.finish({
    id: 'x',
    label: 'Pull',
    encounterId: 0,
    difficultyId: 16,
    startedAt: 0,
    result: 'kill',
  });
  const ctx = makeCtx([p], DEFAULT_FILTERS);
  return { data: meters.finish(300), ctx };
};

const compare = (file: string) => {
  const { data, ctx } = both(read(file));
  (['damage', 'healing', 'taken'] as const).forEach((meter) => {
    const ours = new Map(data[meter].map((r) => [r.name, r.total]));
    const logs = meterRows(ctx, meter);
    expect(logs.length).toBeGreaterThan(0);
    logs.forEach((r) => {
      const name = r.name.split('-')[0];
      const total = ours.get(name) ?? 0;
      // Same rules; tiny gaps only from the last seconds after the fight.
      expect([
        meter,
        name,
        Math.abs(total - r.total) <= Math.max(1, r.total * 0.002),
      ]).toEqual([meter, name, true]);
    });
  });
};

test("Kith'ix calibration lines: Trends meters match the Logs page", () => {
  compare('kithix_calibration.txt');
});

test("Belo'ren pull: Trends meters match the Logs page", () => {
  compare('beloren_boss_hp.txt');
});

test('support damage moves to the evoker in the Trends meters', () => {
  const { data } = both(read('kithix_calibration.txt'));
  const bombard = (name: string) =>
    data.damage
      .find((r) => r.name === name)
      ?.abilities.filter((a) => a.name === 'Bombardments')
      .reduce((n, a) => n + a.total, 0) ?? 0;
  expect(bombard('Glaividblowy')).toBeGreaterThan(0);
  expect(bombard('Puchador')).toBe(0);
});
