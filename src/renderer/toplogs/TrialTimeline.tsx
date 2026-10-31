/**
 * [RoomFortyRecorder] Time trial A, "One timeline" (1.9.102): boss track,
 * phase pacing, DPS (5 s average), the gap so far and the main cooldowns on
 * one shared time axis. Hover: one line across every row with the numbers
 * there; click: open our VoD at that moment.
 */
import React from 'react';
import SpellIcon from '../logs/SpellIcon';
import { compact, mmss } from '../logs/format';
import type { Track } from './trial';
import {
  Aligned,
  BossCast,
  castsFor,
  driftText,
  gapSoFar,
  MainCd,
  pairCasts,
  perSecond,
  Phase,
  phaseAt,
  smooth,
} from './timeline';

export const YOU = '#CCA85C'; // brand brass
export const THEM = '#8FA3FF';
const GOOD = '#5FBF7F';
const LATE = '#E5A55F';
const BAD = '#E57F7F';

const driftColor = (d: number | null) => {
  if (d === null) return BAD;
  const a = Math.abs(d);
  if (a <= 2) return GOOD;
  return a <= 6 ? LATE : BAD;
};

/** Something "Where the time went" asked to show on the timeline. */
export type Highlight = { spans: [number, number][]; key?: string };

const BOSS_COLORS = [
  '#C0614F',
  '#D08A4E',
  '#B5679E',
  '#6FA0C8',
  '#8FB86A',
  '#C9B458',
];
const bossColor = (id: number) => BOSS_COLORS[id % BOSS_COLORS.length];

const ROW = 58;

type Props = {
  you: Track;
  them: Track;
  /** Their side on our time axis (pull start, or lined up by phase). */
  aligned: Aligned;
  cooldowns: MainCd[];
  boss: BossCast[];
  bossName: string;
  ourPhases: Phase[];
  /** Their phases as they happened (for the pacing labels). */
  theirPhases: Phase[];
  unit: string;
  marker: number | null;
  setMarker: (t: number | null) => void;
  highlight?: Highlight | null;
  onWatch?: (t: number) => void;
};

/** "M0,y L.. " for a series with gaps (null). */
const linePath = (
  values: (number | null)[],
  x: (t: number) => number,
  y: (v: number) => number,
) => {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return d;
};

