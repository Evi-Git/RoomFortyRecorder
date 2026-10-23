import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { getSpecClass, getWoWClassColor } from './rendererutils';
import AbilityName from './AbilityCard';

/**
 * [RoomFortyRecorder] Meters for one pull, from the app's own combat log
 * (guild-cloud-server/meters.mjs): damage done, healing and damage taken
 * per raider, an over-time chart, and a raider's ability breakdown.
 */

const ipc = window.electron.ipcRenderer;
type Response<T> = { ok: true; data: T } | { ok: false; error: string };
const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

type Ability = {
  spellId: number;
  name: string;
  total: number;
  hits: number;
  crits: number;
  casts?: number;
  overheal?: number;
};
type Row = {
  name: string;
  specId: number;
  total: number;
  perSecond: number;
  overheal?: number;
  absorbs?: number;
  abilities: Ability[];
  series: number[];
};
export type MetersData = {
  bucketSeconds: number;
  damage: Row[];
  healing: Row[];
  taken: Row[];
};
type Kind = 'damage' | 'healing' | 'taken';

const KINDS: { key: Kind; label: string; rate: string }[] = [
  { key: 'damage', label: 'Damage done', rate: 'DPS' },
  { key: 'healing', label: 'Healing', rate: 'HPS' },
  { key: 'taken', label: 'Damage taken', rate: 'DTPS' },
];

const BRAND = 'hsl(var(--brand))';
const MUTED = 'hsl(30 8% 45%)';

export const compactNumber = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
        : String(Math.round(n));

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const classColor = (specId: number) =>
  getWoWClassColor(getSpecClass(specId)) || 'hsl(var(--foreground-lighter))';

/**
 * Per-second rate over the pull, one line per series, with a hover readout.
 * Series values are totals per bucket; drawn as per-second rates.
 */
