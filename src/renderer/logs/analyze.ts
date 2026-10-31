/**
 * [RoomFortyRecorder] Logs → Analyze (1.9.108): a widget engine after
 * WoWAnalyzer. A widget is plain data (saved per spec on this PC, later
 * shared as guild presets); `runWidget` works it out for one raider in one
 * pull. Pure, tested in src/__tests__/parsing/Analyze.test.ts.
 *
 * Kinds:
 *   castEfficiency   casts vs possible, from the cooldown (and charges)
 *   cooldownWindow   what was cast while a cooldown (or its buff) was up
 *   procConsumption  a proc buff spent on the right spell, other, or wasted
 *   buffUptime       % up and its windows (and casts made inside them)
 *   resourceWaste    resource lost at the cap
 *   count            casts, hits, dispels or interrupts
 *   breakdown        healing or damage by spell
 *   activeTime       always be casting
 */
import { DEFAULT_FILTERS, makeCtx, meterRows, unionLength } from './query';
import { F, K, PullStore, Spell } from './store';

export type SpellRef = { name: string; id?: number };

export type WidgetKind =
  | 'castEfficiency'
  | 'cooldownWindow'
  | 'procConsumption'
  | 'buffUptime'
  | 'resourceWaste'
  | 'count'
  | 'breakdown'
  | 'activeTime';

export type WidgetSpec = {
  id: string;
  kind: WidgetKind;
  title?: string;
  /** The cooldown, buff or proc it's about. */
  spell?: SpellRef;
  /** castEfficiency: seconds (estimated from the casts when missing). */
  cooldown?: number;
  charges?: number;
  /** cooldownWindow: when the window ends: its buff ends, or seconds. */
  ends?: 'buff' | number;
  /** cooldownWindow: good casts inside; count: what to count;
   * buffUptime: casts that should land inside; procConsumption: best use. */
  spells?: SpellRef[];
  /** cooldownWindow: how many good casts make it good (default 1). */
  min?: number;
  /** procConsumption: fine uses (not best). */
  goodSpells?: SpellRef[];
  /** count */
  what?: 'casts' | 'hits' | 'dispels' | 'interrupts';
  /** resourceWaste: power type (see POWER_NAMES); the most wasted if unset. */
  power?: number;
  /** breakdown */
  metric?: 'healing' | 'damage';
  /** cooldownWindow */
  show?: 'table' | 'timeline' | 'number';
};

export const KIND_INFO: Record<WidgetKind, { name: string; hint: string }> = {
  castEfficiency: { name: 'Cast efficiency', hint: 'casts vs possible' },
  cooldownWindow: { name: 'Cooldown window', hint: 'what happened inside' },
  procConsumption: { name: 'Proc consumption', hint: 'spent, other or wasted' },
  buffUptime: { name: 'Buff uptime', hint: '% and windows' },
  resourceWaste: { name: 'Resource waste', hint: 'lost at the cap' },
  count: { name: 'Count', hint: 'casts, hits, dispels' },
  breakdown: { name: 'Healing breakdown', hint: 'by spell (or damage)' },
  activeTime: { name: 'Active time', hint: 'always be casting' },
};

const norm = (s: string) => s.trim().toLowerCase();
/** By ID, or by name: "Stasis" also matches "Stasis (Store)". */
export const matches = (
  ref: SpellRef | undefined,
  spell: Spell | undefined,
) => {
  if (!ref || !spell) return false;
  if (ref.id && spell.id === ref.id) return true;
  const a = norm(ref.name);
  const b = norm(spell.name);
  return Boolean(a) && (a === b || b.startsWith(`${a} (`));
};
const matchesAny = (refs: SpellRef[] | undefined, spell: Spell | undefined) =>
  Boolean(refs?.some((r) => matches(r, spell)));

export const unitOf = (store: PullStore, guid: string) =>
  store.units.findIndex((u) => u.guid === guid);

/** A raider's own casts (not procs), in time order. */
export const castsBy = (store: PullStore, unit: number) => {
  const out: { t: number; spell: Spell }[] = [];
  for (let i = 0; i < store.n; i += 1) {
    if (
      store.k[i] === K.CAST &&
      store.s[i] === unit &&
      !(store.f[i] & F.PROC)
    ) {
      const spell = store.spells[store.sp[i]];
      if (spell) out.push({ t: store.t[i], spell });
    }
  }
  return out;
};

