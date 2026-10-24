/**
 * [RoomFortyRecorder] Meters for one raid pull, worked out in the app from
 * every combat log line (the upload itself is filtered, so the server can't).
 *
 * Per raider: damage done, healing (effective, with overheal; absorbs count
 * as healing for whoever cast the shield), damage taken, and an estimate of
 * damage prevented by others' damage-reduction cooldowns (Pain Suppression,
 * Ironbark...). Pets and guardians count for their owner.
 *
 * Every ability keeps its amounts in 5-second buckets, so the app can add up
 * any slice of the fight. Sent to the server as one extra line at the end of
 * the pull's log (see PullLogCapture).
 *
 * No Electron dependencies so it can be tested against real logs.
 */

import {
  isFriendlyFlags,
  isPlayerGuid,
  NO_GUID,
  parseLine,
  shortName,
} from './LogEvents';

export const METERS_LINE_PREFIX = 'ROOMFORTY_METERS ';
export const BUCKET_SECONDS = 5;
const MAX_ABILITIES = 40;

type Kind = 'damage' | 'healing' | 'taken' | 'mitigation';

// [bucket, amount, hits, crits, casts, overheal]
type Bucket = [number, number, number, number, number, number];

type AbilityStats = {
  spellId: number;
  name: string;
  total: number;
  hits: number;
  crits: number;
  casts: number;
  overheal: number;
  mitigated: number;
  buckets: Map<number, Bucket>;
};

type UnitStats = {
  total: number;
  overheal: number;
  absorbs: number;
  mitigated: number;
  abilities: Map<number, AbilityStats>;
};

/**
 * Damage reduction from others' cooldowns, by the buff's spell ID: the share
 * of damage it removes. Prevented damage = taken x r / (1 - r). An estimate:
 * talents and stacking can change the real number.
 */
export const DAMAGE_REDUCTION: Record<
  number,
  {
    r: number;
    name: string;
    magicOnly?: boolean;
    // Worn and cast by the same raider.
    personal?: boolean;
    // The aura has no source in the log: credit whoever last cast this.
    castId?: number;
  }
> = {
  // Cast on others (credited to the caster).
  33206: { r: 0.4, name: 'Pain Suppression' },
  102342: { r: 0.2, name: 'Ironbark' },
  6940: { r: 0.3, name: 'Blessing of Sacrifice' },
  81782: { r: 0.2, name: 'Power Word: Barrier', castId: 62618 },
  357170: { r: 0.5, name: 'Time Dilation' },
  374227: { r: 0.2, name: 'Zephyr' },
  145629: { r: 0.2, name: 'Anti-Magic Zone', magicOnly: true, castId: 51052 },
  98007: { r: 0.1, name: 'Spirit Link Totem' },
  465: { r: 0.03, name: 'Devotion Aura' },
  // Personal (credited to whoever wore it).
  363916: { r: 0.3, name: 'Obsidian Scales', personal: true },
  48792: { r: 0.3, name: 'Icebound Fortitude', personal: true },
  212800: { r: 0.2, name: 'Blur', personal: true },
  22812: { r: 0.2, name: 'Barkskin', personal: true },
  61336: { r: 0.5, name: 'Survival Instincts', personal: true },
  47585: { r: 0.75, name: 'Dispersion', personal: true },
  108271: { r: 0.4, name: 'Astral Shift', personal: true },
  264735: { r: 0.2, name: 'Survival of the Fittest', personal: true },
  118038: { r: 0.3, name: 'Die by the Sword', personal: true },
  120954: { r: 0.2, name: 'Fortifying Brew', personal: true },
  31850: { r: 0.2, name: 'Ardent Defender', personal: true },
  498: { r: 0.2, name: 'Divine Protection', personal: true },
  403876: { r: 0.2, name: 'Divine Protection', personal: true },
  871: { r: 0.4, name: 'Shield Wall', personal: true },
  104773: { r: 0.25, name: 'Unending Resolve', personal: true },
  122278: { r: 0.3, name: 'Dampen Harm', personal: true },
  122783: { r: 0.6, name: 'Diffuse Magic', magicOnly: true, personal: true },
  414658: { r: 0.7, name: 'Ice Cold', personal: true },
  65116: { r: 0.1, name: 'Stoneform', personal: true },
  86659: { r: 0.5, name: 'Guardian of Ancient Kings', personal: true },
  193065: { r: 0.1, name: 'Protective Light', personal: true },
};

