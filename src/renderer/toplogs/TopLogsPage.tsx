/**
 * [RoomFortyRecorder] Top logs (1.9.96): Warcraft Logs' top 25 kills per
 * boss, difficulty and spec, Lorrgs-style, with the spec's main cooldowns on
 * the fight clock; Race me opens a Time trial against any raider's pull.
 */
import React from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Flag,
  RefreshCw,
  Timer,
} from 'lucide-react';
import { BossButton, loadSeason, MODE_TEXT } from '../logs/BossStrip';
import { zoneBosses } from '../logs/bossStripModel';
import type { SeasonBoss } from '../logs/bossStripModel';
import SpellIcon from '../logs/SpellIcon';
import { classColor, compact, mmss } from '../logs/format';
import { useTabTitle } from '../tabs/tabs';
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
import { wclUrl } from './trial';

type Rankings = {
  encounterId: number;
  difficultyId: number;
  specId: number;
  metric: 'dps' | 'hps';
  region: string;
  at: number;
  rows: RankRow[];
  pending: number;
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
}: {
  row: RankRow;
  max: number;
  shown: Set<number>;
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
        Fetching casts…
      </span>
    )}
    {row.state === 'failed' && (
      <span
        className="absolute inset-0 flex items-center px-2 text-xs text-red-400 truncate"
        title={row.error}
      >
        Couldn&apos;t fetch this log
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
          <SpellIcon spellId={id} />
        </span>
      ))}
  </div>
);

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
  const [poll, setPoll] = React.useState(0);
  const key = `${choice.encounterId}:${choice.difficultyId}:${choice.specId}:${choice.region}`;

  React.useEffect(() => {
    if (!choice.encounterId) return undefined;
    let live = true;
    call<Rankings>({
      action: 'topRankings',
      encounterId: choice.encounterId,
      difficultyId: choice.difficultyId,
      specId: choice.specId,
      region: choice.region,
    }).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setData(r.data);
    });
    return () => {
      live = false;
    };
  }, [key, poll, choice]);

  // Casts arrive a row at a time: ask again every few seconds.
  React.useEffect(() => {
    if (!data?.pending) return undefined;
    const timer = setTimeout(() => setPoll((n) => n + 1), 3000);
    return () => clearTimeout(timer);
  }, [data]);

  const labels = useSpellNames((data?.cooldowns ?? []).map((c) => c.spellId));

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data)
    return <p className="text-sm text-foreground">Loading rankings…</p>;
  if (!data.rows.length) {
    return (
      <p className="text-sm text-foreground">
        Warcraft Logs has no ranked kills for this spec yet.
      </p>
    );
  }

  const max = Math.max(...data.rows.map((r) => r.duration), 1);
  const shown = new Set(
    data.cooldowns.map((c) => c.spellId).filter((id) => !hidden.has(id)),
  );
  const toggle = (id: number) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const unit = data.metric === 'hps' ? 'HPS' : 'DPS';

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-2 flex-wrap gap-y-1 text-xs">
        <span className="text-foreground mr-1">Main cooldowns</span>
        {data.cooldowns.length === 0 && (
          <span className="text-foreground">
            {data.pending
              ? 'worked out once a few logs are in…'
              : 'none stood out'}
          </span>
        )}
        {data.cooldowns.map((c) => (
          <button
            key={c.spellId}
            type="button"
            onClick={() => toggle(c.spellId)}
            title={`${Math.round(c.share * 100)}% of these players use it; median ${c.medianCasts} per fight${
              c.cooldown ? `, about ${c.cooldown} s apart at the shortest` : ''
            }. Click to hide or show.`}
            className={`flex items-center gap-x-1 rounded-full border px-2 py-0.5 ${
              hidden.has(c.spellId)
                ? 'border-card text-foreground/50'
                : 'border-foreground/40 text-foreground-lighter'
            }`}
          >
            <SpellIcon spellId={c.spellId} />
            {labels[c.spellId] || `Spell ${c.spellId}`}
          </button>
        ))}
        <span className="ml-auto text-foreground">
          {data.pending ? `${data.pending} logs still coming · ` : ''}
          Rankings from {new Date(data.at).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-[28px_minmax(140px,180px)_70px_48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
        <span />
        <span className="text-xs text-foreground">Player</span>
        <span className="text-xs text-foreground text-right">{unit}</span>
        <span className="text-xs text-foreground text-right">Time</span>
        <div className="relative h-4 text-[10px] text-foreground">
          {ticks(max).map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2"
              style={{ left: `${(t / max) * 100}%` }}
            >
              {mmss(t)}
            </span>
          ))}
        </div>
        <span />
        {data.rows.map((row) => (
          <React.Fragment key={`${row.code}:${row.fight}:${row.name}`}>
            <span className="text-xs text-foreground text-right">
              {row.rank}
            </span>
            <span className="min-w-0">
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
              </span>
            </span>
            <span className="text-sm text-right tabular-nums">
              {compact(row.amount)}
            </span>
            <span className="text-xs text-right tabular-nums text-foreground">
              {mmss(row.duration)}
            </span>
            <Lane row={row} max={max} shown={shown} />
            <span className="flex gap-x-1">
              <button
                type="button"
                onClick={() => onRace(row, data)}
                className="flex items-center gap-x-1 rounded border border-brand/60 px-2 py-1 text-xs text-brand hover:bg-brand/10"
              >
                <Timer size={12} /> Race me
              </button>
              <button
                type="button"
                title="Open on Warcraft Logs"
                onClick={() =>
                  ipc.sendMessage('openURL', [
                    wclUrl(row.code, row.fight, data.metric),
                  ])
                }
                className="flex items-center gap-x-1 rounded border border-card px-2 py-1 text-xs text-foreground-lighter hover:bg-card/50"
              >
                <ExternalLink size={12} /> Open log
              </button>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const TopLogsPage = () => {
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
          <span className="font-display text-lg font-bold mr-1">Top logs</span>
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
            <Flag size={14} /> No raid bosses yet: set GUILD_CLOUD_RAID_ZONE in
            the server&apos;s .env.
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
  );
};

export default TopLogsPage;
