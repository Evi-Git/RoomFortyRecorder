/**
 * [RoomFortyRecorder] "Open in Logs": another page (the Dashboard) asks the
 * next Logs page that opens to show one pull. The caller sets the target,
 * then opens a Logs tab; the Logs page takes the target once, on mount.
 * A target older than a few seconds is ignored, so a Logs tab opened much
 * later from the sidebar doesn't jump to an old pull.
 */

export type LogsTarget = {
  /** The raid night, `YYYY-MM-DD`, as the guild server names nights. */
  night: string;
  /** The pull's id on the guild server. */
  pullId: string;
};

const MAX_AGE_MS = 5000;

let pending: { target: LogsTarget; at: number } | null = null;

export const setLogsTarget = (target: LogsTarget) => {
  pending = { target, at: Date.now() };
};

/** The target, if one was set in the last few seconds; clears it. */
export const takeLogsTarget = (): LogsTarget | null => {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.at > MAX_AGE_MS) return null;
  return p.target;
};
