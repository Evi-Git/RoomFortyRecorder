/**
 * [RoomFortyRecorder] The numbers on the Dashboard's stat tiles (Raid DPS,
 * Deaths, Avoidable hits, Consumables). Pure, so each rule is unit tested.
 * A stat returns null when the data isn't there, and the tile is hidden
 * rather than showing a made-up 0.
 */

export type Stat = {
  /** The big number, already formatted. */
  value: string;
  /** The small muted line under it ('' for none). */
  note: string;
};

const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** 1820000 -> "1.82M", 94300 -> "94.3k", 812 -> "812". */
export const compactRate = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

/**
 * Raid damage per second: everyone's damage added up over the pull's
 * length. Null when there is no damage or no length to divide by.
 */
export const raidDpsStat = (
  data: { duration: number; damage: { total: number }[] } | null | undefined,
): Stat | null => {
  if (!data || !(data.duration > 0) || !data.damage?.length) return null;
  const total = data.damage.reduce((n, row) => n + row.total, 0);
  if (!(total > 0)) return null;
  return {
    value: compactRate(total / data.duration),
    note: `${compactRate(total)} damage in ${mmss(data.duration)}`,
  };
};

export const deathsStat = (deaths: { t: number }[]): Stat => {
  if (!deaths.length) return { value: '0', note: 'no deaths' };
  const first = Math.min(...deaths.map((d) => d.t));
  return { value: String(deaths.length), note: `first at ${mmss(first)}` };
};

type AvoidableRow = {
  hits: number;
  bySpell: Record<string, number>;
  spells?: { spellId: number; spellName: string | null; hits: number }[];
};

/** Hits taken from avoidable spells, and the spell that landed most. */
export const avoidableStat = (
  rows: AvoidableRow[],
  spellNames: Record<string, string | null> = {},
): Stat => {
  const total = rows.reduce((n, row) => n + row.hits, 0);
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
