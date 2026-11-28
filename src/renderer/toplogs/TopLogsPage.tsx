/**
 * [RoomFortyRecorder] Top logs (1.9.96): Warcraft Logs' top 25 kills per
 * boss, difficulty and spec, Lorrgs-style, with the spec's main cooldowns on
 * the fight clock; Race me opens a Time trial against any raider's pull.
 */
import { dateTime, shortDate, timeOfDay } from 'renderer/clock';
import React, { Dispatch, RefObject, SetStateAction } from 'react';
import { AppState, RendererVideo } from 'main/types';
import { useRecordingWatch, WatchContext } from '../Meters';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  Flag,
  RefreshCw,
  RotateCcw,
  Timer,
} from 'lucide-react';
import { BossButton, loadSeason, MODE_TEXT } from '../logs/BossStrip';
import { zoneBosses } from '../logs/bossStripModel';
import type { SeasonBoss } from '../logs/bossStripModel';
import SpellIcon from '../logs/SpellIcon';
import { classColor } from '../logs/format';
import { compact, formatDuration } from '../format';
import { useTabTitle } from '../tabs/tabs';
import { FOCUS_RING } from '../a11y';
import { ErrorState } from '../components/States/States';
import TimeTrial from './TimeTrial';
import {
  call,
  ipc,
  RankRow,
  spec,
  SpecImage,
  specTitle,
  ticks,
  useSpellNames,
} from './shared';
import type { Cooldown } from './trial';
import type { Progress } from './fetchStatus';
import { mergeByName } from './timeline';
import { wclUrl } from './trial';
import {
  failedLine,
  failedRows,
  failureDelay,
  firstDirection,
  pollDelay,
  progressLine,
  SortKey,
  sortRankRows,
} from './fetchStatus';

type Rankings = {
  encounterId: number;
  difficultyId: number;
  specId: number;
  metric: 'dps' | 'hps';
  region: string;
  at: number;
  rows: RankRow[];
  pending: number;
  /** 1.9.169+ servers: counts per state, and when the hourly limit lets it go on. */
  progress?: Progress;
  waiting?: { resumesAt: number; reason?: string } | null;
  cooldowns: Cooldown[];
};

type Info = {
  configured: boolean;
  regions: string[];
  lastCrawl: number | null;
  status: { running: boolean; done: number; total: number };
};

const SAVED = 'rf-toplogs';
type Choice = {
  encounterId: number;
  difficultyId: number;
  specId: number;
  region: string;
};
const loadChoice = (): Partial<Choice> => {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || '{}');
  } catch {
    return {};
  }
};

