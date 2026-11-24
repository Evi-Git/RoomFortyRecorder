/**
 * [RoomFortyRecorder] The app side of "Sign in with Discord" (audit M11).
 *
 * The guild server runs the Discord OAuth flow (with its own `state` check)
 * and finally sends the browser to a one-time loopback address on this PC
 * with a login code. This module owns that loopback address:
 *
 * - It carries a random secret (`?s=`), and only a request with that secret
 *   counts, so a web page that guesses the port can't hand the app someone
 *   else's login code (or end the sign-in early).
 * - The server's error codes become a clear reason, shown in the app and on
 *   the browser page.
 * - The browser page waits for the code exchange, so it says how the
 *   sign-in really ended.
 * - It can be cancelled (AbortSignal), and times out after 5 minutes.
 *
 * Pure Node (no Electron), so it is tested in src/__tests__/main.
 */
import crypto from 'crypto';
import http from 'http';

export type SignInFailure =
  | 'cancelled'
  | 'timeout'
  | 'denied'
  | 'notMember'
  | 'missingRole'
  | 'notConfigured'
  | 'discordFailed'
  | 'serverUnreachable'
  | 'serverRefused'
  | 'tooManyTries'
  | 'expired'
  | 'invalidSession'
  | 'callbackFailed'
  | 'browserFailed';

const MESSAGES: Record<SignInFailure, string> = {
  cancelled: 'Sign-in cancelled.',
  timeout: 'Sign-in timed out after 5 minutes. Try again.',
  denied: 'Sign-in was cancelled in Discord. Try again and press Authorize.',
  notMember: 'That Discord account is not in the Room Forty Discord.',
  missingRole:
    'That Discord account has no Room Forty role yet. Ask an officer to give you one.',
  notConfigured: 'Discord sign-in is not set up on the guild server yet.',
  discordFailed:
    'Discord did not answer the guild server. Try again in a minute.',
  serverUnreachable:
    "Couldn't reach the guild server. Check your connection and try again.",
  serverRefused: 'The guild server refused the sign-in. Try again.',
  tooManyTries: 'Too many sign-in attempts. Wait a minute and try again.',
  expired: 'The sign-in took too long or was already used. Try again.',
  invalidSession: 'The guild server sent back an invalid sign-in. Try again.',
  callbackFailed:
    "Couldn't start sign-in: the app could not open a local address.",
  browserFailed: "Couldn't open your browser for Discord sign-in.",
};

export const signInMessage = (code: SignInFailure) => MESSAGES[code];

export class DiscordSignInError extends Error {
  readonly code: SignInFailure;

  constructor(code: SignInFailure, detail?: string) {
    super(MESSAGES[code]);
    this.name = 'DiscordSignInError';
    this.code = code;
    if (detail) this.detail = detail;
  }

  /** What went wrong underneath, for the log only. */
  detail?: string;
}

/** The server's `?error=` codes (guild-cloud-server/server.mjs). */
const SERVER_ERRORS: Record<string, SignInFailure> = {
  discord_denied: 'denied',
  not_room_forty_member: 'notMember',
  missing_room_forty_role: 'missingRole',
  discord_not_configured: 'notConfigured',
  discord_auth_failed: 'discordFailed',
};

export const fromServerError = (value: string): SignInFailure =>
  Object.prototype.hasOwnProperty.call(SERVER_ERRORS, value)
    ? SERVER_ERRORS[value]
    : 'serverRefused';

/**
 * An HTTP failure (axios-shaped: `response.status` when the server
 * answered) as a sign-in failure. `expiredOn401` is for the code exchange.
 */
export const fromHttpError = (
  error: unknown,
  expiredOn401 = false,
): DiscordSignInError => {
  if (error instanceof DiscordSignInError) return error;
  const status = (error as { response?: { status?: unknown } } | null)?.response
    ?.status;
  const detail = error instanceof Error ? error.message : String(error);
  if (typeof status !== 'number') {
    return new DiscordSignInError('serverUnreachable', detail);
  }
  if (status === 429) return new DiscordSignInError('tooManyTries', detail);
  if (expiredOn401 && status === 401) {
    return new DiscordSignInError('expired', detail);
  }
  return new DiscordSignInError('serverRefused', detail);
};

/** Only Discord's own authorize page is opened in the browser. */
export const isDiscordAuthorizeUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'discord.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/oauth2/authorize')
    );
  } catch {
    return false;
  }
};

const sameSecret = (given: string | null, expected: string) => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const page = (heading: string, line: string) =>
  '<!doctype html><meta charset="utf-8"><title>Room Forty Toolkit</title>' +
  '<body style="font-family:system-ui,sans-serif;background:#1b1612;color:#e6ded1;' +
  'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
  `<div style="max-width:28rem"><h1 style="font-size:1.25rem">${heading}</h1>` +
  `<p>${line}</p></div>`;

/** Plain text in an HTML page (user names come from Discord). */
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

