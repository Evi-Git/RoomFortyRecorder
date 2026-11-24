/**
 * @jest-environment node
 */
import http from 'http';
import {
  DiscordSignInError,
  fromHttpError,
  fromServerError,
  isDiscordAuthorizeUrl,
  runDiscordSignIn,
  signInMessage,
} from '../../main/discordSignIn';

const SECRET = 'test-secret-0123456789';
const AUTHORIZE = 'https://discord.com/oauth2/authorize?client_id=1&state=x';

/** GET a loopback URL; resolves status and body. */
const get = (url: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      })
      .on('error', reject);
  });

/**
 * Start a sign-in whose "browser" is a function: it gets the loopback
 * callback URL (with the secret) once the app opens Discord.
 */
const start = (
  overrides: Partial<Parameters<typeof runDiscordSignIn<string>>[0]> = {},
) => {
  let callback = '';
  let opened = '';
  let browserReady: (cb: string) => void = () => {};
  const ready = new Promise<string>((r) => {
    browserReady = r;
  });
  const exchange = jest.fn(async (code: string) => `user-for-${code}`);
  const promise = runDiscordSignIn<string>({
    secret: SECRET,
    startUrl: (cb) => {
      callback = cb;
      return `https://guild.example/auth/discord/start?callback=${encodeURIComponent(cb)}`;
    },
    getRedirect: async () => AUTHORIZE,
    openExternal: (url) => {
      opened = url;
      browserReady(callback);
    },
    exchange,
    nameOf: (name) => name,
    ...overrides,
  });
  // Some tests read the page before asserting the rejection.
  promise.catch(() => {});
  return { promise, ready, exchange, opened: () => opened };
};

const withParams = (cb: string, params: Record<string, string>) => {
  const url = new URL(cb);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
};

