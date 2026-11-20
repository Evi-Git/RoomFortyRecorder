import { isReset, pullLabel } from '../../renderer/resets';

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
