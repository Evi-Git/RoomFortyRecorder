import React from 'react';
import { Play } from 'lucide-react';
import { getSpecClass, getWoWClassColor } from './rendererutils';

/**
 * [RoomFortyRecorder] Logs: the cast timeline (each raider's cooldowns over
 * the pull) and buff/debuff uptime (Bloodlust, cooldown buffs on raiders,
 * debuffs the raid kept on the boss). Click a cast or a spot on a track to
 * open a recording at that moment.
 */

export type CastTrack = { spellId: number; name: string; times: number[] };
export type AuraTrack = {
  spellId: number;
  name: string;
  caster: string;
  intervals: [number, number][];
};
export type TimelineData = {
  duration: number;
  casts?: { name: string; specId: number; spells: CastTrack[] }[];
  buffs?: { name: string; specId: number; auras: AuraTrack[] }[];
  raidBuffs?: AuraTrack[];
  bossDebuffs?: AuraTrack[];
  deaths?: { t: number; name: string; spell: string | null }[];
};
type Range = { from: number; to: number } | null; // seconds

const classColor = (specId: number) =>
  getWoWClassColor(getSpecClass(specId)) || 'hsl(var(--foreground-lighter))';

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Seconds an aura was up inside [from, to). */
const upFor = (intervals: [number, number][], from: number, to: number) =>
  intervals.reduce(
    (n, [s, e]) => n + Math.max(0, Math.min(e, to) - Math.max(s, from)),
    0,
  );

/**
 * The part of the pull drawn (zoomed in, or all of it), shared by every
 * track and the axis, and how to zoom (drag across a track).
 */
type View = { v0: number; v1: number; zoom: (r: [number, number]) => void };
const ViewContext = React.createContext<View | null>(null);

const useView = (duration: number) => {
  const view = React.useContext(ViewContext);
  const v0 = view?.v0 ?? 0;
  const v1 = view?.v1 ?? duration;
  const len = Math.max(0.001, v1 - v0);
  return {
    v0,
    v1,
    len,
    zoom: view?.zoom,
    /** A time as a left offset (pinned to the edges). */
    at: (t: number) => `${((Math.min(v1, Math.max(v0, t)) - v0) / len) * 100}%`,
    inView: (t: number) => t >= v0 && t <= v1,
  };
};

/** Zoom state for a timeline, and the bar to go back to the whole pull. */
const useZoom = (duration: number) => {
  const [view, setView] = React.useState<[number, number] | null>(null);
  const value = React.useMemo<View>(
    () => ({
      v0: view ? view[0] : 0,
      v1: view ? view[1] : duration,
      zoom: (r) => setView(r),
    }),
    [view, duration],
  );
  const bar = (
    <span className="inline-flex items-center gap-x-2 text-xs text-foreground">
      {view ? (
        <>
          <span>
            Zoomed in on {mmss(view[0])}–{mmss(view[1])}
          </span>
          <button
            type="button"
            onClick={() => setView(null)}
            className="text-brand hover:underline"
          >
            Whole pull
          </button>
        </>
      ) : (
        'Drag across a track to zoom in.'
      )}
    </span>
  );
  return { value, bar };
};

/**
 * The shared time axis: a track `width` wide where seconds map to percent.
 * Lust windows and deaths are drawn behind every track.
 */
