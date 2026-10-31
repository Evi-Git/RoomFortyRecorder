/**
 * [RoomFortyRecorder] Time trial "One timeline" (1.9.102): the math behind
 * the shared time axis, kept pure for tests
 * (src/__tests__/renderer/trialTimeline.test.ts).
 *
 * - Main cooldowns merge by name (one spell can have several IDs).
 * - Their casts pair with ours (nearest within 40 s): +N s, missed, extra.
 * - DPS as a 5 s average, and the gap so far.
 * - Phases: theirs from Warcraft Logs; ours found in our own log from the
 *   enemy ability that marks each of their phase starts.
 * - "Line up by each phase": their timeline shifted so each phase starts
 *   when ours did.
 */
import { enemyInfo } from '../logs/query';
import { F, K, PullStore } from '../logs/store';
import type { Cooldown, Track } from './trial';

const norm = (s: string) => s.trim().toLowerCase();

/** A main cooldown: every spell ID it goes by, under one name. */
export type MainCd = {
  key: string;
  name: string;
  /** The ID to show (pressed most). */
  spellId: number;
  spellIds: number[];
  cooldown: number | null;
};

/**
 * One row per name. The server merges by name since 1.9.102; this also
 * merges an older server's list once the names are known.
 */
export const mergeByName = (
  cooldowns: (Cooldown & { spellIds?: number[]; name?: string })[],
  names: Record<number, string> = {},
): MainCd[] => {
  const out: MainCd[] = [];
  const byKey = new Map<string, MainCd>();
  cooldowns.forEach((c) => {
    const name = c.name || names[c.spellId] || '';
    const key = name ? `n:${norm(name)}` : `#${c.spellId}`;
    const ids = c.spellIds?.length ? c.spellIds : [c.spellId];
    const known = byKey.get(key);
    if (known) {
      ids.forEach((id) => {
        if (!known.spellIds.includes(id)) known.spellIds.push(id);
      });
      if (
        c.cooldown !== null &&
        (known.cooldown === null || c.cooldown < known.cooldown)
      )
        known.cooldown = c.cooldown;
      return;
    }
    const row = {
      key,
      name,
      spellId: c.spellId,
      spellIds: [...ids],
      cooldown: c.cooldown,
    };
    byKey.set(key, row);
    out.push(row);
  });
  return out;
};

/** A cast counts for a cooldown by ID, or by name (our IDs can differ). */
export const isCastOf = (
  cd: MainCd,
  id: number,
  names?: Record<number, string>,
) =>
  cd.spellIds.includes(id) ||
  Boolean(cd.name && names?.[id] && norm(names[id]) === norm(cd.name));

/** When a track pressed a cooldown, sorted. */
export const castsFor = (track: Pick<Track, 'casts' | 'names'>, cd: MainCd) =>
  track.casts
    .filter(([, id]) => isCastOf(cd, id, track.names))
    .map(([t]) => t)
    .sort((a, b) => a - b);

export type Pair = { them: number | null; you: number | null };

/**
 * Each of their casts with our nearest unused cast within `within` seconds;
 * ours left over are extras. In time order.
 */
export const pairCasts = (
  theirs: number[],
  mine: number[],
  within = 40,
): Pair[] => {
  const used = new Set<number>();
  const pairs: Pair[] = theirs.map((t) => {
    let best = -1;
    mine.forEach((y, i) => {
      if (used.has(i) || Math.abs(y - t) > within) return;
      if (best < 0 || Math.abs(y - t) < Math.abs(mine[best] - t)) best = i;
    });
    if (best >= 0) used.add(best);
    return { them: t, you: best >= 0 ? mine[best] : null };
  });
  mine.forEach((y, i) => {
    if (!used.has(i)) pairs.push({ them: null, you: y });
  });
  return pairs.sort((a, b) => (a.them ?? a.you ?? 0) - (b.them ?? b.you ?? 0));
};

