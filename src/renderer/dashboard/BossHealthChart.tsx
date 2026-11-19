import React from 'react';
import { BRAND } from 'renderer/brand';

/**
 * [RoomFortyRecorder] Boss health over the pull: a brass line, axes with
 * their units, a red dot on the time axis for every death (a button that
 * watches that moment) and a brass tick at the top for every Watch-live flag.
 */

const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export type ChartDeath = { name: string; t: number; specId?: number };
export type ChartFlag = { t: number; label: string };

const BossHealthChart = ({
  curve,
  duration,
  deaths,
  flags = [],
  canWatchDeath,
  onWatchDeath,
}: {
  curve: [number, number][];
  duration: number;
  deaths: ChartDeath[];
  flags?: ChartFlag[];
  /** Whether a recording exists for this raider's death. */
  canWatchDeath: (death: ChartDeath) => boolean;
  onWatchDeath: (death: ChartDeath) => void;
}) => {
  const total = Math.max(duration, 1);
  const pctX = (t: number) => Math.min(100, Math.max(0, (t / total) * 100));
  const points = curve.map(
    ([t, pct]) => `${pctX(t)},${100 - Math.min(100, Math.max(0, pct))}`,
  );
  const hasCurve = curve.length >= 2;
  const ticks = [0, 1, 2, 3, 4].map((i) => (total * i) / 4);

  return (
    <section
      aria-label="Boss health"
      className="rounded-lg border border-panel-line bg-panel px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="font-display text-[17px] font-bold text-foreground-lighter">
          Boss health
        </h3>
        <span className="text-xs text-foreground">
          Red dots are deaths · click one to watch it
        </span>
      </div>

      {!hasCurve && (
        <p className="mt-2 mb-1 text-[13px] text-foreground" data-state="empty">
          No boss health in this pull&apos;s log
        </p>
      )}

      {hasCurve && (
        <div className="mt-3 flex">
          <div className="relative mr-2 h-[132px] w-9 shrink-0 text-right text-[11px] tabular-nums text-foreground">
            {[100, 50, 0].map((v) => (
              <span
                key={v}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${100 - v}%` }}
              >
                {v}%
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-[132px]">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                role="img"
                aria-label="Boss health over the pull"
              >
                {[0, 50, 100].map((v) => (
                  <line
                    key={v}
                    x1={0}
                    x2={100}
                    y1={100 - v}
                    y2={100 - v}
                    stroke="currentColor"
                    strokeOpacity={v === 0 ? 0.3 : 0.12}
                    vectorEffect="non-scaling-stroke"
                    className="text-foreground"
                  />
                ))}
                <polyline
                  points={points.join(' ')}
                  fill="none"
                  stroke={BRAND}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {flags.map((f) => (
                <span
                  key={`flag-${f.t}-${f.label}`}
                  title={`${mmss(f.t)}: ${f.label}`}
                  aria-label={`Flag at ${mmss(f.t)}: ${f.label}`}
                  role="img"
                  className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-brand"
                  style={{ left: `${pctX(f.t)}%` }}
                />
              ))}
              {deaths.map((death) => {
                const can = canWatchDeath(death);
                const label = `Death at ${mmss(death.t)}: ${death.name}`;
                return (
                  <button
                    key={`${death.name}-${death.t}`}
                    type="button"
                    aria-label={label}
                    title={can ? `${label}. Click to watch.` : label}
                    onClick={() => onWatchDeath(death)}
                    className="absolute bottom-0 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-red-400 ring-2 ring-panel enabled:hover:scale-125 enabled:hover:ring-foreground-lighter focus-visible:outline-none focus-visible:ring-brand disabled:cursor-default"
                    style={{ left: `${pctX(death.t)}%` }}
                    disabled={!can}
                  />
                );
              })}
            </div>
            <div className="relative mt-3 h-4 text-[11px] tabular-nums text-foreground">
              {ticks.map((t, i) => (
                <span
                  key={t}
                  className={`absolute ${
                    i === 0
                      ? 'left-0'
                      : i === ticks.length - 1
                        ? 'right-0'
                        : '-translate-x-1/2'
                  }`}
                  style={
                    i === 0 || i === ticks.length - 1
                      ? undefined
                      : { left: `${pctX(t)}%` }
                  }
                >
                  {mmss(t)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default BossHealthChart;
