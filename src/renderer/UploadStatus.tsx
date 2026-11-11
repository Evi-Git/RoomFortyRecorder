import React from 'react';
import type { PullUploadState } from 'main/types';
import { describeBackfill, describeUpload } from './uploadLines';

/**
 * [RoomFortyRecorder] Under "Send my Logs": what happened to this PC's last
 * pull upload, and the last automatic check of saved combat logs.
 */

type Backfill = { at: number; uploaded: number; files: number } | null;
type State = { last: PullUploadState | null; backfill: Backfill };
type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const ipc = window.electron.ipcRenderer;

const TONES = {
  busy: 'text-brand animate-pulse',
  good: 'text-green-400',
  quiet: 'text-foreground',
  warn: 'text-yellow-400',
  bad: 'text-red-400',
} as const;

const UploadStatus = () => {
  const [state, setState] = React.useState<State | null>(null);

  React.useEffect(() => {
    let live = true;
    (
      ipc.invoke('pullDesk', [{ action: 'uploadState' }]) as Promise<
        Response<State>
      >
    )
      .then((r) => live && r.ok && setState(r.data))
      .catch(() => {});
    const unsubscribe = ipc.on('pullDeskUploadState', (next) => {
      if (live) setState(next as State);
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  const line = state?.last ? describeUpload(state.last) : null;
  const backfill = describeBackfill(state?.backfill ?? null);
  if (!line && !backfill) {
    return (
      <p className="text-xs text-foreground m-0" data-state="idle">
        No pulls sent since the app started.
      </p>
    );
  }
  return (
    <div
      className="flex flex-col gap-y-0.5 text-xs"
      data-state={state?.last?.state ?? 'idle'}
    >
      {line && <span className={TONES[line.tone]}>{line.text}</span>}
      {backfill && <span className="text-foreground">{backfill}</span>}
    </div>
  );
};

export default UploadStatus;
