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
  const at = (t: number) =>
    `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%`;
  return (
    <div
      className={`relative w-full rounded-sm bg-card/30 ${onPick ? 'cursor-pointer' : ''}`}
      style={{ height }}
      onClick={(e) => {
        if (!onPick) return;
        const box = e.currentTarget.getBoundingClientRect();
        onPick(((e.clientX - box.left) / box.width) * duration);
      }}
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
    </div>
  );
};

const Axis = ({ duration }: { duration: number }) => (
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
        {mmss(f * duration)}
      </span>
    ))}
  </div>
);

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
                  s.times.map((t) => (
                    <button
                      key={`${s.spellId}-${t}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onWatch(r.name, t);
                      }}
                      title={`${s.name} at ${mmss(t)}: open ${r.name}'s recording`}
                      aria-label={`${s.name} at ${mmss(t)}`}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ring-1 ring-background hover:scale-150 transition-transform"
                      style={{
                        left: `${(Math.min(duration, t) / duration) * 100}%`,
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
                    <span className="text-foreground"> ×{s.times.length}</span>
                  </span>
                  <Track
                    duration={duration}
                    range={range}
                    lust={lust}
                    deaths={deaths}
                    onPick={(t) => onWatch(r.name, t)}
                  >
                    {s.times.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onWatch(r.name, t);
                        }}
                        title={`${s.name} at ${mmss(t)}: open ${r.name}'s recording`}
                        aria-label={`${s.name} at ${mmss(t)}`}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-background hover:scale-125 transition-transform"
                        style={{
                          left: `${(Math.min(duration, t) / duration) * 100}%`,
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
  const from = range?.from ?? 0;
  const to = range?.to ?? duration;
  const span = Math.max(1, to - from);
  const at = (t: number) =>
    `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%`;
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
              {r.track.intervals.map(([s, e]) => (
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
        someone pressed (up to 8 casts in the pull), on themselves or on others.
        Boss debuffs are from the enemy the raid damaged most.
      </p>
    </div>
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
