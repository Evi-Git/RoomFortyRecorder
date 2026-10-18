import React from 'react';
import {
  ChevronRight,
  ClipboardList,
  Play,
  RefreshCw,
  Settings2,
  Skull,
} from 'lucide-react';
import { Dispatch, RefObject, SetStateAction } from 'react';
import { AppState, Pages, RendererVideo, StorageFilter } from 'main/types';
import { VideoCategory } from 'types/VideoCategory';
import { Button } from './components/Button/Button';
import { Input } from './components/Input/Input';
import { Textarea } from './components/TextArea/textarea';
import Switch from './components/Switch/Switch';
import { getCategoryIndex } from './rendererutils';
import { getConfigValue, setConfigValue } from './useSettings';
import { BRAND } from 'renderer/brand';

/**
 * [RoomFortyRecorder] Pull desk page: a report for every tracked raid pull,
 * built by the guild server from one raider's combat log.
 *
 * - Left: pulls by night, newest first.
 * - Right: the selected pull's wipe cause, deaths (with a Watch button that
 *   opens the dead raider's recording 10 s earlier), cooldown plan check and
 *   avoidable hits. The Boss settings tab holds the note, avoidable spells
 *   and Discord channel for that boss.
 */

type PlanStatus = 'ontime' | 'late' | 'early' | 'missed' | 'dead';

type PullSummary = {
  id: string;
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  night: string;
  pullNumber: number;
  totalPullNumber: number;
  createdAt: number;
  startedAt: number | null;
  uploadedBy: string | null;
  status: string;
  result: 'kill' | 'wipe';
  duration: number;
  bossPercent: number | null;
  deaths: number | null;
  wipeText: string | null;
  plan: Record<PlanStatus, number> | null;
  avoidableHits: number | null;
  error: string | null;
};

type Hit = {
  t: number;
  spellId: number;
  spellName: string;
  source: string;
  amount: number;
  overkill: number;
};

type Report = {
  id: string;
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  difficulty: string;
  result: 'kill' | 'wipe';
  duration: number;
  bossPercent: number | null;
  bossHpCurve: [number, number][];
  roster: { guid: string; name: string; specId: number; role: string }[];
  deaths: {
    t: number;
    name: string;
    role: string;
    killingBlow: Omit<Hit, 't'> | null;
    lastHits: Hit[];
  }[];
  wipe: { text: string } | null;
  plan: {
    parsed: number;
    phaseSkipped: number;
    unmatched: number;
    missingNames?: string[];
    noteEncounterId?: number | null;
    items: {
      t: number;
      name: string;
      spellId: number;
      spellName: string | null;
      status: PlanStatus;
      delta: number | null;
      // Missed only: the closest cast of that spell anywhere in the pull.
      nearest?: number | null;
    }[];
    summary: Record<PlanStatus, number>;
  };
  avoidable: {
    name: string;
    hits: number;
    damage: number;
    bySpell: Record<string, number>;
    // Reports from 1.8.5 on; older ones only have bySpell counts.
    spells?: {
      spellId: number;
      spellName: string | null;
      hits: number;
      damage: number;
    }[];
  }[];
  spellNames?: Record<string, string | null>;
  pullNumber: number;
  totalPullNumber: number;
  startedAt: number | null;
  uploadedBy: string | null;
};

type BossSettings = {
  encounterId: number;
  note: string;
  noteUpdatedAt: number | null;
  noteUpdatedBy: string | null;
  avoidable: { id: number; name: string | null }[];
  channelId: string;
  effectiveChannelId: string;
};

type Response<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; signedOut?: boolean };

interface IProps {
  videoState: RendererVideo[];
  setAppState: Dispatch<SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
}

const ipc = window.electron.ipcRenderer;
const REFRESH_MS = 30000;
// Seconds of video to show before a death or an assignment.
const WATCH_LEAD_SECONDS = 10;
// Recordings and the report agree on the pull start within this.
const VIDEO_MATCH_MS = 2 * 60 * 1000;

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const lines = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'}`;

const compact = (value: number) => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(value);
};

