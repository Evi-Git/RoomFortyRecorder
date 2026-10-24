import React from 'react';
import { compact, mmss } from './format';

/**
 * [RoomFortyRecorder] Logs page chart: per-second amounts drawn as rates
 * (smoothed), as lines or stacked areas, over one pull or several laid end
 * to end. Drag to pick a slice; click a moment to open a recording there.
 */

export type ChartSeries = {
  key: string;
  name: string;
  color: string;
  values: ArrayLike<number>;
  dashed?: boolean;
  /** SVG dash pattern, e.g. '6 3' (wins over dashed). */
  dash?: string;
  width?: number;
};

const H = 220;
const LEFT = 52;
const RIGHT = 12;
const TOP = 10;
const BOTTOM = 24;

/** Moving average of per-second amounts over `w` seconds. */
const smooth = (values: ArrayLike<number>, w: number) => {
  const n = values.length;
  const out = new Float64Array(n);
  const half = Math.max(0, Math.floor(w / 2));
  let sum = 0;
  let count = 0;
  // Sliding window [i - half, i + half].
  for (let j = 0; j <= Math.min(n - 1, half); j += 1) {
    sum += values[j];
    count += 1;
  }
  for (let i = 0; i < n; i += 1) {
    out[i] = count ? sum / count : 0;
    const add = i + half + 1;
    const drop = i - half;
    if (add < n) {
      sum += values[add];
      count += 1;
    }
    if (drop >= 0) {
      sum -= values[drop];
      count -= 1;
    }
  }
  return out;
};

