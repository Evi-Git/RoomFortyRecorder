import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  ListFilter,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { SpellTimeline as SpellTimelineData } from 'main/types';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover/Popover';

/**
 * [RoomFortyRecorder] Spell timeline under the video player: boss casts,
 * other enemies' casts and your own casts for a raid pull.
 *
 * - Boss casts with a cast time show as a bar from cast start to finish.
 * - Click any marker to jump the video there (1 second before).
 * - Zoom in to separate dense rows; the view follows the playhead.
 * - Spell icons come from Wowhead (looked up once per spell, then cached);
 *   offline they fall back to coloured tiles with initials.
 * - The Spells menu hides or shows any spell; the choice is remembered.
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

const ipc = window.electron.ipcRenderer;

const ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/large';

const KIND_LABEL: Record<Row['kind'], string> = {
  boss: 'Boss',
  enemy: 'Adds',
  player: 'You',
};

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

/** A spell's icon, or a coloured tile with its initials if there's none. */
const SpellIcon = ({
  spellId,
  name,
  icon,
  size,
  className = '',
}: {
  spellId: number;
  name: string;
  icon?: string;
  size: number;
  className?: string;
}) => {
  const [failed, setFailed] = React.useState(false);

  if (icon && !failed) {
    return (
      <img
        src={`${ICON_CDN}/${icon}.jpg`}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={`rounded-[3px] shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`rounded-[3px] shrink-0 inline-block text-center font-bold text-black/80 ${className}`}
      style={{
        width: size,
        height: size,
        lineHeight: `${size}px`,
        fontSize: Math.max(7, Math.round(size * 0.45)),
        background: spellColor(spellId),
      }}
    >
      {size >= 12 ? initials(name) : ''}
    </span>
  );
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

  const [hiddenSpells, setHiddenSpells] = React.useState<number[]>(() => {
    try {
      const parsed = JSON.parse(store.get('rf-timeline-hidden-spells') || '[]');
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  });
  const [icons, setIcons] = React.useState<Record<string, string>>({});
  const [search, setSearch] = React.useState('');

  const scroller = React.useRef<HTMLDivElement>(null);
  const rows = React.useMemo(() => buildRows(timeline), [timeline]);
  const zoom = ZOOMS[zoomIndex];
  const total = Math.max(duration, 1);

  React.useEffect(() => store.set('rf-timeline-open', String(open)), [open]);
  React.useEffect(
    () => store.set('rf-timeline-hidden', JSON.stringify(hidden)),
    [hidden],
  );
  React.useEffect(
    () => store.set('rf-timeline-hidden-spells', JSON.stringify(hiddenSpells)),
    [hiddenSpells],
  );

  // Look up icons for every spell in this pull. Cached ones come back at
  // once; new ones take a moment the first time.
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

  // When zoomed in, keep the playhead in view.
  React.useEffect(() => {
    const el = scroller.current;
    if (!el || zoom === 1) return;
    const x = (progress / total) * el.scrollWidth;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [progress, total, zoom]);

  const hiddenSet = React.useMemo(() => new Set(hiddenSpells), [hiddenSpells]);

  const visibleRows = rows
    .filter((row) => !hidden[row.kind])
    .map((row) => ({
      ...row,
      items: row.items.filter((item) => !hiddenSet.has(item.spellId)),
    }));

  // Every spell per row, most cast first, for the Spells menu.
  const spellLists = React.useMemo(
    () =>
      rows.map((row) => {
        const counts = new Map<number, { name: string; count: number }>();
        row.items.forEach((item) => {
          const entry = counts.get(item.spellId) || {
            name: item.name,
            count: 0,
          };
          entry.count += 1;
          counts.set(item.spellId, entry);
        });
        return {
          row,
          spells: [...counts.entries()]
            .map(([spellId, entry]) => ({ spellId, ...entry }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        };
      }),
    [rows],
  );

  const toggleSpell = (spellId: number) =>
    setHiddenSpells((list) =>
      list.includes(spellId)
        ? list.filter((id) => id !== spellId)
        : [...list, spellId],
    );

  const setGroup = (spellIds: number[], show: boolean) =>
    setHiddenSpells((list) => {
      const without = list.filter((id) => !spellIds.includes(id));
      return show ? without : [...without, ...spellIds];
    });

  const hiddenHere = spellLists.reduce(
    (n, { spells }) =>
      n + spells.filter((x) => hiddenSet.has(x.spellId)).length,
    0,
  );

  const renderItem = (row: Row, item: Item, index: number) => {
    const left = (item.start / total) * 100;
    const title = `${item.name} — ${fmt(item.start)}${
      item.end !== undefined ? `–${fmt(item.end)}` : ''
    }${item.interrupted ? ' (interrupted)' : ''}`;
    const color = spellColor(item.spellId);
    const icon = icons[item.spellId];
    const seek = () => onSeek(Math.max(0, item.start - 1));
    const iconSize = zoom === 1 ? 14 : 18;

    if (item.end !== undefined) {
      const width = Math.max(((item.end - item.start) / total) * 100, 0.15);
      return (
        <button
          type="button"
          key={`${row.key}-${index}`}
          title={title}
          onClick={seek}
          className="absolute top-[2px] h-[18px] rounded-[3px] flex items-center gap-x-1 overflow-hidden whitespace-nowrap text-[10px] font-semibold text-foreground-lighter hover:brightness-125 hover:z-10"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            minWidth: 18,
            background: `color-mix(in srgb, ${color} 35%, transparent)`,
            boxShadow: `inset 0 0 0 1px ${color}`,
          }}
        >
          <SpellIcon
            spellId={item.spellId}
            name={item.name}
            icon={icon}
            size={18}
          />
          {zoom >= 4 && <span className="pr-1 truncate">{item.name}</span>}
        </button>
      );
    }

    return (
      <button
        type="button"
        key={`${row.key}-${index}`}
        title={title}
        onClick={seek}
        className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 hover:z-10 hover:scale-125 transition-transform"
        style={{ left: `${left}%` }}
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

  const renderSpellMenu = () => {
    const query = search.trim().toLowerCase();
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`flex items-center gap-x-1 px-2 rounded text-[11px] border ${
              hiddenHere
                ? 'border-brand/70 text-brand'
                : 'border-foreground/30 text-foreground'
            }`}
            title="Choose which spells show on the timeline"
          >
            <ListFilter size={12} />
            Spells{hiddenHere ? ` · ${hiddenHere} hidden` : ''}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 p-0 text-xs text-foreground-lighter"
        >
          <div className="flex items-center gap-x-2 border-b border-background px-3 py-2">
            <Search size={13} className="text-foreground/50" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a spell"
              className="flex-1 bg-transparent outline-none placeholder:text-foreground/40"
            />
            {hiddenHere > 0 && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() =>
                  setGroup(
                    spellLists.flatMap(({ spells }) =>
                      spells.map((x) => x.spellId),
                    ),
                    true,
                  )
                }
              >
                Show all
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {spellLists.map(({ row, spells }) => {
              const shown = spells.filter(
                (x) => !query || x.name.toLowerCase().includes(query),
              );
              if (!shown.length) return null;
              const ids = shown.map((x) => x.spellId);
              return (
                <div key={row.key} className="pb-1">
                  <div className="flex items-center px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-foreground/50">
                    <span className="flex-1 truncate">
                      {KIND_LABEL[row.kind]}
                      {row.kind !== 'enemy' &&
                      row.label !== KIND_LABEL[row.kind]
                        ? ` · ${row.label}`
                        : ''}
                    </span>
                    <button
                      type="button"
                      className="normal-case hover:text-brand"
                      onClick={() => setGroup(ids, true)}
                    >
                      All
                    </button>
                    <span className="px-1">/</span>
                    <button
                      type="button"
                      className="normal-case hover:text-brand"
                      onClick={() => setGroup(ids, false)}
                    >
                      None
                    </button>
                  </div>
                  {shown.map((spell) => {
                    const on = !hiddenSet.has(spell.spellId);
                    return (
                      <label
                        key={spell.spellId}
                        className="flex items-center gap-x-2 px-3 py-1 cursor-pointer hover:bg-background/40"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleSpell(spell.spellId)}
                          className="accent-[hsl(var(--brand))]"
                        />
                        <SpellIcon
                          spellId={spell.spellId}
                          name={spell.name}
                          icon={icons[spell.spellId]}
                          size={18}
                          className={on ? '' : 'opacity-40 grayscale'}
                        />
                        <span
                          className={`flex-1 truncate ${on ? '' : 'text-foreground/40'}`}
                        >
                          {spell.name}
                        </span>
                        <span className="text-foreground/50">
                          {spell.count}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
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
            {renderSpellMenu()}
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
                className="absolute top-0 bottom-0 w-[2px] bg-brand pointer-events-none"
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
