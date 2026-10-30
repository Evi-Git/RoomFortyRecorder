import React from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import {
  addDays,
  addMonths,
  bossResult,
  CalendarBoss,
  CalendarDay,
  CalendarNight,
  difficultiesOf,
  difficultyName,
  filterBosses,
  groupByDifficulty,
  monthGrid,
  monthName,
  nightSummary,
  parseKey,
  stepNight,
  weekGrid,
} from './nightCalendar';

/**
 * [RoomFortyRecorder] Night picker for the Logs page (1.9.94).
 * A: the Night button opens a month calendar popover (one square per boss,
 * colored by difficulty, filled = killed) with the hovered night's bosses on
 * the right. ⤢ grows it into B: a full-page calendar (Week / Month / Season).
 * Which one opens is remembered per PC.
 */

type Zoom = 'week' | 'month' | 'season';
type View = 'pop' | 'full';

const VIEW_KEY = 'rf-logs-night-view';
const ZOOM_KEY = 'rf-logs-night-zoom';
const DIFF_KEY = 'rf-logs-night-difficulty';

const SQUARE: Record<string, { fill: string; line: string; text: string }> = {
  Mythic: {
    fill: 'bg-orange-300',
    line: 'border border-orange-300',
    text: 'text-orange-300',
  },
  Heroic: {
    fill: 'bg-purple-300',
    line: 'border border-purple-300',
    text: 'text-purple-300',
  },
  Normal: {
    fill: 'bg-green-300',
    line: 'border border-green-300',
    text: 'text-green-300',
  },
  LFR: {
    fill: 'bg-sky-300',
    line: 'border border-sky-300',
    text: 'text-sky-300',
  },
};
const OTHER = {
  fill: 'bg-foreground',
  line: 'border border-foreground',
  text: 'text-foreground',
};
const colorsOf = (b: CalendarBoss) =>
  SQUARE[difficultyName(b.difficultyId)] ?? OTHER;

export const bossKeyOf = (b: CalendarBoss) =>
  `${b.encounterId}:${b.difficultyId}`;

const stored = <T extends string>(key: string, allowed: T[], fallback: T) => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
};

export const nightLabel = (night: string) => {
  const d = parseKey(night);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  });
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const iconButton =
  'inline-flex items-center justify-center w-8 h-8 rounded-md border border-card text-foreground-lighter hover:bg-card/60 disabled:opacity-40 disabled:hover:bg-transparent';

const resultClass = (b: CalendarBoss) =>
  b.kills > 0 ? 'text-green-400' : 'text-foreground';

/** One small square per boss: filled = killed, outline = wipes only. */
const Squares = ({
  bosses,
  size = 'w-1.5 h-1.5',
}: {
  bosses: CalendarBoss[];
  size?: string;
}) => (
  <span className="flex flex-wrap gap-0.5">
    {groupByDifficulty(bosses).flatMap((g) =>
      g.bosses.map((b) => {
        const c = colorsOf(b);
        return (
          <span
            key={bossKeyOf(b)}
            title={`${b.encounterName} (${g.name}) · ${bossResult(b)}`}
            className={`${size} rounded-[2px] box-border ${
              b.kills > 0 ? c.fill : c.line
            }`}
          />
        );
      }),
    )}
  </span>
);

const DifficultyChips = ({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (d: string) => void;
}) =>
  options.length > 1 ? (
    <div role="group" aria-label="Difficulty" className="flex gap-1">
      {['All', ...options].map((d) => {
        const on = d === value;
        return (
          <button
            type="button"
            key={d}
            aria-pressed={on}
            onClick={() => onChange(d)}
            className={`h-7 px-2.5 rounded-full text-xs font-semibold border transition-colors ${
              on
                ? 'bg-card border-brand text-foreground-lighter'
                : `border-card hover:bg-card/60 ${
                    SQUARE[d]?.text ?? 'text-foreground'
                  }`
            }`}
          >
            {d}
          </button>
        );
      })}
    </div>
  ) : null;

