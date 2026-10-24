import {
  isFriendlyFlags,
  isPlayerGuid,
  NO_GUID,
  parseLine,
  shortName,
} from '../../parsing/LogEvents';

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
];

/** Flags. */
export const F = {
  CRIT: 1,
  TICK: 2,
  DEBUFF: 4,
  SOAKED: 8, // a hit a shield took completely
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
};

export type Spell = { id: number; name: string; school: number };

export type AuraSpan = {
  spell: number;
  src: number;
  dst: number;
  start: number;
  end: number;
  debuff: boolean;
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
  'SPELL_CAST_SUCCESS',
  'SPELL_CAST_START',
  'SPELL_AURA_APPLIED',
  'SPELL_AURA_REMOVED',
  'SPELL_AURA_APPLIED_DOSE',
  'SPELL_AURA_REMOVED_DOSE',
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
export class StoreBuilder {
  private start = -1;

  private end = 0;

  private units: Unit[] = [];

  private unitIndex = new Map<string, number>();

  private spells: Spell[] = [];

  private spellIndex = new Map<number, number>();

  private envIndex = new Map<string, number>();

  private n = 0;

  private cap = 65536;

  private cols = this.alloc(65536);

  private specs = new Map<string, number>();

  private power = new Map<number, [number, number, number, number][]>();

  private fightSeconds = 0;

  private lastT = 0;

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

  private unit(guid: string, name: string, flags: number, t = 0) {
    if (!guid || guid === NO_GUID) return -1;
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
      this.units[i].name = isPlayerGuid(guid) ? shortName(name) : name;
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
      this.spells.push({ id, name, school });
    }
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
      aux = this.spell(e.attackSpellId, e.attackSpellName, 0);
    } else if (type === 'SPELL_CAST_SUCCESS') kind = K.CAST;
    else if (type === 'SPELL_CAST_START') kind = K.BEGIN;
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
    } else if (type === 'UNIT_DIED') kind = K.DIED;
    else if (type === 'SPELL_INTERRUPT') {
      kind = K.INTERRUPT;
      aux = this.spell(e.extraId, e.extraName, 0);
    } else if (type === 'SPELL_DISPEL' || type === 'SPELL_STOLEN') {
      kind = K.DISPEL;
      aux = this.spell(e.extraId, e.extraName, 0);
      if (e.auraType === 'DEBUFF') f |= F.DEBUFF;
    } else if (type.endsWith('_ENERGIZE')) {
      kind = K.ENERGIZE;
      a = e.amount;
      x = e.over;
      aux = e.powerType;
    } else if (type === 'SPELL_SUMMON') {
      kind = K.SUMMON;
      if (dst >= 0 && src >= 0) this.units[dst].owner = src;
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

  public finish(meta: PullMeta): PullStore {
    const { units } = this;
    // Specs and who's in the raid.
    units.forEach((u) => {
      const spec = this.specs.get(u.guid);
      if (spec !== undefined) {
        u.specId = spec;
        u.raider = true;
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
      deaths,
      boss,
    };
  }
}
