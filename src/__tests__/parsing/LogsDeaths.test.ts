import fs from 'fs';
import path from 'path';
import { StoreBuilder } from '../../renderer/logs/store';
import { DEFAULT_FILTERS, makeCtx } from '../../renderer/logs/query';
import {
  deathDetails,
  foldDeaths,
  killingBlows,
} from '../../renderer/logs/deaths';
import {
  availabilityAt,
  defensiveFor,
  TABLE,
} from '../../renderer/logs/defensives';

/** [RoomFortyRecorder] The Logs page's Deaths tab on a real pull. */

const logDir = path.join(__dirname, '../../../tests/logs/retail');
const read = (file: string) =>
  fs.readFileSync(path.join(logDir, file), 'utf8').split('\n');

const storeOf = (lines: string[]) => {
  const b = new StoreBuilder();
  lines.forEach((l) => l && b.feed(l));
  return b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3182,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
};

const beloren = storeOf(read('beloren_boss_hp.txt'));

test('every raider death has a recap ending at the death, with health', () => {
  const deaths = deathDetails(makeCtx([beloren], DEFAULT_FILTERS));
  expect(deaths.length).toBe(beloren.deaths.length);
  expect(deaths.length).toBeGreaterThan(2);
  deaths.forEach((d, i) => {
    expect(d.order).toBe(i + 1);
    expect(d.recap.length).toBeGreaterThan(0);
    expect(d.recap.every((r) => r.dt <= 0 && r.dt >= -30)).toBe(true);
    // Time order.
    expect(d.recap.every((r, j) => j === 0 || r.t >= d.recap[j - 1].t)).toBe(
      true,
    );
  });
  const withBlow = deaths.filter((d) => d.killing);
  expect(withBlow.length).toBeGreaterThan(deaths.length / 2);
  // The last hit of most deaths leaves them at 0% or has overkill.
  const lastHits = withBlow.map(
    (d) => d.recap.filter((r) => r.kind === 'damage').slice(-1)[0],
  );
  expect(
    lastHits.filter((h) => h.overkill > 0 || h.hp === 0).length,
  ).toBeGreaterThan(withBlow.length / 2);
  // Health potion is always on the list of what they could press.
  expect(
    deaths.every((d) => d.available.some((a) => a.kind === 'potion')),
  ).toBe(true);
  expect(killingBlows(deaths).reduce((n, b) => n + b.count, 0)).toBe(
    deaths.length,
  );
});

test('the death cut-off and a slice limit the deaths shown', () => {
  const all = deathDetails(makeCtx([beloren], DEFAULT_FILTERS));
  expect(
    deathDetails(makeCtx([beloren], { ...DEFAULT_FILTERS, deathCutoff: 2 }))
      .length,
  ).toBe(2);
  const t = all[1].t;
  expect(
    deathDetails(
      makeCtx([beloren], { ...DEFAULT_FILTERS, range: [0, t - 0.5] }),
    ).length,
  ).toBe(1);
});

test("Feign Death isn't a death", () => {
  const lines = read('beloren_boss_hp.txt');
  const i = lines.findIndex((l) => /UNIT_DIED,.*Player-.*,0\s*$/.test(l));
  const feign = lines[i].replace(/,0(\s*)$/, ',1$1');
  const without = lines.slice();
  without[i] = feign;
  expect(storeOf(without).deaths.length).toBe(beloren.deaths.length - 1);
});

test('defensives: same table as the Dashboard (server)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../guild-cloud-server/pulldesk-defensives.mjs'),
    'utf8',
  );
  const table = src.slice(src.indexOf('const TABLE = {'));
  const names = [
    ...table.slice(0, table.indexOf('};')).matchAll(/^\s+'([^']+)':/gm),
  ].map((m) => m[1]);
  expect(Object.keys(TABLE).sort()).toEqual(names.sort());
  expect(defensiveFor('Algari Healing Potion')?.kind).toBe('potion');
  // A warlock's Unending Resolve used 60 s before: on cooldown, 120 s left.
  const entry = defensiveFor('Unending Resolve');
  expect(entry).not.toBeNull();
  const ur = availabilityAt(266, [{ t: 10, entry: entry! }], 70, true).find(
    (a) => a.ability === 'Unending Resolve',
  );
  expect(ur).toMatchObject({ status: 'cooldown', readyIn: 120, usedCount: 1 });
});

test('a wipe mechanic (4+ deaths to one ability in 2 s) folds into one group', () => {
  const deaths = deathDetails(makeCtx([beloren], DEFAULT_FILTERS));
  const groups = foldDeaths(deaths);
  expect(groups.reduce((n, g) => n + g.length, 0)).toBe(deaths.length);
  const big = groups.filter((g) => g.length >= 4);
  expect(big.length).toBeGreaterThanOrEqual(1);
  big.forEach((g) => {
    expect(new Set(g.map((d) => d.killing?.spell)).size).toBe(1);
    expect(g[g.length - 1].t - g[0].t).toBeLessThanOrEqual(2);
  });
  // Nothing comes off at the moment of death.
  deaths.forEach((d) =>
    expect(d.recap.some((r) => r.kind === 'buffGone' && r.dt > -0.05)).toBe(
      false,
    ),
  );
});
