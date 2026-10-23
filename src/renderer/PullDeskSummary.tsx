import React from 'react';
import { ChevronDown, ChevronUp, Crown, Table2, LineChart } from 'lucide-react';
import { BRAND } from 'renderer/brand';
import { Ability, AbilityScope } from './AbilityCard';
import ConsumablesPanel, { PrepSummary } from './Consumables';
import { usePermissions } from './usePermissions';
import MiniSwitch from './components/Switch/MiniSwitch';
import { Button } from './components/Button/Button';
import {
  guildKey,
  loadWatcher,
  WatcherSettings,
  WatcherState,
  WatcherTable,
} from './PullDeskWatcher';

/**
 * [RoomFortyRecorder] Pull desk summary views, built by the guild server from
 * the reports it already keeps (see guild-cloud-server/pulldesk-summary.mjs).
 *
 * - Night summary: pick a raid night; per boss the totals, why pulls ended,
 *   a raider table and every pull (click one to open its report).
 * - Progression: pick a boss; boss health at the end of every pull with the
 *   best-so-far line, a row per night, wipe causes over time and each
 *   raider's early deaths night by night.
 */

const ipc = window.electron.ipcRenderer;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

type Cause = { name: string; count: number; spellId?: number | null };

type Raider = {
  name: string;
  role: string;
  pulls: number;
  deaths: number;
  earlyDeaths: number;
  firstDeaths: number;
  planChecked: number;
  planMissed: number;
  planOff: number;
  avoidableHits: number;
  avoidableDamage: number;
  defensives: number;
  potions: number;
  healthstones: number;
  earlyDeathCauses: Record<string, number>;
};

type AvoidableRow = {
  name: string;
  spellIds: number[];
  hits: number;
  damage: number;
  deaths: number;
  pulls: number;
  raidersHit: number;
  raiders: {
    name: string;
    hits: number;
    damage: number;
    deaths: number;
    // Indexes of the pulls they were hit in (newer servers).
    pulls?: number[];
  }[];
};

type PullRow = {
  id: string;
  night: string;
  pullNumber: number;
  totalPullNumber?: number;
  result: 'kill' | 'wipe' | string;
  bossPercent: number | null;
  duration: number;
  deaths: number | null;
  cause: string | null;
  source?: 'app' | 'wcl';
};

type BossNight = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  bestPercent: number | null;
  medianPercent: number | null;
  combatSeconds: number;
  longestPull: number | null;
  causes: Cause[];
  raiders: Raider[];
  pullsList: PullRow[];
  spellIds?: Record<string, number>;
  avoidable?: AvoidableRow[];
  consumables?: PrepSummary | null;
};

type NightIndex = {
  night: string;
  bosses: {
    encounterId: number;
    encounterName: string;
    difficultyId: number;
    pulls: number;
    kills: number;
    firstKillAt?: number;
  }[];
};

type Progression = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  nights: {
    night: string;
    pulls: number;
    kills: number;
    bestPercent: number | null;
    medianPercent: number | null;
    combatSeconds: number;
    topCause: Cause | null;
    causes: Cause[];
  }[];
  series: {
    n: number;
    night: string;
    percent: number | null;
    kill: boolean;
    id: string;
    source?: 'app' | 'wcl';
  }[];
  firstKill: { pull: number; night: string } | null;
  causes: Cause[];
  spellIds?: Record<string, number>;
  avoidable?: AvoidableRow[];
  consumables?: PrepSummary | null;
  raiders: Raider[];
  trend: {
    name: string;
    role: string;
    nights: Record<
      string,
      { pulls: number; earlyDeaths: number; rate: number }
    >;
  }[];
};

const DIFFICULTY: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  233: 'Mythic', // flex Mythic (Kith'ix)
  17: 'LFR',
};

const difficultyName = (id: number) => DIFFICULTY[id] ?? `Difficulty ${id}`;
// Mythic and flex Mythic (Kith'ix).
const isMythic = (id: number) => id === 16 || id === 233;

const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const hours = (seconds: number) => {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};

const pct = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '–'
    : `${Math.round(value * 10) / 10}%`;

const nightLabel = (night: string) =>
  new Date(`${night}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

const shortNight = (night: string) =>
  new Date(`${night}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

const ROLE_STYLE: Record<string, string> = {
  tank: 'text-sky-300',
  healer: 'text-green-300',
  dps: '',
};

const bossKey = (encounterId: number, difficultyId: number) =>
  `${encounterId}:${difficultyId}`;

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex flex-col min-w-[96px]">
    <span className="text-xs text-foreground">{label}</span>
    <span className="text-lg font-semibold text-foreground-lighter tabular-nums">
      {value}
    </span>
  </div>
);

const Panel = ({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="rounded-md border border-card bg-background/40 p-3">
    <div className="flex items-center gap-x-2 mb-2">
      <h3 className="font-display text-base text-foreground-lighter">
        {title}
      </h3>
      {aside && (
        <div className="ml-auto flex items-center gap-x-1">{aside}</div>
      )}
    </div>
    {children}
  </section>
);

/** Why pulls ended: one bar per cause, count at the tip. */
const CauseBars = ({
  causes,
  limit = 8,
}: {
  causes: Cause[];
  limit?: number;
}) => {
  const shown = causes.slice(0, limit);
  const rest = causes.slice(limit).reduce((sum, c) => sum + c.count, 0);
  const rows = rest ? [...shown, { name: 'Other', count: rest }] : shown;
  const max = Math.max(1, ...rows.map((c) => c.count));

  if (!rows.length) {
    return <p className="text-sm text-foreground">No wipes.</p>;
  }

  return (
    <ul className="flex flex-col gap-y-1.5">
      {rows.map((cause) => (
        <li
          key={cause.name}
          className="grid grid-cols-[minmax(120px,40%)_1fr] items-center gap-x-3 text-sm"
          title={`${cause.name}: ${cause.count} ${cause.count === 1 ? 'pull' : 'pulls'}`}
        >
          <span className="truncate text-foreground-lighter">
            <Ability name={cause.name} spellId={cause.spellId} />
          </span>
          <span className="flex items-center gap-x-2">
            <span
              className="h-[14px] rounded-r-[4px]"
              style={{
                width: `${(cause.count / max) * 85}%`,
                minWidth: 4,
                background: BRAND,
              }}
            />
            <span className="tabular-nums text-foreground">{cause.count}</span>
          </span>
        </li>
      ))}
    </ul>
  );
};

type SortKey =
  | 'name'
  | 'pulls'
  | 'earlyDeaths'
  | 'rate'
  | 'firstDeaths'
  | 'planMissed'
  | 'planOff'
  | 'avoidableHits'
  | 'defensives'
  | 'potions'
  | 'healthstones';

const RAIDER_COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'name', label: 'Raider', title: 'Raider' },
  { key: 'pulls', label: 'Pulls', title: 'Pulls they were in' },
  {
    key: 'earlyDeaths',
    label: 'Early deaths',
    title: 'Deaths among the first 2 of a pull',
  },
  { key: 'rate', label: 'Per pull', title: 'Early deaths per pull' },
  { key: 'firstDeaths', label: 'Died first', title: 'First death of the pull' },
  {
    key: 'planMissed',
    label: 'Plan missed',
    title: 'Cooldown plan casts never made (while alive)',
  },
  {
    key: 'planOff',
    label: 'Plan off',
    title: 'Cooldown plan casts made early or late',
  },
  {
    key: 'avoidableHits',
    label: 'Avoidable',
    title: 'Hits from avoidable spells set in Boss settings',
  },
  {
    key: 'defensives',
    label: 'Defensives',
    title: 'Personal and external defensives used',
  },
  { key: 'potions', label: 'Health pots', title: 'Health potions used' },
  { key: 'healthstones', label: 'Healthstones', title: 'Healthstones used' },
];

const sortValue = (r: Raider, key: SortKey) => {
  if (key === 'rate') return r.pulls ? r.earlyDeaths / r.pulls : 0;
  return r[key];
};

