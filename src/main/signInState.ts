// Pure helpers for the guild sign-in state. Nothing here touches Electron,
// the network or the config, so it can be tested on its own.
/** Why the server turned a sign-in down for a reason we can't fix by waiting. */
export type FailureKind = 'offline' | 'expired' | 'refused';

export type SignInFailure = {
  kind: FailureKind;
  /** Plain-English reason, from the server where it gave one. */
  reason: string;
};

/**
 * The two 401 messages the server sends for the session itself
 * (guild-cloud-server/server.mjs, `authorized`). Any other 401 message comes
 * from the role check, so the session is fine and the account isn't allowed.
 */
export const SESSION_MESSAGES = [
  'Discord sign-in required',
  'Invalid or expired Discord session',
];

export const NOT_AFFILIATED_REASON =
  "Your Discord account isn't in the Room Forty guild.";

export const CANNOT_UPLOAD_REASON =
  "Your Discord role can't upload to the guild.";

export const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ERR_NETWORK',
]);

const OFFLINE_STATUSES = new Set([502, 503, 504]);

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: unknown };
};

const messageFromBody = (data: unknown): string => {
  if (typeof data === 'string') return data.trim();
  if (data && typeof data === 'object') {
    const { error, message } = data as { error?: unknown; message?: unknown };
    if (typeof error === 'string') return error.trim();
    if (typeof message === 'string') return message.trim();
  }
  return '';
};

/**
 * Sort a failed request into offline (try again later), expired (the session
 * is no good) or refused (signed in but not allowed). Takes anything thrown by
 * axios, or a bare `{ status, body }` for a response we already hold.
 */
export const classifyFailure = (error: unknown): SignInFailure => {
  const e = (error ?? {}) as ErrorLike;
  const status =
    typeof e.response?.status === 'number' ? e.response.status : undefined;
  const code = typeof e.code === 'string' ? e.code : '';

  if (status === undefined) {
    // No answer from the server at all: DNS, refused, reset, timeout, or
    // something thrown before a request was made.
    const known = NETWORK_CODES.has(code);
    return {
      kind: 'offline',
      reason: known ? `Network error (${code})` : "Couldn't reach the server",
    };
  }

  // 408 (request timeout) and 429 (slow down) pass with time.
  if (
    OFFLINE_STATUSES.has(status) ||
    status >= 500 ||
    status === 408 ||
    status === 429
  ) {
    return { kind: 'offline', reason: `Server error (${status})` };
  }

  const body = messageFromBody(e.response?.data);

  if (status === 401) {
    if (body && !SESSION_MESSAGES.includes(body)) {
      return { kind: 'refused', reason: body };
    }
    return { kind: 'expired', reason: body || 'Discord sign-in required' };
  }

  return {
    kind: 'refused',
    reason: body || `The guild server said no (${status}).`,
  };
};

/** Seconds to wait before each retry of an offline check; then every 2 min. */
export const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000];
export const BACKOFF_STEADY_MS = 120_000;

/** Delay before retry number `attempt` (1 is the first retry). */
export const backoffDelayMs = (attempt: number): number => {
  const i = Math.max(1, Math.floor(attempt)) - 1;
  return i < BACKOFF_MS.length ? BACKOFF_MS[i] : BACKOFF_STEADY_MS;
};

/**
 * Runs `fn` one at a time. A call made while it is running does not start a
 * second run; it asks for one more run once the current one finishes. However
 * many calls arrive meanwhile, at most one more run is queued, and they all
 * get the promise of that run.
 */
export class SingleFlight {
  private current: Promise<void> | null = null;

  private queued: Promise<void> | null = null;

  constructor(private readonly fn: () => Promise<void>) {}

  public get running() {
    return this.current !== null;
  }

  public run(): Promise<void> {
    if (this.queued) return this.queued;

    if (this.current) {
      const after = this.current.catch(() => undefined);
      this.queued = after.then(() => {
        this.queued = null;
        return this.start();
      });
      return this.queued;
    }

    return this.start();
  }

  private start(): Promise<void> {
    const p = this.fn().finally(() => {
      if (this.current === p) this.current = null;
    });
    this.current = p;
    return p;
  }
}
