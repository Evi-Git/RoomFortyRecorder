/**
 * [RoomFortyRecorder] When a scheduled automatic backfill may start. Pure.
 * The first run is 2 minutes after launch, then every 30 minutes; it parses
 * whole combat log files, so it waits for the app to be idle.
 */

/** Try again this soon when the app is busy at the scheduled time. */
export const BACKFILL_BUSY_RETRY_MS = 60_000;

export type BackfillDecision = 'skip' | 'later' | 'run';

/**
 * - skip: "Send my Logs" is off, so nothing to do until the next tick.
 * - later: capturing a pull, recording, uploading a video, going live...
 *   (the same reasons that hold back an update): try again in a minute.
 * - run: go.
 */
export const backfillDecision = (input: {
  enabled: boolean;
  capturing: boolean;
  busyReason: string | null;
}): BackfillDecision => {
  if (!input.enabled) return 'skip';
  if (input.capturing || input.busyReason !== null) return 'later';
  return 'run';
};
