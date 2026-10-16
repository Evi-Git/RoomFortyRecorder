import React from 'react';
import { ChevronDown, ChevronUp, ZoomIn, ZoomOut } from 'lucide-react';
import { SpellTimeline as SpellTimelineData } from 'main/types';

/**
 * [RoomFortyRecorder] Spell timeline under the video player: boss casts,
 * other enemies' casts and your own casts for a raid pull.
 *
 * - Boss casts with a cast time show as a bar from cast start to finish.
 * - Click any marker to jump the video there (1 second before).
 * - Zoom in to separate dense rows; the view follows the playhead.
 */

type Row = {
  key: string;
  label: string;
  kind: 'boss' | 'enemy' | 'player';
  items: Item[];
};

type Item = {
  start: number; // seconds
  end?: number; // seconds, for cast bars
  spellId: number;
  name: string;
  interrupted?: boolean;
};

interface IProps {
  timeline: SpellTimelineData;
  duration: number;
  progress: number;
  onSeek: (seconds: number) => void;
}

const ZOOMS = [1, 2, 4, 8, 16];
const ROW_HEIGHT = 22;
const LABEL_WIDTH = 96;

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; settings just won't persist.
    }
  },
};

const spellColor = (spellId: number) => {
  const hue = (spellId * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 65% 55%)`;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const fmt = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** Pair cast starts with their success into bars; leftovers are markers. */
const buildRows = (timeline: SpellTimelineData): Row[] => {
  const perSource = new Map<number, Item[]>();

  timeline.sources.forEach((_, index) => perSource.set(index, []));
  const pending = new Map<string, number[]>(); // source:spell -> start times

  timeline.casts.forEach(([tenths, spellId, sourceIndex, kind]) => {
    const t = tenths / 10;
    const name = timeline.spells[String(spellId)] || String(spellId);
    const items = perSource.get(sourceIndex);
    if (!items) return;
    const pairKey = `${sourceIndex}:${spellId}`;

    if (kind === 0) {
      const list = pending.get(pairKey) || [];
      list.push(t);
      pending.set(pairKey, list);
      return;
    }

    const starts = pending.get(pairKey);
    const start = starts?.shift();

    if (start !== undefined && t - start <= 15) {
      items.push({ start, end: t, spellId, name });
    } else {
      items.push({ start: t, spellId, name });
    }
  });

  // Starts that never finished: interrupted or cancelled casts.
  pending.forEach((starts, pairKey) => {
    const [sourceIndex, spellId] = pairKey.split(':').map(Number);
    const name = timeline.spells[String(spellId)] || String(spellId);
    starts.forEach((start) =>
      perSource
        .get(sourceIndex)
        ?.push({ start, spellId, name, interrupted: true }),
    );
  });

  const rows: Row[] = [];
  const bossItems: Item[] = [];
  const enemyItems: Item[] = [];
  let bossLabel = 'Boss';

  timeline.sources.forEach((source, index) => {
    const items = perSource.get(index) || [];

    if (source.kind === 'boss') {
      bossItems.push(...items);
      bossLabel = source.name;
    } else if (source.kind === 'enemy') {
      enemyItems.push(...items);
    } else {
      rows.push({
        key: 'player',
        label: source.name || 'You',
        kind: 'player',
        items,
      });
    }
  });

  const sortByTime = (a: Item, b: Item) => a.start - b.start;
  const result: Row[] = [];
  if (bossItems.length)
    result.push({
      key: 'boss',
      label: bossLabel,
      kind: 'boss',
      items: bossItems.sort(sortByTime),
    });
  if (enemyItems.length)
    result.push({
      key: 'enemy',
      label: 'Adds',
      kind: 'enemy',
      items: enemyItems.sort(sortByTime),
    });
  return [
    ...result,
    ...rows.map((r) => ({ ...r, items: r.items.sort(sortByTime) })),
  ];
};

const SpellTimeline: React.FC<IProps> = ({
  timeline,
  duration,
  progress,
  onSeek,
}) => {
  const [open, setOpen] = React.useState(
    store.get('rf-timeline-open') !== 'false',
  );
  const [zoomIndex, setZoomIndex] = React.useState(0);
  const [hidden, setHidden] = React.useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(store.get('rf-timeline-hidden') || '{}');
    } catch {
      return {};
    }
  });

  const scroller = React.useRef<HTMLDivElement>(null);
  const rows = React.useMemo(() => buildRows(timeline), [timeline]);
  const zoom = ZOOMS[zoomIndex];
  const total = Math.max(duration, 1);

  React.useEffect(() => store.set('rf-timeline-open', String(open)), [open]);
  React.useEffect(
    () => store.set('rf-timeline-hidden', JSON.stringify(hidden)),
    [hidden],
  );

  // When zoomed in, keep the playhead in view.
  React.useEffect(() => {
    const el = scroller.current;
    if (!el || zoom === 1) return;
    const x = (progress / total) * el.scrollWidth;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [progress, total, zoom]);

  const visibleRows = rows.filter((row) => !hidden[row.kind]);

  const renderItem = (row: Row, item: Item, index: number) => {
    const left = (item.start / total) * 100;
    const title = `${item.name} — ${fmt(item.start)}${
      item.end !== undefined ? `–${fmt(item.end)}` : ''
    }${item.interrupted ? ' (interrupted)' : ''}`;
    const color = spellColor(item.spellId);
    const seek = () => onSeek(Math.max(0, item.start - 1));

    if (item.end !== undefined) {
      const width = Math.max(((item.end - item.start) / total) * 100, 0.15);
      return (
        <button
          type="button"
          key={`${row.key}-${index}`}
          title={title}
          onClick={seek}
          className="absolute top-[3px] h-[16px] rounded-sm text-[9px] leading-[16px] text-black/80 font-bold overflow-hidden whitespace-nowrap px-[2px] hover:brightness-125"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            minWidth: 6,
            background: color,
          }}
        >
          {zoom >= 4 ? item.name : initials(item.name)}
        </button>
      );
    }

    return (
      <button
        type="button"
        key={`${row.key}-${index}`}
        title={title}
        onClick={seek}
        className="absolute top-[3px] h-[16px] -translate-x-1/2 rounded-sm text-[8px] leading-[16px] text-black/80 font-bold text-center hover:brightness-125 hover:z-10"
        style={{
          left: `${left}%`,
          width: zoom >= 2 ? 16 : 4,
          background: item.interrupted ? 'transparent' : color,
          border: item.interrupted ? `1px dashed ${color}` : undefined,
        }}
      >
        {zoom >= 2 ? initials(item.name) : ''}
      </button>
    );
  };

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

  return (
    <div className="w-full bg-background-dark-gradient-to border-t border-card text-foreground select-none">
      <div className="flex items-center gap-x-2 h-[26px] px-2 text-xs">
        <button
          type="button"
          className="flex items-center gap-x-1 font-semibold"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          Spell timeline
        </button>
        {open && (
          <>
            <span className="text-foreground/40">|</span>
            {chip('boss', 'Boss')}
            {chip('enemy', 'Adds')}
            {chip('player', 'You')}
            <div className="ml-auto flex items-center gap-x-1">
              <button
                type="button"
                title="Zoom out"
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
                className="disabled:opacity-30"
              >
                <ZoomOut size={14} />
              </button>
              <span className="w-7 text-center text-foreground/60">
                {zoom}x
              </span>
              <button
                type="button"
                title="Zoom in"
                disabled={zoomIndex === ZOOMS.length - 1}
                onClick={() =>
                  setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))
                }
                className="disabled:opacity-30"
              >
                <ZoomIn size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      {open && (
        <div className="flex pb-1">
          <div style={{ width: LABEL_WIDTH }} className="shrink-0">
            {visibleRows.map((row) => (
              <div
                key={row.key}
                style={{ height: ROW_HEIGHT }}
                className="px-2 text-[11px] leading-[22px] truncate text-foreground/70"
                title={row.label}
              >
                {row.label}
              </div>
            ))}
          </div>
          <div
            ref={scroller}
            className="flex-1 overflow-x-auto overflow-y-hidden"
          >
            <div className="relative" style={{ width: `${zoom * 100}%` }}>
              {visibleRows.map((row) => (
                <div
                  key={row.key}
                  className="relative border-b border-card/60"
                  style={{ height: ROW_HEIGHT }}
                >
                  {row.items.map((item, i) => renderItem(row, item, i))}
                </div>
              ))}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-[#bb4420] pointer-events-none"
                style={{ left: `${(progress / total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpellTimeline;