/** The hovered (or picked) night's bosses, grouped by difficulty. */
const NightPreview = ({
  night,
  bosses,
  onPick,
}: {
  night: string;
  bosses: CalendarBoss[];
  onPick: (bossKey: string) => void;
}) => {
  const pulls = bosses.reduce((s, b) => s + b.pulls, 0);
  const kills = bosses.reduce((s, b) => s + b.kills, 0);
  return (
    <div className="flex flex-col gap-y-2 min-w-0">
      <div className="flex items-baseline gap-x-2">
        <span className="text-sm font-bold text-foreground-lighter">
          {nightLabel(night)}
        </span>
        <span className="text-xs text-foreground">
          {pulls} {pulls === 1 ? 'pull' : 'pulls'} · {kills}{' '}
          {kills === 1 ? 'kill' : 'kills'}
        </span>
      </div>
      {groupByDifficulty(bosses).map((g) => (
        <div key={g.name} className="flex flex-col gap-y-0.5">
          <span
            className={`text-[11px] font-bold uppercase tracking-wide my-1 ${
              SQUARE[g.name]?.text ?? 'text-foreground'
            }`}
          >
            {g.name}
          </span>
          {g.bosses.map((b) => (
            <button
              type="button"
              key={bossKeyOf(b)}
              onClick={() => onPick(bossKeyOf(b))}
              className="flex items-center gap-x-2 min-h-[30px] px-2 rounded-md text-left text-sm text-foreground-lighter hover:bg-card/60"
            >
              <span className="flex-1 truncate">{b.encounterName}</span>
              <span className="text-xs text-foreground whitespace-nowrap">
                {b.pulls} {b.pulls === 1 ? 'pull' : 'pulls'}
              </span>
              <span
                className={`text-xs font-semibold w-12 text-right whitespace-nowrap ${resultClass(
                  b,
                )}`}
              >
                {bossResult(b)}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

type Props = {
  nights: CalendarNight[];
  night: string;
  /** Picks a night, and a boss of it (`encounterId:difficultyId`) if given. */
  onPick: (night: string, bossKey?: string) => void;
};

const NightPicker = ({ nights, night, onPick }: Props) => {
  const [view, setViewState] = React.useState<View>(() =>
    stored<View>(VIEW_KEY, ['pop', 'full'], 'pop'),
  );
  const setView = (v: View) => {
    setViewState(v);
    store(VIEW_KEY, v);
  };
  const [zoom, setZoomState] = React.useState<Zoom>(() =>
    stored<Zoom>(ZOOM_KEY, ['week', 'month', 'season'], 'month'),
  );
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    store(ZOOM_KEY, z);
  };
  const options = difficultiesOf(nights);
  const [difficultyState, setDifficultyState] = React.useState(() => {
    try {
      return localStorage.getItem(DIFF_KEY) || 'All';
    } catch {
      return 'All';
    }
  });
  const difficulty = options.includes(difficultyState)
    ? difficultyState
    : 'All';
  const setDifficulty = (d: string) => {
    setDifficultyState(d);
    store(DIFF_KEY, d);
  };

  const [popOpen, setPopOpen] = React.useState(false);
  const [fullOpen, setFullOpen] = React.useState(false);
  // The month (or week) on show, and the day the keyboard is on.
  const [cursor, setCursor] = React.useState(night);
  const [focus, setFocus] = React.useState(night);
  const [hover, setHover] = React.useState<string | null>(null);
  const keyboard = React.useRef(false);
  const box = React.useRef<HTMLDivElement>(null);
  const grid = React.useRef<HTMLDivElement>(null);

  const byDate = React.useMemo(() => {
    const map = new Map<string, CalendarBoss[]>();
    nights.forEach((n) => map.set(n.night, n.bosses));
    return map;
  }, [nights]);
  const bossesOn = (date: string) =>
    filterBosses(byDate.get(date) ?? [], difficulty);
  const isRaid = (date: string) => bossesOn(date).length > 0;

  const open = () => {
    setCursor(night);
    setFocus(night);
    setHover(null);
    if (view === 'full') setFullOpen(true);
    else setPopOpen(true);
  };
  const close = () => {
    setPopOpen(false);
    setFullOpen(false);
  };
  const pick = (date: string, bossKey?: string) => {
    close();
    onPick(date, bossKey);
  };

  // Escape or a click outside closes the popover; Escape closes B too.
  React.useEffect(() => {
    if (!popOpen && !fullOpen) return undefined;
    const down = (e: MouseEvent) => {
      if (popOpen && box.current && !box.current.contains(e.target as Node))
        setPopOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [popOpen, fullOpen]);

  // Keyboard focus follows the focused day.
  React.useEffect(() => {
    if (!keyboard.current || !popOpen) return;
    keyboard.current = false;
    const el = grid.current?.querySelector<HTMLElement>(
      `[data-date="${focus}"]`,
    );
    el?.focus();
  }, [focus, popOpen]);

  const moveFocus = (days: number) => {
    const next = addDays(focus, days);
    keyboard.current = true;
    setFocus(next);
    setHover(null);
    if (next.slice(0, 7) !== cursor.slice(0, 7)) setCursor(next);
  };
  const gridKeys = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(moves[e.key]);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const next = addMonths(focus, e.key === 'PageUp' ? -1 : 1);
      keyboard.current = true;
      setFocus(next);
      setCursor(next);
    } else if ((e.key === 'Enter' || e.key === ' ') && isRaid(focus)) {
      e.preventDefault();
      pick(focus);
    }
  };

  const previewDate = [hover, focus, night].find((d) => d && isRaid(d)) ?? '';
  const prev = stepNight(nights, night, -1, difficulty);
  const next = stepNight(nights, night, 1, difficulty);
  const summary = nightSummary(byDate.get(night) ?? []);

  const growToFull = () => {
    setView('full');
    setPopOpen(false);
    setFullOpen(true);
  };
  const shrinkToPop = () => {
    setView('pop');
    setFullOpen(false);
    setFocus(night);
    setPopOpen(true);
  };

  const popover = popOpen && (
    <div
      role="dialog"
      aria-label="Pick a night"
      className="absolute left-0 top-full mt-2 z-40 flex w-[920px] max-w-[calc(100vw-120px)] rounded-xl border border-card bg-background-higher shadow-2xl overflow-hidden"
    >
      <div className="w-[540px] shrink-0 p-4 border-r border-card">
        <div className="flex items-center gap-x-2 mb-3">
          <button
            type="button"
            aria-label="Previous month"
            className={iconButton}
            onClick={() => setCursor(addMonths(cursor, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="font-serif text-lg font-bold text-foreground-lighter mx-1 min-w-[150px] text-center">
            {monthName(cursor)}
          </span>
          <button
            type="button"
            aria-label="Next month"
            className={iconButton}
            onClick={() => setCursor(addMonths(cursor, 1))}
          >
            <ChevronRight size={16} />
          </button>
          <div className="ml-auto">
            <DifficultyChips
              options={options}
              value={difficulty}
              onChange={setDifficulty}
            />
          </div>
          <button
            type="button"
            aria-label="Grow to full calendar"
            title="Grow to full calendar"
            className={iconButton}
            onClick={growToFull}
          >
            <Maximize2 size={14} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-[11px] text-foreground mb-1">
          {WEEKDAYS.map((d) => (
            <span key={d} className="pl-1">
              {d}
            </span>
          ))}
        </div>
        <div
          ref={grid}
          role="grid"
          tabIndex={-1}
          aria-label={monthName(cursor)}
          className="grid grid-cols-7 gap-1"
          onKeyDown={gridKeys}
          onMouseLeave={() => setHover(null)}
        >
          {monthGrid(cursor)
            .flat()
            .map((d) => (
              <PopDay
                key={d.date}
                d={d}
                bosses={bossesOn(d.date)}
                selected={d.date === night}
                focused={d.date === focus}
                onHover={() => setHover(d.date)}
                onFocusDay={() => setFocus(d.date)}
                onPick={() => pick(d.date)}
              />
            ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-foreground">
          {(options.length ? options : ['Mythic']).map((d) => (
            <span key={d} className="flex items-center gap-x-1.5">
              <span
                className={`w-2 h-2 rounded-[2px] ${(SQUARE[d] ?? OTHER).fill}`}
              />
              {d} boss
            </span>
          ))}
          <span className="flex items-center gap-x-1.5">
            <span className="w-2 h-2 rounded-[2px] border border-foreground" />
            wipes only
          </span>
        </div>
      </div>
      <div className="flex-1 p-4 min-w-0 max-h-[520px] overflow-y-auto">
        {previewDate ? (
          <NightPreview
            night={previewDate}
            bosses={bossesOn(previewDate)}
            onPick={(key) => pick(previewDate, key)}
          />
        ) : (
          <p className="text-sm text-foreground">No raid that month.</p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div ref={box} className="relative flex items-center gap-x-2">
        <span className="text-sm">Night</span>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={popOpen || fullOpen}
          onClick={() => (popOpen || fullOpen ? close() : open())}
          className={`inline-flex items-center gap-x-2 min-h-[32px] px-3 rounded-md border bg-card text-sm font-semibold text-foreground-lighter ${
            popOpen ? 'border-brand' : 'border-background hover:border-card'
          }`}
        >
          <CalendarDays size={16} className="text-brand shrink-0" />
          <span className="whitespace-nowrap">
            {night ? nightLabel(night) : 'Pick a night'}
            {summary && (
              <span className="font-normal text-foreground"> · {summary}</span>
            )}
          </span>
          <ChevronDown size={14} className="shrink-0" />
        </button>
        <button
          type="button"
          aria-label="Previous raid night"
          title={prev ? nightLabel(prev) : 'No earlier raid night'}
          disabled={!prev}
          className={iconButton}
          onClick={() => prev && onPick(prev)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Next raid night"
          title={next ? nightLabel(next) : 'No later raid night'}
          disabled={!next}
          className={iconButton}
          onClick={() => next && onPick(next)}
        >
          <ChevronRight size={16} />
        </button>
        {popover}
      </div>
      {fullOpen && (
        <FullCalendar
          night={night}
          cursor={cursor}
          setCursor={setCursor}
          zoom={zoom}
          setZoom={setZoom}
          newest={nights[0]?.night ?? night}
          bossesOn={bossesOn}
          chips={
            <DifficultyChips
              options={options}
              value={difficulty}
              onChange={setDifficulty}
            />
          }
          onPick={pick}
          onShrink={shrinkToPop}
          onClose={close}
        />
      )}
    </>
  );
};

/** A day in the popover: date, a square per boss, "N kills". */
const PopDay = ({
  d,
  bosses,
  selected,
  focused,
  onHover,
  onFocusDay,
  onPick,
}: {
  d: CalendarDay;
  bosses: CalendarBoss[];
  selected: boolean;
  focused: boolean;
  onHover: () => void;
  onFocusDay: () => void;
  onPick: () => void;
}) => {
  const raid = bosses.length > 0;
  const kills = bosses.filter((b) => b.kills > 0).length;
  let tone = 'border-transparent';
  if (selected) tone = 'border-brand bg-card';
  else if (raid) tone = 'border-card bg-background hover:border-foreground/40';
  return (
    <button
      type="button"
      data-date={d.date}
      tabIndex={focused ? 0 : -1}
      aria-disabled={!raid}
      aria-selected={selected}
      aria-label={`${nightLabel(d.date)}${
        raid ? ` · ${nightSummary(bosses)}` : ' · no raid'
      }`}
      onMouseEnter={raid ? onHover : undefined}
      onFocus={onFocusDay}
      onClick={raid ? onPick : undefined}
      className={`flex flex-col items-start gap-1 h-[70px] p-1.5 rounded-md border text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-brand ${tone} ${
        raid ? 'cursor-pointer' : 'cursor-default'
      } ${d.inMonth ? '' : 'opacity-50'}`}
    >
      <span
        className={`text-xs font-semibold ${
          raid ? 'text-foreground-lighter' : 'text-foreground/40'
        }`}
      >
        {d.day}
      </span>
      {raid && (
        <>
          <span className="mt-auto">
            <Squares bosses={bosses} />
          </span>
          <span className="text-[10px] text-foreground">
            {kills} {kills === 1 ? 'kill' : 'kills'}
          </span>
        </>
      )}
    </button>
  );
};

const zoomLabel = (zoom: Zoom, cursor: string) => {
  if (zoom === 'month') return monthName(cursor);
  if (zoom === 'week') {
    const days = weekGrid(cursor);
    const a = parseKey(days[0].date);
    const b = parseKey(days[6].date);
    const short = (x: Date) =>
      x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${short(a)} – ${short(b)}, ${b.getFullYear()}`;
  }
  const first = parseKey(addMonths(cursor, -3));
  const last = parseKey(cursor);
  const m = (x: Date) => x.toLocaleDateString(undefined, { month: 'short' });
  return `${m(first)} – ${m(last)} ${last.getFullYear()}`;
};

/** B: a full-page calendar over the Logs page. */
const FullCalendar = ({
  night,
  cursor,
  setCursor,
  zoom,
  setZoom,
  newest,
  bossesOn,
  chips,
  onPick,
  onShrink,
  onClose,
}: {
  night: string;
  cursor: string;
  setCursor: (c: string) => void;
  zoom: Zoom;
  setZoom: (z: Zoom) => void;
  newest: string;
  bossesOn: (date: string) => CalendarBoss[];
  chips: React.ReactNode;
  onPick: (date: string, bossKey?: string) => void;
  onShrink: () => void;
  onClose: () => void;
}) => {
  const step = (dir: -1 | 1) =>
    setCursor(
      zoom === 'week' ? addDays(cursor, dir * 7) : addMonths(cursor, dir),
    );
  const zoomButton = (z: Zoom, label: string) => (
    <button
      type="button"
      key={z}
      aria-pressed={zoom === z}
      onClick={() => setZoom(z)}
      className={`h-8 px-3 text-sm ${
        zoom === z
          ? 'bg-brand text-background font-semibold'
          : 'text-foreground-lighter hover:bg-card/60'
      }`}
    >
      {label}
    </button>
  );

  let body: React.ReactNode;
  if (zoom === 'season') {
    body = (
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-6">
        {[-3, -2, -1, 0].map((offset) => {
          const month = addMonths(cursor, offset);
          return (
            <div key={month} className="flex flex-col gap-y-1">
              <span className="font-serif font-bold text-foreground-lighter">
                {monthName(month)}
              </span>
              <div className="grid grid-cols-7 gap-1 text-[10px] text-foreground">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d.charAt(0)}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid(month)
                  .flat()
                  .map((d) =>
                    d.inMonth ? (
                      <SeasonDay
                        key={d.date}
                        d={d}
                        bosses={bossesOn(d.date)}
                        selected={d.date === night}
                        onPick={() => onPick(d.date)}
                      />
                    ) : (
                      <span key={d.date} />
                    ),
                  )}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else {
    const days = zoom === 'week' ? [weekGrid(cursor)] : monthGrid(cursor);
    body = (
      <>
        <div className="grid grid-cols-7 gap-1.5 text-[11px] text-foreground mb-1">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.flat().map((d) => (
            <FullDay
              key={d.date}
              d={d}
              bosses={bossesOn(d.date)}
              selected={d.date === night}
              limit={zoom === 'week' ? Infinity : 4}
              tall={zoom === 'week'}
              onPick={(key) => onPick(d.date, key)}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Pick a night"
      className="absolute left-0 top-0 z-40 w-full min-h-[calc(100vh-140px)] rounded-xl border border-card bg-background-higher shadow-2xl p-4 flex flex-col gap-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-xl font-bold text-foreground-lighter mr-2">
          Pick a night
        </h2>
        <button
          type="button"
          aria-label="Earlier"
          className={iconButton}
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-base font-semibold text-foreground-lighter min-w-[170px] text-center">
          {zoomLabel(zoom, cursor)}
        </span>
        <button
          type="button"
          aria-label="Later"
          className={iconButton}
          onClick={() => step(1)}
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          title="Go to the newest raid night"
          className="h-8 px-3 rounded-md border border-card text-sm text-foreground-lighter hover:bg-card/60"
          onClick={() => setCursor(newest)}
        >
          Tonight
        </button>
        <div
          role="group"
          aria-label="Zoom"
          className="flex rounded-md border border-card overflow-hidden ml-2"
        >
          {zoomButton('week', 'Week')}
          {zoomButton('month', 'Month')}
          {zoomButton('season', 'Season')}
        </div>
        <div className="ml-2">{chips}</div>
        <div className="ml-auto flex gap-x-2">
          <button
            type="button"
            aria-label="Shrink back"
            title="Shrink back to the pop-out"
            className={iconButton}
            onClick={onShrink}
          >
            <Minimize2 size={14} />
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            className={iconButton}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {body}
    </div>
  );
};

/** A day in B's Week / Month view: bosses with a dot and result. */
const FullDay = ({
  d,
  bosses,
  selected,
  limit,
  tall,
  onPick,
}: {
  d: CalendarDay;
  bosses: CalendarBoss[];
  selected: boolean;
  limit: number;
  tall: boolean;
  onPick: (bossKey?: string) => void;
}) => {
  const raid = bosses.length > 0;
  const rows = groupByDifficulty(bosses).flatMap((g) => g.bosses);
  const kills = bosses.filter((b) => b.kills > 0).length;
  let tone = 'border-transparent';
  if (selected) tone = 'border-brand bg-card';
  else if (raid) tone = 'border-card bg-background hover:border-foreground/40';
  return (
    <div
      role={raid ? 'button' : undefined}
      tabIndex={raid ? 0 : undefined}
      aria-label={
        raid ? `${nightLabel(d.date)} · ${nightSummary(bosses)}` : undefined
      }
      onClick={raid ? () => onPick() : undefined}
      onKeyDown={
        raid
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick();
              }
            }
          : undefined
      }
      className={`flex flex-col gap-0.5 p-2 rounded-lg border min-w-0 overflow-hidden ${
        tall ? 'min-h-[320px]' : 'min-h-[112px]'
      } ${tone} ${raid ? 'cursor-pointer' : ''} ${
        d.inMonth ? '' : 'opacity-50'
      }`}
    >
      <div className="flex items-center gap-x-1.5 mb-0.5">
        <span
          className={`text-sm font-bold ${
            raid ? 'text-foreground-lighter' : 'text-foreground/40'
          }`}
        >
          {d.day}
        </span>
        {raid && (
          <span className="ml-auto text-[11px] text-foreground">
            {kills}/{bosses.length}
          </span>
        )}
      </div>
      {rows.slice(0, limit).map((b) => (
        <button
          type="button"
          key={bossKeyOf(b)}
          onClick={(e) => {
            e.stopPropagation();
            onPick(bossKeyOf(b));
          }}
          title={`${b.encounterName} (${difficultyName(b.difficultyId)}) · ${
            b.pulls
          } ${b.pulls === 1 ? 'pull' : 'pulls'}`}
          className="flex items-center gap-x-1.5 text-[11px] leading-[16px] text-foreground-lighter text-left rounded px-0.5 hover:bg-card/60 min-w-0"
        >
          <span
            className={`shrink-0 w-[7px] h-[7px] rounded-[2px] ${colorsOf(b).fill}`}
          />
          <span className="flex-1 truncate">{b.encounterName}</span>
          <span className={`font-semibold whitespace-nowrap ${resultClass(b)}`}>
            {bossResult(b)}
          </span>
        </button>
      ))}
      {rows.length > limit && (
        <span className="text-[11px] text-brand">
          +{rows.length - limit} more
        </span>
      )}
    </div>
  );
};

/** A day in B's Season view: compact, squares only. */
const SeasonDay = ({
  d,
  bosses,
  selected,
  onPick,
}: {
  d: CalendarDay;
  bosses: CalendarBoss[];
  selected: boolean;
  onPick: () => void;
}) => {
  const raid = bosses.length > 0;
  let tone = 'border-transparent';
  if (selected) tone = 'border-brand bg-card';
  else if (raid) tone = 'border-card bg-background hover:border-foreground/40';
  return (
    <button
      type="button"
      disabled={!raid}
      onClick={onPick}
      aria-label={`${nightLabel(d.date)}${
        raid ? ` · ${nightSummary(bosses)}` : ' · no raid'
      }`}
      title={
        raid ? `${nightLabel(d.date)} · ${nightSummary(bosses)}` : undefined
      }
      className={`flex flex-col items-start gap-0.5 h-12 p-1 rounded border text-left ${tone} ${
        raid ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <span
        className={`text-[10px] font-semibold ${
          raid ? 'text-foreground-lighter' : 'text-foreground/40'
        }`}
      >
        {d.day}
      </span>
      {raid && <Squares bosses={bosses} size="w-1 h-1" />}
    </button>
  );
};

export default NightPicker;
