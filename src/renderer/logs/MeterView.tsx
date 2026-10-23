import React from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  abilitySeries,
  abilitySplit,
  AbilityRow,
  byAbility,
  Ctx,
  Meter,
  MeterRow,
  viewSeconds,
} from './query';
import TimeChart, { ChartSeries } from './TimeChart';
import {
  CATEGORICAL,
  classColor,
  compact,
  ENEMY_COLOR,
  OTHER_COLOR,
  pct,
  thousands,
} from './format';

/**
 * [RoomFortyRecorder] Logs page tables for damage done, damage taken,
 * healing and damage prevented: everyone (by source or by ability), and a
 * raider's abilities when you click their name.
 */

export type MeterKind = Meter | 'prevented';

export const RATE: Record<MeterKind, string> = {
  damage: 'DPS',
  healing: 'HPS',
  taken: 'DTPS',
  prevented: 'PPS',
};

export type ChartExtras = {
  range: [number, number] | null;
  setRange: (r: [number, number] | null) => void;
  onPick?: (seconds: number, name: string | null) => void;
  markers: { t: number; label: string }[];
  bands: [number, number][];
  boundaries: { t: number; label: string }[];
};

const rowColor = (r: { specId: number; player: boolean; pet: boolean }) =>
  r.player || r.pet ? classColor(r.specId) : ENEMY_COLOR;

const th = 'px-2 py-1.5 font-normal whitespace-nowrap';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';

/** An amount bar: main part, plus a lighter tail (pets, overheal, mitigated). */
const AmountBar = ({
  value,
  extra = 0,
  extraLabel,
  max,
  color,
  share,
  label,
}: {
  value: number;
  /** The number shown (defaults to value). */
  label?: number;
  extra?: number;
  extraLabel?: string;
  max: number;
  color: string;
  share: string;
}) => (
  <span className="flex items-center gap-x-2 min-w-[220px]">
    <span className="w-[52px] text-right text-xs text-foreground shrink-0">
      {share}
    </span>
    <span className="flex-1 flex items-center h-3.5">
      <span
        className="h-full rounded-l-[3px]"
        style={{
          width: `${(value / Math.max(1, max)) * 100}%`,
          minWidth: value ? 2 : 0,
          background: color,
          opacity: 0.9,
        }}
      />
      {extra > 0 && (
        <span
          className="h-full rounded-r-[3px]"
          title={extraLabel}
          style={{
            width: `${(extra / Math.max(1, max)) * 100}%`,
            background: color,
            opacity: 0.35,
          }}
        />
      )}
    </span>
    <span className="w-[64px] text-right text-xs text-foreground-lighter shrink-0">
      {compact(label ?? value)}
    </span>
  </span>
);

