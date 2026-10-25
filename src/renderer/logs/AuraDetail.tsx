import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { auraDetail, AuraTarget, Ctx } from './query';
import { classColor, ENEMY_COLOR, mmss, pct, thousands } from './format';
import TimeChart from './TimeChart';
import SpellIcon from './SpellIcon';

/**
 * [RoomFortyRecorder] Logs page Buffs/Debuffs: one aura opened up. Who had
 * it and when (a lane each, darker with more stacks), who put it on, and a
 * chart of how many had it (and their stacks) that slices and zooms like
 * the damage chart; the lanes follow the chart's zoom.
 */

const th = 'px-2 py-1.5 font-normal whitespace-nowrap';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';
const color = (r: { specId: number; player: boolean; pet: boolean }) =>
  r.player || r.pet ? classColor(r.specId) : ENEMY_COLOR;

/** Time the spans cover inside [v0, v1]. */
const upIn = (spans: [number, number, number][], v0: number, v1: number) => {
  let sum = 0;
  let last = v0;
  spans.forEach(([s, e]) => {
    const lo = Math.max(s, last, v0);
    const hi = Math.min(e, v1);
    if (hi > lo) {
      sum += hi - lo;
      last = hi;
    }
  });
  return sum;
};

const Lane = ({
  row,
  v0,
  v1,
  maxStacks,
  bands,
  onPick,
}: {
  row: AuraTarget;
  v0: number;
  v1: number;
  maxStacks: number;
  bands: [number, number][];
  onPick?: (t: number) => void;
}) => {
  const len = Math.max(0.001, v1 - v0);
  const left = (t: number) => ((Math.max(v0, t) - v0) / len) * 100;
  const width = (s: number, e: number) =>
    ((Math.min(v1, e) - Math.max(v0, s)) / len) * 100;
  const tint = color(row);
  return (
    <div
      className={`relative h-5 w-full rounded-sm bg-card/40 ${onPick ? 'cursor-pointer' : ''}`}
      onClick={(e) => {
        if (!onPick) return;
        const box = e.currentTarget.getBoundingClientRect();
        onPick(v0 + ((e.clientX - box.left) / box.width) * len);
      }}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? -1 : undefined}
      aria-label={onPick ? 'Open a recording at this moment' : undefined}
    >
      {bands
        .filter(([s, e]) => e > v0 && s < v1)
        .map(([s, e]) => (
          <span
            key={`l${s}`}
            className="absolute inset-y-0"
            style={{
              left: `${left(s)}%`,
              width: `${Math.max(0.3, width(s, e))}%`,
              background: 'hsl(200 70% 55% / 0.18)',
            }}
          />
        ))}
      {row.spans
        .filter(([s, e]) => e > v0 && s < v1)
        .map(([s, e, c]) => {
          const w = width(s, e);
          return (
            <span
              key={`${s}-${c}`}
              title={`${mmss(s)} – ${mmss(e)} (${(e - s).toFixed(1)} s)${maxStacks > 1 ? `, ${c} stack${c === 1 ? '' : 's'}` : ''}`}
              className="absolute top-[2px] bottom-[2px] rounded-[2px] flex items-center justify-center text-[10px] font-semibold text-background overflow-hidden"
              style={{
                left: `${left(s)}%`,
                width: `${Math.max(0.25, w)}%`,
                background: tint,
                opacity: maxStacks > 1 ? 0.35 + 0.65 * (c / maxStacks) : 0.85,
              }}
            >
              {maxStacks > 1 && w > 2.2 ? c : ''}
            </span>
          );
        })}
    </div>
  );
};

