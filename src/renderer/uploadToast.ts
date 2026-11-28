/**
 * [RoomFortyRecorder] Failed video uploads toast once; when several fail in a
 * row (the guild server went down mid-raid) they share one toast that counts
 * instead of stacking. Pure so it can be tested.
 */

/** Failures within this long of the last one join its toast. */
export const TOAST_WINDOW_MS = 2 * 60 * 1000;

export type Tally = { at: number; count: number };

export const nextTally = (prev: Tally | null, now: number): Tally =>
  prev && now - prev.at < TOAST_WINDOW_MS
    ? { at: now, count: prev.count + 1 }
    : { at: now, count: 1 };

export const failureToastText = (
  count: number,
  failure: { name?: string; message?: string; what?: string },
) =>
  count <= 1 && failure.what === 'timeline'
    ? {
        title: 'A spell timeline did not upload',
        description: `${failure.name ?? 'A recording'}: ${failure.message ?? "The video is up, but its spell timeline isn't."}`,
      }
    : count <= 1
      ? {
          title: 'A recording did not upload',
          description: `${failure.name ?? 'A recording'}: ${failure.message ?? 'The upload failed.'}`,
        }
      : {
          title: `${count} recordings did not upload`,
          description:
            'The Cloud status in the sidebar lists them, with Try again.',
        };
