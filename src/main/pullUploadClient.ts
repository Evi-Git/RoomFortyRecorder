import CloudClient from 'storage/CloudClient';
import {
  NOT_READY_CODE,
  RetryInfo,
  RetryOptions,
  withRetry,
} from './pullUploadRetry';

/** Thrown as `code` when the sign-in needs the user, so retrying is pointless. */
export const NOT_SIGNED_IN_CODE = 'NOT_SIGNED_IN';

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A short reason for a log line. */
export const reasonOf = (error: unknown): string => {
  const e = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    response?: { status?: unknown };
  };
  if (typeof e.response?.status === 'number') return `${e.response.status}`;
  if (typeof e.code === 'string') return e.code;
  return String(e.message ?? error);
};

/**
 * Wait (up to 30 s) for a sign-in check in progress, then make sure pull desk
 * calls can be made. If not: retryable while the guild server is just
 * unreachable, otherwise it needs the user.
 */
export const ensureReady = async (client: CloudClient) => {
  if (!client.pullDeskReady()) await client.waitForSignIn(30_000);
  if (client.pullDeskReady()) return;
  const { state } = client.signInSnapshot();
  const waiting = state === 'offline' || state === 'connecting';
  throw Object.assign(new Error('The guild server is not ready'), {
    code: waiting ? NOT_READY_CODE : NOT_SIGNED_IN_CODE,
  });
};

/**
 * One pull desk request with the retry policy (pullUploadRetry): network
 * trouble, 429 and 5xx are retried with backoff, a 401 waits for the sign-in
 * check, any other 4xx is thrown at once. One log line per failed attempt.
 */
export const sendWithRetry = <T>(
  client: CloudClient,
  label: string,
  request: () => Promise<T>,
  options: {
    onRetry?: (info: RetryInfo) => void;
    maxElapsedMs?: number;
    classify?: RetryOptions['classify'];
    shouldStop?: () => boolean;
  } = {},
): Promise<T> => {
  const retry: RetryOptions = {
    sleep,
    maxElapsedMs: options.maxElapsedMs,
    classify: options.classify,
    shouldStop: options.shouldStop,
    onAuth: async () => {
      await client.waitForSignIn(30_000);
      return client.pullDeskReady();
    },
    onRetry: (info) => {
      console.warn(
        `[PullDesk] ${label}: attempt ${info.attempt} failed (${reasonOf(info.error)}), ` +
          (info.kind === 'auth'
            ? 'waiting for sign-in'
            : `retrying in ${Math.round(info.delayMs / 1000)} s`),
      );
      options.onRetry?.(info);
    },
  };
  return withRetry(async () => {
    await ensureReady(client);
    return request();
  }, retry);
};
