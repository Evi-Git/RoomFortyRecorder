import React from 'react';

/**
 * [RoomFortyRecorder] Resets: pulls so short they were a reset or an
 * accidental pull (audit X2). The Logs and Dashboard pull lists and the
 * Night summary table hide them unless "Show resets" is on. One switch for
 * every page, remembered on this PC. From 1.9.148 the guild server also
 * leaves resets out of its pull counts and numbers (a reset carries the
 * previous real pull's number and `reset: true`); older servers still number
 * them, so the app decides from `reset` or, failing that, the duration.
 */

/** Pulls shorter than this (seconds) are resets. */
export const RESET_SECONDS = 10;

/** A pull with no known duration is never treated as a reset. */
export const isReset = (pull: { duration?: number | null; reset?: boolean }) =>
  pull.reset === true ||
  (typeof pull.duration === 'number' && pull.duration < RESET_SECONDS);

/**
 * A pull's label: "Pull 3" (or `${prefix}3`), or "Reset" for a reset, which
 * has no number of its own. Works with old servers (no `reset` field).
 */
export const pullLabel = (
  p: { pullNumber: number; duration?: number | null; reset?: boolean },
  prefix = 'Pull ',
) => (isReset(p) ? 'Reset' : `${prefix}${p.pullNumber}`);

const KEY = 'rf-show-resets';
const listeners = new Set<() => void>();

const read = () => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

let current = read();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setShowResets = (on: boolean) => {
  current = on;
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Storage can be unavailable; the switch still works until restart.
  }
  listeners.forEach((l) => l());
};

/** `[showResets, setShowResets]`, in step across every page using it. */
export const useShowResets = (): [boolean, (on: boolean) => void] => {
  const on = React.useSyncExternalStore(subscribe, () => current);
  return [on, setShowResets];
};
