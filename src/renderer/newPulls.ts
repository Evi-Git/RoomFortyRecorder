import React from 'react';

/**
 * [RoomFortyRecorder] "2 new" next to Dashboard in the sidebar: pulls that
 * came in since this PC last had the Dashboard open. Checked every minute
 * and right after this PC sends a pull.
 */

const SEEN_KEY = 'rf-dashboard-seen';
const CHECK_EVERY_MS = 60 * 1000;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };
type Summary = { id: string; createdAt: number };

/** Pulls created after `seenAt` (0 = never opened: count none). */
export const countNew = (pulls: Summary[], seenAt: number) =>
  seenAt ? pulls.filter((p) => p.createdAt > seenAt).length : 0;

const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
};

const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Counted again next time.
  }
};

/** How many new pulls; `onDashboard` marks them seen. */
export const useNewPulls = (enabled: boolean, onDashboard: boolean) => {
  // Tonight's pulls from the last check; counted against the last visit.
  const [pulls, setPulls] = React.useState<Summary[]>([]);
  const onDashboardRef = React.useRef(onDashboard);

  React.useEffect(() => {
    // On the Dashboard, or just leaving it: everything so far is seen.
    if (onDashboard || onDashboardRef.current) markSeen();
    onDashboardRef.current = onDashboard;
  }, [onDashboard]);

  React.useEffect(() => {
    if (!enabled) return undefined;
    const ipc = window.electron.ipcRenderer;
    let live = true;
    const check = () => {
      if (onDashboardRef.current) {
        markSeen();
        return;
      }
      (
        ipc.invoke('pullDesk', [{ action: 'list', days: 1 }]) as Promise<
          Response<{ pulls: Summary[] }>
        >
      )
        .then((r) => {
          if (live && r.ok) setPulls(r.data.pulls);
        })
        .catch(() => {});
    };
    // The first visit counts from now, not from the beginning of time.
    if (!readSeen()) markSeen();
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const unsubscribe = ipc.on('pullDeskUpdated', check);
    return () => {
      live = false;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [enabled]);

  // On the Dashboard everything is seen.
  return onDashboard ? 0 : countNew(pulls, readSeen());
};
