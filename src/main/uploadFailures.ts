// Pure helpers for video uploads that did not go up: how to tell what went
// wrong in plain English, and the small list the app shows (with Try again and
// Dismiss). Nothing here touches Electron or the network.
import { classify, FailureClass } from './pullUploadRetry';
import { friendlyError } from '../renderer/friendlyError';

export type UploadFailureKind =
  | 'auth'
  | 'taken'
  | 'full'
  | 'stalled'
  | 'server'
  | 'file'
  | 'other';

export type UploadFailure = {
  id: string;
  /** The video file on this PC (what Try again queues). */
  path: string;
  /**
   * What did not go up. Absent means the video itself (older entries, and the
   * usual case). 'timeline': the video is up, only its spell timeline isn't,
   * and Try again sends just that.
   */
  what?: 'video' | 'timeline';
  /** For a timeline: the video's key on the guild server. */
  videoKey?: string;
  /** What to call it on screen. */
  name: string;
  kind: UploadFailureKind;
  message: string;
  /** Epoch ms. */
  at: number;
};

/** No bytes moved for too long; the attempt was cut off. */
export class StallError extends Error {
  public readonly code = 'ESTALLED';

  constructor(message = 'The upload stalled.') {
    super(message);
    this.name = 'StallError';
  }
}

export const isStall = (error: unknown) =>
  error instanceof StallError ||
  (error as { code?: unknown } | null)?.code === 'ESTALLED';

/** R2 answers a PUT that was too slow to arrive with 400 RequestTimeout. */
const isR2RequestTimeout = (error: unknown) => {
  const e = (error ?? {}) as ErrorLike;
  return (
    e.response?.status === 400 &&
    typeof e.response.data === 'string' &&
    e.response.data.includes('RequestTimeout')
  );
};

/** Retry stalls and network trouble; a 4xx from the server is final. */
export const classifyUpload = (error: unknown): FailureClass => {
  if (isStall(error) || isR2RequestTimeout(error)) return 'retry';
  return classify(error);
};

export const STALLED_TEXT =
  'The upload stalled. Check your connection and try again.';
export const SIGN_IN_TEXT =
  "Your sign-in can't upload. Sign in again or ask an officer.";
export const FULL_TEXT =
  "The guild's cloud storage is full (or this file is over the size limit). Ask an officer.";
export const LINK_EXPIRED_TEXT = 'The upload link expired. Try again.';
export const UNREACHABLE_TEXT =
  "Can't reach the guild server. It's retried when you press Try again.";
export const TAKEN_TEXT =
  'The guild server already has a recording here from someone else.';

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  isAxiosError?: unknown;
  config?: { url?: unknown };
  response?: { status?: unknown; data?: unknown };
};

const serverMessage = (e: ErrorLike): string => {
  const data = e.response?.data as { error?: unknown } | string | undefined;
  const text =
    data && typeof data === 'object' && typeof data.error === 'string'
      ? data.error
      : '';
  return text.trim();
};

const FILE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EISDIR']);

/** What went wrong, as a kind plus one sentence a raider can act on. */
export const describeUploadError = (
  error: unknown,
): { kind: UploadFailureKind; message: string } => {
  const e = (error ?? {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';

  if (isStall(error)) return { kind: 'stalled', message: STALLED_TEXT };

  const status =
    typeof e.response?.status === 'number' ? e.response.status : undefined;
  const server = serverMessage(e);

  if (status !== undefined) {
    if (status === 401) return { kind: 'auth', message: SIGN_IN_TEXT };
    if (status === 403) {
      // The guild server always explains a refusal in JSON. A bare 403 came
      // from R2: the signed link has expired.
      return server
        ? { kind: 'auth', message: server }
        : { kind: 'other', message: LINK_EXPIRED_TEXT };
    }
    if (status === 409) return { kind: 'taken', message: server || TAKEN_TEXT };
    if (status === 413) {
      // The server's own text is plain; only translate the storage limit.
      return {
        kind: 'full',
        message: !server || /storage limit/i.test(server) ? FULL_TEXT : server,
      };
    }
    if (status === 408 || status === 429 || status >= 500) {
      return {
        kind: 'server',
        message: `The guild server had a problem (${status}). Try again in a minute.`,
      };
    }
    return {
      kind: 'other',
      message: friendlyError(server || String(e.message)),
    };
  }

  if (FILE_CODES.has(code)) {
    return {
      kind: 'file',
      message: "The recording file couldn't be read from this PC.",
    };
  }

  // No answer at all: a dropped or timed-out connection. A transfer to R2
  // (a signed link) reads as stalled; the guild server's own calls as
  // unreachable.
  if (e.isAxiosError === true || /timeout|timed out/i.test(String(e.message))) {
    const url = typeof e.config?.url === 'string' ? e.config.url : '';
    return url.includes('X-Amz-')
      ? { kind: 'stalled', message: STALLED_TEXT }
      : { kind: 'server', message: UNREACHABLE_TEXT };
  }

  return { kind: 'other', message: friendlyError(String(e.message ?? error)) };
};

/** Plain English for a spell timeline that did not go up with its video. */
export const describeTimelineError = (
  error: unknown,
): { kind: UploadFailureKind; message: string } => {
  const { kind, message } = describeUploadError(error);
  return {
    kind,
    message: `The video is up, but its spell timeline isn't. ${message}`,
  };
};

/** What Try again does for a failure: the whole video, or just the timeline. */
export const retryTarget = (f: Pick<UploadFailure, 'what'>) =>
  f.what === 'timeline' ? 'timeline' : 'video';

// ---- The list --------------------------------------------------------

/** Only the newest failures are kept. */
export const MAX_FAILURES = 20;

export const failureId = (path: string, at: number) => `${at}|${path}`;

/** Newest first; a new failure for a file replaces its older one. */
export const addFailure = (
  list: readonly UploadFailure[],
  failure: UploadFailure,
  max = MAX_FAILURES,
): UploadFailure[] =>
  [failure, ...list.filter((f) => f.path !== failure.path)].slice(0, max);

export const removeFailure = (
  list: readonly UploadFailure[],
  id: string,
): UploadFailure[] => list.filter((f) => f.id !== id);

/** A file that uploads now no longer has a failure. */
export const removeFailureForPath = (
  list: readonly UploadFailure[],
  path: string,
): UploadFailure[] => list.filter((f) => f.path !== path);

type NameInput = {
  encounterName?: string;
  difficulty?: string;
  zoneName?: string;
  category?: string;
};

/** "Ula'tek (Heroic)", else the zone, else the file name without .mp4. */
export const uploadName = (
  meta: NameInput | null | undefined,
  filePath: string,
): string => {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const file = base.replace(/\.mp4$/i, '');
  if (meta?.encounterName) {
    return meta.difficulty
      ? `${meta.encounterName} (${meta.difficulty})`
      : meta.encounterName;
  }
  return meta?.zoneName || file;
};
