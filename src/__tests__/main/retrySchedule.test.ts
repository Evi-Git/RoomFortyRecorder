import {
  UPDATE_SCHEDULE,
  WATCHER_SCHEDULE,
  delayFor,
} from '../../main/retrySchedule';

describe('retrySchedule', () => {
  it('watcher: 2 s, 5 s, 15 s, then every 30 s', () => {
    const got = [0, 1, 2, 3, 4, 50].map((n) => delayFor(WATCHER_SCHEDULE, n));
    expect(got).toEqual([2000, 5000, 15000, 30000, 30000, 30000]);
  });

  it('updates: 2, 10, 30 minutes, then stop', () => {
    const got = [0, 1, 2, 3, 9].map((n) => delayFor(UPDATE_SCHEDULE, n));
    expect(got).toEqual([120000, 600000, 1800000, null, null]);
  });

  it('treats a negative or fractional attempt as the first', () => {
    expect(delayFor(WATCHER_SCHEDULE, -3)).toBe(2000);
    expect(delayFor(WATCHER_SCHEDULE, 1.9)).toBe(5000);
  });
});
