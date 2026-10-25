import React from 'react';
import ReactDOM from 'react-dom';

/**
 * [RoomFortyRecorder] A hover card that stays inside the window: drawn
 * below its anchor, or above it when there isn't room below, and pushed in
 * from the edges. It measures itself before showing, so it works whatever
 * its height (a long tooltip near the bottom of the page used to run off
 * the window).
 */

/** Where to hang the card: the anchor's top and bottom, and a left edge. */
export type Anchor = { left: number; top: number; bottom: number };

const MARGIN = 8;
const GAP = 4;

export const anchorOf = (el: Element, left?: number): Anchor => {
  const r = el.getBoundingClientRect();
  return { left: left ?? r.left, top: r.top, bottom: r.bottom };
};

/** Top and left that keep a w x h box near the anchor and on screen. */
export const placeCard = (
  anchor: Anchor,
  w: number,
  h: number,
  view = { width: window.innerWidth, height: window.innerHeight },
) => {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - h;
  let top = below;
  if (below + h > view.height - MARGIN) {
    // Above when it fits there, else wherever shows the most of it.
    top = above >= MARGIN ? above : view.height - MARGIN - h;
  }
  top = Math.max(MARGIN, top);
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - MARGIN - w));
  return { top, left };
};

const FloatingCard = ({
  anchor,
  className,
  children,
}: {
  anchor: Anchor;
  className?: string;
  children: React.ReactNode;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(
    null,
  );
  // Measure after every render: the content can grow (a description that
  // arrives late), and the card must move with it. setPos only changes
  // when the place does, so this settles after one pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = placeCard(anchor, el.offsetWidth, el.offsetHeight);
    setPos((prev) =>
      prev && prev.top === next.top && prev.left === next.left ? prev : next,
    );
  });
  return ReactDOM.createPortal(
    <div
      ref={ref}
      className={`fixed pointer-events-none ${className ?? ''}`}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
        overflow: 'hidden',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default FloatingCard;
