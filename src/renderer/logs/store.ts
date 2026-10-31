import {
  isFriendlyFlags,
  isPlayerGuid,
  NO_GUID,
  LogEvent,
  parseLine,
  shortName,
} from '../../parsing/LogEvents';
import {
  CastFilter,
  NOT_CAST_NAMES,
  NOT_CASTS,
} from '../../parsing/MeterRules';

export { NOT_CASTS, NOT_CAST_NAMES };

/**
 * [RoomFortyRecorder] Logs page: one pull's full combat log, read into
 * compact columns (one row per event) that every table, chart and filter
 * runs over. A 5-minute Mythic pull (~330k events) takes ~16 MB here.
 */

/** Event kinds. */
export const K = {
  DMG: 0,
  HEAL: 1,
  ABSORB: 2, // a shield soaked damage: src = shield's caster, d = protected
  CAST: 3,
  BEGIN: 4,
  APPLY: 5,
  REMOVE: 6,
  DOSE: 7,
  DIED: 8,
  INTERRUPT: 9,
  DISPEL: 10,
  ENERGIZE: 11,
  SUMMON: 12,
  RES: 13,
  MISS: 14,
  /** Healing taken away by a heal absorb (Light of the Martyr). */
  HEALABSORB: 15,
} as const;

export const KIND_NAMES = [
  'Damage',
  'Heal',
  'Absorb',
  'Cast',
  'Begin cast',
  'Apply',
  'Remove',
  'Stacks',
  'Death',
  'Interrupt',
  'Dispel',
  'Resource',
  'Summon',
  'Resurrect',
  'Miss',
  'Heal absorbed',
];

/** Flags. */
export const F = {
  CRIT: 1,
  TICK: 2,
  DEBUFF: 4,
  SOAKED: 8, // a hit a shield took completely
  /** A "cast" that isn't one: a proc, a passive, or another part of a
   * cast already counted (see NOT_CASTS and SAME_CAST_WINDOW). */
  PROC: 16,
};

export const MISS_TYPES = [
  '',
  'Miss',
  'Dodge',
  'Parry',
  'Block',
  'Resist',
  'Immune',
  'Evade',
  'Deflect',
  'Reflect',
  'Absorb',
];

export const POWER_NAMES: Record<number, string> = {
  0: 'Mana',
  1: 'Rage',
  2: 'Focus',
  3: 'Energy',
  4: 'Combo points',
  5: 'Runes',
  6: 'Runic power',
  7: 'Soul shards',
  8: 'Astral power',
  9: 'Holy power',
  11: 'Maelstrom',
  12: 'Chi',
  13: 'Insanity',
  16: 'Arcane charges',
  17: 'Fury',
  18: 'Pain',
  19: 'Essence',
};

export type Unit = {
  guid: string;
  name: string;
  player: boolean;
  friendly: boolean;
  /** Pet/guardian owner (unit index), -1 if none. */
  owner: number;
  /** The raider (or enemy) a unit's actions count for. */
  root: number;
  specId: number;
  /** In the raid (COMBATANT_INFO), or a friendly player. */
  raider: boolean;
  /** Creature ID from the GUID (0 for players). */
  npcId: number;
  /** Highest max health seen (bosses have the most). */
  maxHp: number;
  /** Seconds into the pull it first showed up (spawn waves). */
  first: number;
  /** Raiders: talents from COMBATANT_INFO as [node ID, entry ID, rank]. */
  talents?: [number, number, number][];
  /** Raiders: what they wore at the pull (COMBATANT_INFO), slot by slot. */
  gear?: GearItem[];
  /** Pets and guardians: the spell that summoned them (Time of Need...). */
  summon?: { id: number; name: string };
};

export type Spell = { id: number; name: string; school: number };

/** One equipped item, as COMBATANT_INFO lists it. */
export type GearItem = {
  /** 0 head ... 17 tabard, in the game's inventory order. */
  slot: number;
  itemId: number;
  ilvl: number;
  enchants: number[];
  bonusIds: number[];
  gems: number[];
};

type Tuple = (number | Tuple)[];

