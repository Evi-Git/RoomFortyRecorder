import { DAMAGE_REDUCTION } from '../../parsing/PullMeters';
import { F, K, PullStore, Unit } from './store';
import type { PassiveDr } from './talents';

/**
 * [RoomFortyRecorder] Logs page: tables worked out from one or more pulls'
 * event stores, with the page's filters. Several pulls add up (laid end to
 * end on one timeline, like Warcraft Logs' "multiple fights").
 */

export type Side = 'friendly' | 'enemy';

export type Filters = {
  /** Seconds on the combined timeline; null = everything. */
  range: [number, number] | null;
  side: Side;
  /** List pets on their own rows (else they count for their owner). */
  pets: boolean;
  /** Enemies hit (or, for damage taken, hitting): see EnemyFilter. */
  enemy: EnemyFilter | null;
  /** Abilities (spell IDs); empty = all. */
  abilities: number[];
  /** Stop counting each pull after this many raider deaths (0 = off). */
  deathCutoff: number;
  /** Extra condition from the filter expression. */
  expr: ((p: PullStore, i: number) => boolean) | null;
};

export const DEFAULT_FILTERS: Filters = {
  range: null,
  side: 'friendly',
  pets: false,
  enemy: null,
  abilities: [],
  deathCutoff: 0,
  expr: null,
};

/**
 * Which enemies: bosses, everything else, or one kind of NPC (by creature
 * ID), optionally one spawn wave ("group") or one instance of it.
 */
export type EnemyFilter =
  | { kind: 'bosses' }
  | { kind: 'adds' }
  | {
      kind: 'npc';
      npcId: number;
      name: string;
      group?: number;
      instance?: number;
    };

type EnemyInfo = {
  bosses: Set<number>;
  /** unit -> [instance number, group number], 1-based, by NPC ID. */
  spawn: Map<number, [number, number]>;
};
const enemyInfos = new WeakMap<PullStore, EnemyInfo>();

/** Bosses (the most health), and each NPC's spawn order and waves. */
export const enemyInfo = (p: PullStore): EnemyInfo => {
  const known = enemyInfos.get(p);
  if (known) return known;
  const hostile = p.units
    .map((u, i) => ({ u, i }))
    // Enemies, including ones the boss summoned (not raiders' pets).
    .filter(
      ({ u }) => !u.player && !u.friendly && !p.units[u.root].player && u.npcId,
    );
  const top = Math.max(0, ...hostile.map(({ u }) => u.maxHp));
  const bosses = new Set<number>();
  if (p.boss >= 0 && p.units[p.boss].npcId) bosses.add(p.units[p.boss].npcId);
  // Bosses: lots of health, and only one or a few of them (not 30 adds).
  const copies = new Map<number, number>();
  hostile.forEach(({ u }) =>
    copies.set(u.npcId, (copies.get(u.npcId) ?? 0) + 1),
  );
  hostile.forEach(({ u }) => {
    if (top && u.maxHp >= top * 0.3 && (copies.get(u.npcId) ?? 0) <= 3)
      bosses.add(u.npcId);
  });
  const byNpc = new Map<number, number[]>();
  hostile.forEach(({ u, i }) => {
    const list = byNpc.get(u.npcId) ?? [];
    list.push(i);
    byNpc.set(u.npcId, list);
  });
  const spawn = new Map<number, [number, number]>();
  byNpc.forEach((list) => {
    list.sort((a, b) => p.units[a].first - p.units[b].first);
    let group = 0;
    let last = -Infinity;
    list.forEach((unit, n) => {
      // More than 8 seconds after the last one: a new wave.
      if (p.units[unit].first - last > 8) group += 1;
      last = p.units[unit].first;
      spawn.set(unit, [n + 1, group]);
    });
  });
  const info = { bosses, spawn };
  enemyInfos.set(p, info);
  return info;
};

/** Does this (enemy) unit pass the enemy filter? */
export const enemyOk = (ctx: Ctx, p: PullStore, unit: number) => {
  const f = ctx.filters.enemy;
  if (!f) return true;
  if (unit < 0) return false;
  // The enemy itself (adds the boss summoned are their own enemies).
  const root = unit;
  const u = p.units[root];
  const info = enemyInfo(p);
  if (f.kind === 'bosses') return info.bosses.has(u.npcId);
  if (f.kind === 'adds') return !u.player && !info.bosses.has(u.npcId);
  if (u.npcId !== f.npcId) return false;
  const at = info.spawn.get(root);
  if (f.instance && at?.[0] !== f.instance) return false;
  if (f.group && at?.[1] !== f.group) return false;
  return true;
};

/** Does this spell pass the abilities filter? */
export const abilityOk = (ctx: Ctx, spellId: number | undefined) =>
  !ctx.filters.abilities.length ||
  (spellId !== undefined && ctx.filters.abilities.includes(spellId));

export type EnemyOption = {
  npcId: number;
  name: string;
  boss: boolean;
  instances: number;
  groups: number;
};

/** NPCs in the pulls (for the enemy picker): bosses first, then most hit. */
export const enemyOptions = (pulls: PullStore[]): EnemyOption[] => {
  const out = new Map<number, EnemyOption & { hits: number }>();
  pulls.forEach((p) => {
    const info = enemyInfo(p);
    const hits = new Float64Array(p.units.length);
    for (let i = 0; i < p.n; i += 1) {
      if (p.k[i] === K.DMG && p.d[i] >= 0) hits[p.d[i]] += p.a[i] + p.b[i];
    }
    p.units.forEach((u, i) => {
      if (u.player || u.friendly || p.units[u.root].player || !u.npcId) return;
      if (!hits[i] && !info.bosses.has(u.npcId)) return;
      const o = out.get(u.npcId) ?? {
        npcId: u.npcId,
        name: u.name,
        boss: info.bosses.has(u.npcId),
        instances: 0,
        groups: 0,
        hits: 0,
      };
      const at = info.spawn.get(i);
      if (at) {
        o.instances = Math.max(o.instances, at[0]);
        o.groups = Math.max(o.groups, at[1]);
      }
      o.hits += hits[i];
      out.set(u.npcId, o);
    });
  });
  return [...out.values()]
    .sort((a, b) => Number(b.boss) - Number(a.boss) || b.hits - a.hits)
    .map((o) => ({
      npcId: o.npcId,
      name: o.name,
      boss: o.boss,
      instances: o.instances,
      groups: o.groups,
    }));
};

