/**
 * The Logs page's boss strip: one portrait per boss of the season (raid
 * order) plus a difficulty switch, instead of a dropdown. Pure helpers,
 * tested in src/__tests__/renderer/bossStripModel.test.ts.
 */
import { difficultyName } from './nightCalendar';

export type SeasonBoss = {
  encounterId: number;
  name: string;
  /** False for a boss we only know from old pulls (another raid). */
  inZone?: boolean;
};

/**
 * The current raid's bosses only. The server also lists every other boss we
 * ever pulled (older raids, world bosses) so nothing goes missing; those show
 * on the strip only on a night they were pulled (see stripItems). If the
 * server doesn't know the raid, everything it listed is kept.
 */
export const zoneBosses = (list: SeasonBoss[]) => {
  const inZone = list.filter((b) => b.inZone !== false);
  return inZone.length ? inZone : list;
};

export type StripNightBoss = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  bestPercent?: number | null;
};

export type StripItem<B extends StripNightBoss = StripNightBoss> = {
  encounterId: number;
  name: string;
  /** This night's pulls on it at the shown difficulty, or null if none. */
  boss: B | null;
};

/** Switch order, left to right (as wowutils: Heroic then Mythic). */
export const MODE_ORDER = ['LFR', 'Normal', 'Heroic', 'Mythic'];

export const bossKey = (b: { encounterId: number; difficultyId: number }) =>
  `${b.encounterId}:${b.difficultyId}`;

/** Difficulty modes the switch shows: Heroic and Mythic always, then any other the night has. */
export const stripModes = (night: StripNightBoss[]) => {
  const have = new Set(night.map((b) => difficultyName(b.difficultyId)));
  return MODE_ORDER.filter(
    (m) => m === 'Heroic' || m === 'Mythic' || have.has(m),
  ).map((mode) => ({
    mode,
    count: night.filter((b) => difficultyName(b.difficultyId) === mode).length,
  }));
};

/**
 * The strip's icons for one difficulty mode: the season's bosses in order,
 * then any boss pulled this night that isn't in the season list. Two
 * difficulties of one mode (Mythic and flex Mythic) keep the busier one.
 */
export const stripItems = <B extends StripNightBoss>(
  season: SeasonBoss[],
  night: B[],
  mode: string,
): StripItem<B>[] => {
  const inMode = new Map<number, B>();
  night
    .filter((b) => difficultyName(b.difficultyId) === mode)
    .forEach((b) => {
      const seen = inMode.get(b.encounterId);
      if (!seen || b.pulls > seen.pulls) inMode.set(b.encounterId, b);
    });
  const items: StripItem<B>[] = season.map((s) => ({
    encounterId: s.encounterId,
    name: s.name,
    boss: inMode.get(s.encounterId) ?? null,
  }));
  const listed = new Set(season.map((s) => s.encounterId));
  const extra = new Map<number, string>();
  night.forEach((b) => {
    if (!listed.has(b.encounterId) && !extra.has(b.encounterId)) {
      extra.set(b.encounterId, b.encounterName);
    }
  });
  extra.forEach((name, encounterId) =>
    items.push({ encounterId, name, boss: inMode.get(encounterId) ?? null }),
  );
  return items;
};

/**
 * Which boss to show after switching to `mode`: the same boss if it was
 * pulled at that difficulty, else the one with the most pulls there.
 */
export const pickForMode = <B extends StripNightBoss>(
  night: B[],
  mode: string,
  encounterId: number | null,
): B | null => {
  const inMode = night.filter((b) => difficultyName(b.difficultyId) === mode);
  const same = inMode
    .filter((b) => b.encounterId === encounterId)
    .sort((a, b) => b.pulls - a.pulls)[0];
  return same ?? [...inMode].sort((a, b) => b.pulls - a.pulls)[0] ?? null;
};

/** The hover line for a boss: "Kill", best %, or pulls. */
export const stripSummary = (b: StripNightBoss) => {
  const pulls = `${b.pulls} ${b.pulls === 1 ? 'pull' : 'pulls'}`;
  if (b.kills > 0) return `Kill · ${pulls}`;
  if (b.bestPercent !== null && b.bestPercent !== undefined) {
    return `Best ${b.bestPercent}% · ${pulls}`;
  }
  return pulls;
};

/** Initials for a boss with no portrait ("Coiled Altar" -> "CA"). */
export const initials = (name: string) =>
  name
    .replace(/^the\s+/i, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
