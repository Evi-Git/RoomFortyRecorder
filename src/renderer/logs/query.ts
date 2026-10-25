import { DAMAGE_REDUCTION, NOT_REDUCED } from '../../parsing/PullMeters';
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
  /** Healing: leave out what went to these raiders (GUIDs). */
  healExclude: string[];
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
  healExclude: [],
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
  /** Counts against the raider's healing (Spirit Link's damage...). */
  negative?: boolean;
  /** Pets: the spell that summoned the pet (groups its abilities). */
  summon?: { id: number; name: string };
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
/** Damage from healing spells, shown as negative healing. */
const HEALING_COSTS = new Set([
  98021, // Spirit Link (damage evening out health)
  448005, // Light of the Martyr (healing the paladin doesn't get)
  469704, // Tempered in Battle (the paladin's health it hands out)
]);

/**
 * Shields that are damage put off or sent elsewhere rather than healing:
 * Warcraft Logs counts what they take as neither healing nor damage taken.
 */
export const DEFERRED_ABSORBS = new Set([
  1309497, // Refractive Images (the mage's images take it)
  410355, // Stretch Time (taken later, as Stretch Time ticks)
]);

/** Shields Warcraft Logs doesn't count as healing. */
const NOT_HEALING_ABSORBS = new Set([
  ...DEFERRED_ABSORBS,
  47788, // Guardian Spirit (the save from a killing blow)
  114556, // Purgatory (the death knight's own cheat death)
]);

/** Healer specs: Warcraft Logs leaves out their healing on others' pets. */
const HEALER_SPECS = new Set([65, 105, 256, 257, 264, 270, 1468]);

/**
 * Warcraft Logs doesn't count a healer's healing on another raider's pet
 * or guardian (a DPS's Halo on them still counts; checked on Kith'ix).
 */
const healerOnOthersPet = (p: PullStore, s: number, d: number) => {
  if (s < 0 || d < 0) return false;
  const target = p.units[d];
  if (target.player || target.owner < 0) return false;
  const healer = p.units[p.units[s].root];
  return (
    HEALER_SPECS.has(healer.specId ?? 0) && target.root !== p.units[s].root
  );
};

/** Health moved between raiders, not damage taken (as on Warcraft Logs). */
const NOT_TAKEN = new Set([
  98021, // Spirit Link
  469704, // Tempered in Battle
]);

/** A deferred shield's soak, taken off the hit it soaked (Damage Taken). */
const deferredSoak = (p: PullStore, i: number, meter: Meter) =>
  meter === 'taken' && p.k[i] === K.ABSORB;

/** An event's amount for a meter. */
export const meterAmount = (p: PullStore, i: number, meter: Meter) => {
  const kind = p.k[i];
  if (deferredSoak(p, i, meter)) return -p.a[i];
  if (meter === 'healing' && kind === K.HEALABSORB) return -p.a[i];
  if (meter === 'healing' && kind === K.DMG)
    return -(p.a[i] + p.b[i] - p.aux[i]);
  return kind === K.DMG || kind === K.HEAL ? p.a[i] + p.b[i] : p.a[i];
};

/** The ability an event counts under (a deferred soak: the hit it soaked). */
export const meterSpell = (p: PullStore, i: number, meter: Meter) =>
  p.spells[deferredSoak(p, i, meter) ? p.aux[i] : p.sp[i]];

