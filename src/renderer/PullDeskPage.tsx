import { dateTime, timeOfDay } from 'renderer/clock';
import React from 'react';
import {
  BarChart3,
  ChevronRight,
  Play,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { Dispatch, RefObject, SetStateAction } from 'react';
import { AppState, Pages, RendererVideo, StorageFilter } from 'main/types';
import { VideoCategory } from 'types/VideoCategory';
import { Button } from './components/Button/Button';
import { Input } from './components/Input/Input';
import { Textarea } from './components/TextArea/textarea';
import { getCategoryIndex } from './rendererutils';
import { setConfigValue } from './useSettings';
import {
  BossPercentHint,
  ImportFromLogs,
  UploadFromLog,
  NightSummaryView,
  ProgressionView,
} from './PullDeskSummary';
import { coachCall, Flag, PersonalChannelsDialog } from './Coaching';
import AbilityName from './AbilityCard';
import JournalView from './PullDeskJournal';
import ConsumablesPanel, { Prep } from './Consumables';
import PullMeters, { useRecordingWatch, WatchContext } from './Meters';
import NightPicker from './logs/NightPicker';
import { classColor, compact } from './logs/format';
import { setLogsTarget } from './logs/openTarget';
import { TabsContext } from './tabs/tabs';
import { isReset, pullLabel, useShowResets } from './resets';
import { PageHeader, UnderlineTabs } from './components/PageHeader/PageHeader';
import BossBar from './components/BossBar/BossBar';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from './components/States/States';
import BossHealthChart from './dashboard/BossHealthChart';
import StatTiles from './dashboard/StatTiles';
import {
  avoidableStat,
  consumablesStat,
  deathsStat,
  raidDpsStat,
} from './dashboard/stats';
import type { MetersData } from './Meters';
import { CalendarNight, daysToCover, recentNights } from './logs/nightCalendar';

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
  reset?: boolean;
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

type DefensiveKind =
  | 'personal'
  | 'immunity'
  | 'external'
  | 'raid'
  | 'potion'
  | 'healthstone'
  | 'combatPotion';

type Available = {
  ability: string;
  kind: DefensiveKind;
  status: 'ready' | 'cooldown';
  readyIn: number;
  lastUsed: number | null;
  usedCount: number;
};

type Defensives = {
  players: {
    name: string;
    role: string;
    specId: number;
    diedAt: number | null;
    personal: number;
    external: number;
    raid: number;
    potions: number;
    healthstones: number;
    uses: {
      t: number;
      ability: string;
      kind: DefensiveKind;
      target?: string;
    }[];
  }[];
  raid: { t: number; name: string; ability: string }[];
  warlockInRaid: boolean;
};

type Report = {
  prep?: Prep | null;
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
    // Reports from 1.8.11 on.
    available?: Available[];
  }[];
  defensives?: Defensives;
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
      // 1.9.8+: when each hit landed; ticks within 5 s are one moment
      // (t = first tick, end = last tick).
      times?: { t: number; end?: number; hits: number; damage: number }[];
    }[];
  }[];
  spellNames?: Record<string, string | null>;
  pullNumber: number;
  totalPullNumber: number;
  reset?: boolean;
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

