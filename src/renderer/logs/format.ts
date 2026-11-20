import { specializationById } from 'main/constants';
import { getSpecClass, getWoWClassColor } from '../rendererutils';

/**
 * [RoomFortyRecorder] Logs page: spec labels and colours. Numbers and times
 * are formatted by `renderer/format.ts` (dates and times of day: `clock.ts`).
 */

/** "Fire Mage" for a spec id; empty when unknown (enemies, pets). */
export const specLabel = (specId: number) => {
  const spec = specializationById[specId];
  return spec ? `${spec.name} ${spec.label}` : '';
};

export const classColor = (specId: number) =>
  getWoWClassColor(getSpecClass(specId)) || 'hsl(var(--foreground-lighter))';

/** Enemies (no class): a muted red. */
export const ENEMY_COLOR = 'hsl(0 60% 62%)';

/**
 * Abilities in a stacked chart: the validated categorical palette (dark
 * steps), in fixed order; past eight they fold into "Other".
 */
export const CATEGORICAL = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
export const OTHER_COLOR = '#6b645c';
