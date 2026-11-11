import fs from 'fs';
import path from 'path';
import { StoreBuilder } from '../../renderer/logs/store';
import {
  byTarget,
  DEFAULT_FILTERS,
  emptyMeterText,
  Filters,
  makeCtx,
  meterRows,
} from '../../renderer/logs/query';

/** [RoomFortyRecorder] The Logs page's Enemies side, on a real Coiled Altar pull. */

const lines = fs
  .readFileSync(
    path.join(__dirname, '../../../tests/logs/retail/coiled_altar_boss_hp.txt'),
    'utf8',
  )
  .split('\n');

const build = (transform: (l: string) => string = (l) => l) => {
  const b = new StoreBuilder();
  lines.forEach((l) => b.feed(transform(l)));
  return b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3429,
    difficultyId: 15,
    startedAt: 0,
    result: 'wipe',
  });
};

const p = build();
const enemy = (f: Partial<Filters> = {}) =>
  makeCtx([p], { ...DEFAULT_FILTERS, side: 'enemy', ...f });

test('Enemies → Healing lists what the bosses healed and shielded', () => {
  const rows = meterRows(enemy(), 'healing');
  const names = rows.map((r) => r.name);
  expect(names).toEqual(
    expect.arrayContaining(["Zul'jan", 'Hex Lord Malacrass']),
  );
  // Only enemies: no raider, and nothing of a raider's.
  expect(rows.some((r) => r.player || r.pet)).toBe(false);
  const zuljan = rows.find((r) => r.name === "Zul'jan")!;
  const regen = [...zuljan.abilities.values()].find(
    (a) => a.name === 'Ghastly Regeneration',
  )!;
  // Counted straight from the log's lines (amount - overheal).
  const fromLog = lines
    .filter((l) => l.includes('_HEAL,') && l.includes('"Ghastly Regeneration"'))
    .reduce((n, l) => {
      const f = l.trimEnd().split(',');
      return n + Number(f[f.length - 5]) - Number(f[f.length - 3]);
    }, 0);
  expect(fromLog).toBeGreaterThan(0);
  expect(regen.total).toBe(fromLog);
  expect(regen.kind).toBe('heal');
  // The boss's shield counts as its healing, as a shield.
  const hex = rows.find((r) => r.name === 'Hex Lord Malacrass')!;
  expect(hex.shields).toBeGreaterThan(0);
});

test('"Done to target" adds up to the same healing', () => {
  const total = meterRows(enemy(), 'healing').reduce((n, r) => n + r.total, 0);
  const targets = byTarget(enemy(), 'healing');
  expect(targets.find((t) => t.name === "Zul'jan")).toBeTruthy();
  expect(targets.reduce((n, t) => n + t.total, 0)).toBeCloseTo(total, 0);
});

test("an enemy's row never splits its own abilities off as a pet's", () => {
  // Adds the boss summoned are their own rows; before 1.9.124 their
  // abilities were also marked "by <the add>", so one spell showed twice.
  const owned = p.units.filter(
    (u, i) => !u.friendly && !p.units[u.root].raider && u.root !== i,
  );
  expect(owned.length).toBeGreaterThan(0);
  (['damage', 'healing'] as const).forEach((meter) =>
    meterRows(enemy(), meter).forEach((r) => {
      const abilities = [...r.abilities.values()];
      expect(abilities.filter((a) => a.by)).toEqual([]);
      const ids = abilities.map((a) => a.spellId);
      expect(new Set(ids).size).toBe(ids.length);
    }),
  );
});

test('an enemy whose heals all landed at full health still has a row', () => {
  // Every Ghastly Regeneration tick as pure overheal.
  const full = build((l) =>
    l.includes('"Ghastly Regeneration"') && l.includes('_HEAL,')
      ? l.replace(
          /,(\d+),(\d+),\d+,(\d+),(nil|1)\s*$/,
          (_m, amount, base, absorbed, crit) =>
            `,${amount},${base},${amount},${absorbed},${crit}`,
        )
      : l,
  );
  // Only that spell, so the row has nothing else to stand on.
  const ctx = makeCtx([full], {
    ...DEFAULT_FILTERS,
    side: 'enemy',
    abilities: [1304033],
  });
  const rows = meterRows(ctx, 'healing');
  expect(rows.map((r) => r.name)).toEqual(["Zul'jan"]);
  expect(rows[0].total).toBe(0);
  expect(rows[0].overheal).toBeGreaterThan(0);
  // Raiders' rows are as before: nothing with no healing done.
  const friendly = meterRows(makeCtx([full], DEFAULT_FILTERS), 'healing');
  expect(friendly.every((r) => r.total > 0)).toBe(true);
});

test('an empty table says why', () => {
  expect(emptyMeterText(enemy(), 'healing')).toBe(
    'No enemy healed or shielded anything in this pull.',
  );
  expect(emptyMeterText(makeCtx([p, p], enemy().filters), 'healing')).toBe(
    'No enemy healed or shielded anything in these pulls.',
  );
  expect(emptyMeterText(enemy({ abilities: [1] }), 'healing')).toBe(
    'Nothing here with these filters.',
  );
  expect(emptyMeterText(enemy({ range: [0, 10] }), 'damage')).toBe(
    'Nothing here with these filters.',
  );
  expect(emptyMeterText(makeCtx([p], DEFAULT_FILTERS), 'healing')).toBe(
    'Nothing here in this pull.',
  );
});
