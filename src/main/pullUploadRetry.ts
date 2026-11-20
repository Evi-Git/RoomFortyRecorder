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

const isTimeout = (error: unknown): boolean => {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    e.code === 'ECONNABORTED' ||
    e.code === 'ETIMEDOUT' ||
    /timeout/i.test(String(e.message ?? ''))
  );
};

/** A request that timed out may still have reached the server. */
export { isTimeout };

/**
 * The report PUT is not repeated after a timeout or a plain 500: the server
 * may have stored the log and be analysing it, and a second copy would run a
 * second analysis and a second Discord post. Only failures where nothing
 * reached the server (no answer before the connection dropped, 429, 502, 503,
 * 504) are retried; a 401 still waits for the sign-in.
 */
export const classifyReportPut = (error: unknown): FailureClass => {
  const kind = classify(error);
  if (kind !== 'retry') return kind;
  const status = (error as ErrorLike | undefined)?.response?.status;
  if (typeof status === 'number') {
    return [429, 502, 503, 504].includes(status) ? 'retry' : 'fatal';
  }
  return isTimeout(error) ? 'fatal' : 'retry';
};

/** Whether giving up on this error should leave the pull waiting for later. */
export const isRetryable = (error: unknown): boolean =>
  classify(error) === 'retry';

/** Wait before retry number `attempt` (1 is the first retry). */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

/** Milliseconds to wait, or null once the retries are used up (5+15+45+120+300 s of waiting, plus the time each
 * attempt itself takes). */
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
  /** Which errors to retry; the default is `classify`. */
  classify?: (error: unknown) => FailureClass;
  /** Checked during waits: true throws the last error (the app is busy). */
  shouldStop?: () => boolean;
  /** Stop retrying if the next wait would pass this many ms since the start. */
  maxElapsedMs?: number;
  now?: () => number;
};

/** Sleep in short slices so `shouldStop` is noticed within a few seconds. */
export const sleepUnlessStopped = async (
  ms: number,
  sleep: (ms: number) => Promise<void>,
  shouldStop?: () => boolean,
  slice = 5_000,
) => {
  if (!shouldStop) {
    await sleep(ms);
    return;
  }
  let left = ms;
  while (left > 0 && !shouldStop()) {
    const step = Math.min(slice, left);

    await sleep(step);
    left -= step;
  }
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
      const kind = (options.classify ?? classify)(error);
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
        await sleepUnlessStopped(delayMs, options.sleep, options.shouldStop);
        if (options.shouldStop?.()) throw error;
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

/** Drop the pulls too old to be worth sending. */
export const prune = <T>(
  queue: readonly QueueEntry<T>[],
  now: number,
): { queue: QueueEntry<T>[]; dropped: QueueEntry<T>[] } => ({
  queue: queue.filter((e) => now - e.at <= QUEUE_MAX_AGE_MS),
  dropped: queue.filter((e) => now - e.at > QUEUE_MAX_AGE_MS),
});

/**
 * The oldest pull still worth sending, and what is left behind it. Pulls in
 * `skip` (already tried in this pass) are left in the queue, so a pull that
 * fails again and is put back is not retried in a tight loop.
 */
export const takeNext = <T>(
  queue: readonly QueueEntry<T>[],
  now: number,
  skip: ReadonlySet<T> = new Set(),
): {
  next: QueueEntry<T> | null;
  queue: QueueEntry<T>[];
  dropped: QueueEntry<T>[];
} => {
  const { queue: fresh, dropped } = prune(queue, now);
  fresh.sort((a, b) => a.at - b.at);
  const i = fresh.findIndex((e) => !skip.has(e.item));
  if (i < 0) return { next: null, queue: fresh, dropped };
  const [next] = fresh.splice(i, 1);
  return { next, queue: fresh, dropped };
};

/** The automatic backfill gives up on a file after this many rechecks. */
export const MAX_FILE_RECHECKS = 3;

/**
 * Rechecks of one saved log file, kept in the backfill's "done" map as
 * "<file key>|<n>" so a changed file starts again. Returns the new value to
 * store and whether to stop rechecking this file.
 */
export const recordRecheck = (
  stored: string | undefined,
  fileKey: string,
  max = MAX_FILE_RECHECKS,
): { value: string; giveUp: boolean } => {
  const [key, n] = (stored ?? '').split('|');
  const tries = (key === fileKey ? Number(n) || 0 : 0) + 1;
  return { value: `${fileKey}|${tries}`, giveUp: tries >= max };
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
