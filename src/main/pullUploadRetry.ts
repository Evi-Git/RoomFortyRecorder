// Pure retry policy and waiting-queue model for pull uploads. Nothing here
// touches Electron, the network or the config, so it can be tested alone.
import { NETWORK_CODES } from './signInState';

export type FailureClass = 'retry' | 'auth' | 'fatal';

/** Thrown (as `code`) by the caller when the guild connection isn't ready. */
export const NOT_READY_CODE = 'NOT_READY';

type ErrorLike = {
  code?: unknown;
  isAxiosError?: unknown;
  response?: { status?: unknown };
};

/**
 * What to do about a failed pull request:
 * - retry: the network or the server is having a moment (no answer, 408, 429,
 *   5xx) so try again later;
 * - auth: a 401, so wait for the sign-in to be checked, then try again;
 * - fatal: the server said no (400, 403, 404, 409, 413...); waiting won't help.
 */
export const classify = (error: unknown): FailureClass => {
  const e = (error ?? {}) as ErrorLike;
  const status =
    typeof e.response?.status === 'number' ? e.response.status : undefined;

  if (status === undefined) {
    const code = typeof e.code === 'string' ? e.code : '';
    if (code === NOT_READY_CODE || NETWORK_CODES.has(code)) return 'retry';
    // An axios error with no response is a network failure; anything else
    // (a bug, a gzip failure) won't fix itself.
    return e.isAxiosError === true ? 'retry' : 'fatal';
  }

  if (status === 401) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'fatal';
};

/** Wait before retry number `attempt` (1 is the first retry). */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

/** Milliseconds to wait, or null once the retries are used up (~7 min). */
export const nextDelay = (attempt: number): number | null => {
  const i = Math.floor(attempt) - 1;
  if (!Number.isFinite(i) || i < 0) return RETRY_DELAYS_MS[0];
  return i < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[i] : null;
};

export type RetryInfo = {
  attempt: number;
  delayMs: number;
  kind: FailureClass;
  error: unknown;
};

export type RetryOptions = {
  sleep: (ms: number) => Promise<void>;
  /** Called before each wait, for status and one log line per attempt. */
  onRetry?: (info: RetryInfo) => void;
  /**
   * After a 401: wait for the sign-in check and say whether the connection is
   * usable again. If not, the 401 is thrown.
   */
  onAuth?: () => Promise<boolean>;
  /** Stop retrying if the next wait would pass this many ms since the start. */
  maxElapsedMs?: number;
  now?: () => number;
};

/** Run `fn`, retrying what `classify` calls retryable, within the schedule. */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const now = options.now ?? Date.now;
  const started = now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const kind = classify(error);
      if (kind === 'fatal') throw error;
      const delayMs = kind === 'auth' ? 0 : nextDelay(attempt);
      if (delayMs === null || (kind === 'auth' && attempt > 2)) throw error;
      if (
        options.maxElapsedMs !== undefined &&
        now() - started + delayMs > options.maxElapsedMs
      ) {
        throw error;
      }
      options.onRetry?.({ attempt, delayMs, kind, error });
      if (kind === 'auth') {
        if (!options.onAuth || !(await options.onAuth())) throw error;
      } else {
        await options.sleep(delayMs);
      }
    }
  }
};

// ---- Pulls waiting for the guild server to come back --------------------

/** Pulls older than this are left to the automatic backfill. */
export const QUEUE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** At most this many pulls wait; the oldest are dropped first. */
export const QUEUE_MAX_PULLS = 20;

export type QueueEntry<T> = {
  /** When the pull finished (epoch ms); the oldest goes first. */
  at: number;
  item: T;
};

/** Add a pull, drop the expired, and keep the newest QUEUE_MAX_PULLS. */
export const enqueue = <T>(
  queue: readonly QueueEntry<T>[],
  entry: QueueEntry<T>,
  now: number,
): { queue: QueueEntry<T>[]; dropped: QueueEntry<T>[] } => {
  const all = [...queue, entry].sort((a, b) => a.at - b.at);
  const dropped = all.filter((e) => now - e.at > QUEUE_MAX_AGE_MS);
  let kept = all.filter((e) => now - e.at <= QUEUE_MAX_AGE_MS);
  if (kept.length > QUEUE_MAX_PULLS) {
    dropped.push(...kept.slice(0, kept.length - QUEUE_MAX_PULLS));
    kept = kept.slice(kept.length - QUEUE_MAX_PULLS);
  }
  return { queue: kept, dropped };
};

/** The oldest pull still worth sending, and what is left behind it. */
export const takeNext = <T>(
  queue: readonly QueueEntry<T>[],
  now: number,
): {
  next: QueueEntry<T> | null;
  queue: QueueEntry<T>[];
  dropped: QueueEntry<T>[];
} => {
  const sorted = [...queue].sort((a, b) => a.at - b.at);
  const dropped = sorted.filter((e) => now - e.at > QUEUE_MAX_AGE_MS);
  const fresh = sorted.filter((e) => now - e.at <= QUEUE_MAX_AGE_MS);
  return { next: fresh[0] ?? null, queue: fresh.slice(1), dropped };
};

/**
 * Two pulls can overlap, and a retry of an older one must not overwrite the
 * status of a newer one. The status shown belongs to the newest pull (by when
 * it started); an update for the same pull always shows.
 */
export const mayShowStatus = (
  shown: { startedAt: number } | null | undefined,
  update: { startedAt: number },
): boolean => !shown || update.startedAt >= shown.startedAt;
