/**
 * [RoomFortyRecorder] Top logs: what the page says about the casts still
 * being fetched, when it asks again, and how the list is sorted. Plain
 * functions (tests in src/__tests__/renderer/toplogsFetchStatus.test.ts).
 *
 * The server (1.9.169+) sends `progress`, `waiting` and per-row `waiting`,
 * `attempt` and `error`; an older server sends only each row's state
 * (ready, queued, failed) and `pending`, which is enough for the same line.
 */
import { timeOfDay } from '../clock';
import type { RankRow } from './shared';

export type Progress = {
  total: number;
  ready: number;
  queued: number;
  waiting: number;
  failed: number;
  retrying: number;
};

export type FetchData = {
  pending: number;
  rows: Pick<RankRow, 'state' | 'attempt'>[];
  progress?: Progress;
  waiting?: { resumesAt: number; reason?: string } | null;
};

/** Counts per state, from the server's `progress` or else from the rows. */
export const progressOf = (data: FetchData): Progress => {
  if (data.progress) return data.progress;
  const count = (state: string) =>
    data.rows.filter((r) => r.state === state).length;
  return {
    total: data.rows.length,
    ready: count('ready'),
    queued: count('queued'),
    waiting: count('waiting'),
    failed: count('failed'),
    retrying: data.rows.filter(
      (r) => r.state === 'queued' && (r.attempt ?? 1) > 1,
    ).length,
  };
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The line above the list while casts are coming, or null when none are.
 * "Fetching casts for 4 more of 12 logs…", or, when Warcraft Logs' hourly
 * limit paused it, when it goes on.
 */
export const progressLine = (data: FetchData): string | null => {
  const p = progressOf(data);
  const coming = p.queued + p.waiting;
  if (coming <= 0) return null;
  if (p.waiting > 0 && data.waiting?.resumesAt) {
    return `Waiting for the Warcraft Logs hourly limit, resumes around ${timeOfDay(
      data.waiting.resumesAt,
    )} (${plural(coming, 'log', 'logs')} still to fetch)`;
  }
  const retry = p.retrying
    ? ` · ${plural(p.retrying, 'is', 'are')} on a second try`
    : '';
  return `Fetching casts for ${coming} more of ${p.total} logs…${retry}`;
};

/** The line about logs that gave up, or null. */
export const failedLine = (data: FetchData): string | null => {
  const { failed } = progressOf(data);
  if (failed <= 0) return null;
  return `${plural(failed, 'log', 'logs')} couldn't be fetched.`;
};

/** First asks come quickly, later ones slow down; a pause waits longer. */
export const pollDelay = (
  data: FetchData,
  polls: number,
  now: number,
): number | null => {
  const p = progressOf(data);
  const coming = Math.max(data.pending ?? 0, p.queued + p.waiting);
  if (coming <= 0) return null;
  // Stop after about 45 minutes (the server finishes or fails every row
  // long before); the page then offers Refresh.
  if (polls > 200) return null;
  if (p.waiting > 0 && data.waiting?.resumesAt) {
    return Math.min(60000, Math.max(10000, data.waiting.resumesAt - now));
  }
  if (polls < 10) return 3000;
  if (polls < 30) return 6000;
  return 15000;
};

/**
 * When to ask again after a request failed (the server restarting, the
 * network, a slow first answer): 2 s, 4 s, 8 s ... up to 30 s, and null
 * (show the error) after six failures in a row.
 */
export const failureDelay = (failures: number): number | null =>
  failures > 6 ? null : Math.min(30000, 1000 * 2 ** failures);

/** The failed rows, to send with Retry. */
export const failedRows = <T extends { state: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.state === 'failed');

// ---- Sorting ------------------------------------------------------------

export type SortKey = 'rank' | 'name' | 'amount' | 'duration' | 'ilvl' | 'date';

type SortRow = Pick<
  RankRow,
  'rank' | 'name' | 'amount' | 'duration' | 'ilvl'
> & { startTime?: number };

/** Missing values (no item level, no date) always sort last. */
export const sortValue = (
  row: SortRow,
  key: SortKey,
): number | string | null => {
  switch (key) {
    case 'rank':
      return row.rank;
    case 'name':
      return row.name.toLowerCase();
    case 'amount':
      return row.amount;
    case 'duration':
      return row.duration;
    case 'ilvl':
      return row.ilvl ?? null;
    case 'date':
      return row.startTime || null;
    default:
      return null;
  }
};

/**
 * Rows ordered by a column. The server's ranking is the default (`rank`
 * ascending); every other column breaks ties by rank, so equal values keep
 * the ranking order.
 */
export const sortRankRows = <T extends SortRow>(
  rows: T[],
  key: SortKey,
  desc: boolean,
): T[] =>
  [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.rank - b.rank;
    if (x === null) return 1;
    if (y === null) return -1;
    const c =
      typeof x === 'string' || typeof y === 'string'
        ? String(x).localeCompare(String(y))
        : x - y;
    return (desc ? -c : c) || a.rank - b.rank;
  });

/** Which way a column goes the first time it is clicked. */
export const firstDirection = (key: SortKey): 'asc' | 'desc' =>
  key === 'rank' || key === 'name' || key === 'duration' ? 'asc' : 'desc';
