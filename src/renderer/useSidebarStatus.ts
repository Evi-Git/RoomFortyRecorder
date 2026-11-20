import React from 'react';
import type { PullUploadState } from 'main/types';
import { checkServer, ServerCheck } from './serverVersion';

/**
 * [RoomFortyRecorder] Live data for the sidebar's status card: the guild
 * server's version (its /health) and the last pull this PC sent.
 */

type Response<T> = { ok: true; data: T } | { ok: false; error: string };
type Health = { server: string | null; app: string };
type UploadState = { last: PullUploadState | null; backfill: unknown };

const ipc = window.electron.ipcRenderer;
const CHECK_EVERY_MS = 10 * 60 * 1000;

// One /health poll for everything that shows the server version (the
// sidebar card and the "needs an update" notice).
let serverCheck: ServerCheck = { state: 'unknown' };
const serverListeners = new Set<(c: ServerCheck) => void>();
let serverTimer: ReturnType<typeof setInterval> | null = null;
let serverInFlight: Promise<void> | null = null;

const refreshServerCheck = () => {
  serverInFlight ??= (
    ipc.invoke('pullDesk', [{ action: 'serverHealth' }]) as Promise<
      Response<Health>
    >
  )
    .then((r) => (r.ok ? checkServer(r.data.server) : { state: 'unknown' }))
    .catch(() => ({ state: 'unknown' }))
    .then((next) => {
      serverCheck = next as ServerCheck;
      serverListeners.forEach((l) => l(serverCheck));
    })
    .finally(() => {
      serverInFlight = null;
    });
};

/**
 * The guild server's version check. Asks again when `signInState` changes
 * (back online, signed in) and every 10 minutes, shared by all callers.
 */
export const useServerCheck = (signInState = ''): ServerCheck => {
  const [check, setCheck] = React.useState<ServerCheck>(serverCheck);

  React.useEffect(() => {
    serverListeners.add(setCheck);
    serverTimer ??= setInterval(refreshServerCheck, CHECK_EVERY_MS);
    return () => {
      serverListeners.delete(setCheck);
      if (serverListeners.size === 0 && serverTimer) {
        clearInterval(serverTimer);
        serverTimer = null;
      }
    };
  }, []);

  React.useEffect(() => {
    refreshServerCheck();
  }, [signInState]);

  return check;
};

/** How many uploads gave up (the same list the card's hover shows). */
export const useUploadFailureCount = (): number => {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    const apply = (list: unknown) => {
      if (live && Array.isArray(list)) setCount(list.length);
    };
    ipc
      .invoke('uploadFailureAction', [{ action: 'list' }])
      .then(apply)
      .catch(() => {});
    const unsubscribe = ipc.on('uploadFailures', apply);
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  return count;
};

/** The last pull upload's state, kept current by the main process. */
export const useLastPull = (): PullUploadState | null => {
  const [last, setLast] = React.useState<PullUploadState | null>(null);

  React.useEffect(() => {
    let live = true;
    (
      ipc.invoke('pullDesk', [{ action: 'uploadState' }]) as Promise<
        Response<UploadState>
      >
    )
      .then((r) => live && r.ok && setLast(r.data.last ?? null))
      .catch(() => {});
    const unsubscribe = ipc.on('pullDeskUploadState', (next) => {
      if (live) setLast((next as UploadState).last ?? null);
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  return last;
};
