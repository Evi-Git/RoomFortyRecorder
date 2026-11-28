import React from 'react';
import { Button } from 'renderer/components/Button/Button';
import type { PullUploadState } from 'main/types';
import {
  describeBackfill,
  describeBackfillFailure,
  describeUpload,
} from './uploadLines';
import type { BackfillFailure } from 'main/backfillFailure';

/**
 * [RoomFortyRecorder] Under "Send my Logs": what happened to this PC's last
 * pull upload, and the last automatic check of saved combat logs.
 */

type Backfill = { at: number; uploaded: number; files: number } | null;
type State = {
  last: PullUploadState | null;
  backfill: Backfill;
  backfillFailure?: BackfillFailure | null;
};
type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const ipc = window.electron.ipcRenderer;

const TONES = {
  busy: 'text-brand animate-pulse',
  good: 'text-green-400',
  quiet: 'text-foreground',
  warn: 'text-yellow-400',
  bad: 'text-error-text',
} as const;

const UploadStatus = () => {
  const [state, setState] = React.useState<State | null>(null);

  React.useEffect(() => {
    let live = true;
    // A push that lands first beats the slower first answer.
    let pushed = false;
    (
      ipc.invoke('pullDesk', [{ action: 'uploadState' }]) as Promise<
        Response<State>
      >
    )
      .then((r) => live && !pushed && r.ok && setState(r.data))
      .catch(() => {});
    const unsubscribe = ipc.on('pullDeskUploadState', (next) => {
      pushed = true;
      if (live) setState(next as State);
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  const line = state?.last ? describeUpload(state.last) : null;
  const failure = state?.backfillFailure ?? null;
  const failureLine = describeBackfillFailure(failure);
  // A failure replaces the "checked at ..." line: that one would say "nothing
  // was missing" next to a problem.
  const backfill = failureLine
    ? null
    : describeBackfill(state?.backfill ?? null);
  // "Try now" is greyed out until the main process pushes a new state (its
  // pass ended), or 15 seconds, whichever comes first.
  const [waitingOn, setWaitingOn] = React.useState<State | null | undefined>(
    undefined,
  );
  const trying = waitingOn !== undefined && waitingOn === state;

  const tryNow = () => {
    setWaitingOn(state);
    ipc.invoke('pullDesk', [{ action: 'backfillNow' }]).catch(() => {});
    setTimeout(() => setWaitingOn(undefined), 15000);
  };

  if (!line && !backfill && !failureLine) {
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
      {failureLine && (
        <span className="flex flex-wrap items-center gap-x-2 text-error-text">
          {failureLine}
          {failure?.kind !== 'gaveUp' && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2"
              disabled={trying}
              onClick={tryNow}
            >
              {trying ? 'Checking…' : 'Try now'}
            </Button>
          )}
        </span>
      )}
    </div>
  );
};

export default UploadStatus;