// The raid night a moment belongs to: the server counts pulls before 6 AM
// as the night before (guild-cloud-server/pulldesk.mjs nightOf).
const NIGHT_CUTOFF_MS = 6 * 60 * 60 * 1000;
const nightOf = (ms: number) => {
  const d = new Date(ms - NIGHT_CUTOFF_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayKey = () => nightOf(Date.now());

// Seconds of video to show before a death or an assignment.
const WATCH_LEAD_SECONDS = 10;
// Avoidable hits are short: start the video just before the hit.
const HIT_LEAD_SECONDS = 4;
// Recordings and the report agree on the pull start within this.
const VIDEO_MATCH_MS = 2 * 60 * 1000;

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const lines = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'}`;

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

// [RoomFortyRecorder] Difficulty filter for the pull list (a heroic group
// raiding alongside the mythic one made the list confusing).
const DIFFICULTY_NAME: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  233: 'Mythic', // flex Mythic (Kith'ix)
  17: 'LFR',
};
const DIFFICULTY_ORDER = ['Mythic', 'Heroic', 'Normal', 'LFR'];
const DIFFICULTY_BADGE: Record<string, string> = {
  Mythic: 'text-orange-300 border-orange-300/40',
  Heroic: 'text-purple-300 border-purple-300/40',
  Normal: 'text-green-300 border-green-300/40',
  LFR: 'text-sky-300 border-sky-300/40',
};
const difficultyOf = (id: number) => DIFFICULTY_NAME[id] ?? `Difficulty ${id}`;
const DIFFICULTY_KEY = 'rf-pulldesk-difficulty';

const STATUS_STYLE: Record<PlanStatus, { label: string; className: string }> = {
  ontime: { label: 'On time', className: 'text-green-400' },
  late: { label: 'Late', className: 'text-yellow-400' },
  early: { label: 'Early', className: 'text-yellow-400' },
  missed: { label: 'Missed', className: 'text-red-400' },
  dead: { label: 'Died before it', className: 'text-foreground' },
};

const KIND_LABEL: Record<DefensiveKind, string> = {
  personal: 'Personal',
  immunity: 'Immunity',
  external: 'External',
  raid: 'Raid',
  potion: 'Potion',
  healthstone: 'Healthstone',
  combatPotion: 'Combat potion',
};

const KIND_STYLE: Record<DefensiveKind, string> = {
  personal: 'text-sky-300',
  immunity: 'text-purple-300',
  external: 'text-green-300',
  raid: 'text-brand-soft',
  potion: 'text-red-300',
  healthstone: 'text-emerald-300',
  combatPotion: 'text-amber-300',
};

// Pre-pull uses have negative times.
const timeLabel = (seconds: number) =>
  seconds < 0 ? `-${mmss(-seconds)}` : mmss(seconds);

type Section =
  | 'deaths'
  | 'meters'
  | 'defensives'
  | 'plan'
  | 'avoidable'
  | 'consumables';

const loadSection = (): Section => {
  try {
    const saved = localStorage.getItem('rf-pulldesk-section');
    if (
      saved === 'deaths' ||
      saved === 'defensives' ||
      saved === 'plan' ||
      saved === 'avoidable' ||
      saved === 'consumables' ||
      saved === 'meters'
    ) {
      return saved;
    }
  } catch {
    // Storage unavailable: start on Deaths.
  }
  return 'deaths';
};

type View =
  | 'pulls'
  | 'night'
  | 'progression'
  | 'reclears'
  | 'compare'
  | 'journal';

const loadView = (): View => {
  try {
    const saved = localStorage.getItem('rf-pulldesk-view');
    if (
      saved === 'pulls' ||
      saved === 'night' ||
      saved === 'progression' ||
      saved === 'reclears' ||
      saved === 'compare' ||
      saved === 'journal'
    ) {
      return saved;
    }
  } catch {
    // Storage unavailable: start on Pulls.
  }
  return 'pulls';
};

const SECONDARY_BUTTON =
  'inline-flex h-9 items-center gap-x-1.5 whitespace-nowrap rounded-lg border border-panel-line bg-panel-line px-3 text-[13px] font-medium text-foreground-lighter transition-colors hover:bg-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:pointer-events-none disabled:opacity-50';

/** A raider's class colour, from the report's roster (spec id by name). */
const nameColor = (
  roster: { name: string; specId: number }[] | undefined,
  name: string,
) => {
  const spec = roster?.find((player) => player.name === name)?.specId;
  return typeof spec === 'number' ? classColor(spec) : undefined;
};

const PullDeskPage = (props: IProps) => {
  const { videoState, setAppState, persistentProgressRef } = props;
  // Meters' "open a recording at this moment".
  const recordingWatch = useRecordingWatch(
    videoState,
    setAppState,
    persistentProgressRef,
  );

  const [showResets, setShowResets] = useShowResets();
  // The list effect reads the switch without re-running when it changes.
  const showResetsRef = React.useRef(showResets);
  React.useEffect(() => {
    showResetsRef.current = showResets;
  }, [showResets]);
  // Where the list opens: the newest pull, skipping resets while they're hidden.
  const firstPull = (list: PullSummary[]) =>
    (showResetsRef.current ? undefined : list.find((p) => !isReset(p))) ??
    list[0];
  // Opens the Logs page in a new tab (with tabs on), for "Open in Logs".
  const tabsApi = React.useContext(TabsContext);
  const [pulls, setPulls] = React.useState<PullSummary[]>([]);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  // Which raid nights the Pulls tab lists (newest first); null = the newest
  // raid night, following a new one as it starts.
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const [nightList, setNightList] = React.useState<CalendarNight[]>([]);
  const shownNights = React.useMemo(
    () => picked ?? (nightList[0] ? [nightList[0].night] : []),
    [picked, nightList],
  );
  const nightsKey = shownNights.join(',');
  // A pull opened from a summary stays open even if it's older than the list.
  const openedRef = React.useRef<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [difficulty, setDifficulty] = React.useState<string>(() => {
    try {
      return localStorage.getItem(DIFFICULTY_KEY) ?? 'All';
    } catch {
      return 'All';
    }
  });
  const [report, setReport] = React.useState<Report | null>(null);
  const [reportError, setReportError] = React.useState('');
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  // The pull's meters, only for the Raid DPS tile (Meters loads its own).
  const [dpsMeters, setDpsMeters] = React.useState<{
    id: string;
    data: MetersData | null;
  } | null>(null);
  const [tab, setTab] = React.useState<'report' | 'boss'>('report');
  const [canEdit, setCanEdit] = React.useState(false);
  const [expandedDeath, setExpandedDeath] = React.useState<number | null>(null);
  const [section, setSection] = React.useState<Section>(loadSection);
  const [openGroups, setOpenGroups] = React.useState<number[]>([]);
  // Expanded per-player rows in the plan and avoidable sections.
  const [openRows, setOpenRows] = React.useState<string[]>([]);
  const [view, setView] = React.useState<View>(loadView);
  // Flags from Watch live (last 30 days) and whether you're an officer.
  const [flags, setFlags] = React.useState<Flag[]>([]);
  const [officer, setOfficer] = React.useState(false);
  const [channelsOpen, setChannelsOpen] = React.useState(false);
  // Bumped after an import so the summary views reload.
  const [importTick, setImportTick] = React.useState(0);
  const [tracked, setTracked] = React.useState<string[]>([]);
  const reloadSummaries = React.useCallback(
    () => setImportTick((k) => k + 1),
    [],
  );

  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem('rf-pulldesk-view', next);
    } catch {
      // Storage unavailable: the view just isn't remembered.
    }
  };

  // Boss % from recordings, for pulls uploaded from a saved combat log.
  const bossPercentHints: BossPercentHint[] = videoState
    .filter(
      (video) =>
        video.category === VideoCategory.Raids &&
        typeof video.bossPercent === 'number' &&
        typeof video.start === 'number' &&
        typeof video.encounterID === 'number',
    )
    .map((video) => ({
      encounterId: video.encounterID as number,
      difficultyId: Number(video.difficultyID),
      start: video.start as number,
      bossPercent: video.bossPercent as number,
    }));

  // From a summary: open that pull's report in the Pulls view.
  const openPull = (id: string) => {
    openedRef.current = id;
    setSelectedId(id);
    setTab('report');
    const month = recentNights(nightList, 30, todayKey());
    if (month.length) setPicked(month);
    changeView('pulls');
  };

  // Bumping these refetches the list / the open report.
  const [listTick, setListTick] = React.useState(0);
  const [reportTick, setReportTick] = React.useState(0);
  const loadPulls = () => setListTick((tick) => tick + 1);

  React.useEffect(() => {
    let cancelled = false;

    const wanted = nightsKey ? nightsKey.split(',') : [];
    const days = daysToCover([...wanted].sort()[0], todayKey());
    // The timer and "a pull was sent" can both ask at once: only the newest
    // answer is used, so an older one never overwrites it.
    let asked = 0;
    const fetchList = () => {
      asked += 1;
      const mine = asked;
      // The calendar's nights too, so a new raid night shows up.
      call<{ nights: CalendarNight[] }>({ action: 'nights' }).then((r) => {
        if (!cancelled && mine === asked && r.ok) setNightList(r.data.nights);
      });
      return call<{ pulls: PullSummary[] }>({ action: 'list', days }).then(
        (response) => {
          if (cancelled || mine !== asked) return;
          setLoading(false);
          if (!response.ok) {
            setError(response.error);
            return;
          }
          setError('');
          const list = wanted.length
            ? response.data.pulls.filter((p) => wanted.includes(p.night))
            : response.data.pulls;
          setPulls(list);
          // Picking other nights moves to their newest pull.
          setSelectedId((current) =>
            current &&
            (current === openedRef.current ||
              list.some((p) => p.id === current))
              ? current
              : (firstPull(list)?.id ?? null),
          );
        },
      );
    };

    fetchList();
    const timer = setInterval(fetchList, REFRESH_MS);
    const unsubscribe = ipc.on('pullDeskUpdated', fetchList);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [nightsKey, listTick]);

  React.useEffect(() => {
    call<{ canEdit: boolean; trackedDifficulties?: string[] }>({
      action: 'config',
    }).then((response) => {
      if (!response.ok) return;
      setCanEdit(response.data.canEdit);
      setTracked(response.data.trackedDifficulties ?? []);
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
        setPendingId(null);
        setReport(null);
      } else if (response.data.pending) {
        setReportError('');
        setPendingId(selectedId);
        setReport(null);
      } else {
        setReportError('');
        setPendingId(null);
        setReport(response.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedId, summaryKey, reportTick]);

  React.useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    call<MetersData>({ action: 'meters', id: selectedId }).then((response) => {
      if (cancelled) return;
      setDpsMeters({
        id: selectedId,
        data: response.ok && response.data.v === 2 ? response.data : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, reportTick]);

  /** This raider's recording of the selected pull, if we have it. */
  const findVideo = (name?: string) => {
    if (!report || !report.startedAt) return undefined;
    const guid = name
      ? report.roster.find((player) => player.name === name)?.guid
      : undefined;

    const candidates = videoState.filter(
      (video) =>
        video.category === VideoCategory.Raids &&
        video.encounterID === report.encounterId &&
        video.difficultyID === report.difficultyId &&
        typeof video.start === 'number' &&
        Math.abs(video.start - (report.startedAt as number)) < VIDEO_MATCH_MS &&
        (!name ||
          (guid ? video.player?._GUID === guid : video.player?._name === name)),
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

  React.useEffect(() => {
    let cancelled = false;
    coachCall<{ flags: Flag[] }>({ action: 'flags', days: 30 }).then(
      (response) => {
        if (!cancelled && response.ok) setFlags(response.data.flags);
      },
    );
    coachCall<{ officer: boolean }>({ action: 'coachConfig' }).then(
      (response) => {
        if (!cancelled && response.ok) setOfficer(response.data.officer);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [listTick]);

  /** Flags raised on Watch live during this pull, as seconds into it. */
  const pullFlags = (r: Report) => {
    if (!r.startedAt) return [];
    const start = r.startedAt;
    return flags
      .filter(
        (f) =>
          f.at >= start - 5000 && f.at <= start + r.duration * 1000 + 10000,
      )
      .map((f) => ({ ...f, t: Math.max(0, (f.at - start) / 1000) }))
      .sort((a, b) => a.t - b.t);
  };

  // The streamer's own recording if their Discord name matches a raider,
  // otherwise anyone's recording of the pull.
  const flagVideo = (streamer: string) => {
    const match = report?.roster.find(
      (p) => p.name.toLowerCase() === streamer.toLowerCase(),
    );
    return (match && findVideo(match.name)) || findVideo();
  };

  const watch = (
    video: RendererVideo,
    seconds: number,
    lead = WATCH_LEAD_SECONDS,
  ) => {
    persistentProgressRef.current = Math.max(0, seconds - lead);
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

  const WATCH_LINK =
    'inline-flex items-center gap-x-1 whitespace-nowrap rounded-sm px-1 text-[13px] font-medium text-brand enabled:hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:cursor-default disabled:opacity-40';

  const renderWatch = (name: string, seconds: number) => {
    const video = findVideo(name);
    return (
      <button
        type="button"
        disabled={!video}
        title={
          video
            ? `Open ${name}'s recording at ${mmss(Math.max(0, seconds - WATCH_LEAD_SECONDS))}`
            : `No recording from ${name} for this pull`
        }
        onClick={() => video && watch(video, seconds)}
        className={WATCH_LINK}
      >
        <Play size={12} /> Watch
      </button>
    );
  };

  const renderFlagWatch = (streamer: string, seconds: number) => {
    const video = flagVideo(streamer);
    return (
      <button
        type="button"
        disabled={!video}
        title={
          video
            ? `Open ${video.player?._name ? `${video.player._name}'s` : 'a'} recording at ${mmss(Math.max(0, seconds - WATCH_LEAD_SECONDS))}`
            : 'No recording of this pull'
        }
        onClick={() => video && watch(video, seconds)}
        className={WATCH_LINK}
      >
        <Play size={12} /> Watch
      </button>
    );
  };

  // ---- Pull list ------------------------------------------------------------

  const renderPullList = () => {
    if (loading) return <LoadingState label="Loading pulls…" />;
    if (!pulls.length) {
      // A failed load is shown above the page, not as "no pulls".
      if (error) return null;
      return (
        <p data-state="empty" className="p-1 text-sm text-foreground">
          No pulls yet. Reports appear here a few seconds after each tracked
          raid pull ends.
        </p>
      );
    }

    // Difficulties in the list, Mythic first. The filter only shows when
    // there's more than one.
    const present = DIFFICULTY_ORDER.filter((d) =>
      pulls.some((pull) => difficultyOf(pull.difficultyId) === d),
    );
    pulls.forEach((pull) => {
      const d = difficultyOf(pull.difficultyId);
      if (!present.includes(d)) present.push(d);
    });
    const mixed = present.length > 1;
    const active = mixed && present.includes(difficulty) ? difficulty : 'All';
    const byDifficulty =
      active === 'All'
        ? pulls
        : pulls.filter((pull) => difficultyOf(pull.difficultyId) === active);

    // Resets (pulls under 10 s) are hidden unless "Show resets" is on. The
    // open pull always stays; if every pull is a reset they all show.
    const resets = byDifficulty.filter((pull) => isReset(pull));
    const onlyResets = resets.length === byDifficulty.length;
    const hiddenResets =
      showResets || onlyResets
        ? 0
        : resets.filter((pull) => pull.id !== selectedId).length;
    const shown =
      showResets || onlyResets
        ? byDifficulty
        : byDifficulty.filter(
            (pull) => !isReset(pull) || pull.id === selectedId,
          );

    const pickDifficulty = (next: string) => {
      setDifficulty(next);
      try {
        localStorage.setItem(DIFFICULTY_KEY, next);
      } catch {
        // Not remembered.
      }
      // Keep a pull selected that the list still shows.
      const visible =
        next === 'All'
          ? pulls
          : pulls.filter((pull) => difficultyOf(pull.difficultyId) === next);
      if (visible.length && !visible.some((pull) => pull.id === selectedId)) {
        setSelectedId(firstPull(visible)?.id ?? visible[0].id);
        setExpandedDeath(null);
        setOpenGroups([]);
        setReportError('');
      }
    };

    const nights: string[] = [];
    shown.forEach((pull) => {
      if (!nights.includes(pull.night)) nights.push(pull.night);
    });

    // Before the nights call answers (or if it fails) there's no night to
    // name, so the header is just the count.
    const title =
      shownNights.length === 1
        ? shownNights[0] === todayKey()
          ? 'Tonight'
          : nightLabel(shownNights[0])
        : shownNights.length > 1
          ? `${shownNights.length} nights`
          : '';

    const filter = mixed && (
      <div
        role="group"
        aria-label="Difficulty"
        className="mb-2 flex flex-wrap gap-1"
      >
        {['All', ...present].map((d) => {
          const on = d === active;
          const count =
            d === 'All'
              ? pulls.length
              : pulls.filter((pull) => difficultyOf(pull.difficultyId) === d)
                  .length;
          return (
            <button
              type="button"
              key={d}
              aria-pressed={on}
              onClick={() => pickDifficulty(d)}
              className={`h-7 px-2.5 rounded-full text-xs font-semibold border transition-colors ${
                on
                  ? 'bg-panel-line border-brand text-foreground-lighter'
                  : 'border-panel-line text-foreground hover:bg-panel'
              }`}
            >
              {d} <span className="font-normal opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
    );

    return (
      <>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-[13px] font-medium text-foreground">
            {title ? `${title} · ` : ''}
            {shown.length} {shown.length === 1 ? 'pull' : 'pulls'}
          </h2>
          <label className="flex cursor-pointer items-center gap-x-1.5 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={showResets}
              onChange={(event) => setShowResets(event.target.checked)}
              className="accent-[hsl(var(--brand))]"
            />
            Show resets{hiddenResets ? ` (${hiddenResets})` : ''}
          </label>
        </div>
        {filter}
        {onlyResets && !showResets && (
          <p className="mb-2 text-xs text-foreground">
            Every pull here was a reset (under 10 s), so they are all shown.
          </p>
        )}
        {nights.map((night) => (
          <div key={night} className="mb-3 flex flex-col gap-y-1">
            {nights.length > 1 && (
              <div className="px-1 pt-1 text-[13px] font-medium text-foreground">
                {nightLabel(night)}
              </div>
            )}
            {shown
              .filter((pull) => pull.night === night)
              .map((pull) => {
                const selected = pull.id === selectedId;
                const kill = pull.result === 'kill';
                const failed = !kill && pull.status === 'failed';
                const result = kill
                  ? 'Kill'
                  : failed
                    ? 'Failed'
                    : `${pull.bossPercent ?? '?'}%`;
                const deathText =
                  pull.deaths === null
                    ? '–'
                    : `${pull.deaths} ${pull.deaths === 1 ? 'death' : 'deaths'}`;
                return (
                  <button
                    type="button"
                    key={pull.id}
                    aria-current={selected ? 'true' : undefined}
                    title={
                      isReset(pull)
                        ? undefined
                        : `Pull ${pull.totalPullNumber} overall`
                    }
                    onClick={() => {
                      setSelectedId(pull.id);
                      setExpandedDeath(null);
                      setOpenGroups([]);
                      setReportError('');
                      setTab('report');
                    }}
                    className={`w-full rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                      selected ? 'bg-panel-line' : 'hover:bg-panel'
                    }`}
                  >
                    <div className="flex items-center gap-x-2">
                      <span className="text-[13px] tabular-nums text-foreground">
                        {pullLabel(pull, '#')}
                      </span>
                      <span className="truncate text-sm font-medium">
                        {pull.encounterName}
                      </span>
                      {mixed && active === 'All' && (
                        <span
                          title={difficultyOf(pull.difficultyId)}
                          className={`shrink-0 px-1 rounded border text-[10px] leading-4 font-bold ${
                            DIFFICULTY_BADGE[difficultyOf(pull.difficultyId)] ??
                            'border-panel-line'
                          }`}
                        >
                          {difficultyOf(pull.difficultyId).charAt(0)}
                        </span>
                      )}
                      <span
                        className={`ml-auto shrink-0 text-sm font-semibold tabular-nums ${
                          kill
                            ? 'text-green-400'
                            : failed
                              ? 'text-red-400'
                              : 'text-foreground-lighter'
                        }`}
                      >
                        {result}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground [&>span]:whitespace-nowrap">
                      {pull.startedAt ? (
                        <span className="tabular-nums">
                          {timeOfDay(pull.startedAt)} ·
                        </span>
                      ) : null}
                      <span className="tabular-nums">
                        {mmss(pull.duration)}
                      </span>
                      <span>{deathText}</span>
                      {typeof pull.avoidableHits === 'number' &&
                        pull.avoidableHits > 0 && (
                          <span>{pull.avoidableHits} avoidable</span>
                        )}
                      {pull.plan && pull.plan.missed > 0 && (
                        <span className="text-red-400">
                          {pull.plan.missed} missed
                        </span>
                      )}
                      <BossBar
                        bossPercent={pull.bossPercent}
                        kill={kill}
                        className="ml-1 min-w-[40px] flex-1"
                      />
                    </div>
                  </button>
                );
              })}
          </div>
        ))}
      </>
    );
  };

  // ---- Report -----------------------------------------------------------------

  // Report sections share one card with a header row of muted labels.
  const SECTION_CARD =
    'overflow-hidden rounded-lg border border-panel-line bg-panel text-sm';
  const columnHeader = (
    cols: { label: string; className: string }[],
  ): React.ReactNode => (
    <div
      aria-hidden="true"
      className="flex items-center gap-x-2 border-b border-panel-line px-3 py-1.5 text-[13px] font-medium text-foreground"
    >
      <span className="w-[14px] shrink-0" />
      {cols.map((col) => (
        <span key={col.label} className={col.className}>
          {col.label}
        </span>
      ))}
    </div>
  );

  // What the raider still had when they died (base cooldowns, so talents
  // that shorten a cooldown can make something ready earlier than shown).
  const renderAvailable = (death: Report['deaths'][number]) => {
    if (!death.available) {
      return (
        <span className="text-foreground">
          Re-run this report to see what was available.
        </span>
      );
    }
    const ready = death.available.filter((a) => a.status === 'ready');
    const cooling = death.available.filter((a) => a.status === 'cooldown');
    return (
      <>
        <div className="mb-1 font-semibold text-foreground-lighter">
          At death{' '}
          <span
            className="font-normal text-foreground"
            title="From the last use and the ability's base cooldown. Talents can shorten cooldowns."
          >
            (estimate)
          </span>
        </div>
        {ready.length === 0 && (
          <div className="text-foreground">Nothing was ready.</div>
        )}
        {ready.map((a) => (
          <div key={a.ability}>
            <span className="text-yellow-400">Ready</span>{' '}
            <span className={KIND_STYLE[a.kind]}>{a.ability}</span>
            <span className="text-foreground">
              {a.usedCount === 0
                ? ' · not used this pull'
                : ` · last used ${timeLabel(a.lastUsed ?? 0)}`}
            </span>
          </div>
        ))}
        {cooling.map((a) => (
          <div key={a.ability} className="text-foreground">
            On cooldown {a.ability} · ready in {mmss(a.readyIn)}
          </div>
        ))}
      </>
    );
  };

  const renderDefensives = (r: Report) => {
    const d = r.defensives;
    if (!d) {
      return (
        <EmptyState>
          Re-run this report to see defensives, potions and healthstones.
        </EmptyState>
      );
    }

    // Raiders who died first, in death order, then everyone else by name.
    const players = [...d.players].sort((a, b) => {
      if (a.diedAt !== null && b.diedAt !== null) return a.diedAt - b.diedAt;
      if (a.diedAt !== null) return -1;
      if (b.diedAt !== null) return 1;
      return a.name.localeCompare(b.name);
    });
    const raidKey = `${r.id}:raidcds`;
    const raidOpen = !openRows.includes(raidKey);

    const count = (n: number, one: string, many: string) =>
      n ? `${n} ${n === 1 ? one : many}` : '';

    return (
      <div>
        <div className={SECTION_CARD}>
          <div className="border-b border-panel-line">
            <button
              type="button"
              className="flex w-full items-center gap-x-2 px-3 py-2 text-left hover:bg-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
              onClick={() => toggleRow(raidKey)}
            >
              <ChevronRight
                size={14}
                className={`shrink-0 text-foreground transition-transform ${raidOpen ? 'rotate-90' : ''}`}
              />
              <span className="font-semibold">Raid cooldowns</span>
              <span className="text-foreground">({d.raid.length})</span>
            </button>
            {raidOpen && (
              <div className="mb-3 flex flex-wrap gap-1.5 pl-[46px] pr-3">
                {d.raid.length === 0 && (
                  <span className="text-foreground">None used.</span>
                )}
                {d.raid.map((use) => (
                  <span
                    key={`${use.t}-${use.name}-${use.ability}`}
                    className="rounded border border-panel-line bg-panel-raised px-2 py-0.5 text-[13px]"
                  >
                    <span className="font-mono text-foreground">
                      {timeLabel(use.t)}
                    </span>{' '}
                    <span className="text-brand-soft">{use.ability}</span>
                    <span className="text-foreground"> · {use.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {columnHeader([
            { label: 'Raider', className: 'w-40' },
            { label: 'Status', className: 'w-24' },
            { label: 'Used', className: 'flex-1' },
          ])}
          {players.map((player) => {
            const key = `${r.id}:def:${player.name}`;
            const open = openRows.includes(key);
            const own = player.personal;
            const parts = [
              count(own, 'defensive', 'defensives'),
              count(player.external, 'external', 'externals'),
              count(player.raid, 'raid cooldown', 'raid cooldowns'),
              count(player.potions, 'potion', 'potions'),
              count(player.healthstones, 'healthstone', 'healthstones'),
            ].filter(Boolean);
            return (
              <div
                key={player.name}
                className="border-b border-panel-line last:border-b-0"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-x-2 px-3 py-2 text-left hover:bg-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
                  onClick={() => toggleRow(key)}
                >
                  <ChevronRight
                    size={14}
                    className={`shrink-0 text-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                  />
                  <span
                    className="font-semibold w-40 truncate"
                    style={{ color: classColor(player.specId) }}
                    title={player.role || undefined}
                  >
                    {player.name}
                  </span>
                  <span className="w-24 text-xs">
                    {player.diedAt !== null ? (
                      <span className="text-red-400">
                        died {mmss(player.diedAt)}
                      </span>
                    ) : (
                      <span className="text-foreground">alive</span>
                    )}
                  </span>
                  <span className="flex-1 truncate">
                    {parts.length ? (
                      parts.join(' · ')
                    ) : (
                      <span className="text-foreground">
                        no defensives or consumables
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="bg-panel-deep py-1 pr-3">
                    {player.uses.length === 0 && (
                      <div className="py-1 pl-[22px] text-foreground">
                        Nothing tracked this pull.
                      </div>
                    )}
                    {player.uses.map((use) => (
                      <div
                        key={`${use.t}-${use.ability}`}
                        className="flex items-center gap-x-2 py-1 pl-[46px] pr-2"
                      >
                        <span className="w-40 font-mono text-foreground">
                          {timeLabel(use.t)}
                        </span>
                        <span className="w-56 truncate">
                          {use.ability}
                          {use.target && (
                            <span className="text-foreground">
                              {' '}
                              on {use.target}
                            </span>
                          )}
                        </span>
                        <span
                          className={`flex-1 text-xs ${KIND_STYLE[use.kind]}`}
                        >
                          {KIND_LABEL[use.kind]}
                        </span>
                        <span className="w-20 text-right">
                          {use.t >= 0 && renderWatch(player.name, use.t)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-foreground">
          Tracked by ability name: personal and external defensives, raid
          cooldowns, health potions and healthstones
          {d.warlockInRaid
            ? ''
            : ' (no warlock in this pull, so no healthstones)'}
          .
        </p>
      </div>
    );
  };

  // The row opens on a click anywhere; the chevron is the keyboard path
  // (the row holds the ability's own hover card and a Watch button, so the
  // row itself is not a button).
  const renderChevron = (open: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
      className="shrink-0 rounded-sm p-0.5 text-foreground hover:text-foreground-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <ChevronRight
        size={14}
        className={`transition-transform ${open ? 'rotate-90' : ''}`}
      />
    </button>
  );

  const renderDeathRow = (death: Report['deaths'][number], index: number) => {
    const kb = death.killingBlow;
    const open = expandedDeath === index;
    const ready = (death.available || []).filter((a) => a.status === 'ready');
    const readyText = ready.map((a) => a.ability).join(', ');
    return (
      <div
        key={`${death.name}-${death.t}`}
        className="border-b border-panel-line last:border-b-0"
      >
        <div className="flex items-center gap-x-3 px-3 hover:bg-panel-raised">
          <div
            onClick={() => setExpandedDeath(open ? null : index)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-x-3 py-2 text-sm"
          >
            {renderChevron(
              open,
              () => setExpandedDeath(open ? null : index),
              `Details of ${death.name}'s death at ${mmss(death.t)}`,
            )}
            <span className="w-11 shrink-0 tabular-nums text-foreground">
              {mmss(death.t)}
            </span>
            <span
              className="w-32 shrink-0 truncate font-semibold"
              style={{ color: nameColor(report?.roster, death.name) }}
              title={death.role || undefined}
            >
              {death.name}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {kb ? (
                <>
                  <AbilityName
                    name={kb.spellName}
                    spellId={kb.spellId}
                    encounterId={report?.encounterId}
                    difficultyId={report?.difficultyId}
                    canEdit={canEdit}
                  />
                  <span className="text-foreground">
                    {sourceText(kb.source)}
                    {kb.amount > 0 && ` · ${compact(kb.amount)}`}
                    {kb.overkill > 0 && ` (overkill ${compact(kb.overkill)})`}
                  </span>
                </>
              ) : (
                <span className="text-foreground">Unknown</span>
              )}
            </span>
            {death.available && (
              <span
                className="max-w-[40%] shrink truncate text-right text-xs text-foreground"
                title={
                  ready.length ? `Still available: ${readyText}` : undefined
                }
              >
                {ready.length
                  ? `Defensives ready: ${readyText}`
                  : 'No defensives ready'}
              </span>
            )}
          </div>
          <div className="shrink-0">{renderWatch(death.name, death.t)}</div>
        </div>
        {open && (
          <div className="bg-panel-deep px-3 py-2 pl-[90px] text-xs text-foreground">
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <div className="mb-1 font-semibold text-foreground-lighter">
                  Last hits
                </div>
                {death.lastHits.length === 0
                  ? 'No damage recorded in the last 10 s.'
                  : death.lastHits.map((hit) => (
                      <div key={`${hit.t}-${hit.spellId}`}>
                        <span className="tabular-nums">{mmss(hit.t)}</span>{' '}
                        {hit.spellName}
                        {sourceText(hit.source)} · {compact(hit.amount)}
                        {hit.overkill > 0 &&
                          ` (overkill ${compact(hit.overkill)})`}
                      </div>
                    ))}
              </div>
              <div>{renderAvailable(death)}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderDeaths = (r: Report) => {
    if (!r.deaths.length) {
      return (
        <div data-state="empty" className="text-sm text-foreground">
          No deaths.
        </div>
      );
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
      const toggleGroup = () =>
        setOpenGroups((groups) =>
          open ? groups.filter((g) => g !== key) : [...groups, key],
        );
      const withReady = segment.filter((i) =>
        (r.deaths[i].available || []).some(
          (a) => a.status === 'ready' && a.kind !== 'potion',
        ),
      ).length;
      rows.push(
        <div
          key={`group-${key}`}
          onClick={toggleGroup}
          className="flex cursor-pointer items-center gap-x-3 border-b border-panel-line px-3 py-2 text-sm hover:bg-panel-raised"
        >
          {renderChevron(
            open,
            toggleGroup,
            `${segment.length} deaths at ${mmss(first.t)}`,
          )}
          <span className="w-11 shrink-0 tabular-nums text-foreground">
            {mmss(first.t)}
          </span>
          <span className="w-32 shrink-0 truncate font-semibold text-red-400">
            {segment.length} raiders
          </span>
          <span className="min-w-0 flex-1 truncate">
            {first.killingBlow && (
              <AbilityName
                name={first.killingBlow.spellName}
                spellId={first.killingBlow.spellId}
                encounterId={report?.encounterId}
                difficultyId={report?.difficultyId}
                canEdit={canEdit}
              />
            )}
            <span className="text-foreground">
              {sourceText(first.killingBlow?.source)}
            </span>
          </span>
          <span className="max-w-[40%] shrink truncate text-right text-xs text-foreground">
            {first.available && withReady
              ? `${withReady} had a defensive ready`
              : ''}
          </span>
          <span className="w-12 shrink-0 text-right text-xs font-medium text-brand">
            {open ? 'Hide' : 'Show'}
          </span>
        </div>,
      );
      if (open) {
        segment.forEach((index) =>
          rows.push(renderDeathRow(r.deaths[index], index)),
        );
      }
    });

    return (
      <div className="overflow-hidden rounded-lg border border-panel-line bg-panel">
        {rows}
      </div>
    );
  };

  const renderPlan = (r: Report) => {
    const { plan } = r;
    if (!plan.parsed) {
      return (
        <EmptyState>
          No cooldown note for this boss yet. Paste wowutils&apos; Copy all
          output into Boss settings to check every assignment.
        </EmptyState>
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
            <span className="text-foreground">
              {' '}
              · {lines(plan.phaseSkipped)} timed by phase, not checked yet
            </span>
          )}
        </p>
        {!!plan.missingNames?.length && (
          <p className="text-xs text-foreground mb-2">
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
      <div className={SECTION_CARD}>
        {columnHeader([
          { label: 'Raider', className: 'w-40' },
          { label: 'Result', className: 'flex-1' },
          { label: 'Assignments', className: 'text-right' },
        ])}
        {players.map((player) => {
          const key = `${r.id}:plan:${player.name}`;
          const open = openRows.includes(key);
          const clean = player.missed === 0 && player.off === 0;
          return (
            <div
              key={player.name}
              className="border-b border-panel-line last:border-b-0"
            >
              <button
                type="button"
                className="flex w-full items-center gap-x-2 px-3 py-2 text-left hover:bg-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
                onClick={() => toggleRow(key)}
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                />
                <span
                  className="font-semibold w-40 truncate"
                  style={{ color: nameColor(r.roster, player.name) }}
                  title={roleOf(r, player.name) || undefined}
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
                    <span className="text-foreground">
                      {(!clean || player.ontime > 0) && ' · '}
                      {player.dead} skipped (dead)
                    </span>
                  )}
                </span>
                <span className="text-xs text-foreground">
                  {player.items.length}{' '}
                  {player.items.length === 1 ? 'assignment' : 'assignments'}
                </span>
              </button>
              {open && (
                <div className="bg-panel-deep py-1 pr-3">
                  {player.items.map((item) => (
                    <div
                      key={`${item.t}-${item.spellId}`}
                      className="flex items-center gap-x-2 py-1 pl-[46px] pr-2"
                    >
                      <span className="w-40 font-mono text-foreground">
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
                : 'text-foreground'
            }
          >
            {' '}
            {detail}
          </span>
        )}
      </>
    );
  };

  /**
   * One chip per avoidable hit; click to open the raider's recording just
   * before it. Reports older than 1.9.8 have no hit times until re-run.
   */
  const renderHitTimes = (
    name: string,
    times?: { t: number; end?: number; hits: number; damage: number }[],
  ) => {
    if (!times) {
      return (
        <span className="flex-1 text-xs text-foreground">
          Re-run the report to see when each hit landed
        </span>
      );
    }
    const video = findVideo(name);
    return (
      <span className="flex-1 flex flex-wrap gap-1">
        {times.map((hit) => (
          <button
            key={hit.t}
            type="button"
            disabled={!video}
            onClick={() => video && watch(video, hit.t, HIT_LEAD_SECONDS)}
            title={
              video
                ? `Watch ${name} from ${mmss(Math.max(0, hit.t - HIT_LEAD_SECONDS))}: ${hitsLabel(hit.hits)}${hit.end ? ` over ${Math.round(hit.end - hit.t)} s` : ''}, ${compact(hit.damage)} damage`
                : `No recording from ${name} for this pull`
            }
            className="inline-flex items-center gap-x-1 rounded border border-panel-line px-1.5 py-0.5 text-xs tabular-nums enabled:hover:border-brand enabled:hover:text-foreground-lighter disabled:opacity-50"
          >
            {video && <Play size={10} />}
            {mmss(hit.t)}
            {hit.hits > 1 && (
              <span className="text-foreground">×{hit.hits}</span>
            )}
          </button>
        ))}
      </span>
    );
  };

  const renderAvoidable = (r: Report) => {
    if (!r.avoidable.length) {
      return (
        <EmptyState>
          No hits from this boss&apos;s avoidable spells. Add spell IDs in Boss
          settings.
        </EmptyState>
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
          times: undefined as
            | { t: number; end?: number; hits: number; damage: number }[]
            | undefined,
        }))
        .sort((a, b) => b.hits - a.hits);

    return (
      <div className={SECTION_CARD}>
        {columnHeader([
          { label: 'Raider', className: 'w-40' },
          { label: 'Hits', className: 'w-24' },
          { label: 'Damage', className: 'w-32' },
          { label: 'Spells', className: 'flex-1' },
        ])}
        {r.avoidable.map((row) => {
          const key = `${r.id}:avoid:${row.name}`;
          const open = openRows.includes(key);
          const spells = spellsOf(row);
          return (
            <div
              key={row.name}
              className="border-b border-panel-line last:border-b-0"
            >
              <button
                type="button"
                className="flex w-full items-center gap-x-2 px-3 py-2 text-left hover:bg-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
                onClick={() => toggleRow(key)}
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                />
                <span
                  className="font-semibold w-40 truncate"
                  style={{ color: nameColor(r.roster, row.name) }}
                  title={roleOf(r, row.name) || undefined}
                >
                  {row.name}
                </span>
                <span className="w-24">{hitsLabel(row.hits)}</span>
                <span className="w-32 text-foreground">
                  {compact(row.damage)} damage
                </span>
                <span className="flex-1 truncate text-xs text-foreground">
                  {spells
                    .map((spell) => spell.spellName || `Spell ${spell.spellId}`)
                    .join(', ')}
                </span>
              </button>
              {open && (
                <div className="bg-panel-deep py-1 pr-3">
                  {spells.map((spell) => (
                    <div
                      key={spell.spellId}
                      className="flex items-center gap-x-2 py-1 pl-[46px] pr-2"
                    >
                      <span className="w-40 truncate text-foreground-lighter">
                        {spell.spellName || `Spell ${spell.spellId}`}
                      </span>
                      <span className="w-24">{hitsLabel(spell.hits)}</span>
                      <span className="w-32 text-foreground">
                        {spell.damage !== null
                          ? `${compact(spell.damage)} damage`
                          : ''}
                      </span>
                      {renderHitTimes(row.name, spell.times)}
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

  const pickSection = (next: Section) => {
    setSection(next);
    try {
      localStorage.setItem('rf-pulldesk-section', next);
    } catch {
      // Not remembered; fine.
    }
  };

  // "Open in Logs": the Logs page opens (in a new tab) on this pull.
  const openInLogs = (r: Report) => {
    const night =
      selectedSummary?.night ??
      (r.startedAt ? nightOf(r.startedAt) : todayKey());
    setLogsTarget({ night, pullId: r.id });
    if (tabsApi) {
      tabsApi.openTab({ page: Pages.Logs });
    } else {
      setAppState((prev) => ({ ...prev, page: Pages.Logs }));
    }
  };

  const sectionLabel = (label: string, badge: string, alert = false) => (
    <>
      {label}
      {badge && (
        <span
          className={`text-xs font-normal ${alert ? 'text-red-400' : 'text-foreground'}`}
        >
          {badge}
        </span>
      )}
    </>
  );

  const renderReport = () => {
    if (reportError) {
      return (
        <ErrorState
          what="Couldn't load this report"
          error={reportError}
          onRetry={() => setReportTick((tick) => tick + 1)}
        />
      );
    }
    // While a newly picked pull loads, don't show the previous one.
    if (pendingId === selectedId && (!report || report.id !== selectedId)) {
      return <LoadingState label="Still analyzing this pull…" />;
    }
    if (!report || report.id !== selectedId) {
      return pulls.length ? <LoadingState label="Loading the report…" /> : null;
    }

    const r = report;
    const kill = r.result === 'kill';
    const flagsHere = pullFlags(r);
    const wholeRaidVideo = findVideo();
    const meters = dpsMeters && dpsMeters.id === r.id ? dpsMeters.data : null;
    const consumables = consumablesStat(r.prep);

    return (
      <div className="flex flex-col gap-y-4">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="font-display text-[22px] font-bold leading-tight text-foreground-lighter">
                {pullLabel(r)} · {r.encounterName}
              </h2>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span
                  className={`font-semibold tabular-nums ${kill ? 'text-green-400' : 'text-foreground-lighter'}`}
                >
                  {kill ? 'Kill' : `${r.bossPercent ?? '?'}%`} ·{' '}
                  {mmss(r.duration)}
                </span>
                <span
                  className="text-[13px] text-foreground"
                  title={
                    isReset(r)
                      ? r.difficulty
                      : `Pull ${r.totalPullNumber} overall · ${r.difficulty}`
                  }
                >
                  {r.startedAt ? `${dateTime(r.startedAt)} · ` : ''}
                  {r.difficulty} · log from {r.uploadedBy || 'unknown'}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={!wholeRaidVideo}
                title={
                  wholeRaidVideo
                    ? `Open ${wholeRaidVideo.player?._name ? `${wholeRaidVideo.player._name}'s` : 'a'} recording at the pull start`
                    : 'No recording of this pull'
                }
                onClick={() => wholeRaidVideo && watch(wholeRaidVideo, 0, 0)}
              >
                <Play size={14} /> Watch pull
              </button>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => openInLogs(r)}
                title="Open this pull on the Logs page"
              >
                <BarChart3 size={14} /> Open in Logs
              </button>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={reanalyze}
                title="Rebuild this report with the current note and avoidable list"
              >
                <RefreshCw size={14} /> Re-run
              </button>
            </div>
          </div>
          {r.wipe?.text && (
            <p className="mt-2 text-sm text-foreground-lighter">
              {r.wipe.text}
            </p>
          )}
        </div>

        <StatTiles
          tiles={[
            {
              key: 'dps',
              label: 'Raid DPS',
              stat:
                dpsMeters && dpsMeters.id === r.id
                  ? raidDpsStat(meters, compact)
                  : 'loading',
            },
            { key: 'deaths', label: 'Deaths', stat: deathsStat(r.deaths) },
            {
              key: 'avoidable',
              label: 'Avoidable hits',
              stat: avoidableStat(r.avoidable, r.spellNames),
            },
            { key: 'consumables', label: 'Consumables', stat: consumables },
          ]}
        />

        <BossHealthChart
          curve={r.bossHpCurve ?? []}
          duration={r.duration}
          deaths={r.deaths}
          flags={flagsHere.map((f) => ({ t: f.t, label: f.note || 'Flagged' }))}
          canWatchDeath={(death) => Boolean(findVideo(death.name))}
          onWatchDeath={(death) => {
            const video = findVideo(death.name);
            if (video) watch(video, death.t);
          }}
        />

        {flagsHere.length > 0 && (
          <div className="flex flex-col gap-y-1">
            {flagsHere.map((f) => (
              <div key={f.id} className="flex items-center gap-x-2 text-sm">
                <span className="font-semibold tabular-nums text-brand">
                  ⚑ {mmss(f.t)}
                </span>
                <span className="text-foreground-lighter">
                  {f.note || 'Flagged'}
                </span>
                <span className="text-xs text-foreground">
                  {f.by}
                  {f.streamer ? ` watching ${f.streamer}` : ''}
                </span>
                {renderFlagWatch(f.streamer, f.t)}
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="mb-3 border-b border-panel-line">
            <UnderlineTabs<Section>
              label="Pull sections"
              value={section}
              onChange={pickSection}
              items={[
                {
                  key: 'deaths',
                  label: sectionLabel('Deaths', String(r.deaths.length)),
                },
                { key: 'meters', label: 'Meters' },
                {
                  key: 'defensives',
                  label: sectionLabel(
                    'Defensives',
                    r.defensives
                      ? String(
                          r.defensives.players.reduce(
                            (n, p) => n + p.uses.length,
                            0,
                          ),
                        )
                      : '',
                  ),
                },
                {
                  key: 'plan',
                  label: sectionLabel(
                    'Cooldown plan',
                    r.plan.parsed
                      ? r.plan.summary.missed
                        ? `${r.plan.summary.missed} missed`
                        : 'all good'
                      : '',
                    r.plan.summary.missed > 0,
                  ),
                },
                {
                  key: 'avoidable',
                  label: sectionLabel(
                    'Avoidable hits',
                    String(r.avoidable.length),
                  ),
                },
                { key: 'consumables', label: 'Consumables & buffs' },
              ]}
            />
          </div>
          {section === 'deaths' && renderDeaths(r)}
          {section === 'meters' && (
            <WatchContext.Provider value={recordingWatch}>
              <PullMeters
                key={r.id}
                pullId={r.id}
                encounterId={r.encounterId}
                difficultyId={r.difficultyId}
              />
            </WatchContext.Provider>
          )}
          {section === 'defensives' && renderDefensives(r)}
          {section === 'plan' && renderPlan(r)}
          {section === 'avoidable' && renderAvoidable(r)}
          {section === 'consumables' && (
            <ConsumablesPanel prep={r.prep ?? null} scope="This pull" />
          )}
        </div>
      </div>
    );
  };

  // ---- Boss settings ------------------------------------------------------------

  const currentReport = report && report.id === selectedId ? report : null;
  const encounterId =
    selectedSummary?.encounterId ?? currentReport?.encounterId;

  const viewTabs: { key: View; label: string }[] = [
    { key: 'pulls', label: 'Pulls' },
    { key: 'night', label: 'Night summary' },
    { key: 'progression', label: 'Progression' },
    { key: 'reclears', label: 'Reclears' },
    { key: 'compare', label: 'Compare' },
    { key: 'journal', label: 'Journal' },
  ];

  const actions = (
    <>
      {view === 'pulls' && (
        <>
          <NightPicker
            showLabel={false}
            nights={nightList}
            night={shownNights[0] ?? ''}
            picked={shownNights}
            onPick={(n) => setPicked([n])}
            onPickMany={setPicked}
          />
          <button
            type="button"
            className={`${SECONDARY_BUTTON} w-9 justify-center px-0`}
            aria-label="Refresh"
            title="Refresh"
            onClick={() => loadPulls()}
          >
            <RefreshCw size={14} />
          </button>
        </>
      )}
      {view !== 'pulls' && view !== 'journal' && (
        <>
          <UploadFromLog
            hints={bossPercentHints}
            tracked={tracked}
            onUploaded={reloadSummaries}
          />
          {canEdit && <ImportFromLogs onImported={reloadSummaries} />}
        </>
      )}
      {officer && (
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => setChannelsOpen(true)}
          aria-label="Personal channels"
          title="Personal channels: which raider owns which Discord channel, for sending clips"
        >
          Channels
        </button>
      )}
      <PersonalChannelsDialog
        open={channelsOpen}
        onOpenChange={setChannelsOpen}
      />
    </>
  );

  return (
    <div className="flex flex-col w-full h-full bg-walnut text-foreground-lighter pt-[32px]">
      <PageHeader
        title="Dashboard"
        tabs={viewTabs}
        tab={view}
        onTab={changeView}
        actions={actions}
        className="px-7 pt-5"
      />

      {error && (
        <div className="px-7 pt-4">
          <ErrorState
            what="Couldn't load the pulls"
            error={error}
            onRetry={() => loadPulls()}
          />
        </div>
      )}

      {view !== 'pulls' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-7 py-4 flex flex-col gap-y-4">
          {view === 'night' && (
            <NightSummaryView
              key={importTick}
              onOpenPull={openPull}
              canEdit={canEdit}
            />
          )}
          {view === 'progression' && (
            <ProgressionView
              key={`p${importTick}`}
              phase="progression"
              onOpenPull={openPull}
              canEdit={canEdit}
              onShowReclears={() => changeView('reclears')}
            />
          )}
          {view === 'compare' && (
            <ProgressionView
              key={`c${importTick}`}
              phase="progression"
              compareMode
              onOpenPull={openPull}
              canEdit={canEdit}
            />
          )}
          {view === 'reclears' && (
            <ProgressionView
              key={`r${importTick}`}
              phase="reclear"
              onOpenPull={openPull}
              canEdit={canEdit}
              onShowReclears={() => changeView('progression')}
            />
          )}
          {view === 'journal' && <JournalView canEdit={canEdit} />}
        </div>
      )}

      <div
        className={`flex flex-1 min-h-0 gap-x-6 px-7 pt-4 ${view === 'pulls' ? '' : 'hidden'}`}
      >
        <div className="w-[280px] shrink-0 overflow-y-auto pb-4 pr-1">
          {renderPullList()}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          {encounterId !== undefined && (
            <div className="mb-3 border-b border-panel-line">
              <UnderlineTabs<'report' | 'boss'>
                label="Report or boss settings"
                value={tab}
                onChange={setTab}
                items={[
                  { key: 'report', label: 'Report' },
                  {
                    key: 'boss',
                    label: (
                      <>
                        <Settings2 size={14} /> Boss settings
                      </>
                    ),
                  },
                ]}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto pb-4">
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
    return <p className="text-foreground">{message || 'Loading…'}</p>;
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
        <p className="text-xs text-foreground">
          Paste wowutils&apos; Copy all output (the same note you Send in NSRT),
          or an MRT-style note. Every line with a time, a spell and a tagged
          raider is checked against what they cast. Text reminders and lines
          timed in later phases are skipped for now.
          {settings.noteUpdatedAt &&
            ` Last saved ${dateTime(settings.noteUpdatedAt)} by ${settings.noteUpdatedBy}.`}
        </p>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={!canEdit}
          className="font-mono text-xs min-h-[180px] max-h-[360px]"
          spellCheck={false}
        />
        {lastParse && lastParse.parsed > 0 && (
          <p className="text-xs text-foreground">
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
        <p className="text-xs text-foreground">
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
          <p className="text-xs text-foreground">
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
        <p className="text-xs text-foreground">
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
