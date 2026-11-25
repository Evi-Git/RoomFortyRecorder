import type { KeyboardEvent } from 'react';

/**
 * Keyboard access for things that are clicked but can't be a real <button>
 * (a table row, or an element with buttons inside it).
 */

/** Focus ring for a control that has room around it (matches the chevrons). */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60';

/** Focus ring drawn inside the box: for table rows and clipped containers. */
export const FOCUS_RING_INSET =
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand/60';

/**
 * True when this key press should activate the element: Enter or Space that
 * went to the element itself (a button inside it keeps its own keys). It also
 * stops Space from scrolling the page. Use it directly in an onKeyDown that
 * touches a ref (the React Compiler won't let a ref-reading handler be passed
 * through a function during render); otherwise use activateOnKey.
 */
export const isActivation = (event: KeyboardEvent<HTMLElement>): boolean => {
  if (event.target !== event.currentTarget) return false;
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  event.preventDefault();
  return true;
};

/** onKeyDown handler that runs `handler` when isActivation says so. */
export const activateOnKey =
  (handler: (event: KeyboardEvent<HTMLElement>) => void) =>
  (event: KeyboardEvent<HTMLElement>) => {
    if (isActivation(event)) handler(event);
  };

export type ClickableProps = {
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  role?: 'button';
  tabIndex?: 0;
  'aria-label'?: string;
};

/**
 * Spread onto an element that has a click handler so the keyboard can use it
 * too: role="button", tabIndex 0, Enter/Space. Pass `enabled: false` for a
 * row that only sometimes does anything. Add FOCUS_RING / FOCUS_RING_INSET to
 * the className yourself.
 */
export const clickableProps = (
  handler: ((event: React.SyntheticEvent<HTMLElement>) => void) | undefined,
  label?: string,
): ClickableProps =>
  handler
    ? {
        onClick: handler,
        onKeyDown: activateOnKey(handler),
        role: 'button',
        tabIndex: 0,
        ...(label ? { 'aria-label': label } : {}),
      }
    : {};

/**
 * Like clickableProps but keeps the element's own role: for a <tr> (it must
 * stay a row) or anything else that already has the right semantics. Only
 * adds tabIndex 0 and Enter/Space.
 */
export const focusableProps = (
  handler: ((event: React.SyntheticEvent<HTMLElement>) => void) | undefined,
): Pick<ClickableProps, 'onKeyDown' | 'tabIndex'> =>
  handler ? { onKeyDown: activateOnKey(handler), tabIndex: 0 } : {};
