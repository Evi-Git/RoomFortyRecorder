import {
  alignByPhase,
  castsFor,
  driftText,
  gapSoFar,
  mergeByName,
  ourPhases,
  pairCasts,
  phasesOf,
  shortPhase,
  smooth,
} from '../../renderer/toplogs/timeline';
import type { Track } from '../../renderer/toplogs/trial';

const cd = (spellId: number, extra = {}) => ({
  spellId,
  share: 1,
  medianGap: 90,
  medianCasts: 3,
  medianFirst: 5,
  cooldown: 90,
  ...extra,
});

describe('Time trial A: one timeline', () => {
  test("cooldowns merge by name (Frostwyrm's Fury was two rows)", () => {
    const merged = mergeByName([cd(279302), cd(1265870), cd(51271)], {
      279302: "Frostwyrm's Fury",
      1265870: "Frostwyrm's Fury",
      51271: 'Pillar of Frost',
    });
    expect(merged.map((m) => [m.name, m.spellIds])).toEqual([
      ["Frostwyrm's Fury", [279302, 1265870]],
      ['Pillar of Frost', [51271]],
    ]);
    // A 1.9.102 server's merged row is kept as it is.
    const fromServer = mergeByName([
      cd(1, { spellIds: [1, 2], name: 'Thing' }),
    ]);
    expect(fromServer[0].spellIds).toEqual([1, 2]);
    // Our casts count by name too (our log can use another ID).
    expect(
      castsFor(
        {
          casts: [
            [10, 9],
            [5, 1],
            [20, 3],
          ],
          names: { 9: 'thing' },
        },
        fromServer[0],
      ),
    ).toEqual([5, 10]);
  });

  test('casts pair with the nearest within 40 s; missed and extra', () => {
    expect(pairCasts([3, 92, 183, 273], [3, 97, 190])).toEqual([
      { them: 3, you: 3 },
      { them: 92, you: 97 },
      { them: 183, you: 190 },
      { them: 273, you: null },
    ]);
    expect(pairCasts([10], [10, 200])).toEqual([
      { them: 10, you: 10 },
      { them: null, you: 200 },
    ]);
    expect(driftText(5)).toBe('+5 s');
    expect(driftText(-3)).toBe('−3 s');
    expect(driftText(0.2)).toBe('on time');
    expect(driftText(null)).toBe('missed');
  });

  test('5 s average and the gap so far', () => {
    expect(smooth([10, 20, 30, null, 40], 2)).toEqual([10, 15, 25, null, 40]);
    expect(gapSoFar([10, 10, 10], [5, 20, null, 1])).toEqual([5, -5, -5, -5]);
  });

  const them: Track = {
    name: 'Them',
    duration: 200,
    amounts: Array.from({ length: 200 }, (_, i) => (i + 1) * 10),
    casts: [
      [5, 1],
      [110, 1],
    ],
    phases: [
      [0, 1],
      [100, 2],
      [150, 3],
    ],
    phaseNames: { 1: 'Stage One', 2: 'Intermission', 3: 'Stage Two' },
    enemy: [
      [10, 500], // P1 filler, also cast later: not a marker
      [102, 600], // first cast 2 s into the intermission
      [120, 500],
      [151, 700], // P2 marker
      [180, 600],
    ],
  };

  test('phases: theirs from Warcraft Logs, ours from the marker abilities', () => {
    expect(shortPhase('Stage Two')).toBe('P2');
    expect(shortPhase('Intermission')).toBe('Int');
    expect(shortPhase('Phase 3')).toBe('P3');
    expect(phasesOf(them).map((p) => [p.short, p.from, p.to])).toEqual([
      ['P1', 0, 100],
      ['Int', 100, 150],
      ['P2', 150, 200],
    ]);
    const ours = new Map([
      [500, [12, 130]],
      [600, [110]], // our intermission started at 108
      [700, [171]], // our P2 at 170
    ]);
    expect(
      ourPhases(them, ours, 230).map((p) => [p.short, p.from, p.to]),
    ).toEqual([
      ['P1', 0, 108],
      ['Int', 108, 170],
      ['P2', 170, 230],
    ]);
    // A wipe in the intermission: P2 never found.
    expect(
      ourPhases(them, new Map([[600, [110]]]), 140).map((p) => [p.short, p.to]),
    ).toEqual([
      ['P1', 108],
      ['Int', 140],
    ]);
  });

  test('line up by each phase: their phases start with ours', () => {
    const ours = ourPhases(
      them,
      new Map([
        [600, [110]],
        [700, [171]],
      ]),
      230,
    );
    const a = alignByPhase(them, ours);
    expect(a.phases.map((p) => p.from)).toEqual([0, 108, 170]);
    // Their intermission cast at 110 moves 8 s later; P1 stays.
    expect(a.casts).toEqual([
      [5, 1],
      [118, 1],
    ]);
    // 100-107 has no data of theirs now (their P1 ended at 100).
    expect(a.rates[99]).toBe(10);
    expect(a.rates[103]).toBeNull();
    expect(a.rates[108]).toBe(10);
    expect(a.end).toBe(220);
  });
});