/** Spells to offer in the builder: what they cast, and buffs on them. */
export const spellChoices = (store: PullStore, unit: number) => {
  const casts = new Map<string, SpellRef>();
  castsBy(store, unit).forEach(({ spell }) =>
    casts.set(norm(spell.name), { name: spell.name, id: spell.id }),
  );
  const buffs = new Map<string, SpellRef>();
  store.auras.forEach((a) => {
    if (a.dst !== unit || a.debuff) return;
    const spell = store.spells[a.spell];
    if (spell) buffs.set(norm(spell.name), { name: spell.name, id: spell.id });
  });
  const sort = (m: Map<string, SpellRef>) =>
    [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { casts: sort(casts), buffs: sort(buffs) };
};

/** Spans of a buff on the raider (or one they put up), merged. */
const buffSpans = (store: PullStore, unit: number, ref?: SpellRef) =>
  store.auras
    .filter(
      (a) =>
        !a.debuff &&
        (a.dst === unit || a.src === unit) &&
        matches(ref, store.spells[a.spell]),
    )
    .map((a) => ({
      start: a.start,
      end: Math.min(a.end, store.duration),
      bumps: a.bumps ?? 0,
      dst: a.dst,
    }));

const merge = (spans: [number, number][]) => {
  const out: [number, number][] = [];
  [...spans]
    .sort((a, b) => a[0] - b[0])
    .forEach(([a, b]) => {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    });
  return out;
};

export type Result =
  | {
      kind: 'castEfficiency';
      casts: number[];
      cooldown: number;
      charges: number;
      estimated: boolean;
      efficiency: number;
      /** Ready but not cast. */
      idle: [number, number][];
      lost: number;
    }
  | {
      kind: 'cooldownWindow';
      windows: {
        at: number;
        end: number;
        casts: { name: string; count: number; good: boolean }[];
        good: boolean;
      }[];
    }
  | {
      kind: 'procConsumption';
      procs: {
        at: number;
        grade: 'perfect' | 'good' | 'wasted';
        by?: string;
      }[];
      perfect: number;
      good: number;
      wasted: number;
    }
  | {
      kind: 'buffUptime';
      uptime: number;
      windows: [number, number][];
      /** Windows with a wanted cast in them (null when none asked). */
      filled: number | null;
    }
  | {
      kind: 'resourceWaste';
      power: number;
      wasted: number;
      gained: number;
      byPower: [number, number][];
    }
  | {
      kind: 'count';
      total: number;
      perMinute: number;
      bySpell: { name: string; id: number; count: number }[];
      times: number[];
    }
  | {
      kind: 'breakdown';
      metric: 'healing' | 'damage';
      total: number;
      rows: { name: string; id: number; total: number; share: number }[];
    }
  | { kind: 'activeTime'; active: number; share: number }
  | { kind: 'empty'; reason: string };

/**
 * Charges recharging one at a time: time spent at full charges (ready but
 * not cast) is what was lost.
 */
export const idleTime = (
  casts: number[],
  cooldown: number,
  charges: number,
  duration: number,
) => {
  let have = charges;
  let rechargeAt = Infinity;
  let t = 0;
  const idle: [number, number][] = [];
  const advance = (to: number) => {
    for (;;) {
      if (have >= charges) {
        if (to > t) idle.push([t, to]);
        t = to;
        return;
      }
      if (rechargeAt > to) {
        t = to;
        return;
      }
      t = rechargeAt;
      have += 1;
      rechargeAt = have < charges ? t + cooldown : Infinity;
    }
  };
  casts.forEach((c) => {
    advance(Math.min(c, duration));
    if (have > 0) {
      have -= 1;
      if (rechargeAt === Infinity) rechargeAt = c + cooldown;
    } else {
      // Pressed sooner than the cooldown allows (a reset): start again.
      rechargeAt = c + cooldown;
    }
  });
  advance(duration);
  return merge(idle);
};

export const runWidget = (
  store: PullStore,
  guid: string,
  spec: WidgetSpec,
): Result => {
  const unit = unitOf(store, guid);
  if (unit < 0) return { kind: 'empty', reason: 'Not in this pull.' };
  const duration = store.duration;
  const casts = () => castsBy(store, unit);

  switch (spec.kind) {
    case 'castEfficiency': {
      if (!spec.spell) return { kind: 'empty', reason: 'Pick a spell.' };
      const times = casts()
        .filter((c) => matches(spec.spell, c.spell))
        .map((c) => c.t);
      let cooldown = spec.cooldown ?? 0;
      const estimated = !cooldown;
      if (!cooldown) {
        const gaps = times.slice(1).map((t, i) => t - times[i]);
        cooldown = gaps.length ? Math.max(5, Math.min(...gaps)) : duration;
      }
      const charges = Math.max(1, spec.charges ?? 1);
      const idle = idleTime(times, cooldown, charges, duration);
      const idleSeconds = idle.reduce((s, [a, b]) => s + b - a, 0);
      const lost = idleSeconds / cooldown;
      return {
        kind: 'castEfficiency',
        casts: times,
        cooldown,
        charges,
        estimated,
        lost,
        efficiency:
          times.length + lost > 0 ? times.length / (times.length + lost) : 0,
        idle,
      };
    }
    case 'cooldownWindow': {
      if (!spec.spell) return { kind: 'empty', reason: 'Pick the cooldown.' };
      const all = casts();
      const opens = all.filter((c) => matches(spec.spell, c.spell));
      const spans = buffSpans(store, unit, spec.spell);
      const min = Math.max(1, spec.min ?? 1);
      const windows = opens.map((o, i) => {
        let end: number;
        if (spec.ends === 'buff' || spec.ends === undefined) {
          const span = spans.find(
            (s) => s.start >= o.t - 0.5 && s.start <= o.t + 2,
          );
          end = span ? span.end : o.t + 15;
        } else end = o.t + spec.ends;
        // Never into the next press of the same cooldown.
        if (i + 1 < opens.length) end = Math.min(end, opens[i + 1].t);
        end = Math.min(end, duration);
        const inside = new Map<
          string,
          { name: string; count: number; good: boolean }
        >();
        let good = 0;
        all.forEach((c) => {
          if (c.t <= o.t || c.t > end + 0.05 || c === o) return;
          const key = norm(c.spell.name);
          const isGood = matchesAny(spec.spells, c.spell);
          const e = inside.get(key) ?? {
            name: c.spell.name,
            count: 0,
            good: isGood,
          };
          e.count += 1;
          inside.set(key, e);
          if (isGood) good += 1;
        });
        return {
          at: o.t,
          end,
          casts: [...inside.values()].sort(
            (a, b) => Number(b.good) - Number(a.good) || b.count - a.count,
          ),
          good: spec.spells?.length ? good >= min : true,
        };
      });
      return { kind: 'cooldownWindow', windows };
    }
    case 'procConsumption': {
      if (!spec.spell)
        return { kind: 'empty', reason: 'Pick the proc (a buff).' };
      const all = casts();
      const procs: {
        at: number;
        grade: 'perfect' | 'good' | 'wasted';
        by?: string;
      }[] = [];
      buffSpans(store, unit, spec.spell)
        .filter((s) => s.dst === unit)
        .forEach((s) => {
          // Spent: a cast right when it fell off.
          const used = all.find(
            (c) => c.t >= s.end - 0.4 && c.t <= s.end + 0.4 && c.t >= s.start,
          );
          let grade: 'perfect' | 'good' | 'wasted' = 'wasted';
          if (used && matchesAny(spec.spells, used.spell)) grade = 'perfect';
          else if (
            used &&
            (matchesAny(spec.goodSpells, used.spell) ||
              (!spec.spells?.length && !spec.goodSpells?.length))
          )
            grade = 'good';

          procs.push({
            at: s.start,
            grade,
            by: grade === 'wasted' ? undefined : used?.spell.name,
          });
          // A refresh while it was up overwrote a proc.
          for (let b = 0; b < s.bumps; b += 1)
            procs.push({ at: s.start, grade: 'wasted' });
        });
      procs.sort((a, b) => a.at - b.at);
      const n = (g: string) => procs.filter((p) => p.grade === g).length;
      return {
        kind: 'procConsumption',
        procs,
        perfect: n('perfect'),
        good: n('good'),
        wasted: n('wasted'),
      };
    }
    case 'buffUptime': {
      if (!spec.spell) return { kind: 'empty', reason: 'Pick a buff.' };
      const windows = merge(
        buffSpans(store, unit, spec.spell)
          .filter((s) => s.dst === unit)
          .map((s) => [s.start, s.end] as [number, number]),
      );
      const up = unionLength(windows);
      let filled: number | null = null;
      if (spec.spells?.length) {
        const wanted = casts().filter((c) => matchesAny(spec.spells, c.spell));
        filled = windows.filter(([a, b]) =>
          wanted.some((c) => c.t >= a && c.t <= b),
        ).length;
      }
      return {
        kind: 'buffUptime',
        uptime: duration > 0 ? up / duration : 0,
        windows,
        filled,
      };
    }
    case 'resourceWaste': {
      const by = new Map<number, [number, number]>();
      for (let i = 0; i < store.n; i += 1) {
        if (store.k[i] === K.ENERGIZE && store.d[i] === unit) {
          const e = by.get(store.aux[i]) ?? [0, 0];
          e[0] += store.x[i];
          e[1] += store.a[i] + store.x[i];
          by.set(store.aux[i], e);
        }
      }
      const byPower = [...by.entries()]
        .map(([p, [w]]) => [p, w] as [number, number])
        .sort((a, b) => b[1] - a[1]);
      const power = spec.power ?? byPower[0]?.[0];
      if (power === undefined)
        return { kind: 'empty', reason: 'No resource gains in this pull.' };
      const [wasted, gained] = by.get(power) ?? [0, 0];
      return { kind: 'resourceWaste', power, wasted, gained, byPower };
    }
    case 'count': {
      const what = spec.what ?? 'casts';
      const kinds: Record<string, number[]> = {
        casts: [K.CAST],
        hits: [K.DMG, K.HEAL],
        dispels: [K.DISPEL],
        interrupts: [K.INTERRUPT],
      };
      const want = new Set(kinds[what]);
      const counts = new Map<
        string,
        { name: string; id: number; count: number }
      >();
      const times: number[] = [];
      for (let i = 0; i < store.n; i += 1) {
        if (!want.has(store.k[i])) continue;
        const s = store.s[i];
        // Hits count the raider's pets too.
        const mine =
          s === unit ||
          (what === 'hits' && s >= 0 && store.units[s].root === unit);
        if (!mine || (what === 'casts' && store.f[i] & F.PROC)) continue;
        const spell = store.spells[store.sp[i]];
        if (!spell || (spec.spells?.length && !matchesAny(spec.spells, spell)))
          continue;
        const key = norm(spell.name);
        const e = counts.get(key) ?? {
          name: spell.name,
          id: spell.id,
          count: 0,
        };
        e.count += 1;
        counts.set(key, e);
        times.push(store.t[i]);
      }
      const total = times.length;
      return {
        kind: 'count',
        total,
        perMinute: duration > 0 ? (total * 60) / duration : 0,
        bySpell: [...counts.values()].sort((a, b) => b.count - a.count),
        times,
      };
    }
    case 'breakdown': {
      const metric = spec.metric ?? 'healing';
      const ctx = makeCtx([store], DEFAULT_FILTERS);
      const row = meterRows(ctx, metric).find((r) => r.key === guid);
      if (!row) return { kind: 'empty', reason: `No ${metric} this pull.` };
      const byName = new Map<
        string,
        { name: string; id: number; total: number }
      >();
      row.abilities.forEach((a) => {
        const key = norm(a.name);
        const e = byName.get(key) ?? { name: a.name, id: a.spellId, total: 0 };
        e.total += a.total;
        byName.set(key, e);
      });
      const total = [...byName.values()].reduce((s, r) => s + r.total, 0);
      return {
        kind: 'breakdown',
        metric,
        total,
        rows: [...byName.values()]
          .filter((r) => r.total > 0)
          .sort((a, b) => b.total - a.total)
          .map((r) => ({ ...r, share: total ? r.total / total : 0 })),
      };
    }
    case 'activeTime': {
      const ctx = makeCtx([store], DEFAULT_FILTERS);
      const active = Math.max(
        ...(['damage', 'healing'] as const).map(
          (m) => meterRows(ctx, m).find((r) => r.key === guid)?.active ?? 0,
        ),
      );
      return {
        kind: 'activeTime',
        active,
        share: duration > 0 ? active / duration : 0,
      };
    }
    default:
      return { kind: 'empty', reason: 'Unknown widget.' };
  }
};

/** A starting layout for a spec with nothing saved yet. */
export const starterLayout = (healer: boolean): WidgetSpec[] => [
  { id: 'active', kind: 'activeTime' },
  { id: 'breakdown', kind: 'breakdown', metric: healer ? 'healing' : 'damage' },
  { id: 'waste', kind: 'resourceWaste' },
];

export const newWidgetId = () =>
  `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
