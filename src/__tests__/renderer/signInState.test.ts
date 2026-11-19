import {
  backoffDelayMs,
  classifyFailure,
  SingleFlight,
} from '../../main/signInState';

const http = (status: number, error?: string) => ({
  isAxiosError: true,
  response: { status, data: error === undefined ? {} : { error } },
});
const net = (code: string) => ({ isAxiosError: true, code });

describe('classifyFailure', () => {
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'])(
    '%s is offline',
    (code) => {
      expect(classifyFailure(net(code)).kind).toBe('offline');
    },
  );

  it('treats no response and unknown errors as offline', () => {
    expect(classifyFailure({ isAxiosError: true }).kind).toBe('offline');
    expect(classifyFailure(new Error('boom')).kind).toBe('offline');
    expect(classifyFailure(undefined).kind).toBe('offline');
  });

  it.each([500, 502, 503, 504])('%i is offline', (status) => {
    expect(classifyFailure(http(status)).kind).toBe('offline');
  });

  it('401 with a session message is expired and keeps the message', () => {
    expect(
      classifyFailure(http(401, 'Invalid or expired Discord session')),
    ).toEqual({
      kind: 'expired',
      reason: 'Invalid or expired Discord session',
    });
    expect(classifyFailure(http(401, 'Discord sign-in required')).kind).toBe(
      'expired',
    );
  });

  it('401 with no message is expired', () => {
    expect(classifyFailure(http(401)).kind).toBe('expired');
  });

  it('401 with any other message came from the role check: refused', () => {
    expect(
      classifyFailure(http(401, 'You no longer have the raider role')),
    ).toEqual({
      kind: 'refused',
      reason: 'You no longer have the raider role',
    });
  });

  it('other 4xx is refused', () => {
    expect(classifyFailure(http(403, 'Nope')).kind).toBe('refused');
    expect(classifyFailure(http(404)).reason).toContain('404');
  });
});

describe('backoffDelayMs', () => {
  it('goes 5 s, 15 s, 30 s, 60 s, then every 2 min', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(backoffDelayMs)).toEqual([
      5000, 15000, 30000, 60000, 120000, 120000, 120000,
    ]);
  });

  it('treats 0 or less as the first retry', () => {
    expect(backoffDelayMs(0)).toBe(5000);
  });
});

describe('SingleFlight', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('never runs two at once and queues at most one re-run', async () => {
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;
    let active = 0;
    let maxActive = 0;
    const flight = new SingleFlight(async () => {
      const gate = gates[started];
      started += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    });

    const first = flight.run();
    const second = flight.run();
    const third = flight.run();
    expect(second).toBe(third);
    expect(started).toBe(1);

    gates[0].resolve();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(2);

    gates[1].resolve();
    await Promise.all([second, third]);
    expect(started).toBe(2);
    expect(maxActive).toBe(1);
    expect(flight.running).toBe(false);
  });

  it('runs again after finishing, and survives a failing run', async () => {
    let calls = 0;
    const flight = new SingleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first fails');
    });
    await expect(flight.run()).rejects.toThrow('first fails');
    await flight.run();
    expect(calls).toBe(2);
  });
});