const OverTime = ({
  series,
  bucketSeconds,
  rateLabel,
}: {
  series: { name: string; values: number[]; color: string; dashed?: boolean }[];
  bucketSeconds: number;
  rateLabel: string;
}) => {
  const [hover, setHover] = React.useState<number | null>(null);
  // Drawn at its real width so text stays 11px whatever the window size.
  const box = React.useRef<HTMLDivElement>(null);
  const [W, setW] = React.useState(640);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setW(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = 200;
  const left = 48;
  const right = 10;
  const top = 10;
  const bottom = 26;
  const count = Math.max(1, ...series.map((s) => s.values.length));
  const rates = series.map((s) => s.values.map((v) => v / bucketSeconds));
  const max = Math.max(1, ...rates.flat());
  const x = (i: number) =>
    left + (count <= 1 ? 0 : (i / (count - 1)) * (W - left - right));
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const duration = count * bucketSeconds;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - left) / (W - left - right)) * (count - 1));
    setHover(Math.min(count - 1, Math.max(0, i)));
  };

  return (
    <div className="relative" ref={box}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        role="img"
        aria-label={`${rateLabel} over the pull`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={W - right}
              y1={y(v)}
              y2={y(v)}
              stroke="hsl(var(--card))"
            />
            <text
              x={left - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="hsl(var(--foreground))"
            >
              {compactNumber(v)}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={left + f * (W - left - right)}
            y={H - 8}
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            fontSize="11"
            fill="hsl(var(--foreground))"
          >
            {mmss(f * duration)}
          </text>
        ))}
        {rates.map((values, si) => (
          <polyline
            key={series[si].name}
            fill="none"
            stroke={series[si].color}
            strokeWidth="2"
            strokeDasharray={series[si].dashed ? '4 3' : undefined}
            strokeLinejoin="round"
            points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={top}
            y2={H - bottom}
            stroke="hsl(var(--foreground) / 0.5)"
          />
        )}
      </svg>
      {hover !== null && (
        <div
          className="absolute top-1 pointer-events-none rounded-md border border-card bg-background px-2 py-1 text-xs shadow-lg"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform:
              x(hover) > W / 2
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          <div className="text-foreground">
            {mmss(hover * bucketSeconds)}–{mmss((hover + 1) * bucketSeconds)}
          </div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center gap-x-1.5">
              <span
                className="inline-block w-2.5 h-0.5"
                style={{ background: s.color }}
              />
              <span className="text-foreground-lighter">{s.name}</span>
              <span className="ml-auto pl-2 tabular-nums text-foreground-lighter">
                {compactNumber(rates[si][hover] ?? 0)} {rateLabel}
              </span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground mt-1">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-x-1.5">
              <span
                className="inline-block w-3.5 h-0.5"
                style={{
                  background: s.color,
                  opacity: s.dashed ? 0.7 : 1,
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/** Sum of several bucket series. */
const sumSeries = (rows: Row[]) => {
  const out: number[] = [];
  rows.forEach((r) =>
    r.series.forEach((v, i) => {
      out[i] = (out[i] ?? 0) + v;
    }),
  );
  return out;
};

const Breakdown = ({
  row,
  kind,
  rows,
  bucketSeconds,
  encounterId,
  difficultyId,
  onBack,
}: {
  row: Row;
  kind: Kind;
  rows: Row[];
  bucketSeconds: number;
  encounterId?: number;
  difficultyId?: number;
  onBack: () => void;
}) => {
  const meta = KINDS.find((k) => k.key === kind)!;
  const top = Math.max(1, ...row.abilities.map((a) => a.total));
  const avg = sumSeries(rows).map((v) => v / Math.max(1, rows.length));
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-x-1 text-sm text-brand hover:underline"
        >
          <ArrowLeft size={14} /> All raiders
        </button>
        <span
          className="font-display text-lg font-semibold"
          style={{ color: classColor(row.specId) }}
        >
          {row.name}
        </span>
        <span className="text-sm text-foreground">{meta.label}</span>
        <span className="ml-auto flex gap-x-5 text-right">
          <span className="flex flex-col">
            <span className="text-[11px] text-foreground">{meta.rate}</span>
            <span className="font-semibold tabular-nums text-foreground-lighter">
              {compactNumber(row.perSecond)}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[11px] text-foreground">Total</span>
            <span className="font-semibold tabular-nums text-foreground-lighter">
              {compactNumber(row.total)}
            </span>
          </span>
          {kind === 'healing' && (
            <>
              <span className="flex flex-col">
                <span className="text-[11px] text-foreground">Overheal</span>
                <span className="font-semibold tabular-nums text-foreground-lighter">
                  {compactNumber(row.overheal ?? 0)}
                </span>
              </span>
              <span className="flex flex-col">
                <span className="text-[11px] text-foreground">Absorbs</span>
                <span className="font-semibold tabular-nums text-foreground-lighter">
                  {compactNumber(row.absorbs ?? 0)}
                </span>
              </span>
            </>
          )}
        </span>
      </div>
      <OverTime
        bucketSeconds={bucketSeconds}
        rateLabel={meta.rate}
        series={[
          {
            name: row.name,
            values: row.series,
            color: classColor(row.specId),
          },
          {
            name: 'Raid average per raider',
            values: avg,
            color: MUTED,
            dashed: true,
          },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card">
            <tr>
              <th className="px-2 py-1 text-left font-normal">Ability</th>
              <th className="px-2 py-1 text-left font-normal w-[38%]">
                {kind === 'taken' ? 'Damage taken' : meta.label}
              </th>
              <th className="px-2 py-1 text-right font-normal">{meta.rate}</th>
              {kind !== 'taken' && (
                <th className="px-2 py-1 text-right font-normal">Casts</th>
              )}
              <th className="px-2 py-1 text-right font-normal">Hits</th>
              <th className="px-2 py-1 text-right font-normal">Crit</th>
              {kind === 'healing' && (
                <th className="px-2 py-1 text-right font-normal">Overheal</th>
              )}
              <th className="px-2 py-1 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody>
            {row.abilities.map((a) => {
              const duration = row.series.length * bucketSeconds;
              return (
                <tr
                  key={a.spellId}
                  className="border-b border-card/40 hover:bg-card/30"
                >
                  <td className="px-2 py-1 whitespace-nowrap">
                    <AbilityName
                      name={a.name}
                      spellId={a.spellId > 1 ? a.spellId : null}
                      encounterId={kind === 'taken' ? encounterId : undefined}
                      difficultyId={difficultyId}
                      className="text-foreground-lighter"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <span className="flex items-center gap-x-2">
                      <span
                        className="h-[10px] rounded-r-[4px]"
                        style={{
                          width: `${(a.total / top) * 80}%`,
                          minWidth: 3,
                          background: classColor(row.specId),
                          opacity: 0.85,
                        }}
                      />
                      <span className="text-xs tabular-nums text-foreground">
                        {compactNumber(a.total)}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {compactNumber(duration ? a.total / duration : 0)}
                  </td>
                  {kind !== 'taken' && (
                    <td className="px-2 py-1 text-right tabular-nums text-foreground">
                      {a.casts || '–'}
                    </td>
                  )}
                  <td className="px-2 py-1 text-right tabular-nums text-foreground">
                    {a.hits}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-foreground">
                    {a.hits ? `${Math.round((a.crits / a.hits) * 100)}%` : '–'}
                  </td>
                  {kind === 'healing' && (
                    <td className="px-2 py-1 text-right tabular-nums text-foreground">
                      {a.overheal
                        ? `${Math.round((a.overheal / (a.overheal + a.total)) * 100)}%`
                        : '–'}
                    </td>
                  )}
                  <td className="px-2 py-1 text-right tabular-nums text-foreground">
                    {row.total
                      ? `${((a.total / row.total) * 100).toFixed(1)}%`
                      : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** The meters for one pull. */
const PullMeters = ({
  pullId,
  encounterId,
  difficultyId,
}: {
  pullId: string;
  encounterId?: number;
  difficultyId?: number;
}) => {
  const [data, setData] = React.useState<MetersData | null>(null);
  const [error, setError] = React.useState('');
  const [loadedId, setLoadedId] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('damage');
  const [who, setWho] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    call<MetersData>({ action: 'meters', id: pullId }).then((response) => {
      if (cancelled) return;
      setLoadedId(pullId);
      if (!response.ok) {
        setError(response.error);
        setData(null);
        return;
      }
      setError('');
      setData(response.data);
    });
    return () => {
      cancelled = true;
    };
  }, [pullId]);

  if (loadedId !== pullId) {
    return <p className="text-sm text-foreground">Loading meters…</p>;
  }
  if (!data) {
    return (
      <p className="text-sm text-foreground">
        {error || 'No meters for this pull.'}
      </p>
    );
  }

  const meta = KINDS.find((k) => k.key === kind)!;
  const rows = data[kind];
  const selected = rows.find((r) => r.name === who) ?? null;
  const raidTotal = rows.reduce((n, r) => n + r.total, 0);
  const raidRate = rows.reduce((n, r) => n + r.perSecond, 0);
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <div className="flex rounded-md border border-card overflow-hidden">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`px-3 h-8 text-xs ${
                kind === k.key
                  ? 'bg-brand text-background font-semibold'
                  : 'text-foreground-lighter hover:bg-card/50'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-foreground">
          Raid {meta.rate}{' '}
          <span className="font-semibold text-foreground-lighter tabular-nums">
            {compactNumber(raidRate)}
          </span>{' '}
          · total {compactNumber(raidTotal)}
        </span>
      </div>

      {selected ? (
        <Breakdown
          row={selected}
          kind={kind}
          rows={rows}
          bucketSeconds={data.bucketSeconds}
          encounterId={encounterId}
          difficultyId={difficultyId}
          onBack={() => setWho(null)}
        />
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 items-start">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-foreground border-b border-card">
                <tr>
                  <th className="px-2 py-1 text-left font-normal">Raider</th>
                  <th className="px-2 py-1 text-left font-normal w-[45%]">
                    {meta.label}
                  </th>
                  <th className="px-2 py-1 text-right font-normal">
                    {meta.rate}
                  </th>
                  <th className="px-2 py-1 text-right font-normal">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.name}
                    className="border-b border-card/40 hover:bg-card/30"
                  >
                    <td className="px-2 py-1 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setWho(r.name)}
                        className="font-semibold hover:underline"
                        style={{ color: classColor(r.specId) }}
                        title="Show their abilities"
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-x-2">
                        <span
                          className="h-[12px] rounded-r-[4px]"
                          style={{
                            width: `${(r.total / max) * 80}%`,
                            minWidth: 3,
                            background: classColor(r.specId),
                            opacity: 0.85,
                          }}
                        />
                        <span className="text-xs tabular-nums text-foreground">
                          {compactNumber(r.total)}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-foreground-lighter">
                      {compactNumber(r.perSecond)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-foreground">
                      {raidTotal
                        ? `${((r.total / raidTotal) * 100).toFixed(1)}%`
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-md border border-card bg-background/40 p-3">
            <h4 className="text-sm font-semibold text-foreground-lighter mb-1">
              Raid {meta.rate} over time
            </h4>
            <OverTime
              bucketSeconds={data.bucketSeconds}
              rateLabel={meta.rate}
              series={[{ name: 'Raid', values: sumSeries(rows), color: BRAND }]}
            />
            <p className="text-xs text-foreground mt-1">
              {data.bucketSeconds}-second steps. Click a raider for their
              abilities.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PullMeters;

type NightBoss = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
};
type NightPull = {
  id: string;
  pullNumber: number;
  totalPullNumber?: number;
  result: string;
  bossPercent: number | null;
  duration: number;
  source?: 'app' | 'wcl';
};

const DIFF: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  233: 'Mythic',
};

const nightName = (night: string) =>
  new Date(`${night}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

/**
 * Logs tab: browse a night's pulls and see each one's meters.
 */
export const LogsView = () => {
  const [nights, setNights] = React.useState<
    { night: string; bosses: NightBoss[] }[] | null
  >(null);
  const [night, setNight] = React.useState('');
  const [bosses, setBosses] = React.useState<
    (NightBoss & { pullsList: NightPull[] })[] | null
  >(null);
  const [bossKey, setBossKey] = React.useState('');
  const [pullId, setPullId] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    call<{ nights: { night: string; bosses: NightBoss[] }[] }>({
      action: 'nights',
    }).then((response) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setNights(response.data.nights);
      setNight((n) => n || response.data.nights[0]?.night || '');
    });
  }, []);

  React.useEffect(() => {
    if (!night) return undefined;
    let cancelled = false;
    call<{ bosses: (NightBoss & { pullsList: NightPull[] })[] }>({
      action: 'night',
      night,
    }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setBosses(response.data.bosses);
    });
    return () => {
      cancelled = true;
    };
  }, [night]);

  if (error && !nights) return <p className="text-sm text-red-400">{error}</p>;
  if (!nights) return <p className="text-sm text-foreground">Loading…</p>;
  if (!nights.length)
    return <p className="text-sm text-foreground">No pulls yet.</p>;

  const keyOf = (b: NightBoss) => `${b.encounterId}:${b.difficultyId}`;
  const shownBosses = bosses ?? [];
  const boss =
    shownBosses.find((b) => keyOf(b) === bossKey) ??
    [...shownBosses].sort((a, b) => b.pulls - a.pulls)[0];
  const pulls = [...(boss?.pullsList ?? [])].sort(
    (a, b) => b.pullNumber - a.pullNumber,
  );
  const pull = pulls.find((p) => p.id === pullId) ?? pulls[0];

  const field =
    'bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background';

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-3 flex-wrap">
        <label className="flex items-center gap-x-2 text-sm">
          Night
          <select
            className={field}
            value={night}
            onChange={(e) => {
              setNight(e.target.value);
              setPullId('');
            }}
          >
            {nights.map((n) => (
              <option key={n.night} value={n.night}>
                {nightName(n.night)} ·{' '}
                {n.bosses.map((b) => b.encounterName).join(', ')}
              </option>
            ))}
          </select>
        </label>
        {boss && (
          <label className="flex items-center gap-x-2 text-sm">
            Boss
            <select
              className={field}
              value={keyOf(boss)}
              onChange={(e) => {
                setBossKey(e.target.value);
                setPullId('');
              }}
            >
              {shownBosses.map((b) => (
                <option key={keyOf(b)} value={keyOf(b)}>
                  {b.encounterName} ({DIFF[b.difficultyId] ?? b.difficultyId})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {boss && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
          <div className="rounded-md border border-card bg-background/40 flex flex-col max-h-[70vh] overflow-y-auto">
            {pulls.map((p) => {
              const active = pull?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPullId(p.id)}
                  className={`flex items-center gap-x-2 px-3 py-2 text-sm text-left border-b border-card/40 ${
                    active
                      ? 'bg-brand/15 text-foreground-lighter'
                      : 'hover:bg-card/30'
                  }`}
                >
                  <span className="font-semibold tabular-nums w-14">
                    Pull {p.pullNumber}
                  </span>
                  <span
                    className={`tabular-nums ${
                      p.result === 'kill' ? 'text-green-400' : 'text-foreground'
                    }`}
                  >
                    {p.result === 'kill'
                      ? 'Kill'
                      : p.bossPercent !== null
                        ? `${p.bossPercent}%`
                        : 'Wipe'}
                  </span>
                  <span className="ml-auto text-xs text-foreground tabular-nums">
                    {mmss(p.duration)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-w-0">
            {pull ? (
              pull.source === 'wcl' ? (
                <p className="text-sm text-foreground">
                  This pull was imported from Warcraft Logs, so there&apos;s no
                  log here to build meters from.
                </p>
              ) : (
                <PullMeters
                  key={pull.id}
                  pullId={pull.id}
                  encounterId={boss.encounterId}
                  difficultyId={boss.difficultyId}
                />
              )
            ) : (
              <p className="text-sm text-foreground">No pulls.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
