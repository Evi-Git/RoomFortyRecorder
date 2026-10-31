import { asIs, mergeByName } from '../../renderer/toplogs/timeline';
import type { Track } from '../../renderer/toplogs/trial';
import { byKind, findings } from '../../renderer/toplogs/whereTime';

const track = (perSecond: number[], casts: [number, number][]): Track => {
  let sum = 0;
  return {
    name: 'x',
    duration: perSecond.length,
    amounts: perSecond.map((v) => {
      sum += v;
      return sum;
    }),
    casts,
  };
};

describe('where the time went (ranked by cost)', () => {
  const names = { 1: 'Pillar of Frost', 2: "Frostwyrm's Fury" };
  const cds = mergeByName(
    [1, 2].map((spellId) => ({
      spellId,
      share: 1,
      medianGap: 60,
      medianCasts: 3,
      medianFirst: 0,
      cooldown: 60,
    })),
    names,
  );
  // 240 s; they burst 10 s after each Pillar (0, 60, 120, 180).
  // Fury adds 300 for 10 s.
  const burst = (casts: number[], fury: number[]) =>
    Array.from(
      { length: 240 },
      (_, t) =>
        (casts.some((c) => t >= c && t < c + 10) ? 500 : 100) +
        (fury.some((c) => t >= c && t < c + 10) ? 300 : 0),
    );
  const them = track(burst([0, 60, 120, 180], [5, 125]), [
    [0, 1],
    [60, 1],
    [120, 1],
    [180, 1],
    [5, 2],
    [125, 2],
  ]);
  // You: Pillar late from 60 on (+5, +6, +8), Fury only once.
  const you = track(burst([0, 65, 126, 188], [5]), [
    [0, 1],
    [65, 1],
    [126, 1],
    [188, 1],
    [5, 2],
  ]);

  test('late chain, a missed cooldown, ranked by cost', () => {
    const list = findings(you, { names }, asIs(them), cds);
    const late = list.find((f) => f.kind === 'late');
    expect(late?.title).toBe('Pillar of Frost');
    expect(late?.what).toBe('Late 3 of 4 times from 1:00 on: +5, +6, +8 s');
    expect(late?.why).toBe(
      'One late Pillar of Frost pushed every later one back.',
    );
    // Their bursts start 5, 6 and 8 s before yours: 400 a second, but 2:05
    // (700 behind) is shared with the missed Fury: 18 * 400 + 700 / 2.
    expect(late?.cost).toBe(7550);
    const missed = list.find((f) => f.kind === 'missed');
    expect(missed?.what).toBe('1 vs their 2; they pressed it at 2:05');
    expect(list.map((f) => f.cost)).toEqual(
      [...list.map((f) => f.cost)].sort((a, b) => b - a),
    );
    expect(byKind(list).map((k) => k.kind)).toEqual(
      expect.arrayContaining(['late']),
    );
  });

  test('a lull: no cooldowns, they do more', () => {
    const quiet = track(
      Array.from({ length: 120 }, (_, t) => (t >= 40 && t < 80 ? 200 : 100)),
      [[0, 1]],
    );
    const me = track(
      Array.from({ length: 120 }, () => 100),
      [[0, 1]],
    );
    const list = findings(me, {}, asIs(quiet), cds);
    const lull = list.find((f) => f.kind === 'lull');
    expect(lull?.from).toBe(15);
    expect(lull?.cost).toBe(4000);
  });
});