/** "(1,2,(3,4),())" -> [1, 2, [3, 4], []]; reads from text[at]. */
const readTuple = (text: string, at: number): [Tuple, number] => {
  const out: Tuple = [];
  let i = at + 1;
  let num = '';
  const flush = () => {
    if (num) out.push(Number(num));
    num = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(' || ch === '[') {
      const [inner, next] = readTuple(text, i);
      out.push(inner);
      i = next;
    } else if (ch === ')' || ch === ']') {
      flush();
      return [out, i + 1];
    } else if (ch === ',') {
      flush();
      i += 1;
    } else {
      num += ch;
      i += 1;
    }
  }
  flush();
  return [out, i];
};

const nums = (value: number | Tuple | undefined) =>
  Array.isArray(value)
    ? value.filter((n): n is number => typeof n === 'number' && n > 0)
    : [];

/** COMBATANT_INFO's gear list: the "[" after the talents and PvP talents. */
export const parseGear = (line: string, talentsClose: number): GearItem[] => {
  const open = line.indexOf('[', talentsClose + 1);
  if (open < 0) return [];
  const [list] = readTuple(line, open);
  return list
    .map((item, slot) => {
      if (!Array.isArray(item)) return null;
      const itemId = typeof item[0] === 'number' ? item[0] : 0;
      if (!itemId) return null;
      return {
        slot,
        itemId,
        ilvl: typeof item[1] === 'number' ? item[1] : 0,
        enchants: nums(item[2]),
        bonusIds: nums(item[3]),
        // (gem item ID, gem item level) pairs.
        gems: nums(item[4]).filter((_, i) => i % 2 === 0),
      };
    })
    .filter((g): g is GearItem => Boolean(g));
};

export type AuraSpan = {
  spell: number;
  src: number;
  dst: number;
  start: number;
  end: number;
  debuff: boolean;
  /** Refreshes and stacks added while it was up (Warcraft Logs counts
   * each as a use). */
  bumps?: number;
};

export type Death = {
  t: number;
  unit: number;
  /** Last hit before death. */
  spell: number;
  src: number;
  amount: number;
};

export type PullMeta = {
  id: string;
  label: string;
  encounterId: number;
  difficultyId: number;
  startedAt: number;
  result: string;
};

export type PullStore = PullMeta & {
  duration: number;
  units: Unit[];
  spells: Spell[];
  n: number;
  t: Float32Array;
  k: Uint8Array;
  s: Int32Array;
  d: Int32Array;
  sp: Int32Array;
  /** Damage: what landed. Heal: effective. Energize: gained. Absorb: soaked. */
  a: Float64Array;
  /** Damage: absorbed by shields. Heal: eaten by heal-absorbs. */
  b: Float64Array;
  /** Damage: before reductions. Heal: overheal. Energize: wasted. Dose: stacks. Absorb: attacker. */
  x: Float64Array;
  f: Uint8Array;
  /** Miss type; interrupted/dispelled spell; power type; absorbed attack's spell. */
  aux: Int32Array;
  /** Health % of the unit hit/healed after the event (255: unknown). */
  hp: Uint8Array;
  auras: AuraSpan[];
  /** Raider power over the pull: unit -> [t, current, max, type] once a second. */
  power: Map<number, [number, number, number, number][]>;
  /**
   * Raider resources, every type they have: unit -> power type -> [t,
   * current, max], one point each time the value changes.
   */
  powers: Map<number, Map<number, [number, number, number][]>>;
  /** Raiders' versatility rating (COMBATANT_INFO), by GUID. */
  vers: Map<string, number>;
  deaths: Death[];
  /** The enemy the raid hit hardest. */
  boss: number;
};

const MISS_CODE: Record<string, number> = {
  MISS: 1,
  DODGE: 2,
  PARRY: 3,
  BLOCK: 4,
  RESIST: 5,
  IMMUNE: 6,
  EVADE: 7,
  DEFLECT: 8,
  REFLECT: 9,
  ABSORB: 10,
};

const DAMAGE = new Set([
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE',
  'DAMAGE_SPLIT',
  'ENVIRONMENTAL_DAMAGE',
]);
const MISSED = new Set([
  'SPELL_MISSED',
  'SPELL_PERIODIC_MISSED',
  'RANGE_MISSED',
  'SWING_MISSED',
]);
const WANTED = new Set([
  ...DAMAGE,
  ...MISSED,
  'SPELL_HEAL',
  'SPELL_PERIODIC_HEAL',
  'SPELL_ABSORBED',
  'SPELL_HEAL_ABSORBED',
  'SPELL_CAST_SUCCESS',
  'SPELL_CAST_START',
  'SPELL_AURA_APPLIED',
  'SPELL_AURA_REMOVED',
  'SPELL_AURA_APPLIED_DOSE',
  'SPELL_AURA_REMOVED_DOSE',
  'SPELL_AURA_REFRESH',
  'UNIT_DIED',
  'SPELL_INTERRUPT',
  'SPELL_DISPEL',
  'SPELL_STOLEN',
  'SPELL_ENERGIZE',
  'SPELL_PERIODIC_ENERGIZE',
  'SPELL_SUMMON',
  'SPELL_RESURRECT',
]);

/** Seconds since 1970 from "M/D/YYYY HH:MM:SS.ffff" (local, no zone). */
const dayCache = { key: '', base: 0 };
const STAMP = /^\s*(\d+)\/(\d+)(?:\/(\d+))?\s+(\d+):(\d+):(\d+(?:\.\d+)?)/;
export const lineSeconds = (line: string) => {
  // "M/D/YYYY HH:MM:SS.ffff" — newer clients add a time zone after the
  // seconds ("...17.7771-4"), older ones leave out the year.
  const m = STAMP.exec(line);
  if (!m) return Number.NaN;
  const key = `${m[1]}/${m[2]}/${m[3] ?? ''}`;
  if (key !== dayCache.key) {
    dayCache.key = key;
    dayCache.base =
      Date.UTC(Number(m[3]) || 2000, Number(m[1]) - 1, Number(m[2])) / 1000;
  }
  return dayCache.base + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]);
};