/** One row per raider, sortable by any column. */
const RaiderTable = ({
  raiders,
  leftOut,
}: {
  raiders: Raider[];
  leftOut?: Set<string>;
}) => {
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({
    key: 'earlyDeaths',
    desc: true,
  });
  const [role, setRole] = React.useState('all');

  const rows = raiders
    .filter((r) => !leftOut?.has(r.name))
    .filter((r) => role === 'all' || r.role === role)
    .sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const order =
        typeof av === 'string'
          ? av.localeCompare(String(bv))
          : (av as number) - (bv as number);
      return (sort.desc ? -order : order) || a.name.localeCompare(b.name);
    });

  const header = (col: (typeof RAIDER_COLUMNS)[number]) => {
    const active = sort.key === col.key;
    return (
      <th
        key={col.key}
        title={col.title}
        className={`px-2 py-1 font-normal whitespace-nowrap ${
          col.key === 'name' ? 'text-left' : 'text-right'
        }`}
      >
        <button
          type="button"
          className={`inline-flex items-center gap-x-0.5 hover:text-foreground-lighter ${
            active ? 'text-foreground-lighter' : ''
          }`}
          onClick={() =>
            setSort({
              key: col.key,
              desc: active ? !sort.desc : col.key !== 'name',
            })
          }
        >
          {col.label}
          {active &&
            (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
        </button>
      </th>
    );
  };

  const cell = (value: number, warn = false) => (
    <td
      className={`px-2 py-1 text-right tabular-nums ${
        value === 0
          ? 'text-foreground/50'
          : warn
            ? 'text-foreground-lighter'
            : ''
      }`}
    >
      {value}
    </td>
  );

  const causesTitle = (r: Raider) =>
    Object.entries(r.earlyDeathCauses)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ×${count}`)
      .join('\n');

  return (
    <div>
      <div className="flex gap-x-1 mb-2">
        {['all', 'tank', 'healer', 'dps'].map((r) => (
          <Button
            key={r}
            size="xs"
            variant={role === r ? 'default' : 'ghost'}
            onClick={() => setRole(r)}
          >
            {r === 'all'
              ? 'Everyone'
              : r === 'dps'
                ? 'DPS'
                : `${r[0].toUpperCase()}${r.slice(1)}s`}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card">
            <tr>{RAIDER_COLUMNS.map(header)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="border-b border-card/40 hover:bg-card/30"
              >
                <td
                  className={`px-2 py-1 whitespace-nowrap ${ROLE_STYLE[r.role] ?? ''}`}
                >
                  {r.name}
                </td>
                {cell(r.pulls)}
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    r.earlyDeaths
                      ? 'text-foreground-lighter'
                      : 'text-foreground/50'
                  }`}
                  title={causesTitle(r) || undefined}
                >
                  {r.earlyDeaths}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.pulls ? (r.earlyDeaths / r.pulls).toFixed(2) : '–'}
                </td>
                {cell(r.firstDeaths, true)}
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    r.planMissed ? 'text-red-400' : 'text-foreground/50'
                  }`}
                  title={
                    r.planChecked
                      ? `${r.planChecked} plan casts checked`
                      : 'No plan casts'
                  }
                >
                  {r.planChecked ? r.planMissed : '–'}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    r.planOff ? 'text-yellow-400' : 'text-foreground/50'
                  }`}
                >
                  {r.planChecked ? r.planOff : '–'}
                </td>
                {cell(r.avoidableHits, true)}
                {cell(r.defensives)}
                {cell(r.potions)}
                {cell(r.healthstones)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground mt-2">
        Early deaths are the first 2 deaths of a pull; later ones are usually
        the wipe. Hover a raider&apos;s early deaths to see what killed them.
      </p>
    </div>
  );
};

