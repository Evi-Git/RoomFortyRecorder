import React from 'react';

/**
 * [RoomFortyRecorder] Resets: pulls so short they were a reset or an
 * accidental pull (audit X2). The Logs and Dashboard pull lists hide them
 * unless "Show resets" is on. One switch for both pages, remembered on this
 * PC. Only the lists change: the server's pull counts and numbers stay as
 * they are.
 */

/** Pulls shorter than this (seconds) are resets. */
export const RESET_SECONDS = 10;

/** A pull with no known duration is never treated as a reset. */
export const isReset = (pull: { duration?: number | null }) =>
  typeof pull.duration === 'number' && pull.duration < RESET_SECONDS;

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
