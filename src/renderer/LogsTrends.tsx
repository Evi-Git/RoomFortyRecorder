import React from 'react';
import { getSpecClass, getWoWClassColor } from './rendererutils';

/**
 * [RoomFortyRecorder] Logs → Trends: the raid's and each raider's DPS, HPS,
 * or damage taken night by night on one boss, from the
 * stored meters. Only kills count (the first kill, then every reclear), so
 * weeks compare like with like.
 */

const ipc = window.electron.ipcRenderer;
type Response<T> = { ok: true; data: T } | { ok: false; error: string };
const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

type Kind = 'damage' | 'healing' | 'taken';
const KINDS: { key: Kind; label: string; rate: string }[] = [
  { key: 'damage', label: 'Damage done', rate: 'DPS' },
  { key: 'healing', label: 'Healing', rate: 'HPS' },
  { key: 'taken', label: 'Damage taken', rate: 'DTPS' },
];

type NightTotals = {
  night: string;
  pulls: number;
  kills: number;
  seconds: number;
  raid: Partial<Record<Kind, number>>;
  /** Pulls up to the first kill, or (after it) kills only. */
  phase?: 'first' | 'kills';
};
type RaiderNight = { seconds: number; pulls: number } & Partial<
  Record<Kind, number>
>;
type Trends = {
  nights: NightTotals[];
  raiders: {
    name: string;
    specId: number;
    nights: Record<string, RaiderNight>;
  }[];
};
type BossOption = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
};

const DIFF: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  233: 'Mythic',
};

const compact = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(2)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
        : String(Math.round(n));

