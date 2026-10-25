import React from 'react';
import { useViewWindow } from './zoom';
import { ArrowLeft } from 'lucide-react';
import {
  castRows,
  countRows,
  Ctx,
  deathRows,
  meterRows,
  raiders,
  RESOURCE_STEP,
  resourceLevels,
  resourceRows,
  resourceTypes,
  viewSeconds,
} from './query';
import { POWER_NAMES } from './store';
import {
  classColor,
  compact,
  ENEMY_COLOR,
  mmss,
  pct,
  thousands,
} from './format';
import TimeChart from './TimeChart';
import SpellIcon from './SpellIcon';
import { sortRows, SortTh, useSort } from './sort';

/**
 * [RoomFortyRecorder] Logs page: Summary, Interrupts, Dispels, Resources
 * and Casts.
 */

const th = 'px-2 py-1.5 font-normal whitespace-nowrap';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';
const color = (r: { specId: number; player: boolean; pet?: boolean }) =>
  r.player || r.pet ? classColor(r.specId) : ENEMY_COLOR;

const Box = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-md border border-card bg-background/40 overflow-hidden">
    <h4 className="m-0 px-3 py-2 text-sm font-semibold text-foreground-lighter bg-card/40">
      {title}
    </h4>
    <div className="p-2">{children}</div>
  </section>
);

/* ---------------- Summary ---------------- */

