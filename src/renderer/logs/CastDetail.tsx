import React from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { castRows, Ctx } from './query';
import { classColor, ENEMY_COLOR, mmss } from './format';
import TimeChart from './TimeChart';
import SpellIcon from './SpellIcon';
import { useViewWindow } from './zoom';

/**
 * [RoomFortyRecorder] Logs page Casts: one spell opened up. When each
 * raider (or enemy) cast it, a lane each, under a chart of casts over the
 * fight that slices and zooms like the others; the lanes follow the zoom.
 */

const th = 'px-2 py-1.5 font-normal whitespace-nowrap';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';
const color = (r: { specId: number; player: boolean; pet: boolean }) =>
  r.player || r.pet ? classColor(r.specId) : ENEMY_COLOR;

const CastDetail = ({
  ctx,
  spellId,
  who,
  setWho,
  bands,
  boundaries,
  setRange,
  onWatch,
  onBack,
}: {
  ctx: Ctx;
  spellId: number;
  /** Only this caster's lane (null: everyone who cast it). */
  who: string | null;
  setWho: (key: string | null) => void;
  bands: [number, number][];
  boundaries: { t: number; label: string }[];
  setRange: (r: [number, number] | null) => void;
  onWatch?: (t: number, name: string | null) => void;
  onBack: () => void;
}) => {
  const range = ctx.filters.range;
  // Every cast over the whole fight (the slice only decides the counts).
  const all = React.useMemo(
    () =>
      castRows({ ...ctx, filters: { ...ctx.filters, range: null } }).flatMap(
        (row) =>
          row.spells
            .filter((s) => s.spellId === spellId)
            .map((s) => ({ row, name: s.name, times: s.times })),
      ),
    [ctx, spellId],
  );
  const casters = (who ? all.filter((c) => c.row.key === who) : all).sort(
    (a, b) => b.times.length - a.times.length,
  );
  const name = all[0]?.name ?? `Spell ${spellId}`;
  const total = Math.max(1, ctx.total);
  const [v0, v1] = useViewWindow(range, total);
  const len = v1 - v0;
  const [s0, s1] = range ?? [0, total];
  const minutes = Math.max(1, s1 - s0) / 60;
  // Casts per bin, a series per caster (the first 8), stacked.
  const step = Math.max(1, Math.round(total / 150));
  const bins = Math.max(1, Math.ceil(total / step));
  const series = casters.slice(0, 8).map((c) => {
    const values = new Float64Array(bins);
    c.times.forEach((t) => {
      values[Math.min(bins - 1, Math.floor(t / step))] += 1;
    });
    return {
      key: c.row.key,
      name: c.row.name,
      color: color(c.row),
      values,
    };
  });
  const castCount = casters.reduce(
    (n, c) => n + c.times.filter((t) => t >= s0 && t <= s1).length,
    0,
  );
  // Whole-number ticks for a handful of casts.
  let peak = 1;
  if (series.length) {
    const sum = new Float64Array(bins);
    series.forEach((x) => x.values.forEach((v, i) => (sum[i] += v)));
    sum.forEach((v) => (peak = Math.max(peak, v)));
  }
  const whoName = all.find((c) => c.row.key === who)?.row.name ?? '';
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
        >
          <ArrowLeft size={14} /> All casts
        </button>
        <span className="inline-flex items-center gap-x-2 font-display text-lg font-semibold text-foreground-lighter">
          <SpellIcon spellId={spellId} name={name} />
          {name}
        </span>
        {who && (
          <span className="inline-flex items-center gap-x-1 rounded bg-card px-2 h-8 text-xs font-semibold">
            <span
              style={{ color: casters[0] ? color(casters[0].row) : undefined }}
            >
              {whoName}
            </span>
            <button
              type="button"
              onClick={() => setWho(null)}
              className="text-foreground hover:text-foreground-lighter"
              aria-label="Everyone who cast it"
              title="Everyone who cast it"
            >
              <X size={13} />
            </button>
          </span>
        )}
        <span className="text-xs text-foreground">
          {castCount} {castCount === 1 ? 'cast' : 'casts'} · {casters.length}{' '}
          {casters.length === 1 ? 'caster' : 'casters'}
        </span>
      </div>
      {series.length > 0 && (
        <div className="rounded-md border border-card bg-background/40 p-3">
          <TimeChart
            duration={ctx.total}
            series={series}
            stacked
            rateLabel={`Casts every ${step} s`}
            range={range}
            onRange={setRange}
            onPick={onWatch ? (t) => onWatch(t, null) : undefined}
            bands={bands}
            boundaries={boundaries}
            smoothing={0}
            step={step}
            stepped
            yMax={peak <= 10 ? peak : undefined}
            format={(v) => String(Math.round(v))}
            height={160}
          />
          <div className="flex flex-wrap gap-x-3 text-[11px] text-foreground mt-1">
            <span>Casts every {step} s.</span>
            <span>Drag to zoom in; the lanes below follow the chart.</span>
          </div>
        </div>
      )}
      <section className="rounded-md border border-card bg-background/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col />
            </colgroup>
            <thead className="text-xs text-foreground border-b border-card">
              <tr>
                <th className={`${th} text-left`}>Caster</th>
                <th className={`${th} text-right`}>Casts</th>
                <th className={`${th} text-right`}>Per minute</th>
                <th className={`${th} text-right`}>Avg gap</th>
                <th className={`${th} text-left`}>
                  {len < total
                    ? `${mmss(v0)} – ${mmss(v1)}`
                    : 'Over the fight (click a mark to watch)'}
                </th>
              </tr>
            </thead>
            <tbody>
              {casters.map((c) => {
                const inSlice = c.times.filter((t) => t >= s0 && t <= s1);
                const gaps = inSlice.slice(1).map((t, i) => t - inSlice[i]);
                const gap = gaps.length
                  ? gaps.reduce((x, y) => x + y, 0) / gaps.length
                  : 0;
                return (
                  <tr
                    key={c.row.key}
                    className="border-b border-card/40 hover:bg-card/30"
                  >
                    <td
                      className={`${td} truncate font-semibold`}
                      style={{ color: color(c.row) }}
                    >
                      {who ? (
                        c.row.name
                      ) : (
                        <button
                          type="button"
                          onClick={() => setWho(c.row.key)}
                          className="max-w-full truncate hover:underline text-left"
                          title={`Only ${c.row.name}`}
                        >
                          {c.row.name}
                        </button>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{inSlice.length}</td>
                    <td className={`${td} text-right`}>
                      {(inSlice.length / minutes).toFixed(1)}
                    </td>
                    <td className={`${td} text-right text-foreground-lighter`}>
                      {gap ? `${gap.toFixed(1)} s` : '–'}
                    </td>
                    <td className="px-2 py-1">
                      <div className="relative h-5 rounded-sm bg-card/40 overflow-hidden">
                        {bands
                          .filter(([s, e]) => e > v0 && s < v1)
                          .map(([s, e]) => (
                            <span
                              key={`l${s}`}
                              className="absolute inset-y-0"
                              style={{
                                left: `${((Math.max(v0, s) - v0) / len) * 100}%`,
                                width: `${((Math.min(v1, e) - Math.max(v0, s)) / len) * 100}%`,
                                background: 'hsl(200 70% 55% / 0.18)',
                              }}
                            />
                          ))}
                        {c.times
                          .filter((t) => t >= v0 && t <= v1)
                          .map((t) => (
                            <button
                              key={t}
                              type="button"
                              title={`${mmss(t)}${onWatch ? ' · click to watch' : ''}`}
                              aria-label={`${name} at ${mmss(t)}`}
                              onClick={() =>
                                onWatch?.(t, c.row.player ? c.row.name : null)
                              }
                              className="absolute top-[2px] bottom-[2px] w-[4px] -ml-[2px] rounded-[1px] hover:scale-x-150"
                              style={{
                                left: `${((t - v0) / len) * 100}%`,
                                background: color(c.row),
                              }}
                            />
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!casters.length && (
          <p className="m-0 p-3 text-sm text-foreground">
            Nobody cast it with these filters.
          </p>
        )}
      </section>
    </div>
  );
};

export default CastDetail;
