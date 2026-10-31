/**
 * [RoomFortyRecorder] "Where the time went", option A (1.9.103): findings
 * ranked by what they cost. Pure for tests
 * (src/__tests__/renderer/whereTime.test.ts).
 *
 * A finding's cost is their damage (or healing) minus ours over its window,
 * on the same time axis as the timeline (pull start, or lined up by phase).
 * A second covered by several findings (cooldowns pressed together) is
 * split between them, so the costs add up. Only cooldowns that raise their
 * output (their rate in the 15 s after a cast is 10% over their average)
 * are listed: a late defensive costs no damage.
 *   Late         a cooldown pressed 3 s or more after theirs; the window
 *                is the delay, from their cast to ours.
 *   Missed       they pressed it, you didn't (once); 20 s from their cast.
 *   Fewer casts  missed two or more times.
 *   Lull         15 s or more with no main cooldown pressed by either of
 *                you in the 15 s before, while they did more.
 */
import type { Track } from './trial';
import {
  Aligned,
  castsFor,
  MainCd,
  Pair,
  pairCasts,
  perSecond,
} from './timeline';

export type Kind = 'late' | 'missed' | 'fewer' | 'lull';

export const KINDS: Record<Kind, { label: string; color: string }> = {
  late: { label: 'Late', color: '#E5A55F' },
  missed: { label: 'Missed', color: '#E57F7F' },
  fewer: { label: 'Fewer casts', color: '#C48BE0' },
  lull: { label: 'Lull', color: '#8FA3FF' },
};

export type Finding = {
  kind: Kind;
  /** The cooldown's row key (none for a lull). */
  key?: string;
  spellId?: number;
  title: string;
  what: string;
  why: string;
  cost: number;
  /** Where it starts (shown, and where Watch opens). */
  at: number;
  /** The window, for Show. */
  from: number;
  to: number;
  /** The seconds it covers (Show highlights each). */
  spans: [number, number][];
};

/** 1:05 (the Logs page's format module pulls in the app's constants). */
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

const LATE = 3;
const MISSED_WINDOW = 20;
const LULL_MIN = 15;
const BUSY_AFTER = 15;

const signed = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;

/** Sum of a per-second series over [from, to). */
const sumOver = (rates: (number | null)[], from: number, to: number) => {
  let s = 0;
  for (
    let i = Math.max(0, Math.floor(from));
    i < Math.ceil(to) && i < rates.length;
    i += 1
  )
    s += rates[i] ?? 0;
  return s;
};

/** Windows merged where they overlap. */
const union = (spans: [number, number][]) => {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  sorted.forEach(([a, b]) => {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  });
  return out;
};

