/**
 * [RoomFortyRecorder] Time trial (1.9.96): race a top log with any raider's
 * pull of the same boss. Since 1.9.102 it's one timeline (TrialTimeline):
 * our boss's casts and phases, phase pacing, DPS, the gap and the main
 * cooldowns (merged by name) on one time axis, lined up by pull start or
 * by each phase; then "where the time went".
 */
import React from 'react';
import { ClipboardCopy, Play, Timer } from 'lucide-react';
import { Tooltip } from '../components/Tooltip/Tooltip';
import { WatchContext } from '../Meters';
import { usePullStores } from '../logs/load';
import type { PullMeta } from '../logs/store';
import { classColor, compact, mmss } from '../logs/format';
import { Cooldown, ourTrack, raidersOf, Track, vodInfo } from './trial';
import {
  alignByPhase,
  asIs,
  bossCasts,
  enemyCasts,
  gapSoFar,
  mergeByName,
  ourPhases,
  perSecond,
  phasesOf,
} from './timeline';
import { findings } from './whereTime';
import WhereTimeWent from './WhereTimeWent';
import CopyNsrt from './CopyNsrt';
import TrialTimeline from './TrialTimeline';
import { call, RankRow, specTitle, useSpellNames } from './shared';

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
const LINE_UP_KEY = 'rf-trial-line-up';
type LineUp = 'start' | 'phase';