const TimeChart = ({
  duration,
  series,
  stacked = false,
  rateLabel,
  range,
  onRange,
  onPick,
  markers = [],
  bands = [],
  boundaries = [],
  smoothing,
  height = H,
}: {
  duration: number;
  series: ChartSeries[];
  stacked?: boolean;
  rateLabel: string;
  range: [number, number] | null;
  onRange?: (r: [number, number] | null) => void;
  onPick?: (seconds: number) => void;
  markers?: { t: number; label: string }[];
  bands?: [number, number][];
  boundaries?: { t: number; label: string }[];
  smoothing?: number;
  height?: number;
}) => {
  const box = React.useRef<HTMLDivElement>(null);
  const [W, setW] = React.useState(800);
  const [hover, setHover] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<{ a: number; b: number } | null>(null);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setW(Math.max(260, Math.round(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const span = W - LEFT - RIGHT;
  const total = Math.max(1, duration);
  const w = smoothing ?? Math.max(3, Math.round(total / 60));
  const rates = React.useMemo(
    () => series.map((s) => smooth(s.values, w)),
    [series, w],
  );
  // One point per ~2px.
  const points = Math.max(2, Math.min(Math.ceil(total), Math.floor(span / 2)));
  const step = total / points;
  const sampled = React.useMemo(
    () =>
      rates.map((r) => {
        const out = new Float64Array(points);
        for (let i = 0; i < points; i += 1) {
          const at = Math.min(r.length - 1, Math.floor((i + 0.5) * step));
          out[i] = at >= 0 ? r[at] : 0;
        }
        return out;
      }),
    [rates, points, step],
  );
  const stacks = React.useMemo(() => {
    if (!stacked) return sampled;
    const acc = new Float64Array(points);
    return sampled.map((s) => {
      const out = new Float64Array(points);
      for (let i = 0; i < points; i += 1) {
        acc[i] += s[i];
        out[i] = acc[i];
      }
      return out;
    });
  }, [sampled, stacked, points]);

  let max = 1;
  stacks.forEach((s) => s.forEach((v) => (max = Math.max(max, v))));
  const plotH = height - TOP - BOTTOM;
  const x = (t: number) =>
    LEFT + (Math.min(total, Math.max(0, t)) / total) * span;
  const xi = (i: number) => LEFT + ((i + 0.5) / points) * span;
  const y = (v: number) => TOP + (1 - v / max) * plotH;
  const secondsAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    return Math.min(total, Math.max(0, ((px - LEFT) / span) * total));
  };
  const shown = drag
    ? ([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] as [number, number])
    : range;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const timeTicks = 6;
  const hoverIndex =
    hover === null ? null : Math.min(points - 1, Math.floor(hover / step));

  return (
    <div className="relative select-none" ref={box}>
      <svg
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        className={`block ${onRange ? 'cursor-crosshair' : ''}`}
        role="img"
        aria-label={`${rateLabel} over time`}
        onMouseMove={(e) => {
          const t = secondsAt(e);
          setHover(t);
          if (drag) setDrag({ ...drag, b: t });
        }}
        onMouseLeave={() => {
          setHover(null);
          setDrag(null);
        }}
        onMouseDown={(e) => {
          if (!onRange && !onPick) return;
          const t = secondsAt(e);
          setDrag({ a: t, b: t });
        }}
        onMouseUp={() => {
          if (!drag) return;
          const a = Math.min(drag.a, drag.b);
          const b = Math.max(drag.a, drag.b);
          setDrag(null);
          // A click (barely moved): open a recording there.
          if ((b - a) / total < 0.005) {
            if (onPick) onPick(drag.a);
            return;
          }
          if (onRange) onRange([a, b]);
        }}
      >
        {bands.map(([s, e]) => (
          <rect
            key={`b${s}`}
            x={x(s)}
            y={TOP}
            width={Math.max(2, x(e) - x(s))}
            height={plotH}
            fill="hsl(200 70% 55% / 0.13)"
          />
        ))}
        {ticks.map((v) => (
          <g key={`t${v}`}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={y(v)}
              y2={y(v)}
              stroke="hsl(var(--card))"
            />
            <text
              x={LEFT - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="hsl(var(--foreground))"
            >
              {compact(v)}
            </text>
          </g>
        ))}
        {Array.from(
          { length: timeTicks + 1 },
          (_, i) => (i / timeTicks) * total,
        ).map((t, i) => (
          <text
            key={`x${t}`}
            x={x(t)}
            y={height - 7}
            textAnchor={i === 0 ? 'start' : i === timeTicks ? 'end' : 'middle'}
            fontSize="11"
            fill="hsl(var(--foreground))"
          >
            {mmss(t)}
          </text>
        ))}
        {boundaries.map((b) => (
          <g key={`p${b.t}`}>
            <line
              x1={x(b.t)}
              x2={x(b.t)}
              y1={TOP}
              y2={TOP + plotH}
              stroke="hsl(var(--foreground) / 0.35)"
            />
            <text
              x={x(b.t) + 4}
              y={TOP + 11}
              fontSize="10"
              fill="hsl(var(--foreground))"
            >
              {b.label}
            </text>
          </g>
        ))}
        {stacked
          ? stacks
              .map((s, si) => {
                const prev = si > 0 ? stacks[si - 1] : null;
                const top = Array.from(s, (v, i) => `${xi(i)},${y(v)}`);
                const bottom = Array.from(
                  { length: points },
                  (_, i) =>
                    `${xi(points - 1 - i)},${y(prev ? prev[points - 1 - i] : 0)}`,
                );
                return (
                  <polygon
                    key={series[si].key}
                    points={[...top, ...bottom].join(' ')}
                    fill={series[si].color}
                    fillOpacity={0.8}
                    stroke="hsl(var(--background))"
                    strokeWidth={0.5}
                  />
                );
              })
              .reverse()
          : stacks.map((s, si) => (
              <polyline
                key={series[si].key}
                fill="none"
                stroke={series[si].color}
                strokeWidth={series[si].width ?? 2}
                strokeDasharray={
                  series[si].dash ?? (series[si].dashed ? '4 3' : undefined)
                }
                strokeLinejoin="round"
                points={Array.from(s, (v, i) => `${xi(i)},${y(v)}`).join(' ')}
              />
            ))}
        {markers.map((m) => (
          <line
            key={`m${m.t}${m.label}`}
            x1={x(m.t)}
            x2={x(m.t)}
            y1={TOP}
            y2={TOP + plotH}
            stroke="rgb(248 113 113 / 0.6)"
            strokeDasharray="3 3"
          />
        ))}
        {shown && (
          <rect
            x={x(shown[0])}
            y={TOP}
            width={Math.max(2, x(shown[1]) - x(shown[0]))}
            height={plotH}
            fill="hsl(var(--brand) / 0.14)"
            stroke="hsl(var(--brand) / 0.55)"
          />
        )}
        {hover !== null && !drag && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={TOP}
            y2={TOP + plotH}
            stroke="hsl(var(--foreground) / 0.5)"
          />
        )}
      </svg>
      {hover !== null && hoverIndex !== null && !drag && (
        <div
          className="absolute top-1 pointer-events-none rounded-md border border-card bg-background px-2 py-1 text-xs shadow-lg z-10 max-w-[260px]"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform:
              x(hover) > W / 2
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          <div className="text-foreground">{mmss(hover)}</div>
          {markers
            .filter((m) => Math.abs(m.t - hover) <= Math.max(1, step))
            .map((m) => (
              <div key={`h${m.t}${m.label}`} className="text-red-400">
                {m.label}
              </div>
            ))}
          {series
            .map((s, si) => ({ s, v: sampled[si][hoverIndex] }))
            .filter(({ v }) => v > 0)
            .sort((a, b) => b.v - a.v)
            .slice(0, 10)
            .map(({ s, v }) => (
              <div key={s.key} className="flex items-center gap-x-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span className="text-foreground-lighter truncate">
                  {s.name}
                </span>
                <span className="ml-auto pl-2 tabular-nums text-foreground-lighter">
                  {compact(v)}
                </span>
              </div>
            ))}
          {onPick && (
            <div className="text-foreground mt-0.5">Click to watch</div>
          )}
        </div>
      )}
    </div>
  );
};

export default TimeChart;