export type Ctx = {
  pulls: PullStore[];
  offsets: number[];
  total: number;
  filters: Filters;
};

export const makeCtx = (pulls: PullStore[], filters: Filters): Ctx => {
  const offsets: number[] = [];
  let total = 0;
  pulls.forEach((p) => {
    offsets.push(total);
    total += p.duration;
  });
  return { pulls, offsets, total, filters };
};

/** Seconds the current view covers (the slice, deaths cut-off applied). */
export const viewSeconds = (ctx: Ctx) => {
  let sum = 0;
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    sum += Math.max(0, to - from);
  });
  return Math.max(1, sum);
};

/** The [from, to) seconds of pull `pi` (its own clock) in view. */
export const window_ = (ctx: Ctx, pi: number): [number, number] => {
  const p = ctx.pulls[pi];
  const off = ctx.offsets[pi];
  let from = 0;
  let to = p.duration;
  if (ctx.filters.range) {
    from = Math.max(from, ctx.filters.range[0] - off);
    to = Math.min(to, ctx.filters.range[1] - off);
  }
  const cut = ctx.filters.deathCutoff;
  if (cut > 0 && p.deaths.length >= cut) to = Math.min(to, p.deaths[cut - 1].t);
  return [from, Math.max(from, to)];
};

/** Calls `fn` for each event in view, with its time on the combined timeline. */
export const scan = (
  ctx: Ctx,
  fn: (p: PullStore, i: number, at: number, pi: number) => void,
  opts: { kinds?: number[]; ignoreExpr?: boolean } = {},
) => {
  const wanted = opts.kinds ? new Set(opts.kinds) : null;
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    const off = ctx.offsets[pi];
    const { expr } = ctx.filters;
    for (let i = 0; i < p.n; i += 1) {
      const t = p.t[i];
      if (t < from) continue;
      if (t > to) break;
      if (wanted && !wanted.has(p.k[i])) continue;
      if (expr && !opts.ignoreExpr && !expr(p, i)) continue;
      fn(p, i, off + t, pi);
    }
  });
};

/* ------------------------------------------------------------------ */
/* Who a row is                                                        */
/* ------------------------------------------------------------------ */

export type RowRef = {
  key: string;
  name: string;
  specId: number;
  player: boolean;
  pet: boolean;
};

/** The row a unit's actions go to: the raider (or pet), or the enemy by name. */
export const rowOf = (
  p: PullStore,
  unit: number,
  pets: boolean,
): RowRef | null => {
  if (unit < 0) return null;
  const u: Unit = p.units[unit];
  const root = p.units[u.root];
  if (root.player) {
    if (pets && unit !== u.root) {
      return {
        key: `pet:${root.name}:${u.name}`,
        name: `${u.name} (${root.name})`,
        specId: root.specId,
        player: false,
        pet: true,
      };
    }
    return {
      key: root.guid,
      name: root.name,
      specId: root.specId,
      player: true,
      pet: false,
    };
  }
  // Enemies by their own name (adds the boss summoned are their own rows).
  return {
    key: `npc:${u.name}`,
    name: u.name || 'Unknown',
    specId: 0,
    player: false,
    pet: false,
  };
};

const isRaiderSide = (p: PullStore, unit: number) =>
  unit >= 0 && p.units[p.units[unit].root].raider;
const isEnemy = (p: PullStore, unit: number) =>
  unit >= 0 && !p.units[unit].friendly && !p.units[p.units[unit].root].raider;

/* ------------------------------------------------------------------ */
/* Damage done, healing, damage taken                                  */
/* ------------------------------------------------------------------ */

export type Meter = 'damage' | 'healing' | 'taken';

export type AbilityRow = {
  key: string;
  spellId: number;
  name: string;
  /** Pet or guardian that did it, if not the raider. */
  by: string;
  total: number;
  hits: number;
  crits: number;
  ticks: number;
  casts: number;
  misses: number;
  overheal: number;
  absorbed: number;
  mitigated: number;
  /** Debuff uptime on targets (DoTs), seconds. */
  uptime: number;
  /** Healing: a heal, a shield, or damage prevented (for the bar's look). */
  kind?: 'heal' | 'shield' | 'prevented';
  /**
   * Who it came from and who it was for, by name, when there are no events
   * to look it up from (damage prevented is worked out, not logged).
   */
  split?: { sources: Map<string, number>; targets: Map<string, number> };
};

export type MeterRow = RowRef & {
  total: number;
  /** Of total: done by pets. */
  pets: number;
  overheal: number;
  mitigated: number;
  /** Healing: of total, shields (absorbs) and damage prevented. */
  shields: number;
  prevented: number;
  /** Seconds active (casting or hitting). */
  active: number;
  abilities: Map<string, AbilityRow>;
  series: Float64Array;
};

const SERIES_STEP = 1; // seconds per chart point

const newAbility = (
  key: string,
  spellId: number,
  name: string,
  by: string,
): AbilityRow => ({
  key,
  spellId,
  name,
  by,
  total: 0,
  hits: 0,
  crits: 0,
  ticks: 0,
  casts: 0,
  misses: 0,
  overheal: 0,
  absorbed: 0,
  mitigated: 0,
  uptime: 0,
});

/** Does event i belong in this meter, and whose row (by unit) is it. */
const meterUnit = (ctx: Ctx, p: PullStore, i: number, meter: Meter): number => {
  const { side, enemy } = ctx.filters;
  const kind = p.k[i];
  if (!abilityOk(ctx, p.spells[p.sp[i]]?.id)) return -1;
  const s = p.s[i];
  const d = p.d[i];
  if (meter === 'damage') {
    if (kind !== K.DMG) return -1;
    if (side === 'friendly') {
      if (!isRaiderSide(p, s) || !isEnemy(p, d)) return -1;
      if (enemy && !enemyOk(ctx, p, d)) return -1;
    } else {
      if (!isEnemy(p, s) || !isRaiderSide(p, d)) return -1;
      if (enemy && !enemyOk(ctx, p, s)) return -1;
    }
    return s;
  }
  if (meter === 'healing') {
    if (kind !== K.HEAL && kind !== K.ABSORB) return -1;
    if (side === 'friendly' ? !isRaiderSide(p, s) : !isEnemy(p, s)) return -1;
    if (kind === K.HEAL && side === 'friendly' && !p.units[d]?.friendly)
      return -1;
    if (enemy && side === 'enemy' && !enemyOk(ctx, p, s)) return -1;
    return s;
  }
  // Taken: by who was hit.
  if (kind !== K.DMG) return -1;
  if (side === 'friendly') {
    if (d < 0 || !p.units[d].raider) return -1;
  } else if (!isEnemy(p, d)) return -1;
  if (enemy && !enemyOk(ctx, p, side === 'friendly' ? s : d)) return -1;
  return d;
};