/** Healing to this unit (or its owner) is left out of the view. */
export const excludedTarget = (ctx: Ctx, p: PullStore, unit: number) => {
  const list = ctx.filters.healExclude;
  if (!list.length || unit < 0) return false;
  return list.includes(p.units[p.units[unit].root].guid);
};

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
    // Health a healing spell takes off raiders (Spirit Link evening out
    // health) counts against it, as on Warcraft Logs.
    if (kind === K.DMG || kind === K.HEALABSORB) {
      if (!HEALING_COSTS.has(p.spells[p.sp[i]]?.id ?? 0)) return -1;
      if (side !== 'friendly' || !isRaiderSide(p, s)) return -1;
      if (d < 0 || !p.units[d].raider || excludedTarget(ctx, p, d)) return -1;
      return s;
    }
    if (kind !== K.HEAL && kind !== K.ABSORB) return -1;
    if (
      kind === K.ABSORB &&
      NOT_HEALING_ABSORBS.has(p.spells[p.sp[i]]?.id ?? 0)
    )
      return -1;
    if (side === 'friendly' ? !isRaiderSide(p, s) : !isEnemy(p, s)) return -1;
    if (kind === K.HEAL && side === 'friendly' && !p.units[d]?.friendly)
      return -1;
    if (side === 'friendly' && healerOnOthersPet(p, s, d)) return -1;
    if (excludedTarget(ctx, p, d)) return -1;
    if (enemy && side === 'enemy' && !enemyOk(ctx, p, s)) return -1;
    return s;
  }
  // Taken: by who was hit.
  if (kind === K.ABSORB) {
    // A deferred shield's soak comes off the raider's damage taken.
    if (!DEFERRED_ABSORBS.has(p.spells[p.sp[i]]?.id ?? 0)) return -1;
    if (side !== 'friendly' || d < 0 || !p.units[d].raider) return -1;
    const attacker = Math.round(p.x[i]);
    if (enemy && attacker >= 0 && !enemyOk(ctx, p, attacker)) return -1;
    return d;
  }
  if (kind !== K.DMG) return -1;
  if (NOT_TAKEN.has(p.spells[p.sp[i]]?.id ?? 0)) return -1;
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
      const cost =
        meter === 'healing' && (kind === K.DMG || kind === K.HEALABSORB);
      const amount = meterAmount(p, i, meter);
      const spell = meterSpell(p, i, meter);
      const fromPet =
        meter !== 'taken' && unit !== p.units[unit].root && !pets
          ? p.units[unit].name
          : '';
      const aKey = `${spell?.id ?? 0}|${fromPet}${cost ? '|cost' : ''}`;
      let ab = row.abilities.get(aKey);
      if (!ab) {
        ab = newAbility(
          aKey,
          spell?.id ?? 0,
          `${spell?.name ?? '?'}${cost && kind === K.DMG ? ' (Damage)' : ''}`,
          fromPet,
        );
        if (cost) ab.negative = true;
        if (fromPet) ab.summon = p.units[unit].summon;
        row.abilities.set(aKey, ab);
      }
      // A deferred shield's soak only takes its amount off the hit.
      const soak = meter === 'taken' && kind === K.ABSORB;
      ab.total += amount;
      if (soak) ab.absorbed += amount;
      else ab.hits += 1;
      if (p.f[i] & F.CRIT) ab.crits += 1;
      if (p.f[i] & F.TICK) ab.ticks += 1;
      if (kind === K.DMG && !cost) {
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
      if (kind === K.ABSORB && !soak) {
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
    { kinds: [K.DMG, K.HEAL, K.ABSORB, K.HEALABSORB] },
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
          if (p.f[i] & F.PROC) return;
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

/** One row of "Done to enemy": what one target (or, for damage taken, one
 * attacker) got, merged by name, as Warcraft Logs' "Done to target". */
export type TargetRow = {
  key: string;
  name: string;
  specId: number;
  player: boolean;
  npcId: number;
  /** How many different units of that name. */
  units: number;
  total: number;
  hits: number;
  crits: number;
  users: Map<string, { name: string; specId: number; total: number }>;
};

/** The meter's amounts by who they were done to (taken: by who did it). */
export const byTarget = (ctx: Ctx, meter: Meter): TargetRow[] => {
  const out = new Map<string, TargetRow & { seen: Set<string> }>();
  const pets = ctx.filters.pets && meter !== 'taken';
  scan(
    ctx,
    (p, i, _at, pi) => {
      const unit = meterUnit(ctx, p, i, meter);
      if (unit < 0) return;
      const doer = rowOf(p, unit, pets);
      if (!doer) return;
      const kind = p.k[i];
      const cost =
        meter === 'healing' && (kind === K.DMG || kind === K.HEALABSORB);
      if (cost) return;
      const otherIdx =
        meter === 'taken'
          ? kind === K.ABSORB
            ? Math.round(p.x[i])
            : p.s[i]
          : p.d[i];
      // No unit: falling, drowning, lava and the like.
      const other =
        otherIdx < 0 ? undefined : (p.units[otherIdx] as Unit | undefined);
      const root = other ? p.units[other.root] : undefined;
      const isPlayer = Boolean(root?.player);
      const u = (isPlayer ? root : other) ?? {
        name: 'Environment',
        npcId: 0,
        guid: '',
      };
      const key = isPlayer
        ? (root?.guid ?? '')
        : other
          ? `npc:${u.npcId || u.name}`
          : 'environment';
      let row = out.get(key);
      if (!row) {
        row = {
          key,
          name: u.name,
          specId: isPlayer ? (root?.specId ?? 0) : 0,
          player: isPlayer,
          npcId: isPlayer ? 0 : u.npcId,
          units: 0,
          total: 0,
          hits: 0,
          crits: 0,
          users: new Map(),
          seen: new Set(),
        };
        out.set(key, row);
      }
      const id = `${pi}:${isPlayer ? other?.root : otherIdx}`;
      if (!row.seen.has(id)) {
        row.seen.add(id);
        row.units += 1;
      }
      const amount = meterAmount(p, i, meter);
      row.total += amount;
      row.hits += 1;
      if (p.f[i] & F.CRIT) row.crits += 1;
      const by = row.users.get(doer.key) ?? {
        name: doer.name,
        specId: doer.specId,
        total: 0,
      };
      by.total += amount;
      row.users.set(doer.key, by);
    },
    { kinds: [K.DMG, K.HEAL, K.ABSORB, K.HEALABSORB] },
  );
  return [...out.values()]
    .map(
      (row): TargetRow => ({
        key: row.key,
        name: row.name,
        specId: row.specId,
        player: row.player,
        npcId: row.npcId,
        units: row.units,
        total: row.total,
        hits: row.hits,
        crits: row.crits,
        users: row.users,
      }),
    )
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
};

export type AbilityUsers = Map<
  string,
  { name: string; specId: number; total: number }
>;

/**
 * Damage/healing broken down by ability across all rows (Done by ability),
 * nested the way a raider's own abilities are: the same ability under
 * several spell IDs is one row, procs sit under what sets them off, and a
 * pet's spells under what summoned it.
 */
export const byAbility = (
  rows: MeterRow[],
): (AbilityGroup & { users: AbilityUsers })[] => {
  const all = new Map<string, AbilityRow>();
  const users = new Map<string, AbilityUsers>();
  rows.forEach((row) => {
    row.abilities.forEach((ab) => {
      // The raider's key without the raider: one row per spell (and pet).
      const key = ab.key;
      let agg = all.get(key);
      if (!agg) {
        agg = {
          ...newAbility(key, ab.spellId, ab.name, ab.by),
          kind: ab.kind,
          negative: ab.negative,
          summon: ab.summon,
        };
        all.set(key, agg);
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
      const who = users.get(key) ?? new Map();
      const u = who.get(row.key) ?? {
        name: row.name,
        specId: row.specId,
        total: 0,
      };
      u.total += ab.total;
      who.set(row.key, u);
      users.set(key, who);
    });
  });
  return groupAbilities([...all.values()])
    .map((g) => {
      const merged: AbilityUsers = new Map();
      g.parts.forEach((part) => {
        users.get(part.key)?.forEach((u, k) => {
          const m = merged.get(k) ?? { ...u, total: 0 };
          m.total += u.total;
          merged.set(k, m);
        });
      });
      return { ...g, users: merged };
    })
    .sort((a, b) => b.head.total - a.head.total);
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
      if (!ids.has(meterSpell(p, i, meter)?.id ?? -1)) return;
      const ref = rowOf(p, unit, pets);
      if (!ref || (rowKey && ref.key !== rowKey)) return;
      const amount = meterAmount(p, i, meter);
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
      // Healing spells' own damage (Spirit Link) isn't drawn.
      if (meter === 'healing' && p.k[i] === K.DMG) return;
      const spell = meterSpell(p, i, meter);
      // Nested the way the table nests: under the parent ability or item,
      // a pet's spells under what summoned it (totems' copies by name).
      const u = p.units[unit];
      const summon =
        !pets && unit !== u.root && !isTotem(u.name) ? u.summon?.name : '';
      const id =
        NESTED_UNDER[spell?.id ?? 0]?.name || summon || spell?.name || '?';
      let entry = by.get(id);
      if (!entry) {
        entry = {
          name: id,
          values: new Float64Array(points),
          total: 0,
        };
        by.set(id, entry);
      }
      const amount = meterAmount(p, i, meter);
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

export type AuraTarget = RowRef & {
  /** [start, end, stacks] on the combined timeline. */
  spans: [number, number, number][];
  uptime: number;
  count: number;
  /** When it went on (combined timeline). */
  starts: number[];
  maxStacks: number;
};

export type AuraDetail = {
  spellId: number;
  name: string;
  targets: AuraTarget[];
  /** Who put it on, with counts. */
  sources: [RowRef, number][];
  maxStacks: number;
  /** Seconds per value in the series below. */
  step: number;
  /** How many of the targets had it, and their stacks added up. */
  holders: Float64Array;
  stacks: Float64Array;
};

/**
 * One buff or debuff: who had it when (with stacks), who put it on, and how
 * many had it over time. Same choice of auras as auraRows (`debuffs`, the
 * side, `who`); the slice is ignored so the whole fight can be drawn.
 */
export const auraDetail = (
  ctxIn: Ctx,
  spellId: number,
  opts: { debuffs: boolean; who: string | null },
): AuraDetail => {
  const ctx = { ...ctxIn, filters: { ...ctxIn.filters, range: null } };
  const onEnemy = ctx.filters.side === 'enemy';
  const step = 0.25;
  const n = Math.max(1, Math.ceil(ctx.total / step));
  const holders = new Float64Array(n);
  const stacks = new Float64Array(n);
  const targets = new Map<string, AuraTarget>();
  const sources = new Map<string, [RowRef, number]>();
  let name = '';
  let maxStacks = 1;
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    const off = ctx.offsets[pi];
    const { bosses } = enemyInfo(p);
    const spellIdx = new Set<number>();
    p.spells.forEach((sp, i) => {
      if (sp.id === spellId) spellIdx.add(i);
    });
    if (!spellIdx.size) return;
    // Stack changes: target -> [t, stacks].
    const doses = new Map<number, [number, number][]>();
    for (let i = 0; i < p.n; i += 1) {
      if (p.k[i] !== K.DOSE || !spellIdx.has(p.sp[i])) continue;
      const list = doses.get(p.d[i]) ?? [];
      list.push([p.t[i], p.x[i]]);
      doses.set(p.d[i], list);
    }
    p.auras.forEach((a) => {
      if (!spellIdx.has(a.spell) || a.debuff !== opts.debuffs) return;
      const target = a.dst >= 0 ? p.units[a.dst] : null;
      if (!target) return;
      if (onEnemy) {
        if (!isEnemy(p, a.dst)) return;
        if (ctx.filters.enemy) {
          if (!enemyOk(ctx, p, a.dst)) return;
        } else if (!bosses.has(p.units[target.root].npcId)) return;
        if (a.src < 0 || !isRaiderSide(p, a.src)) return;
      } else {
        if (!target.raider) return;
        if (opts.who && target.guid !== opts.who) return;
      }
      const s0 = Math.max(from, a.start);
      const e0 = Math.min(to, a.end);
      if (e0 <= s0) return;
      name = p.spells[a.spell].name;
      const ref = rowOf(p, a.dst, true);
      if (!ref) return;
      // Enemies with one name are one row; each instance would be noise.
      let row = targets.get(ref.key);
      if (!row) {
        row = {
          ...ref,
          spans: [],
          uptime: 0,
          count: 0,
          starts: [],
          maxStacks: 1,
        };
        targets.set(ref.key, row);
      }
      if (a.start >= from) {
        row.count += 1;
        row.starts.push(off + a.start);
      }
      const caster = a.src >= 0 ? rowOf(p, a.src, false) : null;
      if (caster) {
        const known = sources.get(caster.key) ?? [caster, 0];
        known[1] += 1;
        sources.set(caster.key, known);
      }
      // Pieces with their stack count, clipped to what's in view.
      const target_ = row;
      const piece = (x: number, y: number, c: number) => {
        const lo = Math.max(x, s0);
        const hi = Math.min(y, e0);
        if (hi > lo) target_.spans.push([off + lo, off + hi, c]);
      };
      let at = a.start;
      let count = 1;
      (doses.get(a.dst) ?? []).forEach(([t, c]) => {
        if (t <= a.start || t >= a.end) return;
        piece(at, t, count);
        at = t;
        count = Math.max(1, c);
        target_.maxStacks = Math.max(target_.maxStacks, count);
      });
      piece(at, a.end, count);
    });
  });
  targets.forEach((row) => {
    row.spans.sort((x, y) => x[0] - y[0]);
    row.uptime = mergeSpans(row.spans.map(([s0, e0]) => [s0, e0])).reduce(
      (sum, [s0, e0]) => sum + e0 - s0,
      0,
    );
    maxStacks = Math.max(maxStacks, row.maxStacks);
    // Each target counts once at a moment, with its highest stack then.
    const own = new Float64Array(n);
    row.spans.forEach(([s0, e0, c]) => {
      for (let i = Math.floor(s0 / step); i < Math.min(n, e0 / step); i += 1)
        own[i] = Math.max(own[i], c);
    });
    own.forEach((c, i) => {
      if (c > 0) {
        holders[i] += 1;
        stacks[i] += c;
      }
    });
  });
  return {
    spellId,
    name,
    targets: [...targets.values()].sort(
      (x, y) => y.uptime - x.uptime || x.name.localeCompare(y.name),
    ),
    sources: [...sources.values()].sort((x, y) => y[1] - x[1]),
    maxStacks,
    step,
    holders,
    stacks,
  };
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
      // Pets' casts only with Pets on (as their own rows): counted for
      // their owner they'd swamp a warlock's casts.
      if (friendly && s !== p.units[s].root && !ctx.filters.pets) return;
      if (p.f[i] & F.PROC) return;
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

/** Seconds per point in resource charts. */
export const RESOURCE_STEP = 0.25;

/** The resources each raider has (power type -> highest maximum seen). */
export const resourceTypes = (ctx: Ctx) => {
  const out = new Map<string, Map<number, number>>();
  ctx.pulls.forEach((p) =>
    p.powers.forEach((byType, unit) => {
      const u = p.units[unit];
      if (!u?.raider) return;
      const mine = out.get(u.guid) ?? new Map<number, number>();
      byType.forEach((list, type) => {
        let max = mine.get(type) ?? 0;
        let moved = false;
        list.forEach(([, cur, m]) => {
          max = Math.max(max, m);
          if (cur !== list[0][1]) moved = true;
        });
        // A resource that never moved isn't one they use.
        if (moved || list.length > 1) mine.set(type, max);
      });
      if (mine.size) out.set(u.guid, mine);
    }),
  );
  return out;
};

/**
 * A raider's resource level on the combined timeline, every RESOURCE_STEP
 * seconds (as a % of its maximum when `pct`). Before the first reading of
 * a pull: that reading.
 */
export const resourceLevels = (
  ctx: Ctx,
  guid: string,
  type: number,
  pct = false,
) => {
  const values = new Float64Array(
    Math.max(1, Math.ceil(ctx.total / RESOURCE_STEP)),
  );
  ctx.pulls.forEach((p, pi) => {
    const unit = p.units.findIndex((u) => u.guid === guid);
    const list = unit >= 0 ? p.powers.get(unit)?.get(type) : undefined;
    const off = ctx.offsets[pi];
    const first = Math.floor(off / RESOURCE_STEP);
    const last = Math.min(
      values.length,
      Math.ceil((off + p.duration) / RESOURCE_STEP),
    );
    if (!list?.length) return;
    let j = 0;
    let cur = list[0];
    for (let i = first; i < last; i += 1) {
      const t = i * RESOURCE_STEP - off;
      while (j < list.length && list[j][0] <= t) {
        cur = list[j];
        j += 1;
      }
      values[i] = pct ? (cur[2] ? (cur[1] / cur[2]) * 100 : 0) : cur[1];
    }
  });
  return values;
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

const VERSATILITY_NAME = 'Versatility';

/** Buffs that add versatility percentage (not rating): spell ID -> %. */
const VERS_BUFFS: Record<number, number> = {
  1126: 3, // Mark of the Wild
};

/**
 * Versatility percentage (damage done; damage taken is half of it) from
 * rating at level 90: 54 rating a percent, less in the higher brackets.
 */
const VERS_PER_PCT = 54;
const VERS_BRACKETS: [number, number][] = [
  [1620, 1],
  [2160, 0.9],
  [2700, 0.8],
  [3240, 0.7],
  [3780, 0.6],
  [10800, 0.5],
];
export const versPercent = (rating: number) => {
  let pctSum = 0;
  let from = 0;
  for (const [to, keep] of VERS_BRACKETS) {
    if (rating <= from) break;
    pctSum += ((Math.min(rating, to) - from) * keep) / VERS_PER_PCT;
    from = to;
  }
  return pctSum;
};

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
    // Stack counts of stacking reductions (Sentinel): "unit|spell" -> [t, n].
    const doses = new Map<string, [number, number][]>();
    for (let i = 0; i < p.n; i += 1) {
      if (p.k[i] !== K.DOSE) continue;
      if (!DAMAGE_REDUCTION[p.spells[p.sp[i]]?.id ?? 0]?.perStack) continue;
      const key = `${p.d[i]}|${p.sp[i]}`;
      const list = doses.get(key) ?? [];
      list.push([p.t[i], p.x[i]]);
      doses.set(key, list);
    }
    // Auras another one put on alongside it (Gift of the Golden Val'kyr's
    // Guardian of Ancient Kings): "unit|spell ID|start".
    const doubled = new Set<string>();
    p.auras.forEach((a) => {
      const by = DAMAGE_REDUCTION[p.spells[a.spell]?.id ?? 0]?.replaces;
      if (by) doubled.add(`${a.dst}|${by}|${Math.round(a.start * 10)}`);
    });
    p.auras.forEach((a) => {
      const spell = p.spells[a.spell];
      if (!spell || a.dst < 0 || !p.units[a.dst].raider) return;
      if (doubled.has(`${a.dst}|${spell.id}|${Math.round(a.start * 10)}`))
        return;
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
      // Whoever put it on (a raider, or their totem); "personal" ones put on
      // by nobody we know count for the wearer. An evoker can share
      // Obsidian Scales, which is the evoker's, not the wearer's.
      let caster = -1;
      if (a.src >= 0 && p.units[p.units[a.src].root].raider)
        caster = p.units[a.src].root;
      else if (dr.personal) caster = a.dst;
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
      const span = {
        start: a.start,
        end: a.end,
        r: dr.r,
        schools: dr.magicOnly ? 126 : 127,
        steady: dr.r <= STEADY_R,
        caster,
        spellId: spell.id,
        name: dr.name,
      };
      if (dr.perStack) {
        // One piece per stack count, as the stacks wear off.
        let at = a.start;
        let stacks = dr.stacks ?? 1;
        (doses.get(`${a.dst}|${a.spell}`) ?? []).forEach(([t, n]) => {
          if (t <= a.start || t >= a.end) return;
          list.push({ ...span, start: at, end: t, r: stacks * dr.perStack! });
          at = t;
          stacks = n;
        });
        if (stacks > 0)
          list.push({ ...span, start: at, r: stacks * dr.perStack });
      } else list.push(span);
      spans.set(a.dst, list);
    });
    if (!spans.size && !opts.passive) return;
    const cuts = (sp: Span, school: number) =>
      school ? (sp.schools & school) !== 0 : sp.schools === 127;
    // Buffs that add versatility (a percentage, not rating), by raider.
    const versBuffs = new Map<number, [number, number, number][]>();
    if (opts.passive)
      p.auras.forEach((a) => {
        const pctUp = VERS_BUFFS[p.spells[a.spell]?.id ?? 0];
        if (!pctUp || a.dst < 0 || a.debuff) return;
        const list = versBuffs.get(a.dst) ?? [];
        list.push([a.start, a.end, pctUp]);
        versBuffs.set(a.dst, list);
      });
    const versAt = (d: number, t: number) => {
      let v = versPercent(p.vers.get(p.units[d].guid) ?? 0);
      (versBuffs.get(d) ?? []).forEach(([s0, e0, pctUp]) => {
        if (t >= s0 && t < e0) v += pctUp;
      });
      return v;
    };
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
      if (NOT_REDUCED.has(p.spells[p.sp[i]]?.id ?? 0)) continue;
      if (excludedTarget(ctx, p, d)) continue;
      const list = spans.get(d) ?? [];
      if (!list.length && !opts.passive) continue;
      if (ctx.filters.expr && !ctx.filters.expr(p, i)) continue;
      // What the hit really took off (a killing blow's overkill wasn't
      // damage taken, so it prevented nothing either).
      const amount = Math.max(0, p.a[i] + p.b[i] - p.aux[i]);
      const school = p.spells[p.sp[i]]?.school ?? 1;
      // Every reduction known to be on this hit. Each is credited with its
      // share of the damage before all of them (as Warcraft Logs does), so
      // stacking doesn't shrink one cooldown's number because another was
      // up too.
      const on: {
        caster: number;
        spellId: number;
        name: string;
        r: number;
        talent?: boolean;
      }[] = [];
      let v = 0;
      list.forEach((span) => {
        if (t < span.start || t >= span.end) return;
        if (!cuts(span, school)) return;
        on.push(span);
      });
      if (opts.passive) {
        // Talents that always cut this school (Elemental Warding...), at the
        // percentage their description gives.
        (opts.talents?.get(p.units[d].guid) ?? []).forEach((dr) => {
          if (!(dr.schools & school) && !(school === 0 && dr.schools === 127))
            return;
          on.push({
            caster: d,
            spellId: dr.spellId,
            name: dr.name,
            r: dr.r,
            talent: true,
          });
        });
        // Versatility: half its percentage off all damage taken.
        v = versAt(d, t) / 200;
        if (!(v > 0 && v < 1)) v = 0;
      }
      // How each reduction is credited, matched to Warcraft Logs on a
      // Mythic kill (within a few % for each): cooldowns and buffs get
      // their share of the damage before every reduction (versatility
      // included); talents, before everything but versatility; and
      // versatility, before itself alone.
      if (v > 0 && abilityOk(ctx, 0))
        add(d, 0, VERSATILITY_NAME, (amount * v) / (1 - v), t, d);
      if (!on.length) continue;
      // Never more than the log says the hit was before any reduction.
      const unmitigated =
        p.x[i] - p.aux[i] > amount ? p.x[i] - p.aux[i] : Infinity;
      const noVers = on.reduce((n, x) => n / (1 - x.r), amount);
      const all = Math.min(unmitigated, noVers / (1 - v));
      const forTalents = Math.min(unmitigated, noVers);
      on.forEach((x) => {
        if (abilityOk(ctx, x.spellId))
          add(
            x.caster,
            x.spellId,
            x.name,
            (x.talent ? forTalents : all) * x.r,
            t,
            d,
          );
      });
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

/**
 * Spells Warcraft Logs folds under another: talents and procs under the
 * ability that sets them off, items' effects under the item. Child spell
 * ID -> the parent's name and the spell whose icon it shows.
 */
export const NESTED_UNDER: Record<number, { name: string; icon: number }> = {
  // Shaman
  73921: { name: 'Healing Rain', icon: 73920 },
  1300642: { name: 'Healing Rain', icon: 73920 }, // Condensation
  462425: { name: 'Healing Rain', icon: 73920 }, // Tidewaters
  // Evoker
  378213: { name: 'Reversion', icon: 366155 }, // Golden Hour
  367364: { name: 'Reversion', icon: 366155 }, // Reversion (echo)
  366155: { name: 'Reversion', icon: 366155 },
  1256688: { name: 'Reversion', icon: 366155 }, // Merithra's Blessing
  361361: { name: 'Emerald Blossom', icon: 355916 }, // Fluttering Seedlings
  355916: { name: 'Emerald Blossom', icon: 355916 },
  // Paladin
  25914: { name: 'Holy Shock', icon: 20473 },
  461499: { name: 'Holy Shock', icon: 20473 }, // Overflowing Light
  414019: { name: 'Judgment', icon: 275773 }, // Greater Judgment
  461546: { name: 'Judgment', icon: 275773 }, // Truth Prevails
  461529: { name: 'Judgment', icon: 275773 }, // Truth Prevails
  85673: { name: 'Word of Glory', icon: 85673 },
  378412: { name: 'Word of Glory', icon: 85673 }, // Light of the Titans
  // Priest
  1250581: { name: 'Holy Word: Serenity', icon: 2050 }, // Ultimate Serenity
  2050: { name: 'Holy Word: Serenity', icon: 2050 },
  1246798: { name: 'Prayer of Mending', icon: 33076 }, // Prompt Prognosis
  1246768: { name: 'Prayer of Mending', icon: 33076 }, // Power Word: Shield
  33110: { name: 'Prayer of Mending', icon: 33076 },
  1264176: { name: 'Shadowy Apparition', icon: 413231 }, // Void Apparition
  1264177: { name: 'Shadowy Apparition', icon: 413231 }, // Void Bolt
  413231: { name: 'Shadowy Apparition', icon: 413231 },
  // Evoker
  441172: { name: 'Deep Breath', icon: 353759 }, // Melt Armor
  1236970: { name: 'Deep Breath', icon: 353759 }, // Pyre
  353759: { name: 'Deep Breath', icon: 353759 },
  1265804: { name: 'Eternity Surge', icon: 359073 }, // Shattering Star
  359077: { name: 'Eternity Surge', icon: 359073 },
  // Rogue
  462241: { name: 'Coup de Grace', icon: 441776 },
  462242: { name: 'Coup de Grace', icon: 441776 },
  462243: { name: 'Coup de Grace', icon: 441776 },
  462244: { name: 'Coup de Grace', icon: 441776 },
  462247: { name: 'Coup de Grace', icon: 441776 },
  462248: { name: 'Coup de Grace', icon: 441776 },
  // Warlock
  434506: { name: 'Shadow Bolt', icon: 686 }, // Infernal Bolt
  686: { name: 'Shadow Bolt', icon: 686 },
  1276960: { name: 'Call Dreadstalkers', icon: 104316 }, // Blighted Maw
  434636: { name: "Hand of Gul'dan", icon: 105174 }, // Ruination
  86040: { name: "Hand of Gul'dan", icon: 105174 },
  1280460: { name: 'Dominion of Argus', icon: 1280460 }, // Mind Sear
  1282534: { name: 'Dominion of Argus', icon: 1280460 }, // Blaze
  1282507: { name: 'Dominion of Argus', icon: 1280460 }, // Shadow Nova
  1292391: { name: 'Dominion of Argus', icon: 1280460 }, // Soul Barrage
  1269800: { name: 'Diabolic Ritual', icon: 434404 }, // Eye Explosion
  434404: { name: 'Diabolic Ritual', icon: 434404 }, // Felseeker
  432120: { name: 'Diabolic Ritual', icon: 434404 }, // Wicked Cleave
  1269886: { name: 'Diabolic Ritual', icon: 434404 }, // Diabolic Gaze
  1269892: { name: 'Diabolic Ritual', icon: 434404 }, // Diabolic Gaze
  1269885: { name: 'Diabolic Ritual', icon: 434404 }, // Diabolic Gaze
  432596: { name: 'Diabolic Ritual', icon: 434404 }, // Chaos Salvo
  389372: { name: 'Soul Leech', icon: 108366 }, // Fel Synergy
  386124: { name: 'Soul Leech', icon: 108366 }, // Fel Armor
  108366: { name: 'Soul Leech', icon: 108366 },
  // Shaman
  378597: { name: 'Healing Rain', icon: 73920 }, // Acid Rain
  // Demon Hunter
  390181: { name: 'Throw Glaive', icon: 185123 }, // Soulscar
  393035: { name: 'Throw Glaive', icon: 185123 },
  337819: { name: 'Throw Glaive', icon: 185123 },
  442788: { name: 'Consume Soul', icon: 228532 }, // Incorruptible Spirit
  228532: { name: 'Consume Soul', icon: 228532 },
  1256619: { name: 'Voidfall Meteor', icon: 1256305 }, // World Killer
  1256305: { name: 'Voidfall Meteor', icon: 1256305 },
  1264129: { name: 'Collapsing Star', icon: 1221162 }, // Meteor Shower
  1221162: { name: 'Collapsing Star', icon: 1221162 },
  // Hunter
  1253836: { name: 'Rapid Fire', icon: 257044 }, // Sanctified Armaments
  385540: { name: 'Exhilaration', icon: 109304 }, // Rejuvenating Wind
  109304: { name: 'Exhilaration', icon: 109304 },
  // Druid
  1271222: { name: 'Starfire', icon: 194153 }, // Starsurge (Star Cascade)
  194153: { name: 'Starfire', icon: 194153 },
  1240913: { name: 'Starfall', icon: 191034 }, // Meteorites
  191037: { name: 'Starfall', icon: 191034 },
  1301742: { name: 'Starfall', icon: 191034 },
  428682: { name: 'Fury of Elune', icon: 202770 }, // Boundless Moonlight
  211545: { name: 'Fury of Elune', icon: 202770 },
  394111: { name: 'Fury of Elune', icon: 202770 },
  1263137: { name: 'Ascendant Eclipses', icon: 1263137 }, // Lunar Bolt
  1261573: { name: 'Ascendant Eclipses', icon: 1263137 }, // Solar Bolt
  // Paladin (protection)
  433808: { name: 'Consecration', icon: 26573 }, // Divine Guidance
  81297: { name: 'Consecration', icon: 26573 },
  469882: { name: "Avenger's Shield", icon: 31935 }, // Refining Fire
  1269175: { name: "Avenger's Shield", icon: 31935 }, // Glory of the Vanguard
  31935: { name: "Avenger's Shield", icon: 31935 },
  // Death Knight
  1264083: { name: 'Obliterate', icon: 49020 }, // Obliterate Off-Hand
  66198: { name: 'Obliterate', icon: 49020 }, // Obliterate Off-Hand
  1264082: { name: 'Obliterate', icon: 49020 },
  222024: { name: 'Obliterate', icon: 49020 },
  66196: { name: 'Frost Strike', icon: 49143 }, // Frost Strike Off-Hand
  222026: { name: 'Frost Strike', icon: 49143 },
  456371: { name: 'Remorseless Winter', icon: 196771 }, // Cryogenic Chamber
  196771: { name: 'Remorseless Winter', icon: 196771 },
  435802: { name: "Reaper's Mark", icon: 439843 }, // Wave of Souls
  439843: { name: "Reaper's Mark", icon: 439843 },
  436304: { name: "Reaper's Mark", icon: 439843 },
  439594: { name: "Reaper's Mark", icon: 439843 },
  434144: { name: 'Vampiric Strike', icon: 433895 }, // Infliction of Sorrow
  433895: { name: 'Vampiric Strike', icon: 433895 },
  1264304: { name: 'Death Strike', icon: 49998 }, // Lifeblood
  45470: { name: 'Death Strike', icon: 49998 },
  // Warrior
  315961: { name: 'Overpower', icon: 7384 }, // Dreadnaught
  7384: { name: 'Overpower', icon: 7384 },
  // Items
  1305374: { name: "Voracious Heart of Ula'tek", icon: 1305374 }, // Devour Morsel
  1305395: { name: "Zatha'tek, Breath of Corruption", icon: 1305395 }, // Breath of Corruption
  1243106: { name: "Idol of N'Zoth", icon: 1243106 }, // Vision of N'Zoth
  1243105: { name: "Idol of N'Zoth", icon: 1243106 }, // Horrific Vision
  1306639: { name: 'Venomfang', icon: 1306635 }, // Venomfang Burst
  1306635: { name: 'Venomfang', icon: 1306635 },
  1307222: { name: 'Font of Venomous Rage', icon: 1297908 }, // Venom Splatter
  1297908: { name: 'Font of Venomous Rage', icon: 1297908 },
  1287955: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Void-Tainted Shell
  1307578: { name: 'Soulcoiler Ritual Vessel', icon: 1291894 }, // Soulcoil Barrier
  1263002: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Unleashed Fire
  1287665: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Lingering
  1287908: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Self-Mending
  1286970: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Unleashed Fire
  1287663: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Lingering
  1289063: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Echoes
  1303048: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Echoes
  1303071: { name: 'Omnium Folio', icon: 1263002 }, // Rune of Echoes
};

/** Same-named spells Warcraft Logs keeps apart. */
const KEEP_APART = new Set([
  1245369, // Beacon of the Savior
  1244893, // Beacon of the Savior
]);

/** Abilities nested the way Warcraft Logs nests them. */
export type AbilityGroup = {
  key: string;
  /** The row to show: the ability itself, or the group's sum. */
  head: AbilityRow;
  /** The spells in it; the main one (cast, else biggest) first. */
  parts: AbilityRow[];
  /** A group to open even with one spell in it (an item, a pet...). */
  nested: boolean;
};

const isTotem = (name: string) => /totem$/i.test(name);

export const groupAbilities = (abilities: AbilityRow[]): AbilityGroup[] => {
  // The raider's own spells by name: a totem's copy of one (Surging
  // Totem's Chain Heal) goes in with it.
  const own = new Set(abilities.filter((a) => !a.by).map((a) => a.name));
  const groups = new Map<
    string,
    { list: AbilityRow[]; parent?: { name: string; icon: number } }
  >();
  abilities.forEach((a) => {
    let key: string;
    let parent: { name: string; icon: number } | undefined;
    const cost = Boolean(a.negative);
    const nest = cost ? undefined : NESTED_UNDER[a.spellId];
    if (cost) {
      // Negative healing (Spirit Link's damage): a row of its own.
      key = `cost:${a.spellId}|${a.by}`;
    } else if (nest) {
      // Everyone's share of one parent together (a warlock's demons'
      // Dominion of Argus spells, a totem's Healing Rain).
      key = `nest:${nest.name}`;
      parent = nest;
    } else if (a.by && isTotem(a.by) && own.has(a.name)) {
      key = `${a.name}||${a.kind ?? ''}`;
    } else if (a.by) {
      // A pet's or guardian's spells together, under what summoned it.
      const name = a.summon?.name || a.by;
      key = `pet:${name}`;
      parent = { name, icon: a.summon?.id ?? a.spellId };
    } else if (KEEP_APART.has(a.spellId)) {
      key = `id:${a.spellId}|${a.kind ?? ''}`;
    } else {
      // A spell's heal and shield of the same name are one row
      // (Exhilarating Execution), as on Warcraft Logs.
      key = `${a.name}|${a.by}`;
    }
    const g = groups.get(key) ?? { list: [] };
    g.list.push(a);
    if (parent) g.parent = parent;
    groups.set(key, g);
  });
  return [...groups.entries()].map(([key, { list, parent }]) => {
    // One pet spell on its own: just that spell (with who did it).
    // Nested even with one spell (an item's effect), except a pet's lone
    // spell or a spell alone under its own name.
    const nested =
      Boolean(parent) &&
      !(
        list.length < 2 &&
        ((key.startsWith('pet:') && !list[0].summon) ||
          list[0].name === parent?.name)
      );
    if (list.length === 1 && !nested)
      return { key, head: list[0], parts: list, nested: false };
    const parts = [...list].sort(
      (x, y) => y.casts - x.casts || y.total - x.total,
    );
    // A totem's copy isn't the one to name the group after.
    const main = parts.find((x) => !x.by) ?? parts[0];
    const head: AbilityRow = {
      ...main,
      key: `group:${key}`,
      by: nested && key.startsWith('pet:') ? '' : main.by,
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
    if (parent) {
      head.name = parent.name;
      head.spellId = parent.icon;
    }
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
      if (a.kind === 'heal' || a.kind === 'shield')
        head.kind = head.kind === 'heal' ? 'heal' : a.kind;
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
    return { key, head, parts, nested };
  });
};
