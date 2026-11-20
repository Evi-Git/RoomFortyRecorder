import {
  classify,
  enqueue,
  mayShowStatus,
  nextDelay,
  NOT_READY_CODE,
  QUEUE_MAX_AGE_MS,
  QUEUE_MAX_PULLS,
  takeNext,
  withRetry,
} from '../../main/pullUploadRetry';

const http = (status: number) => ({ response: { status } });

describe('classify', () => {
  it('retries network codes', () => {
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNABORTED',
      'ERR_NETWORK',
    ].forEach((code) => expect(classify({ code })).toBe('retry'));
    expect(classify({ code: NOT_READY_CODE })).toBe('retry');
  });

  it('retries an axios error with no response, not a plain bug', () => {
    expect(classify({ isAxiosError: true, code: 'ERR_WEIRD' })).toBe('retry');
    expect(classify(new Error('gzip broke'))).toBe('fatal');
    expect(classify(undefined)).toBe('fatal');
  });

  it('retries 408, 429 and 5xx', () => {
    [408, 429, 500, 502, 503, 504].forEach((s) =>
      expect(classify(http(s))).toBe('retry'),
    );
  });

  it('treats 401 as auth', () => {
    expect(classify(http(401))).toBe('auth');
  });

  it('never retries other 4xx', () => {
    [400, 403, 404, 409, 413].forEach((s) =>
      expect(classify(http(s))).toBe('fatal'),
    );
  });
});

describe('nextDelay', () => {
  it('follows the schedule then gives up', () => {
    expect([1, 2, 3, 4, 5].map(nextDelay)).toEqual([
      5000, 15000, 45000, 120000, 300000,
    ]);
    expect(nextDelay(6)).toBeNull();
    expect(nextDelay(100)).toBeNull();
  });
});

describe('withRetry', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  beforeEach(() => {
    sleeps.length = 0;
  });

  it('returns at once on success', async () => {
    await expect(withRetry(async () => 7, { sleep })).resolves.toBe(7);
    expect(sleeps).toEqual([]);
  });

  it('retries a 503 with the schedule, then succeeds', async () => {
    let calls = 0;
    const seen: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw http(503);
        return 'ok';
      },
      { sleep, onRetry: (i) => seen.push(i.attempt) },
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([5000, 15000]);
    expect(seen).toEqual([1, 2]);
  });

  it('never retries a fatal 4xx', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw http(413);
        },
        { sleep },
      ),
    ).rejects.toEqual(http(413));
    expect(calls).toBe(1);
  });

  it('gives up when the schedule runs out', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw http(500);
        },
        { sleep },
      ),
    ).rejects.toEqual(http(500));
    expect(calls).toBe(6);
    expect(sleeps).toHaveLength(5);
  });

  it('waits for sign-in on a 401 and retries, or throws if not back', async () => {
    let calls = 0;
    const ok = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw http(401);
        return 'ok';
      },
      { sleep, onAuth: async () => true },
    );
    expect(ok).toBe('ok');
    expect(sleeps).toEqual([]);

    await expect(
      withRetry(
        async () => {
          throw http(401);
        },
        { sleep, onAuth: async () => false },
      ),
    ).rejects.toEqual(http(401));
    await expect(
      withRetry(
        async () => {
          throw http(401);
        },
        { sleep },
      ),
    ).rejects.toEqual(http(401));
  });

  it('does not loop on repeated 401s', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw http(401);
        },
        { sleep, onAuth: async () => true },
      ),
    ).rejects.toEqual(http(401));
    expect(calls).toBe(3);
  });

  it('stops when the time budget would be passed', async () => {
    let t = 0;
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw http(503);
        },
        {
          sleep: async (ms) => {
            t += ms;
          },
          now: () => t,
          maxElapsedMs: 30_000,
        },
      ),
    ).rejects.toEqual(http(503));
    // waits 5 s and 15 s; the next wait (45 s) would pass 30 s.
    expect(calls).toBe(3);
  });
});

describe('queue', () => {
  const NOW = 10_000_000_000;
  const entry = (minsAgo: number, item = `p${minsAgo}`) => ({
    at: NOW - minsAgo * 60_000,
    item,
  });

  it('adds and keeps oldest first', () => {
    const a = enqueue([], entry(5), NOW);
    const b = enqueue(a.queue, entry(10), NOW);
    expect(b.queue.map((e) => e.item)).toEqual(['p10', 'p5']);
    expect(b.dropped).toEqual([]);
  });

  it('drops pulls older than two hours', () => {
    const old = entry(QUEUE_MAX_AGE_MS / 60_000 + 1);
    const { queue, dropped } = enqueue([old], entry(1), NOW);
    expect(queue.map((e) => e.item)).toEqual(['p1']);
    expect(dropped).toEqual([old]);
  });

  it('caps the queue, dropping the oldest', () => {
    let queue: ReturnType<typeof enqueue<string>>['queue'] = [];
    let dropped: typeof queue = [];
    for (let i = QUEUE_MAX_PULLS + 3; i >= 1; i -= 1) {
      const r = enqueue(queue, entry(i), NOW);
      queue = r.queue;
      dropped = dropped.concat(r.dropped);
    }
    expect(queue).toHaveLength(QUEUE_MAX_PULLS);
    expect(queue[0].item).toBe(`p${QUEUE_MAX_PULLS}`);
    expect(queue[QUEUE_MAX_PULLS - 1].item).toBe('p1');
    expect(dropped).toHaveLength(3);
  });

  it('takes the oldest fresh pull and drops the expired', () => {
    const q = [entry(1), entry(200), entry(30)];
    const r = takeNext(q, NOW);
    expect(r.next?.item).toBe('p30');
    expect(r.queue.map((e) => e.item)).toEqual(['p1']);
    expect(r.dropped.map((e) => e.item)).toEqual(['p200']);
    expect(takeNext([], NOW).next).toBeNull();
  });
});

describe('mayShowStatus', () => {
  it('shows the newest pull, not an older retry', () => {
    expect(mayShowStatus(null, { startedAt: 5 })).toBe(true);
    expect(mayShowStatus({ startedAt: 10 }, { startedAt: 10 })).toBe(true);
    expect(mayShowStatus({ startedAt: 10 }, { startedAt: 20 })).toBe(true);
    expect(mayShowStatus({ startedAt: 20 }, { startedAt: 10 })).toBe(false);
  });
});
