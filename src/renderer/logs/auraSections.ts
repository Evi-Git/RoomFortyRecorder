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

/** The section a buff or debuff goes in, and why (for checking). */
export const explainSection = (
  row: AuraRow,
  text: string,
): { section: AuraSection; why: string } => {
  const c: AuraCategory = row.category;
  const hit = (re: RegExp, value: string) => value.match(re)?.[0] ?? '';
  if (c === 'mechanic' || c === 'yours')
    return { section: c, why: `log: category ${c}` };
  if (c === 'raid') return { section: 'groupCd', why: 'log: raid cooldown' };
  if (c === 'personal' || c === 'external')
    return { section: 'personalCd', why: `log: ${c} cooldown` };
  if (STANCE.test(row.name))
    return { section: 'stance', why: `name: "${hit(STANCE, row.name)}"` };
  if (c === 'raidbuff')
    return { section: 'raidbuff', why: 'log: on most of the raid all fight' };
  if (DAMAGE_REDUCTION[row.spellId])
    return { section: 'defensive', why: 'in the DAMAGE_REDUCTION table' };
  const t = text || '';
  if (TOY.test(row.name))
    return { section: 'toy', why: `name: "${hit(TOY, row.name)}"` };
  if (/\btoy\b/i.test(t)) return { section: 'toy', why: 'text: "toy"' };
  if (!t) return { section: 'other', why: 'no description yet' };
  const checks: [AuraSection, RegExp][] = [
    ['defensive', DEFENSIVE],
    ['damage', DAMAGE],
    ['healing', HEALING],
    ['movement', MOVEMENT],
  ];
  const found = checks.find(([, re]) => re.test(t));
  if (found) return { section: found[0], why: `text: "${hit(found[1], t)}"` };
  return { section: 'other', why: 'text matched nothing' };
};

/** The section a buff or debuff goes in. */
export const sectionOf = (row: AuraRow, text: string): AuraSection =>
  explainSection(row, text).section;