export const findings = (
  you: Track,
  them: Pick<Track, 'names'>,
  aligned: Aligned,
  cooldowns: MainCd[],
  unit = 'DPS',
  max = 8,
): Finding[] => {
  const mine = perSecond(you);
  const theirs = aligned.rates;
  const end = Math.min(you.duration, aligned.end);
  const out: Finding[] = [];
  const themSide = { casts: aligned.casts, names: them.names };
  const theirAvg =
    sumOver(theirs, 0, aligned.end) / Math.max(1, Math.ceil(aligned.end));
  const raises = (casts: number[]) => {
    if (!casts.length || theirAvg <= 0) return false;
    const after =
      casts.reduce((s, t) => s + sumOver(theirs, t, t + BUSY_AFTER), 0) /
      (casts.length * BUSY_AFTER);
    return after >= theirAvg * 1.1;
  };

  cooldowns.forEach((cd) => {
    const name = cd.name || `Spell ${cd.spellId}`;
    const theirCasts = castsFor(themSide, cd);
    if (!raises(theirCasts)) return;
    const pairs: Pair[] = pairCasts(theirCasts, castsFor(you, cd));
    const both = pairs.filter((p) => p.them !== null && p.you !== null) as {
      them: number;
      you: number;
    }[];
    const late = both.filter((p) => p.you - p.them >= LATE);
    if (late.length) {
      const spans = late.map((p) => [p.them, p.you] as [number, number]);
      const drifts = late.map((p) => p.you - p.them);
      const chained =
        late.length >= 2 &&
        drifts.every((d, i) => i === 0 || d >= drifts[i - 1] - 1);
      const first = late[0];
      out.push({
        kind: 'late',
        key: cd.key,
        spellId: cd.spellId,
        title: name,
        what:
          late.length === 1
            ? `Late once: ${signed(drifts[0])} s at ${mmss(first.you)}`
            : `Late ${late.length} of ${both.length} times from ${mmss(first.them)} on: ${drifts
                .map((d) => signed(d))
                .join(', ')} s`,
        why: chained
          ? `One late ${name} pushed every later one back.`
          : `Pressed after them (theirs at ${mmss(first.them)}, yours at ${mmss(first.you)}).`,
        spans,
        cost: 0,
        at: first.them,
        from: first.them,
        to: Math.max(...spans.map((s) => s[1])),
      });
    }
    const missed = pairs.filter((p) => p.you === null && p.them !== null) as {
      them: number;
      you: null;
    }[];
    // Past our pull's end isn't missed (we were dead or done).
    const counted = missed.filter((p) => p.them < end - 2);
    if (counted.length) {
      const spans = counted.map(
        (p) => [p.them, p.them + MISSED_WINDOW] as [number, number],
      );
      const mineCount = pairs.filter((p) => p.you !== null).length;
      const theirCount = pairs.filter((p) => p.them !== null).length;
      const at = counted[0].them;
      // Why: your cast before it was late, so it wasn't ready.
      const before = both.filter((p) => p.you < at).pop();
      const lateBefore = before && before.you - before.them >= 5;
      const fewer = counted.length >= 2;
      out.push({
        kind: fewer ? 'fewer' : 'missed',
        key: cd.key,
        spellId: cd.spellId,
        title: name,
        what: fewer
          ? `${mineCount} vs their ${theirCount}; not pressed at ${counted.map((p) => mmss(p.them)).join(', ')}`
          : `${mineCount} vs their ${theirCount}; they pressed it at ${mmss(at)}`,
        why: lateBefore
          ? `Your previous one came at ${mmss(before.you)}, ${Math.round(before.you - before.them)} s late, so this one wasn't ready.`
          : 'They pressed it there and you had it ready (or didn’t press it at all).',
        spans,
        cost: 0,
        at,
        from: at,
        to: Math.max(...spans.map((s) => s[1])),
      });
    }
  });

  // Lulls: nothing main pressed by either of you in the last 15 s.
  const busy = new Array(Math.ceil(end)).fill(false);
  cooldowns.forEach((cd) => {
    [...castsFor(themSide, cd), ...castsFor(you, cd)].forEach((t) => {
      for (let i = Math.floor(t); i < t + BUSY_AFTER && i < busy.length; i += 1)
        if (i >= 0) busy[i] = true;
    });
  });
  let start = -1;
  for (let i = 0; i <= busy.length; i += 1) {
    if (i < busy.length && !busy[i] && theirs[i] !== null) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const len = i - start;
      if (len >= LULL_MIN) {
        const a = sumOver(theirs, start, i);
        const b = sumOver(mine, start, i);
        if (a > b * 1.1) {
          out.push({
            kind: 'lull',
            title: 'No cooldowns up',
            what: `${mmss(start)}–${mmss(i)}: ${compact(b / len)} vs ${compact(a / len)} ${unit}`,
            why: 'Neither of you had a main cooldown up; they kept higher filler.',
            spans: [[start, i]],
            cost: 0,
            at: start,
            from: start,
            to: i,
          });
        }
      }
      start = -1;
    }
  }

  // Each second's difference, split between the findings covering it.
  const seconds = Math.ceil(end);
  const cover = new Array(seconds).fill(0);
  const own = out.map((f) => {
    const set = new Set<number>();
    union(f.spans).forEach(([a, b]) => {
      for (
        let i = Math.max(0, Math.floor(a));
        i < Math.min(seconds, Math.ceil(b));
        i += 1
      )
        set.add(i);
    });
    set.forEach((i) => {
      cover[i] += 1;
    });
    return set;
  });
  out.forEach((f, n) => {
    let cost = 0;
    own[n].forEach((i) => {
      cost += ((theirs[i] ?? 0) - (mine[i] ?? 0)) / cover[i];
    });
    f.cost = cost;
  });

  return out
    .filter((f) => f.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, max);
};

/** Sum per kind, biggest first; for the bar. */
export const byKind = (list: Finding[]) =>
  (Object.keys(KINDS) as Kind[])
    .map((kind) => ({
      kind,
      cost: list.filter((f) => f.kind === kind).reduce((s, f) => s + f.cost, 0),
    }))
    .filter((k) => k.cost > 0);
