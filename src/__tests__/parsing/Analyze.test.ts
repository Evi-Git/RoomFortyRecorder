import fs from 'fs';
import path from 'path';
import { StoreBuilder } from '../../renderer/logs/store';
import { idleTime, runWidget } from '../../renderer/logs/analyze';

/** [RoomFortyRecorder] Logs → Analyze widgets on a small made-up pull. */

const ME = 'Player-61-0DEADBEE';
const stamp = (t: number) => {
  const base = 20 * 3600 + t;
  const h = Math.floor(base / 3600);
  const m = Math.floor((base % 3600) / 60);
  const s = (base % 60).toFixed(3).padStart(6, '0');
  return `10/21/2026 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}-4  `;
};
const src = `${ME},"Azraelus-Zul'jin-US",0x514,0x80000000`;
const adv = `${ME},0000000000000000,821644,1061676,780,3657,2970,783,0,44147,0,220235,260000,0,1842.76,-22.54,2669,1.2127,334`;
const none = '0000000000000000,nil,0x80000000,0x80000000';

const pull = () => {
  const lines: string[] = [];
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
  combat[25] = '1468';
  lines.push(`${stamp(0)}ENCOUNTER_START,3513,"Kith'ix",16,22,3095`);
  lines.push(`${stamp(0)}${combat.join(',')}`);
  const cast = (t: number, id: number, name: string) =>
    lines.push(
      `${stamp(t)}SPELL_CAST_SUCCESS,${src},${none},${id},"${name}",0x8,${adv}`,
    );
  const aura = (t: number, type: string, id: number, name: string) =>
    lines.push(
      `${stamp(t)}SPELL_AURA_${type},${src},${src},${id},"${name}",0x8,BUFF`,
    );
  // Stasis at 0 and 90 (cooldown 90): the buff holds 3 casts, then ends.
  cast(0, 370537, 'Stasis');
  aura(0, 'APPLIED', 370562, 'Stasis');
  cast(2, 355936, 'Dream Breath');
  cast(4, 363534, 'Rewind');
  aura(10, 'REMOVED', 370562, 'Stasis');
  cast(90, 370537, 'Stasis');
  aura(90, 'APPLIED', 370562, 'Stasis');
  cast(95, 361469, 'Living Flame');
  aura(100, 'REMOVED', 370562, 'Stasis');
  // Essence Burst: spent on Emerald Blossom, on Echo, and once expired.
  aura(20, 'APPLIED', 369299, 'Essence Burst');
  cast(25, 355913, 'Emerald Blossom');
  aura(25, 'REMOVED', 369299, 'Essence Burst');
  aura(40, 'APPLIED', 369299, 'Essence Burst');
  cast(41, 364343, 'Echo');
  aura(41, 'REMOVED', 369299, 'Essence Burst');
  aura(60, 'APPLIED', 369299, 'Essence Burst');
  aura(75, 'REMOVED', 369299, 'Essence Burst');
  // Essence: 2 gained, 1 of it lost at the cap.
  lines.push(
    `${stamp(30)}SPELL_ENERGIZE,${src},${src},369297,"Essence Burst",0x8,${adv},1,0,19,5`,
  );
  lines.push(
    `${stamp(31)}SPELL_ENERGIZE,${src},${src},369297,"Essence Burst",0x8,${adv},0,1,19,5`,
  );
  lines.push(`${stamp(120)}ENCOUNTER_END,3513,"Kith'ix",16,22,1,120000`);
  const b = new StoreBuilder();
  lines.forEach((l) => b.feed(l));
  return b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3513,
    difficultyId: 16,
    startedAt: 0,
    result: 'kill',
  });
};

describe('Analyze widgets', () => {
  test('idle time with charges recharging one at a time', () => {
    // Cooldown 60, pressed at 0, 60 and 150 in a 200 s fight: ready but
    // not cast from 120 to 150; the next one is ready at 210, past the end.
    expect(idleTime([0, 60, 150], 60, 1, 200)).toEqual([[120, 150]]);
    // Two charges: full at the start until the first press.
    expect(idleTime([10], 30, 2, 100)).toEqual([
      [0, 10],
      [40, 100],
    ]);
  });

  const p = pull();

  test('cast efficiency', () => {
    const r = runWidget(p, ME, {
      id: 'a',
      kind: 'castEfficiency',
      spell: { name: 'Stasis' },
      cooldown: 90,
    });
    if (r.kind !== 'castEfficiency') throw new Error(r.kind);
    expect(r.casts).toEqual([0, 90]);
    // Ready again at 180, past the end: nothing lost.
    expect(r.efficiency).toBe(1);
  });

  test('cooldown window: what Stasis held, graded', () => {
    const r = runWidget(p, ME, {
      id: 'b',
      kind: 'cooldownWindow',
      spell: { name: 'Stasis' },
      ends: 'buff',
      spells: [{ name: 'Dream Breath' }, { name: 'Rewind' }],
      min: 2,
    });
    if (r.kind !== 'cooldownWindow') throw new Error(r.kind);
    expect(r.windows.map((w) => [w.at, w.end, w.good])).toEqual([
      [0, 10, true],
      [90, 100, false],
    ]);
    expect(r.windows[1].casts).toEqual([
      { name: 'Living Flame', count: 1, good: false },
    ]);
  });

  test('proc consumption: perfect, good, wasted', () => {
    const r = runWidget(p, ME, {
      id: 'c',
      kind: 'procConsumption',
      spell: { name: 'Essence Burst' },
      spells: [{ name: 'Emerald Blossom' }],
      goodSpells: [{ name: 'Echo' }],
    });
    if (r.kind !== 'procConsumption') throw new Error(r.kind);
    expect([r.perfect, r.good, r.wasted]).toEqual([1, 1, 1]);
  });

  test('buff uptime, resource waste, count', () => {
    const up = runWidget(p, ME, {
      id: 'd',
      kind: 'buffUptime',
      spell: { name: 'Stasis' },
      spells: [{ name: 'Dream Breath' }],
    });
    if (up.kind !== 'buffUptime') throw new Error(up.kind);
    expect(up.uptime).toBeCloseTo(20 / 120);
    expect(up.filled).toBe(1);
    const waste = runWidget(p, ME, { id: 'e', kind: 'resourceWaste' });
    if (waste.kind !== 'resourceWaste') throw new Error(waste.kind);
    expect([waste.power, waste.wasted, waste.gained]).toEqual([19, 1, 2]);
    const count = runWidget(p, ME, {
      id: 'f',
      kind: 'count',
      what: 'casts',
      spells: [{ name: 'Stasis' }, { name: 'Echo' }],
    });
    if (count.kind !== 'count') throw new Error(count.kind);
    expect(count.total).toBe(3);
  });
});
