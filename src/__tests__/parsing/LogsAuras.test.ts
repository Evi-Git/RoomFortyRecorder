import fs from 'fs';
import path from 'path';
import { StoreBuilder } from '../../renderer/logs/store';
import {
  auraDetail,
  auraRows,
  DEFAULT_FILTERS,
  makeCtx,
} from '../../renderer/logs/query';

/** [RoomFortyRecorder] Buffs table: one row per spell name, on a made-up pull. */

const ME = 'Player-61-0DEADBEE';
const stamp = (t: number) => {
  const base = 20 * 3600 + t;
  const h = Math.floor(base / 3600);
  const m = Math.floor((base % 3600) / 60);
  const s = (base % 60).toFixed(3).padStart(6, '0');
  return `10/21/2026 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}-4  `;
};
const src = `${ME},"Azraelus-Zul'jin-US",0x514,0x80000000`;

const DEFAULT_AURAS: [number, string, number, string][] = [
  [0, 'APPLIED', 77764, 'Stampeding Roar'],
  [5, 'APPLIED', 77761, 'Stampeding Roar'],
  [10, 'REMOVED', 77764, 'Stampeding Roar'],
  [15, 'REMOVED', 77761, 'Stampeding Roar'],
  [20, 'APPLIED', 77764, 'Stampeding Roar'],
  [25, 'REMOVED', 77764, 'Stampeding Roar'],
  [30, 'APPLIED', 1126, 'Mark of the Wild'],
  [40, 'REMOVED', 1126, 'Mark of the Wild'],
];

const pull = (
  auras: [number, string, number, string][] = DEFAULT_AURAS,
  id = 'x',
) => {
  const combat = fs
    .readFileSync(
      path.join(__dirname, '../../../tests/logs/retail/kithix_calibration.txt'),
      'utf8',
    )
    .split('\n')
    .find((l) => l.includes('COMBATANT_INFO'))!
    .split('  ')[1]
    .split(',');
  combat[1] = ME;
  combat[25] = '104';
  const lines = [
    `${stamp(0)}ENCOUNTER_START,3513,"Kith'ix",16,22,3095`,
    `${stamp(0)}${combat.join(',')}`,
  ];
  const aura = (t: number, type: string, id: number, name: string) =>
    lines.push(
      `${stamp(t)}SPELL_AURA_${type},${src},${src},${id},"${name}",0x8,BUFF`,
    );
  auras.forEach(([t, type, spell, name]) => aura(t, type, spell, name));
  lines.push(`${stamp(120)}ENCOUNTER_END,3513,"Kith'ix",16,22,0,120000`);
  const b = new StoreBuilder();
  lines.forEach((l) => b.feed(l));
  return b.finish({
    id,
    label: 'Pull 1',
    encounterId: 3513,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
};

describe('Buffs rows', () => {
  const p = pull();
  const ctx = makeCtx([p], DEFAULT_FILTERS);

  test('IDs sharing a name are one row: uses add up, overlap counts once', () => {
    const rows = auraRows(ctx, { debuffs: false, who: null });
    const roar = rows.filter((r) => r.name === 'Stampeding Roar');
    expect(roar).toHaveLength(1);
    expect(roar[0].count).toBe(3);
    // 0-15 and 20-25: 20 s, not the 25 s the three IDs add up to.
    expect(roar[0].uptime).toBeCloseTo(20);
    expect(roar[0].spans).toEqual([
      [0, 15],
      [20, 25],
    ]);
    // The most used ID stands for the row; all are kept.
    expect(roar[0].spellId).toBe(77764);
    expect([...roar[0].ids].sort()).toEqual([77761, 77764]);
    expect(rows.find((r) => r.name === 'Mark of the Wild')?.ids).toEqual([
      1126,
    ]);
  });

  test('by ID, rows stay per spell (Warcraft Logs compare)', () => {
    const rows = auraRows(ctx, { debuffs: false, who: null, byId: true });
    const roar = rows.filter((r) => r.name === 'Stampeding Roar');
    expect(roar.map((r) => [r.spellId, r.count]).sort()).toEqual([
      [77761, 1],
      [77764, 2],
    ]);
  });

  test('opening the row shows every ID of the name, merged per raider', () => {
    const d = auraDetail(ctx, 77764, { debuffs: false, who: null });
    expect(d.targets).toHaveLength(1);
    expect(d.targets[0].count).toBe(3);
    expect(d.targets[0].uptime).toBeCloseTo(20);
  });

  describe('with several pulls', () => {
    const one = pull([
      [0, 'APPLIED', 77764, 'Stampeding Roar'],
      [10, 'REMOVED', 77764, 'Stampeding Roar'],
      [20, 'APPLIED', 1126, ''],
      [30, 'REMOVED', 1126, ''],
    ]);
    const two = pull(
      [
        [0, 'APPLIED', 77761, 'Stampeding Roar'],
        [10, 'REMOVED', 77761, 'Stampeding Roar'],
        [20, 'APPLIED', 1126, 'Mark of the Wild'],
        [30, 'REMOVED', 1126, 'Mark of the Wild'],
      ],
      'y',
    );
    const both = makeCtx([one, two], DEFAULT_FILTERS);

    test('a buff unnamed in one pull joins its named row; keys are unique', () => {
      const rows = auraRows(both, { debuffs: false, who: null });
      const keys = rows.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
      const mark = rows.filter((r) => r.ids.includes(1126));
      expect(mark).toHaveLength(1);
      // 2 from the pulls' own lines, 2 worn from before each pull (the
      // fixture's COMBATANT_INFO lists 1126 with no name).
      expect([mark[0].name, mark[0].count]).toEqual(['Mark of the Wild', 4]);
    });

    test('opening a row keeps a pull that only has another ID of the name', () => {
      const rows = auraRows(both, { debuffs: false, who: null });
      const roar = rows.find((r) => r.name === 'Stampeding Roar')!;
      expect(roar.count).toBe(2);
      // Whichever ID the row stands for, both pulls are in the detail.
      [77764, 77761].forEach((id) => {
        const d = auraDetail(both, id, { debuffs: false, who: null });
        expect(d.targets[0].count).toBe(2);
        expect(d.targets[0].uptime).toBeCloseTo(20);
      });
    });
  });
});
