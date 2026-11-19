import {
  allResets,
  findTargetPull,
  hiddenResets,
  visiblePulls,
} from '../../renderer/logs/pullList';

const p = (id: string, duration: number) => ({ id, duration });

describe('visiblePulls', () => {
  const pulls = [p('a', 240), p('b', 4), p('c', 90), p('d', 2)];

  it('hides resets unless the switch is on', () => {
    expect(visiblePulls(pulls, false, []).map((x) => x.id)).toEqual(['a', 'c']);
    expect(visiblePulls(pulls, true, [])).toBe(pulls);
  });

  it('never hides the picked pulls', () => {
    expect(visiblePulls(pulls, false, ['b']).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('shows everything when every pull is a reset', () => {
    const resets = [p('x', 3), p('y', 5)];
    expect(visiblePulls(resets, false, [])).toBe(resets);
    expect(allResets(resets)).toBe(true);
    expect(allResets(pulls)).toBe(false);
    expect(allResets([])).toBe(false);
  });

  it('counts the hidden resets', () => {
    expect(hiddenResets(pulls, visiblePulls(pulls, false, []))).toBe(2);
  });
});

describe('findTargetPull', () => {
  const bosses = [
    { encounterId: 1, difficultyId: 16, pullsList: [p('a', 60)] },
    { encounterId: 2, difficultyId: 15, pullsList: [p('b', 60), p('c', 60)] },
  ];
  it('finds the boss and difficulty of a pull', () => {
    expect(findTargetPull(bosses, 'c')).toEqual({
      bossKey: '2:15',
      pullId: 'c',
    });
  });
  it('is null for a pull not on the night', () => {
    expect(findTargetPull(bosses, 'zzz')).toBeNull();
  });
});