/** Builds a PullStore from the lines of one pull (START..END). */
/** Spells shown under a clearer name than the log's (both halves of Stasis). */
const RENAMED: Record<number, string> = {
  370537: 'Stasis (Store)',
  370564: 'Stasis (Release)',
};

export class StoreBuilder {
  private start = -1;

  private end = 0;

  private units: Unit[] = [];

  private unitIndex = new Map<string, number>();
  /** GUIDs only ever written as "Unknown" so far. */
  private unnamed = new Set<string>();

  private spells: Spell[] = [];

  private spellIndex = new Map<number, number>();

  private envIndex = new Map<string, number>();

  private n = 0;

  private cap = 65536;

  private cols = this.alloc(65536);

  private specs = new Map<string, number>();

  private talents = new Map<string, [number, number, number][]>();

  private gear = new Map<string, GearItem[]>();

  private vers = new Map<string, number>();

  /** Buffs each raider had at the pull (COMBATANT_INFO): [caster, spell]. */
  private prepull = new Map<number, [number, number][]>();

  /** When each aura (caster|target|spell) was refreshed or gained a stack. */
  private refreshT = new Map<string, number[]>();

  private stackT = new Map<string, number[]>();

  /** When a stack fell off (a refresh then isn't a use either). */
  private unstackT = new Map<string, number[]>();

  private power = new Map<number, [number, number, number, number][]>();

  private powers = new Map<number, Map<number, [number, number, number][]>>();

  private fightSeconds = 0;

  private lastT = 0;

  /** A resource level at time t (a point when it changes). */
  private setPower(
    who: number,
    type: number,
    t: number,
    cur: number,
    max: number,
  ) {
    let byType = this.powers.get(who);
    if (!byType) {
      byType = new Map();
      this.powers.set(who, byType);
    }
    const list = byType.get(type) ?? [];
    const last = list[list.length - 1];
    if (last && last[1] === cur && last[2] === max) return;
    const at = Math.round(t * 100) / 100;
    // Several changes in one moment: keep the latest.
    if (last && last[0] >= at) {
      last[1] = cur;
      last[2] = max;
    } else list.push([at, cur, max]);
    byType.set(type, list);
  }

  /**
   * Resource levels. The advanced block reads out the resource an event is
   * about (mana on most, holy power on a spender), as it was before the
   * event's cost; between readings, gains are added and casts' costs taken
   * off, so resources read out rarely (combo points, holy power) still
   * follow every change.
   */
  private notePowers(who: number, t: number, e: LogEvent, cast: boolean) {
    const types = e.infoPowerTypes.split('|');
    const curs = e.infoPowers.split('|');
    const maxes = e.infoMaxPowers.split('|');
    const costs = e.infoPowerCosts.split('|');
    for (let j = 0; j < types.length; j += 1) {
      const type = Number(types[j]);
      const cur = Number(curs[j]);
      const max = Number(maxes[j]);
      if (!Number.isFinite(type) || type < 0) continue;
      if (!Number.isFinite(cur) || !(max > 0)) continue;
      this.setPower(who, type, t, cur, max);
      const cost = Number(costs[j]);
      if (cast && cost > 0)
        this.setPower(who, type, t + 0.01, Math.max(0, cur - cost), max);
    }
  }

