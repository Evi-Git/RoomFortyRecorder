import fs from 'fs';
import path from 'path';
import { StoreBuilder } from '../../renderer/logs/store';
import {
  idleTime,
  KIND_INFO,
  MOST_WASTED,
  notReadyReason,
  runWidget,
  starterLayout,
  WidgetKind,
  WidgetSpec,
} from '../../renderer/logs/analyze';
import { SPEC_PRESETS } from '../../renderer/logs/specPresets';
import { PRIMARY_POWER } from '../../renderer/logs/primaryPower';
import { POWER_NAMES } from '../../renderer/logs/store';

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

const pull = (specId = 1468, extra: string[] = []) => {
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
  combat[25] = String(specId);
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
  lines.push(...extra);
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

  test('talent-gated widgets hide for raiders without the talent', () => {
    const entry = p.units.find((u) => u.guid === ME)!.talents![0][1];
    const w = {
      id: 't',
      kind: 'castEfficiency' as const,
      spell: { name: 'Stasis' },
    };
    expect(runWidget(p, ME, { ...w, talent: [entry] }).kind).toBe(
      'castEfficiency',
    );
    expect(runWidget(p, ME, { ...w, talent: [999999999] }).kind).toBe(
      'notTalented',
    );
  });

  test('spec presets from WoWAnalyzer', () => {
    const pres = starterLayout(true, 1468);
    expect(pres.some((w) => w.spell?.name === 'Stasis')).toBe(true);
    expect(pres[0].kind).toBe('activeTime');
    // A copy: editing it doesn't touch the preset.
    pres[0].title = 'changed';
    expect(SPEC_PRESETS[1468][0].title).toBeUndefined();
    // An unknown spec gets the basic three.
    expect(starterLayout(false, 1).map((w) => w.kind)).toEqual([
      'activeTime',
      'breakdown',
      'resourceWaste',
    ]);
    Object.entries(SPEC_PRESETS).forEach(([spec, list]) => {
      const ids = list.map((w) => w.id);
      expect(new Set(ids).size).toBe(ids.length);
      list.forEach((w) => {
        expect(KIND_INFO[w.kind]).toBeDefined();
        if (w.kind === 'castEfficiency') expect(w.spell?.name).toBeTruthy();
      });
      expect(Number(spec)).toBeGreaterThan(0);
    });
    expect(Object.keys(SPEC_PRESETS).length).toBeGreaterThanOrEqual(39);
  });

  describe('resource lost at the cap', () => {
    const energize = (t: number, power: number, gained: number, lost: number) =>
      `${stamp(t)}SPELL_ENERGIZE,${src},${src},1,"Gain",0x8,${adv},${gained},${lost},${power},5`;
    const run = (specId: number, extra: string[]) => {
      const r = runWidget(pull(specId, extra), ME, {
        id: 'w',
        kind: 'resourceWaste',
      });
      if (r.kind !== 'resourceWaste') throw new Error(r.kind);
      return r;
    };

    test('a Shadow Priest sees Insanity, not the Mana they waste more of', () => {
      const extra = [
        energize(10, 0, 500, 900), // Mana, 900 lost
        energize(11, 13, 20, 3), // Insanity, 3 lost
      ];
      const shadow = run(258, extra);
      expect([shadow.power, shadow.wasted, shadow.gained]).toEqual([13, 3, 23]);
      // The most wasted is still listed under "Also".
      expect(shadow.byPower[0][0]).toBe(0);
      // A spec we don't know keeps the old pick (the most wasted).
      expect(run(99999, extra).power).toBe(0);
    });

    test('shows 0 for the main resource when it gained but never wasted', () => {
      const r = run(258, [energize(10, 0, 500, 900), energize(11, 13, 20, 0)]);
      expect([r.power, r.wasted, r.gained]).toEqual([13, 0, 20]);
    });

    test('a main resource with no logged gains falls back to the most wasted', () => {
      const none = run(258, [energize(10, 0, 500, 900)]);
      expect([none.power, none.wasted]).toEqual([0, 900]);
    });

    test('Arcane and Windwalker show what is logged (no Mana or Energy regen)', () => {
      const arcane = run(62, [energize(10, 16, 4, 1)]);
      expect([arcane.power, arcane.wasted, arcane.gained]).toEqual([16, 1, 5]);
      const ww = run(269, [energize(10, 12, 2, 1), energize(11, 3, 10, 40)]);
      expect([ww.power, ww.wasted]).toEqual([12, 1]);
    });

    test('Preservation and Augmentation show Essence', () => {
      const extra = [energize(10, 0, 500, 900), energize(11, 19, 2, 1)];
      expect(run(1468, extra).power).toBe(19);
      expect(run(1473, extra).power).toBe(19);
    });

    test('the one wasted most can be asked for', () => {
      const r = runWidget(
        pull(258, [energize(10, 0, 500, 900), energize(11, 13, 20, 3)]),
        ME,
        { id: 'w', kind: 'resourceWaste', power: MOST_WASTED },
      );
      if (r.kind !== 'resourceWaste') throw new Error(r.kind);
      expect(r.power).toBe(0);
    });

    test('spending logged as a negative gain is not counted as gained', () => {
      const r = run(1480, [energize(10, 17, 10, 0), energize(11, 17, -2, 0)]);
      expect([r.power, r.gained]).toEqual([17, 10]);
    });

    test('a widget that names a resource keeps it', () => {
      const r = runWidget(pull(258, [energize(10, 0, 5, 9)]), ME, {
        id: 'w',
        kind: 'resourceWaste',
        power: 0,
      });
      if (r.kind !== 'resourceWaste') throw new Error(r.kind);
      expect(r.power).toBe(0);
    });

    test('every spec has a main resource the log knows', () => {
      Object.keys(SPEC_PRESETS).forEach((spec) => {
        expect(POWER_NAMES[PRIMARY_POWER[Number(spec)]]).toBeDefined();
      });
      expect(Object.keys(PRIMARY_POWER).length).toBe(
        Object.keys(SPEC_PRESETS).length,
      );
      // Devourer (1480) and Augmentation (1473).
      expect([PRIMARY_POWER[1480], PRIMARY_POWER[1473]]).toEqual([17, 19]);
    });
  });
});

describe('notReadyReason (why the builder button is disabled)', () => {
  const w = (kind: WidgetKind, spell?: { name: string }) =>
    ({ id: 'x', kind, spell }) as WidgetSpec;
  test('a spell kind without its spell says what to pick', () => {
    expect(notReadyReason(w('castEfficiency'))).toBe(
      'Pick the cooldown first.',
    );
    expect(notReadyReason(w('cooldownWindow'))).toMatch(/cooldown that opens/);
    expect(notReadyReason(w('procConsumption'))).toMatch(/proc/);
    expect(notReadyReason(w('buffUptime'))).toMatch(/buff/);
  });
  test('ready once the spell is picked, and for kinds with no spell', () => {
    expect(notReadyReason(w('buffUptime', { name: 'Echo' }))).toBeNull();
    (['resourceWaste', 'count', 'breakdown', 'activeTime'] as const).forEach(
      (k) => expect(notReadyReason(w(k))).toBeNull(),
    );
  });
});
