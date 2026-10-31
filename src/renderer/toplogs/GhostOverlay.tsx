/**
 * [RoomFortyRecorder] Ghost on your VoD (1.9.107): the top player riding
 * along on our recording. A card over the video (the gap, both rates, our
 * phase, what they press next), and under it their cooldowns above ours,
 * our boss phases and the gap, with the playhead.
 */
import React from 'react';
import { X } from 'lucide-react';
import SpellIcon from '../logs/SpellIcon';
import { comingUp, Ghost, ghostAt, hideGhost } from './ghost';
import { castsFor, gapSoFar, perSecond } from './timeline';
import { compact } from './whereTime';

const YOU = '#CCA85C';
const THEM = '#8FA3FF';
const GOOD = '#5FBF7F';
const BAD = '#E57F7F';

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The card over the video. */
export const GhostCard = ({ ghost, t }: { ghost: Ghost; t: number }) => {
  const at = ghostAt(ghost, t);
  const next = comingUp(ghost, t);
  const behind = at.gap < 0;
  return (
    <div className="absolute top-3 right-3 z-[2] w-[290px] flex flex-col gap-y-2 rounded-lg border border-card bg-[#171412]/90 px-3.5 py-3 text-xs pointer-events-auto">
      <div className="flex items-center gap-x-2 text-foreground">
        <span className="w-2 h-2 rounded-full" style={{ background: THEM }} />
        <span className="truncate">
          {`Racing #${ghost.rank} ${ghost.them.name} · ${mmss(t)}`}
        </span>
        <button
          type="button"
          aria-label="Hide the ghost"
          title="Hide the ghost (turn it back on under the video)"
          onClick={() => hideGhost(ghost, true)}
          className="ml-auto p-1 rounded hover:bg-card/60"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex items-baseline gap-x-2">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: behind ? BAD : GOOD }}
        >
          {`${behind ? '−' : '+'}${compact(Math.abs(at.gap))}`}
        </span>
        <span className="text-foreground">
          {`${behind ? 'behind' : 'ahead'} · ${compact(at.you)} vs ${compact(at.them ?? 0)} ${ghost.unit}`}
        </span>
      </div>
      {at.phase && (
        <div className="text-foreground">
          {`Our phase: ${at.phase.name} (since ${mmss(at.phase.from)})`}
        </div>
      )}
      {next.length > 0 && (
        <div className="flex flex-col gap-y-1.5 pt-1.5 border-t border-[#2A2521]">
          <span className="text-foreground">Coming up</span>
          {next.map((c) => {
            let yours = 'yours: ?';
            if (c.yours === 0) yours = 'yours ready';
            else if (c.yours !== null)
              yours = `yours in ${Math.ceil(c.yours)} s`;
            return (
              <div key={c.cd.key} className="flex items-center gap-x-2">
                <SpellIcon spellId={c.cd.spellId} name={c.cd.name} />
                <span className="truncate">{c.cd.name}</span>
                <span className="ml-auto whitespace-nowrap">
                  <span style={{ color: THEM }}>
                    {`them in ${Math.ceil(c.them)} s`}
                  </span>
                  {' · '}
                  <span style={{ color: YOU }}>{yours}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Under the video: their cooldowns above ours, our phases, the gap. */
export const GhostLanes = ({
  ghost,
  t,
  duration,
  onSeek,
}: {
  ghost: Ghost;
  t: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) => {
  const max = Math.max(duration, ghost.you.duration, 1);
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / max) * 100))}%`;
  const themSide = { casts: ghost.aligned.casts, names: ghost.them.names };
  const gap = gapSoFar(perSecond(ghost.you), ghost.aligned.rates);
  const gapMax = Math.max(1, ...gap.map((g) => Math.abs(g)));
  const W = 1000;
  const H = 28;
  const gapPath = `M0,${H / 2} ${gap
    .map(
      (g, i) =>
        `L${(((i + 1) / max) * W).toFixed(1)},${(H / 2 - (g / gapMax) * (H / 2)).toFixed(1)}`,
    )
    .join(' ')} L${((gap.length / max) * W).toFixed(1)},${H / 2} Z`;
  const label = 'text-[11px] text-foreground truncate';
  const lanes = ghost.cooldowns.slice(0, 6);

  return (
    <div className="shrink-0 border-t border-card bg-background-dark-gradient-to px-2 py-1.5 text-xs">
      <div className="flex items-center gap-x-4 mb-1 text-[11px] text-foreground">
        <span className="font-semibold text-foreground-lighter">Ghost</span>
        <span className="flex items-center gap-x-1.5">
          <span className="w-3 h-1.5 rounded-sm" style={{ background: THEM }} />
          {`#${ghost.rank} ${ghost.them.name}`}
        </span>
        <span className="flex items-center gap-x-1.5">
          <span className="w-3 h-1.5 rounded-sm" style={{ background: YOU }} />
          {ghost.you.name}
        </span>
        <span>Click a mark to go there</span>
        <button
          type="button"
          onClick={() => hideGhost(ghost, !ghost.hidden)}
          className="ml-auto px-2 py-0.5 rounded border border-card hover:bg-card/50"
        >
          {ghost.hidden ? 'Show the ghost' : 'Hide the ghost'}
        </button>
      </div>
      {!ghost.hidden && (
        <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-2 gap-y-0.5 items-center">
          {ghost.phases.length > 1 && (
            <>
              <span className={label}>Our boss phases</span>
              <div className="relative h-3.5">
                {ghost.phases.map((p, i) => (
                  <span
                    key={`${p.name}${p.from}`}
                    className="absolute top-0 h-3.5 rounded-sm px-1 text-[9px] leading-[14px] font-bold text-[#171412] truncate box-border"
                    style={{
                      left: pct(p.from),
                      width: `calc(${((p.to - p.from) / max) * 100}% - 2px)`,
                      background: i % 2 ? '#A88A4C' : YOU,
                    }}
                    title={`${p.name}: ${mmss(p.from)}–${mmss(p.to)}`}
                  >
                    {p.short}
                  </span>
                ))}
                <span
                  className="absolute -top-0.5 -bottom-0.5 w-px bg-white/70 pointer-events-none"
                  style={{ left: pct(t) }}
                />
              </div>
            </>
          )}
          {lanes.map((cd) => (
            <React.Fragment key={cd.key}>
              <span className={`${label} flex items-center gap-x-1.5`}>
                <SpellIcon spellId={cd.spellId} name={cd.name} />
                <span className="truncate">{cd.name}</span>
              </span>
              <div className="relative h-[22px] rounded bg-[#1E1A17]">
                {castsFor(themSide, cd).map((c) => (
                  <button
                    key={`t${c}`}
                    type="button"
                    title={`Them ${mmss(c)}: go there`}
                    onClick={() => onSeek(Math.max(0, c - 2))}
                    className="absolute top-[3px] h-[7px] w-[6px] -translate-x-1/2 rounded-sm"
                    style={{ left: pct(c), background: THEM }}
                  />
                ))}
                {castsFor(ghost.you, cd).map((c) => (
                  <button
                    key={`y${c}`}
                    type="button"
                    title={`You ${mmss(c)}: go there`}
                    onClick={() => onSeek(Math.max(0, c - 2))}
                    className="absolute top-[12px] h-[7px] w-[6px] -translate-x-1/2 rounded-sm"
                    style={{ left: pct(c), background: YOU }}
                  />
                ))}
                <span
                  className="absolute inset-y-0 w-px bg-white/70 pointer-events-none"
                  style={{ left: pct(t) }}
                />
              </div>
            </React.Fragment>
          ))}
          <span className={label}>Gap (you − them)</span>
          <div className="relative h-7 rounded bg-[#1E1A17] overflow-hidden">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="w-full h-7 block"
              aria-hidden="true"
            >
              <defs>
                <clipPath id="ghost-up">
                  <rect x={0} y={0} width={W} height={H / 2} />
                </clipPath>
                <clipPath id="ghost-down">
                  <rect x={0} y={H / 2} width={W} height={H / 2} />
                </clipPath>
              </defs>
              <path
                d={gapPath}
                fill={GOOD}
                fillOpacity={0.45}
                clipPath="url(#ghost-up)"
              />
              <path
                d={gapPath}
                fill={BAD}
                fillOpacity={0.45}
                clipPath="url(#ghost-down)"
              />
            </svg>
            <span
              className="absolute inset-y-0 w-px bg-white/70 pointer-events-none"
              style={{ left: pct(t) }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
