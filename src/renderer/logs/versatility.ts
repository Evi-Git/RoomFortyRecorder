/**
 * A raider's versatility over a pull, for the damage-prevented estimate.
 *
 * The log gives one versatility rating per raider, taken at the pull
 * (COMBATANT_INFO). That snapshot includes whatever short buff was on at
 * that moment (a pre-pull potion), and nothing that came later. So: take
 * the buffs that were up at the pull back out to get the gear's rating,
 * then add each buff while it is really up.
 *
 * Amounts: tooltips where they hold at raid item level, otherwise measured
 * on Mythic kills (the snapshot's jump between two bosses, and Warcraft
 * Logs' Versatility row second by second). Buffs that give a random stat
 * can't be told from the log and are left out.
 */
import type { PullStore } from './store';

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

type VersBuff = {
  /** Rating while up (per stack when it ramps). */
  rating?: number;
  /**
   * Percentage points while up (not rating: no diminishing). A raid buff:
   * what it prevents is its caster's, under its own name, as Warcraft
   * Logs lists it.
   */
  pct?: number;
  name?: string;
  /** Gains a stack every `every` seconds up to `max` (Liquid Luster). */
  ramp?: { every: number; max: number; lasts: number };
  /**
   * Gives `highest` rating to the raider's highest secondary stat and
   * takes `lowest` from their lowest (Potion of Recklessness).
   */
  swing?: { highest: number; lowest: number };
};

/** Buffs that change versatility while up, by spell ID. */
export const VERS_BUFFS: Record<number, VersBuff> = {
  1126: { pct: 3, name: 'Mark of the Wild' },
  413984: { pct: 2, name: 'Shifting Sands' }, // Augmentation
  443574: { pct: 2, name: 'Ox Stance' }, // Conduit of the Celestials
  // Liquid Luster: a stack of Lustrous Gleam every 6 s for 30 s. 420 a
  // stack at the rank raiders drink (3 stacks at the pull = the +1,260
  // the snapshot shows on a pre-potted pull).
  1295147: { rating: 420, ramp: { every: 6, max: 5, lasts: 30 } },
  // Potion of Recklessness, as the snapshot shows it on a pre-potted pull.
  1236994: { swing: { highest: 1724, lowest: 231 } },
  1295898: { rating: 50 }, // Versatile Ritual (Soulcoiler Ritual Vessel)
  1292300: { rating: 300 }, // Brittle Torga Totem
  271107: { rating: 370 }, // Golden Luster
  1241764: { rating: 99 }, // Nature's Tenacity (weapon enchant)
  1287770: { rating: 53 }, // Rune of the Versatile Warrior
  1308013: { rating: 84 }, // 50-Lb Midnight Salmon: all four stats up
  1308014: { rating: -17 }, // Rotting Voidfin: all four stats down
  // Venomcursed Critical Strike / Mastery / Haste: the other stats drop.
  1307910: { rating: -33 },
  1307922: { rating: -33 },
  1307927: { rating: -33 },
};

/** What a Vantus Rune gives on its boss (Vantus Rune: Tides' tooltip). */
const VANTUS_RATING = 162;

/**
 * The buff a Vantus Rune leaves for the week names its boss; the bonus
 * only counts on that boss. It is not in the pull's snapshot.
 */
export const VANTUS_BOSS: Record<number, string> = {};
[
  "Nek'zali, the Soulcoiler",
  'Entombed Sentinels',
  'Tortollan Explorers',
  'Vashnik',
  'Sszorak',
  'Vexhul & Ithraz',
  "Zul'jan",
  "Ula'tek",
].forEach((boss, i) => {
  VANTUS_BOSS[1303172 + i] = boss;
  VANTUS_BOSS[1303180 + i] = boss;
});

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bthe\b/g, '')
    .replace(/[^a-z]/g, '');

/** Is this pull against the boss a rune names? */
const runeFits = (p: PullStore, boss: string) => {
  const parts = boss.split(' & ').map(plain).filter(Boolean);
  const encounter = plain(p.encounter ?? '');
  if (encounter && parts.some((x) => encounter.includes(x))) return true;
  // A rune can name a boss inside an encounter with another name
  // (Zul'jan at the Coiled Altar): look for that enemy in the pull.
  return p.units.some(
    (u) => u.npcId > 0 && !u.raider && parts.includes(plain(u.name)),
  );
};