  /** A gain between readings (never past the last known maximum). */
  private gainPower(who: number, type: number, t: number, amount: number) {
    const list = this.powers.get(who)?.get(type);
    const last = list?.[list.length - 1];
    if (!last) return;
    const next = Math.min(last[2], Math.max(0, last[1] + amount));
    this.setPower(who, type, t, next, last[2]);
  }

  private alloc(cap: number) {
    return {
      t: new Float32Array(cap),
      k: new Uint8Array(cap),
      s: new Int32Array(cap),
      d: new Int32Array(cap),
      sp: new Int32Array(cap),
      a: new Float64Array(cap),
      b: new Float64Array(cap),
      x: new Float64Array(cap),
      f: new Uint8Array(cap),
      aux: new Int32Array(cap),
      hp: new Uint8Array(cap),
    };
  }

  private grow() {
    const next = this.alloc(this.cap * 2);
    (Object.keys(next) as (keyof typeof next)[]).forEach((key) => {
      (next[key] as Float64Array).set(this.cols[key] as Float64Array);
    });
    this.cols = next;
    this.cap *= 2;
  }

  private unit(guid: string, rawName: string, flags: number, t = 0) {
    if (!guid || guid === NO_GUID) return -1;
    // The game writes "Unknown" for a unit it hasn't named yet (a pet
    // summoned before the pull): a name seen later on any line wins.
    const unknown = rawName === 'Unknown' || rawName === 'nil';
    const name = unknown ? '' : rawName;
    if (unknown) this.unnamed.add(guid);
    let i = this.unitIndex.get(guid);
    if (i === undefined) {
      i = this.units.length;
      this.unitIndex.set(guid, i);
      const player = isPlayerGuid(guid);
      this.units.push({
        guid,
        name: player ? shortName(name) : name,
        player,
        friendly: isFriendlyFlags(flags),
        owner: -1,
        root: i,
        specId: 0,
        raider: false,
        // Creature-0-1631-3004-15747-259854-00000F39DE: field 5.
        npcId: player ? 0 : Number(guid.split('-')[5]) || 0,
        maxHp: 0,
        first: t,
      });
    } else if (name && !this.units[i].name) {
      // Made earlier without a name or flags (COMBATANT_INFO's buff list,
      // a support line): the first real sighting fills them in.
      const u = this.units[i];
      u.name = isPlayerGuid(guid) ? shortName(name) : name;
      if (flags) u.friendly = isFriendlyFlags(flags);
      u.first = t;
    }
    return i;
  }

  private spell(id: number, name: string, school: number) {
    if (id === -1) {
      let i = this.envIndex.get(name);
      if (i === undefined) {
        i = this.spells.length;
        this.envIndex.set(name, i);
        this.spells.push({ id: -1 - this.envIndex.size, name, school: 0 });
      }
      return i;
    }
    let i = this.spellIndex.get(id);
    if (i === undefined) {
      i = this.spells.length;
      this.spellIndex.set(id, i);
      this.spells.push({ id, name: RENAMED[id] ?? name, school });
    } else if (!this.spells[i].school && school) {
      // First seen without a school (e.g. as an absorbed attack).
      this.spells[i].school = school;
    }
    // First seen without a name (a buff from before the pull).
    if (!this.spells[i].name && name) this.spells[i].name = RENAMED[id] ?? name;
    return i;
  }

