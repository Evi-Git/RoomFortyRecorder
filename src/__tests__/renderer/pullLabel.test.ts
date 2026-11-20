import { isReset, pullLabel, withoutEmptyBosses } from '../../renderer/resets';

describe('pullLabel', () => {
  it('numbers real pulls', () => {
    expect(pullLabel({ pullNumber: 3, duration: 120 })).toBe('Pull 3');
    expect(pullLabel({ pullNumber: 3, duration: 120, reset: false }, '#')).toBe(
      '#3',
    );
    expect(pullLabel({ pullNumber: 3 })).toBe('Pull 3');
  });

  it('calls a reset "Reset", from the flag or (old servers) the duration', () => {
    expect(pullLabel({ pullNumber: 3, duration: 120, reset: true })).toBe(
      'Reset',
    );
    expect(pullLabel({ pullNumber: 3, duration: 4 })).toBe('Reset');
    expect(pullLabel({ pullNumber: 1, duration: 0 }, '#')).toBe('Reset');
  });

  it('isReset honours the server flag', () => {
    expect(isReset({ reset: true })).toBe(true);
    expect(isReset({ reset: false, duration: 60 })).toBe(false);
  });
});

describe('withoutEmptyBosses', () => {
  const bosses = [{ pulls: 0 }, { pulls: 3 }];
  it('hides bosses pulled only as resets unless shown', () => {
    expect(withoutEmptyBosses(bosses, false)).toEqual([{ pulls: 3 }]);
    expect(withoutEmptyBosses(bosses, true)).toEqual(bosses);
  });
  it('never empties the list', () => {
    expect(withoutEmptyBosses([{ pulls: 0 }], false)).toEqual([{ pulls: 0 }]);
  });
});
