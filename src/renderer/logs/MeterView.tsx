import React from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import {
  abilitySeries,
  abilitySplit,
  AbilityGroup,
  AbilityRow,
  byAbility,
  groupAbilities,
  Ctx,
  Meter,
  MeterRow,
  meterRows,
  preventedRows,
  viewSeconds,
} from './query';

/** The same view over the whole fight: charts show it all, with the slice highlighted. */
const wholeFight = (ctx: Ctx): Ctx =>
  ctx.filters.range
    ? { ...ctx, filters: { ...ctx.filters, range: null } }
    : ctx;
import TimeChart, { ChartSeries } from './TimeChart';
import SpellIcon, { useSpellLabels } from './SpellIcon';
import { sortRows, SortTh, useSort } from './sort';
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

type Look = 'solid' | 'faint' | 'striped' | 'ghost';
type Part = { value: number; look: Look; label: string };

/** How each kind of amount is drawn (also used for the key). */
const partStyle = (look: Look, color: string): React.CSSProperties => {
  if (look === 'striped')
    return {
      background: `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)`,
      boxShadow: `inset 0 0 0 1px ${color}`,
      opacity: 0.9,
    };
  return {
    background: color,
    opacity: look === 'solid' ? 0.9 : look === 'faint' ? 0.5 : 0.22,
  };
};

/**
 * An amount bar made of parts: solid (healing, damage), faint (shields,
 * pets), striped (damage prevented) and ghost (overheal, mitigated).
 */
const AmountBar = ({
  parts,
  max,
  color,
  share,
  label,
}: {
  parts: Part[];
  max: number;
  color: string;
  share: string;
  /** The number shown. */
  label: number;
}) => (
  <span className="flex items-center gap-x-2 min-w-[220px]">
    <span className="w-[52px] text-right text-xs text-foreground shrink-0">
      {share}
    </span>
    <span className="flex-1 flex items-center h-3.5">
      {parts
        .filter((part) => part.value > 0)
        .map((part, i, list) => (
          <span
            key={part.label}
            className={`h-full ${i === 0 ? 'rounded-l-[3px]' : ''} ${i === list.length - 1 ? 'rounded-r-[3px]' : ''}`}
            title={`${part.label}: ${compact(part.value)}`}
            style={{
              width: `${(part.value / Math.max(1, max)) * 100}%`,
              minWidth: 2,
              ...partStyle(part.look, color),
            }}
          />
        ))}
    </span>
    <span className="w-[64px] text-right text-xs text-foreground-lighter shrink-0">
      {compact(label)}
    </span>
  </span>
);

/** The key to a bar's looks, for Healing. */
const BarKey = ({ prevented }: { prevented: boolean }) => (
  <span className="inline-flex items-center gap-x-3 text-[11px] text-foreground">
    {(
      [
        ['solid', 'Healing'],
        ['faint', 'Shields'],
        ...(prevented ? [['striped', 'Mitigations']] : []),
        ['ghost', 'Overheal'],
      ] as [Look, string][]
    ).map(([look, label]) => (
      <span key={look} className="inline-flex items-center gap-x-1">
        <span
          className="inline-block w-4 h-2.5 rounded-[2px]"
          style={partStyle(look, 'hsl(var(--foreground-lighter))')}
        />
        {label}
      </span>
    ))}
  </span>
);

// Line styles for raiders sharing a class colour: solid, dashed, dotted...
const DASHES: (string | undefined)[] = [
  undefined,
  '7 4',
  '2 3',
  '10 3 2 3',
  '4 2',
];