const DAMAGE_EVENTS = new Set([
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE',
  'DAMAGE_SPLIT',
  'ENVIRONMENTAL_DAMAGE',
]);
// Hits a shield soaked completely.
const MISS_EVENTS = new Set([
  'SPELL_MISSED',
  'SPELL_PERIODIC_MISSED',
  'RANGE_MISSED',
  'SWING_MISSED',
]);
const HEAL_EVENTS = new Set(['SPELL_HEAL', 'SPELL_PERIODIC_HEAL']);
const WANTED = new Set([
  ...DAMAGE_EVENTS,
  ...MISS_EVENTS,
  ...HEAL_EVENTS,
  'SPELL_ABSORBED',
  'SPELL_CAST_SUCCESS',
  'SPELL_SUMMON',
  'SPELL_AURA_APPLIED',
  'SPELL_AURA_REMOVED',
]);

const isPlayer = isPlayerGuid;
const isFriendly = isFriendlyFlags;

export type MeterAbility = {
  spellId: number;
  name: string;
  total: number;
  hits: number;
  crits: number;
  casts: number;
  overheal?: number;
  /** Damage taken: what armour and reductions took off. */
  mitigated?: number;
  /** Buckets with something in them: [bucket, amount, hits, crits, casts, overheal]. */
  b: Bucket[];
};

export type MeterRow = {
  name: string;
  specId: number;
  total: number;
  overheal?: number;
  absorbs?: number;
  mitigated?: number;
  abilities: MeterAbility[];
};

/** One spell's casts in the cast timeline: seconds into the pull. */
export type CastTrack = { spellId: number; name: string; times: number[] };

/** An aura's time up: [start, end] seconds into the pull. */
export type AuraTrack = {
  spellId: number;
  name: string;
  caster: string;
  intervals: [number, number][];
};

export type PullMetersData = {
  /** 3: damage taken counts every hit (1.9.32). */
  v: 3;
  source: 'app';
  bucketSeconds: number;
  duration: number;
  damage: MeterRow[];
  healing: MeterRow[];
  taken: MeterRow[];
  mitigation: MeterRow[];
  /** Cooldown-like casts (a few per pull) per raider, for the timeline. */
  casts?: { name: string; specId: number; spells: CastTrack[] }[];
  /** Cooldown buffs on each raider (from casts), and Bloodlust and co. */
  buffs?: { name: string; specId: number; auras: AuraTrack[] }[];
  raidBuffs?: AuraTrack[];
  /** Debuffs the raid kept on the boss (the enemy that took most damage). */
  bossDebuffs?: AuraTrack[];
};

// Bloodlust and its cousins (raid-wide haste).
const LUST = new Set([2825, 32182, 80353, 264667, 390386, 466904, 444257]);
// A spell cast at most this often in a pull counts as a cooldown.
const MAX_COOLDOWN_CASTS = 8;

export default class PullMeters {
  /** `startMs`: ENCOUNTER_START's time; `timeOf` reads a line's time. */
  constructor(
    private startMs: number,
    private timeOf: (line: string) => number,
  ) {}

  private names = new Map<string, string>();

  private specs = new Map<string, number>();

  private owners = new Map<string, string>();

  private stats: Record<Kind, Map<string, UnitStats>> = {
    damage: new Map(),
    healing: new Map(),
    taken: new Map(),
    mitigation: new Map(),
  };

  // Casts by owner guid -> spellId -> bucket -> count.
  private casts = new Map<string, Map<number, Map<number, number>>>();

  // Damage-reduction buffs on raiders: target guid -> spellId -> caster guid.
  private reductions = new Map<string, Map<number, string>>();

  // Every cast with its time: owner guid -> spellId -> { name, times }.
  private castTimes = new Map<
    string,
    Map<number, { name: string; times: number[] }>
  >();

  // Auras on raiders and on enemies, applied by raiders:
  // `${target}|${spellId}|${caster}` -> { open start or null, intervals }.
  private auras = new Map<
    string,
    {
      target: string;
      spellId: number;
      name: string;
      caster: string;
      debuff: boolean;
      open: number | null;
      intervals: [number, number][];
    }
  >();

  // Who last cast each spell (for auras the log gives no source).
  private lastCaster = new Map<number, string>();

  // Damage the raid did to each enemy, to find the boss.
  private enemyDamage = new Map<string, number>();