  public feed(line: string) {
    if (line.includes('  ENCOUNTER_START,')) {
      this.start = lineSeconds(line);
      if (!Number.isFinite(this.start)) this.start = 0;
      return;
    }
    if (this.start < 0) return;
    if (line.includes('  ENCOUNTER_END,')) {
      const end = lineSeconds(line);
      if (Number.isFinite(end)) this.end = end;
      const fields = line.slice(line.indexOf('  ') + 2).split(',');
      const ms = Number(fields[fields.length - 1]);
      if (ms > 0) this.fightSeconds = ms / 1000;
      return;
    }
    if (line.includes('  COMBATANT_INFO,')) {
      const head = line.slice(line.indexOf('  ') + 2, line.indexOf('['));
      const fields = head.split(',');
      this.specs.set(fields[1], Number(fields[25]) || 0);
      // Versatility rating (damage taken), the last of the three.
      this.vers.set(fields[1], Number(fields[23]) || 0);
      // The first [...] is the talents: (node, entry, rank), ...
      const open = line.indexOf('[');
      const close = line.indexOf(']', open);
      const list: [number, number, number][] = [];
      const re = /\((\d+),(\d+),(\d+)\)/g;
      const text = line.slice(open, close);
      let m = re.exec(text);
      while (m) {
        list.push([Number(m[1]), Number(m[2]), Number(m[3])]);
        m = re.exec(text);
      }
      this.talents.set(fields[1], list);
      try {
        this.gear.set(fields[1], parseGear(line, close));
      } catch {
        // An odd line: no gear for them.
      }
      // The last [...] is what they had on at the pull: caster, spell,
      // stacks, ... (flask, food, rune, vantus, raid buffs).
      const auraOpen = line.lastIndexOf('[');
      const auraClose = line.indexOf(']', auraOpen);
      if (auraOpen > close && auraClose > auraOpen) {
        const parts = line.slice(auraOpen + 1, auraClose).split(',');
        const who = this.unit(fields[1], '', 0);
        const list: [number, number][] = [];
        for (let k = 0; k + 1 < parts.length; k += 3) {
          const caster = parts[k].trim();
          const spellId = Number(parts[k + 1]);
          if (!caster.includes('-') || !(spellId > 0)) continue;
          list.push([this.unit(caster, '', 0), this.spell(spellId, '', 0)]);
        }
        if (who >= 0) this.prepull.set(who, list);
      }
      return;
    }
    if (line.includes('_SUPPORT,')) {
      this.support(line);
      return;
    }
    const e = parseLine(line, WANTED);
    if (!e) return;
    const at = lineSeconds(line);
    // A line we can't date: keep it at the last time we had.
    let t = Number.isFinite(at) ? at - this.start : this.lastT;
    if (t < -43200) t += 86400; // past midnight
    this.lastT = t;
    if (Number.isFinite(at)) this.end = Math.max(this.end, at);

    const src = this.unit(e.src, e.srcName, e.srcFlags, t);
    const dst = this.unit(e.dst, e.dstName, e.dstFlags, t);
    if (e.infoMaxHp > 0) {
      const who = e.info === e.src ? src : e.info === e.dst ? dst : -1;
      if (who >= 0 && e.infoMaxHp > this.units[who].maxHp)
        this.units[who].maxHp = e.infoMaxHp;
    }
    if (e.info !== NO_GUID && e.infoOwner !== NO_GUID) {
      const pet = this.unit(e.info, '', 0);
      const owner = this.unit(e.infoOwner, '', 0);
      if (pet >= 0 && owner >= 0 && !this.units[pet].player) {
        this.units[pet].owner = owner;
      }
    }

    if (
      e.type === 'SPELL_AURA_REFRESH' ||
      e.type === 'SPELL_AURA_APPLIED_DOSE' ||
      e.type === 'SPELL_AURA_REMOVED_DOSE'
    ) {
      const key = `${src}|${dst}|${this.spell(e.spellId, e.spellName, e.school)}`;
      const times =
        e.type === 'SPELL_AURA_REFRESH'
          ? this.refreshT
          : e.type === 'SPELL_AURA_APPLIED_DOSE'
            ? this.stackT
            : this.unstackT;
      const list = times.get(key) ?? [];
      list.push(t);
      times.set(key, list);
      if (e.type === 'SPELL_AURA_REFRESH') return;
    }

    let kind: number;
    let a = 0;
    let b = 0;
    let x = 0;
    let f = 0;
    let aux = 0;
    const type = e.type;
    if (DAMAGE.has(type)) {
      kind = K.DMG;
      a = e.amount;
      b = e.absorbed;
      x = e.base;
      aux = e.overkill;
      if (e.crit) f |= F.CRIT;
      if (type === 'SPELL_PERIODIC_DAMAGE') f |= F.TICK;
    } else if (MISSED.has(type)) {
      if (e.missType === 'ABSORB') {
        kind = K.DMG;
        b = e.absorbed;
        x = e.base;
        f |= F.SOAKED;
        if (type === 'SPELL_PERIODIC_MISSED') f |= F.TICK;
      } else {
        kind = K.MISS;
        aux = MISS_CODE[e.missType] ?? 0;
      }
    } else if (type === 'SPELL_HEAL' || type === 'SPELL_PERIODIC_HEAL') {
      kind = K.HEAL;
      a = Math.max(0, e.amount - e.overheal);
      x = e.overheal;
      b = e.absorbed;
      if (e.crit) f |= F.CRIT;
      if (type === 'SPELL_PERIODIC_HEAL') f |= F.TICK;
    } else if (type === 'SPELL_ABSORBED') {
      kind = K.ABSORB;
      a = e.amount;
      x = this.unit(e.attacker, '', 0);
      aux = this.spell(e.attackSpellId, e.attackSpellName, e.attackSchool);
    } else if (type === 'SPELL_HEAL_ABSORBED') {
      kind = K.HEALABSORB;
      a = e.amount;
      aux = this.spell(e.extraId, e.extraName, 0);
    } else if (type === 'SPELL_CAST_SUCCESS') {
      kind = K.CAST;
      if (this.notACast(src, e.spellId, e.spellName, t)) f |= F.PROC;
    } else if (type === 'SPELL_CAST_START') kind = K.BEGIN;
    else if (type === 'SPELL_AURA_APPLIED') {
      kind = K.APPLY;
      if (e.auraType === 'DEBUFF') f |= F.DEBUFF;
    } else if (type === 'SPELL_AURA_REMOVED') {
      kind = K.REMOVE;
      if (e.auraType === 'DEBUFF') f |= F.DEBUFF;
    } else if (type.endsWith('_DOSE')) {
      kind = K.DOSE;
      x = e.stacks;
      if (e.auraType === 'DEBUFF') f |= F.DEBUFF;
    } else if (type === 'UNIT_DIED') {
      // Feign Death and the like log a death with the last field 1.
      if (/,1\s*$/.test(line)) return;
      kind = K.DIED;
    } else if (type === 'SPELL_INTERRUPT') {
      kind = K.INTERRUPT;
      aux = this.spell(e.extraId, e.extraName, 0);
    } else if (type === 'SPELL_DISPEL' || type === 'SPELL_STOLEN') {
      kind = K.DISPEL;
      aux = this.spell(e.extraId, e.extraName, 0);
      if (e.auraType === 'DEBUFF') f |= F.DEBUFF;
    } else if (type.endsWith('_ENERGIZE')) {
      kind = K.ENERGIZE;
      a = e.amount;
      if (dst >= 0 && e.powerType >= 0)
        this.gainPower(dst, e.powerType, t, e.amount);
      x = e.over;
      aux = e.powerType;
    } else if (type === 'SPELL_SUMMON') {
      kind = K.SUMMON;
      if (dst >= 0 && src >= 0) {
        this.units[dst].owner = src;
        if (e.spellId > 0)
          this.units[dst].summon = { id: e.spellId, name: e.spellName };
      }
    } else if (type === 'SPELL_RESURRECT') kind = K.RES;
    else return;

    // Health of whoever the advanced block describes, when it's the
    // unit hit or healed.
    let hp = 255;
    if (e.infoMaxHp > 0 && (e.info === e.dst || e.info === e.src)) {
      hp = Math.max(
        0,
        Math.min(100, Math.round((e.infoHp / e.infoMaxHp) * 100)),
      );
    }
    // Raider power, once a second.
    if (e.infoMaxPower > 0 && isPlayerGuid(e.info)) {
      const who = this.unitIndex.get(e.info);
      if (who !== undefined)
        this.notePowers(
          who,
          t,
          e,
          e.type === 'SPELL_CAST_SUCCESS' && e.src === e.info,
        );
      if (who !== undefined) {
        const list = this.power.get(who) ?? [];
        const last = list[list.length - 1];
        if (!last || t - last[0] >= 1) {
          list.push([
            Math.round(t * 10) / 10,
            e.infoPower,
            e.infoMaxPower,
            e.infoPowerType,
          ]);
          this.power.set(who, list);
        }
      }
    }

    if (this.n >= this.cap) this.grow();
    const c = this.cols;
    const i = this.n;
    c.t[i] = t;
    c.k[i] = kind;
    c.s[i] = src;
    c.d[i] = dst;
    c.sp[i] =
      kind === K.DIED ? -1 : this.spell(e.spellId, e.spellName, e.school);
    c.a[i] = a;
    c.b[i] = b;
    c.x[i] = x;
    c.f[i] = f;
    c.aux[i] = aux;
    c.hp[i] = kind === K.DMG && e.info !== e.dst ? 255 : hp;
    this.n += 1;
  }