/** Raiders' (or enemies') rows for one meter. */
export const meterRows = (ctx: Ctx, meter: Meter): MeterRow[] => {
  const rows = new Map<string, MeterRow>();
  const points = Math.max(1, Math.ceil(ctx.total / SERIES_STEP));
  const pets = ctx.filters.pets && meter !== 'taken';
  // Active time: [t, t + 1.5] windows per row (a global cooldown after
  // each cast or hit), merged, and never past the end of what's in view.
  const activity = new Map<string, [number, number][]>();
  const ends = ctx.pulls.map((_, pi) => ctx.offsets[pi] + window_(ctx, pi)[1]);
  const starts = ctx.pulls.map(
    (_, pi) => ctx.offsets[pi] + window_(ctx, pi)[0],
  );
  const touch = (key: string, at: number, pi: number) => {
    const start = Math.max(at, starts[pi]);
    const end = Math.min(at + 1.5, ends[pi]);
    if (end <= start) return;
    const list = activity.get(key) ?? [];
    list.push([start, end]);
    activity.set(key, list);
  };

  scan(
    ctx,
    (p, i, at, pi) => {
      const unit = meterUnit(ctx, p, i, meter);
      if (unit < 0) return;
      const ref = rowOf(p, unit, pets);
      if (!ref) return;
      let row = rows.get(ref.key);
      if (!row) {
        row = {
          ...ref,
          total: 0,
          pets: 0,
          overheal: 0,
          mitigated: 0,
          shields: 0,
          prevented: 0,
          active: 0,
          abilities: new Map(),
          series: new Float64Array(points),
        };
        rows.set(ref.key, row);
      }
      const kind = p.k[i];
      const amount =
        kind === K.DMG
          ? p.a[i] + p.b[i]
          : kind === K.HEAL
            ? p.a[i] + p.b[i]
            : p.a[i];
      const spell = p.spells[p.sp[i]];
      const fromPet =
        meter !== 'taken' && unit !== p.units[unit].root && !pets
          ? p.units[unit].name
          : '';
      const aKey = `${spell?.id ?? 0}|${fromPet}`;
      let ab = row.abilities.get(aKey);
      if (!ab) {
        ab = newAbility(aKey, spell?.id ?? 0, spell?.name ?? '?', fromPet);
        row.abilities.set(aKey, ab);
      }
      ab.total += amount;
      ab.hits += 1;
      if (p.f[i] & F.CRIT) ab.crits += 1;
      if (p.f[i] & F.TICK) ab.ticks += 1;
      if (kind === K.DMG) {
        ab.absorbed += p.b[i];
        const mit = p.x[i] > amount ? p.x[i] - amount : 0;
        ab.mitigated += mit;
        row.mitigated += mit;
      }
      if (kind === K.HEAL) {
        ab.overheal += p.x[i];
        row.overheal += p.x[i];
        ab.kind = ab.kind === 'shield' ? 'shield' : 'heal';
      }
      if (kind === K.ABSORB) {
        row.shields += amount;
        if (!ab.kind) ab.kind = 'shield';
      }
      row.total += amount;
      if (fromPet) row.pets += amount;
      const pt = Math.min(points - 1, Math.floor(at / SERIES_STEP));
      row.series[pt] += amount;
      if (meter !== 'taken' && unit === p.units[unit].root)
        touch(ref.key, at, pi);
    },
    { kinds: [K.DMG, K.HEAL, K.ABSORB] },
  );

  // Casts and misses per ability (for damage and healing).
  if (meter !== 'taken') {
    scan(
      ctx,
      (p, i, at, pi) => {
        const unit = p.s[i];
        const want =
          ctx.filters.side === 'friendly'
            ? isRaiderSide(p, unit)
            : isEnemy(p, unit);
        if (!want) return;
        const ref = rowOf(p, unit, pets);
        const row = ref && rows.get(ref.key);
        if (!row) return;
        const spell = p.spells[p.sp[i]];
        if (!abilityOk(ctx, spell?.id)) return;
        const fromPet =
          unit !== p.units[unit].root && !pets ? p.units[unit].name : '';
        const ab = row.abilities.get(`${spell?.id ?? 0}|${fromPet}`);
        if (p.k[i] === K.CAST) {
          if (unit === p.units[unit].root) touch(row.key, at, pi);
          if (ab) ab.casts += 1;
        } else if (ab && meter === 'damage') ab.misses += 1;
      },
      { kinds: [K.CAST, K.MISS] },
    );
  }

  // DoT uptime: the ability's debuff on the enemies it hit.
  if (meter === 'damage' && ctx.filters.side === 'friendly') {
    const uptime = auraUptimeBy(ctx, true);
    rows.forEach((row) => {
      row.abilities.forEach((ab) => {
        if (!ab.ticks) return;
        ab.uptime = uptime.get(`${row.key}|${ab.spellId}`) ?? 0;
      });
    });
  }

  activity.forEach((list, key) => {
    const row = rows.get(key);
    if (row) row.active = unionLength(list);
  });

  return [...rows.values()]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
};

/** Seconds a raider's debuff (by spell) was up on any enemy in view. */
const auraUptimeBy = (ctx: Ctx, debuffs: boolean) => {
  const spans = new Map<string, [number, number][]>();
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    const off = ctx.offsets[pi];
    p.auras.forEach((a) => {
      if (a.debuff !== debuffs || a.src < 0 || !isEnemy(p, a.dst)) return;
      const ref = rowOf(p, a.src, false);
      if (!ref) return;
      const s = Math.max(from, a.start);
      const e = Math.min(to, a.end);
      if (e <= s) return;
      const key = `${ref.key}|${p.spells[a.spell]?.id}`;
      const list = spans.get(key) ?? [];
      list.push([off + s, off + e]);
      spans.set(key, list);
    });
  });
  const out = new Map<string, number>();
  spans.forEach((list, key) => out.set(key, unionLength(list)));
  return out;
};

