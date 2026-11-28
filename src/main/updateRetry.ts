import { UPDATE_SCHEDULE, delayFor } from './retrySchedule';
import { mayDownloadUpdate } from './busyLogic';

/**
 * [RoomFortyRecorder] When the updater retries after an error. Pure, so the
 * decisions can be tested without Electron or timers.
 */

/** Wait this long again when a retry comes due while the app is busy. */
export const BUSY_RECHECK_MS = 60_000;

/**
 * The wait before the next automatic retry after the `attempt`-th error in a
 * row (0 = the first error), or null when automatic retries are used up (the
 * normal daily check takes over) or the failed run was a manual one (the
 * user is looking at the answer and can press the button again).
 */
export const nextRetryDelay = (
  attempt: number,
  manual: boolean,
): number | null => (manual ? null : delayFor(UPDATE_SCHEDULE, attempt));

export type RetryAction = 'run' | 'later' | 'skip';

/**
 * What a retry that has come due does. `skip`: a check or download is
 * already running or done, so starting another would double it. `later`:
 * busy (a pull, a recording, an upload...), try again shortly without using
 * up an attempt. `run`: check now.
 */
export const retryAction = (
  state: string,
  busyReason: string | null,
): RetryAction => {
  if (state === 'checking' || state === 'downloading' || state === 'ready') {
    return 'skip';
  }
  return mayDownloadUpdate(busyReason, false) ? 'run' : 'later';
};
