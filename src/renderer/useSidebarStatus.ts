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

/** Asks again when `signInState` changes (back online, signed in) and every 10 minutes. */
export const useServerCheck = (signInState: string): ServerCheck => {
  const [check, setCheck] = React.useState<ServerCheck>({ state: 'unknown' });

  React.useEffect(() => {
    let live = true;
    const ask = () =>
      (
        ipc.invoke('pullDesk', [{ action: 'serverHealth' }]) as Promise<
          Response<Health>
        >
      )
        .then((r) => {
          if (live)
            setCheck(r.ok ? checkServer(r.data.server) : { state: 'unknown' });
        })
        .catch(() => {
          if (live) setCheck({ state: 'unknown' });
        });
    ask();
    const timer = setInterval(ask, CHECK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [signInState]);

  return check;
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