export const mergeSpans = (list: [number, number][]) => {
  const sorted = [...list].sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  sorted.forEach(([s, e]) => {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  });
  return merged;
};

export const unionLength = (list: [number, number][]) =>
  mergeSpans(list).reduce((n, [s, e]) => n + e - s, 0);

/** Damage/healing broken down by ability across all rows (Done by ability). */
export const byAbility = (rows: MeterRow[]) => {
  const out = new Map<
    string,
    AbilityRow & {
      users: Map<string, { name: string; specId: number; total: number }>;
    }
  >();
  rows.forEach((row) => {
    row.abilities.forEach((ab) => {
      const key = `${ab.spellId}`;
      let agg = out.get(key);
      if (!agg) {
        agg = { ...newAbility(key, ab.spellId, ab.name, ''), users: new Map() };
        out.set(key, agg);
      }
      agg.total += ab.total;
      agg.hits += ab.hits;
      agg.crits += ab.crits;
      agg.ticks += ab.ticks;
      agg.casts += ab.casts;
      agg.misses += ab.misses;
      agg.overheal += ab.overheal;
      agg.absorbed += ab.absorbed;
      agg.mitigated += ab.mitigated;
      const u = agg.users.get(row.key) ?? {
        name: row.name,
        specId: row.specId,
        total: 0,
      };
      u.total += ab.total;
      agg.users.set(row.key, u);
    });
  });
  return [...out.values()].sort((a, b) => b.total - a.total);
};

/** For one row's ability: amounts by target (or by source for taken). */
export const abilitySplit = (
  ctx: Ctx,
  meter: Meter,
  rowKey: string,
  spellIds: number[],
) => {
  const ids = new Set(spellIds);
  const sources = new Map<string, number>();
  const targets = new Map<string, number>();
  const pets = ctx.filters.pets && meter !== 'taken';
  scan(
    ctx,
    (p, i) => {
      const unit = meterUnit(ctx, p, i, meter);
      if (unit < 0) return;
      if (!ids.has(p.spells[p.sp[i]]?.id ?? -1)) return;
      const ref = rowOf(p, unit, pets);
      if (!ref || (rowKey && ref.key !== rowKey)) return;
      const amount = p.a[i] + (p.k[i] === K.ABSORB ? 0 : p.b[i]);
      const src = p.units[p.s[i]]?.name ?? '?';
      const dst = p.units[p.d[i]]?.name ?? '?';
      sources.set(src, (sources.get(src) ?? 0) + amount);
      targets.set(dst, (targets.get(dst) ?? 0) + amount);
    },
    { kinds: [K.DMG, K.HEAL, K.ABSORB] },
  );
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { sources: sorted(sources), targets: sorted(targets) };
};

/** One row's amounts per ability over time, for the stacked chart. */
export const abilitySeries = (
  ctx: Ctx,
  meter: Meter,
  rowKey: string,
  top = 8,
) => {
  const points = Math.max(1, Math.ceil(ctx.total / SERIES_STEP));
  // By name: the same ability under several spell IDs is one series.
  const by = new Map<
    string,
    { name: string; values: Float64Array; total: number }
  >();
  const pets = ctx.filters.pets && meter !== 'taken';
  scan(
    ctx,
    (p, i, at) => {
      const unit = meterUnit(ctx, p, i, meter);
      if (unit < 0) return;
      const ref = rowOf(p, unit, pets);
      if (!ref || ref.key !== rowKey) return;
      const spell = p.spells[p.sp[i]];
      const id = spell?.name ?? '?';
      let entry = by.get(id);
      if (!entry) {
        entry = {
          name: spell?.name ?? '?',
          values: new Float64Array(points),
          total: 0,
        };
        by.set(id, entry);
      }
      const amount = p.a[i] + (p.k[i] === K.ABSORB ? 0 : p.b[i]);
      entry.values[Math.min(points - 1, Math.floor(at / SERIES_STEP))] +=
        amount;
      entry.total += amount;
    },
    { kinds: [K.DMG, K.HEAL, K.ABSORB] },
  );
  const list = [...by.values()].sort((a, b) => b.total - a.total);
  const shown = list.slice(0, top);
  const rest = list.slice(top);
  if (rest.length) {
    const values = new Float64Array(points);
    rest.forEach((r) =>
      r.values.forEach((v, i) => {
        values[i] += v;
      }),
    );
    shown.push({
      name: 'Other',
      values,
      total: rest.reduce((n, r) => n + r.total, 0),
    });
  }
  return shown;
};

/** Enemy names in view (for the enemy picker), most hit first. */
export const enemyNames = (ctx: Ctx) => {
  const totals = new Map<string, number>();
  ctx.pulls.forEach((p) => {
    for (let i = 0; i < p.n; i += 1) {
      if (p.k[i] !== K.DMG) continue;
      const d = p.d[i];
      const s = p.s[i];
      if (isEnemy(p, d) && isRaiderSide(p, s)) {
        const name = p.units[d].name;
        totals.set(name, (totals.get(name) ?? 0) + p.a[i] + p.b[i]);
      } else if (isEnemy(p, s) && d >= 0 && p.units[d].raider) {
        const name = p.units[s].name;
        totals.set(name, (totals.get(name) ?? 0) + 1);
      }
    }
  });
  return [...totals.entries()]
    .filter(([name]) => name)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
};

/** Abilities in a meter (for the ability picker). */
export const abilityNames = (rows: MeterRow[]) => {
  const totals = new Map<number, { name: string; total: number }>();
  rows.forEach((r) =>
    r.abilities.forEach((a) => {
      const e = totals.get(a.spellId) ?? { name: a.name, total: 0 };
      e.total += a.total;
      totals.set(a.spellId, e);
    }),
  );
  return [...totals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id, e]) => ({ id, name: e.name }));
};

/* ------------------------------------------------------------------ */
/* Buffs and debuffs                                                   */
/* ------------------------------------------------------------------ */

export type AuraCategory =
  | 'raid'
  | 'raidbuff'
  | 'external'
  | 'personal'
  | 'consumable'
  | 'mechanic'
  | 'yours'
  | 'other';

export type AuraRow = {
  spellId: number;
  name: string;
  category: AuraCategory;
  /** Times it went on. */
  count: number;
  /** Seconds up (on anyone, or the picked raider), combined timeline. */
  uptime: number;
  spans: [number, number][];
  /** Who put it on (raider names), with counts. */
  sources: [string, number][];
  /** Who had it (for debuffs on raiders). */
  targets: number;
};