const pullLabel = (p: OurPull) =>
  `${new Date(`${p.night}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} · Pull ${p.pullNumber} · ${
    p.result === 'kill'
      ? `Kill ${mmss(p.duration)}`
      : `${p.bossPercent ?? '?'}% at ${mmss(p.duration)}`
  }`;

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
  const [nsrtOpen, setNsrtOpen] = React.useState(false);
  const [lineUp, setLineUpState] = React.useState<LineUp>(() => {
    try {
      return localStorage.getItem(LINE_UP_KEY) === 'phase' ? 'phase' : 'start';
    } catch {
      return 'start';
    }
  });
  const setLineUp = (v: LineUp) => {
    setLineUpState(v);
    try {
      localStorage.setItem(LINE_UP_KEY, v);
    } catch {
      // Not remembered.
    }
  };

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
  // One row per cooldown name (a spell can have several IDs).
  const cds = mergeByName(cooldowns, { ...(track?.names ?? {}), ...names });
  const boss = store ? bossCasts(store) : [];
  const theirPhases = track ? phasesOf(track) : [];
  const ours =
    store && track ? ourPhases(track, enemyCasts(store), store.duration) : [];
  const canLineUp = ours.length > 1;
  let aligned = null;
  if (track) {
    aligned =
      lineUp === 'phase' && canLineUp ? alignByPhase(track, ours) : asIs(track);
  }
  const unit = metric === 'hps' ? 'HPS' : 'DPS';
  const list =
    you && track && aligned ? findings(you, track, aligned, cds, unit) : [];
  const gap = you && aligned ? gapSoFar(perSecond(you), aligned.rates) : [];
  const [shown, setShown] = React.useState<number | null>(null);
  const shownFinding = shown !== null ? list[shown] : undefined;
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const show = (i: number | null) => {
    setShown(i);
    if (i !== null)
      timelineRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
  };

  const pickCharacter = (name: string) => {
    setCharacter(name);
    try {
      localStorage.setItem(CHARACTER_KEY, name);
    } catch {
      // Not remembered.
    }
  };
  // Our raider's recording of the pull (else anyone's who recorded it).
  const watcher = React.useContext(WatchContext);
  const pullRef =
    pull && pull.startedAt
      ? {
          encounterId: pull.encounterId,
          difficultyId: pull.difficultyId,
          startedAt: pull.startedAt,
        }
      : null;
  const vod = vodInfo(
    watcher && pullRef ? watcher.owner(pullRef, me?.name ?? null) : null,
    me?.name ?? '',
  );
  const watch = (t: number) => {
    if (watcher && pullRef) watcher.open(pullRef, me?.name ?? null, t);
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
        {pull && (
          <Tooltip content={vod.tip} side="bottom" maxWidth={260}>
            <span className="inline-flex">
              <button
                type="button"
                disabled={vod.owner === null}
                onClick={() => watch(0)}
                className="flex items-center gap-x-1.5 h-8 px-3 rounded border text-sm border-brand text-foreground-lighter hover:bg-brand/10 disabled:border-card disabled:text-foreground disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
              >
                <Play size={14} className="text-brand" />
                {vod.label}
              </button>
            </span>
          </Tooltip>
        )}
        {you && track && (
          <button
            type="button"
            onClick={() => setNsrtOpen((o) => !o)}
            title="These cooldowns as Northern Sky Raid Tools reminders"
            className={`flex items-center gap-x-1.5 h-8 px-3 rounded border text-sm hover:bg-card/50 ${
              nsrtOpen ? 'border-brand text-foreground-lighter' : 'border-card'
            }`}
          >
            <ClipboardCopy size={14} className="text-brand" />
            Copy for NSRT
          </button>
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

      {you && track && nsrtOpen && (
        <CopyNsrt
          you={you}
          them={track}
          cooldowns={cds}
          theirPhases={theirPhases}
          ourPhases={ours}
          encounterId={encounterId}
          difficultyId={difficultyId}
          bossName={bossName}
          onClose={() => setNsrtOpen(false)}
        />
      )}
      {you && track && (
        <>
          <div className="flex items-center gap-x-3 flex-wrap gap-y-2 text-xs text-foreground">
            <span className="flex items-center gap-x-1.5">
              <span
                className="inline-block w-3.5 h-[3px]"
                style={{ background: '#CCA85C' }}
              />
              You · {you.name}
            </span>
            <span className="flex items-center gap-x-1.5">
              <span
                className="inline-block w-3.5 h-[3px]"
                style={{ background: '#8FA3FF' }}
              />
              Them · {track.name}
            </span>
            <span className="flex items-center gap-x-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-[3px] border-[1.5px] border-dashed border-[#E57F7F]" />
              A cooldown they pressed and you didn&apos;t
            </span>
            <span className="ml-auto flex items-center gap-x-2">
              Line up by
              <span className="inline-flex rounded border border-card overflow-hidden">
                {(['start', 'phase'] as LineUp[]).map((v) => {
                  const off = v === 'phase' && !canLineUp;
                  return (
                    <button
                      key={v}
                      type="button"
                      disabled={off}
                      title={
                        off
                          ? theirPhases.length < 2
                            ? 'Warcraft Logs has no phases for this fight.'
                            : "Couldn't find where their phases started in our log."
                          : v === 'phase'
                            ? 'Shift their timeline so each phase starts when ours did.'
                            : 'Both from the pull.'
                      }
                      onClick={() => setLineUp(v)}
                      className={`px-2.5 py-1 ${
                        (lineUp === v && !(v === 'phase' && off)) ||
                        (v === 'start' && lineUp === 'phase' && !canLineUp)
                          ? 'bg-brand/20 text-foreground-lighter'
                          : 'hover:bg-card/50'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {v === 'start' ? 'Pull start' : 'Each phase'}
                    </button>
                  );
                })}
              </span>
            </span>
          </div>
          {aligned && (
            <div ref={timelineRef} className="scroll-mt-4">
              <TrialTimeline
                you={you}
                them={track}
                aligned={aligned}
                cooldowns={cds}
                boss={boss}
                bossName={bossName}
                ourPhases={ours}
                theirPhases={theirPhases}
                unit={unit}
                marker={marker}
                setMarker={setMarker}
                highlight={
                  shownFinding
                    ? { spans: shownFinding.spans, key: shownFinding.key }
                    : null
                }
                onWatch={vod.owner !== null ? watch : undefined}
              />
            </div>
          )}
          <WhereTimeWent
            list={list}
            gapEnd={gap.length ? gap[gap.length - 1] : 0}
            amount={metric === 'hps' ? 'healing' : 'damage'}
            shown={shownFinding ? shown : null}
            onShow={show}
            onWatch={vod.owner !== null ? watch : undefined}
            watchTip={vod.tip}
          />
        </>
      )}
    </div>
  );
};

export default TimeTrial;
