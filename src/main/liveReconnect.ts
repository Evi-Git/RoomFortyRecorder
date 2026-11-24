// [RoomFortyRecorder] Pure rules for Go live: what to tell the raider and
// whether to try again when the stream stops on its own. Nothing here
// touches Electron, OBS or the network, so it can be tested on its own.
import { classifyFailure } from './signInState';

/** Wait before reconnect try 1, 2, 3...; the last value repeats. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 15_000, 30_000];

/** Stop trying this long after the stream dropped. */
export const GIVE_UP_AFTER_MS = 5 * 60_000;

/**
 * A stream that never went live (the first connect failed) gets only a few
 * tries: something is more likely wrong than a passing network blip.
 */
export const FIRST_CONNECT_TRIES = 3;

/**
 * MediaMTX turning the stream down (anything but a sign-in refusal) usually
 * means it still holds the raider's last stream after a drop; that clears
 * within about half a minute, so a few spaced tries get past it.
 */
export const REFUSED_TRIES = 5;

/** The encoder failing can be a passing GPU hiccup; one more try. */
export const ENCODER_TRIES = 1;

/** OBS_OUTPUT_* stop codes from libobs. */
export const OBS = {
  SUCCESS: 0,
  BAD_PATH: -1,
  CONNECT_FAILED: -2,
  INVALID_STREAM: -3,
  ERROR: -4,
  DISCONNECTED: -5,
  UNSUPPORTED: -6,
  NO_SPACE: -7,
  ENCODE_ERROR: -8,
} as const;

export const SIGN_IN_AGAIN =
  'Your Discord sign-in expired. Sign in again in Cloud settings, then go live.';

/** The HTTP status in OBS's WHIP error text ("... response code 401"), if any. */
export const httpStatusIn = (error?: string): number | undefined => {
  const match = /\b([45]\d\d)\b/.exec(error ?? '');
  return match ? Number(match[1]) : undefined;
};

/** Why the stream stopped, for a raider. */
export const describeStopCode = (code: number, error?: string): string => {
  if (code === OBS.INVALID_STREAM) {
    const status = httpStatusIn(error);
    if (status === 401 || status === 403) {
      return "The live server didn't accept your sign-in. Sign in again in Cloud settings, then go live.";
    }
    return 'The live server turned the stream down. If you were just live, it may still be holding your last stream: wait a minute, then go live again.';
  }

  const reasons: Record<number, string> = {
    [OBS.BAD_PATH]: 'The live server address is wrong. Tell an officer.',
    [OBS.CONNECT_FAILED]: 'Couldn’t connect to the live server.',
    [OBS.ERROR]: 'The live server stopped the stream.',
    [OBS.DISCONNECTED]: 'The connection to the live server dropped.',
    [OBS.UNSUPPORTED]: 'This PC can’t stream with these Go live settings.',
    [OBS.NO_SPACE]: 'Not enough disk space.',
    [OBS.ENCODE_ERROR]: 'The stream encoder failed.',
  };

  return reasons[code] || `The stream stopped unexpectedly (code ${code}).`;
};

export type StopContext = {
  code: number;
  error?: string;
  /** Reconnect tries already made since the drop (0 on the first stop). */
  tries: number;
  /** Time since the stream first dropped (0 on the first stop). */
  msSinceDrop: number;
  /** Whether this stream was live at least once since Go live was pressed. */
  everLive: boolean;
  /** Overrides the reason worked out from the code (e.g. the guild server didn't answer). */
  reason?: string;
};

export type StopDecision =
  | { retry: true; delayMs: number; note: string }
  | { retry: false; message: string };

export const retryDelayMs = (tries: number) =>
  RETRY_DELAYS_MS[Math.min(Math.max(0, tries), RETRY_DELAYS_MS.length - 1)];

const triesLabel = (tries: number) =>
  `Gave up after ${tries} ${tries === 1 ? 'try' : 'tries'}; press Go live to try again.`;

const retrying = (everLive: boolean, tries: number) => {
  const next = tries + 1;
  return everLive
    ? `Connection dropped. Reconnecting (try ${next})…`
    : `Couldn’t connect yet. Trying again (try ${next})…`;
};

/** What to do after the engine stopped the stream with a non-zero code. */
export const afterStop = (ctx: StopContext): StopDecision => {
  const { code, error, tries, msSinceDrop, everLive } = ctx;
  const reason = ctx.reason ?? describeStopCode(code, error);
  const giveUp = (): StopDecision => ({
    retry: false,
    message: tries > 0 ? `${reason} ${triesLabel(tries)}` : reason,
  });

  // Nothing a retry can fix.
  if (
    code === OBS.BAD_PATH ||
    code === OBS.UNSUPPORTED ||
    code === OBS.NO_SPACE
  ) {
    return { retry: false, message: reason };
  }

  if (code === OBS.INVALID_STREAM) {
    const status = httpStatusIn(error);
    // A refused sign-in is checked again with the guild server before each
    // try, so one more is enough to tell a hiccup from a real refusal.
    const limit = status === 401 || status === 403 ? 1 : REFUSED_TRIES;
    if (tries >= limit) return giveUp();
  }

  if (code === OBS.ENCODE_ERROR && tries >= ENCODER_TRIES) return giveUp();
  // A refusal on the first connect is often the last stream still held
  // after a crash, so it keeps its own (longer) limit above.
  if (
    !everLive &&
    code !== OBS.INVALID_STREAM &&
    tries >= FIRST_CONNECT_TRIES
  ) {
    return giveUp();
  }
  if (msSinceDrop >= GIVE_UP_AFTER_MS) return giveUp();

  return {
    retry: true,
    delayMs: retryDelayMs(tries),
    note: retrying(everLive, tries),
  };
};

export type PublishFailure =
  | { retry: true }
  | { retry: false; message: string };

/**
 * The guild server's answer to "where do I stream" failed. No answer at all
 * (or a 5xx/429) is worth another try while reconnecting; an expired or
 * refused sign-in, or live streaming not being set up, is not.
 */
export const afterPublishFailure = (error: unknown): PublishFailure => {
  const status = (error as { response?: { status?: unknown } })?.response
    ?.status;
  if (status === 404) {
    return {
      retry: false,
      message: 'Live streaming is not set up on the guild server yet.',
    };
  }

  const failure = classifyFailure(error);
  if (failure.kind === 'offline') return { retry: true };
  if (failure.kind === 'expired')
    return { retry: false, message: SIGN_IN_AGAIN };
  return {
    retry: false,
    message: `The guild server won't let you go live: ${failure.reason}`,
  };
};

/** The guild server didn't answer (or answered with a 5xx/429). */
export const unreachableMessage = (error: unknown) => {
  const e = (error ?? {}) as {
    code?: unknown;
    response?: { status?: unknown };
  };
  const status = e.response?.status;
  if (typeof status === 'number') {
    return status === 429
      ? 'The guild server asked to slow down. Try again in a minute.'
      : `The guild server had a problem (${status}).`;
  }
  return typeof e.code === 'string' && e.code
    ? `Couldn't reach the guild server (${e.code}).`
    : "Couldn't reach the guild server.";
};