const CONSUMABLE =
  /flask|phial|well fed|augment|^rune of|potion|light's potential|feast|\bfood\b|\boil\b|vantus|healthstone|\bdrink\b|nourish/i;

/**
 * Buffs on raiders (`debuffs` false), debuffs on raiders, or the raid's
 * debuffs on an enemy (side 'enemy'). `who` narrows to one raider.
 */
export const auraRows = (
  ctx: Ctx,
  opts: { debuffs: boolean; who: string | null },
): AuraRow[] => {
  const onEnemy = ctx.filters.side === 'enemy';
  type Agg = {
    spellId: number;
    name: string;
    count: number;
    spans: [number, number][];
    sources: Map<string, number>;
    targets: Set<string>;
    selfCast: number;
    otherCast: number;
    // Raiders one caster gave it to within a second: raid-wide cooldowns.
    bursts: Map<string, Set<number>>;
    maxBurst: number;
    casters: Set<string>;
    fromEnemy: number;
  };
  const aggs = new Map<number, Agg>();
  // Spells each raider cast, and how often.
  const castCounts = new Map<string, number>();
  scan(
    ctx,
    (p, i) => {
      const ref = rowOf(p, p.s[i], false);
      if (!ref?.player) return;
      const key = `${ref.key}|${p.spells[p.sp[i]]?.id}`;
      // Also by name: a cast and its buff often have different IDs.
      const byName = `${ref.key}|${p.spells[p.sp[i]]?.name}`;
      castCounts.set(byName, (castCounts.get(byName) ?? 0) + 1);
      // ref.key is the raider's guid.
      castCounts.set(key, (castCounts.get(key) ?? 0) + 1);
    },
    { kinds: [K.CAST], ignoreExpr: true },
  );

  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    const off = ctx.offsets[pi];
    const { bosses } = enemyInfo(p);
    p.auras.forEach((a) => {
      if (a.debuff !== opts.debuffs) return;
      const target = a.dst >= 0 ? p.units[a.dst] : null;
      if (!target) return;
      if (onEnemy) {
        if (!isEnemy(p, a.dst)) return;
        // The picked enemies, else the bosses.
        if (ctx.filters.enemy) {
          if (!enemyOk(ctx, p, a.dst)) return;
        } else if (!bosses.has(p.units[target.root].npcId)) return;
        if (a.src < 0 || !isRaiderSide(p, a.src)) return;
      } else {
        if (!target.raider) return;
        if (opts.who && target.guid !== opts.who) return;
      }
      const s = Math.max(from, a.start);
      const e = Math.min(to, a.end);
      if (e <= s && !(a.start >= from && a.start <= to)) return;
      const spell = p.spells[a.spell];
      if (!spell) return;
      if (!abilityOk(ctx, spell.id)) return;
      let agg = aggs.get(spell.id);
      if (!agg) {
        agg = {
          spellId: spell.id,
          name: spell.name,
          count: 0,
          spans: [],
          sources: new Map(),
          targets: new Set(),
          selfCast: 0,
          otherCast: 0,
          bursts: new Map(),
          maxBurst: 0,
          casters: new Set(),
          fromEnemy: 0,
        };
        aggs.set(spell.id, agg);
      }
      if (a.start >= from) agg.count += 1;
      if (e > s) agg.spans.push([off + s, off + e]);
      const caster = a.src >= 0 ? rowOf(p, a.src, false) : null;
      const casterName = caster?.player ? caster.name : caster?.name || '';
      if (casterName)
        agg.sources.set(casterName, (agg.sources.get(casterName) ?? 0) + 1);
      agg.targets.add(target.name);
      if (caster && caster.key === target.guid) agg.selfCast += 1;
      else agg.otherCast += 1;
      if (caster?.player) agg.casters.add(caster.key);
      if (!caster || !caster.player) agg.fromEnemy += 1;
      if (caster?.player && a.start > 0) {
        const burst = `${pi}|${caster.key}|${Math.round(a.start)}`;
        const set = agg.bursts.get(burst) ?? new Set<number>();
        set.add(a.dst);
        agg.bursts.set(burst, set);
        agg.maxBurst = Math.max(agg.maxBurst, set.size);
      }
    });
  });

  const seconds = viewSeconds(ctx);
  return [...aggs.values()]
    .map((agg) => {
      const spans = mergeSpans(agg.spans);
      const uptime = spans.reduce((n, [s, e]) => n + e - s, 0);
      // Up nearly all the time (on whoever had it at all).
      const steady = uptime >= seconds * 0.85;
      let category: AuraCategory = 'other';
      if (onEnemy) category = 'yours';
      else if (opts.debuffs)
        // Boss mechanics (put on by enemies) vs the rest.
        category = agg.fromEnemy > agg.casters.size ? 'mechanic' : 'other';
      else if (CONSUMABLE.test(agg.name)) category = 'consumable';
      else if (steady && agg.targets.size >= 5 && agg.casters.size)
        category = 'raidbuff';
      else if (agg.maxBurst >= 4) {
        // Pressed for the raid now and then (not a HoT or a proc).
        const pressed = [...agg.casters].some((guid) => {
          const casts =
            castCounts.get(`${guid}|${agg.spellId}`) ??
            castCounts.get(`${guid}|${agg.name}`) ??
            0;
          return casts > 0 && casts <= Math.max(3, (seconds / 60) * 1.5);
        });
        if (pressed) category = 'raid';
      } else if (!steady) {
        // A cooldown: a spell its caster pressed now and then.
        const pressed = [...agg.casters].some((guid) => {
          const casts =
            castCounts.get(`${guid}|${agg.spellId}`) ??
            castCounts.get(`${guid}|${agg.name}`) ??
            0;
          return casts > 0 && casts <= Math.max(3, (seconds / 60) * 3);
        });
        if (pressed)
          category = agg.otherCast > agg.selfCast ? 'external' : 'personal';
      }
      return {
        spellId: agg.spellId,
        name: agg.name,
        category,
        count: agg.count,
        uptime,
        spans,
        sources: [...agg.sources.entries()].sort((a, b) => b[1] - a[1]),
        targets: agg.targets.size,
      };
    })
    .sort((a, b) => b.uptime - a.uptime);
};

