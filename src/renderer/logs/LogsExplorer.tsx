import React from 'react';
import { Clock, List, Search, Table2 } from 'lucide-react';
import Switch from '../components/Switch/Switch';
import { CastTimeline, AuraView, WatchHint } from '../LogsTimeline';
import { compileExpression } from './expression';
import {
  abilityNames,
  DEFAULT_FILTERS,
  enemyNames,
  Filters,
  lustBands,
  makeCtx,
  meterRows,
  preventedRows,
  raiders,
  viewSeconds,
} from './query';
import { PullMeta, PullStore } from './store';
import { usePullStores } from './load';
import MeterView, { MeterKind, RATE } from './MeterView';
import AuraTables from './AuraTables';
import { CastView, CountView, ResourceView, SummaryView } from './OtherTables';
import EventsView, { EventTab } from './EventsView';
import QueriesView from './QueriesView';
import { timelineOf } from './timeline';
import { classColor, compact, mmss } from './format';

/**
 * [RoomFortyRecorder] The Logs page's pull explorer, after Warcraft Logs:
 * Tables / Timelines / Events / Queries over one pull or several added up,
 * with tabs (Summary, Damage Done, Damage Taken, Healing, Damage Prevented,
 * Buffs, Debuffs, Interrupts, Dispels, Resources, Casts) and filters
 * (friendlies/enemies, enemy, ability, pets, ignore after deaths, filter
 * expression, a slice of the fight).
 */

type Mode = 'tables' | 'timelines' | 'events' | 'queries';
type Tab = EventTab;

const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'damage', label: 'Damage Done' },
  { key: 'taken', label: 'Damage Taken' },
  { key: 'healing', label: 'Healing' },
  { key: 'prevented', label: 'Damage Prevented' },
  { key: 'buffs', label: 'Buffs' },
  { key: 'debuffs', label: 'Debuffs' },
  { key: 'interrupts', label: 'Interrupts' },
  { key: 'dispels', label: 'Dispels' },
  { key: 'resources', label: 'Resources' },
  { key: 'casts', label: 'Casts' },
];

const MODES: { key: Mode; label: string; icon: React.ReactNode }[] = [
  { key: 'tables', label: 'Tables', icon: <Table2 size={18} /> },
  { key: 'timelines', label: 'Timelines', icon: <Clock size={18} /> },
  { key: 'events', label: 'Events', icon: <List size={18} /> },
  { key: 'queries', label: 'Queries', icon: <Search size={18} /> },
];

const METER_TABS = new Set<Tab>(['damage', 'taken', 'healing', 'prevented']);

const remembered = <T extends string>(
  key: string,
  fallback: T,
  allowed: T[],
) => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
};

export type Watch = {
  can: boolean;
  /** False if there's no recording of that pull here. */
  open: (pull: PullMeta, name: string | null, seconds: number) => boolean;
};