/** A raid buff's part of a raider's versatility at one moment. */
export type VersShare = {
  caster: number;
  spellId: number;
  name: string;
  pct: number;
};

type Piece = {
  start: number;
  end: number;
  rating: number;
  pct: number;
  /** Set on percentage buffs: who it counts for. */
  share?: Omit<VersShare, 'pct'>;
  /** Lustrous Gleam: when the potion was drunk. */
  ramp?: { from: number; every: number; max: number };
};

const ratingAt = (x: Piece, t: number) =>
  x.ramp
    ? x.rating *
      Math.max(
        1,
        Math.min(x.ramp.max, 1 + Math.floor((t - x.ramp.from) / x.ramp.every)),
      )
    : x.rating;

/**
 * Versatility percentage of each raider (by unit index) at a time in the
 * pull: their own (gear, plus the potions, procs and rune up at that
 * moment) is returned; raid buffs' parts are put in `shares`.
 */
export const versTimelines = (p: PullStore) => {
  const pieces = new Map<number, Piece[]>();
  const push = (d: number, x: Piece) => {
    const list = pieces.get(d) ?? [];
    list.push(x);
    pieces.set(d, list);
  };
  p.auras.forEach((a) => {
    if (a.dst < 0 || a.debuff || !p.units[a.dst].raider) return;
    const id = p.spells[a.spell]?.id ?? 0;
    const boss = VANTUS_BOSS[id];
    if (boss) {
      // Whoever wears it has it all fight, even if they died and the log
      // shows it again later.
      if (a.start === 0 && runeFits(p, boss))
        push(a.dst, {
          start: -1,
          end: Infinity,
          rating: VANTUS_RATING,
          pct: 0,
        });
      return;
    }
    const buff = VERS_BUFFS[id];
    if (!buff) return;
    const piece: Piece = { start: a.start, end: a.end, rating: 0, pct: 0 };
    if (buff.pct) {
      piece.pct = buff.pct;
      const src = a.src >= 0 ? p.units[a.src].root : -1;
      piece.share = {
        caster: src >= 0 && p.units[src].raider ? src : a.dst,
        spellId: id,
        name: buff.name ?? p.spells[a.spell]?.name ?? '',
      };
    }
    if (buff.rating) piece.rating = buff.rating;
    if (buff.ramp) {
      // Up since before the pull: it began `lasts` seconds before it ended.
      piece.ramp = {
        from: a.start === 0 ? Math.min(0, a.end - buff.ramp.lasts) : a.start,
        every: buff.ramp.every,
        max: buff.ramp.max,
      };
    }
    if (buff.swing) {
      const guid = p.units[a.dst].guid;
      const vers = p.vers.get(guid) ?? 0;
      const other = (p.secondary?.get(guid) ?? [0, 0, 0]).slice();
      // A pre-potted snapshot already has the swing in it: the highest
      // and lowest stay highest and lowest.
      const hi = Math.max(vers, ...other);
      const lo = Math.min(vers, ...other);
      if (!other.some((x) => x > 0)) return;
      if (vers === hi) piece.rating = buff.swing.highest;
      else if (vers === lo) piece.rating = -buff.swing.lowest;
      else return;
    }
    push(a.dst, piece);
  });
  // Gear rating: the snapshot without the rating buffs that were up at
  // the pull (the rune's bonus is never in it).
  const gear = new Map<number, number>();
  p.units.forEach((u, d) => {
    if (!u.raider) return;
    let rating = p.vers.get(u.guid) ?? 0;
    (pieces.get(d) ?? []).forEach((x) => {
      if (x.start === 0 && x.rating) rating -= ratingAt(x, 0);
    });
    gear.set(d, rating);
  });
  return (d: number, t: number, shares: VersShare[]) => {
    let rating = gear.get(d) ?? 0;
    shares.length = 0;
    const list = pieces.get(d);
    if (list)
      for (let i = 0; i < list.length; i += 1) {
        const x = list[i];
        if (t < x.start || t >= x.end) continue;
        if (x.share) {
          // The same buff from two casters counts once.
          if (!shares.some((s) => s.spellId === x.share!.spellId))
            shares.push({ ...x.share, pct: x.pct });
        } else rating += ratingAt(x, t);
      }
    return versPercent(Math.max(0, rating));
  };
};