/* ------------------------------------------------------------------ */
/* Interrupts, dispels, casts, resources, deaths                       */
/* ------------------------------------------------------------------ */

export type CountRow = {
  spellId: number;
  name: string;
  total: number;
  by: [RowRef, number][];
};

/** Interrupts (by interrupted spell) or dispels (by removed aura). */
export const countRows = (
  ctx: Ctx,
  kind: 'interrupt' | 'dispel',
): CountRow[] => {
  const rows = new Map<
    number,
    { name: string; total: number; by: Map<string, [RowRef, number]> }
  >();
  scan(
    ctx,
    (p, i) => {
      const ref = rowOf(p, p.s[i], false);
      if (!ref) return;
      const friendly = isRaiderSide(p, p.s[i]);
      if ((ctx.filters.side === 'friendly') !== friendly) return;
      const what = p.spells[p.aux[i]];
      if (!what) return;
      const entry = rows.get(what.id) ?? {
        name: what.name,
        total: 0,
        by: new Map(),
      };
      entry.total += 1;
      const by = entry.by.get(ref.key) ?? [ref, 0];
      by[1] += 1;
      entry.by.set(ref.key, by);
      rows.set(what.id, entry);
    },
    { kinds: [kind === 'interrupt' ? K.INTERRUPT : K.DISPEL] },
  );
  return [...rows.entries()]
    .map(([spellId, e]) => ({
      spellId,
      name: e.name,
      total: e.total,
      by: [...e.by.values()].sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.total - a.total);
};

export type CastRow = RowRef & {
  total: number;
  spells: { spellId: number; name: string; count: number; times: number[] }[];
};

/** Casts per raider (or enemy) and spell, with times on the combined timeline. */
export const castRows = (ctx: Ctx): CastRow[] => {
  const rows = new Map<
    string,
    CastRow & { map: Map<number, CastRow['spells'][number]> }
  >();
  scan(
    ctx,
    (p, i, at) => {
      const s = p.s[i];
      const friendly = isRaiderSide(p, s);
      if ((ctx.filters.side === 'friendly') !== friendly) return;
      if (!friendly && !isEnemy(p, s)) return;
      const ref = rowOf(p, s, ctx.filters.pets);
      if (!ref) return;
      const spell = p.spells[p.sp[i]];
      if (!spell) return;
      if (!abilityOk(ctx, spell.id)) return;
      let row = rows.get(ref.key);
      if (!row) {
        row = { ...ref, total: 0, spells: [], map: new Map() };
        rows.set(ref.key, row);
      }
      let entry = row.map.get(spell.id);
      if (!entry) {
        entry = { spellId: spell.id, name: spell.name, count: 0, times: [] };
        row.map.set(spell.id, entry);
      }
      entry.count += 1;
      entry.times.push(at);
      row.total += 1;
    },
    { kinds: [K.CAST] },
  );
  return [...rows.values()]
    .map(({ map, ...row }) => ({
      ...row,
      spells: [...map.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export type ResourceRow = RowRef & {
  /** power type -> gained, wasted, by ability */
  types: Map<
    number,
    { gained: number; wasted: number; abilities: Map<string, [number, number]> }
  >;
};

export const resourceRows = (ctx: Ctx): ResourceRow[] => {
  const rows = new Map<string, ResourceRow>();
  scan(
    ctx,
    (p, i) => {
      const d = p.d[i];
      if (d < 0 || !p.units[d].raider) return;
      const ref = rowOf(p, d, false);
      if (!ref) return;
      let row = rows.get(ref.key);
      if (!row) {
        row = { ...ref, types: new Map() };
        rows.set(ref.key, row);
      }
      const type = p.aux[i];
      const entry = row.types.get(type) ?? {
        gained: 0,
        wasted: 0,
        abilities: new Map(),
      };
      entry.gained += p.a[i];
      entry.wasted += p.x[i];
      const name = p.spells[p.sp[i]]?.name ?? '?';
      const ab = entry.abilities.get(name) ?? [0, 0];
      ab[0] += p.a[i];
      ab[1] += p.x[i];
      entry.abilities.set(name, ab);
      row.types.set(type, entry);
    },
    { kinds: [K.ENERGIZE] },
  );
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/** A raider's power (as % of max) over the combined timeline. */
export const powerSeries = (ctx: Ctx, guid: string) => {
  const out: { t: number; pct: number; type: number }[] = [];
  ctx.pulls.forEach((p, pi) => {
    const unit = p.units.findIndex((u) => u.guid === guid);
    const list = unit >= 0 ? p.power.get(unit) : undefined;
    if (!list) return;
    const [from, to] = window_(ctx, pi);
    list.forEach(([t, cur, max, type]) => {
      if (t < from || t > to || !max) return;
      out.push({ t: ctx.offsets[pi] + t, pct: (cur / max) * 100, type });
    });
  });
  return out;
};

export type DeathRow = {
  at: number;
  pull: string;
  name: string;
  specId: number;
  spell: string;
  source: string;
  amount: number;
};

export const deathRows = (ctx: Ctx): DeathRow[] => {
  const out: DeathRow[] = [];
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    p.deaths.forEach((d) => {
      if (d.t < from || d.t > to + 0.01) return;
      const u = p.units[d.unit];
      out.push({
        at: ctx.offsets[pi] + d.t,
        pull: p.label,
        name: u.name,
        specId: u.specId,
        spell: d.spell >= 0 ? (p.spells[d.spell]?.name ?? '') : '',
        source: d.src >= 0 ? (p.units[d.src]?.name ?? '') : '',
        amount: d.amount,
      });
    });
  });
  return out;
};

/** Raiders in the pulls (for composition). */
export const raiders = (ctx: Ctx) => {
  const out = new Map<string, { name: string; specId: number }>();
  ctx.pulls.forEach((p) =>
    p.units.forEach((u) => {
      if (u.raider && u.player)
        out.set(u.guid, { name: u.name, specId: u.specId });
    }),
  );
  return [...out.entries()]
    .map(([guid, u]) => ({ guid, ...u }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** Bloodlust and co. windows on the combined timeline. */
const LUST = new Set([2825, 32182, 80353, 264667, 390386, 466904, 444257]);
export const lustBands = (ctx: Ctx) => {
  const out: [number, number][] = [];
  ctx.pulls.forEach((p, pi) => {
    const seen = new Set<number>();
    p.auras.forEach((a) => {
      const id = p.spells[a.spell]?.id;
      if (!LUST.has(id) || seen.has(Math.round(a.start))) return;
      if (a.dst < 0 || !p.units[a.dst].raider) return;
      seen.add(Math.round(a.start));
      out.push([ctx.offsets[pi] + a.start, ctx.offsets[pi] + a.end]);
    });
  });
  // Lust handed over between spells a moment apart is one window.
  return mergeSpans(out.map(([s, e]) => [s, e + 2] as [number, number])).map(
    ([s, e]) => [s, e - 2] as [number, number],
  );
};

/* ------------------------------------------------------------------ */
/* Damage prevented (estimate)                                         */
/* ------------------------------------------------------------------ */

// Auras this weak that are up all fight (Devotion Aura) aren't cooldowns.
const STEADY_R = 0.05;

/**
 * Damage kept off raiders by damage-reduction cooldowns, credited to whoever
 * cast them (personal ones to the wearer): taken x r / (1 - r) while up.
 * Shields are in Healing. An estimate: talents and stacking change it.
 */
export const preventedRows = (
  ctx: Ctx,
  opts: {
    passive?: boolean;
    talents?: Map<string, PassiveDr[]> | null;
    /** Buffs that cut damage (from their descriptions), by spell ID. */
    auras?: Map<number, { r: number; schools: number; name: string }> | null;
  } = {},
): MeterRow[] => {
  const rows = new Map<string, MeterRow>();
  const points = Math.max(1, Math.ceil(ctx.total / SERIES_STEP));
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    const off = ctx.offsets[pi];
    // Who cast each "sourceless" cooldown last, by time.
    const castsOf = new Map<number, [number, number][]>();
    for (let i = 0; i < p.n; i += 1) {
      if (p.k[i] !== K.CAST) continue;
      const id = p.spells[p.sp[i]]?.id;
      if (!id) continue;
      const list = castsOf.get(id) ?? [];
      list.push([p.t[i], p.s[i]]);
      castsOf.set(id, list);
    }
    type Span = {
      start: number;
      end: number;
      r: number;
      /** School bits it cuts (127 all, 126 magic). */
      schools: number;
      /** Long-uptime buffs: divided out of hits, not a "cooldown up". */
      steady: boolean;
      caster: number;
      spellId: number;
      name: string;
    };
    const spans = new Map<number, Span[]>();
    p.auras.forEach((a) => {
      const spell = p.spells[a.spell];
      if (!spell || a.dst < 0 || !p.units[a.dst].raider) return;
      const fromText = DAMAGE_REDUCTION[spell.id]
        ? undefined
        : opts.auras?.get(spell.id);
      if (fromText && !a.debuff) {
        const src = a.src >= 0 ? p.units[a.src].root : -1;
        const list = spans.get(a.dst) ?? [];
        list.push({
          start: a.start,
          end: a.end,
          r: fromText.r,
          schools: fromText.schools,
          steady: true,
          caster: src >= 0 && p.units[src].raider ? src : a.dst,
          spellId: spell.id,
          name: fromText.name,
        });
        spans.set(a.dst, list);
        return;
      }
      const dr = DAMAGE_REDUCTION[spell.id];
      if (!dr) return;
      let caster = -1;
      if (dr.personal) caster = a.dst;
      else if (a.src >= 0 && p.units[p.units[a.src].root].raider)
        caster = p.units[a.src].root;
      else if (dr.castId) {
        const list = castsOf.get(dr.castId) ?? [];
        for (let j = list.length - 1; j >= 0; j -= 1) {
          if (list[j][0] <= a.start + 0.5) {
            caster = p.units[list[j][1]].root;
            break;
          }
        }
      }
      if (caster < 0) return;
      const list = spans.get(a.dst) ?? [];
      list.push({
        start: a.start,
        end: a.end,
        r: dr.r,
        schools: dr.magicOnly ? 126 : 127,
        steady: dr.r <= STEADY_R,
        caster,
        spellId: spell.id,
        name: dr.name,
      });
      spans.set(a.dst, list);
    });
    if (!spans.size && !opts.passive) return;
    // Passive reductions (talents, versatility): each raider's usual cut of
    // magic damage when no cooldown is up, from the log's before-and-after
    // amounts, above the raid's floor (what everyone gets: boss and raid-wide
    // effects). Steady auras we count already (Devotion Aura) come off first.
    const cuts = (sp: Span, school: number) =>
      school ? (sp.schools & school) !== 0 : sp.schools === 127;
    const steadyCut = (d: number, t: number, school: number) => {
      let keep = 1;
      (spans.get(d) ?? []).forEach((sp) => {
        if (sp.steady && cuts(sp, school) && t >= sp.start && t < sp.end)
          keep *= 1 - sp.r;
      });
      return keep;
    };
    const cooldownUp = (d: number, t: number) =>
      (spans.get(d) ?? []).some(
        (sp) => !sp.steady && t >= sp.start && t < sp.end,
      );
    // This hit's cut (0..1) not explained by auras we count, or null.
    const hitCut = (i: number) => {
      const landed = p.a[i] + p.b[i];
      if (!landed || p.x[i] <= landed) return null;
      const school = p.spells[p.sp[i]]?.school ?? 1;
      const cut = 1 - landed / p.x[i] / steadyCut(p.d[i], p.t[i], school);
      return cut > 0 && cut < 0.6 ? cut : null;
    };
    const personal = new Map<number, number>();
    if (opts.passive) {
      const samples = new Map<number, number[]>();
      for (let i = 0; i < p.n; i += 1) {
        if (p.k[i] !== K.DMG) continue;
        const d = p.d[i];
        if (d < 0 || !p.units[d].raider) continue;
        if ((p.spells[p.sp[i]]?.school ?? 1) & 1) continue;
        if (cooldownUp(d, p.t[i])) continue;
        const cut = hitCut(i);
        if (cut === null) continue;
        const list = samples.get(d) ?? [];
        list.push(cut);
        samples.set(d, list);
      }
      const medians = new Map<number, number>();
      samples.forEach((list, d) => {
        if (list.length < 8) return;
        const sorted = [...list].sort((x, y) => x - y);
        medians.set(d, sorted[Math.floor(sorted.length / 2)]);
      });
      const ordered = [...medians.values()].sort((x, y) => x - y);
      const floor =
        ordered.length >= 3 ? ordered[Math.floor(ordered.length * 0.15)] : 0;
      medians.forEach((m, d) => {
        const own = 1 - (1 - m) / (1 - floor);
        if (own > 0.002) personal.set(d, own);
      });
    }
    const add = (
      caster: number,
      spellId: number,
      name: string,
      prevented: number,
      t: number,
      target: number,
    ) => {
      const ref = rowOf(p, caster, false);
      if (!ref || prevented <= 0) return;
      let row = rows.get(ref.key);
      if (!row) {
        row = {
          ...ref,
          total: 0,
          pets: 0,
          overheal: 0,
          mitigated: 0,
          shields: 0,
          prevented: 0,
          active: 0,
          abilities: new Map(),
          series: new Float64Array(points),
        };
        rows.set(ref.key, row);
      }
      const key = `${spellId}|`;
      const ab = row.abilities.get(key) ?? newAbility(key, spellId, name, '');
      ab.total += prevented;
      ab.hits += 1;
      ab.split ??= { sources: new Map(), targets: new Map() };
      const from = p.units[caster]?.name ?? '?';
      const to = p.units[target]?.name ?? '?';
      ab.split.sources.set(from, (ab.split.sources.get(from) ?? 0) + prevented);
      ab.split.targets.set(to, (ab.split.targets.get(to) ?? 0) + prevented);
      row.abilities.set(key, ab);
      row.total += prevented;
      row.series[Math.min(points - 1, Math.floor((off + t) / SERIES_STEP))] +=
        prevented;
    };
    for (let i = 0; i < p.n; i += 1) {
      const t = p.t[i];
      if (t < from) continue;
      if (t > to) break;
      if (p.k[i] !== K.DMG) continue;
      const d = p.d[i];
      if (d < 0 || !p.units[d].raider) continue;
      const list = spans.get(d) ?? [];
      if (!list.length && !opts.passive) continue;
      if (ctx.filters.expr && !ctx.filters.expr(p, i)) continue;
      const amount = p.a[i] + p.b[i];
      const school = p.spells[p.sp[i]]?.school ?? 1;
      list.forEach((span) => {
        if (t < span.start || t >= span.end) return;
        if (!cuts(span, school)) return;
        const prevented = (amount * span.r) / (1 - span.r);
        if (!abilityOk(ctx, span.spellId)) return;
        add(span.caster, span.spellId, span.name, prevented, t, d);
      });
      if (!opts.passive) continue;
      // Talents that always cut this school (Elemental Warding...), at the
      // percentage their description gives.
      let byTalents = 0;
      (opts.talents?.get(p.units[d].guid) ?? []).forEach((dr) => {
        if (!(dr.schools & school) && !(school === 0 && dr.schools === 127))
          return;
        const prevented = (amount * dr.r) / (1 - dr.r);
        byTalents += prevented;
        if (abilityOk(ctx, dr.spellId))
          add(d, dr.spellId, dr.name, prevented, t, d);
      });
      // The rest of the raider's usual cut of magic damage (armour handles
      // physical): versatility and whatever else, never more than this
      // hit's own cut.
      const own = personal.get(d);
      const cutNow = own !== undefined && !(school & 1) ? hitCut(i) : null;
      if (own !== undefined && cutNow !== null && abilityOk(ctx, 0)) {
        const cut = Math.min(own, cutNow);
        const rest = amount / (1 - cut) - amount - byTalents;
        if (rest > 0)
          add(d, 0, 'Versatility & other passives (estimate)', rest, t, d);
      }
    }
  });
  return [...rows.values()].sort((a, b) => b.total - a.total);
};

/** Healing with damage prevented added in (credited to whoever prevented it). */
export const withPrevented = (healing: MeterRow[], prevented: MeterRow[]) => {
  const rows = new Map<string, MeterRow>();
  healing.forEach((r) =>
    rows.set(r.key, {
      ...r,
      abilities: new Map(r.abilities),
      series: r.series.slice(),
    }),
  );
  prevented.forEach((r) => {
    let row = rows.get(r.key);
    if (!row) {
      row = {
        ...r,
        total: 0,
        abilities: new Map(),
        series: new Float64Array(r.series.length),
      };
      rows.set(r.key, row);
    }
    const target = row;
    r.abilities.forEach((a) => {
      const key = `prevented:${a.key}`;
      target.abilities.set(key, { ...a, key, kind: 'prevented' });
    });
    target.total += r.total;
    target.prevented += r.total;
    r.series.forEach((v, i) => {
      target.series[i] += v;
    });
  });
  return [...rows.values()].sort((a, b) => b.total - a.total);
};

/** Abilities with the same name (several spell IDs), as WCL nests them. */
export type AbilityGroup = {
  key: string;
  /** The row to show: the ability itself, or the group's sum. */
  head: AbilityRow;
  /** Two or more when grouped; the main one (cast, else biggest) first. */
  parts: AbilityRow[];
};

export const groupAbilities = (abilities: AbilityRow[]): AbilityGroup[] => {
  const groups = new Map<string, AbilityRow[]>();
  abilities.forEach((a) => {
    const key = `${a.name}|${a.by}|${a.kind ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  });
  return [...groups.entries()].map(([key, list]) => {
    if (list.length === 1) return { key, head: list[0], parts: list };
    const parts = [...list].sort(
      (x, y) => y.casts - x.casts || y.total - x.total,
    );
    const head: AbilityRow = {
      ...parts[0],
      key: `group:${key}`,
      total: 0,
      hits: 0,
      crits: 0,
      ticks: 0,
      casts: 0,
      misses: 0,
      overheal: 0,
      absorbed: 0,
      mitigated: 0,
      uptime: 0,
      split: undefined,
    };
    parts.forEach((a) => {
      head.total += a.total;
      head.hits += a.hits;
      head.crits += a.crits;
      head.ticks += a.ticks;
      head.casts += a.casts;
      head.misses += a.misses;
      head.overheal += a.overheal;
      head.absorbed += a.absorbed;
      head.mitigated += a.mitigated;
      head.uptime = Math.max(head.uptime, a.uptime);
      if (a.split) {
        head.split ??= { sources: new Map(), targets: new Map() };
        const into = head.split;
        a.split.sources.forEach((v, k) =>
          into.sources.set(k, (into.sources.get(k) ?? 0) + v),
        );
        a.split.targets.forEach((v, k) =>
          into.targets.set(k, (into.targets.get(k) ?? 0) + v),
        );
      }
    });
    return { key, head, parts };
  });
};