const TrialTimeline = ({
  you,
  them,
  aligned,
  cooldowns,
  boss,
  bossName,
  ourPhases,
  theirPhases,
  unit,
  marker,
  setMarker,
  highlight,
  onWatch,
}: Props) => {
  const max = Math.max(you.duration, aligned.end, 1);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / max) * 100))}%`;
  const W = 1000;
  const x = (t: number) => (t / max) * W;

  const youRates = perSecond(you);
  const themRates = aligned.rates;
  const youS = smooth(youRates);
  const themS = smooth(themRates);
  const gap = gapSoFar(youRates, themRates);
  const top =
    Math.max(1, ...youS.map((v) => v ?? 0), ...themS.map((v) => v ?? 0)) * 1.05;
  const H = 150;
  const y = (v: number) => H - (v / top) * H;
  const themSide = { casts: aligned.casts, names: them.names };

  const rows = cooldowns.map((cd) => {
    const pairs = pairCasts(castsFor(themSide, cd), castsFor(you, cd));
    const drifts = pairs
      .filter((p) => p.you !== null && p.them !== null)
      .map((p) => (p.you as number) - (p.them as number));
    const avg = drifts.length
      ? drifts.reduce((a, b) => a + b, 0) / drifts.length
      : null;
    return {
      cd,
      pairs,
      mine: pairs.filter((p) => p.you !== null).length,
      theirs: pairs.filter((p) => p.them !== null).length,
      missed: pairs.filter((p) => p.you === null).length,
      avg,
    };
  });

  const youAvg = you.duration
    ? (you.amounts[you.amounts.length - 1] ?? 0) / you.duration
    : 0;
  const themTotal = themRates.reduce<number>((s, v) => s + (v ?? 0), 0);
  const themAvg = them.duration ? themTotal / them.duration : 0;
  const gapAt = (t: number) =>
    gap.length
      ? gap[Math.max(0, Math.min(gap.length - 1, Math.floor(t) - 1))]
      : 0;
  const gapEnd = gap.length ? gap[gap.length - 1] : 0;
  const gapMax = Math.max(1, ...gap.map((g) => Math.abs(g)));

  // Above your line, clipped to under theirs: shaded where they're ahead.
  const youTop = `M0,0 L${W},0 ${youS
    .map((v, i) => [x(i + 1), y(v ?? 0)] as const)
    .reverse()
    .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`)
    .join(' ')} L0,${y(youS[0] ?? 0).toFixed(1)} Z`;
  const themArea = `M0,${H} ${themS
    .map((v, i) => `L${x(i + 1).toFixed(1)},${y(v ?? 0).toFixed(1)}`)
    .join(' ')} L${x(themS.length).toFixed(1)},${H} Z`;
  const GH = 40;
  const mid = GH / 2;
  const gapPath = `M0,${mid} ${gap
    .map(
      (g, i) =>
        `L${x(i + 1).toFixed(1)},${(mid - (g / gapMax) * mid).toFixed(1)}`,
    )
    .join(' ')} L${x(gap.length).toFixed(1)},${mid} Z`;

  // Chips near the right edge put their text on the left.
  const chipAt = (t: number): React.CSSProperties =>
    t / max > 0.88
      ? {
          right: `calc(${100 - (t / max) * 100}% - 18px)`,
          flexDirection: 'row-reverse',
        }
      : { left: pct(t) };

  const tickList = [0];
  const step = max > 240 ? 60 : 30;
  for (let t = step; t < max - 5; t += step) tickList.push(t);

  const ref = React.useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setMarker(
      Math.round(
        Math.max(0, Math.min(max, ((e.clientX - r.left) / r.width) * max)),
      ),
    );
  };

  // Boss marks: a label only where the next mark leaves room.
  const bossMarks = boss.map((b, i) => ({
    ...b,
    label: i + 1 >= boss.length || (boss[i + 1].t - b.t) / max > 0.09,
  }));

  // What the hover box says.
  let note = '';
  if (marker !== null) {
    rows.some((r) =>
      r.pairs.some((p) => {
        if (p.them === null || Math.abs(p.them - marker) > 8) return false;
        if (p.you === null) {
          note = `${r.cd.name || 'A cooldown'}: they pressed it, you didn't`;
          return true;
        }
        const d = p.you - p.them;
        if (Math.abs(d) < 3) return false;
        note = `your ${r.cd.name || 'cooldown'} is ${driftText(d)}${d > 0 ? ' late' : ' early'}`;
        return true;
      }),
    );
  }
  const ourPhase =
    marker !== null && ourPhases.length ? phaseAt(ourPhases, marker) : null;
  const nextPhase =
    marker !== null ? ourPhases.find((p) => p.from > marker) : undefined;
  const gapNow = marker !== null ? gapAt(marker) : gapEnd;

  const leftCell = 'border-b border-[#2A2521] px-3 box-border';
  const rightCell = 'border-b border-[#2A2521] relative';

  // Phase pacing: for each phase both reached, how much later ours started.
  const pacing = ourPhases.slice(1).map((p, i) => {
    const theirs = theirPhases[i + 1];
    return { ...p, diff: theirs ? p.from - theirs.from : null };
  });

  return (
    <div className="rounded-lg border border-card bg-[#1E1A17] overflow-x-auto">
      <div className="flex min-w-[1000px]">
        {/* Labels */}
        <div className="flex-none w-[230px] border-r border-card flex flex-col">
          <div className={`${leftCell} h-6`} />
          <div className={`${leftCell} h-12 py-1.5 flex flex-col gap-y-0.5`}>
            <span className="text-[13px] font-semibold truncate">
              {bossName || 'Boss'}
            </span>
            <span className="text-[11px] text-foreground">
              our boss&apos;s casts{ourPhases.length > 1 ? ' and phases' : ''}
            </span>
          </div>
          {theirPhases.length > 1 && (
            <div className={`${leftCell} h-10 flex flex-col justify-center`}>
              <span className="text-xs font-semibold">Phase pacing</span>
              <span className="text-[11px] text-foreground">
                <span style={{ color: THEM }}>them</span> above,{' '}
                <span style={{ color: YOU }}>you</span> below
              </span>
            </div>
          )}
          <div className={`${leftCell} h-[150px] py-2 flex flex-col gap-y-1`}>
            <span className="text-[13px] font-semibold">
              {unit} (5 s average)
            </span>
            <span className="text-[11px] text-foreground leading-snug">
              Spikes are cooldown windows. Shaded where they&apos;re ahead.
            </span>
            <span className="mt-auto text-xs tabular-nums">
              <span style={{ color: YOU }}>{compact(youAvg)}</span> vs{' '}
              <span style={{ color: THEM }}>{compact(themAvg)}</span>
            </span>
          </div>
          <div className={`${leftCell} h-10 flex items-center justify-between`}>
            <span className="text-xs font-semibold">
              {marker !== null ? `Gap at ${mmss(marker)}` : 'Gap so far'}
            </span>
            <span
              className="text-xs tabular-nums"
              style={{ color: gapNow >= 0 ? GOOD : BAD }}
            >
              {gapNow >= 0 ? '+' : '−'}
              {compact(Math.abs(gapNow))}
            </span>
          </div>
          {rows.map((r) => (
            <div
              key={r.cd.key}
              className={`${leftCell} flex items-center gap-x-2.5 ${
                highlight?.key === r.cd.key ? 'bg-brand/10' : ''
              }`}
              style={{ height: ROW }}
            >
              <SpellIcon spellId={r.cd.spellId} name={r.cd.name} />
              <div className="flex flex-col gap-y-0.5 min-w-0">
                <span className="text-[13px] font-semibold truncate">
                  {r.cd.name || `Spell ${r.cd.spellId}`}
                </span>
                <span className="text-[11px] text-foreground tabular-nums">
                  <span style={{ color: r.missed ? BAD : GOOD }}>
                    {`You ${r.mine} · them ${r.theirs}`}
                  </span>
                  {' · '}
                  {r.avg === null ? 'no pairs' : `avg ${driftText(r.avg)}`}
                </span>
              </div>
            </div>
          ))}
          {!rows.length && (
            <div className="px-3 py-3 text-xs text-foreground">
              No main cooldowns stood out for this spec yet.
            </div>
          )}
        </div>

        {/* The shared time axis */}
        <div className="flex-1 min-w-0 px-4">
          <div
            ref={ref}
            className="relative flex flex-col cursor-crosshair"
            onMouseMove={move}
            onMouseLeave={() => setMarker(null)}
            onClick={() => {
              if (onWatch && marker !== null) onWatch(marker);
            }}
          >
            <div className={`${rightCell} h-6`}>
              {tickList.map((t) => (
                <span
                  key={t}
                  className="absolute top-1 -translate-x-1/2 text-[11px] text-foreground"
                  style={{ left: pct(t) }}
                >
                  {mmss(t)}
                </span>
              ))}
            </div>

            <div className={`${rightCell} h-12`}>
              {ourPhases.map((p, i) => (
                <span
                  key={`${p.name}${p.from}`}
                  className="absolute top-0 h-[18px] border-l border-card text-[11px] text-foreground px-1.5 truncate box-border"
                  style={{
                    left: pct(p.from),
                    width: `${((p.to - p.from) / max) * 100}%`,
                    background: /^Int/.test(p.short)
                      ? '#2E2723'
                      : i % 2
                        ? '#231F1C'
                        : '#1E1A17',
                  }}
                  title={`${p.name}: ${mmss(p.from)}–${mmss(p.to)}`}
                >
                  {p.short}
                </span>
              ))}
              {bossMarks.map((b) => (
                <span
                  key={`${b.spellId}@${b.t}`}
                  className="absolute top-[24px] flex items-center gap-x-1 text-[11px] whitespace-nowrap"
                  style={{ left: pct(b.t), transform: 'translateX(-5px)' }}
                  title={`${b.name} ${mmss(b.t)}`}
                >
                  <span
                    className="w-2.5 h-2.5 rotate-45 flex-none"
                    style={{ background: bossColor(b.spellId) }}
                  />
                  {b.label && (
                    <span className="truncate max-w-[110px]">{b.name}</span>
                  )}
                </span>
              ))}
            </div>

            {theirPhases.length > 1 && (
              <div className={`${rightCell} h-10`}>
                {aligned.phases.map((p) => (
                  <span
                    key={`t${p.name}${p.from}`}
                    className="absolute top-[5px] h-3 border-l-2"
                    style={{
                      left: pct(p.from),
                      width: `${((p.to - p.from) / max) * 100}%`,
                      borderColor: THEM,
                      background: `${THEM}22`,
                    }}
                    title={`Them: ${p.name} at ${mmss(p.from)}`}
                  />
                ))}
                {ourPhases.map((p) => (
                  <span
                    key={`y${p.name}${p.from}`}
                    className="absolute top-[21px] h-3 border-l-2"
                    style={{
                      left: pct(p.from),
                      width: `${((p.to - p.from) / max) * 100}%`,
                      borderColor: YOU,
                      background: `${YOU}22`,
                    }}
                    title={`You: ${p.name} at ${mmss(p.from)}`}
                  />
                ))}
                {pacing.map((p) =>
                  p.diff === null || Math.abs(p.diff) < 1 ? null : (
                    <span
                      key={`d${p.name}`}
                      className="absolute top-[19px] pl-1.5 text-[10px] font-semibold tabular-nums"
                      style={{
                        left: pct(p.from),
                        color: p.diff > 0 ? LATE : GOOD,
                      }}
                    >
                      {p.short} {p.diff > 0 ? '+' : '−'}
                      {Math.round(Math.abs(p.diff))} s
                    </span>
                  ),
                )}
              </div>
            )}

            <div className={`${rightCell} h-[150px]`}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="w-full h-[150px] block"
                role="img"
                aria-label={`${unit}, you versus them`}
              >
                <defs>
                  <clipPath id="tt-above-you">
                    <path d={youTop} />
                  </clipPath>
                </defs>
                <path
                  d={themArea}
                  fill={THEM}
                  fillOpacity={0.18}
                  clipPath="url(#tt-above-you)"
                />
                <path
                  d={linePath(themS, x, y)}
                  fill="none"
                  stroke={THEM}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={linePath(youS, x, y)}
                  fill="none"
                  stroke={YOU}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            <div className={`${rightCell} h-10`}>
              <svg
                viewBox={`0 0 ${W} ${GH}`}
                preserveAspectRatio="none"
                className="w-full h-10 block"
                role="img"
                aria-label="Gap so far"
              >
                <defs>
                  <clipPath id="tt-gap-up">
                    <rect x={0} y={0} width={W} height={mid} />
                  </clipPath>
                  <clipPath id="tt-gap-down">
                    <rect x={0} y={mid} width={W} height={mid} />
                  </clipPath>
                </defs>
                <path
                  d={gapPath}
                  fill={GOOD}
                  fillOpacity={0.5}
                  clipPath="url(#tt-gap-up)"
                />
                <path
                  d={gapPath}
                  fill={BAD}
                  fillOpacity={0.55}
                  clipPath="url(#tt-gap-down)"
                />
                <line
                  x1={0}
                  x2={W}
                  y1={mid}
                  y2={mid}
                  stroke="#E6DED1"
                  opacity={0.25}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            {rows.map((r) => {
              const them_ = r.pairs.filter((p) => p.them !== null);
              const you_ = r.pairs.map((p) => p.you ?? p.them ?? 0);
              const roomAfter = (list: number[], i: number) =>
                i + 1 >= list.length || (list[i + 1] - list[i]) / max > 0.075;
              const theirTimes = them_.map((p) => p.them as number);
              return (
                <div
                  key={r.cd.key}
                  className={`${rightCell} ${highlight?.key === r.cd.key ? 'bg-brand/10' : ''}`}
                  style={{ height: ROW }}
                >
                  <span className="absolute inset-x-0 top-2 h-[18px] rounded-[3px] bg-[#191512]" />
                  <span className="absolute inset-x-0 top-8 h-[18px] rounded-[3px] bg-[#191512]" />
                  {them_.map((p, i) => (
                    <span
                      key={`t${p.them}`}
                      className="absolute top-2 flex items-center gap-x-1 whitespace-nowrap"
                      style={chipAt(p.them as number)}
                      title={`Them ${mmss(p.them as number)}`}
                    >
                      <span
                        className="rounded-[4px]"
                        style={{ boxShadow: `0 0 0 1.5px ${THEM}` }}
                      >
                        <SpellIcon spellId={r.cd.spellId} name={r.cd.name} />
                      </span>
                      {roomAfter(theirTimes, i) && (
                        <span className="text-[11px] tabular-nums text-foreground">
                          {mmss(p.them as number)}
                        </span>
                      )}
                    </span>
                  ))}
                  {r.pairs.map((p, i) => {
                    const room = roomAfter(you_, i);
                    if (p.you === null) {
                      return (
                        <span
                          key={`m${p.them}`}
                          className="absolute top-8 flex items-center gap-x-1 whitespace-nowrap"
                          style={chipAt(p.them as number)}
                          title={`They pressed it at ${mmss(p.them as number)}; you didn't`}
                        >
                          <span
                            className="w-[18px] h-[18px] rounded-[3px] box-border"
                            style={{ border: `1.5px dashed ${BAD}` }}
                          />
                          {room && (
                            <span
                              className="text-[11px]"
                              style={{ color: BAD }}
                            >
                              missed
                            </span>
                          )}
                        </span>
                      );
                    }
                    const d = p.them === null ? null : p.you - p.them;
                    let text = mmss(p.you);
                    if (p.them === null) text += ' extra';
                    else if (Math.round(d as number) !== 0)
                      text += ` (${driftText(d)})`;
                    let color = GOOD;
                    if (p.them !== null)
                      color = Math.round(d as number)
                        ? driftColor(d)
                        : '#B5AB9E';
                    return (
                      <span
                        key={`y${p.you}`}
                        className="absolute top-8 flex items-center gap-x-1 whitespace-nowrap"
                        style={chipAt(p.you)}
                        title={
                          p.them === null
                            ? `You ${mmss(p.you)}; they didn't press one here`
                            : `You ${mmss(p.you)}, ${driftText(d)} vs them`
                        }
                      >
                        <span
                          className="rounded-[4px]"
                          style={{ boxShadow: `0 0 0 1.5px ${YOU}` }}
                        >
                          <SpellIcon spellId={r.cd.spellId} name={r.cd.name} />
                        </span>
                        {room && (
                          <span
                            className="text-[11px] tabular-nums"
                            style={{ color }}
                          >
                            {text}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              );
            })}

            {highlight?.spans.map(([from, to]) => (
              <span
                key={`h${from}`}
                className="absolute top-6 bottom-0 pointer-events-none rounded-sm border border-brand/70 bg-brand/10"
                style={{
                  left: pct(from),
                  width: `${Math.max(0.4, ((to - from) / max) * 100)}%`,
                }}
              />
            ))}
            {marker !== null && (
              <>
                <span
                  className="absolute top-0 bottom-0 w-0 border-l border-[#E6DED1]/60 pointer-events-none"
                  style={{ left: pct(marker) }}
                />
                <span
                  className="absolute top-8 z-10 pointer-events-none rounded-md border border-card bg-[#171412] px-2.5 py-2 text-xs leading-relaxed whitespace-nowrap tabular-nums"
                  style={
                    marker / max > 0.6
                      ? { right: `calc(${100 - (marker / max) * 100}% + 8px)` }
                      : { left: `calc(${pct(marker)} + 8px)` }
                  }
                >
                  <b>{mmss(marker)}</b>
                  {ourPhase && ` · ${ourPhase.short}`}
                  {nextPhase &&
                    ` · ${nextPhase.short} in ${Math.round(nextPhase.from - marker)} s`}
                  <br />
                  <span style={{ color: THEM }}>
                    Them {compact(themS[Math.max(0, marker - 1)] ?? 0)}
                  </span>{' '}
                  ·{' '}
                  <span style={{ color: YOU }}>
                    you {compact(youS[Math.max(0, marker - 1)] ?? 0)}
                  </span>
                  <br />
                  <span style={{ color: gapNow >= 0 ? GOOD : BAD }}>
                    {gapNow >= 0 ? 'Ahead' : 'Behind'}{' '}
                    {compact(Math.abs(gapNow))}
                  </span>
                  {note && ` · ${note}`}
                  {onWatch && (
                    <>
                      <br />
                      <span className="text-foreground">
                        Click to watch our VoD here
                      </span>
                    </>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrialTimeline;