/** "+5 s", "−3 s", "on time", "missed". */
export const driftText = (d: number | null) => {
  if (d === null) return 'missed';
  const r = Math.round(d);
  if (r === 0) return 'on time';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)} s`;
};

/** Per-second amounts from a cumulative track. */
export const perSecond = (track: Track): number[] =>
  track.amounts.map((v, i) => v - (i ? track.amounts[i - 1] : 0));

/** Trailing average over `w` seconds; null stays null (no data there). */
export const smooth = (rates: (number | null)[], w = 5) =>
  rates.map((v, i) => {
    if (v === null) return null;
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - w + 1); k <= i; k += 1) {
      const r = rates[k];
      if (r !== null && r !== undefined) {
        sum += r;
        n += 1;
      }
    }
    return n ? sum / n : null;
  });

/** You minus them, cumulative, over the seconds both have data. */
export const gapSoFar = (you: (number | null)[], them: (number | null)[]) => {
  const n = Math.max(you.length, them.length);
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const y = you[i];
    const t = them[i];
    if (y !== null && y !== undefined && t !== null && t !== undefined)
      sum += y - t;
    out.push(sum);
  }
  return out;
};

export type Phase = { name: string; short: string; from: number; to: number };

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/** "Stage Two" -> "P2", "Intermission 1" -> "Int 1". */
export const shortPhase = (name: string) => {
  const inter = /intermission\s*(\w+)?/i.exec(name);
  if (inter)
    return inter[1]
      ? `Int ${WORDS[inter[1].toLowerCase()] ?? inter[1]}`
      : 'Int';
  const m = /(?:stage|phase|p)\s*(\w+)/i.exec(name);
  if (m) return `P${WORDS[m[1].toLowerCase()] ?? m[1]}`;
  return name.length > 6 ? `${name.slice(0, 5)}…` : name;
};

/** Their phases from Warcraft Logs' phase transitions. */
export const phasesOf = (track: Track): Phase[] => {
  const list = [...(track.phases ?? [])].sort((a, b) => a[0] - b[0]);
  if (list.length < 2) return [];
  return list.map(([from, id], i) => {
    const name = track.phaseNames?.[String(id)] || `Phase ${i + 1}`;
    return {
      name,
      short: shortPhase(name),
      from: i === 0 ? 0 : from,
      to: i + 1 < list.length ? list[i + 1][0] : track.duration,
    };
  });
};

/** Enemy (not raider-side) successful casts in our log: spell ID -> times. */
export const enemyCasts = (store: PullStore) => {
  const out = new Map<number, number[]>();
  for (let i = 0; i < store.n; i += 1) {
    if (store.k[i] === K.CAST) {
      const s = store.s[i];
      const u = s >= 0 ? store.units[s] : undefined;
      if (u && !u.player && !u.friendly && !store.units[u.root]?.player) {
        const spell = store.spells[store.sp[i]];
        if (spell) {
          const list = out.get(spell.id) ?? [];
          list.push(store.t[i]);
          out.set(spell.id, list);
        }
      }
    }
  }
  return out;
};

/**
 * Where each of their phases started in our pull. For each of their phase
 * starts, an enemy ability first cast just after it (and not in the phase
 * before) marks it; our phase starts that long before our first cast of it.
 * Phases we never reached (or can't find) are left out.
 */
export const ourPhases = (
  them: Track,
  ours: Map<number, number[]>,
  duration: number,
): Phase[] => {
  const theirs = phasesOf(them);
  if (theirs.length < 2 || !them.enemy?.length) return [];
  const byId = new Map<number, number[]>();
  them.enemy.forEach(([t, id]) => {
    const list = byId.get(id) ?? [];
    list.push(t);
    byId.set(id, list);
  });
  byId.forEach((l) => l.sort((a, b) => a - b));
  const starts = [0];
  for (let k = 1; k < theirs.length; k += 1) {
    const T = theirs[k].from;
    const prev = theirs[k - 1].from;
    const candidates: { id: number; offset: number; fresh: boolean }[] = [];
    byId.forEach((times, id) => {
      const after = times.find((t) => t >= T - 1);
      if (after === undefined || after > T + 30) return;
      if (times.some((t) => t >= prev && t < T - 1)) return;
      candidates.push({ id, offset: after - T, fresh: times[0] >= T - 1 });
    });
    candidates.sort(
      (a, b) => Number(b.fresh) - Number(a.fresh) || a.offset - b.offset,
    );
    const ourPrev = starts[k - 1];
    let found: number | null = null;
    candidates.some((c) => {
      const mine = ours.get(c.id)?.find((t) => t > ourPrev + 1);
      if (mine === undefined) return false;
      const start = Math.max(ourPrev + 1, mine - Math.max(0, c.offset));
      found = Math.round(start * 10) / 10;
      return true;
    });
    if (found === null) break;
    starts.push(found);
  }
  return starts.map((from, i) => ({
    name: theirs[i].name,
    short: theirs[i].short,
    from,
    to: i + 1 < starts.length ? starts[i + 1] : duration,
  }));
};

/** Their side on our time axis: casts and per-second amounts. */
export type Aligned = {
  casts: [number, number][];
  rates: (number | null)[];
  /** Their phases, moved. */
  phases: Phase[];
  end: number;
};

/** Pull start: as it happened. */
export const asIs = (them: Track): Aligned => ({
  casts: them.casts,
  rates: perSecond(them),
  phases: phasesOf(them),
  end: them.duration,
});

/**
 * Each phase: their phase k moved to start when our phase k did (phases we
 * didn't reach keep the last known shift). Where a longer phase of theirs
 * runs into the next one, the next one wins; empty seconds are null.
 */
export const alignByPhase = (them: Track, ours: Phase[]): Aligned => {
  const theirs = phasesOf(them);
  if (theirs.length < 2 || ours.length < 2) return asIs(them);
  const shift = theirs.map((p, k) => {
    const known = ours[Math.min(k, ours.length - 1)];
    const at = Math.min(k, ours.length - 1);
    return known.from - theirs[at].from;
  });
  const phaseAt = (t: number) => {
    let k = 0;
    while (k + 1 < theirs.length && t >= theirs[k + 1].from) k += 1;
    return k;
  };
  const casts = them.casts
    .map(
      ([t, id]) =>
        [Math.round((t + shift[phaseAt(t)]) * 10) / 10, id] as [number, number],
    )
    .sort((a, b) => a[0] - b[0]);
  const per = perSecond(them);
  const end = Math.max(...theirs.map((p, k) => p.to + shift[k]), them.duration);
  const rates: (number | null)[] = new Array(Math.ceil(end)).fill(null);
  theirs.forEach((p, k) => {
    for (
      let s = Math.floor(p.from);
      s < Math.ceil(p.to) && s < per.length;
      s += 1
    ) {
      const at = Math.floor(s + shift[k]);
      if (at >= 0 && at < rates.length) rates[at] = per[s];
    }
  });
  return {
    casts,
    rates,
    phases: theirs.map((p, k) => ({
      ...p,
      from: p.from + shift[k],
      to: p.to + shift[k],
    })),
    end,
  };
};

export type BossCast = { t: number; spellId: number; name: string };

/** Our boss's casts (the bosses: most health, few of them). */
export const bossCasts = (store: PullStore): BossCast[] => {
  const { bosses } = enemyInfo(store);
  const out: BossCast[] = [];
  const last = new Map<number, number>();
  for (let i = 0; i < store.n; i += 1) {
    if (store.k[i] === K.CAST && !(store.f[i] & F.PROC)) {
      const u = store.units[store.s[i]];
      if (u && !u.player && bosses.has(u.npcId)) {
        const spell = store.spells[store.sp[i]];
        const t = store.t[i];
        // Several bosses casting the same thing at once: one mark.
        if (spell && !(t - (last.get(spell.id) ?? -9) < 1.5)) {
          last.set(spell.id, t);
          out.push({
            t: Math.round(t * 10) / 10,
            spellId: spell.id,
            name: spell.name,
          });
        }
      }
    }
  }
  return out;
};

/** The phase a time falls in. */
export const phaseAt = (phases: Phase[], t: number) =>
  phases.find((p) => t >= p.from && t < p.to) ?? phases[phases.length - 1];