// "+3.2s" / "-6s": how far a cast was from its assigned time.
const signed = (seconds: number) => {
  const rounded = Math.round(seconds * 10) / 10;
  if (Math.abs(rounded) >= 60) {
    return `${rounded < 0 ? '-' : '+'}${mmss(Math.abs(rounded))}`;
  }
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : '±'}${Math.abs(rounded)}s`;
};

// Environment damage has "nil" as its source in older reports.
const sourceText = (source?: string) =>
  source && source !== 'nil' ? ` · ${source}` : '';

const hitsLabel = (count: number) => `${count} ${count === 1 ? 'hit' : 'hits'}`;

const nightLabel = (night: string) => {
  const date = new Date(`${night}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const STATUS_STYLE: Record<PlanStatus, { label: string; className: string }> = {
  ontime: { label: 'On time', className: 'text-green-400' },
  late: { label: 'Late', className: 'text-yellow-400' },
  early: { label: 'Early', className: 'text-yellow-400' },
  missed: { label: 'Missed', className: 'text-red-400' },
  dead: { label: 'Died before it', className: 'text-foreground/50' },
};

const ROLE_STYLE: Record<string, string> = {
  tank: 'text-sky-300',
  healer: 'text-green-300',
  dps: '',
};

/** Boss HP over the pull, with a red tick for each death. */
const HpCurve = ({ report }: { report: Report }) => {
  const width = 600;
  const height = 70;
  const duration = Math.max(report.duration, 1);
  const x = (t: number) => (t / duration) * width;
  const y = (pct: number) => height - 8 - (pct / 100) * (height - 16);
  const points = report.bossHpCurve.map(([t, pct]) => `${x(t)},${y(pct)}`);

  if (points.length < 2) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-[70px]"
      preserveAspectRatio="none"
      role="img"
      aria-label="Boss health over the pull"
    >
      <line
        x1={0}
        x2={width}
        y1={y(0)}
        y2={y(0)}
        stroke="currentColor"
        strokeOpacity={0.15}
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={BRAND}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {report.deaths.map((death) => (
        <line
          key={`${death.name}-${death.t}`}
          x1={x(death.t)}
          x2={x(death.t)}
          y1={height - 6}
          y2={height}
          stroke="#f87171"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
};

const PullDeskPage = (props: IProps) => {
  const { videoState, setAppState, persistentProgressRef } = props;

  const [pulls, setPulls] = React.useState<PullSummary[]>([]);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<Report | null>(null);
  const [reportError, setReportError] = React.useState('');
  const [tab, setTab] = React.useState<'report' | 'boss'>('report');
  const [canEdit, setCanEdit] = React.useState(false);
  const [uploadEnabled, setUploadEnabled] = React.useState<boolean>(
    () => getConfigValue<boolean>('pullDeskUpload') !== false,
  );
  const [expandedDeath, setExpandedDeath] = React.useState<number | null>(null);
  const [openGroups, setOpenGroups] = React.useState<number[]>([]);
  // Expanded per-player rows in the plan and avoidable sections.
  const [openRows, setOpenRows] = React.useState<string[]>([]);

  // Bumping these refetches the list / the open report.
  const [listTick, setListTick] = React.useState(0);
  const [reportTick, setReportTick] = React.useState(0);
  const loadPulls = () => setListTick((tick) => tick + 1);

  React.useEffect(() => {
    let cancelled = false;

    const fetchList = () =>
      call<{ pulls: PullSummary[] }>({ action: 'list', days }).then(
        (response) => {
          if (cancelled) return;
          setLoading(false);
          if (!response.ok) {
            setError(response.error);
            return;
          }
          setError('');
          setPulls(response.data.pulls);
          setSelectedId(
            (current) => current ?? response.data.pulls[0]?.id ?? null,
          );
        },
      );

    fetchList();
    const timer = setInterval(fetchList, REFRESH_MS);
    const unsubscribe = ipc.on('pullDeskUpdated', fetchList);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [days, listTick]);

  React.useEffect(() => {
    call<{ canEdit: boolean }>({ action: 'config' }).then((response) => {
      if (response.ok) setCanEdit(response.data.canEdit);
    });
  }, []);

  // Refetch the open report when it's selected, and when its summary
  // changes (e.g. a note was saved and the server recomputed it).
  const selectedSummary = pulls.find((pull) => pull.id === selectedId);
  const summaryKey = selectedSummary
    ? `${selectedSummary.status}-${JSON.stringify(selectedSummary.plan)}-${selectedSummary.avoidableHits}`
    : '';

  React.useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;

    call<Report & { pending?: boolean }>({
      action: 'report',
      id: selectedId,
    }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setReportError(response.error);
        setReport(null);
      } else if (response.data.pending) {
        setReportError('This pull is still being analyzed.');
        setReport(null);
      } else {
        setReportError('');
        setReport(response.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedId, summaryKey, reportTick]);

  const toggleUpload = (value: boolean) => {
    setUploadEnabled(value);
    setConfigValue('pullDeskUpload', value);
  };

  /** This raider's recording of the selected pull, if we have it. */
  const findVideo = (name: string) => {
    if (!report || !report.startedAt) return undefined;
    const guid = report.roster.find((player) => player.name === name)?.guid;

    const candidates = videoState.filter(
      (video) =>
        video.category === VideoCategory.Raids &&
        video.encounterID === report.encounterId &&
        video.difficultyID === report.difficultyId &&
        typeof video.start === 'number' &&
        Math.abs(video.start - (report.startedAt as number)) < VIDEO_MATCH_MS &&
        (guid ? video.player?._GUID === guid : video.player?._name === name),
    );

    // Prefer a local copy (instant), then the closest start time.
    candidates.sort(
      (a, b) =>
        Number(a.cloud) - Number(b.cloud) ||
        Math.abs((a.start as number) - (report.startedAt as number)) -
          Math.abs((b.start as number) - (report.startedAt as number)),
    );
    return candidates[0];
  };

  const watch = (video: RendererVideo, seconds: number) => {
    persistentProgressRef.current = Math.max(0, seconds - WATCH_LEAD_SECONDS);
    setConfigValue('selectedCategory', getCategoryIndex(VideoCategory.Raids));
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
  };

  const renderWatch = (name: string, seconds: number) => {
    const video = findVideo(name);
    return (
      <Button
        size="xs"
        variant="ghost"
        disabled={!video}
        title={
          video
            ? `Open ${name}'s recording at ${mmss(Math.max(0, seconds - WATCH_LEAD_SECONDS))}`
            : `No recording from ${name} for this pull`
        }
        onClick={() => video && watch(video, seconds)}
        className="gap-x-1 h-6 px-2"
      >
        <Play size={12} /> Watch
      </Button>
    );
  };

  // ---- Pull list ------------------------------------------------------------

  const renderPullList = () => {
    if (loading) return <p className="p-4 text-foreground/60">Loading…</p>;
    if (!pulls.length) {
      return (
        <p className="p-4 text-sm text-foreground/60">
          No pulls yet. Reports appear here a few seconds after each tracked
          raid pull ends.
        </p>
      );
    }

    const nights: string[] = [];
    pulls.forEach((pull) => {
      if (!nights.includes(pull.night)) nights.push(pull.night);
    });

    return nights.map((night) => (
      <div key={night} className="mb-2">
        <div className="px-3 pt-2 pb-1 text-xs font-bold uppercase text-foreground/50">
          {nightLabel(night)}
        </div>
        {pulls
          .filter((pull) => pull.night === night)
          .map((pull) => {
            const selected = pull.id === selectedId;
            const kill = pull.result === 'kill';
            return (
              <button
                type="button"
                key={pull.id}
                onClick={() => {
                  setSelectedId(pull.id);
                  setExpandedDeath(null);
                  setOpenGroups([]);
                  setReportError('');
                  setTab('report');
                }}
                className={`w-full text-left px-3 py-2 border-l-2 hover:bg-card/60 ${
                  selected ? 'bg-card border-brand' : 'border-transparent'
                }`}
              >
                <div className="flex items-center gap-x-2 text-sm">
                  <span className="font-bold">#{pull.pullNumber}</span>
                  <span className="truncate">{pull.encounterName}</span>
                  <span
                    className={`ml-auto font-semibold ${
                      kill ? 'text-green-400' : ''
                    }`}
                  >
                    {kill
                      ? 'Kill'
                      : pull.status === 'failed'
                        ? 'Failed'
                        : `${pull.bossPercent ?? '?'}%`}
                  </span>
                </div>
                <div className="flex gap-x-2 text-xs text-foreground/50">
                  <span>{mmss(pull.duration)}</span>
                  {pull.deaths !== null && (
                    <span className="flex items-center gap-x-[2px]">
                      <Skull size={11} /> {pull.deaths}
                    </span>
                  )}
                  {pull.plan && pull.plan.missed > 0 && (
                    <span className="text-red-400">
                      {pull.plan.missed} missed
                    </span>
                  )}
                </div>
              </button>
            );
          })}
      </div>
    ));
  };

  // ---- Report -----------------------------------------------------------------

  const renderDeathRow = (death: Report['deaths'][number], index: number) => {
    const kb = death.killingBlow;
    const open = expandedDeath === index;
    return (
      <React.Fragment key={`${death.name}-${death.t}`}>
        <tr
          className="border-b border-card hover:bg-card/40 cursor-pointer"
          onClick={() => setExpandedDeath(open ? null : index)}
        >
          <td className="py-1 pr-3 font-mono text-foreground/60 w-14">
            {mmss(death.t)}
          </td>
          <td
            className={`py-1 pr-3 font-semibold ${ROLE_STYLE[death.role] || ''}`}
          >
            {death.name}
          </td>
          <td className="py-1 pr-3">
            {kb ? (
              <>
                {kb.spellName}
                <span className="text-foreground/50">
                  {sourceText(kb.source)}
                  {kb.amount > 0 && ` · ${compact(kb.amount)}`}
                  {kb.overkill > 0 && ` (${compact(kb.overkill)} over)`}
                </span>
              </>
            ) : (
              <span className="text-foreground/50">Unknown</span>
            )}
          </td>
          <td
            className="py-1 text-right w-20"
            onClick={(event) => event.stopPropagation()}
          >
            {renderWatch(death.name, death.t)}
          </td>
        </tr>
        {open && (
          <tr className="bg-card/30">
            <td />
            <td colSpan={3} className="py-1 text-xs text-foreground/70">
              {death.lastHits.length === 0
                ? 'No damage recorded in the last 10 s.'
                : death.lastHits.map((hit) => (
                    <div key={`${hit.t}-${hit.spellId}`}>
                      <span className="font-mono">{mmss(hit.t)}</span>{' '}
                      {hit.spellName}
                      {sourceText(hit.source)} · {compact(hit.amount)}
                      {hit.overkill > 0 && ` (${compact(hit.overkill)} over)`}
                    </div>
                  ))}
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const renderDeaths = (r: Report) => {
    if (!r.deaths.length) {
      return <p className="text-sm text-foreground/60">No deaths.</p>;
    }

    // Fold a raid-wide mechanic (4+ deaths to one ability inside 2 s) into
    // one row, so the deaths that started the wipe stay readable.
    const segments: number[][] = [];
    const grouped = new Set<number>();
    r.deaths.forEach((death, index) => {
      if (grouped.has(index)) return;
      const spell = death.killingBlow?.spellName;
      const same = r.deaths
        .map((other, i) => ({ other, i }))
        .filter(
          ({ other, i }) =>
            i >= index &&
            !grouped.has(i) &&
            spell &&
            other.killingBlow?.spellName === spell &&
            other.t - death.t <= 2,
        )
        .map(({ i }) => i);

      if (same.length >= 4) {
        same.forEach((i) => grouped.add(i));
        segments.push(same);
      } else {
        segments.push([index]);
      }
    });

    const rows: React.ReactNode[] = [];
    segments.forEach((segment) => {
      if (segment.length < 4) {
        segment.forEach((index) =>
          rows.push(renderDeathRow(r.deaths[index], index)),
        );
        return;
      }

      const first = r.deaths[segment[0]];
      const key = segment[0];
      const open = openGroups.includes(key);
      rows.push(
        <tr
          key={`group-${key}`}
          className="border-b border-card hover:bg-card/40 cursor-pointer"
          onClick={() =>
            setOpenGroups((groups) =>
              open ? groups.filter((g) => g !== key) : [...groups, key],
            )
          }
        >
          <td className="py-1 pr-3 font-mono text-foreground/60 w-14">
            {mmss(first.t)}
          </td>
          <td className="py-1 pr-3 font-semibold text-red-400">
            {segment.length} raiders
          </td>
          <td className="py-1 pr-3">
            {first.killingBlow?.spellName}
            <span className="text-foreground/50">
              {sourceText(first.killingBlow?.source)}
            </span>
          </td>
          <td className="py-1 pr-2 text-right text-xs text-foreground/50 w-20">
            {open ? 'Hide' : 'Show'}
          </td>
        </tr>,
      );
      if (open) {
        segment.forEach((index) =>
          rows.push(renderDeathRow(r.deaths[index], index)),
        );
      }
    });

    return (
      <table className="w-full text-sm">
        <tbody>{rows}</tbody>
      </table>
    );
  };

  const renderPlan = (r: Report) => {
    const { plan } = r;
    if (!plan.parsed) {
      return (
        <p className="text-sm text-foreground/60">
          No cooldown note for this boss yet. Paste wowutils&apos; Copy all
          output into Boss settings to check every assignment.
        </p>
      );
    }

    const { summary } = plan;
    return (
      <>
        <p className="text-sm mb-2">
          <span className="text-green-400">{summary.ontime} on time</span>
          {' · '}
          <span className="text-yellow-400">
            {summary.late + summary.early} late or early
          </span>
          {' · '}
          <span className="text-red-400">{summary.missed} missed</span>
          {summary.dead > 0 && ` · ${summary.dead} dead before their timing`}
          {plan.phaseSkipped > 0 && (
            <span className="text-foreground/50">
              {' '}
              · {lines(plan.phaseSkipped)} timed by phase, not checked yet
            </span>
          )}
        </p>
        {!!plan.missingNames?.length && (
          <p className="text-xs text-foreground/50 mb-2">
            Not in this pull, so not checked: {plan.missingNames.join(', ')}
          </p>
        )}
        {!!plan.noteEncounterId && plan.noteEncounterId !== r.encounterId && (
          <p className="text-xs text-yellow-400 mb-2">
            This note was exported for a different boss (encounter{' '}
            {plan.noteEncounterId}). Check Boss settings.
          </p>
        )}
        {renderPlanPlayers(r)}
      </>
    );
  };

  const toggleRow = (key: string) =>
    setOpenRows((rows) =>
      rows.includes(key) ? rows.filter((k) => k !== key) : [...rows, key],
    );

  const roleOf = (r: Report, name: string) =>
    r.roster.find((player) => player.name === name)?.role || '';

  // One header row per player, problems first; click to see each
  // assignment with how far off it was.
  const renderPlanPlayers = (r: Report) => {
    const byPlayer = new Map<string, Report['plan']['items']>();
    r.plan.items.forEach((item) => {
      byPlayer.set(item.name, [...(byPlayer.get(item.name) || []), item]);
    });

    const players = [...byPlayer.entries()]
      .map(([name, items]) => {
        const count = (status: PlanStatus) =>
          items.filter((item) => item.status === status).length;
        return {
          name,
          items: [...items].sort((a, b) => a.t - b.t),
          missed: count('missed'),
          off: count('late') + count('early'),
          dead: count('dead'),
          ontime: count('ontime'),
        };
      })
      .sort(
        (a, b) =>
          b.missed - a.missed || b.off - a.off || a.name.localeCompare(b.name),
      );

    return (
      <div className="text-sm">
        {players.map((player) => {
          const key = `${r.id}:plan:${player.name}`;
          const open = openRows.includes(key);
          const clean = player.missed === 0 && player.off === 0;
          return (
            <div key={player.name} className="border-b border-card">
              <button
                type="button"
                className="w-full flex items-center gap-x-2 py-1.5 text-left hover:bg-card/40 rounded-sm"
                onClick={() => toggleRow(key)}
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-foreground/50 transition-transform ${open ? 'rotate-90' : ''}`}
                />
                <span
                  className={`font-semibold w-40 truncate ${ROLE_STYLE[roleOf(r, player.name)] || ''}`}
                >
                  {player.name}
                </span>
                <span className="flex-1">
                  {clean && player.dead === 0 && (
                    <span className="text-green-400">
                      All {player.ontime} on time
                    </span>
                  )}
                  {player.missed > 0 && (
                    <span className="text-red-400">{player.missed} missed</span>
                  )}
                  {player.missed > 0 && player.off > 0 && ' · '}
                  {player.off > 0 && (
                    <span className="text-yellow-400">
                      {player.off} late or early
                    </span>
                  )}
                  {player.dead > 0 && (
                    <span className="text-foreground/50">
                      {(!clean || player.ontime > 0) && ' · '}
                      {player.dead} skipped (dead)
                    </span>
                  )}
                </span>
                <span className="text-xs text-foreground/50">
                  {player.items.length}{' '}
                  {player.items.length === 1 ? 'assignment' : 'assignments'}
                </span>
              </button>
              {open && (
                <div className="mb-1.5 py-0.5 bg-card/30 rounded-sm">
                  {player.items.map((item) => (
                    <div
                      key={`${item.t}-${item.spellId}`}
                      className="flex items-center gap-x-2 py-1 pl-[22px] pr-2"
                    >
                      <span className="w-40 font-mono text-foreground/60">
                        {mmss(item.t)}
                      </span>
                      <span className="w-56 truncate">{renderSpell(item)}</span>
                      <span className="flex-1">{renderPlanStatus(item)}</span>
                      <span className="w-20 text-right">
                        {item.status !== 'ontime' &&
                          item.status !== 'dead' &&
                          renderWatch(item.name, item.t)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSpell = (item: Report['plan']['items'][number]) =>
    item.spellName || (
      <button
        type="button"
        className="underline decoration-dotted"
        title="Nobody cast this spell in the pull, so its name isn't in the log. Open it on Wowhead."
        onClick={() =>
          ipc.sendMessage('openURL', [
            `https://www.wowhead.com/spell=${item.spellId}`,
          ])
        }
      >
        Spell {item.spellId}
      </button>
    );

  // Status plus the signed offset from the assigned time.
  const renderPlanStatus = (item: Report['plan']['items'][number]) => {
    const style = STATUS_STYLE[item.status];
    let detail = '';
    if (item.status === 'missed') {
      // Reports analyzed before the server update have no `nearest` field;
      // say nothing rather than claim the spell was never cast.
      if (item.nearest === null) detail = 'never cast';
      else if (item.nearest !== undefined) {
        detail = `nearest cast ${signed(item.nearest)}`;
      }
    } else if (item.delta !== null) {
      detail = signed(item.delta);
    }
    return (
      <>
        <span className={style.className}>{style.label}</span>
        {detail && (
          <span
            className={
              item.status === 'late' || item.status === 'early'
                ? 'text-yellow-400'
                : 'text-foreground/50'
            }
          >
            {' '}
            {detail}
          </span>
        )}
      </>
    );
  };

  const renderAvoidable = (r: Report) => {
    if (!r.avoidable.length) {
      return (
        <p className="text-sm text-foreground/60">
          No hits from this boss&apos;s avoidable spells. Add spell IDs in Boss
          settings.
        </p>
      );
    }

    // Older reports only stored hit counts per spell.
    const spellsOf = (row: Report['avoidable'][number]) =>
      row.spells ??
      Object.entries(row.bySpell)
        .map(([spellId, hits]) => ({
          spellId: Number(spellId),
          spellName: r.spellNames?.[spellId] ?? null,
          hits,
          damage: null as number | null,
        }))
        .sort((a, b) => b.hits - a.hits);

    return (
      <div className="text-sm">
        {r.avoidable.map((row) => {
          const key = `${r.id}:avoid:${row.name}`;
          const open = openRows.includes(key);
          const spells = spellsOf(row);
          return (
            <div key={row.name} className="border-b border-card">
              <button
                type="button"
                className="w-full flex items-center gap-x-2 py-1.5 text-left hover:bg-card/40 rounded-sm"
                onClick={() => toggleRow(key)}
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-foreground/50 transition-transform ${open ? 'rotate-90' : ''}`}
                />
                <span
                  className={`font-semibold w-40 truncate ${ROLE_STYLE[roleOf(r, row.name)] || ''}`}
                >
                  {row.name}
                </span>
                <span className="w-24">{hitsLabel(row.hits)}</span>
                <span className="w-32 text-foreground/50">
                  {compact(row.damage)} damage
                </span>
                <span className="flex-1 truncate text-xs text-foreground/50">
                  {spells
                    .map((spell) => spell.spellName || `Spell ${spell.spellId}`)
                    .join(', ')}
                </span>
              </button>
              {open && (
                <div className="mb-1.5 py-0.5 bg-card/30 rounded-sm">
                  {spells.map((spell) => (
                    <div
                      key={spell.spellId}
                      className="flex items-center gap-x-2 py-1 pl-[22px] pr-2"
                    >
                      <span className="w-40 truncate text-foreground/80">
                        {spell.spellName || `Spell ${spell.spellId}`}
                      </span>
                      <span className="w-24">{hitsLabel(spell.hits)}</span>
                      <span className="w-32 text-foreground/50">
                        {spell.damage !== null
                          ? `${compact(spell.damage)} damage`
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const reanalyze = async () => {
    if (!report) return;
    const response = await call({ action: 'reanalyze', id: report.id });
    if (!response.ok) setReportError(response.error);
    loadPulls();
    setReportTick((tick) => tick + 1);
  };

  const renderReport = () => {
    if (reportError) return <p className="text-red-400">{reportError}</p>;
    // While a newly picked pull loads, don't show the previous one.
    if (!report || report.id !== selectedId) {
      return (
        <p className="text-foreground/60">
          {pulls.length ? 'Pick a pull.' : ''}
        </p>
      );
    }

    const r = report;
    const kill = r.result === 'kill';

    return (
      <div className="flex flex-col gap-y-5">
        <div>
          <div className="flex items-baseline gap-x-3 flex-wrap">
            <h2 className="font-display text-xl font-bold">
              Pull {r.pullNumber} · {r.encounterName} ({r.difficulty})
            </h2>
            <span
              className={`font-semibold ${kill ? 'text-green-400' : 'text-brand-soft'}`}
            >
              {kill ? 'Kill' : `Wipe at ${r.bossPercent ?? '?'}%`} ·{' '}
              {mmss(r.duration)}
            </span>
            <span className="text-xs text-foreground/50">
              Pull {r.totalPullNumber} overall · log from{' '}
              {r.uploadedBy || 'unknown'}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto h-6"
              onClick={reanalyze}
              title="Rebuild this report with the current note and avoidable list"
            >
              <RefreshCw size={12} className="mr-1" /> Re-run
            </Button>
          </div>
          {r.wipe?.text && <p className="mt-1 text-sm">{r.wipe.text}</p>}
          <div className="mt-2 text-foreground/80">
            <HpCurve report={r} />
          </div>
        </div>

        <section>
          <h3 className="font-display text-lg font-bold mb-1">
            Deaths ({r.deaths.length})
          </h3>
          {renderDeaths(r)}
        </section>

        <section>
          <h3 className="font-display text-lg font-bold mb-1">Cooldown plan</h3>
          {renderPlan(r)}
        </section>

        <section>
          <h3 className="font-display text-lg font-bold mb-1">
            Avoidable hits
          </h3>
          {renderAvoidable(r)}
        </section>
      </div>
    );
  };

  // ---- Boss settings ------------------------------------------------------------

  const currentReport = report && report.id === selectedId ? report : null;
  const encounterId =
    selectedSummary?.encounterId ?? currentReport?.encounterId;

  return (
    <div className="flex flex-col w-full h-full bg-background-higher text-foreground-lighter pt-[32px]">
      <div className="flex items-center gap-x-3 px-4 py-2 border-b border-card min-h-[52px] flex-wrap">
        <span className="flex items-center gap-x-2 font-bold mr-2">
          <ClipboardList size={18} className="text-brand" />
          <span className="font-display text-lg">Pull desk</span>
        </span>
        <Button
          size="sm"
          variant={days === 1 ? 'default' : 'outline'}
          onClick={() => setDays(1)}
        >
          Tonight
        </Button>
        <Button
          size="sm"
          variant={days === 7 ? 'default' : 'outline'}
          onClick={() => setDays(7)}
        >
          7 days
        </Button>
        <Button
          size="sm"
          variant={days === 30 ? 'default' : 'outline'}
          onClick={() => setDays(30)}
        >
          30 days
        </Button>
        <Button size="sm" variant="ghost" onClick={() => loadPulls()}>
          <RefreshCw size={14} />
        </Button>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <label
          className="ml-auto flex items-center gap-x-2 text-sm"
          title="When on, your app may upload your combat log for a pull. Only one raider's upload is used per pull."
        >
          Send my pull logs
          <Switch checked={uploadEnabled} onCheckedChange={toggleUpload} />
        </label>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-72 shrink-0 border-r border-card overflow-y-auto">
          {renderPullList()}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          {encounterId !== undefined && (
            <div className="flex gap-x-2 px-4 pt-3">
              <Button
                size="sm"
                variant={tab === 'report' ? 'default' : 'ghost'}
                onClick={() => setTab('report')}
              >
                Report
              </Button>
              <Button
                size="sm"
                variant={tab === 'boss' ? 'default' : 'ghost'}
                onClick={() => setTab('boss')}
                className="gap-x-1"
              >
                <Settings2 size={14} /> Boss settings
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {tab === 'report' || encounterId === undefined ? (
              renderReport()
            ) : (
              <BossSettingsPanel
                key={encounterId}
                encounterId={encounterId}
                encounterName={
                  selectedSummary?.encounterName ??
                  currentReport?.encounterName ??
                  ''
                }
                canEdit={canEdit}
                lastParse={currentReport?.plan ?? null}
                onSaved={() => loadPulls()}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface BossSettingsProps {
  encounterId: number;
  encounterName: string;
  canEdit: boolean;
  lastParse: Report['plan'] | null;
  onSaved: () => void;
}

const BossSettingsPanel = (props: BossSettingsProps) => {
  const { encounterId, encounterName, canEdit, lastParse, onSaved } = props;
  const [settings, setSettings] = React.useState<BossSettings | null>(null);
  const [note, setNote] = React.useState('');
  const [avoidable, setAvoidable] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    call<BossSettings>({ action: 'boss', encounterId }).then((response) => {
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      setSettings(response.data);
      setNote(response.data.note);
      setAvoidable(response.data.avoidable.map((spell) => spell.id).join(', '));
      setChannel(response.data.channelId);
    });
  }, [encounterId]);

  const save = async (request: Record<string, unknown>, done: string) => {
    setSaving(true);
    setMessage('Saving…');
    const response = await call<{
      reanalyzed?: number;
      avoidable?: BossSettings['avoidable'];
      warning?: string | null;
    }>({
      ...request,
      encounterId,
    });
    setSaving(false);
    if (!response.ok) {
      setMessage(response.error);
      return;
    }
    const redone = response.data?.reanalyzed;
    const summary = redone
      ? `${done} ${redone} pull${redone === 1 ? '' : 's'} from the last 24 h updated.`
      : done;
    setMessage(
      response.data?.warning ? `${summary} ${response.data.warning}` : summary,
    );
    if (response.data?.avoidable && settings) {
      setSettings({ ...settings, avoidable: response.data.avoidable });
    }
    onSaved();
  };

  const avoidableIds = avoidable
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!settings) {
    return <p className="text-foreground/60">{message || 'Loading…'}</p>;
  }

  return (
    <div className="flex flex-col gap-y-6 max-w-3xl">
      <h2 className="font-display text-xl font-bold">{encounterName}</h2>
      {!canEdit && (
        <p className="text-sm text-yellow-400">
          Your Discord role can view these settings but not change them.
        </p>
      )}

      <section className="flex flex-col gap-y-2">
        <h3 className="font-display text-lg font-bold">Cooldown note</h3>
        <p className="text-xs text-foreground/60">
          Paste wowutils&apos; Copy all output (the same note you Send in NSRT),
          or an MRT-style note. Every line with a time, a spell and a tagged
          raider is checked against what they cast. Text reminders and lines
          timed in later phases are skipped for now.
          {settings.noteUpdatedAt &&
            ` Last saved ${new Date(settings.noteUpdatedAt).toLocaleString()} by ${settings.noteUpdatedBy}.`}
        </p>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={!canEdit}
          className="font-mono text-xs min-h-[180px] max-h-[360px]"
          spellCheck={false}
        />
        {lastParse && lastParse.parsed > 0 && (
          <p className="text-xs text-foreground/60">
            On the open pull this note gave {lastParse.parsed} checkable
            assignments
            {lastParse.unmatched > 0 &&
              `, ${lines(lastParse.unmatched)} named nobody in the pull`}
            {lastParse.phaseSkipped > 0 &&
              `, ${lines(lastParse.phaseSkipped)} timed by phase skipped`}
            .
          </p>
        )}
        <div>
          <Button
            size="sm"
            disabled={!canEdit || saving}
            onClick={() => save({ action: 'setNote', note }, 'Note saved.')}
          >
            Save note
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-y-2">
        <h3 className="font-display text-lg font-bold">Avoidable spells</h3>
        <p className="text-xs text-foreground/60">
          Spell IDs that should never hit anyone, separated by commas. Find them
          on Wowhead or in the death recaps.
        </p>
        <Input
          value={avoidable}
          onChange={(event) => setAvoidable(event.target.value)}
          disabled={!canEdit}
          placeholder="1241932, 1243866"
        />
        {settings.avoidable.length > 0 && (
          <p className="text-xs text-foreground/60">
            {settings.avoidable
              .map((spell) => spell.name || `Spell ${spell.id}`)
              .join(', ')}
          </p>
        )}
        <div>
          <Button
            size="sm"
            disabled={!canEdit || saving}
            onClick={() =>
              save(
                { action: 'setAvoidable', spells: avoidableIds },
                'Avoidable spells saved.',
              )
            }
          >
            Save avoidable spells
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-y-2">
        <h3 className="font-display text-lg font-bold">Discord channel</h3>
        <p className="text-xs text-foreground/60">
          Channel ID for this boss&apos;s pull reports (right-click the channel
          in Discord with Developer Mode on, then Copy Channel ID). Empty uses
          the server default
          {settings.effectiveChannelId && !settings.channelId
            ? ` (${settings.effectiveChannelId})`
            : ''}
          .
        </p>
        <Input
          value={channel}
          onChange={(event) => setChannel(event.target.value.trim())}
          disabled={!canEdit}
          placeholder="123456789012345678"
          className="max-w-xs"
        />
        <div>
          <Button
            size="sm"
            disabled={!canEdit || saving}
            onClick={() =>
              save(
                { action: 'setChannel', channelId: channel },
                'Channel saved.',
              )
            }
          >
            Save channel
          </Button>
        </div>
      </section>

      {message && <p className="text-sm">{message}</p>}
    </div>
  );
};

export default PullDeskPage;
