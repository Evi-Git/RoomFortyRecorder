import React, { Dispatch, RefObject, SetStateAction } from 'react';
import { ArrowLeft, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { AppState, Pages, RendererVideo, StorageFilter } from 'main/types';
import { VideoCategory } from 'types/VideoCategory';
import {
  getCategoryIndex,
  getSpecClass,
  getWoWClassColor,
} from './rendererutils';
import { setConfigValue } from './useSettings';
import { TabContext, TabsContext, useTabTitle } from './tabs/tabs';
import AbilityName from './AbilityCard';
import {
  AuraView,
  CastTimeline,
  TimelineData,
  WatchHint,
} from './LogsTimeline';
import LogsTrends from './LogsTrends';
import LogsExplorer, { Watch } from './logs/LogsExplorer';
import NightPicker from './logs/NightPicker';
import BossStrip from './logs/BossStrip';
import type { PullMeta } from './logs/store';

/**
 * [RoomFortyRecorder] Logs: meters for raid pulls, worked out by the app
 * from every combat log line (src/parsing/PullMeters.ts) and stored by the
 * guild server. Damage done, healing, damage taken and damage prevented
 * per raider, with ability breakdowns, any slice of the fight (drag on the
 * chart), and several pulls side by side.
 */

const ipc = window.electron.ipcRenderer;
type Response<T> = { ok: true; data: T } | { ok: false; error: string };
const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

// [bucket, amount, hits, crits, casts, overheal]
type Bucket = [number, number, number, number, number, number];
type RawAbility = {
  spellId: number;
  name: string;
  total: number;
  hits: number;
  crits: number;
  casts: number;
  overheal?: number;
  b: Bucket[];
};
type RawRow = {
  name: string;
  specId: number;
  total: number;
  overheal?: number;
  absorbs?: number;
  abilities: RawAbility[];
};
export type MetersData = {
  v: 2;
  bucketSeconds: number;
  duration: number;
  damage: RawRow[];
  healing: RawRow[];
  taken: RawRow[];
  mitigation: RawRow[];
  // 1.9.31+: cooldown casts, buffs, Bloodlust and boss debuffs.
  casts?: TimelineData['casts'];
  buffs?: TimelineData['buffs'];
  raidBuffs?: TimelineData['raidBuffs'];
  bossDebuffs?: TimelineData['bossDebuffs'];
  // Added by the server.
  pull?: PullRef & { id: string; pullNumber?: number; result?: string };
  deaths?: { t: number; name: string; spell: string | null }[];
};

/* ------------------------------------------------------------------ */
/* Opening a recording at a moment                                     */
/* ------------------------------------------------------------------ */

export type PullRef = {
  encounterId: number;
  difficultyId: number;
  startedAt: number;
};

type Watcher = {
  /** Opens a raider's recording (anyone's if null) `seconds` into the pull. */
  open: (pull: PullRef, name: string | null, seconds: number) => boolean;
  has: (pull: PullRef, name: string | null) => boolean;
  /** Whose recording `open` would pick (theirs, else anyone's), or null if none. */
  owner: (pull: PullRef, name: string | null) => string | null;
};

const WATCH_LEAD_SECONDS = 5;
const VIDEO_MATCH_MS = 2 * 60 * 1000;

export const WatchContext = React.createContext<Watcher | null>(null);

/** Where the player starts when the recording opens. */
const seekTo = (ref: RefObject<number>, seconds: number) => {
  (ref as { current: number }).current = Math.max(0, seconds);
};

/** A Watcher over this PC's (and the cloud's) raid recordings. */
export const useRecordingWatch = (
  videoState: RendererVideo[],
  setAppState: Dispatch<SetStateAction<AppState>>,
  persistentProgressRef: RefObject<number>,
): Watcher => {
  const tabs = React.useContext(TabsContext);
  const tab = React.useContext(TabContext);
  return React.useMemo(() => {
    const find = (pull: PullRef, name: string | null) => {
      const candidates = videoState.filter(
        (video) =>
          video.category === VideoCategory.Raids &&
          video.encounterID === pull.encounterId &&
          video.difficultyID === pull.difficultyId &&
          typeof video.start === 'number' &&
          Math.abs(video.start - pull.startedAt) < VIDEO_MATCH_MS &&
          (!name || video.player?._name === name),
      );
      // A local copy first (instant), then the closest start.
      candidates.sort(
        (a, b) =>
          Number(a.cloud) - Number(b.cloud) ||
          Math.abs((a.start as number) - pull.startedAt) -
            Math.abs((b.start as number) - pull.startedAt),
      );
      return candidates[0];
    };
    return {
      has: (pull, name) => Boolean(find(pull, name) ?? find(pull, null)),
      owner: (pull, name) => {
        const video = find(pull, name) ?? find(pull, null);
        return video ? (video.player?._name ?? '') : null;
      },
      open: (pull, name, seconds) => {
        // Their recording, else anyone's.
        const video = find(pull, name) ?? find(pull, null);
        if (!video) return false;
        setConfigValue(
          'selectedCategory',
          getCategoryIndex(VideoCategory.Raids),
        );
        // [RoomFortyRecorder] With tabs, the recording opens in this tab's
        // watch tab, so this page stays where it is.
        if (tabs && tab.id) {
          tabs.openWatch(
            tab.id,
            {
              page: Pages.None,
              category: VideoCategory.Raids,
              selectedVideos: [video],
            },
            Math.max(0, seconds - WATCH_LEAD_SECONDS),
          );
          return true;
        }
        seekTo(persistentProgressRef, seconds - WATCH_LEAD_SECONDS);
        setAppState((prev) => ({
          ...prev,
          page: Pages.None,
          category: VideoCategory.Raids,
          selectedVideos: [video],
          multiPlayerMode: false,
          playing: false,
          videoFilterTags: [],
          storageFilter: StorageFilter.BOTH,
          dateRangeFilter: { startDate: null, endDate: null },
        }));
        return true;
      },
    };
  }, [videoState, setAppState, persistentProgressRef, tabs, tab.id]);
};
type Kind = 'damage' | 'healing' | 'taken' | 'mitigation';

// A row or ability added up over a slice of the fight.
type SliceAbility = {
  spellId: number;
  name: string;
  total: number;
  hits: number;
  crits: number;
  casts: number;
  overheal: number;
};
type SliceRow = {
  name: string;
  specId: number;
  total: number;
  overheal: number;
  abilities: SliceAbility[];
  series: number[];
};
type Range = { from: number; to: number } | null; // buckets, `to` exclusive

const KINDS: { key: Kind; label: string; rate: string; help: string }[] = [
  { key: 'damage', label: 'Damage done', rate: 'DPS', help: '' },
  {
    key: 'healing',
    label: 'Healing',
    rate: 'HPS',
    help: 'Effective healing; shields count for whoever cast them.',
  },
  { key: 'taken', label: 'Damage taken', rate: 'DTPS', help: '' },
  {
    key: 'mitigation',
    label: 'Mitigations',
    rate: 'PPS',
    help: 'An estimate of damage kept off raiders by cooldowns cast on them (Pain Suppression, Ironbark, Blessing of Sacrifice, Power Word: Barrier, Time Dilation, Zephyr, Anti-Magic Zone, Spirit Link). Shields are in Healing.',
  },
];

const BRAND = 'hsl(var(--brand))';
const MUTED = 'hsl(30 8% 45%)';

export const compactNumber = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
        : String(Math.round(n));

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const classColor = (specId: number) =>
  getWoWClassColor(getSpecClass(specId)) || 'hsl(var(--foreground-lighter))';

const bucketsOf = (data: MetersData) =>
  Math.max(1, Math.ceil(data.duration / data.bucketSeconds));

/** Seconds the slice covers (the last bucket can be short). */
const sliceSeconds = (data: MetersData, range: Range) => {
  const n = bucketsOf(data);
  const from = range?.from ?? 0;
  const to = range?.to ?? n;
  return Math.max(
    1,
    Math.min(data.duration, to * data.bucketSeconds) -
      from * data.bucketSeconds,
  );
};

/** Rows for one kind, added up over a slice (all of it when null). */
const sliceRows = (data: MetersData, kind: Kind, range: Range): SliceRow[] => {
  const n = bucketsOf(data);
  const from = range?.from ?? 0;
  const to = range?.to ?? n;
  return (data[kind] ?? [])
    .map((row) => {
      const series = new Array(n).fill(0);
      const abilities = row.abilities
        .map((a) => {
          const s: SliceAbility = {
            spellId: a.spellId,
            name: a.name,
            total: 0,
            hits: 0,
            crits: 0,
            casts: 0,
            overheal: 0,
          };
          a.b.forEach(([bucket, amount, hits, crits, casts, overheal]) => {
            if (bucket < n) series[bucket] += amount;
            if (bucket < from || bucket >= to) return;
            s.total += amount;
            s.hits += hits;
            s.crits += crits;
            s.casts += casts;
            s.overheal += overheal;
          });
          return s;
        })
        .filter((a) => a.total > 0 || a.casts > 0)
        .sort((x, y) => y.total - x.total);
      return {
        name: row.name,
        specId: row.specId,
        total: abilities.reduce((t, a) => t + a.total, 0),
        overheal: abilities.reduce((t, a) => t + a.overheal, 0),
        abilities,
        series,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
};

const sumSeries = (rows: SliceRow[], n: number) => {
  const out = new Array(n).fill(0);
  rows.forEach((r) =>
    r.series.forEach((v, i) => {
      out[i] += v;
    }),
  );
  return out;
};

/**
 * Per-second rate over the pull, one line per series. Hover for values;
 * drag across it to pick a slice of the fight.
 */
const OverTime = ({
  series,
  bucketSeconds,
  rateLabel,
  range,
  onRange,
  onPick,
  markers = [],
  bands = [],
}: {
  series: { name: string; values: number[]; color: string; dashed?: boolean }[];
  bucketSeconds: number;
  rateLabel: string;
  range?: Range;
  onRange?: (range: Range) => void;
  // A click (no drag) on a moment: seconds into the pull.
  onPick?: (seconds: number) => void;
  // Deaths (seconds) and Bloodlust windows (seconds).
  markers?: { t: number; label: string }[];
  bands?: [number, number][];
}) => {
  const [hover, setHover] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<{ a: number; b: number } | null>(null);
  // Drawn at its real width so text stays 11px whatever the window size.
  const box = React.useRef<HTMLDivElement>(null);
  const [W, setW] = React.useState(640);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setW(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = 200;
  const left = 48;
  const right = 10;
  const top = 10;
  const bottom = 26;
  const count = Math.max(1, ...series.map((s) => s.values.length));
  const rates = series.map((s) => s.values.map((v) => v / bucketSeconds));
  const max = Math.max(1, ...rates.flat());
  const span = W - left - right;
  // Bucket i spans [x(i), x(i + 1)); lines go through bucket middles.
  const x = (i: number) => left + (i / count) * span;
  const mid = (i: number) => x(i + 0.5);
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const duration = count * bucketSeconds;

  const bucketAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    return Math.min(
      count - 1,
      Math.max(0, Math.floor(((px - left) / span) * count)),
    );
  };

  const shown = drag
    ? { from: Math.min(drag.a, drag.b), to: Math.max(drag.a, drag.b) + 1 }
    : range;

  return (
    <div className="relative select-none" ref={box}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className={`block ${onRange ? 'cursor-crosshair' : ''}`}
        role="img"
        aria-label={`${rateLabel} over the pull${onRange ? '; drag to pick a slice' : ''}`}
        onMouseMove={(e) => {
          const i = bucketAt(e);
          setHover(i);
          if (drag) setDrag({ ...drag, b: i });
        }}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          if (!onRange) return;
          const i = bucketAt(e);
          setDrag({ a: i, b: i });
        }}
        onMouseUp={() => {
          if (!drag || !onRange) return;
          const from = Math.min(drag.a, drag.b);
          const to = Math.max(drag.a, drag.b) + 1;
          setDrag(null);
          if (drag.a === drag.b) {
            // A click: open a recording there (the slice stays).
            if (onPick) onPick((drag.a + 0.5) * bucketSeconds);
            else onRange(null);
            return;
          }
          onRange({ from, to });
        }}
      >
        {bands.map(([s, e]) => (
          <rect
            key={s}
            x={left + (s / duration) * span}
            y={top}
            width={Math.max(2, ((e - s) / duration) * span)}
            height={H - top - bottom}
            fill="hsl(200 70% 55% / 0.12)"
          />
        ))}
        {markers.map((m) => (
          <line
            key={`${m.label}-${m.t}`}
            x1={left + (Math.min(duration, m.t) / duration) * span}
            x2={left + (Math.min(duration, m.t) / duration) * span}
            y1={top}
            y2={H - bottom}
            stroke="rgb(248 113 113 / 0.55)"
            strokeDasharray="3 3"
          />
        ))}
        {shown && (
          <rect
            x={x(shown.from)}
            y={top}
            width={Math.max(2, x(shown.to) - x(shown.from))}
            height={H - top - bottom}
            fill="hsl(var(--brand) / 0.12)"
            stroke="hsl(var(--brand) / 0.5)"
          />
        )}
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={W - right}
              y1={y(v)}
              y2={y(v)}
              stroke="hsl(var(--card))"
            />
            <text
              x={left - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="hsl(var(--foreground))"
            >
              {compactNumber(v)}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={left + f * span}
            y={H - 8}
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            fontSize="11"
            fill="hsl(var(--foreground))"
          >
            {mmss(f * duration)}
          </text>
        ))}
        {rates.map((values, si) => (
          <polyline
            key={series[si].name}
            fill="none"
            stroke={series[si].color}
            strokeWidth="2"
            strokeDasharray={series[si].dashed ? '4 3' : undefined}
            strokeLinejoin="round"
            points={values.map((v, i) => `${mid(i)},${y(v)}`).join(' ')}
          />
        ))}
        {hover !== null && !drag && (
          <line
            x1={mid(hover)}
            x2={mid(hover)}
            y1={top}
            y2={H - bottom}
            stroke="hsl(var(--foreground) / 0.5)"
          />
        )}
      </svg>
      {hover !== null && !drag && (
        <div
          className="absolute top-1 pointer-events-none rounded-md border border-card bg-background px-2 py-1 text-xs shadow-lg"
          style={{
            left: `${(mid(hover) / W) * 100}%`,
            transform:
              mid(hover) > W / 2
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          <div className="text-foreground">
            {mmss(hover * bucketSeconds)}–{mmss((hover + 1) * bucketSeconds)}
          </div>
          {markers
            .filter(
              (m) =>
                m.t >= hover * bucketSeconds &&
                m.t < (hover + 1) * bucketSeconds,
            )
            .map((m) => (
              <div key={`${m.label}-${m.t}`} className="text-red-400">
                {m.label}
              </div>
            ))}
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center gap-x-1.5">
              <span
                className="inline-block w-2.5 h-0.5"
                style={{ background: s.color }}
              />
              <span className="text-foreground-lighter">{s.name}</span>
              <span className="ml-auto pl-2 tabular-nums text-foreground-lighter">
                {compactNumber(rates[si][hover] ?? 0)} {rateLabel}
              </span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground mt-1">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-x-1.5">
              <span
                className="inline-block w-3.5 h-0.5"
                style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const Bar = ({
  value,
  max,
  color,
  height = 12,
}: {
  value: number;
  max: number;
  color: string;
  height?: number;
}) => (
  <span
    className="rounded-r-[4px] shrink-0"
    style={{
      width: `${(value / Math.max(1, max)) * 80}%`,
      minWidth: value ? 3 : 0,
      height,
      background: color,
      opacity: 0.85,
    }}
  />
);

const Breakdown = ({
  row,
  kind,
  rows,
  data,
  range,
  onRange,
  encounterId,
  difficultyId,
  onBack,
  onPick,
  markers,
  bands,
}: {
  row: SliceRow;
  kind: Kind;
  rows: SliceRow[];
  data: MetersData;
  range: Range;
  onRange: (r: Range) => void;
  encounterId?: number;
  difficultyId?: number;
  onBack: () => void;
  onPick?: (seconds: number) => void;
  markers?: { t: number; label: string }[];
  bands?: [number, number][];
}) => {
  const meta = KINDS.find((k) => k.key === kind)!;
  const seconds = sliceSeconds(data, range);
  const top = Math.max(1, ...row.abilities.map((a) => a.total));
  const n = bucketsOf(data);
  const avg = sumSeries(rows, n).map((v) => v / Math.max(1, rows.length));
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
        >
          <ArrowLeft size={14} /> All raiders
        </button>
        <span
          className="font-display text-lg font-semibold"
          style={{ color: classColor(row.specId) }}
        >
          {row.name}
        </span>
        <span className="text-sm text-foreground">{meta.label}</span>
        <span className="ml-auto flex gap-x-5 text-right">
          <span className="flex flex-col">
            <span className="text-[11px] text-foreground">{meta.rate}</span>
            <span className="font-semibold tabular-nums text-foreground-lighter">
              {compactNumber(row.total / seconds)}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[11px] text-foreground">Total</span>
            <span className="font-semibold tabular-nums text-foreground-lighter">
              {compactNumber(row.total)}
            </span>
          </span>
          {kind === 'healing' && (
            <span className="flex flex-col">
              <span className="text-[11px] text-foreground">Overheal</span>
              <span className="font-semibold tabular-nums text-foreground-lighter">
                {row.total + row.overheal
                  ? `${Math.round((row.overheal / (row.total + row.overheal)) * 100)}%`
                  : '–'}
              </span>
            </span>
          )}
        </span>
      </div>
      <OverTime
        bucketSeconds={data.bucketSeconds}
        rateLabel={meta.rate}
        range={range}
        onRange={onRange}
        onPick={onPick}
        markers={markers}
        bands={bands}
        series={[
          { name: row.name, values: row.series, color: classColor(row.specId) },
          {
            name: 'Raid average per raider',
            values: avg,
            color: MUTED,
            dashed: true,
          },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card">
            <tr>
              <th className="px-2 py-1 text-left font-normal">Ability</th>
              <th className="px-2 py-1 text-left font-normal w-[38%]">
                {meta.label}
              </th>
              <th className="px-2 py-1 text-right font-normal">{meta.rate}</th>
              {(kind === 'damage' || kind === 'healing') && (
                <th className="px-2 py-1 text-right font-normal">Casts</th>
              )}
              <th className="px-2 py-1 text-right font-normal">Hits</th>
              {kind !== 'mitigation' && (
                <th className="px-2 py-1 text-right font-normal">Crit</th>
              )}
              {kind === 'healing' && (
                <th className="px-2 py-1 text-right font-normal">Overheal</th>
              )}
              <th className="px-2 py-1 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody>
            {row.abilities.map((a) => (
              <tr
                key={a.spellId}
                className="border-b border-card/40 hover:bg-card/30"
              >
                <td className="px-2 py-1 whitespace-nowrap">
                  <AbilityName
                    name={a.name}
                    spellId={a.spellId > 1 ? a.spellId : null}
                    encounterId={kind === 'taken' ? encounterId : undefined}
                    difficultyId={difficultyId}
                    className="text-foreground-lighter"
                  />
                </td>
                <td className="px-2 py-1">
                  <span className="flex items-center gap-x-2">
                    <Bar
                      value={a.total}
                      max={top}
                      color={classColor(row.specId)}
                      height={10}
                    />
                    <span className="text-xs tabular-nums text-foreground">
                      {compactNumber(a.total)}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {compactNumber(a.total / seconds)}
                </td>
                {(kind === 'damage' || kind === 'healing') && (
                  <td className="px-2 py-1 text-right tabular-nums text-foreground">
                    {a.casts || '–'}
                  </td>
                )}
                <td className="px-2 py-1 text-right tabular-nums text-foreground">
                  {a.hits}
                </td>
                {kind !== 'mitigation' && (
                  <td className="px-2 py-1 text-right tabular-nums text-foreground">
                    {a.hits ? `${Math.round((a.crits / a.hits) * 100)}%` : '–'}
                  </td>
                )}
                {kind === 'healing' && (
                  <td className="px-2 py-1 text-right tabular-nums text-foreground">
                    {a.overheal
                      ? `${Math.round((a.overheal / (a.overheal + a.total)) * 100)}%`
                      : '–'}
                  </td>
                )}
                <td className="px-2 py-1 text-right tabular-nums text-foreground">
                  {row.total
                    ? `${((a.total / row.total) * 100).toFixed(1)}%`
                    : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const KindTabs = ({
  kind,
  setKind,
}: {
  kind: Kind;
  setKind: (k: Kind) => void;
}) => (
  <div className="flex rounded-md border border-card overflow-hidden">
    {KINDS.map((k) => (
      <button
        key={k.key}
        type="button"
        onClick={() => setKind(k.key)}
        title={k.help || undefined}
        className={`px-3 h-8 text-xs ${
          kind === k.key
            ? 'bg-brand text-background font-semibold'
            : 'text-foreground-lighter hover:bg-card/50'
        }`}
      >
        {k.label}
      </button>
    ))}
  </div>
);

/** The meters for one pull. */
const PullMeters = ({
  pullId,
  encounterId,
  difficultyId,
}: {
  pullId: string;
  encounterId?: number;
  difficultyId?: number;
}) => {
  const [data, setData] = React.useState<MetersData | null>(null);
  const [error, setError] = React.useState('');
  const [loadedId, setLoadedId] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('damage');
  // The meters (kind), or the cast timeline, or buffs and debuffs.
  const [extra, setExtra] = React.useState<'casts' | 'buffs' | null>(null);
  const [who, setWho] = React.useState<string | null>(null);
  const [range, setRange] = React.useState<Range>(null);
  const [notice, setNotice] = React.useState('');
  const watcher = React.useContext(WatchContext);

  React.useEffect(() => {
    let cancelled = false;
    call<MetersData>({ action: 'meters', id: pullId }).then((response) => {
      if (cancelled) return;
      setLoadedId(pullId);
      if (!response.ok) {
        setError(response.error);
        setData(null);
        return;
      }
      setError('');
      setData(response.data);
    });
    return () => {
      cancelled = true;
    };
  }, [pullId]);

  if (loadedId !== pullId) {
    return <p className="text-sm text-foreground">Loading meters…</p>;
  }
  if (!data || data.v !== 2) {
    return (
      <p className="text-sm text-foreground max-w-[720px]">
        {error ||
          'No meters for this pull yet: they come from the app (1.9.30 or newer).'}
      </p>
    );
  }

  const meta = KINDS.find((k) => k.key === kind)!;
  const rows = sliceRows(data, kind, range);
  const seconds = sliceSeconds(data, range);
  const selected = rows.find((r) => r.name === who) ?? null;
  const raidTotal = rows.reduce((n, r) => n + r.total, 0);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const n = bucketsOf(data);

  // Recordings: open one at a moment of the pull.
  const pullRef = data.pull ?? null;
  const canWatch = Boolean(watcher && pullRef && watcher.has(pullRef, null));
  const watchAt = (name: string | null, at: number) => {
    if (!watcher || !pullRef) return;
    if (!watcher.open(pullRef, name, at)) {
      setNotice(
        `No recording of this pull${name ? ` from ${name}` : ''} here.`,
      );
    }
  };
  const markers = (data.deaths ?? []).map((d) => ({
    t: d.t,
    label: `${d.name} died${d.spell ? ` (${d.spell})` : ''}`,
  }));
  const bands = (data.raidBuffs ?? []).flatMap((b) => b.intervals);
  const secondsRange = range
    ? {
        from: range.from * data.bucketSeconds,
        to: Math.min(data.duration, range.to * data.bucketSeconds),
      }
    : null;
  const tab = (key: 'casts' | 'buffs', label: string) => (
    <button
      type="button"
      onClick={() => setExtra(extra === key ? null : key)}
      className={`px-3 h-8 text-xs rounded-md border border-card ${
        extra === key
          ? 'bg-brand text-background font-semibold'
          : 'text-foreground-lighter hover:bg-card/50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <KindTabs
          kind={extra ? ('' as Kind) : kind}
          setKind={(k) => {
            setKind(k);
            setExtra(null);
          }}
        />
        {tab('casts', 'Casts')}
        {tab('buffs', 'Buffs & debuffs')}
        {!extra && (
          <span className="text-sm text-foreground">
            Raid {meta.rate}{' '}
            <span className="font-semibold text-foreground-lighter tabular-nums">
              {compactNumber(raidTotal / seconds)}
            </span>{' '}
            · total {compactNumber(raidTotal)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-x-2 text-xs text-foreground">
          {range ? (
            <>
              Slice {mmss(range.from * data.bucketSeconds)}–
              {mmss(Math.min(data.duration, range.to * data.bucketSeconds))}
              <button
                type="button"
                onClick={() => setRange(null)}
                className="text-brand hover:underline"
              >
                Whole pull
              </button>
            </>
          ) : (
            'Drag across the chart to look at a slice of the fight'
          )}
        </span>
      </div>
      <div className="flex items-center gap-x-3 flex-wrap">
        {watcher && pullRef && <WatchHint can={canWatch} />}
        {notice && <span className="text-xs text-yellow-400">{notice}</span>}
      </div>
      {!extra && meta.help && (
        <p className="text-xs text-foreground m-0">{meta.help}</p>
      )}

      {extra === 'casts' && (
        <CastTimeline data={data} range={secondsRange} onWatch={watchAt} />
      )}
      {extra === 'buffs' && (
        <AuraView data={data} range={secondsRange} onWatch={watchAt} />
      )}
      {extra ? null : selected ? (
        <Breakdown
          row={selected}
          kind={kind}
          rows={rows}
          data={data}
          range={range}
          onRange={setRange}
          encounterId={encounterId}
          difficultyId={difficultyId}
          onBack={() => setWho(null)}
          onPick={canWatch ? (t) => watchAt(selected.name, t) : undefined}
          markers={markers}
          bands={bands}
        />
      ) : (
        <>
          <div className="rounded-md border border-card bg-background/40 p-3">
            <OverTime
              bucketSeconds={data.bucketSeconds}
              rateLabel={meta.rate}
              range={range}
              onRange={setRange}
              onPick={canWatch ? (t) => watchAt(null, t) : undefined}
              markers={markers}
              bands={bands}
              series={[
                { name: 'Raid', values: sumSeries(rows, n), color: BRAND },
              ]}
            />
          </div>
          {!rows.length ? (
            <p className="text-sm text-foreground">Nothing in this slice.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-foreground border-b border-card">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">Raider</th>
                    <th className="px-2 py-1 text-left font-normal w-[50%]">
                      {meta.label}
                    </th>
                    <th className="px-2 py-1 text-right font-normal">
                      {meta.rate}
                    </th>
                    <th className="px-2 py-1 text-right font-normal">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.name}
                      className="border-b border-card/40 hover:bg-card/30"
                    >
                      <td className="px-2 py-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setWho(r.name)}
                          className="font-semibold hover:underline"
                          style={{ color: classColor(r.specId) }}
                          title="Show their abilities"
                        >
                          {r.name}
                        </button>
                      </td>
                      <td className="px-2 py-1">
                        <span className="flex items-center gap-x-2">
                          <Bar
                            value={r.total}
                            max={max}
                            color={classColor(r.specId)}
                          />
                          <span className="text-xs tabular-nums text-foreground">
                            {compactNumber(r.total)}
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold text-foreground-lighter">
                        {compactNumber(r.total / seconds)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-foreground">
                        {raidTotal
                          ? `${((r.total / raidTotal) * 100).toFixed(1)}%`
                          : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PullMeters;

/* ------------------------------------------------------------------ */
/* Several pulls side by side                                          */
/* ------------------------------------------------------------------ */

type ComparePull = { id: string; label: string; result: string };

/**
 * Each raider's rate pull by pull for the chosen pulls of one boss, with
 * their average and best; shading is each raider against their own best.
 */
const PullComparison = ({ pulls }: { pulls: ComparePull[] }) => {
  const [kind, setKind] = React.useState<Kind>('damage');
  const [loaded, setLoaded] = React.useState<Record<string, MetersData | null>>(
    {},
  );

  React.useEffect(() => {
    let cancelled = false;
    pulls.forEach((p) => {
      if (p.id in loaded) return;
      call<MetersData>({ action: 'meters', id: p.id }).then((response) => {
        if (cancelled) return;
        setLoaded((prev) => ({
          ...prev,
          [p.id]: response.ok && response.data.v === 2 ? response.data : null,
        }));
      });
    });
    return () => {
      cancelled = true;
    };
    // `loaded` is checked, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulls]);

  const meta = KINDS.find((k) => k.key === kind)!;
  const ready = pulls.filter((p) => loaded[p.id]);
  const waiting = pulls.filter((p) => !(p.id in loaded)).length;
  const missing = pulls.filter((p) => p.id in loaded && !loaded[p.id]);

  // name -> per pull rate
  const byRaider = new Map<
    string,
    { specId: number; rates: (number | null)[] }
  >();
  ready.forEach((p, i) => {
    const data = loaded[p.id] as MetersData;
    const seconds = sliceSeconds(data, null);
    sliceRows(data, kind, null).forEach((r) => {
      const entry = byRaider.get(r.name) ?? {
        specId: r.specId,
        rates: new Array(ready.length).fill(null),
      };
      entry.rates[i] = r.total / seconds;
      byRaider.set(r.name, entry);
    });
  });
  const rows = [...byRaider.entries()]
    .map(([name, v]) => {
      const values = v.rates.filter((r): r is number => r !== null);
      return {
        name,
        specId: v.specId,
        rates: v.rates,
        avg: values.reduce((n, r) => n + r, 0) / Math.max(1, values.length),
        best: Math.max(0, ...values),
      };
    })
    .sort((a, b) => b.avg - a.avg);
  const raid = ready.map((p) => {
    const data = loaded[p.id] as MetersData;
    return (
      sliceRows(data, kind, null).reduce((n, r) => n + r.total, 0) /
      sliceSeconds(data, null)
    );
  });
  const raidMax = Math.max(1, ...raid);

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <KindTabs kind={kind} setKind={setKind} />
        <span className="text-sm text-foreground">
          {ready.length} pulls side by side
          {waiting ? ` · loading ${waiting}…` : ''}
          {missing.length
            ? ` · ${missing.length} without meters (${missing.map((p) => p.label).join(', ')})`
            : ''}
        </span>
      </div>
      {ready.length > 0 && (
        <>
          <div className="rounded-md border border-card bg-background/40 p-3">
            <h4 className="text-sm font-semibold text-foreground-lighter mb-2">
              Raid {meta.rate} per pull
            </h4>
            <div className="flex items-end gap-x-1.5 h-[120px]">
              {ready.map((p, i) => (
                <div
                  key={p.id}
                  className="flex-1 flex flex-col items-center justify-end h-full gap-y-1 min-w-0"
                  title={`${p.label}: ${compactNumber(raid[i])} ${meta.rate}`}
                >
                  <span className="text-[10px] tabular-nums text-foreground">
                    {compactNumber(raid[i])}
                  </span>
                  <div
                    className="w-full max-w-[36px] rounded-t-[4px]"
                    style={{
                      height: `${(raid[i] / raidMax) * 80}%`,
                      background: p.result === 'kill' ? '#4ade80' : BRAND,
                    }}
                  />
                  <span className="text-[10px] text-foreground truncate max-w-full">
                    {p.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm border-separate border-spacing-[2px]">
              <thead className="text-xs text-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-normal">Raider</th>
                  {ready.map((p) => (
                    <th
                      key={p.id}
                      className="px-2 py-1 text-right font-normal whitespace-nowrap"
                    >
                      {p.label}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-normal">Average</th>
                  <th className="px-2 py-1 text-right font-normal">Best</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td
                      className="px-2 py-1 whitespace-nowrap font-semibold"
                      style={{ color: classColor(r.specId) }}
                    >
                      {r.name}
                    </td>
                    {r.rates.map((rate, i) => (
                      <td
                        key={i}
                        className="px-2 py-1 text-right tabular-nums rounded-[3px] min-w-[60px]"
                        style={{
                          background:
                            rate && r.best
                              ? `hsl(var(--brand) / ${Math.max(0.04, (rate / r.best - 0.6) * 0.9)})`
                              : undefined,
                          color: rate
                            ? 'hsl(var(--foreground-lighter))'
                            : 'hsl(var(--foreground) / 0.4)',
                        }}
                      >
                        {rate ? compactNumber(rate) : '–'}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-foreground-lighter">
                      {compactNumber(r.avg)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-foreground">
                      {compactNumber(r.best)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-foreground m-0">
            {meta.rate} over each whole pull. Shading: each raider against their
            own best here (darker is closer). A dash: not in that pull, or
            nothing done.
          </p>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* The Logs page                                                       */
/* ------------------------------------------------------------------ */

type NightBoss = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  /** Best (lowest) boss % of the night's wipes; from the 1.9.94 server. */
  bestPercent?: number | null;
  firstKillAt?: number;
};
type NightPull = {
  id: string;
  pullNumber: number;
  totalPullNumber?: number;
  result: string;
  bossPercent: number | null;
  duration: number;
  source?: 'app' | 'wcl';
  hasFull?: boolean;
  startedAt?: number | null;
};

const pullResult = (p: NightPull) =>
  p.result === 'kill'
    ? 'Kill'
    : p.bossPercent !== null
      ? `${p.bossPercent}%`
      : 'Wipe';

/** State that lasts through a reload of this window (sessionStorage). */
const useSessionState = <T,>(key: string, initial: T) => {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  React.useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not kept: a reload starts fresh.
    }
  }, [key, value]);
  return [value, setValue] as const;
};

/**
 * Logs: browse a night's pulls and their meters; tick several pulls of a
 * boss to see them side by side.
 */
export const LogsView = () => {
  const watcher = React.useContext(WatchContext);
  const [nights, setNights] = React.useState<
    { night: string; bosses: NightBoss[] }[] | null
  >(null);
  // Kept for this window so a reload (Ctrl+R) opens the same pulls.
  const [night, setNight] = useSessionState('rf-logs-night', '');
  const [bosses, setBosses] = React.useState<
    (NightBoss & { pullsList: NightPull[] })[] | null
  >(null);
  const [bossKey, setBossKey] = useSessionState('rf-logs-boss', '');
  const [pullId, setPullId] = useSessionState('rf-logs-pull', '');
  const [picked, setPicked] = useSessionState<string[]>('rf-logs-picked', []);
  const anchorRef = React.useRef<string | null>(null);
  // The pull list folds to a thin strip so the logs get the width.
  const [listFolded, setListFolded] = React.useState(() => {
    try {
      return localStorage.getItem('rf-pulls-folded') === '1';
    } catch {
      return false;
    }
  });
  const foldList = (folded: boolean) => {
    setListFolded(folded);
    try {
      localStorage.setItem('rf-pulls-folded', folded ? '1' : '0');
    } catch {
      // Not remembered.
    }
  };
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    call<{ nights: { night: string; bosses: NightBoss[] }[] }>({
      action: 'nights',
    }).then((response) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setNights(response.data.nights);
      // A night kept from before a reload may have aged out.
      setNight((n) =>
        response.data.nights.some((x) => x.night === n)
          ? n
          : response.data.nights[0]?.night || '',
      );
    });
  }, []);

  React.useEffect(() => {
    if (!night) return undefined;
    let cancelled = false;
    call<{ bosses: (NightBoss & { pullsList: NightPull[] })[] }>({
      action: 'night',
      night,
    }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setBosses(response.data.bosses);
    });
    return () => {
      cancelled = true;
    };
  }, [night]);

  const keyOf = (b: NightBoss) => `${b.encounterId}:${b.difficultyId}`;
  const shownBosses = bosses ?? [];
  const boss =
    shownBosses.find((b) => keyOf(b) === bossKey) ??
    [...shownBosses].sort((a, b) => b.pulls - a.pulls)[0];
  const pulls = React.useMemo(
    () =>
      [...(boss?.pullsList ?? [])].sort((a, b) => b.pullNumber - a.pullNumber),
    [boss],
  );
  const comparing = React.useMemo(
    () =>
      pulls
        .filter((p) => picked.includes(p.id))
        .sort((a, b) => a.pullNumber - b.pullNumber)
        .map((p) => ({
          id: p.id,
          label: `Pull ${p.pullNumber}`,
          result: p.result,
        })),
    [pulls, picked],
  );

  // [RoomFortyRecorder] The tab is named after the pull (or pulls) shown.
  const titlePull = pulls.find((p) => p.id === pullId) ?? pulls[0];
  let tabTitle: string | undefined;
  if (boss && comparing.length > 1) {
    tabTitle = `${boss.encounterName} ×${comparing.length}`;
  } else if (boss && titlePull) {
    tabTitle = `${boss.encounterName} #${titlePull.pullNumber}`;
  }
  useTabTitle(tabTitle);

  if (error && !nights) return <p className="text-sm text-red-400">{error}</p>;
  if (!nights) return <p className="text-sm text-foreground">Loading…</p>;
  if (!nights.length) {
    return <p className="text-sm text-foreground">No pulls yet.</p>;
  }

  const pull = pulls.find((p) => p.id === pullId) ?? pulls[0];
  const metaOf = (p: NightPull): PullMeta => ({
    id: p.id,
    label: `Pull ${p.pullNumber}`,
    encounterId: boss?.encounterId ?? 0,
    difficultyId: boss?.difficultyId ?? 0,
    startedAt: p.startedAt ?? 0,
    result: p.result,
  });
  const shown: PullMeta[] =
    comparing.length >= 2
      ? pulls
          .filter((p) => picked.includes(p.id))
          .sort((a, b) => a.pullNumber - b.pullNumber)
          .map(metaOf)
      : pull && pull.source !== 'wcl'
        ? [metaOf(pull)]
        : [];
  const watch: Watch | null = watcher
    ? {
        can: shown.some((m) => watcher.has(m, null)),
        open: (m, name, seconds) => watcher.open(m, name, seconds),
      }
    : null;
  const reset = () => {
    setPullId('');
    setPicked([]);
  };
  // Excel-style picking: click picks one pull, Ctrl-click adds or removes a
  // pull, Shift-click picks every pull between the last one clicked and this
  // one (Ctrl+Shift adds that range to what's already picked).
  const choose = (id: string, e: React.MouseEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const current = picked.length >= 2 ? picked : pull ? [pull.id] : [];
    let next: string[];
    if (e.shiftKey) {
      const from = pulls.findIndex(
        (p) => p.id === (anchorRef.current ?? pull?.id),
      );
      const to = pulls.findIndex((p) => p.id === id);
      const lo = Math.min(from < 0 ? to : from, to);
      const hi = Math.max(from < 0 ? to : from, to);
      const range = pulls.slice(lo, hi + 1).map((p) => p.id);
      next = ctrl ? [...new Set([...current, ...range])] : range;
    } else if (ctrl) {
      anchorRef.current = id;
      next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
    } else {
      anchorRef.current = id;
      next = [id];
    }
    if (next.length >= 2) {
      setPicked(next);
    } else {
      setPicked([]);
      if (next.length === 1) setPullId(next[0]);
    }
  };

  return (
    <div className="relative flex flex-col gap-y-4">
      <div className="flex items-center gap-x-3 flex-wrap">
        <NightPicker
          nights={nights}
          night={night}
          onPick={(n, key) => {
            if (n !== night || key) {
              setNight(n);
              if (key) setBossKey(key);
              reset();
            }
          }}
        />
        {boss && (
          <BossStrip
            bosses={shownBosses}
            boss={boss}
            onPick={(key) => {
              if (key !== keyOf(boss)) {
                setBossKey(key);
                reset();
              }
            }}
          />
        )}
        {picked.length > 0 && (
          <span className="flex items-center gap-x-2 text-sm text-foreground">
            {picked.length} {picked.length === 1 ? 'pull' : 'pulls'} picked
            <button
              type="button"
              className="text-brand hover:underline text-xs"
              onClick={() => setPicked(pulls.map((p) => p.id))}
            >
              Pick all
            </button>
            <button
              type="button"
              className="text-brand hover:underline text-xs"
              onClick={() => setPicked([])}
            >
              Clear
            </button>
          </span>
        )}
      </div>

      {boss && (
        <div
          className={`grid grid-cols-1 gap-4 items-start ${
            listFolded
              ? 'lg:grid-cols-[36px_minmax(0,1fr)]'
              : 'lg:grid-cols-[230px_minmax(0,1fr)]'
          }`}
        >
          {listFolded ? (
            <button
              type="button"
              title="Show the pull list"
              onClick={() => foldList(false)}
              className="flex lg:flex-col items-center gap-2 rounded-md border border-card bg-background/40 hover:bg-card/40 px-2 lg:px-0 py-2 text-foreground hover:text-foreground-lighter"
            >
              <ChevronsRight size={16} className="shrink-0" />
              <span className="text-xs whitespace-nowrap lg:[writing-mode:vertical-rl]">
                {comparing.length >= 2
                  ? `${comparing.length} pulls`
                  : pull
                    ? `Pull ${pull.pullNumber}`
                    : 'Pulls'}
              </span>
            </button>
          ) : (
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center justify-between text-xs text-foreground px-1">
                <span>Pulls</span>
                <button
                  type="button"
                  title="Fold the pull list"
                  onClick={() => foldList(true)}
                  className="rounded p-0.5 hover:bg-card/50 hover:text-foreground-lighter"
                >
                  <ChevronsLeft size={16} />
                </button>
              </div>
              <div className="rounded-md border border-card bg-background/40 flex flex-col max-h-[70vh] overflow-y-auto">
                {pulls.map((p) => {
                  const active =
                    picked.length >= 2
                      ? picked.includes(p.id)
                      : pull?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-x-2 px-2 border-b border-card/40 ${
                        active ? 'bg-brand/15' : 'hover:bg-card/30'
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        onMouseDown={(e) => {
                          // Shift-click would otherwise select the page's text.
                          if (e.shiftKey) e.preventDefault();
                        }}
                        onClick={(e) => choose(p.id, e)}
                        className="flex flex-1 items-center gap-x-2 py-2 text-sm text-left select-none"
                      >
                        <span className="font-semibold tabular-nums w-14 text-foreground-lighter">
                          Pull {p.pullNumber}
                        </span>
                        <span
                          className={`tabular-nums ${
                            p.result === 'kill'
                              ? 'text-green-400'
                              : 'text-foreground'
                          }`}
                        >
                          {pullResult(p)}
                        </span>
                        <span className="ml-auto text-xs text-foreground tabular-nums">
                          {mmss(p.duration)}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-foreground m-0">
                Ctrl-click to add a pull, Shift-click for a range. Two or more
                picked pulls are added up.
              </p>
            </div>
          )}
          <div className="min-w-0">
            {shown.length ? (
              <LogsExplorer
                metas={shown}
                watch={watch}
                fallback={(missing) =>
                  missing.length >= 2 ? (
                    <div className="flex flex-col gap-y-3">
                      <p className="text-xs text-foreground m-0 max-w-[760px]">
                        These pulls&apos; full logs haven&apos;t been sent yet
                        (apps on 1.9.32 send them, and re-send last week&apos;s
                        pulls on their own), so here are their meters.
                      </p>
                      <PullComparison pulls={comparing} />
                    </div>
                  ) : pull?.source === 'wcl' ? (
                    <p className="text-sm text-foreground">
                      This pull was imported from Warcraft Logs, so there&apos;s
                      no combat log here.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-y-3">
                      <p className="text-xs text-foreground m-0 max-w-[760px]">
                        This pull&apos;s full log hasn&apos;t been sent yet
                        (apps on 1.9.32 send it, and re-send last week&apos;s
                        pulls on their own), so here are its meters.
                      </p>
                      {pull && (
                        <PullMeters
                          key={pull.id}
                          pullId={pull.id}
                          encounterId={boss.encounterId}
                          difficultyId={boss.difficultyId}
                        />
                      )}
                    </div>
                  )
                }
              />
            ) : (
              <p className="text-sm text-foreground">No pulls.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** The Logs page (its own item in the side menu, under Analysis). */
export const LogsPage = ({
  videoState,
  setAppState,
  persistentProgressRef,
}: {
  videoState: RendererVideo[];
  setAppState: Dispatch<SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
}) => {
  const watcher = useRecordingWatch(
    videoState,
    setAppState,
    persistentProgressRef,
  );
  const [mode, setMode] = React.useState<'pulls' | 'trends'>(() => {
    try {
      return localStorage.getItem('rf-logs-mode') === 'trends'
        ? 'trends'
        : 'pulls';
    } catch {
      return 'pulls';
    }
  });
  const change = (next: 'pulls' | 'trends') => {
    setMode(next);
    try {
      localStorage.setItem('rf-logs-mode', next);
    } catch {
      // Not remembered.
    }
  };
  return (
    <WatchContext.Provider value={watcher}>
      <div className="flex flex-col w-full h-full bg-background-higher text-foreground-lighter pt-[32px]">
        <div className="flex items-center gap-x-3 px-4 py-2 border-b border-card min-h-[52px] flex-wrap">
          <span className="font-display text-lg font-bold mr-1">Logs</span>
          <div className="flex rounded-md border border-card overflow-hidden">
            {(
              [
                ['pulls', 'Pulls'],
                ['trends', 'Trends'],
              ] as ['pulls' | 'trends', string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => change(key)}
                className={`px-3 h-9 text-xs ${
                  mode === key
                    ? 'bg-brand text-background font-semibold'
                    : 'text-foreground-lighter hover:bg-card/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-foreground">
            Damage, healing, damage taken and prevented, casts and buffs, from
            our own combat logs.
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'pulls' ? <LogsView /> : <LogsTrends />}
        </div>
      </div>
    </WatchContext.Provider>
  );
};