  /** Feed one raw combat log line from the pull. */
  public feed(line: string) {
    if (line.includes('  COMBATANT_INFO,')) {
      // COMBATANT_INFO,guid,faction,<23 stats>,specId,[talents]...
      const start = line.indexOf('  ');
      const head = line.slice(start + 2, line.indexOf('['));
      const fields = head.split(',');
      this.specs.set(fields[1], Number.parseInt(fields[25], 10) || 0);
      return;
    }
    const e = parseLine(line, WANTED);
    if (!e) return;
    const t = Math.max(0, (this.timeOf(line) - this.startMs) / 1000);
    const bucket = Math.floor(t / BUCKET_SECONDS);

    if (isPlayer(e.src) && e.srcName)
      this.names.set(e.src, shortName(e.srcName));
    if (isPlayer(e.dst) && e.dstName)
      this.names.set(e.dst, shortName(e.dstName));
    // The advanced block's owner is its own unit's owner (pets, guardians).
    if (e.info !== NO_GUID && e.infoOwner !== NO_GUID && !isPlayer(e.info)) {
      this.owners.set(e.info, e.infoOwner);
    }

    if (e.type === 'SPELL_SUMMON') {
      if (e.src !== NO_GUID) this.owners.set(e.dst, e.src);
      return;
    }

    if (e.type === 'SPELL_CAST_SUCCESS') {
      const who = this.ownerOf(e.src);
      if (!who) return;
      const bySpell = this.casts.get(who) ?? new Map();
      const byBucket = bySpell.get(e.spellId) ?? new Map();
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
      bySpell.set(e.spellId, byBucket);
      this.casts.set(who, bySpell);
      const timed = this.castTimes.get(who) ?? new Map();
      const entry = timed.get(e.spellId) ?? { name: e.spellName, times: [] };
      if (entry.times.length < 200) entry.times.push(Math.round(t * 10) / 10);
      timed.set(e.spellId, entry);
      this.castTimes.set(who, timed);
      this.lastCaster.set(e.spellId, who);
      return;
    }

    if (e.type === 'SPELL_AURA_APPLIED' || e.type === 'SPELL_AURA_REMOVED') {
      const applied = e.type === 'SPELL_AURA_APPLIED';
      this.trackAura(
        applied,
        e.src,
        e.dst,
        e.dstFlags,
        e.spellId,
        e.spellName,
        e.auraType,
        t,
      );
      const dr = DAMAGE_REDUCTION[e.spellId];
      if (!dr || !isPlayer(e.dst)) return;
      const caster = dr.personal
        ? e.dst
        : (this.ownerOf(e.src) ??
          (dr.castId ? this.lastCaster.get(dr.castId) : undefined));
      if (!caster) return;
      const onTarget = this.reductions.get(e.dst) ?? new Map();
      if (applied) onTarget.set(e.spellId, caster);
      else onTarget.delete(e.spellId);
      this.reductions.set(e.dst, onTarget);
      return;
    }

    const damage = DAMAGE_EVENTS.has(e.type);
    const soaked = MISS_EVENTS.has(e.type) && e.missType === 'ABSORB';
    if (damage || soaked) {
      // What hit, shields included (as Warcraft Logs counts it).
      const amount = e.amount + e.absorbed;
      if (!amount) return;
      const by = this.ownerOf(e.src);
      if (by && !isFriendly(e.dstFlags)) {
        this.add('damage', by, bucket, e.spellId, e.spellName, amount, {
          crit: e.crit,
        });
        this.enemyDamage.set(
          e.dst,
          (this.enemyDamage.get(e.dst) ?? 0) + amount,
        );
      }
      if (isPlayer(e.dst)) {
        const mitigated = e.base > amount ? e.base - amount : 0;
        this.add('taken', e.dst, bucket, e.spellId, e.spellName, amount, {
          crit: e.crit,
          mitigated,
        });
        // Damage a cooldown kept off this raider.
        this.reductions.get(e.dst)?.forEach((caster, drId) => {
          const dr = DAMAGE_REDUCTION[drId];
          if (!dr || (dr.magicOnly && e.school === 1)) return;
          const prevented = Math.round((amount * dr.r) / (1 - dr.r));
          this.add('mitigation', caster, bucket, drId, dr.name, prevented, {});
        });
      }
      return;
    }

    if (HEAL_EVENTS.has(e.type)) {
      const by = this.ownerOf(e.src);
      // Heals eaten by a heal-absorb debuff still count for the healer.
      const effective = Math.max(0, e.amount - e.overheal) + e.absorbed;
      if (by && isFriendly(e.dstFlags) && (effective || e.overheal)) {
        this.add('healing', by, bucket, e.spellId, e.spellName, effective, {
          crit: e.crit,
          overheal: e.overheal,
        });
      }
      return;
    }

    if (e.type === 'SPELL_ABSORBED') {
      if (isPlayer(e.src) && e.srcName)
        this.names.set(e.src, shortName(e.srcName));
      const by = this.ownerOf(e.src);
      if (!by || !e.amount) return;
      this.add('healing', by, bucket, e.spellId, e.spellName, e.amount, {
        absorb: true,
      });
    }
  }

