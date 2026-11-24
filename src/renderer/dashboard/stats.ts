/**
 * [RoomFortyRecorder] The numbers on the Dashboard's stat tiles (Raid DPS,
 * Deaths, Avoidable hits, Consumables). Pure, so each rule is unit tested.
 * A stat returns null when the data isn't there, and the tile is hidden
 * rather than showing a made-up 0.
 */
import { formatDuration } from '../format';

export type Stat = {
  /** The big number, already formatted. */
  value: string;
  /** The small muted line under it ('' for none). */
  note: string;
};

/**
 * Raid damage per second: everyone's damage added up over the pull's
 * length. Null when there is no damage or no length to divide by.
 */
export const raidDpsStat = (
  data: { duration: number; damage: { total: number }[] } | null | undefined,
  // The page's number format (logs/format `compact`); passed in so this
  // file stays free of app imports.
  compact: (n: number) => string,
): Stat | null => {
  if (!data || !(data.duration > 0) || !data.damage?.length) return null;
  const total = data.damage.reduce((n, row) => n + row.total, 0);
  if (!(total > 0)) return null;
  return {
    value: compact(total / data.duration),
    note: `${compact(total)} damage in ${formatDuration(data.duration)}`,
  };
};

export const deathsStat = (deaths: { t: number }[]): Stat => {
  if (!deaths.length) return { value: '0', note: 'no deaths' };
  const first = Math.min(...deaths.map((d) => d.t));
  return {
    value: String(deaths.length),
    note: `first at ${formatDuration(first)}`,
  };
};

type AvoidableRow = {
  hits: number;
  bySpell: Record<string, number>;
  spells?: { spellId: number; spellName: string | null; hits: number }[];
};

/** Every avoidable hit the raiders took (the tile and the tab badge). */
export const avoidableTotal = (rows: { hits: number }[]) =>
  rows.reduce((n, row) => n + row.hits, 0);

/** Hits taken from avoidable spells, and the spell that landed most. */
export const avoidableStat = (
  rows: AvoidableRow[],
  spellNames: Record<string, string | null> = {},
): Stat => {
  const total = avoidableTotal(rows);
  if (!total) return { value: '0', note: 'none' };

  const bySpell = new Map<string, { name: string; hits: number }>();
  const add = (id: string, name: string | null, hits: number) => {
    const known = bySpell.get(id);
    bySpell.set(id, {
      name: known?.name || name || `Spell ${id}`,
      hits: (known?.hits ?? 0) + hits,
    });
  };
  rows.forEach((row) => {
    if (row.spells) {
      row.spells.forEach((s) => add(String(s.spellId), s.spellName, s.hits));
    } else {
      Object.entries(row.bySpell).forEach(([id, hits]) =>
        add(id, spellNames[id] ?? null, hits),
      );
    }
  });
  const top = [...bySpell.values()].sort((a, b) => b.hits - a.hits)[0];
  return {
    value: String(total),
    note: top ? `${top.hits} on ${top.name}` : '',
  };
};

type PrepLike = { players: { food: string | null; flask: string | null }[] };

/** Raiders with both flask and food, of everyone in the pull. */
export const consumablesStat = (prep: PrepLike | null | undefined) => {
  if (!prep || !prep.players.length) return null;
  const of = prep.players.length;
  const noFood = prep.players.filter((p) => !p.food).length;
  const noFlask = prep.players.filter((p) => !p.flask).length;
  const ready = prep.players.filter((p) => p.food && p.flask).length;
  const parts = [
    noFlask ? `${noFlask} missing flask` : '',
    noFood ? `${noFood} missing food` : '',
  ].filter(Boolean);
  return {
    value: `${ready} / ${of}`,
    note: parts.length ? parts.join(', ') : 'all flasks and food',
  } satisfies Stat;
};
