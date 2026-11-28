/**
 * [RoomFortyRecorder] Backoff schedules as plain data, so the timing can be
 * tested without timers. `delayFor(schedule, attempt)` gives the wait before
 * attempt number `attempt` (0 = the first retry); past the end of the list it
 * keeps returning `repeatMs` (or null when the schedule should stop).
 */

export type Schedule = {
  /** Waits for the first retries, in order. */
  stepsMs: readonly number[];
  /** Wait for every retry after the list runs out; null = stop retrying. */
  repeatMs: number | null;
};

/** Combat log folder watcher: 2 s, 5 s, 15 s, then every 30 s, for good. */
export const WATCHER_SCHEDULE: Schedule = {
  stepsMs: [2_000, 5_000, 15_000],
  repeatMs: 30_000,
};

/** Update errors: 2 min, 10 min, 30 min, then the normal schedule resumes. */
export const UPDATE_SCHEDULE: Schedule = {
  stepsMs: [2 * 60_000, 10 * 60_000, 30 * 60_000],
  repeatMs: null,
};

export const delayFor = (schedule: Schedule, attempt: number): number | null => {
  const n = Math.max(0, Math.floor(attempt));
  if (n < schedule.stepsMs.length) return schedule.stepsMs[n];
  return schedule.repeatMs;
};
