import { DAMAGE_REDUCTION } from '../../parsing/PullMeters';
import type { AuraCategory, AuraRow } from './query';

/**
 * [RoomFortyRecorder] Logs page Buffs/Debuffs sections, named like Warcraft
 * Logs'. Cooldowns and raid buffs come from how the buff behaved in the log
 * (pressed now and then, on many raiders at once, up all fight); the rest
 * from its name and its description (Wowhead, through the guild server).
 */

export type AuraSection =
  | 'groupCd'
  | 'personalCd'
  | 'damage'
  | 'defensive'
  | 'healing'
  | 'movement'
  | 'raidbuff'
  | 'stance'
  | 'toy'
  | 'mechanic'
  | 'yours'
  | 'other';

export const SECTION_TITLES: Record<AuraSection, string> = {
  groupCd: 'Major Group Cooldowns',
  personalCd: 'Major Individual Cooldowns',
  damage: 'Damage Buffs',
  defensive: 'Defensive Buffs',
  healing: 'Healing Buffs',
  movement: 'Movement Buffs',
  raidbuff: 'Raid Buffs',
  stance: 'Stances, Forms and Seals',
  toy: 'Toy Buffs',
  mechanic: 'From enemies',
  yours: "The raid's debuffs",
  other: 'Uncategorized',
};

export const SECTION_ORDER: AuraSection[] = [
  'groupCd',
  'personalCd',
  'damage',
  'defensive',
  'healing',
  'movement',
  'raidbuff',
  'stance',
  'toy',
  'mechanic',
  'yours',
  'other',
];

const STANCE =
  /\b(form|stance|seal|presence|shapeshift)\b|^(devotion|concentration|crusader|retribution) aura$|^(battle|defensive|berserker) stance$/i;
const TOY =
  /\b(toy|costume|disguise|transform(ed)? into|illusion|cosmetic)\b|^(wormhole|holiday)/i;
const MOVEMENT =
  /movement speed|\bmove(ment)? \d+% faster|run speed|speed increased|increas\w* (your )?speed|\bsprint|\bslow fall|\bleap|\bglide/i;
const DEFENSIVE =
  /damage taken|absorb|reduc\w* (all )?(the )?(physical |magic |magical )?damage|\bdodge|\bparry|\barmor\b|maximum health|stamina|cannot die|prevent\w* (the next|a) (fatal|killing)|\bimmune|\bavoidance/i;
const DAMAGE =
  /damage (done|dealt)|deal \d+% (more|increased)|increas\w* (your |all )?(damage|haste|critical|mastery|versatility|primary stat|intellect|agility|strength|attack power|spell power|attack speed)|\bhaste\b|critical strike|\bmastery\b|\bversatility\b|primary stat/i;
const HEALING =
  /healing (done|dealt|received|taken|you do)|heal(s|ing)? (you|the target|nearby|allies|an ally|for)|restor\w* \d|increas\w* (your )?healing|\bmana\b/i;

/** The section a buff or debuff goes in. */
export const sectionOf = (row: AuraRow, text: string): AuraSection => {
  const c: AuraCategory = row.category;
  if (c === 'mechanic' || c === 'yours') return c;
  if (c === 'raid') return 'groupCd';
  if (c === 'personal' || c === 'external') return 'personalCd';
  if (STANCE.test(row.name)) return 'stance';
  if (c === 'raidbuff') return 'raidbuff';
  if (DAMAGE_REDUCTION[row.spellId]) return 'defensive';
  const t = text || '';
  if (TOY.test(row.name) || /\btoy\b/i.test(t)) return 'toy';
  if (!t) return 'other';
  if (DEFENSIVE.test(t)) return 'defensive';
  if (DAMAGE.test(t)) return 'damage';
  if (HEALING.test(t)) return 'healing';
  if (MOVEMENT.test(t)) return 'movement';
  return 'other';
};
