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
  buckets: Map<number, Bucket>;
};

type UnitStats = {
  total: number;
  overheal: number;
  absorbs: number;
  abilities: Map<number, AbilityStats>;
};

/**
 * Damage reduction from others' cooldowns, by the buff's spell ID: the share
 * of damage it removes. Prevented damage = taken x r / (1 - r). An estimate:
 * talents and stacking can change the real number.
 */
export const DAMAGE_REDUCTION: Record<
  number,
  { r: number; magicOnly?: boolean }
> = {
  33206: { r: 0.4 }, // Pain Suppression
  102342: { r: 0.2 }, // Ironbark
  6940: { r: 0.3 }, // Blessing of Sacrifice
  81782: { r: 0.2 }, // Power Word: Barrier
  357170: { r: 0.5 }, // Time Dilation
  374227: { r: 0.2 }, // Zephyr
  145629: { r: 0.2, magicOnly: true }, // Anti-Magic Zone
  98007: { r: 0.1 }, // Spirit Link Totem
  116849: { r: 0.0 }, // Life Cocoon is a shield: counted as an absorb
  1022: { r: 0.0 }, // Blessing of Protection: immunity, not counted
};

const DAMAGE_EVENTS = new Set([
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE',
  'DAMAGE_SPLIT',
]);
const HEAL_EVENTS = new Set(['SPELL_HEAL', 'SPELL_PERIODIC_HEAL']);
const WANTED = new Set([
  ...DAMAGE_EVENTS,
  ...HEAL_EVENTS,
  'SPELL_ABSORBED',
  'SPELL_CAST_SUCCESS',
  'SPELL_SUMMON',
  'SPELL_AURA_APPLIED',
  'SPELL_AURA_REMOVED',
  'COMBATANT_INFO',
]);

const DECIMAL = /^-?\d+\.\d+$/;
const NO_OWNER = '0000000000000000';
const isPlayer = (guid: string | undefined) =>
  Boolean(guid && guid.startsWith('Player-'));
const int = (value: string | undefined) =>
  Number.parseInt(value ?? '', 10) || 0;
// Unit flags: 0x10 = friendly.
const isFriendly = (flags: string | undefined) =>
  (Number.parseInt(flags ?? '0', 16) & 0x10) !== 0;
const shortName = (name: string) => name.split('-')[0];

/** All fields after the timestamp, honouring quotes. Not for [..] lines. */
const splitFields = (body: string): string[] => {
  const out: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(value);
      value = '';
    } else value += c;
  }
  out.push(value);
  return out;
};

/** Where the amounts start, after the advanced block (map position). */
const amountIndex = (args: string[], advanced: number) => {
  for (let i = advanced + 4; i < args.length - 2; i += 1) {
    if (DECIMAL.test(args[i]) && DECIMAL.test(args[i + 1])) return i + 5;
  }
  return advanced + 17;
};

export type MeterAbility = {
  spellId: number;
  name: string;
  total: number;
  hits: number;
  crits: number;
  casts: number;
  overheal?: number;
  /** Buckets with something in them: [bucket, amount, hits, crits, casts, overheal]. */
  b: Bucket[];
};