const compact = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)}K`
        : String(n);

type AvoidableRaider = AvoidableRow['raiders'][number];

/** One ability's totals from the raiders still included. */
const avoidableTotals = (row: AvoidableRow, out: Set<string> | undefined) => {
  if (!out || out.size === 0) return row;
  const kept = row.raiders.filter((r) => !out.has(r.name));
  const pulls = new Set(kept.flatMap((r) => r.pulls ?? []));
  return {
    ...row,
    hits: kept.reduce((n, r) => n + r.hits, 0),
    damage: kept.reduce((n, r) => n + r.damage, 0),
    deaths: kept.reduce((n, r) => n + r.deaths, 0),
    raidersHit: kept.filter((r) => r.hits > 0).length,
    pulls: pulls.size,
  };
};

const Bar = ({
  value,
  max,
  height,
  muted,
}: {
  value: number;
  max: number;
  height: number;
  muted?: boolean;
}) => (
  <span
    className="rounded-r-[4px] shrink-0"
    style={{
      width: `${(value / Math.max(1, max)) * 70}%`,
      minWidth: value ? 4 : 0,
      height,
      background: BRAND,
      opacity: muted ? 0.55 : 1,
    }}
  />
);

/**
 * Avoidable damage, compiled: one row per avoidable ability (every spell ID
 * it hits as); open a row for its raiders. Each raider can be left out of
 * that ability's totals (e.g. the tank soaking it on purpose).
 */
export const AvoidablePanel = ({
  rows,
  leftOut,
}: {
  rows: AvoidableRow[] | undefined;
  // Raiders left out everywhere (Progression filters): not listed at all.
  leftOut?: Set<string>;
}) => {
  const [open, setOpen] = React.useState<string | null>(null);
  // Ability name -> raiders left out of its totals.
  const [excluded, setExcluded] = React.useState<Record<string, string[]>>({});
  if (!rows) return null;

  const outOf = (name: string) => {
    const own = excluded[name] ?? [];
    if (!own.length && !leftOut?.size) return undefined;
    return new Set([...own, ...(leftOut ?? [])]);
  };
  const shown = rows
    .map((row) => ({ row, totals: avoidableTotals(row, outOf(row.name)) }))
    .sort((a, b) => b.totals.damage - a.totals.damage);
  const max = Math.max(1, ...shown.map((s) => s.totals.damage));
  const leftOutCount = Object.values(excluded).reduce(
    (n, l) => n + l.length,
    0,
  );

  const toggleRaider = (ability: string, raider: string) =>
    setExcluded((prev) => {
      const list = prev[ability] ?? [];
      return {
        ...prev,
        [ability]: list.includes(raider)
          ? list.filter((r) => r !== raider)
          : [...list, raider],
      };
    });

  const numberCell = (value: number, muted: boolean, red = false) => (
    <td
      className={`px-2 py-1 text-right tabular-nums ${
        red && value ? 'text-red-400' : value ? '' : 'text-foreground/50'
      } ${muted ? 'opacity-40' : ''}`}
    >
      {value}
    </td>
  );

  const raiderRows = (row: AvoidableRow) => {
    const out = outOf(row.name);
    const ordered = row.raiders
      .filter((r) => !leftOut?.has(r.name))
      .sort(
        (a, b) =>
          Number(out?.has(a.name) ?? false) -
            Number(out?.has(b.name) ?? false) ||
          b.damage - a.damage ||
          b.hits - a.hits,
      );
    const top = Math.max(1, ...row.raiders.map((r) => r.damage));
    return ordered.map((r: AvoidableRaider) => {
      const off = Boolean(out?.has(r.name));
      return (
        <tr
          key={`${row.name}:${r.name}`}
          className="border-b border-card/20 text-xs"
        >
          <td className="pl-6 pr-2 py-0.5">
            <label
              className={`inline-flex items-center gap-x-2 cursor-pointer ${
                off ? 'opacity-40' : ''
              }`}
              title={
                off
                  ? 'Left out of this ability’s totals. Click to include.'
                  : 'Counted. Click to leave out of this ability’s totals.'
              }
            >
              <MiniSwitch
                checked={!off}
                onChange={() => toggleRaider(row.name, r.name)}
                label={
                  off
                    ? `Include ${r.name} in ${row.name}`
                    : `Leave ${r.name} out of ${row.name}`
                }
              />
              <span className="text-foreground-lighter">{r.name}</span>
            </label>
          </td>
          <td className={`px-2 py-0.5 ${off ? 'opacity-40' : ''}`}>
            <span className="flex items-center gap-x-2">
              <Bar value={r.damage} max={top} height={8} muted />
              <span
                className="tabular-nums text-foreground"
                title={`${r.damage.toLocaleString()} damage`}
              >
                {compact(r.damage)}
              </span>
            </span>
          </td>
          {numberCell(r.hits, off)}
          <td />
          <td
            className={`px-2 py-0.5 text-right tabular-nums text-foreground ${
              off ? 'opacity-40' : ''
            }`}
          >
            {r.pulls?.length ?? ''}
          </td>
          {numberCell(r.deaths, off, true)}
        </tr>
      );
    });
  };

  return (
    <Panel
      title="Avoidable damage"
      aside={
        leftOutCount > 0 ? (
          <>
            <span className="text-xs text-foreground">
              {leftOutCount} left out
            </span>
            <Button size="xs" variant="ghost" onClick={() => setExcluded({})}>
              Include everyone
            </Button>
          </>
        ) : undefined
      }
    >
      {!rows.length ? (
        <p className="text-sm text-foreground">
          No avoidable hits. Mark abilities as avoidable from their hover card
          or the Journal.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-foreground border-b border-card">
              <tr>
                <th className="px-2 py-1 font-normal text-left">Ability</th>
                <th className="px-2 py-1 font-normal text-left w-[34%]">
                  Damage taken
                </th>
                <th className="px-2 py-1 font-normal text-right">Hits</th>
                <th
                  className="px-2 py-1 font-normal text-right"
                  title="Raiders it hit at least once"
                >
                  Raiders hit
                </th>
                <th
                  className="px-2 py-1 font-normal text-right"
                  title="Pulls it hit someone in"
                >
                  Pulls
                </th>
                <th
                  className="px-2 py-1 font-normal text-right"
                  title="Raiders it killed"
                >
                  Deaths
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ row, totals }) => {
                const expanded = open === row.name;
                const out = excluded[row.name]?.length ?? 0;
                return (
                  <React.Fragment key={row.name}>
                    <tr
                      className="border-b border-card/40 hover:bg-card/30 cursor-pointer"
                      onClick={() => setOpen(expanded ? null : row.name)}
                    >
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span className="inline-flex items-center gap-x-1">
                          {expanded ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                          <Ability
                            name={row.name}
                            spellId={row.spellIds[0]}
                            className="text-foreground-lighter"
                          />
                          {out > 0 && (
                            <span className="ml-1 text-[11px] text-foreground">
                              ({out} left out)
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className="flex items-center gap-x-2">
                          <Bar value={totals.damage} max={max} height={12} />
                          <span
                            className="tabular-nums text-foreground"
                            title={`${totals.damage.toLocaleString()} damage`}
                          >
                            {compact(totals.damage)}
                          </span>
                        </span>
                      </td>
                      {numberCell(totals.hits, false)}
                      {numberCell(totals.raidersHit, false)}
                      {numberCell(totals.pulls, false)}
                      {numberCell(totals.deaths, false, true)}
                    </tr>
                    {expanded && raiderRows(row)}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-foreground mt-2">
            Counts every spell ID an avoidable ability hits as (by name). Open a
            row to see who got hit; untick someone to leave them out of that
            ability&apos;s totals (they move to the bottom).
          </p>
        </div>
      )}
    </Panel>
  );
};

/* ------------------------------------------------------------------ */
/* Night summary                                                       */
/* ------------------------------------------------------------------ */

const BossNightCard = ({
  boss,
  onOpenPull,
  canEdit,
}: {
  boss: BossNight;
  onOpenPull: (id: string) => void;
  canEdit: boolean;
}) => {
  const [showPulls, setShowPulls] = React.useState(false);

  return (
    <AbilityScope
      encounterId={boss.encounterId}
      difficultyId={boss.difficultyId}
      spellIds={boss.spellIds}
      canEdit={canEdit}
    >
      <div className="flex flex-col gap-y-3">
        <div className="flex items-baseline gap-x-2">
          <h2 className="font-display text-xl text-foreground-lighter">
            {boss.encounterName}
          </h2>
          <span className="text-sm text-foreground">
            {difficultyName(boss.difficultyId)}
          </span>
          {boss.kills > 0 && (
            <span className="flex items-center gap-x-1 text-sm text-green-400">
              <Crown size={14} /> Killed
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Stat label="Pulls" value={boss.pulls} />
          <Stat label="Kills" value={boss.kills} />
          <Stat
            label="Best"
            value={boss.kills ? 'Kill' : pct(boss.bestPercent)}
          />
          <Stat label="Median wipe" value={pct(boss.medianPercent)} />
          <Stat label="Time in combat" value={hours(boss.combatSeconds)} />
          <Stat
            label="Longest pull"
            value={boss.longestPull ? mmss(boss.longestPull) : '–'}
          />
        </div>

        <div className="grid items-start grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <Panel title="Why pulls ended">
            <CauseBars causes={boss.causes} />
            <p className="text-xs text-foreground mt-2">
              A raid-wide mechanic if it killed many at once, else the first
              death&apos;s killing blow.
            </p>
          </Panel>
          <Panel title="Raiders">
            <RaiderTable raiders={boss.raiders} />
          </Panel>
        </div>

        <AvoidablePanel
          key={`${boss.encounterId}:${boss.difficultyId}`}
          rows={boss.avoidable}
        />

        {boss.consumables !== undefined && (
          <Panel title="Consumables & buffs">
            <ConsumablesPanel
              summary={boss.consumables}
              scope={`This night · ${boss.pulls} ${boss.pulls === 1 ? 'pull' : 'pulls'}`}
            />
          </Panel>
        )}

        <Panel
          title={`Pulls (${boss.pulls})`}
          aside={
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setShowPulls((v) => !v)}
            >
              {showPulls ? 'Hide' : 'Show'}
            </Button>
          }
        >
          {showPulls ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-foreground border-b border-card">
                <tr>
                  <th className="px-2 py-1 text-left font-normal">Pull</th>
                  <th className="px-2 py-1 text-left font-normal">Result</th>
                  <th className="px-2 py-1 text-right font-normal">Length</th>
                  <th className="px-2 py-1 text-right font-normal">Deaths</th>
                  <th className="px-2 py-1 text-left font-normal">Cause</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {boss.pullsList.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-card/40 hover:bg-card/30"
                  >
                    <td className="px-2 py-1 tabular-nums">{p.pullNumber}</td>
                    <td className="px-2 py-1">
                      {p.result === 'kill' ? (
                        <span className="text-green-400">Kill</span>
                      ) : (
                        <span className="tabular-nums">
                          {pct(p.bossPercent)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {mmss(p.duration)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {p.deaths ?? '–'}
                    </td>
                    <td className="px-2 py-1 truncate max-w-[280px]">
                      {p.cause ?? ''}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {p.source === 'wcl' ? (
                        <span
                          className="text-xs text-foreground/50"
                          title="Imported from Warcraft Logs: no app report to open"
                        >
                          WCL
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-brand hover:underline"
                          onClick={() => onOpenPull(p.id)}
                        >
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-foreground">
              Every pull with its result and cause. Open one for its full
              report.
            </p>
          )}
        </Panel>
      </div>
    </AbilityScope>
  );
};

export const NightSummaryView = ({
  onOpenPull,
  canEdit = false,
}: {
  onOpenPull: (id: string) => void;
  canEdit?: boolean;
}) => {
  const [nights, setNights] = React.useState<NightIndex[] | null>(null);
  const [night, setNight] = React.useState<string>('');
  const [bosses, setBosses] = React.useState<BossNight[] | null>(null);
  // Which boss's widgets to show; empty = the one pulled most that night.
  const [bossChoice, setBossChoice] = React.useState('');
  const [error, setError] = React.useState('');
  // The night the shown bosses belong to; differs while a new one loads.
  const [loadedNight, setLoadedNight] = React.useState('');
  const loading = night !== loadedNight;

  React.useEffect(() => {
    let cancelled = false;
    call<{ nights: NightIndex[] }>({ action: 'nights' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setNights(response.data.nights);
      setNight((current) => current || response.data.nights[0]?.night || '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!night) return undefined;
    let cancelled = false;
    call<{ night: string; bosses: BossNight[] }>({
      action: 'night',
      night,
    }).then((response) => {
      if (cancelled) return;
      setLoadedNight(night);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setError('');
      setBosses(response.data.bosses);
    });
    return () => {
      cancelled = true;
    };
  }, [night]);

  if (error && !nights) return <p className="text-sm text-red-400">{error}</p>;
  if (!nights)
    return <p className="text-sm text-foreground">Loading nights…</p>;
  if (!nights.length) {
    return (
      <p className="text-sm text-foreground">
        No pulls yet. Once raiders have &quot;Send my pull logs&quot; on, each
        raid night shows up here.
      </p>
    );
  }

  const current = nights.find((n) => n.night === night);
  const totalPulls = current?.bosses.reduce((s, b) => s + b.pulls, 0) ?? 0;
  const totalKills = current?.bosses.reduce((s, b) => s + b.kills, 0) ?? 0;

  // The chosen boss if it was pulled this night, else the most-pulled one.
  const shown =
    bosses?.find(
      (b) => bossKey(b.encounterId, b.difficultyId) === bossChoice,
    ) ??
    (bosses?.length
      ? [...bosses].sort((a, b) => b.pulls - a.pulls)[0]
      : undefined);
  const shownKey = shown ? bossKey(shown.encounterId, shown.difficultyId) : '';

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-3 flex-wrap">
        <label className="flex items-center gap-x-2 text-sm">
          Night
          <select
            className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
            value={night}
            onChange={(e) => setNight(e.target.value)}
          >
            {nights.map((n) => (
              <option key={n.night} value={n.night}>
                {nightLabel(n.night)} ·{' '}
                {n.bosses.map((b) => b.encounterName).join(', ')}
              </option>
            ))}
          </select>
        </label>
        {bosses && bosses.length > 0 && (
          <label className="flex items-center gap-x-2 text-sm">
            Boss
            <select
              className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
              value={shownKey}
              onChange={(e) => setBossChoice(e.target.value)}
            >
              {bosses.map((b) => (
                <option
                  key={bossKey(b.encounterId, b.difficultyId)}
                  value={bossKey(b.encounterId, b.difficultyId)}
                >
                  {b.encounterName} ({difficultyName(b.difficultyId)}) ·{' '}
                  {b.pulls} {b.pulls === 1 ? 'pull' : 'pulls'}
                  {b.kills ? ' · killed' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="text-sm text-foreground">
          Night: {totalPulls} {totalPulls === 1 ? 'pull' : 'pulls'} ·{' '}
          {totalKills} {totalKills === 1 ? 'kill' : 'kills'}
        </span>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      <div
        className={`flex flex-col gap-y-8 transition-opacity ${
          loading ? 'opacity-50' : ''
        }`}
      >
        {shown && (
          <BossNightCard
            key={shownKey}
            boss={shown}
            onOpenPull={onOpenPull}
            canEdit={canEdit}
          />
        )}
        {!bosses && <p className="text-sm text-foreground">Loading…</p>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Progression                                                         */
/* ------------------------------------------------------------------ */

const KILL_COLOR = '#4ade80';
const PULL_COLOR = 'hsl(30 8% 55%)';
// A watched guild's line. Validated against the brass on the dark surface
// (CVD ΔE 26, normal-vision ΔE 29).
const COMPARE_COLOR = '#3987e5';

export type CompareSeries = {
  name: string;
  series: { n: number; percent: number; kill: boolean; night: string }[];
};

const bestSoFar = (values: { percent: number | null; kill: boolean }[]) =>
  values.reduce<number[]>((acc, p) => {
    const prev = acc.length ? acc[acc.length - 1] : 100;
    acc.push(Math.min(prev, p.kill ? 0 : (p.percent ?? 100)));
    return acc;
  }, []);

/**
 * Boss health at the end of every pull (dots), with the best so far (brass
 * step line). Thin hairlines split nights; a crown marks the first kill.
 * Hover anywhere to snap to the nearest pull; click to open it.
 */
const ProgressionChart = ({
  data,
  onOpenPull,
  compare,
}: {
  data: Progression;
  onOpenPull: (id: string) => void;
  compare?: CompareSeries | null;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(800);
  const [hover, setHover] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(320, Math.floor(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 260;
  const pad = { left: 40, right: 16, top: 26, bottom: 24 };
  const series = data.series.filter((p) => p.percent !== null || p.kill);
  const count = Math.max(series.length, compare?.series.length ?? 0, 2);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (i / (count - 1)) * plotW;
  const y = (v: number) =>
    pad.top + (1 - Math.min(100, Math.max(0, v)) / 100) * plotH;

  // Best so far after each pull, drawn as a step line.
  const steps = (best: number[]) =>
    best
      .flatMap((b, i) =>
        i > 0 && b < best[i - 1]
          ? [`${x(i)},${y(best[i - 1])}`, `${x(i)},${y(b)}`]
          : [`${x(i)},${y(b)}`],
      )
      .join(' ');
  const bestAt = bestSoFar(series);
  const bestPoints = steps(bestAt);
  const compareBest = compare ? bestSoFar(compare.series) : [];
  const compareKill = compare?.series.findIndex((p) => p.kill) ?? -1;

  // Night boundaries.
  const nightStarts = series
    .map((p, i) => ({ night: p.night, i }))
    .filter((p, idx, all) => idx === 0 || all[idx - 1].night !== p.night);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - pad.left) / plotW) * (count - 1));
    setHover(Math.min(count - 1, Math.max(0, i)));
  };

  const hovered = hover !== null ? (series[hover] ?? null) : null;
  const tipLeft = hover !== null ? (x(hover) / width) * 100 : 0;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Boss health at the end of each pull on ${data.encounterName}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() =>
          hovered && hovered.source !== 'wcl' && onOpenPull(hovered.id)
        }
        className="cursor-pointer select-none"
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text
              x={pad.left - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize={11}
              className="fill-foreground"
            >
              {v}%
            </text>
          </g>
        ))}

        {nightStarts.map(({ night, i }, idx) => (
          <g key={night}>
            {idx > 0 && (
              <line
                x1={(x(i) + x(i - 1)) / 2}
                x2={(x(i) + x(i - 1)) / 2}
                y1={pad.top - 14}
                y2={height - pad.bottom}
                stroke="currentColor"
                strokeOpacity={0.2}
              />
            )}
            <text
              x={idx > 0 ? (x(i) + x(i - 1)) / 2 + 4 : pad.left}
              y={pad.top - 8}
              fontSize={11}
              className="fill-foreground"
            >
              {shortNight(night)}
            </text>
          </g>
        ))}

        {compare && compareBest.length > 0 && (
          <g>
            <polyline
              points={steps(compareBest)}
              fill="none"
              stroke={COMPARE_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {compareKill >= 0 && (
              <>
                <circle
                  cx={x(compareKill)}
                  cy={y(0)}
                  r={6}
                  fill={COMPARE_COLOR}
                  stroke="hsl(var(--background-higher))"
                  strokeWidth={2}
                />
                <text
                  x={x(compareKill)}
                  y={y(0) - 12}
                  textAnchor={compareKill > count * 0.8 ? 'end' : 'middle'}
                  fontSize={11}
                  className="fill-foreground-lighter"
                >
                  {compare.name} kill · pull {compareKill + 1}
                </text>
              </>
            )}
          </g>
        )}

        <polyline
          points={bestPoints}
          fill="none"
          stroke={BRAND}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {series.map((p, i) =>
          p.kill ? null : (
            <circle
              key={p.id}
              cx={x(i)}
              cy={y(p.percent ?? 100)}
              r={series.length > 150 ? 2.5 : 4}
              fill={PULL_COLOR}
              stroke="hsl(var(--background-higher))"
              strokeWidth={series.length > 150 ? 1 : 2}
            />
          ),
        )}

        {series.map((p, i) =>
          p.kill ? (
            <g key={p.id}>
              <circle
                cx={x(i)}
                cy={y(0)}
                r={6}
                fill={KILL_COLOR}
                stroke="hsl(var(--background-higher))"
                strokeWidth={2}
              />
              {data.firstKill?.pull === p.n && (
                <text
                  x={i > series.length * 0.8 ? x(i) + 6 : x(i)}
                  y={height - 6}
                  textAnchor={i > series.length * 0.8 ? 'end' : 'middle'}
                  fontSize={11}
                  className="fill-foreground-lighter"
                >
                  First kill · pull {p.n}
                </text>
              )}
            </g>
          ) : null,
        )}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={height - pad.bottom}
            stroke="currentColor"
            strokeOpacity={0.35}
          />
        )}

        {!(data.firstKill && data.firstKill.pull > series.length * 0.8) && (
          <text
            x={width - pad.right}
            y={height - 6}
            textAnchor="end"
            fontSize={11}
            className="fill-foreground"
          >
            Pull {count}
          </text>
        )}
        <text
          x={pad.left}
          y={height - 6}
          fontSize={11}
          className="fill-foreground"
        >
          Pull 1
        </text>
      </svg>

      {hover !== null && (hovered || compare) && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-md border border-card bg-background px-2 py-1.5 text-xs shadow-lg whitespace-nowrap"
          style={{
            left: `${tipLeft}%`,
            transform:
              tipLeft > 70
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          {hovered ? (
            <>
              <div className="font-semibold text-sm text-foreground-lighter">
                {hovered.kill ? 'Kill' : pct(hovered.percent)}
              </div>
              <div className="text-foreground">
                Pull {hovered.n} · {nightLabel(hovered.night)}
              </div>
            </>
          ) : (
            <div className="text-foreground">Pull {hover + 1}</div>
          )}
          {hover < bestAt.length && (
            <div className="flex items-center gap-x-1.5 text-foreground mt-0.5">
              <span
                className="inline-block w-3 h-[2px]"
                style={{ background: BRAND }}
              />
              <span className="text-foreground-lighter">
                {pct(bestAt[hover])}
              </span>
              {compare ? 'Room Forty best' : 'best so far'}
            </div>
          )}
          {compare && hover < compareBest.length && (
            <div className="flex items-center gap-x-1.5 text-foreground mt-0.5">
              <span
                className="inline-block w-3 h-[2px]"
                style={{ background: COMPARE_COLOR }}
              />
              <span className="text-foreground-lighter">
                {compareBest[hover] === 0 ? 'Killed' : pct(compareBest[hover])}
              </span>
              {compare.name} best
            </div>
          )}
          {hovered && (
            <div className="text-foreground/70 mt-0.5">
              {hovered.source === 'wcl'
                ? 'From Warcraft Logs'
                : 'Click to open'}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-x-4 text-xs text-foreground mt-1">
        <span className="flex items-center gap-x-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: PULL_COLOR }}
          />
          Boss health when the pull ended
        </span>
        <span className="flex items-center gap-x-1.5">
          <span
            className="inline-block w-4 h-[2px]"
            style={{ background: BRAND }}
          />
          {compare ? 'Room Forty best so far' : 'Best so far'}
        </span>
        {compare && (
          <span className="flex items-center gap-x-1.5">
            <span
              className="inline-block w-4 h-[2px]"
              style={{ background: COMPARE_COLOR }}
            />
            {compare.name} best so far
          </span>
        )}
        <span className="flex items-center gap-x-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: KILL_COLOR }}
          />
          Kill
        </span>
      </div>
    </div>
  );
};

/** Early deaths per pull, one column per night; darker brass = more. */
const RaiderTrend = ({
  data,
  leftOut,
  onToggle,
}: {
  data: Progression;
  leftOut: Set<string>;
  onToggle: (name: string) => void;
}) => {
  const [role, setRole] = React.useState('all');
  const nights = data.nights.map((n) => n.night).slice(-10);
  const rows = data.trend
    .filter((r) => role === 'all' || r.role === role)
    .map((r) => {
      const totals = Object.values(r.nights).reduce(
        (acc, v) => ({
          pulls: acc.pulls + v.pulls,
          early: acc.early + v.earlyDeaths,
        }),
        { pulls: 0, early: 0 },
      );
      return {
        ...r,
        overall: totals.pulls ? totals.early / totals.pulls : 0,
        pulls: totals.pulls,
      };
    })
    .filter((r) => r.pulls > 0)
    .sort(
      (a, b) =>
        Number(leftOut.has(a.name)) - Number(leftOut.has(b.name)) ||
        b.overall - a.overall ||
        a.name.localeCompare(b.name),
    );

  const max = Math.max(
    0.25,
    ...rows
      .filter((r) => !leftOut.has(r.name))
      .flatMap((r) => Object.values(r.nights).map((v) => v.rate)),
  );

  return (
    <div>
      <div className="flex gap-x-1 mb-2">
        {['all', 'tank', 'healer', 'dps'].map((r) => (
          <Button
            key={r}
            size="xs"
            variant={role === r ? 'default' : 'ghost'}
            onClick={() => setRole(r)}
          >
            {r === 'all'
              ? 'Everyone'
              : r === 'dps'
                ? 'DPS'
                : `${r[0].toUpperCase()}${r.slice(1)}s`}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-separate border-spacing-[2px]">
          <thead className="text-xs text-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">Raider</th>
              <th className="px-2 py-1 text-right font-normal">All nights</th>
              {nights.map((n) => (
                <th
                  key={n}
                  className="px-2 py-1 text-right font-normal whitespace-nowrap"
                >
                  {shortNight(n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className={leftOut.has(r.name) ? 'opacity-40' : ''}
              >
                <td
                  className={`px-2 py-1 whitespace-nowrap ${ROLE_STYLE[r.role] ?? ''}`}
                >
                  <span className="inline-flex items-center gap-x-2">
                    <MiniSwitch
                      checked={!leftOut.has(r.name)}
                      onChange={() => onToggle(r.name)}
                      label={
                        leftOut.has(r.name)
                          ? `Include ${r.name}`
                          : `Leave ${r.name} out of every widget`
                      }
                    />
                    {r.name}
                  </span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-foreground-lighter">
                  {r.overall.toFixed(2)}
                </td>
                {nights.map((n) => {
                  const v = r.nights[n];
                  if (!v) {
                    return (
                      <td
                        key={n}
                        className="px-2 py-1 text-right text-foreground/40"
                      >
                        –
                      </td>
                    );
                  }
                  const strength = Math.min(1, v.rate / max);
                  return (
                    <td
                      key={n}
                      className="px-2 py-1 text-right tabular-nums rounded-[3px] min-w-[52px]"
                      style={{
                        background: v.rate
                          ? `hsl(var(--brand) / ${0.08 + strength * 0.4})`
                          : undefined,
                        color: v.rate
                          ? 'hsl(var(--foreground-lighter))'
                          : 'hsl(var(--foreground) / 0.5)',
                      }}
                      title={`${v.earlyDeaths} early ${
                        v.earlyDeaths === 1 ? 'death' : 'deaths'
                      } in ${v.pulls} ${v.pulls === 1 ? 'pull' : 'pulls'}`}
                    >
                      {v.rate.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground mt-2">
        Early deaths per pull. Lower is better; a falling row means someone is
        learning the fight. Switch someone off to leave them out of every widget
        here (raiders, avoidable damage, consumables).
        {data.nights.length > 10 && ' Showing the last 10 nights.'}
      </p>
    </div>
  );
};

/** Top causes, one row per night: how often each one ended a pull. */
const CauseTrend = ({
  data,
  excluded,
  options,
  onToggle,
}: {
  data: Progression;
  excluded: string[];
  options: { name: string; count: number }[];
  onToggle: (cause: string) => void;
}) => {
  const [showAll, setShowAll] = React.useState(false);
  const included = data.causes.map((c) => c.name);
  const top = showAll ? included : included.slice(0, 8);
  const nights = data.nights.slice(-10);
  const pullsOf = (name: string) =>
    options.find((o) => o.name === name)?.count ?? 0;
  if (!top.length && !excluded.length) {
    return <p className="text-sm text-foreground">No wipes.</p>;
  }
  const max = Math.max(
    1,
    ...nights.flatMap((n) =>
      n.causes.filter((c) => top.includes(c.name)).map((c) => c.count),
    ),
  );

  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-separate border-spacing-[2px]">
        <thead className="text-xs text-foreground">
          <tr>
            <th className="px-2 py-1 text-left font-normal">Cause</th>
            {nights.map((n) => (
              <th
                key={n.night}
                className="px-2 py-1 text-right font-normal whitespace-nowrap"
              >
                {shortNight(n.night)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {top.map((name) => (
            <tr key={name}>
              <td className="px-2 py-1 whitespace-nowrap max-w-[300px] truncate">
                <span className="inline-flex items-center gap-x-2">
                  <MiniSwitch
                    checked
                    onChange={() => onToggle(name)}
                    label={`Leave out pulls ended by ${name}`}
                  />
                  <Ability name={name} />
                </span>
              </td>
              {nights.map((n) => {
                const count = n.causes.find((c) => c.name === name)?.count ?? 0;
                const share = n.pulls ? Math.round((count / n.pulls) * 100) : 0;
                const strength = count / max;
                return (
                  <td
                    key={n.night}
                    className="px-2 py-1 text-right tabular-nums rounded-[3px] min-w-[52px]"
                    style={{
                      background: count
                        ? `hsl(var(--brand) / ${0.08 + strength * 0.4})`
                        : undefined,
                      color: count
                        ? 'hsl(var(--foreground-lighter))'
                        : 'hsl(var(--foreground) / 0.4)',
                    }}
                    title={`${count} of ${n.pulls} pulls (${share}%)`}
                  >
                    {count || '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {excluded.length > 0 && (
        <div className="flex flex-col gap-y-1 mt-2">
          {excluded.map((name) => (
            <div
              key={name}
              className="flex items-center gap-x-2 text-sm opacity-50 px-2"
            >
              <MiniSwitch
                checked={false}
                onChange={() => onToggle(name)}
                label={`Include pulls ended by ${name}`}
              />
              <span>{name}</span>
              <span className="text-xs text-foreground">
                left out ({pullsOf(name)}{' '}
                {pullsOf(name) === 1 ? 'pull' : 'pulls'})
              </span>
            </div>
          ))}
        </div>
      )}
      {included.length > 8 && (
        <Button
          size="xs"
          variant="ghost"
          className="mt-1"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show the top 8' : `Show all ${included.length} causes`}
        </Button>
      )}
      <p className="text-xs text-foreground mt-2">
        Pulls ended by each cause, per night. A cause that fades out is a
        mechanic the raid has solved. Switch a cause off to leave its pulls out
        of every widget (e.g. a fluke raid wipe).
      </p>
    </div>
  );
};

type BossOption = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  lastNight: string;
};

const loadBossChoice = () => {
  try {
    return localStorage.getItem('rf-pulldesk-progression-boss') || '';
  } catch {
    return '';
  }
};

type PhaseInfo = {
  phase: 'progression' | 'reclear';
  counts: { progression: number; reclear: number };
  empty?: boolean;
  // Every wipe cause in this phase, and pulls left out by the filter.
  causeOptions?: { name: string; count: number }[];
  excludedPulls?: number;
};

// What's left out of Progression / Reclears, per boss and phase: wipe
// causes (their pulls drop out of every widget) and raiders (their rows).
type Filters = Record<string, { causes: string[]; raiders: string[] }>;
const FILTER_KEY = 'rf-pulldesk-progression-filters';
const loadFilters = (): Filters => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const NO_FILTER = { causes: [] as string[], raiders: [] as string[] };

/**
 * Progression (every pull up to and including the first kill, in all
 * recorded history) or Reclears (every pull after it), for one boss.
 */
export const ProgressionView = ({
  onOpenPull,
  canEdit = false,
  phase = 'progression',
  onShowReclears,
}: {
  onOpenPull: (id: string) => void;
  canEdit?: boolean;
  phase?: 'progression' | 'reclear';
  onShowReclears?: () => void;
}) => {
  const reclear = phase === 'reclear';
  // Non-Mythic bosses to list (Mythic always shows); null = not chosen yet.
  const [shownList, setShownList] = React.useState<string[] | null>(null);
  const [allOptions, setAllOptions] = React.useState<BossOption[] | null>(null);
  const [editingList, setEditingList] = React.useState(false);
  const [phaseInfo, setPhaseInfo] = React.useState<PhaseInfo | null>(null);
  const [options, setOptions] = React.useState<BossOption[] | null>(null);
  const [choice, setChoice] = React.useState<string>(loadBossChoice);
  const [filters, setFilters] = React.useState<Filters>(loadFilters);
  const filterKey = `${choice}:${phase}`;
  const filter = filters[filterKey] ?? NO_FILTER;
  const excludeKey = [...filter.causes].sort().join('|');
  const leftOut = React.useMemo(
    () => new Set(filter.raiders),
    [filter.raiders],
  );
  const [data, setData] = React.useState<Progression | null>(null);
  const [error, setError] = React.useState('');
  const [loadedChoice, setLoadedChoice] = React.useState('');
  const loading = choice !== loadedChoice;
  const [asTable, setAsTable] = React.useState(false);
  // Top-guild watcher: results, and which guild the chart compares with.
  const [watcher, setWatcher] = React.useState<WatcherState | null>(null);
  const [watcherTick, setWatcherTick] = React.useState(0);
  const [compareKey, setCompareKey] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchState = () =>
      loadWatcher().then((response) => {
        if (cancelled || !response.ok) return;
        setWatcher(response.data);
        // Keep the log moving while a crawl runs.
        if (response.data.status.running) timer = setTimeout(fetchState, 3000);
      });
    fetchState();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [watcherTick]);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      call<{ nights: NightIndex[] }>({ action: 'nights' }),
      call<{ progressionShown: string[] | null }>({ action: 'config' }),
    ]).then(([response, config]) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const seen = new Map<string, BossOption>();
      // When each boss first died (and was first pulled), to list them in
      // the order the raid killed them.
      const firstKill = new Map<string, number>();
      const firstPulled = new Map<string, string>();
      // Nights come newest first, so the first sighting is the latest.
      response.data.nights.forEach((n) =>
        n.bosses.forEach((b) => {
          const key = bossKey(b.encounterId, b.difficultyId);
          if (!seen.has(key)) seen.set(key, { ...b, lastNight: n.night });
          firstPulled.set(key, n.night);
          const at =
            b.firstKillAt ?? (b.kills ? Date.parse(`${n.night}T12:00:00`) : 0);
          if (at) firstKill.set(key, Math.min(firstKill.get(key) ?? at, at));
        }),
      );
      const latest = [...seen.keys()][0] ?? '';
      const killOrder = (key: string) => firstKill.get(key) ?? Infinity;
      const everything = [...seen.values()].sort((a, b) => {
        const ka = bossKey(a.encounterId, a.difficultyId);
        const kb = bossKey(b.encounterId, b.difficultyId);
        return (
          killOrder(ka) - killOrder(kb) ||
          (firstPulled.get(ka) ?? '').localeCompare(firstPulled.get(kb) ?? '')
        );
      });
      const saved = config.ok ? config.data.progressionShown : null;
      // Until someone picks, Coiled Altar and Ula'tek below Mythic.
      const shown =
        saved ??
        everything
          .filter(
            (b) =>
              !isMythic(b.difficultyId) &&
              /coiled altar|ula.?tek/i.test(b.encounterName),
          )
          .map((b) => bossKey(b.encounterId, b.difficultyId));
      setShownList(shown);
      setAllOptions(everything);
      const list = everything.filter(
        (b) =>
          isMythic(b.difficultyId) ||
          shown.includes(bossKey(b.encounterId, b.difficultyId)),
      );
      setOptions(list);
      // Keep the last choice; else the boss pulled most recently.
      setChoice((current) => {
        const keys = list.map((b) => bossKey(b.encounterId, b.difficultyId));
        if (keys.includes(current)) return current;
        if (keys.includes(latest)) return latest;
        return keys[0] ?? '';
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!choice) return undefined;
    try {
      localStorage.setItem('rf-pulldesk-progression-boss', choice);
    } catch {
      // Storage unavailable: the choice just isn't remembered.
    }
    const [encounterId, difficultyId] = choice.split(':').map(Number);
    let cancelled = false;
    call<Progression & PhaseInfo>({
      action: 'progression',
      encounterId,
      difficultyId,
      phase,
      exclude: excludeKey ? excludeKey.split('|') : [],
    }).then((response) => {
      if (cancelled) return;
      setLoadedChoice(choice);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setError('');
      setPhaseInfo(response.data);
      setData(response.data.empty ? null : response.data);
    });
    return () => {
      cancelled = true;
    };
  }, [choice, phase, excludeKey]);

  const saveList = async (next: string[]) => {
    setShownList(next);
    if (allOptions) {
      setOptions(
        allOptions.filter(
          (b) =>
            isMythic(b.difficultyId) ||
            next.includes(bossKey(b.encounterId, b.difficultyId)),
        ),
      );
    }
    const response = await call({ action: 'setProgressionList', shown: next });
    if (!response.ok) setError(response.error);
  };

  const updateFilter = (
    change: (f: { causes: string[]; raiders: string[] }) => {
      causes: string[];
      raiders: string[];
    },
  ) => {
    setFilters((prev) => {
      const next = {
        ...prev,
        [filterKey]: change(prev[filterKey] ?? NO_FILTER),
      };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: the filter lasts until the app closes.
      }
      return next;
    });
  };
  const toggleIn = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  const toggleCause = (cause: string) =>
    updateFilter((f) => ({ ...f, causes: toggleIn(f.causes, cause) }));
  const toggleRaider = (name: string) =>
    updateFilter((f) => ({ ...f, raiders: toggleIn(f.raiders, name) }));

  if (error && !options) return <p className="text-sm text-red-400">{error}</p>;
  if (!options)
    return <p className="text-sm text-foreground">Loading bosses…</p>;
  if (!options.length) {
    return <p className="text-sm text-foreground">No pulls yet.</p>;
  }

  const wipes = data ? data.pulls - data.kills : 0;

  // The compared guild's pulls on this boss (matched by encounter ID, or by
  // name in case IDs differ).
  const compareGuild = watcher?.results.guilds.find(
    (g) => guildKey(g) === compareKey,
  );
  const compareBoss =
    data && compareGuild
      ? (compareGuild.bosses?.[data.encounterId] ??
        Object.values(compareGuild.bosses ?? {}).find(
          (b) => b.name === data.encounterName,
        ))
      : undefined;
  const compare = compareBoss
    ? { name: compareGuild?.name ?? '', series: compareBoss.series }
    : null;
  const watchedGuilds = watcher?.results.guilds ?? [];
  const bestWipe = data
    ? Math.min(
        ...data.series
          .filter((p) => !p.kill && p.percent !== null)
          .map((p) => p.percent as number),
      )
    : null;

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-3 flex-wrap">
        <label className="flex items-center gap-x-2 text-sm">
          Boss
          <select
            className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {options.map((b) => (
              <option
                key={bossKey(b.encounterId, b.difficultyId)}
                value={bossKey(b.encounterId, b.difficultyId)}
              >
                {b.encounterName} · {difficultyName(b.difficultyId)}
              </option>
            ))}
          </select>
        </label>
        {canEdit && allOptions && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setEditingList((v) => !v)}
          >
            {editingList ? 'Done' : 'Choose bosses'}
          </Button>
        )}
        {phaseInfo && !loading && (
          <span className="text-sm text-foreground">
            {reclear
              ? `${phaseInfo.counts.reclear} reclear pulls`
              : `${phaseInfo.counts.progression} progression pulls`}
            {onShowReclears &&
              (reclear
                ? phaseInfo.counts.progression > 0
                : phaseInfo.counts.reclear > 0) && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground-lighter"
                    onClick={onShowReclears}
                  >
                    {reclear
                      ? `${phaseInfo.counts.progression} progression pulls`
                      : `${phaseInfo.counts.reclear} reclear pulls after the first kill`}
                  </button>
                </>
              )}
          </span>
        )}
        {(filter.causes.length > 0 || filter.raiders.length > 0) && (
          <span className="ml-auto flex items-center gap-x-2 text-xs text-foreground">
            Left out:
            {filter.causes.length > 0 &&
              ` ${filter.causes.length} wipe ${filter.causes.length === 1 ? 'cause' : 'causes'} (${phaseInfo?.excludedPulls ?? 0} pulls)`}
            {filter.causes.length > 0 && filter.raiders.length > 0 && ' ·'}
            {filter.raiders.length > 0 &&
              ` ${filter.raiders.length} ${filter.raiders.length === 1 ? 'raider' : 'raiders'}`}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => updateFilter(() => NO_FILTER)}
            >
              Include everything
            </Button>
          </span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {editingList && allOptions && shownList && (
        <div className="rounded-md border border-card bg-background/40 p-3 flex flex-col gap-y-1.5 max-w-[560px]">
          <p className="text-xs text-foreground m-0">
            Every Mythic boss is always listed. Tick the lower-difficulty bosses
            to list too.
          </p>
          {allOptions
            .filter((b) => !isMythic(b.difficultyId))
            .map((b) => {
              const key = bossKey(b.encounterId, b.difficultyId);
              return (
                <label
                  key={key}
                  className="flex items-center gap-x-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={shownList.includes(key)}
                    onChange={() =>
                      saveList(
                        shownList.includes(key)
                          ? shownList.filter((k) => k !== key)
                          : [...shownList, key],
                      )
                    }
                    className="w-4 h-4 accent-[hsl(var(--brand))]"
                  />
                  {b.encounterName} · {difficultyName(b.difficultyId)}
                </label>
              );
            })}
        </div>
      )}

      {!data && phaseInfo?.empty && !loading && (
        <p className="text-sm text-foreground max-w-[720px]">
          {reclear
            ? 'No reclears yet: every pull on this boss so far is progression (up to and including the first kill).'
            : 'No progression pulls for this boss.'}
        </p>
      )}

      {data && (
        <AbilityScope
          encounterId={data.encounterId}
          difficultyId={data.difficultyId}
          spellIds={data.spellIds}
          canEdit={canEdit}
        >
          <div
            className={`flex flex-col gap-y-4 transition-opacity ${
              loading ? 'opacity-50' : ''
            }`}
          >
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Stat label="Pulls" value={data.pulls} />
              <Stat label="Nights" value={data.nights.length} />
              {reclear ? (
                <Stat
                  label="Nights with a kill"
                  value={`${data.nights.filter((n) => n.kills > 0).length} of ${data.nights.length}`}
                />
              ) : (
                <Stat
                  label={data.firstKill ? 'First kill' : 'Best wipe'}
                  value={
                    data.firstKill
                      ? `Pull ${data.firstKill.pull} · ${shortNight(data.firstKill.night)}`
                      : pct(Number.isFinite(bestWipe) ? bestWipe : null)
                  }
                />
              )}
              <Stat label="Kills" value={data.kills} />
              <Stat
                label="Time in combat"
                value={hours(
                  data.nights.reduce((s, n) => s + n.combatSeconds, 0),
                )}
              />
              <Stat label="Wipes" value={wipes} />
            </div>

            <Panel
              title="Boss health by pull"
              aside={
                <>
                  {watchedGuilds.length > 0 && !asTable && !reclear && (
                    <select
                      className="h-8 bg-card text-foreground-lighter rounded-md px-2 text-xs border border-background"
                      value={compareKey}
                      onChange={(e) => setCompareKey(e.target.value)}
                      aria-label="Compare with a watched guild"
                    >
                      <option value="">Compare with…</option>
                      {watchedGuilds.map((g) => (
                        <option key={guildKey(g)} value={guildKey(g)}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="gap-x-1"
                    onClick={() => setAsTable((v) => !v)}
                  >
                    {asTable ? <LineChart size={14} /> : <Table2 size={14} />}
                    {asTable ? 'Chart' : 'Table'}
                  </Button>
                </>
              }
            >
              {asTable ? (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-foreground border-b border-card sticky top-0 bg-background-higher">
                      <tr>
                        <th className="px-2 py-1 text-left font-normal">
                          Pull
                        </th>
                        <th className="px-2 py-1 text-left font-normal">
                          Night
                        </th>
                        <th className="px-2 py-1 text-right font-normal">
                          Boss health
                        </th>
                        <th aria-label="Open" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.series.map((p) => (
                        <tr key={p.id} className="border-b border-card/40">
                          <td className="px-2 py-1 tabular-nums">{p.n}</td>
                          <td className="px-2 py-1">{nightLabel(p.night)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {p.kill ? (
                              <span className="text-green-400">Kill</span>
                            ) : (
                              pct(p.percent)
                            )}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {p.source === 'wcl' ? (
                              <span
                                className="text-xs text-foreground/50"
                                title="Imported from Warcraft Logs: no app report to open"
                              >
                                WCL
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="text-xs text-brand hover:underline"
                                onClick={() => onOpenPull(p.id)}
                              >
                                Open
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <ProgressionChart
                    data={data}
                    onOpenPull={onOpenPull}
                    compare={compare}
                  />
                  {compareKey && !compare && (
                    <p className="text-xs text-foreground mt-1">
                      {compareGuild?.name ?? 'That guild'} has no logged Mythic
                      pulls on this boss.
                    </p>
                  )}
                </>
              )}
            </Panel>

            {!reclear && (
              <Panel title="Top guilds">
                {watcher ? (
                  <div className="flex flex-col gap-y-4">
                    {watchedGuilds.length > 0 && (
                      <WatcherTable
                        state={watcher}
                        encounterId={data.encounterId}
                        encounterName={data.encounterName}
                        home={{
                          pulls: data.pulls,
                          nights: data.nights.length,
                          kill: data.firstKill?.pull ?? null,
                          best:
                            bestWipe !== null && Number.isFinite(bestWipe)
                              ? bestWipe
                              : null,
                        }}
                      />
                    )}
                    <WatcherSettings
                      key={JSON.stringify(watcher.settings)}
                      state={watcher}
                      onChange={() => setWatcherTick((t) => t + 1)}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-foreground">Loading…</p>
                )}
              </Panel>
            )}

            <Panel title="Night by night">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-foreground border-b border-card">
                    <tr>
                      <th className="px-2 py-1 text-left font-normal">Night</th>
                      <th className="px-2 py-1 text-right font-normal">
                        Pulls
                      </th>
                      <th className="px-2 py-1 text-right font-normal">
                        Kills
                      </th>
                      <th className="px-2 py-1 text-right font-normal">Best</th>
                      <th className="px-2 py-1 text-right font-normal">
                        Median wipe
                      </th>
                      <th className="px-2 py-1 text-right font-normal">
                        In combat
                      </th>
                      <th className="px-2 py-1 text-left font-normal">
                        Top cause
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.nights].reverse().map((n) => (
                      <tr key={n.night} className="border-b border-card/40">
                        <td className="px-2 py-1 whitespace-nowrap">
                          {nightLabel(n.night)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {n.pulls}
                        </td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums ${
                            n.kills ? 'text-green-400' : 'text-foreground/50'
                          }`}
                        >
                          {n.kills}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {n.kills ? 'Kill' : pct(n.bestPercent)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {pct(n.medianPercent)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {hours(n.combatSeconds)}
                        </td>
                        <td className="px-2 py-1 truncate max-w-[280px]">
                          {n.topCause ? (
                            <>
                              <Ability name={n.topCause.name} /> (
                              {n.topCause.count})
                            </>
                          ) : (
                            '–'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid items-start grid-cols-1 xl:grid-cols-2 gap-3">
              <Panel title="Wipe causes over time">
                <CauseTrend
                  data={data}
                  excluded={filter.causes}
                  options={phaseInfo?.causeOptions ?? []}
                  onToggle={toggleCause}
                />
              </Panel>
              <Panel title="Early deaths by night">
                <RaiderTrend
                  data={data}
                  leftOut={leftOut}
                  onToggle={toggleRaider}
                />
              </Panel>
            </div>

            <AvoidablePanel
              key={`${data.encounterId}:${data.difficultyId}`}
              rows={data.avoidable}
              leftOut={leftOut}
            />

            {data.consumables !== undefined && (
              <Panel title="Consumables & buffs">
                <ConsumablesPanel
                  summary={data.consumables}
                  scope={`All nights · ${data.pulls} pulls`}
                  leftOut={leftOut}
                />
              </Panel>
            )}

            <Panel title="Raiders, all nights">
              <RaiderTable raiders={data.raiders} leftOut={leftOut} />
            </Panel>
          </div>
        </AbilityScope>
      )}
    </div>
  );
};

