import React from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { PullMeta } from './store';
import {
  auraRows,
  castRows,
  Ctx,
  DEFAULT_FILTERS,
  groupAbilities,
  meterRows,
  MeterRow,
  raiders,
  viewSeconds,
} from './query';
import { explainSection, SECTION_TITLES } from './auraSections';
import { loadSpellTexts } from './SpellIcon';
import { thousands } from './format';

/**
 * [RoomFortyRecorder] Compare with Warcraft Logs (owner only): our numbers
 * for the tab in view next to Warcraft Logs' own table for the same fight,
 * row by row, with what each side nests under a row. "Copy for Claude"
 * puts the whole comparison on the clipboard, so calibrating doesn't need
 * screenshots. Warcraft Logs is asked through the guild server.
 */

const ipc = window.electron.ipcRenderer;
type Response<T> = { ok: true; data: T } | { ok: false; error: string };
const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

type Fight = {
  id: number;
  name: string;
  encounterId: number;
  difficulty: number;
  kill: boolean;
  start: number;
  seconds: number;
  percent: number | null;
};
type Fights = {
  code: string;
  title: string;
  fights: Fight[];
  players: { id: number; name: string }[];
};
type WclEntry = {
  name?: string;
  guid?: number;
  id?: number;
  total?: number;
  totalUptime?: number;
  totalUses?: number;
  subentries?: WclEntry[];
};
type WclTable = {
  entries?: WclEntry[];
  auras?: WclEntry[];
  totalTime?: number;
};

/** One line of the comparison. */
export type CompareLine = {
  name: string;
  ours: number | null;
  wcl: number | null;
  /** What each side has under this row. */
  oursParts: string[];
  wclParts: string[];
  /** Buffs: how many times it went on (ours / theirs). */
  oursUses?: number;
  wclUses?: number;
  note?: string;
};

const TYPES: Record<string, string> = {
  damage: 'DamageDone',
  healing: 'Healing',
  taken: 'DamageTaken',
  casts: 'Casts',
  buffs: 'Buffs',
  debuffs: 'Debuffs',
};