export type MeterRow = {
  name: string;
  specId: number;
  total: number;
  overheal?: number;
  absorbs?: number;
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
  v: 2;
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

  // Damage the raid did to each enemy, to find the boss.
  private enemyDamage = new Map<string, number>();

  /** Feed one raw combat log line from the pull. */
  public feed(line: string) {
    const start = line.indexOf('  ');
    if (start < 0) return;
    const comma = line.indexOf(',', start + 2);
    const event = line.slice(start + 2, comma < 0 ? undefined : comma);
    if (!WANTED.has(event)) return;
    const t = Math.max(0, (this.timeOf(line) - this.startMs) / 1000);
    const bucket = Math.floor(t / BUCKET_SECONDS);

    if (event === 'COMBATANT_INFO') {
      // COMBATANT_INFO,guid,faction,<23 stats>,specId,[talents]...
      const head = line.slice(start + 2, line.indexOf('['));
      const fields = head.split(',');
      this.specs.set(fields[1], int(fields[25]));
      return;
    }

    const args = splitFields(line.slice(start + 2));
    if (isPlayer(args[1]) && args[2] && args[2] !== 'nil') {
      this.names.set(args[1], shortName(args[2]));
    }
    if (isPlayer(args[5]) && args[6] && args[6] !== 'nil') {
      this.names.set(args[5], shortName(args[6]));
    }

    if (event === 'SPELL_SUMMON') {
      const owner = this.ownerOf(args[1], null);
      if (owner) this.owners.set(args[5], owner);
      return;
    }

    if (event === 'SPELL_CAST_SUCCESS') {
      const who = this.ownerOf(args[1], null);
      if (!who) return;
      const spellId = int(args[9]);
      const bySpell = this.casts.get(who) ?? new Map();
      const byBucket = bySpell.get(spellId) ?? new Map();
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
      bySpell.set(spellId, byBucket);
      this.casts.set(who, bySpell);
      const timed = this.castTimes.get(who) ?? new Map();
      const entry = timed.get(spellId) ?? { name: args[10], times: [] };
      if (entry.times.length < 200) entry.times.push(Math.round(t * 10) / 10);
      timed.set(spellId, entry);
      this.castTimes.set(who, timed);
      return;
    }

    if (event === 'SPELL_AURA_APPLIED' || event === 'SPELL_AURA_REMOVED') {
      this.trackAura(event === 'SPELL_AURA_APPLIED', args, t);
      const spellId = int(args[9]);
      const dr = DAMAGE_REDUCTION[spellId];
      if (!dr || !dr.r || !isPlayer(args[5])) return;
      const caster = this.ownerOf(args[1], null);
      const onTarget = this.reductions.get(args[5]) ?? new Map();
      if (event === 'SPELL_AURA_APPLIED' && caster)
        onTarget.set(spellId, caster);
      else onTarget.delete(spellId);
      this.reductions.set(args[5], onTarget);
      return;
    }

    if (DAMAGE_EVENTS.has(event)) {
      const hasSpell = event !== 'SWING_DAMAGE';
      const advanced = hasSpell ? 12 : 9;
      const at = amountIndex(args, advanced);
      const amount = int(args[at]) + int(args[at + 6]); // + absorbed
      const school = Number.parseInt(args[at + 3] ?? '1', 10) || 1;
      const crit = args[at + 7] === '1';
      const spellId = hasSpell ? int(args[9]) : 1;
      const spellName = hasSpell ? args[10] : 'Melee';

      const by = this.ownerOf(args[1], args[advanced + 1]);
      if (by && !isFriendly(args[7])) {
        this.add('damage', by, bucket, spellId, spellName, amount, { crit });
        this.enemyDamage.set(
          args[5],
          (this.enemyDamage.get(args[5]) ?? 0) + amount,
        );
      }
      if (
        isPlayer(args[5]) &&
        !isPlayer(args[1]) &&
        !this.owners.has(args[1])
      ) {
        this.add('taken', args[5], bucket, spellId, spellName, amount, {
          crit,
        });
        // Damage someone else's cooldown kept off this raider.
        this.reductions.get(args[5])?.forEach((caster, drId) => {
          const dr = DAMAGE_REDUCTION[drId];
          if (!dr?.r || (dr.magicOnly && school === 1)) return;
          const prevented = Math.round((amount * dr.r) / (1 - dr.r));
          this.add(
            'mitigation',
            caster,
            bucket,
            drId,
            this.auraName(drId),
            prevented,
            {},
          );
        });
      }
      return;
    }

    if (HEAL_EVENTS.has(event)) {
      const at = amountIndex(args, 12);
      const amount = int(args[at]);
      const overheal = int(args[at + 2]);
      const crit = args[at + 4] === '1';
      const by = this.ownerOf(args[1], args[13]);
      if (by && isFriendly(args[7])) {
        this.add(
          'healing',
          by,
          bucket,
          int(args[9]),
          args[10],
          Math.max(0, amount - overheal),
          {
            crit,
            overheal,
          },
        );
      }
      return;
    }

    if (event === 'SPELL_ABSORBED') {
      // attacker(4) target(4) [attack spell id, name, school] absorber(4)
      // absorb spell id, name, school, amount
      const withSpell =
        /^0x/i.test(args[11] ?? '') && /^\d+$/.test(args[9] ?? '');
      const at = withSpell ? 12 : 9;
      if (isPlayer(args[at]) && args[at + 1]) {
        this.names.set(args[at], shortName(args[at + 1]));
      }
      const by = this.ownerOf(args[at], null);
      if (!by) return;
      const amount = int(args[at + 7]);
      this.add('healing', by, bucket, int(args[at + 4]), args[at + 5], amount, {
        absorb: true,
      });
    }
  }

  /** Buffs on raiders and debuffs on enemies, applied by a raider. */
  private trackAura(applied: boolean, args: string[], t: number) {
    const caster = this.ownerOf(args[1], null);
    if (!caster) return;
    const target = args[5];
    const debuff = args[12] === 'DEBUFF';
    // Buffs on raiders, or debuffs on enemies.
    if (debuff ? isPlayer(target) || isFriendly(args[7]) : !isPlayer(target))
      return;
    const spellId = int(args[9]);
    const key = `${target}|${spellId}|${caster}`;
    const aura = this.auras.get(key) ?? {
      target,
      spellId,
      name: args[10],
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

  private auraNames = new Map<number, string>([
    [33206, 'Pain Suppression'],
    [102342, 'Ironbark'],
    [6940, 'Blessing of Sacrifice'],
    [81782, 'Power Word: Barrier'],
    [357170, 'Time Dilation'],
    [374227, 'Zephyr'],
    [145629, 'Anti-Magic Zone'],
    [98007, 'Spirit Link Totem'],
  ]);

  private auraName(spellId: number) {
    return this.auraNames.get(spellId) ?? `Spell ${spellId}`;
  }

  private ownerOf(guid: string | undefined, ownerGuid: string | null) {
    if (!guid) return null;
    if (isPlayer(guid)) return guid;
    if (ownerGuid && ownerGuid !== NO_OWNER && isPlayer(ownerGuid)) {
      this.owners.set(guid, ownerGuid);
      return ownerGuid;
    }
    return this.owners.get(guid) ?? null;
  }

  private add(
    kind: Kind,
    guid: string,
    bucket: number,
    spellId: number,
    name: string,
    amount: number,
    extra: { crit?: boolean; overheal?: number; absorb?: boolean },
  ) {
    const map = this.stats[kind];
    const unit = map.get(guid) ?? {
      total: 0,
      overheal: 0,
      absorbs: 0,
      abilities: new Map(),
    };
    unit.total += amount;
    unit.overheal += extra.overheal ?? 0;
    if (extra.absorb) unit.absorbs += amount;
    const ability = unit.abilities.get(spellId) ?? {
      spellId,
      name,
      total: 0,
      hits: 0,
      crits: 0,
      casts: 0,
      overheal: 0,
      buckets: new Map(),
    };
    ability.total += amount;
    ability.hits += 1;
    if (extra.crit) ability.crits += 1;
    ability.overheal += extra.overheal ?? 0;
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
                  b: [...a.buckets.values()].sort((x, y) => x[0] - y[0]),
                };
              }),
          };
        })
        .sort((a, b) => b.total - a.total);

    return {
      v: 2,
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
