/**
 * [RoomFortyRecorder] Calendar helpers for the Logs page's night picker:
 * month / week grids of days, difficulty grouping and the short night
 * summary ("Mythic 9/10 · Heroic 6/6"). No React here, so it's unit tested.
 */

export type CalendarBoss = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  /** Lowest boss % of the night's wipes; null when unknown (older server). */
  bestPercent?: number | null;
  firstKillAt?: number;
};

export type CalendarNight = { night: string; bosses: CalendarBoss[] };

export type CalendarDay = {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  /** In the month being shown (month grids only; week grids are all true). */
  inMonth: boolean;
};

export const DIFFICULTY_NAME: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  233: 'Mythic', // flex Mythic (Kith'ix)
  17: 'LFR',
};
export const DIFFICULTY_ORDER = ['Mythic', 'Heroic', 'Normal', 'LFR'];

export const difficultyName = (id: number) =>
  DIFFICULTY_NAME[id] ?? `Difficulty ${id}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** A local date as YYYY-MM-DD (no time zone shift). */
export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** YYYY-MM-DD → local Date at noon (safe across DST). */
export const parseKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export const addDays = (key: string, days: number) => {
  const d = parseKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
};

/** First day of the month `months` away from the month of `key`. */
export const addMonths = (key: string, months: number) => {
  const d = parseKey(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + months, 1, 12));
};

/**
 * Whole weeks (Sunday first) covering the month of `key`: 4–6 rows of 7.
 * Days outside the month are included with inMonth false.
 */
export const monthGrid = (key: string): CalendarDay[][] => {
  const d = parseKey(key);
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1, 12);
  const start = new Date(year, month, 1 - first.getDay(), 12);
  const last = new Date(year, month + 1, 0, 12);
  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  while (cursor <= last || weeks.length === 0) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({
        date: dateKey(cursor),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

/** The Sunday-first week holding `key`. */
export const weekGrid = (key: string): CalendarDay[] => {
  const d = parseKey(key);
  const start = addDays(key, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, day: parseKey(date).getDate(), inMonth: true };
  });
};

export const monthName = (key: string) =>
  parseKey(key).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

/** Bosses that match the difficulty filter ('All' keeps every one). */
export const filterBosses = (bosses: CalendarBoss[], difficulty: string) =>
  difficulty === 'All'
    ? bosses
    : bosses.filter((b) => difficultyName(b.difficultyId) === difficulty);

/** Difficulties seen across the nights, Mythic first. */
export const difficultiesOf = (nights: CalendarNight[]) => {
  const seen = new Set<string>();
  nights.forEach((n) =>
    n.bosses.forEach((b) => seen.add(difficultyName(b.difficultyId))),
  );
  const ordered = DIFFICULTY_ORDER.filter((d) => seen.has(d));
  seen.forEach((d) => {
    if (!ordered.includes(d)) ordered.push(d);
  });
  return ordered;
};

/** A night's bosses grouped by difficulty, Mythic first, kills in order. */
export const groupByDifficulty = (bosses: CalendarBoss[]) => {
  const groups = new Map<string, CalendarBoss[]>();
  bosses.forEach((b) => {
    const name = difficultyName(b.difficultyId);
    groups.set(name, [...(groups.get(name) ?? []), b]);
  });
  const rank = (name: string) => {
    const i = DIFFICULTY_ORDER.indexOf(name);
    return i < 0 ? DIFFICULTY_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([name, list]) => ({
      name,
      bosses: [...list].sort(
        (a, b) => (a.firstKillAt ?? Infinity) - (b.firstKillAt ?? Infinity),
      ),
    }));
};

/** "Mythic 9/10 · Heroic 6/6": bosses killed / bosses tried per difficulty. */
export const nightSummary = (bosses: CalendarBoss[]) =>
  groupByDifficulty(bosses)
    .map(
      (g) =>
        `${g.name} ${g.bosses.filter((b) => b.kills > 0).length}/${
          g.bosses.length
        }`,
    )
    .join(' · ');

/** "Kill", the best wipe % ("12%"), or the pull count when that's unknown. */
export const bossResult = (b: CalendarBoss) => {
  if (b.kills > 0) return 'Kill';
  if (b.bestPercent !== null && b.bestPercent !== undefined) {
    return `${Math.round(b.bestPercent * 10) / 10}%`;
  }
  return b.pulls === 1 ? '1 pull' : `${b.pulls} pulls`;
};

/**
 * The raid night before (-1, older) or after (+1, newer) `night`, among the
 * nights that still have bosses under the filter. Nights come newest first.
 */
export const stepNight = (
  nights: CalendarNight[],
  night: string,
  dir: -1 | 1,
  difficulty = 'All',
) => {
  const usable = nights
    .filter((n) => filterBosses(n.bosses, difficulty).length > 0)
    .map((n) => n.night)
    .sort();
  if (!usable.length) return null;
  if (dir < 0) {
    const older = usable.filter((d) => d < night);
    return older.length ? older[older.length - 1] : null;
  }
  return usable.find((d) => d > night) ?? null;
};
