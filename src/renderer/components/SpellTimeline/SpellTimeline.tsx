import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { SpellTimeline as SpellTimelineData, VideoMarker } from 'main/types';
import DeathIcon from '../../../../assets/icon/death.png';
import SpellIcon from './SpellIcon';
import SpellFilterMenu from './SpellFilterMenu';
import { buildRows, fmt, Item, Row, spellColor, store } from './timelineUtils';

/**
 * [RoomFortyRecorder] Review timeline under the video: it is the scrub bar
 * for raid recordings, with the pull's spells underneath.
 *
 * - Ruler with tick marks and times; deaths and phase bands sit on it.
 *   Click or drag on the ruler or any empty part of a row to scrub.
 * - Rows: boss casts (bars for cast times), adds, and your own casts, with
 *   spell icons. Click a spell to jump 1 s before it.
 * - Drag the top edge to resize; rows and icons grow with the panel.
 * - Ctrl + scroll (or the zoom buttons) zooms around the cursor; scroll
 *   pans. While playing, the view follows the playhead unless you've just
 *   scrolled.
 * - Collapsed, only the ruler shows, so it still works as a scrub bar.
 */

interface IProps {
  timeline: SpellTimelineData;
  duration: number;
  progress: number;
  deaths: VideoMarker[];
  bands: VideoMarker[];
  /** Jump straight to a time (clicking a spell or a death). */
  onSeek: (seconds: number) => void;
  /** Dragging the playhead: start, move (preview only), release (seek). */
  onScrubStart: () => void;
  onScrub: (seconds: number) => void;
  onScrubEnd: (seconds: number) => void;
}

const ipc = window.electron.ipcRenderer;

const HEADER = 28;
const RULER = 40;
const LABEL_WIDTH = 120;
const MIN_ROW = 24;
const MAX_ROW = 72;
const DEFAULT_HEIGHT = 210;
const MAX_ZOOM = 48;
// Bottom padding so the horizontal scrollbar doesn't cover the last row.
const SCROLLBAR = 10;