  /**
   * A *_DAMAGE_SUPPORT line: the hit just logged was added by another
   * raider's buff (Bombardments, Ebon Might, Prescience...), so it counts
   * as their damage, the way Warcraft Logs credits it. The supporter is the
   * line's last field.
   */
  private support(line: string) {
    const type = line.slice(line.indexOf('  ') + 2, line.indexOf(','));
    if (!type.includes('DAMAGE')) return;
    const e = parseLine(line.replace('_SUPPORT,', ','));
    if (!e) return;
    const supporter = line.slice(line.lastIndexOf(',') + 1).trim();
    if (!isPlayerGuid(supporter)) return;
    const src = this.unitIndex.get(e.src);
    const dst = this.unitIndex.get(e.dst);
    if (src === undefined || dst === undefined) return;
    const sp = e.spellId > 0 ? this.spellIndex.get(e.spellId) : undefined;
    const who = this.unit(supporter, '', 0);
    if (who < 0 || who === src) return;
    const c = this.cols;
    for (
      let i = this.n - 1, stop = Math.max(0, this.n - 64);
      i >= stop;
      i -= 1
    ) {
      if (
        c.k[i] === K.DMG &&
        c.s[i] === src &&
        c.d[i] === dst &&
        (sp === undefined || c.sp[i] === sp) &&
        Math.abs(c.a[i] + c.b[i] - (e.amount + e.absorbed)) < 1
      ) {
        c.s[i] = who;
        return;
      }
    }
  }