const Track = ({
  duration,
  range,
  lust,
  deaths,
  onPick,
  children,
  height = 18,
}: {
  duration: number;
  range: Range;
  lust: [number, number][];
  deaths: { t: number; name: string }[];
  onPick?: (seconds: number) => void;
  children?: React.ReactNode;
  height?: number;
}) => {
  const { at, v0, len, zoom } = useView(duration);
  const box = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<[number, number] | null>(null);
  const secondsAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return v0;
    return v0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * len;
  };
  // Drag across to zoom in; a click (barely moved) opens a recording.
  const down = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const a = secondsAt(e.clientX);
    let b = a;
    setDrag([a, a]);
    const move = (ev: MouseEvent) => {
      b = secondsAt(ev.clientX);
      setDrag([a, b]);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (zoom && (hi - lo) / len >= 0.01) zoom([lo, hi]);
      else onPick?.(a);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div
      ref={box}
      className={`relative w-full rounded-sm bg-card/30 overflow-hidden select-none ${onPick || zoom ? 'cursor-pointer' : ''}`}
      style={{ height }}
      onMouseDown={onPick || zoom ? down : undefined}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? -1 : undefined}
      aria-label={onPick ? 'Open a recording at this moment' : undefined}
    >
      {lust.map(([s, e]) => (
        <span
          key={s}
          className="absolute top-0 bottom-0 bg-[hsl(200_70%_55%/0.12)]"
          style={{ left: at(s), width: `calc(${at(e)} - ${at(s)})` }}
        />
      ))}
      {range && (
        <span
          className="absolute top-0 bottom-0 border-x border-brand/60 bg-brand/10"
          style={{
            left: at(range.from),
            width: `calc(${at(range.to)} - ${at(range.from)})`,
          }}
        />
      )}
      {deaths.map((d) => (
        <span
          key={`${d.name}-${d.t}`}
          className="absolute top-0 bottom-0 w-px bg-red-400/50"
          style={{ left: at(d.t) }}
        />
      ))}
      {children}
      {drag && (
        <span
          className="absolute top-0 bottom-0 bg-brand/25 border-x border-brand pointer-events-none"
          style={{
            left: at(Math.min(...drag)),
            width: `calc(${at(Math.max(...drag))} - ${at(Math.min(...drag))})`,
          }}
        />
      )}
    </div>
  );
};

const Axis = ({ duration }: { duration: number }) => {
  const { v0, len } = useView(duration);
  return (
    <div className="relative h-4 text-[11px] text-foreground">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <span
          key={f}
          className="absolute -translate-x-1/2"
          style={{
            left: `${f * 100}%`,
            transform:
              f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : undefined,
          }}
        >
          {mmss(v0 + f * len)}
        </span>
      ))}
    </div>
  );
};

const Legend = ({ lust, deaths }: { lust: boolean; deaths: boolean }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
    {lust && (
      <span className="inline-flex items-center gap-x-1.5">
        <span className="inline-block w-3 h-3 rounded-sm bg-[hsl(200_70%_55%/0.25)]" />
        Bloodlust
      </span>
    )}
    {deaths && (
      <span className="inline-flex items-center gap-x-1.5">
        <span className="inline-block w-px h-3 bg-red-400" />
        Deaths
      </span>
    )}
    <span>Click a track to open a recording at that moment.</span>
  </div>
);