// Major tick spacing in seconds, and the minor ticks between them.
const TICK_STEPS: [number, number][] = [
  [1, 0.2],
  [2, 0.5],
  [5, 1],
  [10, 2],
  [15, 5],
  [30, 5],
  [60, 15],
  [120, 30],
  [300, 60],
  [600, 120],
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const SpellTimeline: React.FC<IProps> = ({
  timeline,
  duration,
  progress,
  deaths,
  bands,
  onSeek,
  onScrubStart,
  onScrub,
  onScrubEnd,
}) => {
  const [open, setOpen] = React.useState(
    store.get('rf-timeline-open') !== 'false',
  );
  const [height, setHeight] = React.useState(() => {
    const saved = Number(store.get('rf-timeline-height'));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_HEIGHT;
  });
  const [zoom, setZoom] = React.useState(1);
  const [hidden, setHidden] = React.useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(store.get('rf-timeline-hidden') || '{}');
    } catch {
      return {};
    }
  });
  const [hiddenSpells, setHiddenSpells] = React.useState<number[]>(() => {
    try {
      const parsed = JSON.parse(store.get('rf-timeline-hidden-spells') || '[]');
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  });
  const [icons, setIcons] = React.useState<Record<string, string>>({});
  const [viewWidth, setViewWidth] = React.useState(800);
  const [scrollLeft, setScrollLeft] = React.useState(0);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);

  const scroller = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const scrubbing = React.useRef(false);
  const lastManualScroll = React.useRef(0);
  const pendingScroll = React.useRef<number | null>(null);

  const rows = React.useMemo(() => buildRows(timeline), [timeline]);
  const total = Math.max(duration, 1);
  const contentWidth = viewWidth * zoom;
  const pxPerSec = contentWidth / total;

  React.useEffect(() => store.set('rf-timeline-open', String(open)), [open]);
  React.useEffect(
    () => store.set('rf-timeline-hidden', JSON.stringify(hidden)),
    [hidden],
  );
  React.useEffect(
    () => store.set('rf-timeline-hidden-spells', JSON.stringify(hiddenSpells)),
    [hiddenSpells],
  );

  // Icons for every spell in this pull (cached after the first lookup).
  React.useEffect(() => {
    let cancelled = false;
    const ids = Object.keys(timeline.spells).map(Number);
    ipc
      .invoke('spellIcons', [ids])
      .then((result) => {
        if (!cancelled && result) setIcons(result as Record<string, string>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [timeline]);

  // Track the visible width so ticks and zoom are in real pixels.
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    setViewWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // ---- Rows and sizes ---------------------------------------------------

  const hiddenSet = React.useMemo(() => new Set(hiddenSpells), [hiddenSpells]);
  const visibleRows = React.useMemo(
    () =>
      rows
        .filter((row) => !hidden[row.kind])
        .map((row) => ({
          ...row,
          items: row.items.filter((item) => !hiddenSet.has(item.spellId)),
        })),
    [rows, hidden, hiddenSet],
  );

  const rowCount = Math.max(1, visibleRows.length);
  const minHeight = HEADER + RULER + rowCount * MIN_ROW + SCROLLBAR;
  const maxHeight = Math.max(minHeight, Math.round(window.innerHeight * 0.7));
  const panelHeight = clamp(height, minHeight, maxHeight);
  const rowHeight = clamp(
    Math.floor((panelHeight - HEADER - RULER - SCROLLBAR) / rowCount),
    MIN_ROW,
    MAX_ROW,
  );
  const iconSize = clamp(rowHeight - 6, 16, 56);
  const bigLabels = rowHeight >= 40;

  // ---- Zoom and scroll ----------------------------------------------------

  const zoomTo = React.useCallback(
    (next: number, anchorX?: number) => {
      const el = scroller.current;
      const z = clamp(next, 1, MAX_ZOOM);
      if (!el || z === zoom) return;
      // Buttons zoom around the playhead so it stays where it is.
      const x =
        anchorX ??
        clamp(progress * pxPerSec - el.scrollLeft, 0, el.clientWidth);
      const time = (el.scrollLeft + x) / pxPerSec;
      const nextPx = (viewWidth * z) / total;
      pendingScroll.current = Math.max(0, time * nextPx - x);
      lastManualScroll.current = Date.now();
      setZoom(z);
    },
    [zoom, pxPerSec, viewWidth, total, progress],
  );

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pendingScroll.current !== null) {
      el.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
      setScrollLeft(el.scrollLeft);
    }
  }, [zoom]);

  // Wheel: Ctrl zooms around the cursor, otherwise pans. Native listener so
  // preventDefault works (React's wheel handler is passive).
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        zoomTo(
          zoom * (event.deltaY < 0 ? 1.25 : 0.8),
          event.clientX - rect.left,
        );
        return;
      }
      if (zoom > 1 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        el.scrollLeft += event.deltaY;
        lastManualScroll.current = Date.now();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo]);

  // Follow the playhead while zoomed, unless the user just scrolled.
  React.useEffect(() => {
    const el = scroller.current;
    if (!el || zoom === 1 || scrubbing.current) return;
    if (Date.now() - lastManualScroll.current < 2500) return;
    const x = progress * pxPerSec;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [progress, pxPerSec, zoom]);

  // ---- Scrubbing ------------------------------------------------------------

  const timeAt = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp((clientX - rect.left) / pxPerSec, 0, total);
  };

  const onScrubDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Spells and deaths handle their own clicks.
    if ((event.target as HTMLElement).closest('[data-no-scrub]')) return;
    event.preventDefault();
    scroller.current?.setPointerCapture(event.pointerId);
    scrubbing.current = true;
    setHoverTime(null);
    onScrubStart();
    onScrub(timeAt(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const time = timeAt(event.clientX);
    if (!scrubbing.current) {
      setHoverTime(time);
      return;
    }
    onScrub(time);

    // Drag past either edge to keep scrubbing while zoomed.
    const el = scroller.current;
    if (el && zoom > 1) {
      const rect = el.getBoundingClientRect();
      if (event.clientX > rect.right - 24) el.scrollLeft += 12;
      if (event.clientX < rect.left + 24) el.scrollLeft -= 12;
    }
  };

  const onScrubUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    scroller.current?.releasePointerCapture(event.pointerId);
    onScrubEnd(timeAt(event.clientX));
  };

  // ---- Resizing ---------------------------------------------------------------

  const onResizeDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;

    const move = (e: PointerEvent) =>
      setHeight(
        clamp(startHeight - (e.clientY - startY), minHeight, maxHeight),
      );
    const up = (e: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setHeight((h) => {
        store.set('rf-timeline-height', String(h));
        return h;
      });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  // ---- Ruler ------------------------------------------------------------------

  const [major, minor] =
    TICK_STEPS.find(([step]) => step * pxPerSec >= 80) ||
    TICK_STEPS[TICK_STEPS.length - 1];

  const ticks = React.useMemo(() => {
    const from = Math.max(0, (scrollLeft - 100) / pxPerSec);
    const to = Math.min(total, (scrollLeft + viewWidth + 100) / pxPerSec);
    const list: { t: number; major: boolean }[] = [];
    const first = Math.floor(from / minor) * minor;
    for (let t = first; t <= to + 1e-6; t += minor) {
      const rounded = Math.round(t * 100) / 100;
      const isMajor =
        Math.abs(rounded / major - Math.round(rounded / major)) < 1e-6;
      list.push({ t: rounded, major: isMajor });
    }
    return list;
  }, [scrollLeft, viewWidth, pxPerSec, total, major, minor]);

  const tickLabel = (t: number) => {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const secs =
      major < 1
        ? s.toFixed(1).padStart(4, '0')
        : String(Math.round(s)).padStart(2, '0');
    return `${m}:${secs}`;
  };

  // ---- Spell items (memoized: they don't move with the playhead) ---------------

  const renderItem = (row: Row, item: Item, index: number) => {
    const left = item.start * pxPerSec;
    const title = `${item.name} — ${fmt(item.start)}${
      item.end !== undefined ? `–${fmt(item.end)}` : ''
    }${item.interrupted ? ' (interrupted)' : ''}`;
    const color = spellColor(item.spellId);
    const icon = icons[item.spellId];
    const seek = () => onSeek(Math.max(0, item.start - 1));

    if (item.end !== undefined) {
      const width = Math.max((item.end - item.start) * pxPerSec, iconSize);
      return (
        <button
          type="button"
          data-no-scrub
          key={`${row.key}-${index}`}
          title={title}
          onClick={seek}
          className="absolute top-1/2 -translate-y-1/2 rounded-[4px] flex items-center gap-x-1.5 overflow-hidden whitespace-nowrap font-semibold text-foreground-lighter hover:brightness-125 hover:z-10"
          style={{
            left,
            width,
            height: iconSize,
            fontSize: bigLabels ? 12 : 10,
            background: `color-mix(in srgb, ${color} 35%, transparent)`,
            boxShadow: `inset 0 0 0 1px ${color}`,
          }}
        >
          <SpellIcon
            spellId={item.spellId}
            name={item.name}
            icon={icon}
            size={iconSize}
          />
          {width > iconSize + 40 && (
            <span className="pr-1.5 truncate">{item.name}</span>
          )}
        </button>
      );
    }

    return (
      <button
        type="button"
        data-no-scrub
        key={`${row.key}-${index}`}
        title={title}
        onClick={seek}
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 hover:z-10 hover:scale-110 transition-transform"
        style={{ left }}
      >
        <SpellIcon
          spellId={item.spellId}
          name={item.name}
          icon={icon}
          size={iconSize}
          className={
            item.interrupted
              ? 'opacity-50 grayscale outline outline-1 outline-dashed outline-foreground/60'
              : 'ring-1 ring-black/60'
          }
        />
      </button>
    );
  };

  const rowsLayer = React.useMemo(
    () =>
      visibleRows.map((row) => (
        <div
          key={row.key}
          className="relative border-b border-card/60"
          style={{ height: rowHeight }}
        >
          {row.items.map((item, i) => renderItem(row, item, i))}
        </div>
      )),
    // renderItem only reads values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRows, rowHeight, iconSize, pxPerSec, icons, bigLabels, onSeek],
  );

  // ---- Render -------------------------------------------------------------------

  const chip = (kind: Row['kind'], label: string) => {
    if (!rows.some((r) => r.kind === kind)) return null;
    const off = Boolean(hidden[kind]);
    return (
      <button
        type="button"
        onClick={() => setHidden((h) => ({ ...h, [kind]: !off }))}
        className={`px-2 rounded text-[11px] border ${
          off
            ? 'border-card text-foreground/40'
            : 'border-foreground/30 text-foreground'
        }`}
      >
        {label}
      </button>
    );
  };

  const playheadX = progress * pxPerSec;
  const showRows = open && visibleRows.length > 0;

  return (
    <div
      className="relative w-full shrink-0 flex flex-col bg-background-dark-gradient-to border-t border-card text-foreground select-none"
      style={{ height: open ? panelHeight : HEADER + RULER + SCROLLBAR }}
    >
      {open && (
        <div
          onPointerDown={onResizeDown}
          title="Drag to resize"
          className="absolute -top-1.5 left-0 right-0 h-3 z-20 cursor-row-resize flex justify-center group"
        >
          <GripHorizontal
            size={14}
            className="text-foreground/30 group-hover:text-brand -mt-0.5"
          />
        </div>
      )}

      <div
        className="flex items-center gap-x-2 px-2 text-xs shrink-0"
        style={{ height: HEADER }}
      >
        <button
          type="button"
          className="flex items-center gap-x-1 font-semibold"
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Hide the spell rows' : 'Show the spell rows'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          Timeline
        </button>
        {open && (
          <>
            <span className="text-foreground/40">|</span>
            {chip('boss', 'Boss')}
            {chip('enemy', 'Adds')}
            {chip('player', 'You')}
            <SpellFilterMenu
              rows={rows}
              icons={icons}
              hiddenSpells={hiddenSpells}
              setHiddenSpells={setHiddenSpells}
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-x-1.5">
          <span className="text-foreground/40 mr-1 hidden md:inline">
            Ctrl + scroll to zoom
          </span>
          <button
            type="button"
            title="Zoom out"
            disabled={zoom <= 1}
            onClick={() => zoomTo(zoom / 1.5)}
            className="disabled:opacity-30"
          >
            <ZoomOut size={14} />
          </button>
          <span className="w-9 text-center text-foreground/60">
            {zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}x
          </span>
          <button
            type="button"
            title="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomTo(zoom * 1.5)}
            className="disabled:opacity-30"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            title="Fit the whole pull"
            disabled={zoom === 1}
            onClick={() => zoomTo(1)}
            className="disabled:opacity-30"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div
          style={{ width: LABEL_WIDTH }}
          className="shrink-0 border-r border-card/60"
        >
          <div
            style={{ height: RULER }}
            className="px-2 flex items-end pb-1 text-[10px] text-foreground/40 border-b border-card"
          >
            {fmt(progress)}
          </div>
          {showRows &&
            visibleRows.map((row) => (
              <div
                key={row.key}
                style={{
                  height: rowHeight,
                  lineHeight: `${rowHeight}px`,
                  fontSize: bigLabels ? 13 : 11,
                }}
                className="px-2 truncate text-foreground/70 border-b border-card/60"
                title={row.label}
              >
                {row.label}
              </div>
            ))}
        </div>

        <div
          ref={scroller}
          className="flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          onPointerDown={onScrubDown}
          onPointerMove={onPointerMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onPointerLeave={() => setHoverTime(null)}
        >
          <div
            ref={content}
            className="relative cursor-text"
            style={{ width: contentWidth, minHeight: '100%' }}
          >
            {/* Ruler */}
            <div
              className="relative border-b border-card bg-background/40"
              style={{ height: RULER }}
            >
              {ticks.map(({ t, major: isMajor }) => (
                <div
                  key={t}
                  className="absolute bottom-0"
                  style={{ left: t * pxPerSec }}
                >
                  <div
                    className={
                      isMajor
                        ? 'w-px bg-foreground/50'
                        : 'w-px bg-foreground/25'
                    }
                    style={{ height: isMajor ? 12 : 6 }}
                  />
                  {isMajor && (
                    <span className="absolute bottom-[24px] left-1 text-[10px] text-foreground/60 whitespace-nowrap">
                      {tickLabel(t)}
                    </span>
                  )}
                </div>
              ))}

              {bands.map((band) => (
                <div
                  key={`band-${band.time}`}
                  title={band.text}
                  className="absolute bottom-0 h-[3px] opacity-80"
                  style={{
                    left: band.time * pxPerSec,
                    width: Math.max(2, band.duration * pxPerSec),
                    background: band.color,
                  }}
                />
              ))}

              {deaths.map((death) => (
                <button
                  type="button"
                  data-no-scrub
                  key={`death-${death.time}-${death.text}`}
                  title={death.text}
                  onClick={() => onSeek(Math.max(0, death.time - 2))}
                  className="absolute bottom-1 -translate-x-1/2 z-[5] hover:scale-125 transition-transform"
                  style={{ left: death.time * pxPerSec }}
                >
                  <img
                    src={DeathIcon}
                    alt=""
                    className="w-3.5 h-3.5"
                    draggable={false}
                  />
                </button>
              ))}
            </div>

            {showRows && rowsLayer}

            {/* Death lines through the rows */}
            {showRows &&
              deaths.map((death) => (
                <div
                  key={`death-line-${death.time}-${death.text}`}
                  className="absolute w-px bg-red-500/30 pointer-events-none"
                  style={{ left: death.time * pxPerSec, top: RULER, bottom: 0 }}
                />
              ))}

            {/* Hover position */}
            {hoverTime !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-foreground/30 pointer-events-none"
                style={{ left: hoverTime * pxPerSec }}
              >
                <span className="absolute top-0 left-1 text-[10px] text-foreground/70 bg-background/80 px-1 rounded-sm whitespace-nowrap">
                  {fmt(hoverTime)}
                </span>
              </div>
            )}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-[2px] -ml-px bg-brand pointer-events-none z-10"
              style={{ left: playheadX }}
            >
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 w-3.5 h-2.5 bg-brand"
                style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpellTimeline;