  private castFilter = new CastFilter();

  private notACast(src: number, spellId: number, name: string, t: number) {
    return this.castFilter.isProc(src, spellId, name, t);
  }

  public finish(meta: PullMeta): PullStore {
    const { units } = this;
    // Specs and who's in the raid.
    units.forEach((u) => {
      const spec = this.specs.get(u.guid);
      if (spec !== undefined) {
        u.specId = spec;
        u.raider = true;
        // In our raid (COMBATANT_INFO), whatever flags it was first seen with.
        u.friendly = true;
        u.talents = this.talents.get(u.guid);
        u.gear = this.gear.get(u.guid);
      }
    });
    if (!this.specs.size) {
      units.forEach((u) => {
        if (u.player && u.friendly) u.raider = true;
      });
    }
    // Pets of pets count for the raider at the top.
    units.forEach((u, i) => {
      let root = i;
      for (let hop = 0; hop < 4 && units[root].owner >= 0; hop += 1) {
        root = units[root].owner;
      }
      u.root = root;
      if (u.owner >= 0) u.friendly = units[root].friendly || u.friendly;
    });
    // Pets never named in this pull (summoned before it, only ever
    // "Unknown"): the name of the same creature of the same owner, else
    // what summoned it, as Warcraft Logs does (1.9.106).
    const named = new Map<string, string>();
    units.forEach((u) => {
      if (u.owner >= 0 && u.name && u.npcId)
        named.set(`${u.root}:${u.npcId}`, u.name);
    });
    units.forEach((u) => {
      if (u.name) return;
      if (u.owner >= 0)
        u.name =
          named.get(`${u.root}:${u.npcId}`) || u.summon?.name || 'Unknown';
      else if (this.unnamed.has(u.guid)) u.name = 'Unknown';
    });

    const n = this.n;
    const c = this.cols;
    const duration =
      this.fightSeconds > 0
        ? this.fightSeconds
        : Math.max(1, this.end - this.start);

    // The boss: the enemy the raid hit hardest.
    const hits = new Float64Array(units.length);
    for (let i = 0; i < n; i += 1) {
      if (c.k[i] !== K.DMG || c.d[i] < 0 || c.s[i] < 0) continue;
      const by = units[units[c.s[i]].root];
      if (by.raider && !units[c.d[i]].friendly) hits[c.d[i]] += c.a[i] + c.b[i];
    }
    let boss = -1;
    hits.forEach((v, i) => {
      if (boss < 0 || v > hits[boss]) boss = i;
    });

    // Aura spans: apply..remove per caster, target and spell.
    const auras: AuraSpan[] = [];
    const open = new Map<string, number>();
    const seen = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      const kind = c.k[i];
      if (kind !== K.APPLY && kind !== K.REMOVE) continue;
      const key = `${c.s[i]}|${c.d[i]}|${c.sp[i]}`;
      const debuff = (c.f[i] & F.DEBUFF) !== 0;
      if (kind === K.APPLY) {
        if (!open.has(key)) open.set(key, c.t[i]);
        seen.add(key);
      } else {
        const from = open.get(key);
        if (from !== undefined) {
          auras.push({
            spell: c.sp[i],
            src: c.s[i],
            dst: c.d[i],
            start: from,
            end: c.t[i],
            debuff,
          });
          open.delete(key);
        } else if (!seen.has(key)) {
          // Up since before the pull.
          auras.push({
            spell: c.sp[i],
            src: c.s[i],
            dst: c.d[i],
            start: 0,
            end: c.t[i],
            debuff,
          });
        }
        seen.add(key);
      }
    }
    // Buffs from before the pull that nothing in the log touched (flask,
    // food, rune, vantus): up the whole fight.
    this.prepull.forEach((list, dst) => {
      list.forEach(([src, sp]) => {
        const key = `${src}|${dst}|${sp}`;
        if (seen.has(key) || open.has(key)) return;
        seen.add(key);
        auras.push({
          spell: sp,
          src,
          dst,
          start: 0,
          end: duration,
          debuff: false,
        });
      });
    });
    // Debuff flag for still-open auras comes from their apply event.
    const openDebuff = new Map<string, boolean>();
    for (let i = 0; i < n; i += 1) {
      if (c.k[i] === K.APPLY)
        openDebuff.set(
          `${c.s[i]}|${c.d[i]}|${c.sp[i]}`,
          (c.f[i] & F.DEBUFF) !== 0,
        );
    }
    open.forEach((from, key) => {
      const [s, d, sp] = key.split('|').map(Number);
      auras.push({
        spell: sp,
        src: s,
        dst: d,
        start: from,
        end: duration,
        debuff: openDebuff.get(key) ?? false,
      });
    });

