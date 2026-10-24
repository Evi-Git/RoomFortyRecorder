import React from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  castRows,
  countRows,
  Ctx,
  deathRows,
  meterRows,
  powerSeries,
  raiders,
  resourceRows,
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

export const ResourceView = ({
  ctx,
  who,
  setWho,
}: {
  ctx: Ctx;
  who: string | null;
  setWho: (k: string | null) => void;
}) => {
  const rows = React.useMemo(() => resourceRows(ctx), [ctx]);
  const selected = rows.find((r) => r.key === who) ?? null;
  const samples = React.useMemo(
    () => (selected ? powerSeries(ctx, selected.key) : []),
    [ctx, selected],
  );
  if (selected) {
    const values = new Float64Array(Math.max(1, Math.ceil(ctx.total)));
    let last = samples[0]?.pct ?? 0;
    let j = 0;
    for (let s = 0; s < values.length; s += 1) {
      while (j < samples.length && samples[j].t <= s) {
        last = samples[j].pct;
        j += 1;
      }
      values[s] = last;
    }
    const type = samples[0]?.type;
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
        {samples.length > 0 && (
          <div className="rounded-md border border-card bg-background/40 p-3">
            <div className="text-xs text-foreground mb-1">
              {POWER_NAMES[type ?? -1] ?? 'Primary resource'} (% of max) over
              the fight
            </div>
            <TimeChart
              duration={ctx.total}
              series={[
                { key: 'p', name: '%', color: 'hsl(var(--brand))', values },
              ]}
              rateLabel="%"
              range={null}
              smoothing={1}
              height={160}
            />
          </div>
        )}
        {[...selected.types.entries()].map(([t, e]) => (
          <Box
            key={t}
            title={`${POWER_NAMES[t] ?? `Resource ${t}`}: ${thousands(e.gained)} gained, ${thousands(e.wasted)} wasted`}
          >
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
                {[...e.abilities.entries()]
                  .sort((a, b) => b[1][0] - a[1][0])
                  .map(([name, [g, w]]) => (
                    <tr key={name} className="border-b border-card/40">
                      <td className={`${td} text-foreground-lighter`}>
                        {name}
                      </td>
                      <td className={`${td} text-right`}>{thousands(g)}</td>
                      <td className={`${td} text-right`}>{thousands(w)}</td>
                      <td className={`${td} text-right`}>{pct(w, g + w, 1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Box>
        ))}
      </div>
    );
  }
  return (
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
                    {POWER_NAMES[t] ?? `Resource ${t}`}
                  </td>
                  <td className={`${td} text-right`}>{thousands(e.gained)}</td>
                  <td className={`${td} text-right`}>{thousands(e.wasted)}</td>
                  <td className={`${td} text-right`}>
                    {pct(e.wasted, e.gained + e.wasted, 1)}
                  </td>
                </tr>
              )),
          )}
        </tbody>
      </table>
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
                    <div className="relative h-3 rounded-sm bg-card/40">
                      {s.times.map((t) => (
                        <button
                          key={t}
                          type="button"
                          title={`${mmss(t)}${onWatch ? ' · click to watch' : ''}`}
                          onClick={() =>
                            onWatch?.(t, selected.player ? selected.name : null)
                          }
                          className="absolute top-0 h-3 w-[3px] -ml-[1px] rounded-[1px]"
                          style={{
                            left: `${(t / ctx.total) * 100}%`,
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
