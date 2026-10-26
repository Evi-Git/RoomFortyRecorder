import { DAMAGE_REDUCTION } from '../../parsing/PullMeters';
import { Ctx, window_ } from './query';
import { F, K, PullStore } from './store';
import {
  availabilityAt,
  Availability,
  defensiveFor,
  DefensiveUse,
} from './defensives';

/**
 * [RoomFortyRecorder] The Logs page's Deaths tab, after Warcraft Logs: each
 * raider death in view with its killing blow, a recap of what happened to
 * them before it (hits, heals, shields, their casts, defensives and
 * debuffs, with health after each), and the defensives they still had.
 */

/** Seconds of recap kept before each death (the view picks how many show). */
export const RECAP_MAX_SECONDS = 30;
const RECAP_MAX_ROWS = 600;
/** A killing blow is the last hit at most this long before the death. */
const KILLING_BLOW_SECONDS = 10;

export type RecapKind =
  | 'damage'
  | 'heal'
  | 'shield'
  | 'cast'
  | 'buff'
  | 'buffGone'
  | 'debuff';

export type RecapRow = {
  /** Seconds before the death (negative), and in the pull. */
  dt: number;
  t: number;
  kind: RecapKind;
  spellId: number;
  spell: string;
  source: string;
  /** Spec of the source when it's a raider (or their pet); 0 for enemies. */
  sourceSpec: number;
  sourcePlayer: boolean;
  /** Damage or healing that landed, or what a shield took. */
  amount: number;
  absorbed: number;
  overkill: number;
  overheal: number;
  crit: boolean;
  tick: boolean;
  /** Health % after the event, when the log says. */
  hp: number | null;
};

export type KillingBlow = {
  spellId: number;
  spell: string;
  source: string;
  amount: number;
  overkill: number;
};

export type DeathDetail = {
  key: string;
  pull: number;
  pullLabel: string;
  /** Which death this was in its pull (1 = first). */
  order: number;
  t: number;
  /** On the combined timeline of the pulls in view. */
  at: number;
  name: string;
  guid: string;
  specId: number;
  killing: KillingBlow | null;
  /** Damage taken and healing received in the last 5 seconds. */
  taken5: number;
  healed5: number;
  recap: RecapRow[];
  /** Defensive buffs up when they died. */
  up: { spellId: number; name: string }[];
  /** Defensives and health items they pressed this pull, before dying. */
  used: { t: number; ability: string }[];
  available: Availability[];
};

const raiderUnit = (p: PullStore, u: number) =>
  u >= 0 && p.units[p.units[u].root].raider;

const isDefensiveAura = (id: number, name: string) => {
  if (DAMAGE_REDUCTION[id]) return true;
  const entry = defensiveFor(name);
  return Boolean(
    entry && entry.kind !== 'potion' && entry.kind !== 'healthstone',
  );
};

