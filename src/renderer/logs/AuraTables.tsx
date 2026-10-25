import React from 'react';
import { AuraCategory, auraRows, AuraRow, Ctx, viewSeconds } from './query';
import { pct, thousands } from './format';
import SpellIcon from './SpellIcon';
import { sortRows, SortTh, useSort } from './sort';
import AuraDetail from './AuraDetail';
import { useViewWindow } from './zoom';

/**
 * [RoomFortyRecorder] Logs page Buffs and Debuffs: uptime tables grouped
 * like Warcraft Logs' (raid cooldowns, externals, personals, raid buffs,
 * consumables...), each row with its uptime drawn across the fight.
 */

const SECTIONS: Record<AuraCategory, string> = {
  raid: 'Raid cooldowns',
  external: 'External cooldowns',
  personal: 'Personal cooldowns',
  raidbuff: 'Raid buffs',
  consumable: 'Consumables',
  mechanic: 'From enemies',
  yours: "The raid's debuffs",
  other: 'Other',
};
const ORDER: AuraCategory[] = [
  'raid',
  'external',
  'personal',
  'mechanic',
  'yours',
  'raidbuff',
  'consumable',
  'other',
];

const th = 'px-2 py-1.5 font-normal whitespace-nowrap';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';

/** The aura's time up, drawn across the fight (or the slice zoomed into). */
const UptimeBar = ({
  spans,
  total,
  bands,
  onPick,
  range,
}: {
  spans: [number, number][];
  total: number;
  bands: [number, number][];
  onPick?: (t: number) => void;
  range: [number, number] | null;
}) => {
  const [v0, v1] = useViewWindow(range, total);
  const len = v1 - v0;
  const left = (t: number) => `${((Math.max(v0, t) - v0) / len) * 100}%`;
  const width = (s: number, e: number) =>
    `${Math.max(0.25, ((Math.min(v1, e) - Math.max(v0, s)) / len) * 100)}%`;
  const inView = ([s, e]: [number, number]) => e > v0 && s < v1;
  return (
    <div
      className={`relative h-3 w-full rounded-sm bg-card/40 ${onPick ? 'cursor-pointer' : ''}`}
      onClick={(e) => {
        if (!onPick) return;
        const box = e.currentTarget.getBoundingClientRect();
        onPick(v0 + ((e.clientX - box.left) / box.width) * len);
      }}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? -1 : undefined}
      aria-label={onPick ? 'Open a recording at this moment' : undefined}
    >
      {bands.filter(inView).map(([s, e]) => (
        <span
          key={`l${s}`}
          className="absolute inset-y-0"
          style={{
            left: left(s),
            width: width(s, e),
            background: 'hsl(200 70% 55% / 0.18)',
          }}
        />
      ))}
      {spans.filter(inView).map(([s, e]) => (
        <span
          key={s}
          className="absolute top-[2px] bottom-[2px] rounded-[2px]"
          style={{
            left: left(s),
            width: width(s, e),
            background: 'hsl(var(--brand))',
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
};

const Section = ({
  title,
  rows,
  seconds,
  total,
  bands,
  debuffs,
  onPick,
  onOpen,
  range,
}: {
  range: [number, number] | null;
  title: string;
  rows: AuraRow[];
  seconds: number;
  total: number;
  bands: [number, number][];
  debuffs: boolean;
  onPick?: (t: number) => void;
  onOpen: (spellId: number) => void;
}) => {
  const [all, setAll] = React.useState(false);
  const [sort, onSort] = useSort('uptime');
  const sorted = sortRows(rows, sort, {
    name: (r) => r.name,
    count: (r) => r.count,
    targets: (r) => r.targets,
    uptime: (r) => r.uptime,
    source: (r) => r.sources[0]?.[0] ?? '',
  });
  const shown = all ? sorted : sorted.slice(0, 15);
  const sh = (label: string, column: string, left = false) => (
    <SortTh
      label={label}
      column={column}
      state={sort}
      onSort={onSort}
      numeric={column !== 'name' && column !== 'source'}
      className={`${th} ${left ? 'text-left' : 'text-right'}`}
    />
  );
  return (
    <section className="rounded-md border border-card bg-background/40 overflow-hidden">
      <h4 className="m-0 px-3 py-2 text-sm font-semibold text-foreground-lighter bg-card/40">
        {title}
        <span className="ml-2 font-normal text-xs text-foreground">
          {rows.length}
        </span>
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[7%]" />
            {debuffs && <col className="w-[7%]" />}
            <col className="w-[8%]" />
            <col />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="text-xs text-foreground border-b border-card">
            <tr>
              {sh('Name', 'name', true)}
              {sh('Count', 'count')}
              {debuffs && sh('Raiders', 'targets')}
              {sh('Uptime', 'uptime')}
              <th className={`${th} text-left`}>Over time</th>
              {sh('Source', 'source', true)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.spellId}
                className="border-b border-card/40 hover:bg-card/30"
              >
                <td className={`${td} text-foreground-lighter truncate`}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.spellId)}
                    className="inline-flex items-center gap-x-2 max-w-full hover:underline text-left"
                    title="See who had it, when, and its stacks"
                  >
                    <SpellIcon spellId={r.spellId} name={r.name} />
                    <span className="truncate">{r.name}</span>
                  </button>
                </td>
                <td className={`${td} text-right`}>{thousands(r.count)}</td>
                {debuffs && <td className={`${td} text-right`}>{r.targets}</td>}
                <td className={`${td} text-right text-foreground-lighter`}>
                  {pct(r.uptime, seconds)}
                </td>
                <td className="px-2 py-1">
                  <UptimeBar
                    spans={r.spans}
                    total={total}
                    bands={bands}
                    onPick={onPick}
                    range={range}
                  />
                </td>
                <td
                  className={`${td} text-xs text-foreground max-w-[240px] truncate`}
                >
                  {r.sources.length
                    ? r.sources
                        .slice(0, 3)
                        .map(([name]) => name)
                        .join(', ') +
                      (r.sources.length > 3 ? ` +${r.sources.length - 3}` : '')
                    : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 15 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="w-full py-1.5 text-xs text-brand hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
};

const AuraTables = ({
  ctx,
  debuffs,
  who,
  bands,
  boundaries,
  range,
  setRange,
  onPick,
  setWho,
}: {
  ctx: Ctx;
  debuffs: boolean;
  who: string | null;
  bands: [number, number][];
  boundaries: { t: number; label: string }[];
  range: [number, number] | null;
  setRange: (r: [number, number] | null) => void;
  onPick?: (t: number) => void;
  /** Look at one raider's auras (null: everyone's). */
  setWho?: (guid: string | null) => void;
}) => {
  const rows = React.useMemo(
    () => auraRows(ctx, { debuffs, who }),
    [ctx, debuffs, who],
  );
  // The aura opened up (per tab and side).
  const [opened, setOpened] = React.useState<{
    key: string;
    spellId: number;
  } | null>(null);
  const openKey = `${debuffs}|${ctx.filters.side}`;
  const seconds = viewSeconds(ctx);
  if (opened && opened.key === openKey) {
    // The picker: what the raider in view (or anyone) had, by section.
    const groups = ORDER.map((cat) => ({
      title: SECTIONS[cat],
      options: rows
        .filter((r) => r.category === cat)
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((r) => ({ id: r.spellId, name: r.name })),
    })).filter((g) => g.options.length);
    return (
      <AuraDetail
        groups={groups}
        onSwitch={(spellId) => setOpened({ key: openKey, spellId })}
        setWho={setWho}
        ctx={ctx}
        spellId={opened.spellId}
        debuffs={debuffs}
        who={who}
        bands={bands}
        boundaries={boundaries}
        range={range}
        setRange={setRange}
        onPick={onPick}
        onBack={() => setOpened(null)}
      />
    );
  }
  if (!rows.length) {
    return (
      <p className="text-sm text-foreground">
        Nothing here with these filters.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-y-3">
      {ORDER.map((cat) => {
        const list = rows.filter((r) => r.category === cat);
        if (!list.length) return null;
        return (
          <Section
            key={cat}
            title={SECTIONS[cat]}
            rows={list}
            seconds={seconds}
            total={ctx.total}
            bands={bands}
            debuffs={debuffs && ctx.filters.side === 'friendly'}
            onPick={onPick}
            onOpen={(spellId) => setOpened({ key: openKey, spellId })}
            range={range}
          />
        );
      })}
      <p className="text-xs text-foreground m-0">
        Uptime: time it was on {who ? 'them' : 'anyone'} in the part of the
        fight you&apos;re looking at. Cooldowns are spells their caster pressed
        now and then; raid cooldowns reached several raiders at once. Click a
        bar to watch that moment, or a name to open it up.
      </p>
    </div>
  );
};

export default AuraTables;
