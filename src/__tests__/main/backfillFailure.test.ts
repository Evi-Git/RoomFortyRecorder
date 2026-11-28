import {
  failureAfterIdleRun,
  failureAfterRun,
  notSignedInFailure,
} from '../../main/backfillFailure';
import { backfillDecision } from '../../main/backfillSchedule';
import { describeBackfillFailure } from '../../renderer/uploadLines';

const base = { now: 1_000, failed: 0, gaveUp: 0 };

describe('failureAfterRun', () => {
  it('a clean run leaves no failure (so an old one is cleared)', () => {
    expect(failureAfterRun(base)).toBeNull();
  });

  it('an error that stopped the run is the failure', () => {
    expect(failureAfterRun({ ...base, error: 'ECONNREFUSED' })).toEqual({
      kind: 'error',
      at: 1_000,
      reason: 'ECONNREFUSED',
    });
  });

  it('files given up on beat pulls that merely failed', () => {
    expect(failureAfterRun({ ...base, failed: 2, gaveUp: 1 })?.kind).toBe(
      'gaveUp',
    );
    expect(failureAfterRun({ ...base, failed: 2 })).toMatchObject({
      kind: 'someFailed',
      count: 2,
    });
  });
});

describe('failureAfterIdleRun', () => {
  it('clears a sign-in or server problem, keeps a gave-up file', () => {
    expect(failureAfterIdleRun(notSignedInFailure(1))).toBeNull();
    const gaveUp = { kind: 'gaveUp' as const, at: 1, reason: '', count: 1 };
    expect(failureAfterIdleRun(gaveUp)).toBe(gaveUp);
    expect(failureAfterIdleRun(null)).toBeNull();
  });
});

describe('describeBackfillFailure', () => {
  const at = new Date(2026, 10, 28, 15, 5).getTime();

  it('says nothing when there is no failure', () => {
    expect(describeBackfillFailure(null)).toBeNull();
  });

  it('words each kind in plain English with the time', () => {
    expect(describeBackfillFailure(notSignedInFailure(at))).toBe(
      "Saved combat logs weren't checked at 3:05 PM: sign in with Discord in Cloud settings.",
    );
    expect(
      describeBackfillFailure({ kind: 'error', at, reason: 'ECONNREFUSED' }),
    ).toContain("Couldn't reach the guild server");
    expect(
      describeBackfillFailure({ kind: 'someFailed', at, reason: '', count: 1 }),
    ).toContain("1 pull couldn't be sent");
    expect(
      describeBackfillFailure({ kind: 'gaveUp', at, reason: '', count: 2 }),
    ).toContain('2 log files keep failing');
  });
});

describe('backfillDecision', () => {
  const idle = { enabled: true, capturing: false, busyReason: null };

  it('runs when idle, skips when Send my Logs is off', () => {
    expect(backfillDecision(idle)).toBe('run');
    expect(backfillDecision({ ...idle, enabled: false })).toBe('skip');
  });

  it('waits while capturing, recording, uploading or live', () => {
    expect(backfillDecision({ ...idle, capturing: true })).toBe('later');
    expect(
      backfillDecision({ ...idle, busyReason: 'A recording is in progress.' }),
    ).toBe('later');
  });
});