const CLASS_ORDER = [
  'DEATHKNIGHT',
  'DEMONHUNTER',
  'DRUID',
  'EVOKER',
  'HUNTER',
  'MAGE',
  'MONK',
  'PALADIN',
  'PRIEST',
  'ROGUE',
  'SHAMAN',
  'WARLOCK',
  'WARRIOR',
];
// The 40 specs Top logs knows (the server's table), grouped by class.
const SPEC_IDS = [
  250, 251, 252, 577, 581, 1480, 102, 103, 104, 105, 1467, 1468, 1473, 253, 254,
  255, 62, 63, 64, 268, 270, 269, 65, 66, 70, 256, 257, 258, 259, 260, 261, 262,
  263, 264, 265, 266, 267, 71, 72, 73,
];
/** Spec picker: a grid of spec icons by class. */
const SpecPicker = ({
  specId,
  onPick,
}: {
  specId: number;
  onPick: (id: number) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  // Closes on a click outside or Esc.
  React.useEffect(() => {
    if (!open) return undefined;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const byClass = CLASS_ORDER.map((cls) => ({
    cls,
    ids: SPEC_IDS.filter((id) => spec(id)?.class === cls),
  })).filter((g) => g.ids.length);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-x-2 h-11 rounded-md border border-card bg-background/60 px-3 text-sm hover:bg-card/40"
      >
        <SpecImage id={specId} size={24} />
        <span className="font-semibold" style={{ color: classColor(specId) }}>
          {specTitle(specId)}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-[100] rounded-md border border-card bg-background p-2 shadow-xl">
          <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
            {byClass.map(({ cls, ids }) => (
              <React.Fragment key={cls}>
                <span
                  className="text-xs self-center whitespace-nowrap"
                  style={{ color: classColor(ids[0]) }}
                >
                  {spec(ids[0])?.label}
                </span>
                <span className="flex gap-x-1">
                  {ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      title={specTitle(id)}
                      aria-label={specTitle(id)}
                      onClick={() => {
                        onPick(id);
                        setOpen(false);
                      }}
                      className={`rounded p-0.5 ${
                        id === specId ? 'ring-2 ring-white' : 'hover:bg-card'
                      }`}
                    >
                      <SpecImage id={id} size={26} />
                    </button>
                  ))}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Lane = ({
  row,
  max,
  shown,
  onRetry,
}: {
  row: RankRow;
  max: number;
  /** Cast spell ID -> the cooldown's icon ID, for the ones shown. */
  shown: Map<number, number>;
  onRetry: (row: RankRow) => void;
}) => (
  <div className="relative h-7 rounded bg-background/40 overflow-hidden">
    <div
      className="absolute inset-y-0 left-0 bg-card/40"
      style={{ width: `${(row.duration / max) * 100}%` }}
    />
    {(row.phases ?? []).slice(1).map(([t]) => (
      <div
        key={`p${t}`}
        className="absolute inset-y-0 w-px bg-foreground/30"
        style={{ left: `${(t / max) * 100}%` }}
      />
    ))}
    {row.state === 'queued' && (
      <span className="absolute inset-0 flex items-center px-2 text-xs text-foreground">
        {(row.attempt ?? 1) > 1
          ? `Fetching casts (try ${row.attempt})…`
          : 'Fetching casts…'}
      </span>
    )}
    {row.state === 'waiting' && (
      <span
        className="absolute inset-0 flex items-center px-2 text-xs text-foreground truncate"
        title="Warcraft Logs' hourly limit is used up; this goes on when it resets."
      >
        {row.resumesAt
          ? `Waiting for the hourly limit, resumes around ${timeOfDay(row.resumesAt)}`
          : 'Waiting for the hourly limit'}
      </span>
    )}
    {row.state === 'failed' && (
      <span className="absolute inset-0 flex items-center gap-x-2 px-2 text-xs">
        <span className="text-red-400 truncate" title={row.error}>
          {row.error || "Couldn't fetch this log"}
        </span>
        <button
          type="button"
          onClick={() => onRetry(row)}
          aria-label={`Retry fetching ${row.name}'s log`}
          className={`flex shrink-0 items-center gap-x-1 rounded px-1.5 py-0.5 text-brand hover:bg-brand/10 ${FOCUS_RING}`}
        >
          <RotateCcw size={11} /> Retry
        </button>
      </span>
    )}
    {(row.casts ?? [])
      .filter(([, id]) => shown.has(id))
      .map(([t, id]) => (
        <span
          key={`${id}@${t}`}
          className="absolute top-[5px] -translate-x-1/2"
          style={{ left: `${(t / max) * 100}%` }}
        >
          <SpellIcon spellId={shown.get(id) ?? id} />
        </span>
      ))}
  </div>
);

/** A column header that sorts the list: one arrow on the active column. */
const SortHeader = ({
  label,
  column,
  sort,
  onSort,
  className = '',
  title,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  className?: string;
  title?: string;
}) => {
  const active = sort.key === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={title ?? `Sort by ${label}`}
      className={`inline-flex items-center gap-x-0.5 rounded text-xs hover:text-foreground-lighter ${FOCUS_RING} ${
        active ? 'text-foreground-lighter' : 'text-foreground'
      } ${className}`}
    >
      {label}
      {active && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  );
};

const ariaSort = (sort: { key: SortKey; desc: boolean }, ...cols: SortKey[]) =>
  cols.includes(sort.key)
    ? sort.desc
      ? ('descending' as const)
      : ('ascending' as const)
    : ('none' as const);

const RankingsGrid = ({
  choice,
  onRace,
}: {
  choice: Choice;
  onRace: (row: RankRow, data: Rankings) => void;
}) => {
  const [data, setData] = React.useState<Rankings | null>(null);
  const [error, setError] = React.useState('');
  const [hidden, setHidden] = React.useState<Set<number>>(new Set());
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({
    key: 'rank',
    desc: false,
  });
  // Asking again: `tick` runs the effect, the refs say how it went so far.
  const [tick, setTick] = React.useState(0);
  const [reconnecting, setReconnecting] = React.useState(false);
  const [stalled, setStalled] = React.useState(false);
  const [retryNote, setRetryNote] = React.useState('');
  const failures = React.useRef(0);
  const polls = React.useRef(0);
  const retryRankings = React.useRef(false);
  const { encounterId, difficultyId, specId, region } = choice;

  React.useEffect(() => {
    if (!encounterId) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = (ms: number) => {
      timer = setTimeout(() => setTick((n) => n + 1), ms);
    };
    call<Rankings>({
      action: 'topRankings',
      encounterId,
      difficultyId,
      specId,
      region,
      ...(retryRankings.current ? { retry: true } : {}),
    }).then((r) => {
      if (!live) return;
      retryRankings.current = false;
      if (!r.ok) {
        // The server restarting, the network, or a slow first answer: ask
        // again a few times (slower each time) before showing the error.
        failures.current += 1;
        const wait = failureDelay(failures.current);
        if (wait === null) {
          setReconnecting(false);
          setError(r.error);
        } else {
          setReconnecting(true);
          again(wait);
        }
        return;
      }
      failures.current = 0;
      polls.current += 1;
      setReconnecting(false);
      setError('');
      setData(r.data);
      // Casts arrive a row at a time: ask again until none are coming.
      const wait = pollDelay(r.data, polls.current, Date.now());
      setStalled(wait === null && r.data.pending > 0);
      if (wait !== null) again(wait);
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [encounterId, difficultyId, specId, region, tick]);

  // Ask now: Try again after an error, Refresh when it gave up waiting.
  const askNow = (rankingsFailed = false) => {
    failures.current = 0;
    polls.current = 0;
    retryRankings.current = rankingsFailed;
    setError('');
    setStalled(false);
    setTick((n) => n + 1);
  };
  // Retry: logs that failed go back in the server's queue.
  const retry = (rows: RankRow[]) => {
    setRetryNote('');
    call<{ queued: number }>({
      action: 'topRetry',
      rows: rows.map((r) => ({ code: r.code, fight: r.fight, name: r.name })),
    }).then((r) => {
      if (!r.ok && /Unknown API route/.test(r.error)) {
        setRetryNote(
          'Retry needs the newer guild server: run update-server.cmd on the server PC.',
        );
      } else if (!r.ok) {
        setRetryNote(r.error);
      }
      askNow();
    });
  };

  const labels = useSpellNames((data?.cooldowns ?? []).map((c) => c.spellId));

  if (error && !data) {
    return (
      <ErrorState
        what="Couldn't load the rankings"
        error={error}
        onRetry={() => askNow(true)}
      />
    );
  }
  if (!data) {
    return (
      <p className="text-sm text-foreground">
        {reconnecting
          ? 'The guild server is slow to answer; trying again…'
          : 'Loading rankings…'}
      </p>
    );
  }
  if (!data.rows.length) {
    return (
      <p className="text-sm text-foreground">
        Warcraft Logs has no ranked kills for this spec yet.
      </p>
    );
  }

  const max = Math.max(...data.rows.map((r) => r.duration), 1);
  // One chip per name (a spell can have several IDs; 1.9.102).
  const merged = mergeByName(data.cooldowns, labels);
  const byKey = new Map(data.cooldowns.map((c) => [c.spellId, c]));
  const shown = new Map<number, number>();
  merged
    .filter((c) => !hidden.has(c.spellId))
    .forEach((c) => c.spellIds.forEach((id) => shown.set(id, c.spellId)));
  const toggle = (id: number) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const unit = data.metric === 'hps' ? 'HPS' : 'DPS';
  const rows = sortRankRows(data.rows, sort.key, sort.desc);
  const onSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, desc: !prev.desc }
        : { key, desc: firstDirection(key) === 'desc' },
    );
  const line = progressLine(data);
  const failedNote = failedLine(data);
  const failed = failedRows(data.rows);

  return (
    <div className="flex flex-col gap-y-3">
      {(line || failedNote || reconnecting || stalled || retryNote) && (
        <div
          role="status"
          className="flex items-center gap-x-3 flex-wrap gap-y-1 rounded-md border border-panel-line bg-panel px-3 py-2 text-xs"
        >
          {line && (
            <span className="flex items-center gap-x-1.5 text-foreground-lighter">
              <RefreshCw size={12} className="animate-spin" /> {line}
            </span>
          )}
          {reconnecting && (
            <span className="text-foreground">
              The guild server isn&apos;t answering; trying again…
            </span>
          )}
          {stalled && (
            <span className="flex items-center gap-x-2 text-foreground">
              Still waiting on some logs.
              <button
                type="button"
                onClick={() => askNow()}
                className={`flex items-center gap-x-1 rounded text-brand hover:underline ${FOCUS_RING}`}
              >
                <RefreshCw size={11} /> Refresh
              </button>
            </span>
          )}
          {failedNote && (
            <span className="flex items-center gap-x-2 text-foreground-lighter">
              {failedNote}
              <button
                type="button"
                onClick={() => retry(failed)}
                className={`flex items-center gap-x-1 rounded text-brand hover:underline ${FOCUS_RING}`}
              >
                <RotateCcw size={11} /> Retry failed
              </button>
            </span>
          )}
          {retryNote && <span className="text-red-400">{retryNote}</span>}
        </div>
      )}
      <div className="flex items-center gap-x-2 flex-wrap gap-y-1 text-xs">
        <span className="text-foreground mr-1">Main cooldowns</span>
        {data.cooldowns.length === 0 && (
          <span className="text-foreground">
            {data.pending
              ? 'worked out once a few logs are in…'
              : 'none stood out'}
          </span>
        )}
        {merged.map((m) => {
          const c = byKey.get(m.spellId) ?? data.cooldowns[0];
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggle(m.spellId)}
              title={`${Math.round(c.share * 100)}% of these players use it; median ${c.medianCasts} per fight${
                m.cooldown
                  ? `, about ${m.cooldown} s apart at the shortest`
                  : ''
              }${m.spellIds.length > 1 ? ` (spell IDs ${m.spellIds.join(', ')})` : ''}. Click to hide or show.`}
              className={`flex items-center gap-x-1 rounded-full border px-2 py-0.5 ${
                hidden.has(m.spellId)
                  ? 'border-card text-foreground/50'
                  : 'border-foreground/40 text-foreground-lighter'
              }`}
            >
              <SpellIcon spellId={m.spellId} />
              {m.name || `Spell ${m.spellId}`}
            </button>
          );
        })}
        <span className="ml-auto text-foreground">
          Rankings from {dateTime(data.at)}
        </span>
      </div>

      <div
        role="table"
        aria-label={`Top ${unit} logs`}
        className="grid grid-cols-[28px_minmax(140px,180px)_70px_48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
      >
        <div role="row" className="contents">
          <span role="columnheader" aria-sort={ariaSort(sort, 'rank')}>
            <SortHeader
              label="#"
              column="rank"
              sort={sort}
              onSort={onSort}
              title="Sort by Warcraft Logs ranking"
            />
          </span>
          <span
            role="columnheader"
            aria-sort={ariaSort(sort, 'name', 'ilvl', 'date')}
            className="flex items-center gap-x-2"
          >
            <SortHeader
              label="Player"
              column="name"
              sort={sort}
              onSort={onSort}
            />
            <SortHeader
              label="iLvl"
              column="ilvl"
              sort={sort}
              onSort={onSort}
              title="Sort by item level"
            />
            <SortHeader
              label="Date"
              column="date"
              sort={sort}
              onSort={onSort}
              title="Sort by when the fight was"
            />
          </span>
          <span
            role="columnheader"
            aria-sort={ariaSort(sort, 'amount')}
            className="text-right"
          >
            <SortHeader
              label={unit}
              column="amount"
              sort={sort}
              onSort={onSort}
            />
          </span>
          <span
            role="columnheader"
            aria-sort={ariaSort(sort, 'duration')}
            className="text-right"
          >
            <SortHeader
              label="Time"
              column="duration"
              sort={sort}
              onSort={onSort}
            />
          </span>
          <div
            role="columnheader"
            aria-label="Casts on the fight clock"
            className="relative h-4 text-[10px] text-foreground"
          >
            {ticks(max).map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: `${(t / max) * 100}%` }}
              >
                {formatDuration(t)}
              </span>
            ))}
          </div>
          <span role="columnheader" aria-label="Actions" />
        </div>
        {rows.map((row) => (
          <div
            role="row"
            className="contents"
            key={`${row.code}:${row.fight}:${row.name}`}
          >
            <span role="cell" className="text-xs text-foreground text-right">
              {row.rank}
            </span>
            <span role="cell" className="min-w-0">
              <span
                className="block truncate text-sm font-semibold"
                style={{ color: classColor(data.specId) }}
                title={`${row.name}-${row.server} (${row.region})`}
              >
                {row.name}
              </span>
              <span className="block truncate text-[11px] text-foreground">
                {row.guild ?? row.server}
                {row.ilvl ? ` · ${row.ilvl}` : ''}
                {row.startTime ? ` · ${shortDate(row.startTime)}` : ''}
              </span>
            </span>
            <span role="cell" className="text-sm text-right tabular-nums">
              {compact(row.amount)}
            </span>
            <span
              role="cell"
              className="text-xs text-right tabular-nums text-foreground"
            >
              {formatDuration(row.duration)}
            </span>
            <span role="cell" className="min-w-0">
              <Lane
                row={row}
                max={max}
                shown={shown}
                onRetry={(r) => retry([r])}
              />
            </span>
            <span role="cell" className="flex items-center gap-x-1">
              <button
                type="button"
                onClick={() => onRace(row, data)}
                aria-label={`Race me against ${row.name}'s pull in Time trial`}
                className={`flex items-center gap-x-1 rounded border border-brand/60 px-2 py-1 text-xs text-brand hover:bg-brand/10 ${FOCUS_RING}`}
              >
                <Timer size={12} /> Race me
              </button>
              <button
                type="button"
                title="Open on Warcraft Logs"
                aria-label={`Open ${row.name}'s log on Warcraft Logs`}
                onClick={() =>
                  ipc.sendMessage('openURL', [
                    wclUrl(row.code, row.fight, data.metric),
                  ])
                }
                className={`flex items-center rounded border border-card p-1.5 text-foreground hover:bg-card/50 hover:text-foreground-lighter ${FOCUS_RING}`}
              >
                <ExternalLink size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TopLogsPage = ({
  videoState,
  setAppState,
  persistentProgressRef,
}: {
  videoState: RendererVideo[];
  setAppState: Dispatch<SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
}) => {
  // Opens our raiders' recordings from the Time trial (in this tab's watch tab).
  const watcher = useRecordingWatch(
    videoState,
    setAppState,
    persistentProgressRef,
  );
  const [season, setSeason] = React.useState<SeasonBoss[] | null>(null);
  const [info, setInfo] = React.useState<Info | null>(null);
  const [infoError, setInfoError] = React.useState('');
  const [picked, setChoice] = React.useState<Choice>(() => {
    const saved = loadChoice();
    return {
      encounterId: saved.encounterId ?? 0,
      difficultyId: saved.difficultyId === 15 ? 15 : 16,
      specId: saved.specId && spec(saved.specId) ? saved.specId : 71,
      region: saved.region ?? 'world',
    };
  });
  const [race, setRace] = React.useState<{
    row: RankRow;
    data: Rankings;
  } | null>(null);

  React.useEffect(() => {
    loadSeason().then((list) => setSeason(zoneBosses(list)));
    call<Info>({ action: 'topLogs' }).then((r) => {
      if (r.ok) setInfo(r.data);
      else setInfoError(r.error);
    });
  }, []);

  // First visit (or a new tier): the raid's last boss, usually the one
  // being progressed.
  const choice: Choice =
    season?.length && !season.some((b) => b.encounterId === picked.encounterId)
      ? { ...picked, encounterId: season[season.length - 1].encounterId }
      : picked;

  const { encounterId, difficultyId, specId, region } = choice;
  React.useEffect(() => {
    try {
      localStorage.setItem(
        SAVED,
        JSON.stringify({ encounterId, difficultyId, specId, region }),
      );
    } catch {
      // Not remembered.
    }
  }, [encounterId, difficultyId, specId, region]);

  const boss = season?.find((b) => b.encounterId === choice.encounterId);
  useTabTitle(
    race
      ? `Race ${race.row.name}`
      : boss
        ? `Top ${spec(choice.specId)?.name ?? ''} · ${boss.name}`
        : undefined,
  );
  const regions = info?.regions ?? ['world'];
  const set = (patch: Partial<Choice>) => {
    setRace(null);
    setChoice({ ...choice, ...patch });
  };

  return (
    <WatchContext.Provider value={watcher}>
      <div className="flex flex-col w-full h-full bg-background-higher text-foreground-lighter pt-[32px]">
        <div className="flex items-center gap-x-3 px-4 py-2 border-b border-card min-h-[52px] flex-wrap gap-y-2">
          {race ? (
            <button
              type="button"
              onClick={() => setRace(null)}
              className="flex items-center gap-x-1 text-sm text-foreground-lighter hover:text-brand"
            >
              <ArrowLeft size={16} /> Top logs
            </button>
          ) : (
            <span className="font-display text-lg font-bold mr-1">
              Top logs
            </span>
          )}
          <div className="flex items-center gap-x-1.5" role="listbox">
            {(season ?? []).map((b) => (
              <BossButton
                key={b.encounterId}
                encounterId={b.encounterId}
                name={b.name}
                title={b.name}
                picked={b.encounterId === choice.encounterId}
                enabled
                onClick={() => set({ encounterId: b.encounterId })}
              />
            ))}
          </div>
          <div className="flex rounded-lg border border-card bg-background/60 p-0.5">
            {(
              [
                [15, 'Heroic'],
                [16, 'Mythic'],
              ] as [number, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => set({ difficultyId: id })}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  choice.difficultyId === id
                    ? `bg-card ${MODE_TEXT[label]}`
                    : 'text-foreground hover:text-foreground-lighter'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <SpecPicker
            specId={choice.specId}
            onPick={(id) => set({ specId: id })}
          />
          {regions.length > 1 && (
            <div className="flex rounded-lg border border-card bg-background/60 p-0.5">
              {regions.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set({ region: r })}
                  className={`rounded-md px-3 py-1 text-sm ${
                    choice.region === r
                      ? 'bg-card text-foreground-lighter'
                      : 'text-foreground hover:text-foreground-lighter'
                  }`}
                >
                  {r === 'world' ? 'World' : r}
                </button>
              ))}
            </div>
          )}
          {info?.status.running && (
            <span className="flex items-center gap-x-1 text-xs text-foreground">
              <RefreshCw size={12} className="animate-spin" /> Daily crawl{' '}
              {info.status.done}/{info.status.total}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {infoError && (
            <p className="text-sm text-red-400">
              {/Unknown API route/.test(infoError)
                ? 'Top logs need the 1.9.96 guild server: run update-server.cmd.'
                : infoError}
            </p>
          )}
          {info && !info.configured && (
            <p className="text-sm text-foreground">
              Top logs need the Warcraft Logs API keys in the server&apos;s .env
              (the same ones the recruiting page uses).
            </p>
          )}
          {!infoError && info?.configured && season && !season.length && (
            <p className="text-sm text-foreground flex items-center gap-x-2">
              <Flag size={14} /> No raid bosses yet: set GUILD_CLOUD_RAID_ZONE
              in the server&apos;s .env.
            </p>
          )}
          {!infoError &&
            info?.configured &&
            choice.encounterId > 0 &&
            (race ? (
              <TimeTrial
                them={race.row}
                specId={race.data.specId}
                metric={race.data.metric}
                cooldowns={race.data.cooldowns}
                encounterId={race.data.encounterId}
                difficultyId={race.data.difficultyId}
                bossName={boss?.name ?? ''}
              />
            ) : (
              <RankingsGrid
                key={`${choice.encounterId}:${choice.difficultyId}:${choice.specId}:${choice.region}`}
                choice={choice}
                onRace={(row, data) => setRace({ row, data })}
              />
            ))}
        </div>
      </div>
    </WatchContext.Provider>
  );
};

export default TopLogsPage;
