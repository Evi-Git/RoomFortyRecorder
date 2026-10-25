/**
 * [RoomFortyRecorder] Reads one retail combat log line into plain fields.
 * Shared by the app's pull meters (main process) and the Logs page, which
 * works through a pull's full log in the renderer.
 *
 * Line layout (12.x):
 *   time  EVENT,srcGUID,srcName,srcFlags,srcRaidFlags,
 *               dstGUID,dstName,dstFlags,dstRaidFlags,
 *               [spellId,spellName,school]           SPELL_*, RANGE_*
 *               [advanced block]                     damage, heal, energize,
 *                                                    casts, swings
 *               suffix
 *
 * The advanced block describes ONE unit: the source for casts and
 * SWING_DAMAGE, but the target for spell damage, heals and
 * SWING_DAMAGE_LANDED. Its owner field is that unit's owner, never the
 * source's unless the unit is the source. Its length has changed between
 * patches, so the suffix is found from the position fields (x, y, map,
 * facing, level).
 *
 * No Electron dependencies so it can be tested against real logs.
 */

export const NO_GUID = '0000000000000000';

export type LogEvent = {
  type: string;
  src: string;
  srcName: string;
  srcFlags: number;
  dst: string;
  dstName: string;
  dstFlags: number;
  spellId: number;
  spellName: string;
  school: number;
  /** The advanced block's unit and its owner (NO_GUID when none). */
  info: string;
  infoOwner: string;
  infoHp: number;
  infoMaxHp: number;
  /** Power: type, current and max, first one if several (pipe lists). */
  infoPowerType: number;
  infoPower: number;
  infoMaxPower: number;
  /** Every power the unit has, as the log's pipe lists ("0|8" and so on). */
  infoPowerTypes: string;
  infoPowers: string;
  infoMaxPowers: string;
  infoPowerCosts: string;
  /** Damage: what landed. Heal: the raw heal (overheal included). */
  amount: number;
  /** Damage before armour and reductions (0 when the log doesn't say). */
  base: number;
  overkill: number;
  absorbed: number;
  overheal: number;
  crit: boolean;
  /** MISSED events: MISS, DODGE, PARRY, ABSORB, IMMUNE... */
  missType: string;
  /** Interrupted / dispelled / stolen spell. */
  extraId: number;
  extraName: string;
  /** Aura events: BUFF or DEBUFF; stacks for doses. */
  auraType: string;
  stacks: number;
  /** Energize: power type and wasted amount. */
  powerType: number;
  over: number;
  /** SPELL_ABSORBED: the attacking unit and spell, and the absorber. */
  attacker: string;
  attackSpellId: number;
  attackSpellName: string;
  attackSchool: number;
};

const DECIMAL = /^-?\d+\.\d+$/;

/** All fields after the timestamp, honouring quotes. Not for [..] lines. */
export const splitFields = (body: string): string[] => {
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

const int = (value: string | undefined) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};
const num = (value: string | undefined) => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
};
const hex = (value: string | undefined) =>
  Number.parseInt(value ?? '0', 16) || 0;
const first = (value: string | undefined) => (value ?? '').split('|')[0];

/** Where the position fields (x, y) start in the advanced block. */
const positionIndex = (args: string[], from: number) => {
  for (let i = from + 4; i < args.length - 1; i += 1) {
    if (DECIMAL.test(args[i]) && DECIMAL.test(args[i + 1])) return i;
  }
  return -1;
};

const blank = (): LogEvent => ({
  type: '',
  src: NO_GUID,
  srcName: '',
  srcFlags: 0,
  dst: NO_GUID,
  dstName: '',
  dstFlags: 0,
  spellId: 0,
  spellName: '',
  school: 0,
  info: NO_GUID,
  infoOwner: NO_GUID,
  infoHp: 0,
  infoMaxHp: 0,
  infoPowerType: -1,
  infoPower: 0,
  infoMaxPower: 0,
  infoPowerTypes: '',
  infoPowers: '',
  infoMaxPowers: '',
  infoPowerCosts: '',
  amount: 0,
  base: 0,
  overkill: 0,
  absorbed: 0,
  overheal: 0,
  crit: false,
  missType: '',
  extraId: 0,
  extraName: '',
  auraType: '',
  stacks: 0,
  powerType: -1,
  over: 0,
  attacker: NO_GUID,
  attackSpellId: 0,
  attackSchool: 0,
  attackSpellName: '',
});

/** The event name of a raw line, cheaply ('' if none). */
export const eventName = (line: string) => {
  const start = line.indexOf('  ');
  if (start < 0) return '';
  const comma = line.indexOf(',', start + 2);
  return line.slice(start + 2, comma < 0 ? undefined : comma);
};

const HAS_ADVANCED = (type: string) =>
  type.endsWith('_DAMAGE') ||
  type.endsWith('_DAMAGE_LANDED') ||
  type.endsWith('_HEAL') ||
  type.endsWith('_ENERGIZE') ||
  type.endsWith('_DRAIN') ||
  type.endsWith('_LEECH') ||
  type === 'SPELL_CAST_SUCCESS' ||
  type === 'DAMAGE_SPLIT';

/**
 * One line's fields, or null for lines that aren't unit events
 * (ENCOUNTER_START, COMBATANT_INFO, ...). `types`, when given, skips
 * everything else before splitting the line.
 */