export const SummaryView = ({
  ctx,
  onWatch,
}: {
  ctx: Ctx;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const seconds = viewSeconds(ctx);
  const damage = meterRows(ctx, 'damage');
  const healing = meterRows(ctx, 'healing');
  const taken = meterRows(ctx, 'taken');
  const deaths = deathRows(ctx);
  const roster = raiders(ctx);
  const sum = (rows: { total: number }[]) =>
    rows.reduce((n, r) => n + r.total, 0);
  const tiles: [string, string][] = [
    ['Fight time', mmss(seconds)],
    ['Raid DPS', thousands(sum(damage) / seconds)],
    ['Raid HPS', thousands(sum(healing) / seconds)],
    ['Damage taken / s', thousands(sum(taken) / seconds)],
    ['Deaths', String(deaths.length)],
  ];
  const top = (rows: typeof damage, title: string) => {
    const max = Math.max(1, ...rows.map((r) => r.total));
    return (
      <Box title={title}>
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.key}>
                <td
                  className={`${td} font-semibold`}
                  style={{ color: color(r) }}
                >
                  {r.name}
                </td>
                <td className="px-2 py-1 w-[50%]">
                  <span
                    className="block h-2.5 rounded-r-[3px]"
                    style={{
                      width: `${(r.total / max) * 100}%`,
                      background: color(r),
                      opacity: 0.85,
                    }}
                  />
                </td>
                <td className={`${td} text-right text-foreground-lighter`}>
                  {compact(r.total / seconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  };
  return (
    <div className="flex flex-col gap-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {tiles.map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-card bg-background/40 px-3 py-2"
          >
            <div className="text-[11px] text-foreground">{label}</div>
            <div className="font-display text-xl font-semibold tabular-nums text-foreground-lighter">
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
        {top(damage, 'Damage done')}
        {top(healing, 'Healing')}
        {top(taken, 'Damage taken')}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        <Box title={`Deaths (${deaths.length})`}>
          {deaths.length ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-foreground">
                <tr>
                  <th className={`${th} text-left`}>Time</th>
                  {ctx.pulls.length > 1 && (
                    <th className={`${th} text-left`}>Pull</th>
                  )}
                  <th className={`${th} text-left`}>Raider</th>
                  <th className={`${th} text-left`}>Killing blow</th>
                </tr>
              </thead>
              <tbody>
                {deaths.map((d) => (
                  <tr
                    key={`${d.pull}${d.at}${d.name}`}
                    className={onWatch ? 'cursor-pointer hover:bg-card/30' : ''}
                    onClick={() => onWatch?.(d.at - 3, d.name)}
                    title={onWatch ? 'Watch it' : undefined}
                  >
                    <td className={td}>{mmss(d.at)}</td>
                    {ctx.pulls.length > 1 && <td className={td}>{d.pull}</td>}
                    <td
                      className={`${td} font-semibold`}
                      style={{ color: classColor(d.specId) }}
                    >
                      {d.name}
                    </td>
                    <td className={`${td} text-foreground`}>
                      {d.spell || '–'}
                      {d.source ? ` (${d.source})` : ''}
                      {d.amount ? ` · ${compact(d.amount)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-foreground m-1">Nobody died.</p>
          )}
        </Box>
        <Box title={`Raid (${roster.length})`}>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {roster.map((r) => (
              <span key={r.guid} style={{ color: classColor(r.specId) }}>
                {r.name}
              </span>
            ))}
          </div>
        </Box>
      </div>
    </div>
  );
};

/* ---------------- Interrupts and dispels ---------------- */

export const CountView = ({
  ctx,
  kind,
}: {
  ctx: Ctx;
  kind: 'interrupt' | 'dispel';
}) => {
  const rows = React.useMemo(() => countRows(ctx, kind), [ctx, kind]);
  const people = new Map<
    string,
    { name: string; specId: number; player: boolean; n: number }
  >();
  rows.forEach((r) =>
    r.by.forEach(([ref, n]) => {
      const p = people.get(ref.key) ?? {
        name: ref.name,
        specId: ref.specId,
        player: ref.player,
        n: 0,
      };
      p.n += n;
      people.set(ref.key, p);
    }),
  );
  if (!rows.length) {
    return (
      <p className="text-sm text-foreground">
        No {kind === 'interrupt' ? 'interrupts' : 'dispels'} with these filters.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-start">
      <Box title={kind === 'interrupt' ? 'Interrupted' : 'Removed'}>
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card">
            <tr>
              <th className={`${th} text-left`}>
                {kind === 'interrupt' ? 'Spell' : 'Aura'}
              </th>
              <th className={`${th} text-right`}>Count</th>
              <th className={`${th} text-left`}>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.spellId} className="border-b border-card/40">
                <td className={`${td} text-foreground-lighter`}>
                  <span className="inline-flex items-center gap-x-2">
                    <SpellIcon spellId={r.spellId} name={r.name} />
                    {r.name}
                  </span>
                </td>
                <td className={`${td} text-right`}>{r.total}</td>
                <td className="px-2 py-1 text-xs">
                  {r.by.map(([ref, n], i) => (
                    <span key={ref.key}>
                      {i ? ', ' : ''}
                      <span style={{ color: color(ref) }}>{ref.name}</span>
                      {n > 1 ? ` ×${n}` : ''}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      <Box title="By raider">
        <table className="w-full text-sm">
          <tbody>
            {[...people.values()]
              .sort((a, b) => b.n - a.n)
              .map((p) => (
                <tr key={p.name}>
                  <td
                    className={`${td} font-semibold`}
                    style={{ color: color(p) }}
                  >
                    {p.name}
                  </td>
                  <td className={`${td} text-right`}>{p.n}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Box>
    </div>
  );
};

/* ---------------- Resources ---------------- */

export type ResourceChartExtras = {
  range: [number, number] | null;
  setRange: (r: [number, number] | null) => void;
  onPick?: (seconds: number, name: string | null) => void;
  bands: [number, number][];
  boundaries: { t: number; label: string }[];
};

const HEALER_SPECS = new Set([65, 105, 256, 257, 264, 270, 1468]);

const DASHES = [undefined, '6 3', '2 3', '8 3 2 3'];

const powerName = (t: number) => POWER_NAMES[t] ?? `Resource ${t}`;

/** Gained / wasted by ability, for one resource. */
const ResourceAbilities = ({
  entry,
}: {
  entry: { abilities: Map<string, [number, number]> };
}) => (
  <table className="w-full text-sm">
    <thead className="text-xs text-foreground border-b border-card">
      <tr>
        <th className={`${th} text-left`}>Ability</th>
        <th className={`${th} text-right`}>Gained</th>
        <th className={`${th} text-right`}>Wasted</th>
        <th className={`${th} text-right`}>Waste %</th>
      </tr>
    </thead>
    <tbody>
      {[...entry.abilities.entries()]
        .sort((a, b) => b[1][0] - a[1][0])
        .map(([name, [g, w]]) => (
          <tr key={name} className="border-b border-card/40">
            <td className={`${td} text-foreground-lighter`}>{name}</td>
            <td className={`${td} text-right`}>{thousands(g)}</td>
            <td className={`${td} text-right`}>{thousands(w)}</td>
            <td className={`${td} text-right`}>{pct(w, g + w, 1)}</td>
          </tr>
        ))}
    </tbody>
  </table>
);

const pctLabel = (v: number) => `${Math.round(v)}%`;
const amountLabel = (v: number) => (v >= 10000 ? compact(v) : thousands(v));

export const ResourceView = ({
  ctx,
  who,
  setWho,
  extras,
}: {
  ctx: Ctx;
  who: string | null;
  setWho: (k: string | null) => void;
  extras: ResourceChartExtras;
}) => {
  const rows = React.useMemo(() => resourceRows(ctx), [ctx]);
  const types = React.useMemo(() => resourceTypes(ctx), [ctx]);
  const roster = React.useMemo(() => raiders(ctx), [ctx]);
  // Resources anyone has, most common first (Mana usually).
  const allTypes = React.useMemo(() => {
    const count = new Map<number, number>();
    types.forEach((m) =>
      m.forEach((_, t) => count.set(t, (count.get(t) ?? 0) + 1)),
    );
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([t]) => t);
  }, [types]);
  const [type, setType] = React.useState<number | null>(null);
  const shownType =
    type !== null && allTypes.includes(type) ? type : allTypes[0];
  const [asPct, setAsPct] = React.useState(true);
  // Raiders hidden from the overview chart (click a name to toggle).
  // Null: the default (for mana, only healers; else everyone).
  const [hiddenSet, setHidden] = React.useState<Set<string> | null>(null);
  const selected = rows.find((r) => r.key === who) ?? null;
  const pick = extras.onPick;

  const chartProps = {
    duration: ctx.total,
    range: extras.range,
    onRange: extras.setRange,
    bands: extras.bands,
    boundaries: extras.boundaries,
    smoothing: 0,
    step: RESOURCE_STEP,
    zoomable: true,
    showZero: true,
    stepped: true,
  };

  // Everyone with this resource, one line each.
  const holders = React.useMemo(
    () =>
      shownType === undefined
        ? []
        : roster.filter((r) => types.get(r.guid)?.has(shownType)),
    [roster, types, shownType],
  );
  const hidden = React.useMemo(() => {
    if (hiddenSet) return hiddenSet;
    if (shownType !== 0) return new Set<string>();
    const healers = holders.filter((r) => HEALER_SPECS.has(r.specId));
    if (!healers.length) return new Set<string>();
    return new Set(
      holders.filter((r) => !HEALER_SPECS.has(r.specId)).map((r) => r.guid),
    );
  }, [hiddenSet, shownType, holders]);
  const overview = React.useMemo(() => {
    if (selected || shownType === undefined) return [];
    const seen = new Map<string, number>();
    return holders.map((r) => {
      const c = classColor(r.specId);
      const n = seen.get(c) ?? 0;
      seen.set(c, n + 1);
      return {
        key: r.guid,
        name: r.name,
        color: c,
        dash: DASHES[n % DASHES.length],
        width: 1.5,
        values: hidden.has(r.guid)
          ? new Float64Array(0)
          : resourceLevels(ctx, r.guid, shownType, asPct),
      };
    });
  }, [selected, shownType, holders, hidden, ctx, asPct]);
  const shared =
    shownType === undefined
      ? 0
      : Math.max(
          0,
          ...holders.map((r) => types.get(r.guid)?.get(shownType) ?? 0),
        );

  // One raider: each of their resources on its own chart.
  const mine = React.useMemo(() => {
    if (!selected) return [];
    const have = types.get(selected.key) ?? new Map<number, number>();
    const list = new Set<number>([...have.keys(), ...selected.types.keys()]);
    return [...list]
      .sort((a, b) => (a === 0 ? 1 : 0) - (b === 0 ? 1 : 0) || a - b)
      .map((t) => ({
        type: t,
        max: have.get(t) ?? 0,
        values: have.has(t)
          ? resourceLevels(ctx, selected.key, t, false)
          : null,
        entry: selected.types.get(t),
      }));
  }, [selected, types, ctx]);

  if (selected) {
    return (
      <div className="flex flex-col gap-y-3">
        <div className="flex items-center gap-x-3">
          <button
            type="button"
            onClick={() => setWho(null)}
            className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
          >
            <ArrowLeft size={14} /> Everyone
          </button>
          <span
            className="font-display text-lg font-semibold"
            style={{ color: color(selected) }}
          >
            {selected.name}
          </span>
        </div>
        {mine.map((m) => (
          <Box
            key={m.type}
            title={`${powerName(m.type)}${m.entry ? ` · ${thousands(m.entry.gained)} gained, ${thousands(m.entry.wasted)} wasted (${pct(m.entry.wasted, m.entry.gained + m.entry.wasted, 1)})` : ''}`}
          >
            {m.values && (
              <div className="px-3 pt-2">
                <TimeChart
                  {...chartProps}
                  series={[
                    {
                      key: `r${m.type}`,
                      name: powerName(m.type),
                      color: color(selected),
                      values: m.values,
                    },
                  ]}
                  rateLabel={powerName(m.type)}
                  onPick={pick ? (t) => pick(t, selected.name) : undefined}
                  yMax={m.max || undefined}
                  format={amountLabel}
                  height={170}
                />
              </div>
            )}
            {m.entry && <ResourceAbilities entry={m.entry} />}
          </Box>
        ))}
        {!mine.length && (
          <p className="text-sm text-foreground m-0">
            No resource readings for {selected.name} in this view.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-y-3">
      {shownType !== undefined && (
        <div className="rounded-md border border-card bg-background/40 p-3">
          <div className="flex items-center gap-x-2 mb-2 flex-wrap">
            <select
              className="bg-card text-foreground-lighter rounded px-2 h-7 text-xs border border-background"
              value={shownType}
              onChange={(e) => {
                setType(Number(e.target.value));
                setHidden(null);
              }}
              aria-label="Resource"
            >
              {allTypes.map((t) => (
                <option key={t} value={t}>
                  {powerName(t)}
                </option>
              ))}
            </select>
            <div className="inline-flex rounded border border-card text-xs overflow-hidden">
              {[
                [true, '% of max'],
                [false, 'Amount'],
              ].map(([v, label]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setAsPct(v as boolean)}
                  className={`px-2 h-7 ${asPct === v ? 'bg-brand/20 text-foreground-lighter' : 'text-foreground hover:text-foreground-lighter'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-foreground">
              {powerName(shownType)} over the fight · drag to slice, Zoom to
              look closer
            </span>
          </div>
          <TimeChart
            {...chartProps}
            series={overview.filter((o) => !hidden.has(o.key))}
            rateLabel={powerName(shownType)}
            onPick={pick ? (t) => pick(t, null) : undefined}
            yMax={asPct ? 100 : shared || undefined}
            format={asPct ? pctLabel : amountLabel}
            height={240}
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] mt-1">
            {overview.map((sr) => {
              const off = hidden.has(sr.key);
              return (
                <button
                  key={sr.key}
                  type="button"
                  onClick={() => {
                    const next = new Set(hidden);
                    if (off) next.delete(sr.key);
                    else next.add(sr.key);
                    setHidden(next);
                  }}
                  className={`inline-flex items-center gap-x-1 ${off ? 'opacity-40' : ''}`}
                  title={off ? 'Show this line' : 'Hide this line'}
                >
                  <svg width="18" height="6" aria-hidden>
                    <line
                      x1="0"
                      x2="18"
                      y1="3"
                      y2="3"
                      stroke={sr.color}
                      strokeWidth="2"
                      strokeDasharray={sr.dash}
                    />
                  </svg>
                  <span style={{ color: sr.color }}>{sr.name}</span>
                </button>
              );
            })}
            {overview.length > 1 && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() =>
                  setHidden(
                    hidden.size
                      ? new Set()
                      : new Set(overview.map((o) => o.key)),
                  )
                }
              >
                {hidden.size ? 'Show all' : 'Hide all'}
              </button>
            )}
            <span className="text-foreground">
              Click a name in the table for all of their resources.
            </span>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card bg-card/30">
            <tr>
              <th className={`${th} text-left`}>Name</th>
              <th className={`${th} text-left`}>Resource</th>
              <th className={`${th} text-right`}>Gained</th>
              <th className={`${th} text-right`}>Wasted</th>
              <th className={`${th} text-right`}>Waste %</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) =>
              [...r.types.entries()]
                .sort((a, b) => b[1].gained - a[1].gained)
                .map(([t, e], i) => (
                  <tr
                    key={`${r.key}${t}`}
                    className={`${i ? '' : 'border-t'} border-card/40 hover:bg-card/30`}
                  >
                    <td className={td}>
                      {i === 0 && (
                        <button
                          type="button"
                          onClick={() => setWho(r.key)}
                          className="font-semibold hover:underline"
                          style={{ color: color(r) }}
                        >
                          {r.name}
                        </button>
                      )}
                    </td>
                    <td className={`${td} text-foreground-lighter`}>
                      {powerName(t)}
                    </td>
                    <td className={`${td} text-right`}>
                      {thousands(e.gained)}
                    </td>
                    <td className={`${td} text-right`}>
                      {thousands(e.wasted)}
                    </td>
                    <td className={`${td} text-right`}>
                      {pct(e.wasted, e.gained + e.wasted, 1)}
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------------- Casts ---------------- */

export const CastView = ({
  ctx,
  who,
  setWho,
  onWatch,
}: {
  ctx: Ctx;
  who: string | null;
  setWho: (k: string | null) => void;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const rows = React.useMemo(() => castRows(ctx), [ctx]);
  const [sort, onSort] = useSort('count');
  const [v0, v1] = useViewWindow(ctx.filters.range, ctx.total);
  const seconds = viewSeconds(ctx);
  const minutes = seconds / 60;
  const selected = rows.find((r) => r.key === who) ?? null;
  if (selected) {
    return (
      <div className="flex flex-col gap-y-3">
        <div className="flex items-center gap-x-3">
          <button
            type="button"
            onClick={() => setWho(null)}
            className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
          >
            <ArrowLeft size={14} /> Everyone
          </button>
          <span
            className="font-display text-lg font-semibold"
            style={{ color: color(selected) }}
          >
            {selected.name}
          </span>
          <span className="text-sm text-foreground">
            {selected.total} casts · {(selected.total / minutes).toFixed(1)} a
            minute
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-foreground border-b border-card bg-card/30">
              <tr>
                <SortTh
                  label="Spell"
                  column="name"
                  state={sort}
                  onSort={onSort}
                  numeric={false}
                  className={`${th} text-left`}
                />
                <SortTh
                  label="Casts"
                  column="count"
                  state={sort}
                  onSort={onSort}
                  className={`${th} text-right`}
                />
                <SortTh
                  label="Per minute"
                  column="count"
                  state={sort}
                  onSort={onSort}
                  className={`${th} text-right`}
                />
                <th className={`${th} text-left w-[50%]`}>When</th>
              </tr>
            </thead>
            <tbody>
              {sortRows(selected.spells, sort, {
                name: (x) => x.name,
                count: (x) => x.count,
              }).map((s) => (
                <tr
                  key={s.spellId}
                  className="border-b border-card/40 hover:bg-card/30"
                >
                  <td className={`${td} text-foreground-lighter`}>
                    <span className="inline-flex items-center gap-x-2">
                      <SpellIcon spellId={s.spellId} name={s.name} />
                      {s.name}
                    </span>
                  </td>
                  <td className={`${td} text-right`}>{s.count}</td>
                  <td className={`${td} text-right`}>
                    {(s.count / minutes).toFixed(1)}
                  </td>
                  <td className="px-2 py-1">
                    <div className="relative h-3 rounded-sm bg-card/40 overflow-hidden">
                      {s.times
                        .filter((t) => t >= v0 && t <= v1)
                        .map((t) => (
                          <button
                            key={t}
                            type="button"
                            title={`${mmss(t)}${onWatch ? ' · click to watch' : ''}`}
                            onClick={() =>
                              onWatch?.(
                                t,
                                selected.player ? selected.name : null,
                              )
                            }
                            className="absolute top-0 h-3 w-[3px] -ml-[1px] rounded-[1px]"
                            style={{
                              left: `${((t - v0) / (v1 - v0)) * 100}%`,
                              background: color(selected),
                            }}
                          />
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-foreground border-b border-card bg-card/30">
          <tr>
            <SortTh
              label="Name"
              column="name"
              state={sort}
              onSort={onSort}
              numeric={false}
              className={`${th} text-left`}
            />
            <SortTh
              label="Casts"
              column="count"
              state={sort}
              onSort={onSort}
              className={`${th} text-left w-[45%]`}
            />
            <SortTh
              label="Per minute"
              column="count"
              state={sort}
              onSort={onSort}
              className={`${th} text-right`}
            />
            <th className={`${th} text-left`}>Most cast</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(rows, sort, {
            name: (x) => x.name,
            count: (x) => x.total,
          }).map((r) => (
            <tr
              key={r.key}
              className="border-b border-card/40 hover:bg-card/30"
            >
              <td className={td}>
                <button
                  type="button"
                  onClick={() => setWho(r.key)}
                  className="font-semibold hover:underline"
                  style={{ color: color(r) }}
                >
                  {r.name}
                </button>
              </td>
              <td className="px-2 py-1">
                <span className="flex items-center gap-x-2">
                  <span
                    className="h-2.5 rounded-r-[3px]"
                    style={{
                      width: `${(r.total / max) * 85}%`,
                      background: color(r),
                      opacity: 0.85,
                    }}
                  />
                  <span className="text-xs tabular-nums">{r.total}</span>
                </span>
              </td>
              <td className={`${td} text-right`}>
                {(r.total / minutes).toFixed(1)}
              </td>
              <td className={`${td} text-xs text-foreground`}>
                {r.spells
                  .slice(0, 3)
                  .map((s) => `${s.name} ${s.count}`)
                  .join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
