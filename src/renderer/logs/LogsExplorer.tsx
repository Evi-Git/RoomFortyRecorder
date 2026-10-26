import React from 'react';
import { Clock, Eye, EyeOff, List, Search, Table2, X } from 'lucide-react';
import Switch from '../components/Switch/Switch';
import { CastTimeline, AuraView, WatchHint } from '../LogsTimeline';
import { compileExpression, Predicate } from './expression';
import {
  abilityNames,
  DEFAULT_FILTERS,
  enemyOptions,
  Filters,
  scan,
  withPrevented,
  lustBands,
  makeCtx,
  meterRows,
  preventedRows,
  raiders,
  viewSeconds,
} from './query';
import { PullMeta, PullStore } from './store';
import { usePullStores } from './load';
import MeterView, { Group, MeterKind, RATE } from './MeterView';
import AuraTables from './AuraTables';
import { CastView, CountView, ResourceView, SummaryView } from './OtherTables';
import EventsView, { EventTab } from './EventsView';
import QueriesView from './QueriesView';
import DeathsView from './DeathsView';
import ExpressionInput, { vocabularyOf } from './ExpressionInput';
import { timelineOf } from './timeline';
import { ZoomContext } from './zoom';
import { CATEGORICAL, classColor, compact, mmss } from './format';
import { AbilityPicker, EnemyPicker, ExcludeTargetsPicker } from './Pickers';
import { useAuraDrs, usePassiveTalents } from './talents';
import { loadSpellTexts } from './SpellIcon';
import { DAMAGE_REDUCTION } from '../../parsing/PullMeters';
import WclCompare from './WclCompare';
import { usePermissions } from '../usePermissions';

// Cooldowns are counted from their auras, not as talents.
const isCooldown = (spellId: number) => Boolean(DAMAGE_REDUCTION[spellId]);

/** A filter expression: narrowing the data, or marking matches on charts. */
type Layer = {
  id: number;
  text: string;
  fn: Predicate;
  mode: 'filter' | 'mark';
  on: boolean;
  color: string;
};