type ImportResult = {
  code: string;
  title?: string;
  bosses?: string[];
  added?: number;
  filled?: number;
  skipped?: number;
  error?: string;
};

/**
 * Backfill pulls the app didn't capture from Warcraft Logs report links.
 * Imported pulls get boss %, result, roster and deaths (for wipe causes and
 * early deaths); the cooldown plan, avoidable hits and defensives need the
 * app's own log.
 */
type TierZone = {
  zoneId: number;
  zoneName: string;
  codes: string[];
  first: number;
  last: number;
};
type TierJob = {
  running: boolean;
  total: number;
  done: number;
  added: number;
  skipped: number;
  errors: string[];
  finishedAt: number | null;
};
type WclGuild = { name: string; realm: string; region: string };

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

/**
 * Import every report the guild has on Warcraft Logs for chosen raid zones
 * (a whole tier), in the background. Pulls already here are skipped.
 */
const TierImport = ({ onImported }: { onImported: () => void }) => {
  const [guild, setGuild] = React.useState<WclGuild | null>(null);
  const [job, setJob] = React.useState<TierJob | null>(null);
  const [zones, setZones] = React.useState<TierZone[] | null>(null);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [months, setMonths] = React.useState(4);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [poll, setPoll] = React.useState(0);
  const wasRunning = React.useRef(false);
  const importedRef = React.useRef(onImported);
  React.useEffect(() => {
    importedRef.current = onImported;
  }, [onImported]);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    call<{ guild: WclGuild; job: TierJob }>({ action: 'importGuild' }).then(
      (response) => {
        if (cancelled || !response.ok) return;
        setGuild((current) => current ?? response.data.guild);
        setJob(response.data.job);
        if (response.data.job.running) {
          wasRunning.current = true;
          timer = setTimeout(() => setPoll((n) => n + 1), 3000);
        } else if (wasRunning.current) {
          wasRunning.current = false;
          if (response.data.job.added > 0) importedRef.current();
        }
      },
    );
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  const scan = async () => {
    if (!guild) return;
    setBusy(true);
    setError('');
    const response = await call<{ zones: TierZone[] }>({
      action: 'importScan',
      ...guild,
      months,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setZones(response.data.zones);
    // Pre-pick zones raided in the last 60 days: the current tier.
    const recent = Date.now() - 60 * 86400000;
    setPicked(
      response.data.zones.filter((z) => z.last >= recent).map((z) => z.zoneId),
    );
  };

  const start = async () => {
    const codes = (zones ?? [])
      .filter((z) => picked.includes(z.zoneId))
      .flatMap((z) => z.codes);
    setBusy(true);
    setError('');
    const response = await call<{ job: TierJob }>({
      action: 'importTier',
      codes,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setJob(response.data.job);
    setPoll((n) => n + 1);
  };

  const field =
    'h-8 rounded-md bg-card px-2 text-sm text-foreground-lighter border border-background';
  const pickedReports = (zones ?? [])
    .filter((z) => picked.includes(z.zoneId))
    .reduce((n, z) => n + z.codes.length, 0);

  return (
    <div className="flex flex-col gap-y-2 border-t border-card pt-3 mt-1">
      <h4 className="text-sm font-semibold text-foreground-lighter">
        Import a whole tier
      </h4>
      <p className="text-xs text-foreground m-0">
        Finds every report your guild posted on Warcraft Logs, grouped by raid,
        and imports the raids you pick. It runs on the server, so you can leave
        this page.
      </p>
      {guild && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            aria-label="Guild name"
            className={`${field} w-40`}
            value={guild.name}
            onChange={(e) => setGuild({ ...guild, name: e.target.value })}
            placeholder="Guild"
          />
          <input
            aria-label="Realm"
            className={`${field} w-40`}
            value={guild.realm}
            onChange={(e) => setGuild({ ...guild, realm: e.target.value })}
            placeholder="Realm"
          />
          <select
            aria-label="Region"
            className={field}
            value={guild.region}
            onChange={(e) => setGuild({ ...guild, region: e.target.value })}
          >
            {['us', 'eu', 'kr', 'tw'].map((r) => (
              <option key={r} value={r}>
                {r.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            aria-label="How far back"
            className={field}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[2, 4, 6, 12].map((m) => (
              <option key={m} value={m}>
                Last {m} months
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={scan}
            disabled={busy || !guild.name.trim() || !guild.realm.trim()}
          >
            {busy && !zones ? 'Looking…' : 'Find our reports'}
          </Button>
        </div>
      )}
      {zones && zones.length === 0 && (
        <p className="text-sm text-foreground">
          No reports in that time. Check the realm, or look further back.
        </p>
      )}
      {zones && zones.length > 0 && (
        <div className="flex flex-col gap-y-1">
          {zones.map((z) => (
            <label
              key={z.zoneId}
              className="flex items-center gap-x-2 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={picked.includes(z.zoneId)}
                onChange={() =>
                  setPicked((list) =>
                    list.includes(z.zoneId)
                      ? list.filter((id) => id !== z.zoneId)
                      : [...list, z.zoneId],
                  )
                }
                className="w-4 h-4 accent-[hsl(var(--brand))]"
              />
              <span className="text-foreground-lighter">{z.zoneName}</span>
              <span className="text-xs text-foreground">
                {z.codes.length} {z.codes.length === 1 ? 'report' : 'reports'} ·{' '}
                {shortDate(z.first)} – {shortDate(z.last)}
              </span>
            </label>
          ))}
          <div>
            <Button
              size="sm"
              onClick={start}
              disabled={busy || !pickedReports || Boolean(job?.running)}
            >
              Import {pickedReports}{' '}
              {pickedReports === 1 ? 'report' : 'reports'}
            </Button>
          </div>
        </div>
      )}
      {job && (job.running || job.finishedAt) && (
        <div className="flex flex-col gap-y-1">
          <div className="h-1.5 rounded bg-card overflow-hidden max-w-[420px]">
            <div
              className="h-1.5 bg-brand"
              style={{
                width: `${job.total ? (job.done / job.total) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-xs text-foreground">
            {job.running
              ? `Importing… ${job.done} of ${job.total} reports · ${job.added} pulls added so far`
              : `Done: ${job.added} pulls added, ${job.skipped} already here, from ${job.total} reports.`}
            {job.errors.length ? ` ${job.errors.length} reports failed.` : ''}
          </span>
          {!job.running && job.errors.length > 0 && (
            <ul className="text-xs text-red-400 m-0 pl-4">
              {job.errors.slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
};

export const ImportFromLogs = ({ onImported }: { onImported: () => void }) => {
  // The whole-tier import is the owner's (the server checks too).
  const permissions = usePermissions();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [results, setResults] = React.useState<ImportResult[] | null>(null);

  const run = async () => {
    setBusy(true);
    setError('');
    setResults(null);
    const reports = text
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const response = await call<{ results: ImportResult[] }>({
      action: 'importWcl',
      reports,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setResults(response.data.results);
    if (
      response.data.results.some((r) => (r.added ?? 0) + (r.filled ?? 0) > 0)
    ) {
      onImported();
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Import from Warcraft Logs
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-card bg-background/40 p-3 flex flex-col gap-y-2">
      <div className="flex items-center">
        <h3 className="font-display text-base text-foreground-lighter">
          Import pulls from Warcraft Logs
        </h3>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
      <p className="text-xs text-foreground">
        For pulls the app didn&apos;t capture. Paste report links (one per line,
        up to 10). Tracked-difficulty boss pulls are added with their boss %,
        deaths and wipe causes; pulls already here are skipped. The cooldown
        plan, avoidable hits and defensives need the app&apos;s own log, so they
        stay empty for imported pulls.
      </p>
      <textarea
        className="w-full min-h-[72px] rounded-md bg-card px-2 py-1.5 text-sm text-foreground-lighter border border-background"
        placeholder="https://www.warcraftlogs.com/reports/..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-x-2">
        <Button size="sm" onClick={run} disabled={busy || !text.trim()}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
        {busy && (
          <span className="text-xs text-foreground">
            Can take a minute for a long night.
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {results && (
        <ul className="text-sm flex flex-col gap-y-1">
          {results.map((r) => (
            <li key={r.code}>
              {r.error ? (
                <span className="text-red-400">
                  {r.code}: {r.error}
                </span>
              ) : (
                <span>
                  <span className="text-foreground-lighter">
                    {r.title || r.code}
                  </span>
                  {': '}
                  {(r.added ?? 0) + (r.filled ?? 0)} pulls added
                  {r.skipped ? `, ${r.skipped} already here` : ''}
                  {r.bosses?.length
                    ? ` (${r.bosses.join(', ')})`
                    : ' (no tracked boss pulls)'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {permissions?.owner && !permissions.viewAs && (
        <TierImport onImported={onImported} />
      )}
    </div>
  );
};

type LogFile = { name: string; size: number; modified: number };
type LogBoss = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  firstAt: number;
  lastAt: number;
};
type BackfillStatus = {
  running: boolean;
  auto?: boolean;
  lastAuto?: { at: number; uploaded: number; files: number } | null;
  file: string;
  found: number;
  uploaded: number;
  alreadyThere: number;
  skipped: number;
  failed: number;
  error: string;
  finishedAt: number | null;
};

export type BossPercentHint = {
  encounterId: number;
  difficultyId: number;
  start: number;
  bossPercent: number;
};

const DIFFICULTY_KEYS: Record<number, string> = {
  14: 'normal',
  15: 'heroic',
  16: 'mythic',
  17: 'lfr',
  233: 'mythic',
};

const fileSize = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

const timeOfDay = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Send pulls from a saved combat log: for nights nobody had "Send my pull
 * logs" on. Full reports (cooldown plan, avoidable hits, defensives), placed
 * by their real start time; pulls the server already has are skipped.
 */
export const UploadFromLog = ({
  hints,
  tracked,
  onUploaded,
}: {
  hints: BossPercentHint[];
  tracked: string[];
  onUploaded: () => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const [files, setFiles] = React.useState<LogFile[] | null>(null);
  const [file, setFile] = React.useState('');
  const [bosses, setBosses] = React.useState<LogBoss[] | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [scanning, setScanning] = React.useState(false);
  const [status, setStatus] = React.useState<BackfillStatus | null>(null);
  const [error, setError] = React.useState('');

  const isTracked = (difficultyId: number) =>
    !tracked.length || tracked.includes(DIFFICULTY_KEYS[difficultyId]);
  const key = (b: LogBoss) => `${b.encounterId}:${b.difficultyId}`;

  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    call<BackfillStatus>({ action: 'backfillStatus' }).then((response) => {
      if (
        !cancelled &&
        response.ok &&
        (response.data.running || response.data.lastAuto)
      ) {
        setStatus(response.data);
      }
    });
    call<LogFile[]>({ action: 'logFiles' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setFiles(response.data);
      setFile((current) => current || response.data[0]?.name || '');
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Follow a running upload.
  React.useEffect(() => {
    if (!status?.running) return undefined;
    const timer = setInterval(() => {
      call<BackfillStatus>({ action: 'backfillStatus' }).then((response) => {
        if (!response.ok) return;
        setStatus(response.data);
        if (!response.data.running) onUploaded();
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status?.running, onUploaded]);

  const scan = async () => {
    setScanning(true);
    setError('');
    setBosses(null);
    setStatus(null);
    const response = await call<LogBoss[]>({ action: 'scanLog', file });
    setScanning(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setBosses(response.data);
    setPicked(response.data.filter((b) => isTracked(b.difficultyId)).map(key));
  };

  const upload = async () => {
    setError('');
    const response = await call<BackfillStatus>({
      action: 'backfillLog',
      file,
      bosses: picked,
      hints,
    });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setStatus(response.data);
  };

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Upload from combat log
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-card bg-background/40 p-3 flex flex-col gap-y-2">
      <div className="flex items-center">
        <h3 className="font-display text-base text-foreground-lighter">
          Upload pulls from your combat log
        </h3>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
      <p className="text-xs text-foreground">
        The app does this by itself: with &quot;Send my pull logs&quot; on, it
        checks your finished combat logs from the last week every half hour and
        sends any pulls the server doesn&apos;t have. Use this to send a
        specific file now: pick it, scan, and upload. Each pull gets the full
        report at its real time; pulls the server already has are skipped. Boss
        % comes from your recordings where there is one.
      </p>
      {status?.lastAuto && !status.running && (
        <p className="text-xs text-foreground">
          Last automatic check{' '}
          {new Date(status.lastAuto.at).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
          : {status.lastAuto.uploaded}{' '}
          {status.lastAuto.uploaded === 1 ? 'pull' : 'pulls'} sent.
        </p>
      )}

      {files && !files.length && (
        <p className="text-sm text-foreground">
          No combat log files in your retail Logs folder.
        </p>
      )}
      {files && files.length > 0 && (
        <div className="flex items-center gap-x-2 flex-wrap">
          <select
            className="h-9 bg-card text-foreground-lighter rounded-md px-2 text-sm border border-background"
            value={file}
            onChange={(e) => {
              setFile(e.target.value);
              setBosses(null);
              setStatus(null);
            }}
          >
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {new Date(f.modified).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                · {fileSize(f.size)} · {f.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={scan}
            disabled={!file || scanning || Boolean(status?.running)}
          >
            {scanning ? 'Scanning…' : 'Scan'}
          </Button>
          {scanning && (
            <span className="text-xs text-foreground">
              A full raid night takes a minute or so.
            </span>
          )}
        </div>
      )}

      {bosses && !bosses.length && (
        <p className="text-sm text-foreground">No raid pulls in that log.</p>
      )}
      {bosses && bosses.length > 0 && (
        <div className="flex flex-col gap-y-1">
          {bosses.map((b) => {
            const ok = isTracked(b.difficultyId);
            return (
              <label
                key={key(b)}
                className={`flex items-center gap-x-2 text-sm ${ok ? '' : 'opacity-50'}`}
              >
                <input
                  type="checkbox"
                  className="accent-brand"
                  disabled={!ok}
                  checked={picked.includes(key(b))}
                  onChange={(e) =>
                    setPicked((current) =>
                      e.target.checked
                        ? [...current, key(b)]
                        : current.filter((k) => k !== key(b)),
                    )
                  }
                />
                <span className="text-foreground-lighter">
                  {b.encounterName}
                </span>
                <span className="text-foreground">
                  {difficultyName(b.difficultyId)} · {b.pulls}{' '}
                  {b.pulls === 1 ? 'pull' : 'pulls'}
                  {b.kills ? ` · ${b.kills} kill` : ''} · {timeOfDay(b.firstAt)}
                  –{timeOfDay(b.lastAt)}
                </span>
                {!ok && (
                  <span className="text-xs text-foreground">
                    (difficulty not tracked by the server)
                  </span>
                )}
              </label>
            );
          })}
          <div className="flex items-center gap-x-2 mt-1">
            <Button
              size="sm"
              onClick={upload}
              disabled={!picked.length || Boolean(status?.running)}
            >
              {status?.running ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
      )}

      {status && (
        <p className="text-sm">
          {status.running
            ? status.auto
              ? 'Sending missing pulls automatically: '
              : 'Uploading: '
            : 'Done: '}
          <span className="text-foreground-lighter">
            {status.uploaded} uploaded
          </span>
          {status.alreadyThere > 0 && `, ${status.alreadyThere} already here`}
          {status.skipped > 0 && `, ${status.skipped} not tracked`}
          {status.failed > 0 && (
            <span className="text-red-400">, {status.failed} failed</span>
          )}
          {status.running && ` (${status.found} found so far)`}
          {status.error && (
            <span className="text-red-400"> · {status.error}</span>
          )}
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
};