const AuraDetail = ({
  ctx,
  spellId,
  debuffs,
  who,
  bands,
  boundaries,
  range,
  setRange,
  onPick,
  onBack,
}: {
  ctx: Ctx;
  spellId: number;
  debuffs: boolean;
  who: string | null;
  bands: [number, number][];
  boundaries: { t: number; label: string }[];
  range: [number, number] | null;
  setRange: (r: [number, number] | null) => void;
  onPick?: (t: number) => void;
  onBack: () => void;
}) => {
  const detail = React.useMemo(
    () => auraDetail(ctx, spellId, { debuffs, who }),
    [ctx, spellId, debuffs, who],
  );
  const [zoomed, setZoomed] = React.useState(false);
  const [all, setAll] = React.useState(false);
  const onEnemy = ctx.filters.side === 'enemy';
  const total = Math.max(1, ctx.total);
  const isZoomed = zoomed && range !== null;
  const v0 = isZoomed && range ? range[0] : 0;
  const v1 = isZoomed && range ? range[1] : total;
  // Stats over the slice (zoomed or not), else the whole fight.
  const [s0, s1] = range ?? [0, total];
  const seconds = Math.max(1, s1 - s0);
  const series: {
    key: string;
    name: string;
    color: string;
    values: Float64Array;
  }[] = [];
  // How many had it; not worth a line for one raider.
  if (detail.targets.length > 1 || detail.maxStacks <= 1)
    series.push({
      key: 'holders',
      name: onEnemy ? 'Enemies with it' : 'Raiders with it',
      color: 'hsl(var(--brand))',
      values: detail.holders,
    });
  if (detail.maxStacks > 1)
    series.push({
      key: 'stacks',
      name: 'Stacks (added up)',
      color: 'hsl(200 70% 60%)',
      values: detail.stacks,
    });
  const shown = all ? detail.targets : detail.targets.slice(0, 25);
  const one = detail.targets.length === 1;
  const unit = onEnemy
    ? one
      ? 'enemy'
      : 'enemies'
    : one
      ? 'raider'
      : 'raiders';
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
        >
          <ArrowLeft size={14} /> All {debuffs ? 'debuffs' : 'buffs'}
        </button>
        <span className="inline-flex items-center gap-x-2 font-display text-lg font-semibold text-foreground-lighter">
          <SpellIcon spellId={spellId} name={detail.name} />
          {detail.name || `Spell ${spellId}`}
        </span>
        <span className="text-xs text-foreground">
          {detail.targets.length} {unit}
          {detail.maxStacks > 1 ? ` · up to ${detail.maxStacks} stacks` : ''}
          {detail.sources.length
            ? ` · from ${detail.sources
                .slice(0, 4)
                .map(([r, c]) => `${r.name} (${c})`)
                .join(
                  ', ',
                )}${detail.sources.length > 4 ? ` +${detail.sources.length - 4}` : ''}`
            : ''}
        </span>
      </div>
      <div className="rounded-md border border-card bg-background/40 p-3">
        <TimeChart
          duration={ctx.total}
          series={series}
          rateLabel={series[0].name}
          range={range}
          onRange={setRange}
          onPick={onPick}
          bands={bands}
          boundaries={boundaries}
          smoothing={0}
          step={detail.step}
          stepped
          zoomable
          zoomed={zoomed}
          onZoomed={setZoomed}
          format={(v) => thousands(Math.round(v))}
          height={180}
        />
        <div className="flex flex-wrap gap-x-3 text-[11px] text-foreground mt-1">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-x-1">
              <span
                className="inline-block w-3 h-0.5"
                style={{ background: s.color }}
              />
              {s.name}
            </span>
          ))}
          <span>
            Drag to slice; Zoom to slice makes the lanes below follow.
          </span>
        </div>
      </div>
      <section className="rounded-md border border-card bg-background/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              {detail.maxStacks > 1 && <col className="w-[7%]" />}
              <col />
            </colgroup>
            <thead className="text-xs text-foreground border-b border-card">
              <tr>
                <th className={`${th} text-left`}>
                  {onEnemy ? 'Enemy' : 'Raider'}
                </th>
                <th className={`${th} text-right`}>Count</th>
                <th className={`${th} text-right`}>Uptime</th>
                {detail.maxStacks > 1 && (
                  <th className={`${th} text-right`}>Max stacks</th>
                )}
                <th className={`${th} text-left`}>
                  {isZoomed
                    ? `${mmss(v0)} – ${mmss(v1)}`
                    : 'Over the fight (hover a bar for times)'}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-card/40 hover:bg-card/30"
                >
                  <td
                    className={`${td} truncate font-semibold`}
                    style={{ color: color(r) }}
                  >
                    {r.name}
                  </td>
                  <td className={`${td} text-right`}>
                    {thousands(
                      range
                        ? r.starts.filter((t) => t >= s0 && t <= s1).length
                        : r.count,
                    )}
                  </td>
                  <td className={`${td} text-right text-foreground-lighter`}>
                    {pct(upIn(r.spans, s0, s1), seconds)}
                  </td>
                  {detail.maxStacks > 1 && (
                    <td className={`${td} text-right`}>{r.maxStacks}</td>
                  )}
                  <td className="px-2 py-1">
                    <Lane
                      row={r}
                      v0={v0}
                      v1={v1}
                      maxStacks={detail.maxStacks}
                      bands={bands}
                      onPick={onPick}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail.targets.length > 25 && (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="w-full py-1.5 text-xs text-brand hover:underline"
          >
            {all ? 'Show fewer' : `Show all ${detail.targets.length}`}
          </button>
        )}
        {!detail.targets.length && (
          <p className="m-0 p-3 text-sm text-foreground">
            Nobody had it with these filters.
          </p>
        )}
      </section>
    </div>
  );
};

export default AuraDetail;
