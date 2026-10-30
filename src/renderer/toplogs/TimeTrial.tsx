/**
 * [RoomFortyRecorder] Time trial (1.9.96): race a top log with any raider's
 * pull of the same boss. Race chart with the gap, the spec's main cooldowns
 * as lanes (you vs them), and "where the time went".
 */
import React from 'react';
import { Timer } from 'lucide-react';
import { usePullStores } from '../logs/load';
import type { PullMeta } from '../logs/store';
import SpellIcon from '../logs/SpellIcon';
import { classColor, compact, mmss } from '../logs/format';
import {
  amountAt,
  Cooldown,
  gapSeries,
  insights,
  ourTrack,
  raidersOf,
  Track,
} from './trial';
import { call, RankRow, specTitle, ticks, useSpellNames } from './shared';

type OurPull = {
  id: string;
  night: string;
  pullNumber: number;
  result: string;
  bossPercent: number | null;
  duration: number;
  startedAt?: number | null;
  createdAt: number;
  encounterId: number;
  difficultyId: number;
};

const CHARACTER_KEY = 'rf-trial-character';
const YOU = '#CCA85C'; // brand brass
const THEM = '#7fb4e6';
const AHEAD = '#4ade80';
const BEHIND = '#f87171';

const pullLabel = (p: OurPull) =>
  `${new Date(`${p.night}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} · Pull ${p.pullNumber} · ${
    p.result === 'kill'
      ? `Kill ${mmss(p.duration)}`
      : `${p.bossPercent ?? '?'}% at ${mmss(p.duration)}`
  }`;

/** Cumulative lines (you, them) and the gap under them; hover for values. */
const RaceChart = ({
  you,
  them,
  marker,
  setMarker,
}: {
  you: Track;
  them: Track;
  marker: number | null;
  setMarker: (t: number | null) => void;
}) => {
  const max = Math.max(you.duration, them.duration, 1);
  const top = Math.max(
    you.amounts[you.amounts.length - 1] ?? 0,
    them.amounts[them.amounts.length - 1] ?? 0,
    1,
  );
  const gap = gapSeries(you, them);
  const gapMax = Math.max(1, ...gap.map((g) => Math.abs(g)));
  const W = 1000;
  const H = 220;
  const GH = 90;
  const x = (t: number) => (t / max) * W;
  const line = (track: Track) =>
    `M0,${H} ${track.amounts
      .map(
        (v, i) => `L${x(i + 1).toFixed(1)},${(H - (v / top) * H).toFixed(1)}`,
      )
      .join(' ')}`;
  const mid = GH / 2;
  const gapPath = `M0,${mid} ${gap
    .map(
      (g, i) =>
        `L${x(i + 1).toFixed(1)},${(mid - (g / gapMax) * mid).toFixed(1)}`,
    )
    .join(' ')} L${x(gap.length).toFixed(1)},${mid} Z`;
  const ref = React.useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const t = Math.max(
      0,
      Math.min(max, ((e.clientX - r.left) / r.width) * max),
    );
    setMarker(Math.round(t));
  };
  const at = marker ?? null;
  const y = at !== null ? amountAt(you, at) : 0;
  const th = at !== null ? amountAt(them, at) : 0;

  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex items-center gap-x-4 text-xs h-5">
        <span className="flex items-center gap-x-1">
          <span
            className="inline-block w-3 h-0.5"
            style={{ background: YOU }}
          />
          {you.name}
        </span>
        <span className="flex items-center gap-x-1">
          <span
            className="inline-block w-3 h-0.5"
            style={{ background: THEM }}
          />
          {them.name}
        </span>
        {at !== null && (
          <span className="ml-auto tabular-nums text-foreground-lighter">
            {mmss(at)} · you {compact(y)} · them {compact(th)} ·{' '}
            <span style={{ color: y >= th ? AHEAD : BEHIND }}>
              {y >= th ? '+' : ''}
              {compact(y - th)}
            </span>
          </span>
        )}
      </div>
      <div
        ref={ref}
        className="relative cursor-crosshair"
        onMouseMove={move}
        onMouseLeave={() => setMarker(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-[220px] block rounded bg-background/40"
        >
          {ticks(max).map((t) => (
            <line
              key={t}
              x1={x(t)}
              x2={x(t)}
              y1={0}
              y2={H}
              stroke="currentColor"
              className="text-card"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {(them.phases ?? []).slice(1).map(([t]) => (
            <line
              key={`p${t}`}
              x1={x(t)}
              x2={x(t)}
              y1={0}
              y2={H}
              stroke={THEM}
              strokeDasharray="4 4"
              opacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={line(them)}
            fill="none"
            stroke={THEM}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line(you)}
            fill="none"
            stroke={YOU}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {at !== null && (
            <line
              x1={x(at)}
              x2={x(at)}
              y1={0}
              y2={H}
              stroke="white"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="mt-1 text-[10px] text-foreground">Gap (you − them)</div>
        <svg
          viewBox={`0 0 ${W} ${GH}`}
          preserveAspectRatio="none"
          className="w-full h-[90px] block rounded bg-background/40"
        >
          <defs>
            <clipPath id="tt-above">
              <rect x={0} y={0} width={W} height={mid} />
            </clipPath>
            <clipPath id="tt-below">
              <rect x={0} y={mid} width={W} height={mid} />
            </clipPath>
          </defs>
          <path
            d={gapPath}
            fill={AHEAD}
            opacity={0.5}
            clipPath="url(#tt-above)"
          />
          <path
            d={gapPath}
            fill={BEHIND}
            opacity={0.5}
            clipPath="url(#tt-below)"
          />
          <line
            x1={0}
            x2={W}
            y1={mid}
            y2={mid}
            stroke="currentColor"
            className="text-foreground"
            opacity={0.4}
            vectorEffect="non-scaling-stroke"
          />
          {at !== null && (
            <line
              x1={x(at)}
              x2={x(at)}
              y1={0}
              y2={GH}
              stroke="white"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
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
      </div>
    </div>
  );
};

/** Each main cooldown: when you pressed it and when they did. */
const CooldownLanes = ({
  you,
  them,
  cooldowns,
  names,
  marker,
}: {
  you: Track;
  them: Track;
  cooldowns: Cooldown[];
  names: Record<number, string>;
  marker: number | null;
}) => {
  const max = Math.max(you.duration, them.duration, 1);
  const lane = (track: Track, id: number, color: string) => (
    <div className="relative h-6 rounded bg-background/40">
      <div
        className="absolute inset-y-0 left-0 bg-card/30 rounded"
        style={{ width: `${(track.duration / max) * 100}%` }}
      />
      {track.casts
        .filter((c) => c[1] === id)
        .map(([t]) => (
          <span
            key={t}
            className="absolute top-[3px] -translate-x-1/2 rounded-[4px]"
            style={{
              left: `${(t / max) * 100}%`,
              boxShadow: `0 0 0 1.5px ${color}`,
            }}
            title={mmss(t)}
          >
            <SpellIcon spellId={id} />
          </span>
        ))}
      {marker !== null && (
        <div
          className="absolute inset-y-0 w-px bg-white/50"
          style={{ left: `${(marker / max) * 100}%` }}
        />
      )}
    </div>
  );
  if (!cooldowns.length) {
    return (
      <p className="text-xs text-foreground">
        No main cooldowns stood out for this spec yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(120px,170px)_40px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5">
      {cooldowns.map((cd) => (
        <React.Fragment key={cd.spellId}>
          <span className="row-span-2 flex items-center gap-x-1.5 min-w-0 text-xs">
            <SpellIcon spellId={cd.spellId} />
            <span className="truncate">
              {names[cd.spellId] || `Spell ${cd.spellId}`}
            </span>
          </span>
          <span className="text-[10px]" style={{ color: YOU }}>
            You
          </span>
          {lane(you, cd.spellId, YOU)}
          <span className="text-[10px]" style={{ color: THEM }}>
            Them
          </span>
          {lane(them, cd.spellId, THEM)}
        </React.Fragment>
      ))}
    </div>
  );
};

const TimeTrial = ({
  them,
  specId,
  metric,
  cooldowns,
  encounterId,
  difficultyId,
  bossName,
}: {
  them: RankRow;
  specId: number;
  metric: 'dps' | 'hps';
  cooldowns: Cooldown[];
  encounterId: number;
  difficultyId: number;
  bossName: string;
}) => {
  const [track, setTrack] = React.useState<Track | null>(null);
  const [trackState, setTrackState] = React.useState<
    'loading' | 'queued' | 'failed'
  >('loading');
  const [trackError, setTrackError] = React.useState('');
  const [poll, setPoll] = React.useState(0);
  const [pulls, setPulls] = React.useState<OurPull[] | null>(null);
  const [pullsError, setPullsError] = React.useState('');
  const [pullId, setPullId] = React.useState('');
  const [character, setCharacter] = React.useState(() => {
    try {
      return localStorage.getItem(CHARACTER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [marker, setMarker] = React.useState<number | null>(null);

  // Their track (casts and amounts) from the guild server; it may take a
  // little while the first time (Warcraft Logs is asked then).
  React.useEffect(() => {
    let live = true;
    call<{ state: string; track?: Track; error?: string }>({
      action: 'topTrial',
      code: them.code,
      fight: them.fight,
      name: them.name,
      metric,
    }).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setTrackState('failed');
        setTrackError(r.error);
      } else if (r.data.state === 'ready' && r.data.track) {
        setTrack(r.data.track);
      } else if (r.data.state === 'failed') {
        setTrackState('failed');
        setTrackError(r.data.error || 'Warcraft Logs refused');
      } else {
        setTrackState('queued');
        setTimeout(() => live && setPoll((n) => n + 1), 3000);
      }
    });
    return () => {
      live = false;
    };
  }, [them, metric, poll]);

  React.useEffect(() => {
    call<{ pulls: OurPull[] }>({
      action: 'topOurs',
      encounterId,
      difficultyId,
    }).then((r) => {
      if (!r.ok) {
        setPullsError(r.error);
        return;
      }
      setPulls(r.data.pulls);
      setPullId((id) => id || r.data.pulls[0]?.id || '');
    });
  }, [encounterId, difficultyId]);

  const pull = pulls?.find((p) => p.id === pullId);
  const metas: PullMeta[] = React.useMemo(
    () =>
      pull
        ? [
            {
              id: pull.id,
              label: `Pull ${pull.pullNumber}`,
              encounterId: pull.encounterId,
              difficultyId: pull.difficultyId,
              startedAt: pull.startedAt ?? 0,
              result: pull.result,
            },
          ]
        : [],
    [pull],
  );
  const load = usePullStores(metas);
  const store = load.stores[0];
  const raiders = React.useMemo(() => (store ? raidersOf(store) : []), [store]);
  // Same spec first; the remembered character when they were there.
  const sorted = [...raiders].sort(
    (a, b) =>
      Number(b.specId === specId) - Number(a.specId === specId) ||
      a.name.localeCompare(b.name),
  );
  const me =
    raiders.find((r) => r.name === character) ??
    sorted.find((r) => r.specId === specId) ??
    sorted[0];
  const myGuid = me?.guid ?? '';
  // The React Compiler keeps this until the pull, raider or metric change.
  const you = store && myGuid ? ourTrack(store, myGuid, metric) : null;
  const names = useSpellNames(cooldowns.map((c) => c.spellId));
  const list = you && track ? insights(you, track, cooldowns, names) : [];

  const pickCharacter = (name: string) => {
    setCharacter(name);
    try {
      localStorage.setItem(CHARACTER_KEY, name);
    } catch {
      // Not remembered.
    }
  };
  const field =
    'bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background';
  const loadingPct = pull ? load.progress[pull.id] : undefined;

  return (
    <div className="flex flex-col gap-y-4 max-w-[1400px]">
      <div className="flex items-center gap-x-3 flex-wrap gap-y-2">
        <Timer size={18} className="text-brand" />
        <span className="font-display text-lg font-bold">Time trial</span>
        <span className="text-sm">
          vs{' '}
          <span className="font-semibold" style={{ color: classColor(specId) }}>
            #{them.rank} {them.name}
          </span>{' '}
          <span className="text-foreground">
            ({specTitle(specId)}, {bossName}, {compact(them.amount)}{' '}
            {metric === 'hps' ? 'HPS' : 'DPS'}, {mmss(them.duration)})
          </span>
        </span>
      </div>

      <div className="flex items-center gap-x-3 flex-wrap gap-y-2 text-sm">
        <label className="flex items-center gap-x-2">
          Our pull
          <select
            className={field}
            value={pullId}
            onChange={(e) => setPullId(e.target.value)}
            disabled={!pulls?.length}
          >
            {(pulls ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {pullLabel(p)}
              </option>
            ))}
          </select>
        </label>
        {raiders.length > 0 && (
          <label className="flex items-center gap-x-2">
            Raider
            <select
              className={field}
              value={me?.name ?? ''}
              onChange={(e) => pickCharacter(e.target.value)}
            >
              {sorted.map((r) => (
                <option key={r.guid} value={r.name}>
                  {r.name} ({specTitle(r.specId)})
                </option>
              ))}
            </select>
          </label>
        )}
        {me && me.specId !== specId && (
          <span className="text-xs text-yellow-400">
            {me.name} played {specTitle(me.specId)} that pull.
          </span>
        )}
      </div>

      {pullsError && <p className="text-sm text-red-400">{pullsError}</p>}
      {pulls && !pulls.length && (
        <p className="text-sm text-foreground">
          No pulls of ours with a full log on this boss and difficulty yet.
        </p>
      )}
      {pull && load.errors[pull.id] && (
        <p className="text-sm text-red-400">{load.errors[pull.id]}</p>
      )}
      {pull && !store && !load.errors[pull.id] && (
        <p className="text-sm text-foreground">
          Loading our log
          {loadingPct !== undefined ? ` ${Math.round(loadingPct * 100)}%` : ''}…
        </p>
      )}
      {!track && trackState !== 'failed' && (
        <p className="text-sm text-foreground">
          {trackState === 'queued'
            ? 'Asking Warcraft Logs for their damage and casts (only the first time)…'
            : 'Loading their log…'}
        </p>
      )}
      {!track && trackState === 'failed' && (
        <p className="text-sm text-red-400">{trackError}</p>
      )}

      {you && track && (
        <>
          <RaceChart
            you={you}
            them={track}
            marker={marker}
            setMarker={setMarker}
          />
          <div>
            <div className="text-sm font-semibold mb-2">Main cooldowns</div>
            <CooldownLanes
              you={you}
              them={track}
              cooldowns={cooldowns}
              names={names}
              marker={marker}
            />
          </div>
          <div>
            <div className="text-sm font-semibold mb-2">
              Where the time went
            </div>
            {list.length ? (
              <ul className="flex flex-col gap-y-1 text-sm">
                {list.map((i) => (
                  <li key={i.text}>
                    {i.at !== undefined ? (
                      <button
                        type="button"
                        className="text-left hover:text-brand"
                        onClick={() => setMarker(Math.round(i.at ?? 0))}
                      >
                        {i.text}
                      </button>
                    ) : (
                      i.text
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground">Nothing stood out.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TimeTrial;