describe('runDiscordSignIn', () => {
  it('opens Discord and signs in with the code from its own callback', async () => {
    const run = start();
    const cb = await run.ready;
    expect(cb).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\?s=test-secret/);
    expect(run.opened()).toBe(AUTHORIZE);

    const page = await get(withParams(cb, { code: 'abc' }));
    expect(page.status).toBe(200);
    expect(page.body).toContain('Signed in as user-for-abc');
    await expect(run.promise).resolves.toBe('user-for-abc');
    expect(run.exchange).toHaveBeenCalledWith('abc');
  });

  it('ignores a callback without the secret and keeps waiting', async () => {
    const run = start();
    const cb = await run.ready;
    const port = new URL(cb).port;

    const forged = await get(`http://127.0.0.1:${port}/callback?code=evil`);
    expect(forged.status).toBe(400);
    const wrong = await get(
      `http://127.0.0.1:${port}/callback?s=test-secret-0123456788&code=evil`,
    );
    expect(wrong.status).toBe(400);
    const other = await get(`http://127.0.0.1:${port}/favicon.ico`);
    expect(other.status).toBe(404);
    expect(run.exchange).not.toHaveBeenCalled();

    await get(withParams(cb, { code: 'real' }));
    await expect(run.promise).resolves.toBe('user-for-real');
    expect(run.exchange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['discord_denied', 'denied'],
    ['not_room_forty_member', 'notMember'],
    ['missing_room_forty_role', 'missingRole'],
    ['discord_auth_failed', 'discordFailed'],
    ['something_new', 'serverRefused'],
  ])('turns ?error=%s into %s, on the page too', async (error, code) => {
    const run = start();
    const cb = await run.ready;
    const page = await get(withParams(cb, { error }));
    expect(page.body).toContain('Sign-in did not finish');
    await expect(run.promise).rejects.toMatchObject({ code });
    expect(run.exchange).not.toHaveBeenCalled();
  });

  it('reads an error the server sends straight back without a browser', async () => {
    const openExternal = jest.fn();
    let callback = '';
    const promise = runDiscordSignIn({
      secret: SECRET,
      startUrl: (cb) => {
        callback = cb;
        return 'x';
      },
      getRedirect: async () =>
        withParams(callback, { error: 'discord_not_configured' }),
      openExternal,
      exchange: async () => 'never',
    });
    await expect(promise).rejects.toMatchObject({ code: 'notConfigured' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses to open anything but Discord', async () => {
    const openExternal = jest.fn();
    const promise = runDiscordSignIn({
      secret: SECRET,
      startUrl: () => 'x',
      getRedirect: async () => 'https://evil.example/oauth2/authorize',
      openExternal,
      exchange: async () => 'never',
    });
    await expect(promise).rejects.toMatchObject({ code: 'serverRefused' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('says the server is unreachable when the start request gets no answer', async () => {
    const promise = runDiscordSignIn({
      secret: SECRET,
      startUrl: () => 'x',
      getRedirect: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      openExternal: jest.fn(),
      exchange: async () => 'never',
    });
    await expect(promise).rejects.toMatchObject({ code: 'serverUnreachable' });
  });

  it('can be cancelled while waiting, and the address stops answering', async () => {
    const abort = new AbortController();
    const run = start({ signal: abort.signal });
    const cb = await run.ready;
    abort.abort();
    await expect(run.promise).rejects.toMatchObject({ code: 'cancelled' });
    await expect(get(withParams(cb, { code: 'late' }))).rejects.toThrow();
    expect(run.exchange).not.toHaveBeenCalled();
  });

  it('is cancelled at once when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const getRedirect = jest.fn();
    const promise = runDiscordSignIn({
      startUrl: () => 'x',
      getRedirect,
      openExternal: jest.fn(),
      exchange: async () => 'never',
      signal: abort.signal,
    });
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(getRedirect).not.toHaveBeenCalled();
  });

  it('times out', async () => {
    const run = start({ timeoutMs: 30 });
    await run.ready;
    await expect(run.promise).rejects.toMatchObject({ code: 'timeout' });
  });

  it('lets a started exchange finish even if Cancel comes meanwhile', async () => {
    const abort = new AbortController();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const run = start({
      signal: abort.signal,
      exchange: async (code) => {
        await gate;
        return `slow-${code}`;
      },
    });
    const cb = await run.ready;
    const page = get(withParams(cb, { code: 'c' }));
    await new Promise((r) => setTimeout(r, 20));
    abort.abort();
    release();
    await expect(run.promise).resolves.toBe('slow-c');
    expect((await page).body).toContain('Signed in as slow-c');
  });

  it('reports an expired code from the exchange on the page and in the app', async () => {
    const run = start({
      exchange: async () => {
        throw Object.assign(new Error('401'), { response: { status: 401 } });
      },
    });
    const cb = await run.ready;
    const page = await get(withParams(cb, { code: 'old' }));
    expect(page.body).toContain(signInMessage('expired'));
    await expect(run.promise).rejects.toMatchObject({ code: 'expired' });
  });

  it('escapes the user name on the page', async () => {
    const run = start({ exchange: async () => '<b>x</b>' });
    const cb = await run.ready;
    const page = await get(withParams(cb, { code: 'c' }));
    expect(page.body).toContain('&lt;b&gt;x&lt;/b&gt;');
    await run.promise;
  });

  it('uses a different secret every time by default', async () => {
    const seen: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const abort = new AbortController();
      const p = runDiscordSignIn({
        startUrl: (cb) => {
          seen.push(new URL(cb).searchParams.get('s') || '');
          return 'x';
        },
        getRedirect: async () => AUTHORIZE,
        openExternal: () => abort.abort(),
        exchange: async () => 'never',
        signal: abort.signal,
      });

      await expect(p).rejects.toBeInstanceOf(DiscordSignInError);
    }
    expect(seen[0]).toHaveLength(43);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe('helpers', () => {
  it('accepts only https://discord.com/oauth2/authorize', () => {
    expect(isDiscordAuthorizeUrl(AUTHORIZE)).toBe(true);
    expect(isDiscordAuthorizeUrl('http://discord.com/oauth2/authorize')).toBe(
      false,
    );
    expect(
      isDiscordAuthorizeUrl(
        'https://discord.com.evil.example/oauth2/authorize',
      ),
    ).toBe(false);
    expect(
      isDiscordAuthorizeUrl('https://discord.com:8443/oauth2/authorize'),
    ).toBe(false);
    expect(isDiscordAuthorizeUrl('https://discord.com/login')).toBe(false);
    expect(isDiscordAuthorizeUrl(undefined)).toBe(false);
  });

  it('maps unknown server errors to serverRefused', () => {
    expect(fromServerError('toString')).toBe('serverRefused');
    expect(fromServerError('discord_denied')).toBe('denied');
  });

  it('classifies HTTP failures', () => {
    expect(fromHttpError(new Error('x')).code).toBe('serverUnreachable');
    expect(fromHttpError({ response: { status: 429 } }).code).toBe(
      'tooManyTries',
    );
    expect(fromHttpError({ response: { status: 401 } }).code).toBe(
      'serverRefused',
    );
    expect(fromHttpError({ response: { status: 401 } }, true).code).toBe(
      'expired',
    );
  });
});
