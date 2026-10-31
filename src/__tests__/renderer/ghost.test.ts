import {
  comingUp,
  Ghost,
  ghostAt,
  ghostFor,
} from '../../renderer/toplogs/ghost';
import { asIs } from '../../renderer/toplogs/timeline';
import type { Track } from '../../renderer/toplogs/trial';

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

describe('ghost on your VoD', () => {
  const them = track(new Array(100).fill(200), [
    [5, 1],
    [65, 1],
    [40, 2],
  ]);
  const you = track(new Array(100).fill(100), [[10, 1]]);
  const ghost: Ghost = {
    encounterId: 3513,
    difficultyId: 16,
    startedAt: 1792639476000,
    rank: 1,
    them,
    you,
    aligned: asIs(them),
    cooldowns: [
      { key: 'a', name: 'Pillar', spellId: 1, spellIds: [1], cooldown: 60 },
      { key: 'b', name: 'Fury', spellId: 2, spellIds: [2], cooldown: 90 },
    ],
    phases: [
      { name: 'Stage One', short: 'P1', from: 0, to: 50 },
      { name: 'Stage Two', short: 'P2', from: 50, to: 100 },
    ],
    unit: 'DPS',
  };

  test('found by the recording: boss, difficulty, start within 2 minutes', () => {
    expect(ghostFor([ghost], 3513, 16, 1792639476000 + 30000)).toBe(ghost);
    expect(ghostFor([ghost], 3513, 15, 1792639476000)).toBeUndefined();
    expect(ghostFor([ghost], 3513, 16, 1792639476000 + 600000)).toBeUndefined();
  });

  test('where the race stands, and what they press next', () => {
    const at = ghostAt(ghost, 60);
    expect(at.gap).toBe(-6000);
    expect(at.phase?.short).toBe('P2');
    const next = comingUp(ghost, 30);
    expect(next.map((c) => [c.cd.name, c.them, c.yours])).toEqual([
      ['Fury', 10, 0],
    ]);
    // Pillar: they press it at 65; ours (10 + 60) is ready at 70.
    expect(
      comingUp(ghost, 50).map((c) => [c.cd.name, c.them, c.yours]),
    ).toEqual([['Pillar', 15, 20]]);
  });
});