  /** Buffs on raiders and debuffs on enemies, applied by a raider. */
  private trackAura(
    applied: boolean,
    src: string,
    target: string,
    targetFlags: number,
    spellId: number,
    name: string,
    auraType: string,
    t: number,
  ) {
    const caster = this.ownerOf(src);
    if (!caster) return;
    const debuff = auraType === 'DEBUFF';
    // Buffs on raiders, or debuffs on enemies.
    if (
      debuff ? isPlayer(target) || isFriendly(targetFlags) : !isPlayer(target)
    )
      return;
    const key = `${target}|${spellId}|${caster}`;
    const aura = this.auras.get(key) ?? {
      target,
      spellId,
      name,
      caster,
      debuff,
      open: null,
      intervals: [],
    };
    const at = Math.round(t * 10) / 10;
    if (applied) {
      if (aura.open === null) aura.open = at;
    } else if (aura.open !== null) {
      aura.intervals.push([aura.open, at]);
      aura.open = null;
    } else if (!aura.intervals.length) {
      // Removed before we saw it applied: up since before the pull.
      aura.intervals.push([0, at]);
    }
    this.auras.set(key, aura);
  }

  /** The raider behind a unit: itself, or a pet's (or pet's pet's) owner. */
  private ownerOf(guid: string | undefined) {
    let unit = guid;
    for (let i = 0; i < 4 && unit && unit !== NO_GUID; i += 1) {
      if (isPlayer(unit)) return unit;
      unit = this.owners.get(unit);
    }
    return null;
  }

  private add(
    kind: Kind,
    guid: string,
    bucket: number,
    spellId: number,
    name: string,
    amount: number,
    extra: {
      crit?: boolean;
      overheal?: number;
      absorb?: boolean;
      mitigated?: number;
    },
  ) {
    const map = this.stats[kind];
    const unit = map.get(guid) ?? {
      total: 0,
      overheal: 0,
      absorbs: 0,
      mitigated: 0,
      abilities: new Map(),
    };
    unit.total += amount;
    unit.overheal += extra.overheal ?? 0;
    unit.mitigated += extra.mitigated ?? 0;
    if (extra.absorb) unit.absorbs += amount;
    const ability = unit.abilities.get(spellId) ?? {
      spellId,
      name,
      total: 0,
      hits: 0,
      crits: 0,
      casts: 0,
      overheal: 0,
      mitigated: 0,
      buckets: new Map(),
    };
    ability.total += amount;
    ability.hits += 1;
    if (extra.crit) ability.crits += 1;
    ability.overheal += extra.overheal ?? 0;
    ability.mitigated += extra.mitigated ?? 0;
    const b = ability.buckets.get(bucket) ?? [bucket, 0, 0, 0, 0, 0];
    b[1] += amount;
    b[2] += 1;
    if (extra.crit) b[3] += 1;
    b[5] += extra.overheal ?? 0;
    ability.buckets.set(bucket, b);
    unit.abilities.set(spellId, ability);
    map.set(guid, unit);
  }