export type DiscordSignInOptions<T> = {
  /** The server's start address for a given loopback callback. */
  startUrl: (callback: string) => string;
  /** GET the start address without following it; resolve its Location. */
  getRedirect: (url: string) => Promise<string | undefined>;
  /** Open an address in the user's browser. */
  openExternal: (url: string) => void | Promise<void>;
  /** Trade the login code for a session (and save it). */
  exchange: (code: string) => Promise<T>;
  /** The name to greet on the browser page once signed in. */
  nameOf?: (result: T) => string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Tests only: a fixed secret. */
  secret?: string;
};

export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run one sign-in. Resolves with the exchange's result; rejects with a
 * DiscordSignInError.
 */
export function runDiscordSignIn<T>(
  options: DiscordSignInOptions<T>,
): Promise<T> {
  const {
    startUrl,
    getRedirect,
    openExternal,
    exchange,
    nameOf,
    signal,
    timeoutMs = SIGN_IN_TIMEOUT_MS,
  } = options;
  const secret = options.secret ?? crypto.randomBytes(32).toString('base64url');

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    // Once a real code arrives the exchange runs to the end: Cancel and the
    // timeout no longer apply (the exchange has its own HTTP timeout).
    let exchanging = false;
    let callbackUrl = '';

    const server = http.createServer();

    const finish = (error: DiscordSignInError | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      server.close();
      // A browser keep-alive connection would hold the port open.
      server.closeAllConnections?.();
      if (error) reject(error);
      else resolve(value as T);
    };

    const onAbort = () => {
      if (!exchanging) finish(new DiscordSignInError('cancelled'));
    };

    const timer = setTimeout(() => {
      if (!exchanging) finish(new DiscordSignInError('timeout'));
    }, timeoutMs);

    if (signal?.aborted) {
      finish(new DiscordSignInError('cancelled'));
      return;
    }
    signal?.addEventListener('abort', onAbort);

    /** The code (or error) the server sent, from our own callback URL. */
    const handleResult = async (
      params: URLSearchParams,
      res?: http.ServerResponse,
    ) => {
      const reply = (status: number, heading: string, line: string) => {
        if (!res) return;
        res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'close',
        });
        res.end(page(heading, line));
      };

      const error = params.get('error');
      const code = params.get('code');
      if (error || !code) {
        const failure = new DiscordSignInError(
          error ? fromServerError(error) : 'serverRefused',
          error || 'no code',
        );
        reply(200, 'Sign-in did not finish', escapeHtml(failure.message));
        finish(failure);
        return;
      }

      exchanging = true;
      try {
        const result = await exchange(code);
        const name = nameOf ? nameOf(result) : '';
        reply(
          200,
          name ? `Signed in as ${escapeHtml(name)}` : 'Signed in',
          'You can close this tab and go back to Room Forty Toolkit.',
        );
        finish(null, result);
      } catch (err) {
        const failure = fromHttpError(err, true);
        reply(200, 'Sign-in did not finish', escapeHtml(failure.message));
        finish(failure);
      }
    };

    server.on('request', (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback' || req.method !== 'GET') {
        res.writeHead(404, { Connection: 'close' }).end();
        return;
      }
      if (
        settled ||
        exchanging ||
        !sameSecret(url.searchParams.get('s'), secret)
      ) {
        // Not this sign-in's address (or already used): ignore it, so a stray
        // or forged request can neither sign in nor end the wait.
        res.writeHead(400, {
          'Content-Type': 'text/html; charset=utf-8',
          Connection: 'close',
        });
        res.end(
          page(
            'This sign-in link is not valid',
            'Start the sign-in again from Room Forty Toolkit.',
          ),
        );
        return;
      }
      handleResult(url.searchParams, res);
    });

    server.on('error', (err) =>
      finish(new DiscordSignInError('callbackFailed', String(err))),
    );

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finish(new DiscordSignInError('callbackFailed', 'no port'));
        return;
      }
      callbackUrl = `http://127.0.0.1:${address.port}/callback?s=${secret}`;

      let location: string | undefined;
      try {
        location = await getRedirect(startUrl(callbackUrl));
      } catch (err) {
        finish(fromHttpError(err));
        return;
      }
      if (settled) return;

      // The server answers some failures (Discord not configured) by sending
      // us straight back to our own callback: read them without a browser.
      if (typeof location === 'string' && location.startsWith(callbackUrl)) {
        const back = new URL(location);
        if (sameSecret(back.searchParams.get('s'), secret)) {
          handleResult(back.searchParams);
          return;
        }
      }

      if (!isDiscordAuthorizeUrl(location)) {
        finish(
          new DiscordSignInError(
            'serverRefused',
            `unexpected sign-in address: ${String(location).slice(0, 200)}`,
          ),
        );
        return;
      }

      try {
        await openExternal(location as string);
      } catch (err) {
        finish(new DiscordSignInError('browserFailed', String(err)));
      }
    });
  });
}