/** Hover card for an ability: who it came from and who it hit. */
const SplitCard = ({
  ctx,
  meter,
  rowKey,
  ability,
}: {
  ctx: Ctx;
  meter: Meter;
  rowKey: string;
  ability: AbilityRow;
}) => {
  const split = React.useMemo(
    () => abilitySplit(ctx, meter, rowKey, ability.spellId),
    [ctx, meter, rowKey, ability.spellId],
  );
  const part = (title: string, list: [string, number][]) => {
    const total = list.reduce((n, [, v]) => n + v, 0);
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-foreground border-b border-card">
            <th className="text-left font-normal py-0.5">{title}</th>
            <th className="text-right font-normal py-0.5" colSpan={2}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map(([name, v]) => (
            <tr key={name}>
              <td className="py-0.5 pr-3 text-foreground-lighter">{name}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums text-foreground">
                {pct(v, total)}
              </td>
              <td className="py-0.5 text-right tabular-nums text-foreground-lighter">
                {compact(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
  return (
    <div className="flex flex-col gap-y-2 w-[260px]">
      {part(meter === 'taken' ? 'Source' : 'Source', split.sources)}
      {part('Target', split.targets)}
    </div>
  );
};

/** A raider's (or enemy's) abilities. */
const Drill = ({
  ctx,
  meter,
  row,
  rows,
  extras,
  onBack,
}: {
  ctx: Ctx;
  meter: MeterKind;
  row: MeterRow;
  rows: MeterRow[];
  extras: ChartExtras;
  onBack: () => void;
}) => {
  const seconds = viewSeconds(ctx);
  const [hover, setHover] = React.useState<{
    ability: AbilityRow;
    top: number;
  } | null>(null);
  const abilities = [...row.abilities.values()].sort(
    (a, b) => b.total - a.total,
  );
  const top = Math.max(1, ...abilities.map((a) => a.total));
  const series = React.useMemo<ChartSeries[]>(() => {
    if (meter === 'prevented') {
      return [
        {
          key: row.key,
          name: row.name,
          color: rowColor(row),
          values: row.series,
        },
      ];
    }
    return abilitySeries(ctx, meter, row.key).map((s, i) => ({
      key: `${s.name}${i}`,
      name: s.name,
      color:
        s.name === 'Other' ? OTHER_COLOR : CATEGORICAL[i % CATEGORICAL.length],
      values: s.values,
    }));
  }, [ctx, meter, row]);
  const showCasts = meter === 'damage' || meter === 'healing';
  const box = React.useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
        >
          <ArrowLeft size={14} /> Everyone
        </button>
        <span
          className="font-display text-lg font-semibold"
          style={{ color: rowColor(row) }}
        >
          {row.name}
        </span>
        <span className="ml-auto flex gap-x-6 text-right">
          {[
            [RATE[meter], compact(row.total / seconds)],
            ['Total', compact(row.total)],
            ...(meter === 'healing'
              ? [['Overheal', pct(row.overheal, row.total + row.overheal, 1)]]
              : []),
            ...(meter === 'taken'
              ? [
                  [
                    'Mitigated',
                    pct(row.mitigated, row.total + row.mitigated, 1),
                  ],
                ]
              : []),
            ...(meter === 'damage' || meter === 'healing'
              ? [['Active', pct(row.active, seconds, 1)]]
              : []),
          ].map(([label, value]) => (
            <span key={label} className="flex flex-col">
              <span className="text-[11px] text-foreground">{label}</span>
              <span className="font-semibold tabular-nums text-foreground-lighter">
                {value}
              </span>
            </span>
          ))}
        </span>
      </div>
      <div className="rounded-md border border-card bg-background/40 p-3">
        <TimeChart
          duration={ctx.total}
          series={series}
          stacked={meter !== 'prevented'}
          rateLabel={RATE[meter]}
          range={extras.range}
          onRange={extras.setRange}
          onPick={
            extras.onPick
              ? (t) => extras.onPick?.(t, row.player ? row.name : null)
              : undefined
          }
          markers={extras.markers}
          bands={extras.bands}
          boundaries={extras.boundaries}
        />
        {meter !== 'prevented' && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground mt-1">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-x-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: s.color }}
                />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="relative overflow-x-auto" ref={box}>
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card bg-card/30">
            <tr>
              <th className={`${th} text-left`}>Name</th>
              <th className={`${th} text-left`}>Amount</th>
              {showCasts && <th className={`${th} text-right`}>Casts</th>}
              {showCasts && <th className={`${th} text-right`}>Avg cast</th>}
              <th className={`${th} text-right`}>Hits</th>
              <th className={`${th} text-right`}>Avg hit</th>
              {meter !== 'prevented' && (
                <th className={`${th} text-right`}>Crit %</th>
              )}
              {meter === 'damage' && (
                <th className={`${th} text-right`}>Uptime %</th>
              )}
              {meter === 'damage' && (
                <th className={`${th} text-right`}>Miss %</th>
              )}
              {meter === 'healing' && (
                <th className={`${th} text-right`}>Overheal %</th>
              )}
              {meter === 'taken' && (
                <th className={`${th} text-right`}>Mitigated %</th>
              )}
              <th className={`${th} text-right`}>{RATE[meter]}</th>
            </tr>
          </thead>
          <tbody>
            {abilities.map((a) => (
              <tr
                key={a.key}
                className="border-b border-card/40 hover:bg-card/30"
                onMouseEnter={(e) => {
                  if (meter === 'prevented') return;
                  const outer = box.current?.getBoundingClientRect();
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover({ ability: a, top: r.bottom - (outer?.top ?? 0) });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <td className={`${td} text-foreground-lighter`}>
                  {a.name}
                  {a.by && <span className="text-foreground"> ({a.by})</span>}
                </td>
                <td className={td}>
                  <AmountBar
                    value={a.total}
                    extra={
                      meter === 'healing'
                        ? a.overheal
                        : meter === 'taken'
                          ? a.mitigated
                          : 0
                    }
                    max={top}
                    color={rowColor(row)}
                    share={pct(a.total, row.total)}
                  />
                </td>
                {showCasts && (
                  <td className={`${td} text-right`}>{a.casts || '–'}</td>
                )}
                {showCasts && (
                  <td className={`${td} text-right`}>
                    {a.casts ? compact(a.total / a.casts) : '–'}
                  </td>
                )}
                <td className={`${td} text-right`}>{thousands(a.hits)}</td>
                <td className={`${td} text-right`}>
                  {a.hits ? compact(a.total / a.hits) : '–'}
                </td>
                {meter !== 'prevented' && (
                  <td className={`${td} text-right`}>
                    {pct(a.crits, a.hits, 1)}
                  </td>
                )}
                {meter === 'damage' && (
                  <td className={`${td} text-right`}>
                    {a.uptime ? pct(a.uptime, seconds, 1) : '–'}
                  </td>
                )}
                {meter === 'damage' && (
                  <td className={`${td} text-right`}>
                    {a.misses ? pct(a.misses, a.hits + a.misses, 1) : '–'}
                  </td>
                )}
                {meter === 'healing' && (
                  <td className={`${td} text-right`}>
                    {pct(a.overheal, a.total + a.overheal, 1)}
                  </td>
                )}
                {meter === 'taken' && (
                  <td className={`${td} text-right`}>
                    {pct(a.mitigated, a.total + a.mitigated, 1)}
                  </td>
                )}
                <td className={`${td} text-right text-foreground-lighter`}>
                  {thousands(a.total / seconds)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-foreground-lighter font-semibold">
              <td className={td}>Total</td>
              <td className={td}>
                <span className="flex justify-end text-xs pr-0">
                  {compact(row.total)}
                </span>
              </td>
              <td colSpan={20} className={`${td} text-right`}>
                {thousands(row.total / seconds)}
              </td>
            </tr>
          </tfoot>
        </table>
        {hover && meter !== 'prevented' && (
          <div
            className="absolute left-[38%] z-20 rounded-md border border-card bg-background p-2 shadow-xl pointer-events-none"
            style={{ top: hover.top + 2 }}
          >
            <SplitCard
              ctx={ctx}
              meter={meter}
              rowKey={row.key}
              ability={hover.ability}
            />
          </div>
        )}
      </div>
      <p className="text-xs text-foreground m-0">
        {rows.length > 1 ? 'Hover an ability for who it hit. ' : ''}
        {meter === 'taken'
          ? 'Amounts include what shields soaked; the faint bar is what armour and reductions took off.'
          : meter === 'healing'
            ? 'Effective healing; the faint bar is overheal. Shields count for whoever cast them.'
            : meter === 'prevented'
              ? 'An estimate of damage kept off by damage-reduction cooldowns, credited to the caster (personal ones to the wearer). Shields are in Healing.'
              : 'Damage includes what enemy shields soaked. Pets and guardians count for their owner unless Pets is on.'}
      </p>
    </div>
  );
};

/** Everyone, by source or by ability. */
const MeterView = ({
  ctx,
  meter,
  rows,
  group,
  who,
  setWho,
  extras,
}: {
  ctx: Ctx;
  meter: MeterKind;
  rows: MeterRow[];
  group: 'source' | 'ability';
  who: string | null;
  setWho: (key: string | null) => void;
  extras: ChartExtras;
}) => {
  const seconds = viewSeconds(ctx);
  const selected = rows.find((r) => r.key === who) ?? null;
  const total = rows.reduce((n, r) => n + r.total, 0);
  const [focus, setFocus] = React.useState<string | null>(null);
  // Raider lines switched on from the legend (the total is always drawn).
  const [picked, setPicked] = React.useState<string[]>([]);

  const series = React.useMemo<ChartSeries[]>(() => {
    const sum = new Float64Array(rows[0]?.series.length ?? 0);
    rows.forEach((r) =>
      r.series.forEach((v, i) => {
        sum[i] += v;
      }),
    );
    const lines: ChartSeries[] = [
      {
        key: 'total',
        name: 'Total',
        color: 'hsl(var(--brand))',
        values: sum,
        width: 2.5,
      },
    ];
    rows
      .filter((r) => r.key === focus || picked.includes(r.key))
      .forEach((r) =>
        lines.push({
          key: r.key,
          name: r.name,
          color: rowColor(r),
          values: r.series,
          width: 1.5,
        }),
      );
    return lines;
  }, [rows, focus, picked]);

  if (selected && group === 'source') {
    return (
      <Drill
        ctx={ctx}
        meter={meter}
        row={selected}
        rows={rows}
        extras={extras}
        onBack={() => setWho(null)}
      />
    );
  }

  const chart = (
    <div className="rounded-md border border-card bg-background/40 p-3">
      <TimeChart
        duration={ctx.total}
        series={series}
        rateLabel={RATE[meter]}
        range={extras.range}
        onRange={extras.setRange}
        onPick={extras.onPick ? (t) => extras.onPick?.(t, null) : undefined}
        markers={extras.markers}
        bands={extras.bands}
        boundaries={extras.boundaries}
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground mt-1">
        <span className="inline-flex items-center gap-x-1.5 text-foreground-lighter">
          <span
            className="inline-block w-3.5 h-0.5"
            style={{ background: 'hsl(var(--brand))' }}
          />
          Total
        </span>
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            onMouseEnter={() => setFocus(r.key)}
            onMouseLeave={() => setFocus(null)}
            onClick={() =>
              setPicked((list) =>
                list.includes(r.key)
                  ? list.filter((k) => k !== r.key)
                  : [...list, r.key],
              )
            }
            title="Click to keep their line on the chart"
            className={`inline-flex items-center gap-x-1.5 hover:text-foreground-lighter ${
              picked.includes(r.key) ? 'text-foreground-lighter' : ''
            }`}
          >
            <span
              className="inline-block w-3.5 h-0.5"
              style={{ background: rowColor(r) }}
            />
            {r.name}
          </button>
        ))}
      </div>
    </div>
  );

  if (!rows.length) {
    return (
      <div className="flex flex-col gap-y-3">
        {chart}
        <p className="text-sm text-foreground">
          Nothing here with these filters.
        </p>
      </div>
    );
  }

  if (group === 'ability') {
    const abilities = byAbility(rows);
    const max = Math.max(1, ...abilities.map((a) => a.total));
    return (
      <div className="flex flex-col gap-y-3">
        {chart}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-foreground border-b border-card bg-card/30">
              <tr>
                <th className={`${th} text-left`}>Ability</th>
                <th className={`${th} text-left`}>Amount</th>
                {(meter === 'damage' || meter === 'healing') && (
                  <th className={`${th} text-right`}>Casts</th>
                )}
                <th className={`${th} text-right`}>Hits</th>
                {meter !== 'prevented' && (
                  <th className={`${th} text-right`}>Crit %</th>
                )}
                <th className={`${th} text-left`}>
                  {meter === 'taken' ? 'Who took it' : 'Who'}
                </th>
                <th className={`${th} text-right`}>{RATE[meter]}</th>
              </tr>
            </thead>
            <tbody>
              {abilities.map((a) => (
                <tr
                  key={a.key}
                  className="border-b border-card/40 hover:bg-card/30"
                >
                  <td className={`${td} text-foreground-lighter`}>{a.name}</td>
                  <td className={td}>
                    <AmountBar
                      value={a.total}
                      max={max}
                      color="hsl(var(--brand))"
                      share={pct(a.total, total)}
                    />
                  </td>
                  {(meter === 'damage' || meter === 'healing') && (
                    <td className={`${td} text-right`}>{a.casts || '–'}</td>
                  )}
                  <td className={`${td} text-right`}>{thousands(a.hits)}</td>
                  {meter !== 'prevented' && (
                    <td className={`${td} text-right`}>
                      {pct(a.crits, a.hits, 1)}
                    </td>
                  )}
                  <td className={`${td} text-xs`}>
                    {[...a.users.values()]
                      .sort((x, y) => y.total - x.total)
                      .slice(0, 4)
                      .map((u, i) => (
                        <span
                          key={u.name}
                          style={{ color: classColor(u.specId) }}
                        >
                          {i ? ', ' : ''}
                          {u.name}
                        </span>
                      ))}
                    {a.users.size > 4 ? ` +${a.users.size - 4}` : ''}
                  </td>
                  <td className={`${td} text-right text-foreground-lighter`}>
                    {thousands(a.total / seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const max = Math.max(
    1,
    ...rows.map((r) => r.total + (meter === 'taken' ? r.mitigated : 0)),
  );
  return (
    <div className="flex flex-col gap-y-3">
      {chart}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card bg-card/30">
            <tr>
              <th className={`${th} text-left`}>Name</th>
              <th className={`${th} text-left`}>Amount</th>
              {meter === 'taken' && (
                <th className={`${th} text-right`}>Mitigated</th>
              )}
              {meter === 'healing' && (
                <th className={`${th} text-right`}>Overheal</th>
              )}
              {(meter === 'damage' || meter === 'healing') && (
                <th className={`${th} text-right`}>Active</th>
              )}
              <th className={`${th} text-right`}>{RATE[meter]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-b border-card/40 hover:bg-card/30"
              >
                <td className={td}>
                  <button
                    type="button"
                    onClick={() => setWho(r.key)}
                    className="font-semibold hover:underline text-left"
                    style={{ color: rowColor(r) }}
                    title="Show their abilities"
                  >
                    {r.name}
                  </button>
                </td>
                <td className={td}>
                  <AmountBar
                    value={
                      r.total -
                      (meter === 'damage' || meter === 'healing' ? r.pets : 0)
                    }
                    extra={
                      meter === 'taken'
                        ? r.mitigated
                        : meter === 'damage' || meter === 'healing'
                          ? r.pets
                          : 0
                    }
                    extraLabel={meter === 'taken' ? 'Mitigated' : 'Pets'}
                    label={r.total}
                    max={max}
                    color={rowColor(r)}
                    share={pct(r.total, total)}
                  />
                </td>
                {meter === 'taken' && (
                  <td className={`${td} text-right`}>
                    {pct(r.mitigated, r.total + r.mitigated)}
                  </td>
                )}
                {meter === 'healing' && (
                  <td className={`${td} text-right`}>
                    {pct(r.overheal, r.total + r.overheal)}
                  </td>
                )}
                {(meter === 'damage' || meter === 'healing') && (
                  <td className={`${td} text-right`}>
                    {pct(r.active, seconds)}
                  </td>
                )}
                <td
                  className={`${td} text-right font-semibold text-foreground-lighter`}
                >
                  {thousands(r.total / seconds)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-foreground-lighter font-semibold">
              <td className={td}>Total</td>
              <td className={`${td} text-right text-xs`}>{compact(total)}</td>
              <td colSpan={3} className={`${td} text-right`}>
                {thousands(total / seconds)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default MeterView;
