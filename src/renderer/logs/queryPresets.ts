import { DAMAGE_REDUCTION } from '../../parsing/PullMeters';

/** [RoomFortyRecorder] Ready-made Queries on the Logs page. */

const LUST_IDS = [2825, 32182, 80353, 264667, 390386, 466904, 444257];
const DEFENSIVES = [
  ...new Set(
    Object.entries(DAMAGE_REDUCTION).flatMap(([id, dr]) =>
      dr.castId ? [Number(id), dr.castId] : [Number(id)],
    ),
  ),
];

export const PRESETS: { name: string; expr: string }[] = [
  { name: 'Deaths', expr: 'type = death and target.raider = true' },
  {
    name: 'Big hits on raiders (over 1m)',
    expr: 'type = damage and target.type = player and not source.type = player and amount > 1m',
  },
  {
    name: 'Raiders below 20% health',
    expr: 'type = damage and target.type = player and target.hp >= 0 and target.hp < 20',
  },
  { name: 'Interrupts', expr: 'type = interrupt' },
  { name: 'Dispels', expr: 'type = dispel' },
  {
    name: 'Damage-reduction cooldowns pressed',
    expr: `type = cast and ability.id in (${DEFENSIVES.join(', ')})`,
  },
  {
    name: 'Potions and healthstones',
    expr: 'type = cast and (ability.name ~ "potion" or ability.name ~ "healthstone")',
  },
  {
    name: 'Bloodlust',
    expr: `type = applybuff and ability.id in (${LUST_IDS.join(', ')})`,
  },
  {
    name: 'Boss casts',
    expr: 'type in (cast, begincast) and source.type = npc',
  },
];