/** Each raider's cooldowns over the pull. */
export const CastTimeline = ({
  data,
  range,
  onWatch,
}: {
  data: TimelineData;
  range: Range;
  onWatch: (name: string | null, seconds: number) => void;
}) => {
  const [who, setWho] = React.useState('');
  const duration = Math.max(1, data.duration);
  const zoom = useZoom(duration);
  const { v0, v1 } = zoom.value;
  const at = (t: number) =>
    `${((Math.min(v1, Math.max(v0, t)) - v0) / Math.max(0.001, v1 - v0)) * 100}%`;
  const inView = (t: number) => t >= v0 && t <= v1;
  const lust = (data.raidBuffs ?? []).flatMap((b) => b.intervals);
  const deaths = data.deaths ?? [];
  const raiders = (data.casts ?? []).filter((r) => !who || r.name === who);
  if (!data.casts?.length) {
    return (
      <p className="text-sm text-foreground">
        No cast timeline for this pull (it comes with the app&apos;s meters,
        1.9.31 or newer).
      </p>
    );
  }
  return (
    <ViewContext.Provider value={zoom.value}>
      <div className="flex flex-col gap-y-3">
        <div className="flex items-center gap-x-3 flex-wrap">
          <label className="flex items-center gap-x-2 text-sm">
            Raider
            <select
              className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="">Everyone</option>
              {(data.casts ?? []).map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Legend lust={lust.length > 0} deaths={deaths.length > 0} />
          {zoom.bar}
        </div>
        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-3 gap-y-1 items-center">
          <span />
          <Axis duration={duration} />
          {/* Everyone: one compact row per raider; pick a raider (or click
            a name) for a row per spell. */}
          {!who &&
            raiders.map((r) => (
              <React.Fragment key={r.name}>
                <button
                  type="button"
                  onClick={() => setWho(r.name)}
                  className="text-left text-sm font-semibold truncate hover:underline"
                  style={{ color: classColor(r.specId) }}
                  title="Show a row per spell"
                >
                  {r.name}
                </button>
                <Track
                  duration={duration}
                  range={range}
                  lust={lust}
                  deaths={deaths}
                  onPick={(t) => onWatch(r.name, t)}
                >
                  {r.spells.flatMap((s) =>
                    s.times.filter(inView).map((t) => (
                      <button
                        key={`${s.spellId}-${t}`}
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onWatch(r.name, t);
                        }}
                        title={`${s.name} at ${mmss(t)}: open ${r.name}'s recording`}
                        aria-label={`${s.name} at ${mmss(t)}`}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ring-1 ring-background hover:scale-150 transition-transform"
                        style={{
                          left: at(t),
                          background: classColor(r.specId),
                        }}
                      />
                    )),
                  )}
                </Track>
              </React.Fragment>
            ))}
          {who &&
            raiders.map((r) => (
              <React.Fragment key={r.name}>
                <span
                  className="col-span-2 mt-2 text-sm font-semibold"
                  style={{ color: classColor(r.specId) }}
                >
                  {r.name}
                </span>
                {r.spells.map((s) => (
                  <React.Fragment key={s.spellId}>
                    <span
                      className="text-xs text-foreground-lighter truncate pl-3"
                      title={`${s.name} · cast ${s.times.length}×`}
                    >
                      {s.name}
                      <span className="text-foreground">
                        {' '}
                        ×{s.times.length}
                      </span>
                    </span>
                    <Track
                      duration={duration}
                      range={range}
                      lust={lust}
                      deaths={deaths}
                      onPick={(t) => onWatch(r.name, t)}
                    >
                      {s.times.filter(inView).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onWatch(r.name, t);
                          }}
                          title={`${s.name} at ${mmss(t)}: open ${r.name}'s recording`}
                          aria-label={`${s.name} at ${mmss(t)}`}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-background hover:scale-125 transition-transform"
                          style={{
                            left: at(t),
                            background: classColor(r.specId),
                          }}
                        />
                      ))}
                    </Track>
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
        </div>
        <p className="text-xs text-foreground m-0">
          Spells each raider cast up to 8 times in the pull: their cooldowns,
          defensives and potions. Hover a dot for the spell; pick a raider for a
          row per spell.
        </p>
      </div>
    </ViewContext.Provider>
  );
};

const AuraRows = ({
  title,
  rows,
  duration,
  range,
  lust,
  deaths,
  onWatch,
}: {
  title: string;
  rows: {
    label: React.ReactNode;
    key: string;
    track: AuraTrack;
    color: string;
    watch: string | null;
  }[];
  duration: number;
  range: Range;
  lust: [number, number][];
  deaths: { t: number; name: string }[];
  onWatch: (name: string | null, seconds: number) => void;
}) => {
  const { at, v0, v1 } = useView(duration);
  // Uptime over the slice, else what's in view.
  const from = range?.from ?? v0;
  const to = range?.to ?? v1;
  const span = Math.max(1, to - from);
  return (
    <section className="flex flex-col gap-y-1">
      <h4 className="text-sm font-semibold text-brand">{title}</h4>
      <div className="grid grid-cols-[220px_56px_minmax(0,1fr)] gap-x-3 gap-y-1 items-center">
        <span />
        <span className="text-[11px] text-foreground text-right">Uptime</span>
        <Axis duration={duration} />
        {rows.map((r) => (
          <React.Fragment key={r.key}>
            <span className="text-xs truncate">{r.label}</span>
            <span className="text-xs tabular-nums text-right text-foreground-lighter">
              {pct(upFor(r.track.intervals, from, to) / span)}
            </span>
            <Track
              duration={duration}
              range={range}
              lust={lust}
              deaths={deaths}
              onPick={(t) => onWatch(r.watch, t)}
              height={14}
            >
              {r.track.intervals
                .filter(([s, e]) => e > v0 && s < v1)
                .map(([s, e]) => (
                  <span
                    key={s}
                    className="absolute top-[3px] bottom-[3px] rounded-[2px] pointer-events-none"
                    style={{
                      left: at(s),
                      width: `max(2px, calc(${at(e)} - ${at(s)}))`,
                      background: r.color,
                      opacity: 0.8,
                    }}
                  />
                ))}
            </Track>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
};

/** Bloodlust, cooldown buffs on raiders, and debuffs on the boss. */
export const AuraView = ({
  data,
  range,
  onWatch,
}: {
  data: TimelineData;
  range: Range;
  onWatch: (name: string | null, seconds: number) => void;
}) => {
  const [who, setWho] = React.useState('');
  const duration = Math.max(1, data.duration);
  const zoom = useZoom(duration);
  const lust = (data.raidBuffs ?? []).flatMap((b) => b.intervals);
  const deaths = data.deaths ?? [];
  if (!data.buffs && !data.bossDebuffs) {
    return (
      <p className="text-sm text-foreground">
        No buff data for this pull (it comes with the app&apos;s meters, 1.9.31
        or newer).
      </p>
    );
  }
  const specOf = new Map((data.buffs ?? []).map((b) => [b.name, b.specId]));
  const raidRows = (data.raidBuffs ?? []).map((t) => ({
    key: `lust-${t.spellId}`,
    label: (
      <span className="text-foreground-lighter">
        {t.name} <span className="text-foreground">({t.caster})</span>
      </span>
    ),
    track: t,
    color: 'hsl(200 70% 55%)',
    watch: null,
  }));
  const debuffRows = (data.bossDebuffs ?? []).map((t) => ({
    key: `${t.spellId}-${t.caster}`,
    label: (
      <span className="text-foreground-lighter">
        {t.name}{' '}
        <span style={{ color: classColor(specOf.get(t.caster) ?? 0) }}>
          ({t.caster})
        </span>
      </span>
    ),
    track: t,
    color: classColor(specOf.get(t.caster) ?? 0),
    watch: t.caster,
  }));
  // Raider buffs only once a raider is picked: everyone's is a long list.
  const buffs = who ? (data.buffs ?? []).filter((b) => b.name === who) : [];
  return (
    <ViewContext.Provider value={zoom.value}>
      <div className="flex flex-col gap-y-4">
        <div className="flex items-center gap-x-3 flex-wrap">
          <label className="flex items-center gap-x-2 text-sm">
            Raider
            <select
              className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="">Everyone</option>
              {(data.buffs ?? []).map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Legend lust={lust.length > 0} deaths={deaths.length > 0} />
          {zoom.bar}
          {range && (
            <span className="text-xs text-foreground">
              Uptime inside the slice {mmss(range.from)}–{mmss(range.to)}
            </span>
          )}
        </div>
        {raidRows.length > 0 && (
          <AuraRows
            title="Raid"
            rows={raidRows}
            duration={duration}
            range={range}
            lust={lust}
            deaths={deaths}
            onWatch={onWatch}
          />
        )}
        {debuffRows.length > 0 && (
          <AuraRows
            title="Debuffs on the boss"
            rows={debuffRows}
            duration={duration}
            range={range}
            lust={lust}
            deaths={deaths}
            onWatch={onWatch}
          />
        )}
        {buffs.map((b) => (
          <AuraRows
            key={b.name}
            title={b.name}
            rows={b.auras.map((t) => ({
              key: `${b.name}-${t.spellId}-${t.caster}`,
              label: (
                <span className="text-foreground-lighter">
                  {t.name}
                  {t.caster !== b.name && (
                    <span
                      style={{ color: classColor(specOf.get(t.caster) ?? 0) }}
                    >
                      {' '}
                      (from {t.caster})
                    </span>
                  )}
                </span>
              ),
              track: t,
              color: classColor(b.specId),
              watch: b.name,
            }))}
            duration={duration}
            range={range}
            lust={lust}
            deaths={deaths}
            onWatch={onWatch}
          />
        ))}
        <p className="text-xs text-foreground m-0">
          Pick a raider for their cooldown buffs. Raider buffs are cooldowns
          someone pressed (up to 8 casts in the pull), on themselves or on
          others. Boss debuffs are from the enemy the raid damaged most.
        </p>
      </div>
    </ViewContext.Provider>
  );
};

/** A small "open recording" hint for headers. */
export const WatchHint = ({ can }: { can: boolean }) =>
  can ? (
    <span className="inline-flex items-center gap-x-1 text-xs text-foreground">
      <Play size={11} /> Click a moment to open a recording there
    </span>
  ) : (
    <span className="text-xs text-foreground">
      No recording of this pull on this PC or in the cloud
    </span>
  );
