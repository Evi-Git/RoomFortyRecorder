import {
  ENCODER_TRIES,
  FIRST_CONNECT_TRIES,
  GIVE_UP_AFTER_MS,
  OBS,
  REFUSED_TRIES,
  RETRY_DELAYS_MS,
  SIGN_IN_AGAIN,
  afterPublishFailure,
  afterStop,
  describeStopCode,
  httpStatusIn,
  retryDelayMs,
  unreachableMessage,
} from '../../main/liveReconnect';

const live = { tries: 0, msSinceDrop: 0, everLive: true };

describe('afterStop', () => {
  it('reconnects after a drop, waiting longer each try', () => {
    const delays = RETRY_DELAYS_MS.map((_, tries) => {
      const d = afterStop({ ...live, code: OBS.DISCONNECTED, tries });
      expect(d.retry).toBe(true);
      return d.retry ? d.delayMs : 0;
    });
    expect(delays).toEqual(RETRY_DELAYS_MS);
    const later = afterStop({ ...live, code: OBS.DISCONNECTED, tries: 20 });
    expect(later).toMatchObject({ retry: true, delayMs: 30_000 });
  });

  it('says which try is next', () => {
    const d = afterStop({ ...live, code: OBS.DISCONNECTED, tries: 2 });
    expect(d).toMatchObject({
      retry: true,
      note: 'Connection dropped. Reconnecting (try 3)…',
    });
  });

  it('gives up five minutes after the drop, saying how many tries it made', () => {
    const d = afterStop({
      ...live,
      code: OBS.DISCONNECTED,
      tries: 12,
      msSinceDrop: GIVE_UP_AFTER_MS,
    });
    expect(d).toEqual({
      retry: false,
      message:
        'The connection to the live server dropped. Gave up after 12 tries; press Go live to try again.',
    });
  });

  it('gives up with the reason it was given', () => {
    const d = afterStop({
      ...live,
      code: OBS.CONNECT_FAILED,
      tries: 3,
      msSinceDrop: GIVE_UP_AFTER_MS,
      reason: "Couldn't reach the guild server (ETIMEDOUT).",
    });
    expect(d).toEqual({
      retry: false,
      message:
        "Couldn't reach the guild server (ETIMEDOUT). Gave up after 3 tries; press Go live to try again.",
    });
  });

  it.each([OBS.BAD_PATH, OBS.UNSUPPORTED, OBS.NO_SPACE])(
    'never retries code %i',
    (code) => {
      const d = afterStop({ ...live, code });
      expect(d.retry).toBe(false);
    },
  );

  it('retries a failed first connect only a few times', () => {
    const first = { tries: 0, msSinceDrop: 0, everLive: false };
    const d = afterStop({ ...first, code: OBS.CONNECT_FAILED });
    expect(d).toMatchObject({
      retry: true,
      note: 'Couldn’t connect yet. Trying again (try 1)…',
    });
    expect(
      afterStop({
        ...first,
        code: OBS.CONNECT_FAILED,
        tries: FIRST_CONNECT_TRIES,
      }).retry,
    ).toBe(false);
  });

  it('keeps trying a refusal that is probably the last stream still held', () => {
    const refused = { code: OBS.INVALID_STREAM, error: 'response code 400' };
    for (let tries = 0; tries < REFUSED_TRIES; tries += 1) {
      // Also on a first connect: a crash leaves the old stream behind.
      expect(
        afterStop({ ...refused, tries, msSinceDrop: 0, everLive: false }).retry,
      ).toBe(true);
    }
    const d = afterStop({ ...live, ...refused, tries: REFUSED_TRIES });
    expect(d.retry).toBe(false);
    if (!d.retry)
      expect(d.message).toMatch(/still be holding your last stream/);
  });

  it('tries a refused sign-in once more, then says to sign in again', () => {
    const refused = {
      code: OBS.INVALID_STREAM,
      error: 'HTTP endpoint returned response code 401',
    };
    expect(afterStop({ ...live, ...refused }).retry).toBe(true);
    const d = afterStop({ ...live, ...refused, tries: 1 });
    expect(d.retry).toBe(false);
    if (!d.retry) expect(d.message).toMatch(/didn't accept your sign-in/);
  });

  it('retries an encoder failure once', () => {
    expect(afterStop({ ...live, code: OBS.ENCODE_ERROR }).retry).toBe(true);
    expect(
      afterStop({ ...live, code: OBS.ENCODE_ERROR, tries: ENCODER_TRIES })
        .retry,
    ).toBe(false);
  });
});

describe('describeStopCode', () => {
  it('no longer blames the stream name for every refusal', () => {
    expect(describeStopCode(OBS.INVALID_STREAM)).not.toMatch(/name/);
  });

  it('names an unknown code', () => {
    expect(describeStopCode(-42)).toBe(
      'The stream stopped unexpectedly (code -42).',
    );
  });
});

describe('httpStatusIn', () => {
  it('finds the status in OBS error text', () => {
    expect(
      httpStatusIn('Connect failed: HTTP endpoint returned response code 401'),
    ).toBe(401);
    expect(httpStatusIn('no status here')).toBeUndefined();
    expect(httpStatusIn(undefined)).toBeUndefined();
  });
});

describe('retryDelayMs', () => {
  it('never goes below the first delay', () => {
    expect(retryDelayMs(-1)).toBe(RETRY_DELAYS_MS[0]);
  });
});

describe('afterPublishFailure', () => {
  const http = (status: number, error?: string) => ({
    response: { status, data: error ? { error } : {} },
  });

  it('retries when the guild server did not answer', () => {
    expect(afterPublishFailure({ code: 'ECONNREFUSED' })).toEqual({
      retry: true,
    });
    expect(afterPublishFailure(http(502))).toEqual({ retry: true });
  });

  it('asks for a new sign-in when the session expired', () => {
    expect(
      afterPublishFailure(http(401, 'Invalid or expired Discord session')),
    ).toEqual({
      retry: false,
      message: SIGN_IN_AGAIN,
    });
  });

  it("passes on the server's reason when the role check refuses", () => {
    expect(
      afterPublishFailure(http(401, 'You no longer have a Room Forty role')),
    ).toEqual({
      retry: false,
      message:
        "The guild server won't let you go live: You no longer have a Room Forty role",
    });
  });

  it('says when live streaming is not set up', () => {
    expect(afterPublishFailure(http(404))).toEqual({
      retry: false,
      message: 'Live streaming is not set up on the guild server yet.',
    });
  });
});

describe('unreachableMessage', () => {
  it('includes the network code', () => {
    expect(unreachableMessage({ code: 'ETIMEDOUT' })).toBe(
      "Couldn't reach the guild server (ETIMEDOUT).",
    );
    expect(unreachableMessage({ response: { status: 502 } })).toBe(
      'The guild server had a problem (502).',
    );
    expect(unreachableMessage(new Error('x'))).toBe(
      "Couldn't reach the guild server.",
    );
  });
});