const shortNight = (night: string) =>
  new Date(`${night}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

const classColor = (specId: number) =>
  getWoWClassColor(getSpecClass(specId)) || 'hsl(var(--foreground-lighter))';

const BRAND = 'hsl(var(--brand))';

/** Lines over nights: the raid (per raider) and any picked raiders. */
const TrendChart = ({
  nights,
  series,
  rate,
}: {
  nights: string[];
  series: {
    name: string;
    values: (number | null)[];
    color: string;
    dashed?: boolean;
  }[];
  rate: string;
}) => {
  const box = React.useRef<HTMLDivElement>(null);
  const [W, setW] = React.useState(640);
  const [hover, setHover] = React.useState<number | null>(null);
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
  const left = 52;
  const right = 16;
  const top = 10;
  const bottom = 26;
  const max = Math.max(
    1,
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
  );
  const x = (i: number) =>
    left +
    (nights.length <= 1 ? 0.5 : i / (nights.length - 1)) * (W - left - right);
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  return (
    <div ref={box} className="relative">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`${rate} by night`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          const i = Math.round(
            ((px - left) / (W - left - right)) * (nights.length - 1),
          );
          setHover(Math.min(nights.length - 1, Math.max(0, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={left}
              x2={W - right}
              y1={y(f * max)}
              y2={y(f * max)}
              stroke="hsl(var(--card))"
            />
            <text
              x={left - 6}
              y={y(f * max) + 4}
              textAnchor="end"
              fontSize="11"
              fill="hsl(var(--foreground))"
            >
              {compact(f * max)}
            </text>
          </g>
        ))}
        {nights.map((n, i) => (
          <text
            key={n}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="11"
            fill="hsl(var(--foreground))"
          >
            {shortNight(n)}
          </text>
        ))}
        {series.map((s) => {
          const points = s.values
            .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(' ');
          return (
            <g key={s.name}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dashed ? '4 3' : undefined}
                points={points}
              />
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle
                    key={nights[i]}
                    cx={x(i)}
                    cy={y(v)}
                    r="4"
                    fill={s.color}
                    stroke="hsl(var(--background))"
                    strokeWidth="2"
                  />
                ),
              )}
            </g>
          );
        })}
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
            left: x(hover),
            transform:
              x(hover) > W / 2
                ? 'translateX(calc(-100% - 8px))'
                : 'translateX(8px)',
          }}
        >
          <div className="text-foreground">{shortNight(nights[hover])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-x-1.5">
              <span
                className="inline-block w-2.5 h-0.5"
                style={{ background: s.color }}
              />
              <span className="text-foreground-lighter">{s.name}</span>
              <span className="ml-auto pl-2 tabular-nums text-foreground-lighter">
                {s.values[hover] === null
                  ? '–'
                  : `${compact(s.values[hover] as number)} ${rate}`}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground mt-1">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-x-1.5">
            <span
              className="inline-block w-3.5 h-0.5"
              style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }}
            />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
};

const MAX_LINES = 6;

export const LogsTrends = () => {
  const [bosses, setBosses] = React.useState<BossOption[] | null>(null);
  const [boss, setBoss] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('damage');
  const [data, setData] = React.useState<Trends | null>(null);
  const [loadedBoss, setLoadedBoss] = React.useState('');
  const [error, setError] = React.useState('');
  const [lines, setLines] = React.useState<string[]>([]);

  React.useEffect(() => {
    call<{ nights: { night: string; bosses: BossOption[] }[] }>({
      action: 'nights',
    }).then((response) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const seen = new Map<string, BossOption>();
      response.data.nights.forEach((n) =>
        n.bosses.forEach((b) => {
          const key = `${b.encounterId}:${b.difficultyId}`;
          if (!seen.has(key)) seen.set(key, b);
        }),
      );
      // Mythic first, newest first.
      const list = [...seen.values()].sort(
        (a, b) =>
          Number(b.difficultyId === 16 || b.difficultyId === 233) -
          Number(a.difficultyId === 16 || a.difficultyId === 233),
      );
      setBosses(list);
      setBoss(
        (current) =>
          current ||
          (list[0] ? `${list[0].encounterId}:${list[0].difficultyId}` : ''),
      );
    });
  }, []);

  React.useEffect(() => {
    if (!boss) return undefined;
    const [encounterId, difficultyId] = boss.split(':').map(Number);
    let cancelled = false;
    call<Trends>({ action: 'metersTrends', encounterId, difficultyId }).then(
      (response) => {
        if (cancelled) return;
        setLoadedBoss(boss);
        if (!response.ok) {
          setError(response.error);
          setData(null);
          return;
        }
        setError('');
        setData(response.data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boss]);

  if (error && !bosses) return <p className="text-sm text-red-400">{error}</p>;
  if (!bosses) return <p className="text-sm text-foreground">Loading…</p>;

  const meta = KINDS.find((k) => k.key === kind)!;
  const nights = data?.nights.map((n) => n.night) ?? [];
  const rateOf = (n: RaiderNight | undefined) =>
    n && n.seconds && n[kind] ? (n[kind] as number) / n.seconds : null;
  const rows = (data?.raiders ?? [])
    .map((r) => {
      const values = nights.map((night) => rateOf(r.nights[night]));
      const present = values.filter((v): v is number => v !== null);
      const first = present[0];
      const last = present[present.length - 1];
      return {
        ...r,
        values,
        avg: present.reduce((n, v) => n + v, 0) / Math.max(1, present.length),
        change: present.length >= 2 && first ? (last - first) / first : null,
        best: Math.max(0, ...present),
      };
    })
    .filter((r) => r.values.some((v) => v !== null))
    .sort((a, b) => b.avg - a.avg);
  // The raid's rate per raider, night by night (fair across roster sizes).
  const perRaider = nights.map((night, i) => {
    const n = data?.nights[i];
    const raiders = rows.filter((r) => r.values[i] !== null).length;
    // Raid total over the night's pull time, shared across its raiders.
    return n && n.seconds && raiders
      ? (n.raid[kind] ?? 0) / n.seconds / raiders
      : null;
  });
  const series = [
    {
      name: 'Raid average per raider',
      values: perRaider,
      color: BRAND,
      dashed: true,
    },
    ...rows
      .filter((r) => lines.includes(r.name))
      .map((r) => ({
        name: r.name,
        values: r.values,
        color: classColor(r.specId),
      })),
  ];

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-3 flex-wrap">
        <label className="flex items-center gap-x-2 text-sm">
          Boss
          <select
            className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
            value={boss}
            onChange={(e) => {
              setBoss(e.target.value);
              setLines([]);
            }}
          >
            {bosses.map((b) => (
              <option
                key={`${b.encounterId}:${b.difficultyId}`}
                value={`${b.encounterId}:${b.difficultyId}`}
              >
                {b.encounterName} ({DIFF[b.difficultyId] ?? b.difficultyId})
              </option>
            ))}
          </select>
        </label>
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
      </div>

      {loadedBoss !== boss && (
        <p className="text-sm text-foreground">Loading…</p>
      )}
      {loadedBoss === boss && (!data || !nights.length) && (
        <p className="text-sm text-foreground">
          No meters for this boss yet. They come from the app (1.9.30 or newer).
        </p>
      )}
      {loadedBoss === boss && data && nights.length > 0 && (
        <>
          <div className="rounded-md border border-card bg-background/40 p-3">
            <h4 className="text-sm font-semibold text-foreground-lighter mb-1">
              Whole raid: {meta.rate} by night
            </h4>
            <TrendChart
              nights={nights}
              rate={meta.rate}
              series={[
                {
                  name: `Raid ${meta.rate}`,
                  values: data.nights.map((n) =>
                    n.seconds ? (n.raid[kind] ?? 0) / n.seconds : null,
                  ),
                  color: BRAND,
                },
              ]}
            />
            <div className="overflow-x-auto mt-2">
              <table className="text-sm border-separate border-spacing-[2px]">
                <tbody>
                  {(
                    [
                      [
                        'Kill',
                        (n: NightTotals) =>
                          n.phase === 'first' ? 'First kill' : 'Reclear',
                      ],
                      ['Kills', (n: NightTotals) => String(n.kills)],
                      [
                        'Fight time',
                        (n: NightTotals) =>
                          `${Math.floor(n.seconds / 60)}:${String(Math.round(n.seconds % 60)).padStart(2, '0')}`,
                      ],
                      [
                        `Raid ${meta.rate}`,
                        (n: NightTotals) =>
                          n.seconds
                            ? compact((n.raid[kind] ?? 0) / n.seconds)
                            : '–',
                      ],
                      ['Total', (n: NightTotals) => compact(n.raid[kind] ?? 0)],
                    ] as [string, (n: NightTotals) => string][]
                  ).map(([label, value]) => (
                    <tr key={label}>
                      <td className="px-2 py-0.5 text-xs text-foreground whitespace-nowrap">
                        {label}
                      </td>
                      {data.nights.map((n) => (
                        <td
                          key={n.night}
                          className="px-2 py-0.5 text-right tabular-nums text-foreground-lighter min-w-[72px] whitespace-nowrap"
                        >
                          {value(n)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td />
                    {data.nights.map((n) => (
                      <td
                        key={n.night}
                        className="px-2 text-right text-[10px] text-foreground"
                      >
                        {shortNight(n.night)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-md border border-card bg-background/40 p-3">
            <h4 className="text-sm font-semibold text-foreground-lighter mb-1">
              Per raider: {meta.rate} by night
            </h4>
            <TrendChart nights={nights} series={series} rate={meta.rate} />
            <p className="text-xs text-foreground mt-1 mb-0">
              Click raiders below to add their line (up to {MAX_LINES}).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm border-separate border-spacing-[2px]">
              <thead className="text-xs text-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-normal">Raider</th>
                  {data.nights.map((n) => (
                    <th
                      key={n.night}
                      className="px-2 py-1 text-right font-normal whitespace-nowrap"
                    >
                      <div>{shortNight(n.night)}</div>
                      <div className="text-[10px]">
                        {n.phase === 'first'
                          ? 'first kill'
                          : `${n.kills} kill${n.kills > 1 ? 's' : ''}`}
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-normal">Average</th>
                  <th
                    className="px-2 py-1 text-right font-normal"
                    title="Last night they were in against the first"
                  >
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = lines.includes(r.name);
                  return (
                    <tr key={r.name}>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((list) =>
                              list.includes(r.name)
                                ? list.filter((n) => n !== r.name)
                                : list.length < MAX_LINES
                                  ? [...list, r.name]
                                  : list,
                            )
                          }
                          className={`font-semibold hover:underline ${on ? 'underline' : ''}`}
                          style={{ color: classColor(r.specId) }}
                          title={
                            on
                              ? 'Remove their line'
                              : 'Add their line to the chart'
                          }
                        >
                          {r.name}
                        </button>
                      </td>
                      {r.values.map((v, i) => (
                        <td
                          key={nights[i]}
                          className="px-2 py-1 text-right tabular-nums rounded-[3px] min-w-[64px]"
                          style={{
                            background:
                              v && r.best
                                ? `hsl(var(--brand) / ${Math.max(0.04, (v / r.best - 0.6) * 0.9)})`
                                : undefined,
                            color: v
                              ? 'hsl(var(--foreground-lighter))'
                              : 'hsl(var(--foreground) / 0.4)',
                          }}
                        >
                          {v ? compact(v) : '–'}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-semibold text-foreground-lighter">
                        {compact(r.avg)}
                      </td>
                      <td
                        className={`px-2 py-1 text-right tabular-nums ${
                          r.change === null
                            ? 'text-foreground/50'
                            : (kind === 'taken' ? r.change < 0 : r.change > 0)
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}
                      >
                        {r.change === null
                          ? '–'
                          : `${r.change > 0 ? '+' : ''}${Math.round(r.change * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-foreground m-0">
            Only kills count: the first kill, then every reclear, so weeks
            compare like with like. {meta.rate} over the kills&apos; fight time.
            Shading: each raider against their own best night. Change: their
            last night against their first
            {kind === 'taken' ? ' (less damage taken is green)' : ''}.
          </p>
        </>
      )}
    </div>
  );
};

export default LogsTrends;
