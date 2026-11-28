import React from 'react';
import { focusFromPointer } from './a11y';

/**
 * One tab stop for a group of many small controls (talent nodes, aura bars):
 * Tab enters the group on the current item, the arrow keys move between the
 * items, Home/End jump, and Tab leaves. The same idea as the tab strip and
 * the recordings table. After a mouse click the keys keep their usual
 * meaning (arrows seek the video), as in `a11y.ts`.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Dir = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

const DIRS: Dir[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
export const isDir = (key: string): key is Dir =>
  (DIRS as string[]).includes(key);

/**
 * The item to move to from item `from` for an arrow key, by where the boxes
 * are on screen: the nearest centre in that direction, a sideways offset
 * counting three times. null at an edge (nothing that way).
 */
export const nextByArrow = (
  boxes: Box[],
  from: number,
  key: Dir,
): number | null => {
  const a = boxes[from];
  if (!a) return null;
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  let best: number | null = null;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const dx = b.x + b.w / 2 - cx;
    const dy = b.y + b.h / 2 - cy;
    const along = (horizontal ? dx : dy) * sign;
    const across = Math.abs(horizontal ? dy : dx);
    // Not in that direction (a few pixels of slack for items in a line).
    if (along < 2) return;
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
};

/** The current item: the remembered one if it is still there, else the first. */
export const currentKey = (
  keys: readonly string[],
  remembered: string | null,
): string | null =>
  remembered !== null && keys.includes(remembered)
    ? remembered
    : (keys[0] ?? null);

const KEY_ATTR = 'data-roving-key';

/**
 * `keys`: every item of the group, in order. Spread `groupProps` on the
 * element that holds the items; give each item `itemProps(key)`.
 */
export const useRoving = (keys: readonly string[]) => {
  const [remembered, setRemembered] = React.useState<string | null>(null);
  const current = currentKey(keys, remembered);
  const itemProps = (key: string) =>
    ({
      [KEY_ATTR]: key,
      tabIndex: key === current ? 0 : -1,
    }) as { 'data-roving-key': string; tabIndex: 0 | -1 };
  const groupProps = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const key = (e.target as HTMLElement).getAttribute(KEY_ATTR);
      if (key !== null) setRemembered(key);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      // Only the item itself (not a button inside it), reached by Tab.
      if (target.getAttribute(KEY_ATTR) === null) return;
      if (focusFromPointer()) return;
      const items = [
        ...e.currentTarget.querySelectorAll<HTMLElement>(`[${KEY_ATTR}]`),
      ];
      const from = items.indexOf(target);
      if (from < 0) return;
      let to: number | null = null;
      if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = items.length - 1;
      else if (isDir(e.key)) {
        to = nextByArrow(
          items.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height };
          }),
          from,
          e.key,
        );
      } else return;
      // Not also a seek in the video behind.
      e.preventDefault();
      e.stopPropagation();
      if (to !== null && to !== from) items[to].focus();
    },
  };
  return { groupProps, itemProps };
};