/**
 * [RoomFortyRecorder] The Logs page's pull explorer, after Warcraft Logs:
 * Tables / Timelines / Events / Queries over one pull or several added up,
 * with tabs (Summary, Damage Done, Damage Taken, Healing (with mitigations),
 * Buffs, Debuffs, Deaths, Interrupts, Dispels, Resources, Casts) and filters
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
  { key: 'buffs', label: 'Buffs' },
  { key: 'debuffs', label: 'Debuffs' },
  { key: 'deaths', label: 'Deaths' },
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
  const [group, setGroup] = React.useState<Group>('source');
  const [who, setWho] = React.useState<string | null>(null);
  const [auraWho, setAuraWho] = React.useState<string | null>(null);
  const [exprText, setExprText] = React.useState('');
  // With a slice picked: show only it (zoomed in), or it within the fight.
  const [zoomed, setZoomedState] = React.useState(
    () =>
      remembered<'in' | 'out'>('rf-logs-zoom', 'in', ['in', 'out']) === 'in',
  );
  const zoom = React.useMemo(
    () => ({
      zoomed,
      setZoomed: (z: boolean) => {
        setZoomedState(z);
        remember('rf-logs-zoom', z ? 'in' : 'out');
      },
    }),
    [zoomed],
  );
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const [layerMode, setLayerMode] = React.useState<'filter' | 'mark'>('filter');
  // Healing: count damage prevented as healing (and passive reductions).
  const [prevented, setPrevented] = React.useState(false);
  const [passive, setPassive] = React.useState(true);
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
    setFilters((f) => ({ ...f, range: null, enemy: null, abilities: [] }));
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
  // Filter layers that are on, all of them must match.
  const layerExpr = React.useMemo<Predicate | null>(() => {
    const fns = layers
      .filter((l) => l.on && l.mode === 'filter')
      .map((l) => l.fn);
    if (!fns.length) return null;
    return (p, i) => fns.every((fn) => fn(p, i));
  }, [layers]);
  // Healing exclusions only count where they can be seen and changed.
  const healTab = tab === 'healing' || tab === 'prevented';
  const ctx = React.useMemo(
    () =>
      makeCtx(stores, {
        ...filters,
        healExclude: healTab ? filters.healExclude : [],
        expr: layerExpr,
      }),
    [stores, filters, layerExpr, healTab],
  );

  // Raiders' passive reduction talents, when passives are counted.
  const talentDrs = usePassiveTalents(stores, prevented && passive, isCooldown);
  // Buffs that cut damage taken (Elemental Resistance...), from their text.
  const auraDrs = useAuraDrs(stores, prevented, isCooldown, loadSpellTexts);

  const meter: MeterKind | null = METER_TABS.has(tab)
    ? (tab as MeterKind)
    : null;
  const rows = React.useMemo(() => {
    if (!stores.length || !meter || mode !== 'tables') return [];
    if (meter === 'prevented')
      return preventedRows(ctx, {
        passive,
        talents: talentDrs,
        auras: auraDrs,
      });
    if (meter === 'healing' && prevented)
      return withPrevented(
        meterRows(ctx, 'healing'),
        preventedRows(ctx, { passive, talents: talentDrs, auras: auraDrs }),
      );
    return meterRows(ctx, meter);
  }, [ctx, meter, stores.length, mode, prevented, passive, talentDrs, auraDrs]);
  const enemies = React.useMemo(() => enemyOptions(stores), [stores]);
  // Abilities to pick from: this tab's, whatever is picked now.
  const abilityRows = React.useMemo(() => {
    if (!filters.abilities.length) return rows;
    if (!stores.length || !meter || meter === 'prevented') return rows;
    return meterRows(
      { ...ctx, filters: { ...ctx.filters, abilities: [] } },
      meter,
    );
  }, [rows, ctx, meter, stores.length, filters.abilities.length]);
  const roster = React.useMemo(
    () => (stores.length ? raiders(makeCtx(stores, DEFAULT_FILTERS)) : []),
    [stores],
  );
  const permissions = usePermissions();
  const abilities = React.useMemo(
    () => abilityNames(abilityRows),
    [abilityRows],
  );
  const vocab = React.useMemo(() => vocabularyOf(stores), [stores]);
  const bands = React.useMemo(
    () => (stores.length ? lustBands(makeCtx(stores, DEFAULT_FILTERS)) : []),
    [stores],
  );
  const markers = React.useMemo(() => {
    const out: { t: number; label: string; color?: string }[] = stores.flatMap(
      (p, pi) =>
        p.deaths.map((d) => ({
          t: ctx.offsets[pi] + d.t,
          label: `${p.units[d.unit].name} died${d.spell >= 0 ? ` (${p.spells[d.spell]?.name})` : ''}`,
        })),
    );
    // Marker layers: a line at each match (at most one per half second).
    const all = makeCtx(stores, DEFAULT_FILTERS);
    layers
      .filter((l) => l.on && l.mode === 'mark')
      .forEach((l) => {
        let last = -1;
        let count = 0;
        scan(all, (p, i, at) => {
          if (count >= 1500 || at - last < 0.5 || !l.fn(p, i)) return;
          last = at;
          count += 1;
          out.push({ t: at, label: l.text, color: l.color });
        });
      });
    return out;
  }, [stores, ctx.offsets, layers]);
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
  // Enter adds the expression as a layer (a filter or chart markers).
  const addLayer = (text: string) => {
    if (!text.trim()) {
      setExprError('');
      return;
    }
    try {
      const fn = compileExpression(text);
      if (!fn) return;
      setExprError('');
      setLayers((list) => [
        ...list,
        {
          id: Date.now(),
          text: text.trim(),
          fn,
          mode: layerMode,
          on: true,
          color: CATEGORICAL[(list.length + 2) % CATEGORICAL.length],
        },
      ]);
      setExprText('');
    } catch (error) {
      setExprError((error as Error).message);
    }
  };
  const editLayer = (id: number, change: Partial<Layer>) =>
    setLayers((list) =>
      list.map((l) => (l.id === id ? { ...l, ...change } : l)),
    );
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
    <ZoomContext.Provider value={zoom}>
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
            <EnemyPicker
              value={filters.enemy}
              options={enemies}
              onChange={(enemy) => patch({ enemy })}
            />
            {meter && (
              <AbilityPicker
                value={filters.abilities}
                options={abilities}
                onChange={(ids) => patch({ abilities: ids })}
              />
            )}
            {(meter === 'healing' || meter === 'prevented') &&
              filters.side === 'friendly' && (
                <ExcludeTargetsPicker
                  value={filters.healExclude}
                  options={roster.map((r) => ({
                    guid: r.guid,
                    name: r.name,
                    color: classColor(r.specId),
                  }))}
                  onChange={(healExclude) => patch({ healExclude })}
                />
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
                onChange={(e) => setGroup(e.target.value as Group)}
                aria-label="Group by"
              >
                <option value="source">
                  {meter === 'taken' ? 'By raider' : 'Done by source'}
                </option>
                <option value="enemy">
                  {meter === 'taken'
                    ? 'By enemy'
                    : meter === 'healing'
                      ? 'Done to target'
                      : 'Done to enemy'}
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
            {meter === 'healing' && (
              <label
                className="flex items-center gap-x-1.5 text-xs text-foreground"
                title="Count damage kept off raiders by damage-reduction cooldowns as healing, for whoever cast them"
              >
                <Switch
                  checked={prevented}
                  onCheckedChange={(v: boolean) => {
                    setPrevented(v);
                    if (v) setPassive(true);
                  }}
                />
                Mitigations
              </label>
            )}
            {meter === 'healing' && prevented && (
              <label
                className="flex items-center gap-x-1.5 text-xs text-foreground"
                title="Also count what talents (Elemental Warding and the like) and versatility took off damage taken, for the raider who has them"
              >
                <Switch
                  checked={passive}
                  onCheckedChange={(v: boolean) => setPassive(v)}
                />
                + passives
              </label>
            )}
            {meter === 'healing' &&
              prevented &&
              (!auraDrs || (passive && !talentDrs)) && (
                <span className="text-xs text-foreground animate-pulse">
                  Looking up buffs and talents…
                </span>
              )}
            {(meter === 'damage' || meter === 'healing' || tab === 'casts') && (
              <label className="flex items-center gap-x-1.5 text-xs text-foreground">
                <Switch
                  checked={filters.pets}
                  onCheckedChange={(v: boolean) => patch({ pets: v })}
                />
                Pets
              </label>
            )}
            <select
              className={field}
              value={layerMode}
              onChange={(e) =>
                setLayerMode(e.target.value as 'filter' | 'mark')
              }
              aria-label="Add expressions as"
              title="Enter adds the expression as a filter on the data, or as markers on the charts"
            >
              <option value="filter">Add as filter</option>
              <option value="mark">Add as marker</option>
            </select>
            <ExpressionInput
              value={exprText}
              onChange={setExprText}
              onApply={addLayer}
              applyOnBlur={false}
              vocab={vocab}
              label="Filter expression"
              placeholder='Expression, Enter to add, e.g. ability.name ~ "breath" (? for help)'
              className={`${field} flex-1 font-mono`}
            />
          </div>
        )}
        {showFilters && layers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {layers.map((l) => (
              <span
                key={l.id}
                className={`inline-flex items-center gap-x-1.5 rounded-md border px-1.5 py-0.5 ${
                  l.on ? 'border-card bg-card/60' : 'border-card/50 opacity-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    editLayer(l.id, {
                      mode: l.mode === 'filter' ? 'mark' : 'filter',
                    })
                  }
                  title="Switch between filtering the data and marking the charts"
                  className="rounded px-1 text-[10px] font-semibold"
                  style={{
                    background:
                      l.mode === 'mark' ? l.color : 'hsl(var(--brand) / 0.25)',
                    color: l.mode === 'mark' ? '#111' : 'hsl(var(--brand))',
                  }}
                >
                  {l.mode === 'filter' ? 'Filter' : 'Marker'}
                </button>
                <span
                  className="font-mono text-foreground-lighter max-w-[360px] truncate"
                  title={l.text}
                >
                  {l.text}
                </span>
                <button
                  type="button"
                  aria-label={l.on ? 'Turn off' : 'Turn on'}
                  title={l.on ? 'Turn off' : 'Turn on'}
                  onClick={() => editLayer(l.id, { on: !l.on })}
                  className="text-foreground hover:text-foreground-lighter"
                >
                  {l.on ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  type="button"
                  aria-label="Remove"
                  title="Remove"
                  onClick={() =>
                    setLayers((list) => list.filter((x) => x.id !== l.id))
                  }
                  className="text-foreground hover:text-red-400"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
            {layers.length > 1 && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setLayers([])}
              >
                Clear all
              </button>
            )}
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
          {filters.range && mode === 'tables' && (
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => zoom.setZoomed(!zoomed)}
            >
              {zoomed ? 'Zoom out (see the slice in the fight)' : 'Zoom in'}
            </button>
          )}
          {!filters.range && mode === 'tables' && meter && (
            <span>Drag across the chart to zoom in on a slice.</span>
          )}
          {watch && <WatchHint can={watch.can} />}
          {notice && <span className="text-yellow-400">{notice}</span>}
        </div>

        {mode === 'tables' && permissions?.owner && !permissions.viewAs && (
          <WclCompare
            ctx={ctx}
            metas={metas}
            tab={tab}
            rows={rows}
            who={tab === 'buffs' || tab === 'debuffs' ? null : who}
            auraWho={filters.side === 'friendly' ? auraWho : null}
            whoName={
              (tab === 'buffs' || tab === 'debuffs'
                ? roster.find((r) => r.guid === auraWho)?.name
                : roster.find((r) => r.guid === who)?.name) ?? null
            }
          />
        )}

        {mode === 'tables' && (
          <>
            {tab === 'summary' && <SummaryView ctx={ctx} onWatch={onWatch} />}
            {meter && (
              <MeterView
                ctx={ctx}
                meter={meter}
                rows={rows}
                group={meter === 'prevented' ? 'source' : group}
                onEnemy={(npcId, name) => {
                  patch({ enemy: { kind: 'npc', npcId, name } });
                  setGroup('source');
                }}
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
                bands={bands}
                boundaries={boundaries}
                range={filters.range}
                setRange={(r) => patch({ range: r })}
                onPick={onWatch ? (t) => onWatch(t, null) : undefined}
                setWho={setAuraWho}
              />
            )}
            {tab === 'deaths' && <DeathsView ctx={ctx} onWatch={onWatch} />}
            {tab === 'interrupts' && <CountView ctx={ctx} kind="interrupt" />}
            {tab === 'dispels' && <CountView ctx={ctx} kind="dispel" />}
            {tab === 'resources' && (
              <ResourceView
                ctx={ctx}
                who={who}
                setWho={setWho}
                extras={{
                  range: filters.range,
                  setRange: (r) => patch({ range: r }),
                  onPick: onWatch,
                  bands,
                  boundaries,
                }}
              />
            )}
            {tab === 'casts' && (
              <CastView
                ctx={ctx}
                who={who}
                setWho={setWho}
                onWatch={onWatch}
                extras={{
                  setRange: (r) => patch({ range: r }),
                  bands,
                  boundaries,
                }}
              />
            )}
            {multi && meter && (
              <PullByPull stores={stores} filters={filters} meter={meter} />
            )}
          </>
        )}

        {mode === 'events' && (
          <EventsView ctx={ctx} tab={tab} who={who} onWatch={onWatch} />
        )}

        {mode === 'queries' && (
          <QueriesView ctx={ctx} vocab={vocab} onWatch={onWatch} />
        )}

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
    </ZoomContext.Provider>
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