/** Per raider rate, pull by pull (shown when several pulls are picked). */
const PullByPull = ({
  stores,
  filters,
  meter,
}: {
  stores: PullStore[];
  filters: Filters;
  meter: MeterKind;
}) => {
  const table = React.useMemo(() => {
    const byRaider = new Map<
      string,
      { name: string; specId: number; rates: (number | null)[] }
    >();
    stores.forEach((p, i) => {
      const ctx = makeCtx([p], { ...filters, range: null });
      const rows =
        meter === 'prevented' ? preventedRows(ctx) : meterRows(ctx, meter);
      const seconds = viewSeconds(ctx);
      rows.forEach((r) => {
        if (!r.player) return;
        const entry = byRaider.get(r.key) ?? {
          name: r.name,
          specId: r.specId,
          rates: stores.map(() => null),
        };
        entry.rates[i] = r.total / seconds;
        byRaider.set(r.key, entry);
      });
    });
    return [...byRaider.values()]
      .map((r) => {
        const values = r.rates.filter((v): v is number => v !== null);
        return {
          ...r,
          avg: values.reduce((n, v) => n + v, 0) / Math.max(1, values.length),
          best: Math.max(0, ...values),
        };
      })
      .sort((a, b) => b.avg - a.avg);
  }, [stores, filters, meter]);
  return (
    <section className="rounded-md border border-card bg-background/40 overflow-hidden">
      <h4 className="m-0 px-3 py-2 text-sm font-semibold text-foreground-lighter bg-card/40">
        Pull by pull ({RATE[meter]})
      </h4>
      <div className="overflow-x-auto p-2">
        <table className="text-sm border-separate border-spacing-[2px]">
          <thead className="text-xs text-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">Raider</th>
              {stores.map((p) => (
                <th
                  key={p.id}
                  className="px-2 py-1 text-right font-normal whitespace-nowrap"
                >
                  {p.label}
                </th>
              ))}
              <th className="px-2 py-1 text-right font-normal">Average</th>
              <th className="px-2 py-1 text-right font-normal">Best</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.name}>
                <td
                  className="px-2 py-1 whitespace-nowrap font-semibold"
                  style={{ color: classColor(r.specId) }}
                >
                  {r.name}
                </td>
                {r.rates.map((rate, i) => (
                  <td
                    key={i}
                    className="px-2 py-1 text-right tabular-nums rounded-[3px] min-w-[64px]"
                    style={{
                      background:
                        rate && r.best
                          ? `hsl(var(--brand) / ${Math.max(0.04, (rate / r.best - 0.6) * 0.9)})`
                          : undefined,
                      color: rate
                        ? 'hsl(var(--foreground-lighter))'
                        : 'hsl(var(--foreground) / 0.4)',
                    }}
                  >
                    {rate ? compact(rate) : '–'}
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums font-semibold text-foreground-lighter">
                  {compact(r.avg)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-foreground">
                  {compact(r.best)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground m-0 px-3 pb-2">
        Shading: each raider against their own best here (darker is closer).
      </p>
    </section>
  );
};

const LogsExplorer = ({
  metas,
  watch,
  fallback,
}: {
  metas: PullMeta[];
  watch: Watch | null;
  /** Shown for a single pull whose full log isn't here yet. */
  fallback: (missing: PullMeta[]) => React.ReactNode;
}) => {
  const load = usePullStores(metas);
  const [mode, setModeState] = React.useState<Mode>(() =>
    remembered('rf-logs-view', 'tables', [
      'tables',
      'timelines',
      'events',
      'queries',
    ]),
  );
  const [tab, setTabState] = React.useState<Tab>(() =>
    remembered<Tab>(
      'rf-logs-tab',
      'damage',
      TABS.map((t) => t.key),
    ),
  );
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [group, setGroup] = React.useState<'source' | 'ability'>('source');
  const [who, setWho] = React.useState<string | null>(null);
  const [auraWho, setAuraWho] = React.useState<string | null>(null);
  const [exprText, setExprText] = React.useState('');
  const [exprError, setExprError] = React.useState('');
  const [timelinePull, setTimelinePull] = React.useState(0);
  const [notice, setNotice] = React.useState('');

  const setMode = (m: Mode) => {
    setModeState(m);
    remember('rf-logs-view', m);
  };
  const setTab = (t: Tab) => {
    setTabState(t);
    setWho(null);
    remember('rf-logs-tab', t);
  };
  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  // New pulls: start over on the whole fight.
  const key = metas.map((m) => m.id).join(',');
  const [shownKey, setShownKey] = React.useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setFilters((f) => ({ ...f, range: null, enemy: null, ability: null }));
    setWho(null);
    setTimelinePull(0);
    setNotice('');
  }

  const ready =
    load.stores.length > 0 &&
    load.stores.map((s) => s.id).join(',') ===
      metas
        .filter((m) => !load.errors[m.id])
        .map((m) => m.id)
        .join(',');
  const loaded = load.stores;
  const stores = React.useMemo(() => (ready ? loaded : []), [ready, loaded]);
  const ctx = React.useMemo(() => makeCtx(stores, filters), [stores, filters]);

  const meter: MeterKind | null = METER_TABS.has(tab)
    ? (tab as MeterKind)
    : null;
  const rows = React.useMemo(() => {
    if (!stores.length || !meter || mode !== 'tables') return [];
    return meter === 'prevented' ? preventedRows(ctx) : meterRows(ctx, meter);
  }, [ctx, meter, stores.length, mode]);
  const enemies = React.useMemo(
    () => (stores.length ? enemyNames(makeCtx(stores, DEFAULT_FILTERS)) : []),
    [stores],
  );
  const roster = React.useMemo(
    () => (stores.length ? raiders(makeCtx(stores, DEFAULT_FILTERS)) : []),
    [stores],
  );
  const abilities = React.useMemo(() => abilityNames(rows), [rows]);
  const bands = React.useMemo(
    () => (stores.length ? lustBands(makeCtx(stores, DEFAULT_FILTERS)) : []),
    [stores],
  );
  const markers = React.useMemo(
    () =>
      stores.flatMap((p, pi) =>
        p.deaths.map((d) => ({
          t: ctx.offsets[pi] + d.t,
          label: `${p.units[d.unit].name} died${d.spell >= 0 ? ` (${p.spells[d.spell]?.name})` : ''}`,
        })),
      ),
    [stores, ctx.offsets],
  );
  const boundaries = React.useMemo(
    () =>
      stores.length > 1
        ? stores.map((p, i) => ({ t: ctx.offsets[i], label: p.label }))
        : [],
    [stores, ctx.offsets],
  );

  const onWatch = React.useMemo(() => {
    if (!watch?.can || !stores.length) return undefined;
    return (t: number, name: string | null) => {
      let pi = 0;
      while (pi + 1 < stores.length && ctx.offsets[pi + 1] <= t) pi += 1;
      const seconds = t - ctx.offsets[pi];
      setNotice(
        watch.open(stores[pi], name, seconds)
          ? ''
          : `No recording of ${stores[pi].label}${name ? ` from ${name}` : ''} here.`,
      );
    };
  }, [watch, stores, ctx.offsets]);

  /* ---------- Loading and missing logs ---------- */

  const missing = metas.filter((m) => load.errors[m.id]);
  if (!ready) {
    if (!load.loading && missing.length === metas.length)
      return <>{fallback(missing)}</>;
    return (
      <div className="flex flex-col gap-y-2 max-w-[520px]">
        <p className="text-sm text-foreground m-0">Reading the combat log…</p>
        {metas.map((m) => {
          const f = load.progress[m.id];
          return (
            <div key={m.id} className="flex items-center gap-x-3 text-xs">
              <span className="w-[70px] text-foreground-lighter">
                {m.label}
              </span>
              <span className="flex-1 h-1.5 rounded bg-card overflow-hidden">
                <span
                  className="block h-full bg-brand transition-all"
                  style={{
                    width: `${Math.round((f ?? (load.errors[m.id] ? 0 : 0.02)) * 100)}%`,
                  }}
                />
              </span>
              <span className="w-[120px] text-foreground">
                {load.errors[m.id]
                  ? 'Not available'
                  : f === undefined
                    ? 'Waiting'
                    : `${Math.round(f * 100)}%`}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  /* ---------- Controls ---------- */

  const field =
    'bg-card text-foreground-lighter rounded px-2 h-8 text-xs border border-background';
  const applyExpr = (text: string) => {
    try {
      const fn = compileExpression(text);
      setExprError('');
      patch({ expr: fn });
    } catch (error) {
      setExprError((error as Error).message);
    }
  };
  const sideSwitch = (
    <div className="flex items-center gap-x-3 text-sm">
      {(['friendly', 'enemy'] as const).map((side) => (
        <button
          key={side}
          type="button"
          onClick={() => {
            patch({ side, enemy: null });
            setWho(null);
          }}
          className={`pb-0.5 border-b-2 ${
            filters.side === side
              ? 'border-brand text-foreground-lighter font-semibold'
              : 'border-transparent text-foreground hover:text-foreground-lighter'
          }`}
        >
          {side === 'friendly' ? 'Friendlies' : 'Enemies'}
        </button>
      ))}
    </div>
  );

  const showFilters = mode === 'tables' || mode === 'events';
  const multi = stores.length > 1;
  const fightSeconds = viewSeconds(ctx);

  return (
    <div className="flex flex-col gap-y-3 min-w-0">
      {missing.length > 0 && (
        <p className="text-xs text-yellow-400 m-0">
          Left out (full log not sent yet):{' '}
          {missing.map((m) => m.label).join(', ')}.
        </p>
      )}
      <div className="flex items-end gap-x-4 flex-wrap border-b border-card pb-0">
        <div className="pb-2">{sideSwitch}</div>
        <div className="ml-auto flex">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`flex flex-col items-center gap-y-0.5 px-4 pb-2 pt-1 text-xs border-b-2 ${
                mode === m.key
                  ? 'border-brand text-foreground-lighter'
                  : 'border-transparent text-foreground hover:text-foreground-lighter'
              }`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode !== 'queries' && mode !== 'timelines' && (
        <div className="flex flex-wrap gap-x-1 border-b border-card">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${
                tab === t.key
                  ? 'border-brand text-foreground-lighter'
                  : 'border-transparent text-foreground hover:text-foreground-lighter'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className={field}
            value={filters.enemy ?? ''}
            onChange={(e) => patch({ enemy: e.target.value || null })}
            aria-label="Enemy"
          >
            <option value="">All enemies</option>
            {enemies.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {meter && (
            <select
              className={field}
              value={filters.ability ?? ''}
              onChange={(e) =>
                patch({
                  ability: e.target.value ? Number(e.target.value) : null,
                })
              }
              aria-label="Ability"
            >
              <option value="">All abilities</option>
              {abilities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          {(tab === 'buffs' || tab === 'debuffs') &&
            filters.side === 'friendly' && (
              <select
                className={field}
                value={auraWho ?? ''}
                onChange={(e) => setAuraWho(e.target.value || null)}
                aria-label="Raider"
              >
                <option value="">All raiders</option>
                {roster.map((r) => (
                  <option key={r.guid} value={r.guid}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
          {meter && meter !== 'prevented' && (
            <select
              className={field}
              value={group}
              onChange={(e) => setGroup(e.target.value as 'source' | 'ability')}
              aria-label="Group by"
            >
              <option value="source">
                {meter === 'taken' ? 'By raider' : 'Done by source'}
              </option>
              <option value="ability">
                {meter === 'taken' ? 'By ability' : 'Done by ability'}
              </option>
            </select>
          )}
          <select
            className={field}
            value={filters.deathCutoff}
            onChange={(e) => patch({ deathCutoff: Number(e.target.value) })}
            aria-label="Ignore events after player deaths"
          >
            <option value={0}>Count every event</option>
            {[1, 2, 3, 4, 5, 10].map((n) => (
              <option key={n} value={n}>
                Ignore events after death {n}
              </option>
            ))}
          </select>
          {(meter === 'damage' || meter === 'healing' || tab === 'casts') && (
            <label className="flex items-center gap-x-1.5 text-xs text-foreground">
              <Switch
                checked={filters.pets}
                onCheckedChange={(v: boolean) => patch({ pets: v })}
              />
              Pets
            </label>
          )}
          <form
            className="flex items-center gap-x-1 flex-1 min-w-[260px]"
            onSubmit={(e) => {
              e.preventDefault();
              applyExpr(exprText);
            }}
          >
            <input
              value={exprText}
              onChange={(e) => setExprText(e.target.value)}
              onBlur={() => applyExpr(exprText)}
              placeholder='Filter expression, e.g. ability.name ~ "breath"'
              spellCheck={false}
              className={`${field} flex-1 font-mono`}
              aria-label="Filter expression"
            />
            {exprText && (
              <button
                type="button"
                className="text-xs text-brand hover:underline px-1"
                onClick={() => {
                  setExprText('');
                  applyExpr('');
                }}
              >
                Clear
              </button>
            )}
          </form>
        </div>
      )}
      {exprError && showFilters && (
        <p className="text-xs text-red-400 m-0">{exprError}</p>
      )}

      <div className="flex items-center gap-x-3 flex-wrap text-xs text-foreground">
        <span>
          {multi ? `${stores.length} pulls added up` : stores[0].label} ·{' '}
          {mmss(fightSeconds)}
          {filters.range
            ? ` (slice ${mmss(filters.range[0])}–${mmss(filters.range[1])})`
            : ''}
        </span>
        {filters.range && (
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => patch({ range: null })}
          >
            Whole fight
          </button>
        )}
        {!filters.range && mode === 'tables' && meter && (
          <span>Drag across the chart to look at a slice.</span>
        )}
        {watch && <WatchHint can={watch.can} />}
        {notice && <span className="text-yellow-400">{notice}</span>}
      </div>

      {mode === 'tables' && (
        <>
          {tab === 'summary' && <SummaryView ctx={ctx} onWatch={onWatch} />}
          {meter && (
            <MeterView
              ctx={ctx}
              meter={meter}
              rows={rows}
              group={meter === 'prevented' ? 'source' : group}
              who={who}
              setWho={setWho}
              extras={{
                range: filters.range,
                setRange: (r) => patch({ range: r }),
                onPick: onWatch,
                markers,
                bands,
                boundaries,
              }}
            />
          )}
          {(tab === 'buffs' || tab === 'debuffs') && (
            <AuraTables
              ctx={ctx}
              debuffs={tab === 'debuffs'}
              who={filters.side === 'friendly' ? auraWho : null}
              enemy={filters.side === 'enemy' ? filters.enemy : null}
              bands={bands}
              onPick={onWatch ? (t) => onWatch(t, null) : undefined}
            />
          )}
          {tab === 'interrupts' && <CountView ctx={ctx} kind="interrupt" />}
          {tab === 'dispels' && <CountView ctx={ctx} kind="dispel" />}
          {tab === 'resources' && (
            <ResourceView ctx={ctx} who={who} setWho={setWho} />
          )}
          {tab === 'casts' && (
            <CastView ctx={ctx} who={who} setWho={setWho} onWatch={onWatch} />
          )}
          {multi && meter && (
            <PullByPull stores={stores} filters={filters} meter={meter} />
          )}
        </>
      )}

      {mode === 'events' && (
        <EventsView ctx={ctx} tab={tab} who={who} onWatch={onWatch} />
      )}

      {mode === 'queries' && <QueriesView ctx={ctx} onWatch={onWatch} />}

      {mode === 'timelines' && (
        <TimelineMode
          stores={stores}
          index={Math.min(timelinePull, stores.length - 1)}
          setIndex={setTimelinePull}
          onWatch={(pi, name, seconds) => {
            if (watch?.can && !watch.open(stores[pi], name, seconds))
              setNotice(`No recording of ${stores[pi].label} here.`);
          }}
        />
      )}
    </div>
  );
};

const TimelineMode = ({
  stores,
  index,
  setIndex,
  onWatch,
}: {
  stores: PullStore[];
  index: number;
  setIndex: (i: number) => void;
  onWatch: (pi: number, name: string | null, seconds: number) => void;
}) => {
  const [view, setView] = React.useState<'casts' | 'buffs'>('casts');
  const data = React.useMemo(() => timelineOf(stores[index]), [stores, index]);
  const watchAt = (name: string | null, t: number) => onWatch(index, name, t);
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        {stores.length > 1 && (
          <select
            className="bg-card text-foreground-lighter rounded px-2 h-8 text-xs border border-background"
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            aria-label="Pull"
          >
            {stores.map((p, i) => (
              <option key={p.id} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex rounded-md border border-card overflow-hidden">
          {(
            [
              ['casts', 'Cooldowns'],
              ['buffs', 'Buffs & debuffs'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`px-3 h-8 text-xs ${
                view === k
                  ? 'bg-brand text-background font-semibold'
                  : 'text-foreground-lighter hover:bg-card/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'casts' ? (
        <CastTimeline data={data} range={null} onWatch={watchAt} />
      ) : (
        <AuraView data={data} range={null} onWatch={watchAt} />
      )}
    </div>
  );
};

export default LogsExplorer;
