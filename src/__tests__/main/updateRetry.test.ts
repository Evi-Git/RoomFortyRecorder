import {
  BUSY_RECHECK_MS,
  nextRetryDelay,
  retryAction,
} from '../../main/updateRetry';

describe('nextRetryDelay', () => {
  it('automatic runs retry after 2, 10 and 30 minutes, then stop', () => {
    const min = 60_000;
    expect([0, 1, 2].map((n) => nextRetryDelay(n, false))).toEqual([
      2 * min,
      10 * min,
      30 * min,
    ]);
    expect(nextRetryDelay(3, false)).toBeNull();
  });

  it('a manual run never schedules a retry', () => {
    expect(nextRetryDelay(0, true)).toBeNull();
  });
});

describe('retryAction', () => {
  it('does nothing while a check or download is running or finished', () => {
    ['checking', 'downloading', 'ready'].forEach((state) =>
      expect(retryAction(state, null)).toBe('skip'),
    );
  });

  it('waits while the app is busy, and runs when idle', () => {
    expect(retryAction('error', 'A pull is being recorded.')).toBe('later');
    expect(retryAction('error', null)).toBe('run');
    expect(retryAction('idle', null)).toBe('run');
  });

  it('rechecks a busy app after a minute', () => {
    expect(BUSY_RECHECK_MS).toBe(60_000);
  });
});
