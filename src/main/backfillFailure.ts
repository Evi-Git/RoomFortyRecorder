/**
 * [RoomFortyRecorder] When the automatic backfill of saved combat logs
 * doesn't go well, what the app remembers so "Send my Logs" can say so. Pure,
 * so it can be tested. The raw reason is kept; the renderer words it through
 * friendlyError.
 */

export type BackfillFailureKind =
  | 'notSignedIn'
  | 'error'
  | 'someFailed'
  | 'gaveUp';

export type BackfillFailure = {
  kind: BackfillFailureKind;
  /** Epoch ms. */
  at: number;
  /** Raw reason (an error message), for friendlyError. */
  reason: string;
  /** Pulls (or files) affected, where that's known. */
  count?: number;
};

export type RunOutcome = {
  now: number;
  /** The error that stopped the run, if any. */
  error?: string;
  /** Pulls the server refused or that failed to send in this run. */
  failed: number;
  /** Files given up on after too many rechecks in this run. */
  gaveUp: number;
};

/**
 * What a finished automatic run leaves behind: null when it went fine (which
 * clears an older failure), else the failure to show. A pause (a pull started)
 * is not a failure: pass no `error` for it.
 */
export const failureAfterRun = (o: RunOutcome): BackfillFailure | null => {
  if (o.error) {
    return { kind: 'error', at: o.now, reason: o.error };
  }
  if (o.gaveUp > 0) {
    return {
      kind: 'gaveUp',
      at: o.now,
      reason: '',
      count: o.gaveUp,
    };
  }
  if (o.failed > 0) {
    return {
      kind: 'someFailed',
      at: o.now,
      reason: '',
      count: o.failed,
    };
  }
  return null;
};

/** The run could not start because the app isn't signed in to the guild. */
export const notSignedInFailure = (now: number): BackfillFailure => ({
  kind: 'notSignedIn',
  at: now,
  reason: 'Sign in with Discord in Cloud settings first.',
});

/**
 * A run that found nothing left to do (or was paused). Whatever was wrong
 * before is kept only when it is about a file we gave up on, which a quiet
 * run doesn't fix; the rest is cleared.
 */
export const failureAfterIdleRun = (
  prev: BackfillFailure | null,
): BackfillFailure | null => (prev?.kind === 'gaveUp' ? prev : null);
