import {
  failedLine,
  failedRows,
  failureDelay,
  firstDirection,
  pollDelay,
  progressLine,
  progressOf,
  sortRankRows,
} from '../../renderer/toplogs/fetchStatus';

const row = (state: string, extra: Record<string, unknown> = {}) => ({
  state: state as 'ready',
  ...extra,
});

describe('progress line', () => {
  it('says how many casts are still coming', () => {
    const data = {
      pending: 4,
      rows: [
        ...Array.from({ length: 8 }, () => row('ready')),
        ...Array.from({ length: 4 }, () => row('queued')),
      ],
    };
    expect(progressLine(data)).toBe('Fetching casts for 4 more of 12 logs…');
  });

  it('uses the server numbers when it sends them, and mentions second tries', () => {
    const data = {
      pending: 3,
      rows: [],
      progress: {
        total: 25,
        ready: 20,
        queued: 3,
        waiting: 0,
        failed: 2,
        retrying: 1,
      },
    };
    expect(progressLine(data)).toBe(
      'Fetching casts for 3 more of 25 logs… · 1 is on a second try',
    );
    expect(failedLine(data)).toBe("2 logs couldn't be fetched.");
  });

  it('says when the hourly limit lets it go on', () => {
    const resumesAt = new Date(2026, 10, 28, 23, 40).getTime();
    const data = {
      pending: 5,
      rows: [row('waiting'), row('waiting'), row('ready')],
      waiting: { resumesAt },
    };
    expect(progressLine(data)).toBe(
      'Waiting for the Warcraft Logs hourly limit, resumes around 11:40 PM (2 logs still to fetch)',
    );
  });

  it('is empty when nothing is coming', () => {
    expect(
      progressLine({ pending: 0, rows: [row('ready'), row('failed')] }),
    ).toBeNull();
    expect(failedLine({ pending: 0, rows: [row('ready')] })).toBeNull();
    expect(failedLine({ pending: 0, rows: [row('failed')] })).toBe(
      "1 log couldn't be fetched.",
    );
  });

  it("counts an older server's rows the same way", () => {
    expect(
      progressOf({
        pending: 1,
        rows: [row('ready'), row('queued'), row('failed')],
      }),
    ).toEqual({
      total: 3,
      ready: 1,
      queued: 1,
      waiting: 0,
      failed: 1,
      retrying: 0,
    });
  });

  it('picks the failed rows for Retry', () => {
    expect(
      failedRows([row('ready'), row('failed'), row('queued')]),
    ).toHaveLength(1);
  });
});

describe('polling', () => {
  const coming = { pending: 2, rows: [row('queued'), row('ready')] };

  it('stops when nothing is queued or waiting', () => {
    expect(
      pollDelay({ pending: 0, rows: [row('ready'), row('failed')] }, 3, 0),
    ).toBeNull();
  });

  it('starts at 3 s and slows down', () => {
    expect(pollDelay(coming, 1, 0)).toBe(3000);
    expect(pollDelay(coming, 12, 0)).toBe(6000);
    expect(pollDelay(coming, 50, 0)).toBe(15000);
  });

  it('gives up after about 45 minutes', () => {
    expect(pollDelay(coming, 201, 0)).toBeNull();
  });

  it('waits longer while the hourly limit pauses it, but looks again within a minute', () => {
    const now = 1_000_000;
    const paused = {
      pending: 2,
      rows: [row('waiting')],
      waiting: { resumesAt: now + 20 * 60000 },
    };
    expect(pollDelay(paused, 1, now)).toBe(60000);
    expect(
      pollDelay({ ...paused, waiting: { resumesAt: now + 2000 } }, 1, now),
    ).toBe(10000);
  });

  it('backs off after failed requests and then shows the error', () => {
    expect([1, 2, 3, 4, 5, 6].map(failureDelay)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(failureDelay(7)).toBeNull();
  });
});

describe('sorting', () => {
  const rows = [
    {
      rank: 1,
      name: 'Bea',
      amount: 600,
      duration: 300,
      ilvl: 281,
      startTime: 100,
    },
    {
      rank: 2,
      name: 'Al',
      amount: 640,
      duration: 280,
      ilvl: null,
      startTime: 300,
    },
    {
      rank: 3,
      name: 'Cy',
      amount: 600,
      duration: 320,
      ilvl: 284,
      startTime: 0,
    },
  ];
  const names = (key: Parameters<typeof sortRankRows>[1], desc: boolean) =>
    sortRankRows(rows, key, desc).map((r) => r.name);

  it('keeps the server ranking by default', () => {
    expect(names('rank', false)).toEqual(['Bea', 'Al', 'Cy']);
  });

  it('sorts by amount, ties in rank order', () => {
    expect(names('amount', true)).toEqual(['Al', 'Bea', 'Cy']);
    expect(names('amount', false)).toEqual(['Bea', 'Cy', 'Al']);
  });

  it('sorts names and times', () => {
    expect(names('name', false)).toEqual(['Al', 'Bea', 'Cy']);
    expect(names('duration', false)).toEqual(['Al', 'Bea', 'Cy']);
  });

  it('puts a missing item level or date last, whichever way it goes', () => {
    expect(names('ilvl', true)).toEqual(['Cy', 'Bea', 'Al']);
    expect(names('ilvl', false)).toEqual(['Bea', 'Cy', 'Al']);
    expect(names('date', true)).toEqual(['Al', 'Bea', 'Cy']);
    expect(names('date', false)).toEqual(['Bea', 'Al', 'Cy']);
  });

  it('does not change the list it was given', () => {
    sortRankRows(rows, 'amount', true);
    expect(rows.map((r) => r.name)).toEqual(['Bea', 'Al', 'Cy']);
  });

  it('first click: best first for numbers, A to Z for names, fastest for time', () => {
    expect(firstDirection('amount')).toBe('desc');
    expect(firstDirection('name')).toBe('asc');
    expect(firstDirection('duration')).toBe('asc');
    expect(firstDirection('date')).toBe('desc');
  });
});
