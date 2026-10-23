import { getSpecClass, getWoWClassColor } from '../rendererutils';

/** [RoomFortyRecorder] Logs page: number and time formatting, colours. */

export const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

export const thousands = (n: number) =>
  Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

export const mmss = (s: number) => {
  const sec = Math.max(0, s);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(
    Math.floor(sec % 60),
  ).padStart(2, '0')}`;
};

export const mmssms = (s: number) => {
  const sec = Math.max(0, s);
  return `${mmss(sec)}.${String(Math.floor((sec % 1) * 1000)).padStart(3, '0')}`;
};

export const pct = (part: number, whole: number, digits = 2) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '–';

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