const LineSwatch = ({ color, dash }: { color: string; dash?: string }) => (
  <svg width="18" height="6" aria-hidden="true">
    <line
      x1="0"
      x2="18"
      y1="3"
      y2="3"
      stroke={color}
      strokeWidth="2"
      strokeDasharray={dash}
    />
  </svg>
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
  const [sort, onSort] = useSort('total');
  const columns: Record<string, (a: AbilityRow) => number | string> = {
    name: (a) => a.name,
    total: (a) => a.total,
    rate: (a) => a.total,
    casts: (a) => a.casts,
    avgCast: (a) => (a.casts ? a.total / a.casts : 0),
    hits: (a) => a.hits,
    avgHit: (a) => (a.hits ? a.total / a.hits : 0),
    crit: (a) => (a.hits ? a.crits / a.hits : 0),
    uptime: (a) => a.uptime,
    miss: (a) => (a.hits + a.misses ? a.misses / (a.hits + a.misses) : 0),
    overheal: (a) =>
      a.total + a.overheal ? a.overheal / (a.total + a.overheal) : 0,
    mitigated: (a) =>
      a.total + a.mitigated ? a.mitigated / (a.total + a.mitigated) : 0,
  };
  // The same ability under several spell IDs is one row (the sum), opened
  // to show each, named the way Warcraft Logs names them where it can.
  const groups = sortRows(
    groupAbilities([...row.abilities.values()]),
    sort,
    Object.fromEntries(
      Object.entries(columns).map(([k, f]) => [
        k,
        (g: AbilityGroup) => f(g.head),
      ]),
    ),
  );
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const labels = useSpellLabels(
    groups.flatMap((g) =>
      g.parts.length > 1 ? g.parts.map((a) => a.spellId) : [],
    ),
  );
  const lines = groups.flatMap((g) =>
    g.parts.length === 1
      ? [{ a: g.head, child: false, group: null as AbilityGroup | null }]
      : [
          { a: g.head, child: false, group: g },
          ...(open.has(g.key)
            ? sortRows(g.parts, sort, columns).map((a) => ({
                a,
                child: true,
                group: g,
              }))
            : []),
        ],
  );
  const nameOf = (a: AbilityRow, group: AbilityGroup | null) => {
    if (!group || group.head === a) return a.name;
    const label = labels.get(a.spellId);
    if (label && label !== a.name) return label;
    return a.name;
  };
  const top = Math.max(1, ...groups.map((g) => g.head.total));
  const sh = (label: string, column: string, left = false) => (
    <SortTh
      label={label}
      column={column}
      state={sort}
      onSort={onSort}
      numeric={column !== 'name'}
      className={`${th} ${left ? 'text-left' : 'text-right'}`}
    />
  );
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
    return abilitySeries(wholeFight(ctx), meter, row.key).map((s, i) => ({
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
              {sh('Name', 'name', true)}
              {sh('Amount', 'total', true)}
              {showCasts && sh('Casts', 'casts')}
              {showCasts && sh('Avg cast', 'avgCast')}
              {sh('Hits', 'hits')}
              {sh('Avg hit', 'avgHit')}
              {meter !== 'prevented' && sh('Crit %', 'crit')}
              {meter === 'damage' && sh('Uptime %', 'uptime')}
              {meter === 'damage' && sh('Miss %', 'miss')}
              {meter === 'healing' && sh('Overheal %', 'overheal')}
              {meter === 'taken' && sh('Mitigated %', 'mitigated')}
              {sh(RATE[meter], 'rate')}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ a, child, group }) => (
              <tr
                key={a.key}
                className={`border-b border-card/40 hover:bg-card/30 ${
                  child ? 'bg-card/10' : ''
                }`}
                onMouseEnter={(e) => {
                  if (meter === 'prevented') return;
                  const outer = box.current?.getBoundingClientRect();
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover({ ability: a, top: r.bottom - (outer?.top ?? 0) });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <td className={`${td} text-foreground-lighter`}>
                  <span
                    className={`inline-flex items-center gap-x-2 ${
                      child ? 'pl-6' : ''
                    }`}
                  >
                    {group && !child ? (
                      <button
                        type="button"
                        aria-expanded={open.has(group.key)}
                        title={`${group.parts.length} spells named ${a.name}`}
                        onClick={() =>
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.key)) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          })
                        }
                        className="w-4 text-foreground hover:text-foreground-lighter"
                      >
                        {open.has(group.key) ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </button>
                    ) : (
                      !child &&
                      groups.some((g) => g.parts.length > 1) && (
                        <span className="w-4" />
                      )
                    )}
                    <SpellIcon spellId={a.spellId} name={a.name} />
                    <span>
                      {nameOf(a, group)}
                      {a.by && (
                        <span className="text-foreground"> ({a.by})</span>
                      )}
                      {child &&
                        group?.parts[0] !== a &&
                        nameOf(a, group) === a.name && (
                          <span className="text-foreground text-xs">
                            {' '}
                            · {a.spellId}
                          </span>
                        )}
                      {group && !child && (
                        <span className="text-foreground text-xs">
                          {' '}
                          ×{group.parts.length}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className={td}>
                  <AmountBar
                    parts={[
                      {
                        value: a.total,
                        look:
                          a.kind === 'shield'
                            ? 'faint'
                            : a.kind === 'prevented' || meter === 'prevented'
                              ? 'striped'
                              : 'solid',
                        label:
                          a.kind === 'shield'
                            ? 'Shields'
                            : a.kind === 'prevented'
                              ? 'Prevented'
                              : 'Amount',
                      },
                      {
                        value:
                          meter === 'healing'
                            ? a.overheal
                            : meter === 'taken'
                              ? a.mitigated
                              : 0,
                        look: 'ghost',
                        label: meter === 'taken' ? 'Mitigated' : 'Overheal',
                      },
                    ]}
                    label={a.total}
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
      {meter === 'healing' && <BarKey prevented={row.prevented > 0} />}
      <p className="text-xs text-foreground m-0">
        {rows.length > 1 ? 'Hover an ability for who it hit. ' : ''}
        {meter === 'taken'
          ? 'Amounts include what shields soaked; the faint bar is what armour and reductions took off.'
          : meter === 'healing'
            ? 'Effective healing. Shields count for whoever cast them; mitigations (when switched on) for whoever cast the cooldown or has the passive, estimated from the log.'
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
  const [showTotal, setShowTotal] = React.useState(true);
  const [sort, onSort] = useSort('total');
  const sh = (label: string, column: string, left = false) => (
    <SortTh
      label={label}
      column={column}
      state={sort}
      onSort={onSort}
      numeric={column !== 'name'}
      className={`${th} ${left ? 'text-left' : 'text-right'}`}
    />
  );
  // Chart lines cover the whole fight even when a slice is picked.
  const chartRows = React.useMemo(() => {
    if (!ctx.filters.range) return rows;
    const whole = wholeFight(ctx);
    return meter === 'prevented'
      ? preventedRows(whole)
      : meterRows(whole, meter);
  }, [ctx, rows, meter]);

  // Raiders who share a class colour get different line styles.
  const dashes = React.useMemo(() => {
    const seen = new Map<string, number>();
    const out = new Map<string, string | undefined>();
    rows.forEach((r) => {
      const color = rowColor(r);
      const n = seen.get(color) ?? 0;
      seen.set(color, n + 1);
      out.set(r.key, DASHES[n % DASHES.length]);
    });
    return out;
  }, [rows]);

  const series = React.useMemo<ChartSeries[]>(() => {
    const sum = new Float64Array(chartRows[0]?.series.length ?? 0);
    chartRows.forEach((r) =>
      r.series.forEach((v, i) => {
        sum[i] += v;
      }),
    );
    const lines: ChartSeries[] = showTotal
      ? [
          {
            key: 'total',
            name: 'Total',
            color: 'hsl(var(--brand))',
            values: sum,
            width: 2.5,
          },
        ]
      : [];
    chartRows
      .filter((r) => r.key === focus || picked.includes(r.key))
      .forEach((r) =>
        lines.push({
          key: r.key,
          name: r.name,
          color: rowColor(r),
          values: r.series,
          width: 2,
          dash: dashes.get(r.key),
        }),
      );
    return lines;
  }, [chartRows, focus, picked, dashes, showTotal]);

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
        <button
          type="button"
          onClick={() => setShowTotal(!showTotal)}
          aria-pressed={showTotal}
          title={showTotal ? 'Hide the raid total' : 'Show the raid total'}
          className={`inline-flex items-center gap-x-1.5 rounded px-1 ${
            showTotal ? 'bg-card text-foreground-lighter' : 'opacity-70'
          }`}
        >
          <LineSwatch color="hsl(var(--brand))" />
          Total
        </button>
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            onMouseEnter={() => setFocus(r.key)}
            onMouseLeave={() => setFocus(null)}
            onClick={() => {
              // The first raider line hides the total, so lines are readable.
              if (!picked.length && !picked.includes(r.key))
                setShowTotal(false);
              setPicked((list) =>
                list.includes(r.key)
                  ? list.filter((k) => k !== r.key)
                  : [...list, r.key],
              );
            }}
            title={
              picked.includes(r.key)
                ? 'Take their line off the chart'
                : 'Put their line on the chart'
            }
            aria-pressed={picked.includes(r.key)}
            className={`inline-flex items-center gap-x-1.5 rounded px-1 hover:text-foreground-lighter ${
              picked.includes(r.key)
                ? 'bg-card text-foreground-lighter'
                : 'opacity-70'
            }`}
          >
            <LineSwatch color={rowColor(r)} dash={dashes.get(r.key)} />
            {r.name}
          </button>
        ))}
        {picked.length > 0 ? (
          <button
            type="button"
            className="text-brand hover:underline px-1"
            onClick={() => {
              setPicked([]);
              setShowTotal(true);
            }}
          >
            Clear lines
          </button>
        ) : (
          <span className="px-1">Click names to add their lines.</span>
        )}
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
    const abilities = sortRows(byAbility(rows), sort, {
      name: (a) => a.name,
      total: (a) => a.total,
      rate: (a) => a.total,
      casts: (a) => a.casts,
      hits: (a) => a.hits,
      crit: (a) => (a.hits ? a.crits / a.hits : 0),
    });
    const max = Math.max(1, ...abilities.map((a) => a.total));
    return (
      <div className="flex flex-col gap-y-3">
        {chart}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-foreground border-b border-card bg-card/30">
              <tr>
                {sh('Ability', 'name', true)}
                {sh('Amount', 'total', true)}
                {(meter === 'damage' || meter === 'healing') &&
                  sh('Casts', 'casts')}
                {sh('Hits', 'hits')}
                {meter !== 'prevented' && sh('Crit %', 'crit')}
                <th className={`${th} text-left`}>
                  {meter === 'taken' ? 'Who took it' : 'Who'}
                </th>
                {sh(RATE[meter], 'rate')}
              </tr>
            </thead>
            <tbody>
              {abilities.map((a) => (
                <tr
                  key={a.key}
                  className="border-b border-card/40 hover:bg-card/30"
                >
                  <td className={`${td} text-foreground-lighter`}>
                    <span className="inline-flex items-center gap-x-2">
                      <SpellIcon spellId={a.spellId} name={a.name} />
                      {a.name}
                    </span>
                  </td>
                  <td className={td}>
                    <AmountBar
                      parts={[
                        { value: a.total, look: 'solid', label: 'Amount' },
                      ]}
                      label={a.total}
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
              {sh('Name', 'name', true)}
              {sh('Amount', 'total', true)}
              {meter === 'taken' && sh('Mitigated', 'mitigated')}
              {meter === 'healing' && sh('Overheal', 'overheal')}
              {(meter === 'damage' || meter === 'healing') &&
                sh('Active', 'active')}
              {sh(RATE[meter], 'rate')}
            </tr>
          </thead>
          <tbody>
            {sortRows(rows, sort, {
              name: (r) => r.name,
              total: (r) => r.total,
              rate: (r) => r.total,
              mitigated: (r) =>
                r.total + r.mitigated
                  ? r.mitigated / (r.total + r.mitigated)
                  : 0,
              overheal: (r) =>
                r.total + r.overheal ? r.overheal / (r.total + r.overheal) : 0,
              active: (r) => r.active,
            }).map((r) => (
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
                    parts={
                      meter === 'healing'
                        ? [
                            {
                              value: r.total - r.shields - r.prevented,
                              look: 'solid',
                              label: 'Healing',
                            },
                            {
                              value: r.shields,
                              look: 'faint',
                              label: 'Shields',
                            },
                            {
                              value: r.prevented,
                              look: 'striped',
                              label: 'Mitigations',
                            },
                          ]
                        : meter === 'taken'
                          ? [
                              { value: r.total, look: 'solid', label: 'Taken' },
                              {
                                value: r.mitigated,
                                look: 'ghost',
                                label: 'Mitigated',
                              },
                            ]
                          : meter === 'prevented'
                            ? [
                                {
                                  value: r.total,
                                  look: 'striped',
                                  label: 'Prevented',
                                },
                              ]
                            : [
                                {
                                  value: r.total - r.pets,
                                  look: 'solid',
                                  label: 'Own',
                                },
                                { value: r.pets, look: 'faint', label: 'Pets' },
                              ]
                    }
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
      {meter === 'healing' && (
        <BarKey prevented={rows.some((r) => r.prevented > 0)} />
      )}
    </div>
  );
};

export default MeterView;
