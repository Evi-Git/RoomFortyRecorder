import React from 'react';
import { compact, mmss } from './format';
import { ZoomContext } from './zoom';

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
  step = 1,
  yMax,
  zoomable: zoomableProp,
  format = compact,
  showZero = false,
  stepped = false,
  zoomed: zoomedProp,
  onZoomed,
}: {
  duration: number;
  series: ChartSeries[];
  stacked?: boolean;
  rateLabel: string;
  range: [number, number] | null;
  onRange?: (r: [number, number] | null) => void;
  onPick?: (seconds: number) => void;
  markers?: { t: number; label: string; color?: string }[];
  bands?: [number, number][];
  boundaries?: { t: number; label: string }[];
  smoothing?: number;
  height?: number;
  /** Seconds per value in each series' `values` (default 1). */
  step?: number;
  /** Fixed top of the scale (e.g. a resource's maximum). */
  yMax?: number;
  /** Offer "Zoom to slice": the chart then shows only the slice. */
  zoomable?: boolean;
  format?: (v: number) => string;
  /** List zero values in the hover card too. */
  showZero?: boolean;
  /** Draw levels as steps (resources, stacks) instead of slopes. */
  stepped?: boolean;
  /** Zoom controlled by the parent (to line other things up with it). */
  zoomed?: boolean;
  onZoomed?: (z: boolean) => void;
}) => {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const dragRef = React.useRef<{ a: number; b: number } | null>(null);
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

  // Zoom is the page's (every chart and lane together) unless the parent
  // controls it. Any chart that can be sliced can zoom.
  const page = React.useContext(ZoomContext);
  const zoomable = zoomableProp ?? Boolean(onRange);
  const zoomOn = onZoomed ? Boolean(zoomedProp) : page.zoomed;
  const setZoomOn = onZoomed ?? page.setZoomed;
  const span = W - LEFT - RIGHT;
  const total = Math.max(1, duration);
  // What the chart shows: the whole fight, or the slice when zoomed in.
  const zoomed = zoomable && zoomOn && range !== null;
  const v0 = zoomed && range ? range[0] : 0;
  const v1 = zoomed && range ? Math.max(range[0] + 0.5, range[1]) : total;
  const len = v1 - v0;
  // Smoothing follows what's in view, so zooming in shows the detail.
  const w = Math.max(
    1,
    Math.round((smoothing ?? Math.max(1, Math.round(len / 60))) / step),
  );
  const rates = React.useMemo(
    () => series.map((s) => (w > 1 ? smooth(s.values, w) : s.values)),
    [series, w],
  );
  // One point per ~2px.
  const points = Math.max(
    2,
    Math.min(Math.ceil(len / step), Math.floor(span / 2)),
  );
  const pointSeconds = len / points;
  const sampled = React.useMemo(
    () =>
      rates.map((r) => {
        const out = new Float64Array(points);
        for (let i = 0; i < points; i += 1) {
          const at = Math.min(
            r.length - 1,
            Math.floor((v0 + (i + 0.5) * pointSeconds) / step),
          );
          out[i] = at >= 0 ? r[at] : 0;
        }
        return out;
      }),
    [rates, points, pointSeconds, v0, step],
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
  if (yMax && yMax > 0) max = yMax;
  else stacks.forEach((s) => s.forEach((v) => (max = Math.max(max, v))));
  const plotH = height - TOP - BOTTOM;
  const x = (t: number) =>
    LEFT + ((Math.min(v1, Math.max(v0, t)) - v0) / len) * span;
  const xi = (i: number) => LEFT + ((i + 0.5) / points) * span;
  const y = (v: number) => TOP + (1 - v / max) * plotH;
  // Seconds under a screen x, pinned to the chart's edges.
  const secondsAtX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const px = ((clientX - rect.left) / rect.width) * W;
    return Math.min(v1, Math.max(v0, v0 + ((px - LEFT) / span) * len));
  };
  const secondsAt = (e: React.MouseEvent<SVGSVGElement>) =>
    secondsAtX(e.clientX);
  const setDragBoth = (d: { a: number; b: number } | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const dragging = drag !== null;
  // While the button is held, keep tracking outside the chart too.
  React.useEffect(() => {
    if (!dragging) return undefined;
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (d) setDragBoth({ ...d, b: secondsAtX(ev.clientX) });
    };
    const up = () => {
      const d = dragRef.current;
      setDragBoth(null);
      if (!d) return;
      const a = Math.min(d.a, d.b);
      const b = Math.max(d.a, d.b);
      // A click (barely moved): open a recording there.
      if ((b - a) / len < 0.005) {
        if (onPick) onPick(d.a);
        return;
      }
      if (onRange) onRange([a, b]);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // secondsAtX/onPick/onRange are fresh each render; the drag only needs
    // the latest when it ends, read through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);
  const shown = drag
    ? ([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] as [number, number])
    : zoomed
      ? null
      : range;
  // Small whole-number scales (combo points, stacks): every value.
  const ticks =
    yMax && yMax <= 10 && Number.isInteger(yMax)
      ? Array.from({ length: yMax + 1 }, (_, i) => i)
      : [0, 0.5, 1].map((f) => f * max);
  const linePoints = (s: Float64Array) => {
    if (!stepped) return Array.from(s, (v, i) => `${xi(i)},${y(v)}`).join(' ');
    const out: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const left = LEFT + (i / points) * span;
      if (i > 0 && s[i] !== s[i - 1]) out.push(`${left},${y(s[i - 1])}`);
      out.push(`${left},${y(s[i])}`);
    }
    out.push(`${LEFT + span},${y(s[s.length - 1])}`);
    return out.join(' ');
  };
  const timeTicks = 6;
  const hoverIndex =
    hover === null
      ? null
      : Math.min(points - 1, Math.floor((hover - v0) / pointSeconds));

  return (
    <div className="relative select-none" ref={box}>
      <svg
        ref={svgRef}
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        className={`block ${onRange ? 'cursor-crosshair' : ''}`}
        role="img"
        aria-label={`${rateLabel} over time`}
        onMouseMove={(e) => setHover(secondsAt(e))}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          if (e.button !== 0 || (!onRange && !onPick)) return;
          e.preventDefault();
          const t = secondsAt(e);
          setDragBoth({ a: t, b: t });
        }}
        onContextMenu={(e) => {
          // Right click: back to the whole fight.
          if (!onRange) return;
          e.preventDefault();
          setDragBoth(null);
          onRange(null);
        }}
      >
        {bands
          .filter(([s, e]) => e > v0 && s < v1)
          .map(([s, e]) => (
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
              {format(v)}
            </text>
          </g>
        ))}
        {Array.from(
          { length: timeTicks + 1 },
          (_, i) => v0 + (i / timeTicks) * len,
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
        {boundaries
          .filter((b) => b.t >= v0 && b.t <= v1)
          .map((b) => (
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
                // Stepped: each value flat across its own width.
                const edge = (v: (i: number) => number) => {
                  const out: string[] = [];
                  for (let i = 0; i < points; i += 1) {
                    if (stepped) {
                      out.push(`${LEFT + (i / points) * span},${y(v(i))}`);
                      out.push(
                        `${LEFT + ((i + 1) / points) * span},${y(v(i))}`,
                      );
                    } else out.push(`${xi(i)},${y(v(i))}`);
                  }
                  return out;
                };
                const top = edge((i) => s[i]);
                const bottom = edge((i) => (prev ? prev[i] : 0)).reverse();
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
                points={linePoints(s)}
              />
            ))}
        {markers
          .filter((m) => m.t >= v0 && m.t <= v1)
          .map((m) => (
            <line
              key={`m${m.t}${m.label}`}
              x1={x(m.t)}
              x2={x(m.t)}
              y1={TOP}
              y2={TOP + plotH}
              stroke={m.color ?? 'rgb(248 113 113 / 0.6)'}
              strokeDasharray={m.color ? undefined : '3 3'}
              strokeOpacity={m.color ? 0.75 : 1}
            />
          ))}
        {shown && (
          <g>
            <rect
              x={x(shown[0])}
              y={TOP}
              width={Math.max(2, x(shown[1]) - x(shown[0]))}
              height={plotH}
              fill="hsl(var(--brand) / 0.14)"
              stroke="hsl(var(--brand) / 0.55)"
            />
            {/* From, to and length of the slice, live while dragging. */}
            <rect
              x={Math.min(
                W - RIGHT - 150,
                Math.max(LEFT, (x(shown[0]) + x(shown[1])) / 2 - 75),
              )}
              y={TOP + 2}
              width={150}
              height={18}
              rx={3}
              fill="hsl(var(--background) / 0.9)"
              stroke="hsl(var(--brand) / 0.6)"
            />
            <text
              x={Math.min(
                W - RIGHT - 75,
                Math.max(LEFT + 75, (x(shown[0]) + x(shown[1])) / 2),
              )}
              y={TOP + 15}
              textAnchor="middle"
              fontSize="11"
              fill="hsl(var(--foreground-lighter))"
            >
              {mmss(shown[0])} – {mmss(shown[1])} ({mmss(shown[1] - shown[0])})
            </text>
          </g>
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
      {zoomable && range && (
        <button
          type="button"
          onClick={() => setZoomOn(!zoomed)}
          className="absolute top-1 right-3 rounded border border-card bg-background/90 px-2 py-0.5 text-[11px] text-brand hover:underline"
        >
          {zoomed ? 'Zoom out' : 'Zoom to slice'}
        </button>
      )}
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
            .filter((m) => Math.abs(m.t - hover) <= Math.max(1, pointSeconds))
            .map((m) => (
              <div key={`h${m.t}${m.label}`} className="text-red-400">
                {m.label}
              </div>
            ))}
          {series
            .map((s, si) => ({ s, v: sampled[si][hoverIndex] }))
            .filter(({ v }) => showZero || v > 0)
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
                  {format(v)}
                </span>
              </div>
            ))}
          {onPick && (
            <div className="text-foreground mt-0.5">
              Click to watch · drag to zoom in · right-click for the whole fight
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TimeChart;