export const parseLine = (
  line: string,
  types?: Set<string>,
): LogEvent | null => {
  const start = line.indexOf('  ');
  if (start < 0) return null;
  const type = eventName(line);
  if (types && !types.has(type)) return null;
  if (
    type.startsWith('ENCOUNTER_') ||
    type === 'COMBATANT_INFO' ||
    type.startsWith('ZONE_') ||
    type.startsWith('MAP_') ||
    type.startsWith('CHALLENGE_') ||
    type.startsWith('COMBAT_LOG_') ||
    type.startsWith('WORLD_') ||
    type.endsWith('_SUPPORT')
  )
    return null;

  const args = splitFields(line.slice(start + 2));
  if (args.length < 9) return null;
  const e = blank();
  e.type = type;
  e.src = args[1];
  e.srcName = args[2] === 'nil' ? '' : args[2];
  e.srcFlags = hex(args[3]);
  e.dst = args[5];
  e.dstName = args[6] === 'nil' ? '' : args[6];
  e.dstFlags = hex(args[7]);

  const swing = type.startsWith('SWING_');
  const env = type.startsWith('ENVIRONMENTAL_');
  let at = 9;
  if (!swing && !env && type !== 'UNIT_DIED' && type !== 'UNIT_DESTROYED') {
    e.spellId = int(args[9]);
    e.spellName = args[10] ?? '';
    e.school = hex(args[11]);
    at = 12;
  }
  if (swing) {
    e.spellId = 1;
    e.spellName = 'Melee';
    e.school = 1;
  }

  if (HAS_ADVANCED(type) || env) {
    const pos = positionIndex(args, at);
    if (pos > 0) {
      e.info = args[at];
      e.infoOwner = args[at + 1];
      e.infoHp = int(args[at + 2]);
      e.infoMaxHp = int(args[at + 3]);
      e.infoPowerType = int(first(args[pos - 4]));
      e.infoPower = int(first(args[pos - 3]));
      e.infoMaxPower = int(first(args[pos - 2]));
      e.infoPowerTypes = args[pos - 4] ?? '';
      e.infoPowers = args[pos - 3] ?? '';
      e.infoMaxPowers = args[pos - 2] ?? '';
      e.infoPowerCosts = args[pos - 1] ?? '';
      at = pos + 5;
    }
  }

  if (env) {
    e.spellId = -1;
    e.spellName = args[at] || 'Environment';
    at += 1;
  }

  if (
    type.endsWith('_DAMAGE') ||
    type.endsWith('_DAMAGE_LANDED') ||
    type === 'DAMAGE_SPLIT'
  ) {
    e.amount = int(args[at]);
    e.base = int(args[at + 1]);
    e.overkill = Math.max(0, int(args[at + 2]));
    if (!swing) e.school = int(args[at + 3]) || e.school;
    e.absorbed = int(args[at + 6]);
    e.crit = args[at + 7] === '1';
  } else if (type.endsWith('_MISSED')) {
    e.missType = args[at] ?? '';
    e.amount = int(args[at + 2]);
    e.base = int(args[at + 3]);
    e.crit = args[at + 4] === '1';
    if (e.missType === 'ABSORB') {
      e.absorbed = e.amount;
      e.amount = 0;
    }
  } else if (type.endsWith('_HEAL')) {
    e.amount = int(args[at]);
    e.base = int(args[at + 1]);
    e.overheal = int(args[at + 2]);
    e.absorbed = int(args[at + 3]);
    e.crit = args[at + 4] === '1';
  } else if (type.endsWith('_ENERGIZE')) {
    e.amount = num(args[at]);
    e.over = num(args[at + 1]);
    e.powerType = int(args[at + 2]);
  } else if (type.startsWith('SPELL_AURA_')) {
    e.auraType = args[12] ?? '';
    e.stacks = int(args[13]);
  } else if (type === 'SPELL_HEAL_ABSORBED') {
    // healer(4) [healing spell id, name, school] amount absorbed, heal
    e.attacker = args[12] ?? NO_GUID;
    e.extraId = int(args[16]);
    e.extraName = args[17] ?? '';
    e.amount = int(args[19]);
  } else if (type === 'SPELL_INTERRUPT') {
    e.extraId = int(args[12]);
    e.extraName = args[13] ?? '';
  } else if (type === 'SPELL_DISPEL' || type === 'SPELL_STOLEN') {
    e.extraId = int(args[12]);
    e.extraName = args[13] ?? '';
    e.auraType = args[15] ?? '';
  } else if (type === 'SPELL_ABSORBED') {
    // attacker(4) target(4) [attack spell id, name, school] absorber(4)
    // absorb spell id, name, school, amount
    const withSpell =
      /^0x/i.test(args[11] ?? '') && /^\d+$/.test(args[9] ?? '');
    const a = withSpell ? 12 : 9;
    e.attacker = e.src;
    e.attackSpellId = withSpell ? int(args[9]) : 1;
    e.attackSpellName = withSpell ? (args[10] ?? '') : 'Melee';
    e.attackSchool = withSpell ? hex(args[11]) : 1;
    // The event's source becomes the absorber (who cast the shield).
    e.src = args[a];
    e.srcName = args[a + 1] === 'nil' ? '' : (args[a + 1] ?? '');
    e.srcFlags = hex(args[a + 2]);
    e.spellId = int(args[a + 4]);
    e.spellName = args[a + 5] ?? '';
    e.school = hex(args[a + 6]);
    e.amount = int(args[a + 7]);
  }
  return e;
};

/** Unit flags. */
export const isFriendlyFlags = (flags: number) => (flags & 0x10) !== 0;
export const isPlayerGuid = (guid: string | undefined) =>
  Boolean(guid && guid.startsWith('Player-'));
export const shortName = (name: string) => name.split('-')[0];