    // Uses, as Warcraft Logs counts them: each stack gained, and each
    // refresh that didn't come with a stack, while the aura was up.
    const keyOf = (a: AuraSpan) => `${a.src}|${a.dst}|${a.spell}`;
    auras.forEach((a) => {
      const stacks = (this.stackT.get(keyOf(a)) ?? []).filter(
        (t) => t > a.start && t <= a.end,
      );
      const stackSet = new Set([
        ...stacks,
        ...(this.unstackT.get(keyOf(a)) ?? []),
      ]);
      const refreshes = (this.refreshT.get(keyOf(a)) ?? []).filter(
        (t) => t >= a.start && t <= a.end && !stackSet.has(t),
      );
      const bumps = stacks.length + refreshes.length;
      if (bumps) a.bumps = bumps;
    });

    // Raider deaths, with the last hit before each.
    const deaths: Death[] = [];
    const lastHit = new Map<number, number>();
    for (let i = 0; i < n; i += 1) {
      const kind = c.k[i];
      if (kind === K.DMG && c.d[i] >= 0) lastHit.set(c.d[i], i);
      if (kind === K.DIED && c.d[i] >= 0 && units[c.d[i]].raider) {
        const hit = lastHit.get(c.d[i]);
        deaths.push({
          t: c.t[i],
          unit: c.d[i],
          spell: hit !== undefined && c.t[i] - c.t[hit] < 10 ? c.sp[hit] : -1,
          src: hit !== undefined && c.t[i] - c.t[hit] < 10 ? c.s[hit] : -1,
          amount: hit !== undefined ? c.a[hit] + c.b[hit] : 0,
        });
      }
    }

    const cut = <
      T extends Float64Array | Float32Array | Int32Array | Uint8Array,
    >(
      arr: T,
    ) => arr.slice(0, n) as T;
    return {
      ...meta,
      duration,
      units,
      spells: this.spells,
      n,
      t: cut(c.t),
      k: cut(c.k),
      s: cut(c.s),
      d: cut(c.d),
      sp: cut(c.sp),
      a: cut(c.a),
      b: cut(c.b),
      x: cut(c.x),
      f: cut(c.f),
      aux: cut(c.aux),
      hp: cut(c.hp),
      auras,
      power: this.power,
      powers: this.powers,
      vers: this.vers,
      deaths,
      boss,
    };
  }
}
