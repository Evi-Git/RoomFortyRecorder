import zlib from 'zlib';
import {
  createSingleFlight,
  gunzipsCleanly,
  isStaleTemp,
  judgeCachedBytes,
  judgeCachedFile,
  retryOperation,
  looksLikeGzip,
  tempPathFor,
} from '../../main/fullLogCache';

const gz = zlib.gzipSync('ENCOUNTER_START,1,x\n'.repeat(2000));

describe('createSingleFlight', () => {
  it('shares one run between callers for the same key', async () => {
    const flight = createSingleFlight();
    let runs = 0;
    let release: (v: number) => void = () => {};
    const task = () => {
      runs += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };
    const a = flight.run('p1', task);
    const b = flight.run('p1', task);
    expect(flight.size).toBe(1);
    release(7);
    await expect(Promise.all([a, b])).resolves.toEqual([7, 7]);
    expect(runs).toBe(1);
    expect(flight.size).toBe(0);
  });

  it('runs different keys separately and tries again after a failure', async () => {
    const flight = createSingleFlight();
    let runs = 0;
    const failing = () => {
      runs += 1;
      return Promise.reject(new Error('boom'));
    };
    await expect(flight.run('a', failing)).rejects.toThrow('boom');
    await expect(flight.run('a', failing)).rejects.toThrow('boom');
    expect(runs).toBe(2);
    await expect(flight.run('b', async () => 1)).resolves.toBe(1);
    expect(flight.size).toBe(0);
  });

  it('turns a task that throws at once into a rejection', async () => {
    const flight = createSingleFlight();
    await expect(
      flight.run('a', () => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
  });
});

describe('judgeCachedFile', () => {
  const head = gz.subarray(0, 32);
  it('serves a verified gzip, checks an unverified one once', () => {
    expect(judgeCachedFile({ head, size: gz.length, verified: true })).toBe(
      'ok',
    );
    expect(judgeCachedFile({ head, size: gz.length, verified: false })).toBe(
      'check',
    );
  });
  it('rejects non-gzip, tiny and wrong-length files', () => {
    expect(
      judgeCachedFile({
        head: Buffer.from('{"error":"x"}'),
        size: 100,
        verified: true,
      }),
    ).toBe('bad');
    expect(judgeCachedFile({ head, size: 10, verified: true })).toBe('bad');
  });
  it('judges a real cached file by the same call the app makes', () => {
    expect(judgeCachedBytes(gz, false)).toBe('check');
    expect(judgeCachedBytes(gz, true)).toBe('ok');
    expect(judgeCachedBytes(gz.subarray(0, 10), true)).toBe('bad');
    expect(
      judgeCachedBytes(Buffer.from('{"error":"x"} and more bytes here'), true),
    ).toBe('bad');
  });
  it('looksLikeGzip needs the header and a whole-file minimum', () => {
    expect(looksLikeGzip(gz)).toBe(true);
    expect(looksLikeGzip(gz.subarray(0, 4))).toBe(true);
    expect(looksLikeGzip(Buffer.alloc(40))).toBe(false);
  });
});

describe('gunzipsCleanly', () => {
  it('accepts a whole gzip and refuses a truncated or damaged one', async () => {
    await expect(gunzipsCleanly(gz)).resolves.toBe(true);
    await expect(gunzipsCleanly(gz.subarray(0, gz.length - 20))).resolves.toBe(
      false,
    );
    const damaged = Buffer.from(gz);
    damaged[Math.floor(damaged.length / 2)] ^= 0xff;
    await expect(gunzipsCleanly(damaged)).resolves.toBe(false);
    await expect(
      gunzipsCleanly(Buffer.from('not gzip at all, really not')),
    ).resolves.toBe(false);
  });
});

describe('temp files', () => {
  it('writes next to the target and only old ones are leftovers', () => {
    expect(tempPathFor('/a/p1.log.gz')).toBe('/a/p1.log.gz.tmp');
    const now = 10_000_000;
    expect(isStaleTemp('p1.log.gz.tmp', now - 60 * 60 * 1000, now)).toBe(true);
    expect(isStaleTemp('p1.log.gz.tmp', now - 1000, now)).toBe(false);
    expect(isStaleTemp('p1.log.gz', now - 60 * 60 * 1000, now)).toBe(false);
  });
});

describe('retryOperation', () => {
  const noWait = async () => {};
  it('retries until it works', async () => {
    let calls = 0;
    const ok = await retryOperation(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('EPERM');
      },
      [1, 1, 1],
      noWait,
    );
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });
  it('gives up after the last delay and reports false', async () => {
    let calls = 0;
    const waits: number[] = [];
    const ok = await retryOperation(
      async () => {
        calls += 1;
        throw new Error('EBUSY');
      },
      [5, 6],
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(ok).toBe(false);
    expect(calls).toBe(3);
    expect(waits).toEqual([5, 6]);
  });
});