  /** Cast timeline, cooldown buffs, Bloodlust and boss debuffs. */
  private timelines(duration: number) {
    const end = Math.round(duration * 10) / 10;
    const nameOf = (guid: string) => this.names.get(guid) ?? '';
    // Spells each raider cast only a few times: their cooldowns.
    const cooldowns = new Map<string, Set<number>>();
    const casts = [...this.castTimes.entries()]
      .filter(([guid]) => this.names.has(guid))
      .map(([guid, spells]) => {
        const picked = [...spells.entries()].filter(
          ([, s]) => s.times.length <= MAX_COOLDOWN_CASTS,
        );
        cooldowns.set(guid, new Set(picked.map(([id]) => id)));
        return {
          name: nameOf(guid),
          specId: this.specs.get(guid) ?? 0,
          spells: picked
            .map(([spellId, s]) => ({ spellId, name: s.name, times: s.times }))
            .sort((a, b) => a.times[0] - b.times[0]),
        };
      })
      .filter((r) => r.spells.length)
      .sort((a, b) => a.name.localeCompare(b.name));

    // Closed at the end of the pull, overlaps merged.
    const closed = (a: {
      open: number | null;
      intervals: [number, number][];
    }) => {
      const all = (
        a.open === null
          ? a.intervals
          : [...a.intervals, [a.open, end] as [number, number]]
      )
        .map(([x, y]) => [Math.max(0, x), Math.min(end, y)] as [number, number])
        .sort((x, y) => x[0] - y[0]);
      const merged: [number, number][] = [];
      all.forEach(([x, y]) => {
        const last = merged[merged.length - 1];
        if (last && x <= last[1]) last[1] = Math.max(last[1], y);
        else merged.push([x, y]);
      });
      return merged;
    };

    // Bloodlust and co: the first raider's copy is the raid's.
    const lust = new Map<number, AuraTrack>();
    const buffsBy = new Map<string, AuraTrack[]>();
    let boss = '';
    let most = 0;
    this.enemyDamage.forEach((amount, guid) => {
      if (amount > most) {
        most = amount;
        boss = guid;
      }
    });
    const bossDebuffs: AuraTrack[] = [];
    this.auras.forEach((a) => {
      const intervals = closed(a).filter(([s, e]) => e > s);
      if (!intervals.length) return;
      const track = {
        spellId: a.spellId,
        name: a.name,
        caster: nameOf(a.caster),
        intervals,
      };
      if (a.debuff) {
        if (a.target === boss) bossDebuffs.push(track);
        return;
      }
      if (LUST.has(a.spellId)) {
        if (!lust.has(a.spellId)) lust.set(a.spellId, track);
        return;
      }
      // A cooldown the caster pressed (not a proc or heal-over-time), and
      // not something up all pull (a stance, Battle Shout).
      if (!cooldowns.get(a.caster)?.has(a.spellId) || !this.names.has(a.target))
        return;
      const up = intervals.reduce((n, [x, y]) => n + y - x, 0);
      if (up >= end * 0.9) return;
      const list = buffsBy.get(a.target) ?? [];
      list.push(track);
      buffsBy.set(a.target, list);
    });
    const uptime = (x: AuraTrack) =>
      x.intervals.reduce((n, [s, e]) => n + e - s, 0);
    return {
      casts,
      buffs: [...buffsBy.entries()]
        .map(([guid, auras]) => ({
          name: nameOf(guid),
          specId: this.specs.get(guid) ?? 0,
          auras: auras.sort((a, b) => a.intervals[0][0] - b.intervals[0][0]),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      raidBuffs: [...lust.values()],
      bossDebuffs: bossDebuffs
        .sort((a, b) => uptime(b) - uptime(a))
        .slice(0, 40),
    };
  }

  /** The finished meters for the raiders in the pull. */
  public finish(duration: number): PullMetersData {
    const rows = (kind: Kind): MeterRow[] =>
      [...this.stats[kind].entries()]
        .filter(([guid, s]) => this.names.has(guid) && s.total > 0)
        .map(([guid, s]) => {
          const casts = this.casts.get(guid);
          return {
            name: this.names.get(guid) as string,
            specId: this.specs.get(guid) ?? 0,
            total: s.total,
            overheal: s.overheal || undefined,
            absorbs: s.absorbs || undefined,
            mitigated: s.mitigated || undefined,
            abilities: [...s.abilities.values()]
              .sort((a, b) => b.total - a.total)
              .slice(0, MAX_ABILITIES)
              .map((a) => {
                const byBucket =
                  kind === 'damage' || kind === 'healing'
                    ? casts?.get(a.spellId)
                    : undefined;
                byBucket?.forEach((count, bucket) => {
                  const b = a.buckets.get(bucket) ?? [bucket, 0, 0, 0, 0, 0];
                  b[4] += count;
                  a.buckets.set(bucket, b);
                });
                const castTotal = byBucket
                  ? [...byBucket.values()].reduce((n, c) => n + c, 0)
                  : 0;
                return {
                  spellId: a.spellId,
                  name: a.name,
                  total: a.total,
                  hits: a.hits,
                  crits: a.crits,
                  casts: castTotal,
                  overheal: a.overheal || undefined,
                  mitigated: a.mitigated || undefined,
                  b: [...a.buckets.values()].sort((x, y) => x[0] - y[0]),
                };
              }),
          };
        })
        .sort((a, b) => b.total - a.total);

    return {
      v: 3,
      source: 'app',
      bucketSeconds: BUCKET_SECONDS,
      duration: Math.round(duration * 10) / 10,
      damage: rows('damage'),
      healing: rows('healing'),
      taken: rows('taken'),
      mitigation: rows('mitigation'),
      ...this.timelines(duration),
    };
  }
}