/** First event at or after `t` (events are in time order). */
const firstAt = (p: PullStore, t: number) => {
  let lo = 0;
  let hi = p.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.t[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Each raider's defensive presses in the pull (a burst counts once). */
const defensiveUses = (p: PullStore) => {
  const out = new Map<number, DefensiveUse[]>();
  for (let i = 0; i < p.n; i += 1) {
    if (p.k[i] !== K.CAST || p.f[i] & F.PROC) continue;
    const s = p.s[i];
    if (s < 0 || !p.units[s].player || !p.units[s].raider) continue;
    const entry = defensiveFor(p.spells[p.sp[i]]?.name ?? '');
    if (!entry) continue;
    const list = out.get(s) ?? [];
    const t = p.t[i];
    // Channels (Tranquility, Divine Hymn) log a cast per tick.
    if (!list.some((u) => u.entry.name === entry.name && t - u.t < 10)) {
      list.push({ t, entry });
      out.set(s, list);
    }
  }
  return out;
};

const recapOf = (p: PullStore, unit: number, t: number): RecapRow[] => {
  const rows: RecapRow[] = [];
  const end = firstAt(p, t + 0.001);
  for (let i = firstAt(p, t - RECAP_MAX_SECONDS); i < end; i += 1) {
    const kind = p.k[i];
    const s = p.s[i];
    const d = p.d[i];
    const spell = p.spells[p.sp[i]];
    const id = spell?.id ?? 0;
    const name = spell?.name ?? '';
    let rk: RecapKind | null = null;
    if (d === unit) {
      if (kind === K.DMG) rk = 'damage';
      else if (kind === K.HEAL && (p.a[i] || p.b[i] || p.x[i])) rk = 'heal';
      else if (kind === K.ABSORB) rk = 'shield';
      else if (kind === K.APPLY || kind === K.REMOVE) {
        const debuff = (p.f[i] & F.DEBUFF) !== 0;
        if (debuff) {
          if (kind === K.APPLY && !raiderUnit(p, s)) rk = 'debuff';
        } else if (isDefensiveAura(id, name)) {
          rk = kind === K.APPLY ? 'buff' : 'buffGone';
        }
      }
    }
    // Buffs coming off because they died.
    if (rk === 'buffGone' && p.t[i] > t - 0.05) rk = null;
    if (!rk && s === unit && kind === K.CAST && !(p.f[i] & F.PROC)) rk = 'cast';
    if (!rk) continue;
    const src = s >= 0 ? p.units[s] : null;
    const root = src ? p.units[src.root] : null;
    rows.push({
      dt: Math.round((p.t[i] - t) * 1000) / 1000,
      t: p.t[i],
      kind: rk,
      spellId: id,
      spell: name || (id === 1 ? 'Melee' : ''),
      source: src?.name || (kind === K.DMG && s < 0 ? 'Environment' : ''),
      sourceSpec: root?.player ? root.specId : 0,
      sourcePlayer: Boolean(root?.player),
      amount: p.a[i],
      absorbed: kind === K.DMG ? p.b[i] : kind === K.HEAL ? p.b[i] : 0,
      overkill: kind === K.DMG ? Math.max(0, p.aux[i]) : 0,
      overheal: kind === K.HEAL ? p.x[i] : 0,
      crit: (p.f[i] & F.CRIT) !== 0,
      tick: (p.f[i] & F.TICK) !== 0,
      hp: p.hp[i] === 255 ? null : p.hp[i],
    });
  }
  return rows.length > RECAP_MAX_ROWS ? rows.slice(-RECAP_MAX_ROWS) : rows;
};

/** Every raider death in view (slice and death cut-off applied), in order. */
export const deathDetails = (ctx: Ctx): DeathDetail[] => {
  const out: DeathDetail[] = [];
  ctx.pulls.forEach((p, pi) => {
    const [from, to] = window_(ctx, pi);
    const deaths = p.deaths.filter((d) => d.t >= from && d.t <= to + 0.01);
    if (!deaths.length) return;
    const uses = defensiveUses(p);
    const warlock = p.units.some(
      (u) => u.raider && u.player && u.specId >= 265 && u.specId <= 267,
    );
    deaths.forEach((d) => {
      const u = p.units[d.unit];
      const recap = recapOf(p, d.unit, d.t);
      const hits = recap.filter((r) => r.kind === 'damage');
      const last = hits[hits.length - 1];
      const killing =
        last && d.t - last.t <= KILLING_BLOW_SECONDS
          ? {
              spellId: last.spellId,
              spell: last.spell,
              source: last.source,
              amount: last.amount + last.absorbed,
              overkill: last.overkill,
            }
          : null;
      const within5 = recap.filter((r) => r.dt >= -5);
      const mine = (uses.get(d.unit) ?? []).filter((x) => x.t <= d.t);
      out.push({
        key: `${p.id}:${d.unit}:${d.t}`,
        pull: pi,
        pullLabel: p.label,
        order: p.deaths.indexOf(d) + 1,
        t: d.t,
        at: ctx.offsets[pi] + d.t,
        name: u.name,
        guid: u.guid,
        specId: u.specId,
        killing,
        taken5: within5
          .filter((r) => r.kind === 'damage')
          .reduce((n, r) => n + r.amount + r.absorbed, 0),
        healed5: within5
          .filter((r) => r.kind === 'heal' || r.kind === 'shield')
          .reduce((n, r) => n + r.amount + r.absorbed, 0),
        recap,
        up: p.auras
          .filter(
            (a) =>
              a.dst === d.unit &&
              !a.debuff &&
              a.start <= d.t &&
              a.end >= d.t - 0.05 &&
              isDefensiveAura(
                p.spells[a.spell]?.id ?? 0,
                p.spells[a.spell]?.name ?? '',
              ),
          )
          .map((a) => ({
            spellId: p.spells[a.spell]?.id ?? 0,
            name: p.spells[a.spell]?.name ?? '',
          })),
        used: mine.map((x) => ({ t: x.t, ability: x.entry.name })),
        available: availabilityAt(u.specId, mine, d.t, warlock),
      });
    });
  });
  return out;
};

/**
 * Deaths folded for reading: 4 or more to one ability within 2 seconds in
 * the same pull (a wipe mechanic) become one group, like the Dashboard.
 */
export const foldDeaths = (deaths: DeathDetail[]) => {
  const out: DeathDetail[][] = [];
  const used = new Set<number>();
  deaths.forEach((d, i) => {
    if (used.has(i)) return;
    const spell = d.killing?.spell;
    const same = spell
      ? deaths
          .map((o, j) => ({ o, j }))
          .filter(
            ({ o, j }) =>
              j >= i &&
              !used.has(j) &&
              o.pull === d.pull &&
              o.killing?.spell === spell &&
              o.t - d.t <= 2,
          )
          .map(({ j }) => j)
      : [i];
    if (same.length >= 4) {
      same.forEach((j) => used.add(j));
      out.push(same.map((j) => deaths[j]));
    } else {
      used.add(i);
      out.push([d]);
    }
  });
  return out;
};

/** Killing blows by ability, most deaths first. */
export const killingBlows = (deaths: DeathDetail[]) => {
  const by = new Map<
    string,
    { spellId: number; spell: string; count: number; names: string[] }
  >();
  deaths.forEach((d) => {
    const spell = d.killing?.spell || 'Unknown';
    const row = by.get(spell) ?? {
      spellId: d.killing?.spellId ?? 0,
      spell,
      count: 0,
      names: [],
    };
    row.count += 1;
    if (!row.names.includes(d.name)) row.names.push(d.name);
    by.set(spell, row);
  });
  return [...by.values()].sort((a, b) => b.count - a.count);
};