const REPORT_KEY = 'rf-wcl-report';
const norm = (name: string) =>
  name
    .replace(/-.*$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const readReport = () => {
  try {
    return localStorage.getItem(REPORT_KEY) ?? '';
  } catch {
    return '';
  }
};
const saveReport = (value: string) => {
  try {
    localStorage.setItem(REPORT_KEY, value);
  } catch {
    // Not kept; fine.
  }
};

/** The fight in a report that is this pull: same boss, closest start. */
export const matchFight = (fights: Fight[], meta: PullMeta | undefined) => {
  if (!meta) return null;
  const same = fights.filter((f) => f.encounterId === meta.encounterId);
  const list = same.length ? same : fights;
  let best: Fight | null = null;
  list.forEach((f) => {
    const d = Math.abs(f.start - meta.startedAt);
    if (
      d < 10 * 60 * 1000 &&
      (!best || d < Math.abs(best.start - meta.startedAt))
    )
      best = f;
  });
  return best as Fight | null;
};

/** Puts both sides' rows together by name, biggest difference first. */
export const pairLines = (
  ours: {
    name: string;
    value: number;
    parts: string[];
    uses?: number;
    note?: string;
    key?: string;
  }[],
  wcl: {
    name: string;
    value: number;
    parts: string[];
    uses?: number;
    key?: string;
  }[],
): CompareLine[] => {
  // Buffs pair by spell ID (Warcraft Logs lists same-named buffs apart);
  // everything else by name. Same-named rows on one side are added up.
  const lines = new Map<string, CompareLine>();
  ours.forEach((o) => {
    const key = o.key ?? norm(o.name);
    const line = lines.get(key);
    if (line) {
      line.ours = (line.ours ?? 0) + o.value;
      line.oursParts.push(...o.parts);
      if (o.uses !== undefined) line.oursUses = (line.oursUses ?? 0) + o.uses;
      return;
    }
    lines.set(key, {
      name: o.name,
      ours: o.value,
      wcl: null,
      oursParts: [...o.parts],
      wclParts: [],
      oursUses: o.uses,
      note: o.note,
    });
  });
  wcl.forEach((w) => {
    const key = w.key ?? norm(w.name);
    const line = lines.get(key);
    if (line) {
      // A buff from before the pull may have no name of ours.
      if (!line.name) line.name = w.name;
      line.wcl = (line.wcl ?? 0) + w.value;
      line.wclParts.push(...w.parts);
      if (w.uses !== undefined) line.wclUses = (line.wclUses ?? 0) + w.uses;
    } else {
      lines.set(key, {
        name: w.name,
        ours: null,
        wcl: w.value,
        oursParts: [],
        wclParts: w.parts,
        wclUses: w.uses,
      });
    }
  });
  const gap = (l: CompareLine) => Math.abs((l.ours ?? 0) - (l.wcl ?? 0));
  return [...lines.values()].sort((a, b) => gap(b) - gap(a));
};

const pctGap = (l: CompareLine) => {
  if (l.ours === null || l.wcl === null) return null;
  if (!l.wcl) return l.ours ? Infinity : 0;
  return ((l.ours - l.wcl) / l.wcl) * 100;
};

const fmt = (n: number | null, uptime: boolean) => {
  if (n === null) return '–';
  if (uptime) return `${n.toFixed(1)}%`;
  return thousands(Math.round(n));
};

/** Tab-separated lines for Claude. `onlyGaps`: leave out rows that agree. */
const linesText = (lines: CompareLine[], uptime: boolean, onlyGaps = false) => {
  const head = uptime
    ? 'name\tours uptime %\twcl uptime %\tours uses\twcl uses\tours ids\twcl ids\tour section (why)'
    : 'name\tours\twcl\tdiff %\tours nests\twcl nests';
  const body = lines
    .filter((l) => {
      if (!onlyGaps) return true;
      const g = pctGap(l);
      if (uptime) {
        const du = Math.abs((l.ours ?? 0) - (l.wcl ?? 0));
        // A use either way is noise (a refresh at the pull's edge).
        return (
          g === null ||
          du > 2 ||
          Math.abs((l.oursUses ?? -99) - (l.wclUses ?? -99)) > 1
        );
      }
      return g === null || Math.abs(g) > 2;
    })
    .map((l) => {
      const g = pctGap(l);
      return uptime
        ? [
            l.name,
            fmt(l.ours, true),
            fmt(l.wcl, true),
            l.oursUses ?? '–',
            l.wclUses ?? '–',
            l.oursParts.join(' '),
            l.wclParts.join(' '),
            l.note ?? '',
          ].join('\t')
        : [
            l.name,
            l.ours === null ? '–' : Math.round(l.ours),
            l.wcl === null ? '–' : Math.round(l.wcl),
            g === null ? '–' : g === Infinity ? 'new' : g.toFixed(1),
            l.oursParts.join('; '),
            l.wclParts.join('; '),
          ].join('\t');
    });
  return { head, body, total: lines.length };
};

/** Our side, for the tab in view. */
const ourSide = (
  ctx: Ctx,
  tab: string,
  rows: MeterRow[],
  who: string | null,
  auraWho: string | null,
  texts: Map<number, string>,
) => {
  if (tab === 'damage' || tab === 'healing' || tab === 'taken') {
    if (!who) {
      return rows.map((r) => ({ name: r.name, value: r.total, parts: [] }));
    }
    const row = rows.find((r) => r.key === who);
    if (!row) return [];
    return groupAbilities([...row.abilities.values()]).map((g) => ({
      name: g.head.name,
      value: g.head.total,
      parts:
        g.parts.length > 1 || g.nested
          ? g.parts.map((a) => `${a.name} ${a.spellId}`)
          : [],
    }));
  }
  if (tab === 'casts') {
    const list = castRows(ctx);
    if (!who)
      return list.map((r) => ({ name: r.name, value: r.total, parts: [] }));
    const row = list.find((r) => r.key === who);
    if (!row) return [];
    const byName = new Map<string, { value: number; parts: string[] }>();
    row.spells.forEach((s) => {
      const e = byName.get(s.name) ?? { value: 0, parts: [] };
      e.value += s.count;
      e.parts.push(`${s.spellId} ×${s.count}`);
      byName.set(s.name, e);
    });
    return [...byName.entries()].map(([name, e]) => ({
      name,
      value: e.value,
      parts: e.parts.length > 1 ? e.parts : [],
    }));
  }
  if (tab === 'buffs' || tab === 'debuffs') {
    const debuffs = tab === 'debuffs';
    const seconds = Math.max(1, viewSeconds(ctx));
    const list = auraRows(ctx, { debuffs, who: auraWho });
    const raid = new Map(
      (auraWho ? auraRows(ctx, { debuffs, who: null }) : list).map((r) => [
        r.spellId,
        r.category,
      ]),
    );
    return list.map((r) => {
      const why = debuffs
        ? null
        : explainSection(
            { ...r, category: raid.get(r.spellId) ?? r.category },
            texts.get(r.spellId) ?? '',
          );
      return {
        name: r.name,
        value: (r.uptime / seconds) * 100,
        parts: [`${r.spellId}`],
        key: `id:${r.spellId}`,
        uses: r.count,
        note: why ? `${SECTION_TITLES[why.section]} (${why.why})` : undefined,
      };
    });
  }
  return [];
};

/** Warcraft Logs' side, from their table. */
const wclSide = (table: WclTable, tab: string, seconds: number) => {
  if (tab === 'buffs' || tab === 'debuffs') {
    const total = table.totalTime ? table.totalTime / 1000 : seconds;
    return (table.auras ?? []).map((a) => ({
      name: String(a.name ?? '?'),
      value: ((a.totalUptime ?? 0) / 1000 / Math.max(1, total)) * 100,
      parts: [`${a.guid ?? ''}`],
      key: a.guid ? `id:${a.guid}` : undefined,
      uses: a.totalUses ?? 0,
    }));
  }
  return (table.entries ?? []).map((e) => ({
    name: String(e.name ?? '?'),
    value: Number(e.total) || 0,
    parts: (e.subentries ?? []).map((s) =>
      `${s.name ?? '?'} ${s.guid ?? ''}`.trim(),
    ),
  }));
};

const WclCompare = ({
  ctx,
  metas,
  tab,
  rows,
  who,
  auraWho,
  whoName,
}: {
  ctx: Ctx;
  metas: PullMeta[];
  tab: string;
  rows: MeterRow[];
  who: string | null;
  auraWho: string | null;
  /** The raider in view, by name (to find them on Warcraft Logs). */
  whoName: string | null;
}) => {
  const [open, setOpen] = React.useState(false);
  const [report, setReport] = React.useState(readReport);
  const [fights, setFights] = React.useState<Fights | null>(null);
  const [fight, setFight] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [texts, setTexts] = React.useState<Map<number, string>>(new Map());
  const type = TYPES[tab];
  const meta = metas.length === 1 ? metas[0] : undefined;
  const source = whoName
    ? (fights?.players.find((p) => norm(p.name) === norm(whoName))?.id ?? null)
    : null;
  const enemies = ctx.filters.side === 'enemy';

  const loadFights = async () => {
    setBusy(true);
    setError('');
    saveReport(report);
    const response = await call<Fights>({ action: 'wclFights', report });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setFights(response.data);
    setFight(matchFight(response.data.fights, meta)?.id ?? null);
  };

  // Their table whenever the fight, tab or raider changes.
  const missing = Boolean(whoName && fights && source === null);
  const want =
    open && fights && fight && type && !missing
      ? JSON.stringify([fights.code, fight, type, source, enemies])
      : '';
  const [result, setResult] = React.useState<{
    key: string;
    table: WclTable | null;
    error: string;
  } | null>(null);
  React.useEffect(() => {
    if (!want) return undefined;
    let cancelled = false;
    const [code, fightId, dataType, sourceId, onEnemies] = JSON.parse(want);
    call<{ table: WclTable }>({
      action: 'wclTable',
      report: code,
      fight: fightId,
      type: dataType,
      source: sourceId,
      hostility: onEnemies ? 'Enemies' : 'Friendlies',
    }).then((response) => {
      if (cancelled) return;
      setResult({
        key: want,
        table: response.ok ? response.data.table : null,
        error: response.ok ? '' : response.error,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [want]);
  const current = result && result.key === want ? result : null;
  const table = current?.table ?? null;
  const asking = Boolean(want) && !current;
  const shownError =
    error ||
    (missing ? `${whoName} isn't in that report.` : '') ||
    current?.error ||
    '';

  // Buff descriptions, for the section each buff lands in.
  React.useEffect(() => {
    if (!open || tab !== 'buffs') return undefined;
    let cancelled = false;
    const ids = auraRows(ctx, { debuffs: false, who: null }).map(
      (r) => r.spellId,
    );
    loadSpellTexts(ids).then((found) => {
      if (cancelled) return;
      setTexts(new Map(ids.map((id) => [id, found.get(id)?.text ?? ''])));
    });
    return () => {
      cancelled = true;
    };
  }, [open, tab, ctx]);

  const uptime = tab === 'buffs' || tab === 'debuffs';
  const lines = React.useMemo(
    () =>
      table
        ? pairLines(
            ourSide(ctx, tab, rows, who, auraWho, texts),
            wclSide(table, tab, viewSeconds(ctx)),
          )
        : [],
    [table, ctx, tab, rows, who, auraWho, texts],
  );
  const picked = fights?.fights.find((f) => f.id === fight);

  const copy = async () => {
    const head = [
      `Compare with Warcraft Logs: ${tab}${whoName ? ` · ${whoName}` : ''}${enemies ? ' · enemies' : ''}`,
      `Pull: ${meta?.label ?? metas.map((m) => m.label).join(' + ')} (encounter ${meta?.encounterId ?? '?'})`,
      `WCL: ${fights?.code ?? '?'} fight ${fight ?? '?'}${picked ? ` (${picked.name}, ${picked.seconds}s, ${picked.kill ? 'kill' : 'wipe'})` : ''}`,
      ctx.filters.range
        ? `Slice: ${ctx.filters.range.join('-')} s`
        : 'Whole fight',
      '',
    ];
    const t = linesText(lines, uptime);
    head.push(t.head);
    const { body } = t;
    await navigator.clipboard.writeText([...head, ...body].join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ---- Compare everything: every tab, the raid and each raider ----
  const [all, setAll] = React.useState<{
    done: number;
    total: number;
    text: string | null;
  } | null>(null);
  const compareAll = async () => {
    if (!fights || !fight) return;
    const clean = (side: 'friendly' | 'enemy'): Ctx => ({
      ...ctx,
      filters: { ...DEFAULT_FILTERS, side },
    });
    const friendly = clean('friendly');
    const foes = clean('enemy');
    const roster = raiders(friendly).filter((r) =>
      fights.players.some((p) => norm(p.name) === norm(r.name)),
    );
    setAll({ done: 0, total: 0, text: null });
    // Buff descriptions first, for the section each buff lands in.
    const allTexts = new Map<number, string>();
    const buffIds = auraRows(friendly, { debuffs: false, who: null }).map(
      (r) => r.spellId,
    );
    const found = await loadSpellTexts(buffIds);
    buffIds.forEach((id) => allTexts.set(id, found.get(id)?.text ?? ''));
    const rowsOf = new Map<string, MeterRow[]>();
    const meter = (c: Ctx, tabName: string) => {
      const key = `${c.filters.side}|${tabName}`;
      if (!rowsOf.has(key))
        rowsOf.set(
          key,
          tabName === 'damage' || tabName === 'healing' || tabName === 'taken'
            ? meterRows(c, tabName)
            : [],
        );
      return rowsOf.get(key) ?? [];
    };
    type Job = {
      title: string;
      tab: string;
      c: Ctx;
      guid: string | null;
      source: number | null;
      enemies: boolean;
    };
    const jobs: Job[] = [];
    // Whole-raid buffs aren't compared: Warcraft Logs adds each buff's
    // uptime up over everyone who had it (often past 100%); each raider's
    // own buffs are compared below.
    ['damage', 'healing', 'taken', 'casts', 'debuffs'].forEach((t) =>
      jobs.push({
        title: `${t} · whole raid`,
        tab: t,
        c: friendly,
        guid: null,
        source: null,
        enemies: false,
      }),
    );
    ['damage', 'taken'].forEach((t) =>
      jobs.push({
        title: `${t} · enemies`,
        tab: t,
        c: foes,
        guid: null,
        source: null,
        enemies: true,
      }),
    );
    roster.forEach((r) => {
      const id =
        fights.players.find((p) => norm(p.name) === norm(r.name))?.id ?? null;
      ['damage', 'healing', 'taken', 'casts', 'buffs'].forEach((t) =>
        jobs.push({
          title: `${t} · ${r.name}`,
          tab: t,
          c: friendly,
          guid: r.guid,
          source: id,
          enemies: false,
        }),
      );
    });
    setAll({ done: 0, total: jobs.length, text: null });
    const out: string[][] = jobs.map(() => []);
    let done = 0;
    let next = 0;
    const work = async () => {
      while (next < jobs.length) {
        const i = next;
        next += 1;
        const job = jobs[i];

        const response = await call<{ table: WclTable }>({
          action: 'wclTable',
          report: fights.code,
          fight,
          type: TYPES[job.tab],
          source: job.source,
          hostility: job.enemies ? 'Enemies' : 'Friendlies',
        });
        const isAura = job.tab === 'buffs' || job.tab === 'debuffs';
        if (!response.ok) {
          out[i] = [`## ${job.title}`, `error: ${response.error}`, ''];
        } else {
          const lines = pairLines(
            ourSide(
              job.c,
              job.tab,
              meter(job.c, job.tab),
              isAura ? null : job.guid,
              isAura ? job.guid : null,
              allTexts,
            ),
            wclSide(response.data.table, job.tab, viewSeconds(job.c)),
          );
          const t = linesText(lines, isAura, true);
          const sum = (pick: (l: CompareLine) => number | null) =>
            lines.reduce((n, l) => n + (pick(l) ?? 0), 0);
          const totals = isAura
            ? ''
            : `; totals ours ${Math.round(sum((l) => l.ours))} vs WCL ${Math.round(sum((l) => l.wcl))}`;
          out[i] = [
            `## ${job.title} (${t.body.length} of ${t.total} rows differ${totals})`,
            ...(t.body.length ? [t.head, ...t.body] : []),
            '',
          ];
        }
        done += 1;
        setAll({ done, total: jobs.length, text: null });
      }
    };
    await Promise.all([work(), work(), work()]);
    const p = fights.fights.find((f) => f.id === fight);
    const text = [
      'Compare everything with Warcraft Logs. Rows within 2% are left out; buff rows within 2 points of uptime and 1 use are left out. Buffs pair by spell ID.',
      `Pull: ${meta?.label ?? metas.map((m) => m.label).join(' + ')} (encounter ${meta?.encounterId ?? '?'})`,
      `WCL: ${fights.code} fight ${fight}${p ? ` (${p.name}, ${p.seconds}s, ${p.kill ? 'kill' : 'wipe'})` : ''}`,
      'Whole fight, no filters, pets counted for their owner.',
      '',
      ...out.flat(),
    ].join('\n');
    setAll({ done, total: jobs.length, text });
  };
  const saveAll = () => {
    if (!all?.text) return;
    const blob = new Blob([all.text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wcl-compare-${fights?.code ?? 'report'}-${fight ?? ''}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const field =
    'h-8 px-2 rounded-md border border-background bg-card text-foreground-lighter text-xs';
  return (
    <div className="rounded-md border border-card bg-card/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-x-1.5 px-3 py-2 text-xs text-foreground hover:text-foreground-lighter"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Compare with Warcraft Logs
        <span className="text-[11px]">(owner only)</span>
      </button>
      {open && (
        <div className="flex flex-col gap-y-2 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${field} w-[420px] max-w-full`}
              value={report}
              placeholder="Warcraft Logs report link"
              onChange={(e) => setReport(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadFights();
              }}
              aria-label="Warcraft Logs report"
            />
            <button
              type="button"
              className={`${field} hover:text-foreground-lighter`}
              onClick={loadFights}
              disabled={busy || !report.trim()}
            >
              Load fights
            </button>
            {fights && (
              <select
                className={field}
                value={fight ?? ''}
                onChange={(e) => setFight(Number(e.target.value) || null)}
                aria-label="Warcraft Logs fight"
              >
                <option value="">Pick a fight</option>
                {fights.fights.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id}. {f.name} · {Math.floor(f.seconds / 60)}:
                    {String(f.seconds % 60).padStart(2, '0')}{' '}
                    {f.kill ? 'kill' : `wipe ${f.percent ?? ''}%`}
                  </option>
                ))}
              </select>
            )}
            {lines.length > 0 && (
              <button
                type="button"
                className={`${field} inline-flex items-center gap-x-1.5 hover:text-foreground-lighter`}
                onClick={copy}
              >
                <Copy size={13} />
                {copied ? 'Copied' : 'Copy for Claude'}
              </button>
            )}
            {fights && fight && (
              <button
                type="button"
                className={`${field} hover:text-foreground-lighter`}
                onClick={compareAll}
                disabled={Boolean(all && !all.text)}
                title="Every tab, for the whole raid and each raider, in one go"
              >
                {all && !all.text
                  ? `Comparing ${all.done}/${all.total}…`
                  : 'Compare everything'}
              </button>
            )}
            {all?.text && (
              <>
                <button
                  type="button"
                  className={`${field} hover:text-foreground-lighter`}
                  onClick={() => navigator.clipboard.writeText(all.text ?? '')}
                >
                  Copy all
                </button>
                <button
                  type="button"
                  className={`${field} hover:text-foreground-lighter`}
                  onClick={saveAll}
                >
                  Save as file
                </button>
              </>
            )}
            {(busy || asking) && (
              <span className="text-xs text-foreground">Asking…</span>
            )}
          </div>
          {!type && (
            <p className="text-xs text-foreground m-0">
              Warcraft Logs has no table for this tab.
            </p>
          )}
          {metas.length > 1 && (
            <p className="text-xs text-foreground m-0">
              Several pulls are ticked: the comparison uses the fight you pick,
              so tick just that pull.
            </p>
          )}
          {shownError && (
            <p className="text-xs text-yellow-400 m-0">{shownError}</p>
          )}
          {lines.length > 0 && (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-foreground border-b border-card sticky top-0 bg-card">
                  <tr>
                    <th className="text-left px-2 py-1">Name</th>
                    <th className="text-right px-2 py-1">Ours</th>
                    <th className="text-right px-2 py-1">Warcraft Logs</th>
                    <th className="text-right px-2 py-1">Diff</th>
                    {uptime && (
                      <th className="text-right px-2 py-1">Uses (ours/WCL)</th>
                    )}
                    <th className="text-left px-2 py-1">
                      {uptime && tab === 'buffs' ? 'Our section' : 'Nested'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const g = pctGap(l);
                    const far = g === null || Math.abs(g) > 5;
                    return (
                      <tr key={l.name} className="border-b border-card/40">
                        <td className="px-2 py-1 text-foreground-lighter">
                          {l.name}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmt(l.ours, uptime)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmt(l.wcl, uptime)}
                        </td>
                        <td
                          className={`px-2 py-1 text-right ${far ? 'text-yellow-400' : 'text-foreground'}`}
                        >
                          {g === null
                            ? l.ours === null
                              ? 'only WCL'
                              : 'only ours'
                            : g === Infinity
                              ? 'new'
                              : `${g > 0 ? '+' : ''}${g.toFixed(1)}%`}
                        </td>
                        {uptime && (
                          <td className="px-2 py-1 text-right">
                            {l.oursUses ?? '–'} / {l.wclUses ?? '–'}
                          </td>
                        )}
                        <td className="px-2 py-1 text-foreground">
                          {uptime && tab === 'buffs'
                            ? l.note
                            : [
                                l.oursParts.length
                                  ? `ours: ${l.oursParts.join(', ')}`
                                  : '',
                                l.wclParts.length
                                  ? `WCL: ${l.wclParts.join(', ')}`
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WclCompare;
