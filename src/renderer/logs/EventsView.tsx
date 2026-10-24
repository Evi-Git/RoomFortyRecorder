import React from 'react';
import { abilityOk, Ctx, enemyOk, rowOf, scan } from './query';
import { F, K, KIND_NAMES, MISS_TYPES, POWER_NAMES, PullStore } from './store';
import { classColor, compact, ENEMY_COLOR, mmssms, thousands } from './format';

/**
 * [RoomFortyRecorder] Logs page Events: every event behind the current tab
 * and filters, in order. Click one to watch that moment.
 */

export type EventTab =
  | 'summary'
  | 'damage'
  | 'taken'
  | 'healing'
  | 'prevented'
  | 'buffs'
  | 'debuffs'
  | 'interrupts'
  | 'dispels'
  | 'resources'
  | 'casts';

const KINDS_FOR: Record<EventTab, number[] | null> = {
  summary: null,
  damage: [K.DMG, K.MISS],
  taken: [K.DMG, K.MISS],
  prevented: [K.DMG],
  healing: [K.HEAL, K.ABSORB],
  buffs: [K.APPLY, K.REMOVE, K.DOSE],
  debuffs: [K.APPLY, K.REMOVE, K.DOSE],
  interrupts: [K.INTERRUPT],
  dispels: [K.DISPEL],
  resources: [K.ENERGIZE],
  casts: [K.CAST, K.BEGIN],
};

const MAX_EVENTS = 250000;
const ROW = 22;

const unitColor = (p: PullStore, unit: number) => {
  if (unit < 0) return 'hsl(var(--foreground))';
  const u = p.units[p.units[unit].root];
  return u.player ? classColor(u.specId) : ENEMY_COLOR;
};

/** Which events the tab and filters show. */
export const matchEvents = (ctx: Ctx, tab: EventTab, who: string | null) => {
  const pulls: number[] = [];
  const idx: number[] = [];
  const friendly = ctx.filters.side === 'friendly';
  const raider = (p: PullStore, u: number) =>
    u >= 0 && p.units[p.units[u].root].raider;
  scan(
    ctx,
    (p, i, _at, pi) => {
      if (idx.length >= MAX_EVENTS) return;
      const s = p.s[i];
      const d = p.d[i];
      const kind = p.k[i];
      const debuff = (p.f[i] & F.DEBUFF) !== 0;
      switch (tab) {
        case 'damage':
          if (
            friendly
              ? !raider(p, s) || raider(p, d)
              : raider(p, s) || !raider(p, d)
          )
            return;
          break;
        case 'taken':
        case 'prevented':
          if (friendly ? !raider(p, d) : raider(p, d)) return;
          break;
        case 'healing':
          if (friendly !== raider(p, s)) return;
          break;
        case 'buffs':
          if (debuff || friendly !== raider(p, d)) return;
          break;
        case 'debuffs':
          if (!debuff || friendly !== raider(p, d)) return;
          break;
        case 'interrupts':
        case 'dispels':
        case 'resources':
        case 'casts':
          if (friendly !== raider(p, kind === K.ENERGIZE ? d : s)) return;
          break;
        default:
          break;
      }
      if (ctx.filters.enemy) {
        const enemyS = s >= 0 && !p.units[p.units[s].root].raider;
        const enemyD = d >= 0 && !p.units[p.units[d].root].raider;
        if (!(enemyS && enemyOk(ctx, p, s)) && !(enemyD && enemyOk(ctx, p, d)))
          return;
      }
      if (!abilityOk(ctx, p.spells[p.sp[i]]?.id)) return;
      if (who) {
        const by =
          tab === 'taken' ||
          tab === 'buffs' ||
          tab === 'debuffs' ||
          tab === 'resources'
            ? d
            : s;
        const ref = rowOf(p, by, ctx.filters.pets);
        if (ref?.key !== who) return;
      }
      pulls.push(pi);
      idx.push(i);
    },
    { kinds: KINDS_FOR[tab] ?? undefined },
  );
  return { pulls, idx, capped: idx.length >= MAX_EVENTS };
};

const describe = (p: PullStore, i: number) => {
  const kind = p.k[i];
  const f = p.f[i];
  const parts: string[] = [];
  switch (kind) {
    case K.DMG: {
      const amount = p.a[i] + p.b[i];
      parts.push(thousands(amount));
      if (f & F.CRIT) parts.push('crit');
      if (f & F.TICK) parts.push('tick');
      if (p.b[i]) parts.push(`${compact(p.b[i])} absorbed`);
      if (p.aux[i] > 0) parts.push(`${compact(p.aux[i])} overkill`);
      if (p.x[i] > amount) parts.push(`${compact(p.x[i] - amount)} mitigated`);
      if (p.hp[i] !== 255) parts.push(`${p.hp[i]}% hp`);
      break;
    }
    case K.HEAL:
      parts.push(thousands(p.a[i] + p.b[i]));
      if (f & F.CRIT) parts.push('crit');
      if (p.x[i]) parts.push(`${compact(p.x[i])} overheal`);
      if (p.hp[i] !== 255) parts.push(`${p.hp[i]}% hp`);
      break;
    case K.ABSORB:
      parts.push(`${thousands(p.a[i])} absorbed`);
      if (p.spells[p.aux[i]]) parts.push(`from ${p.spells[p.aux[i]].name}`);
      break;
    case K.MISS:
      parts.push(MISS_TYPES[p.aux[i]] || 'Miss');
      break;
    case K.DOSE:
      parts.push(`${p.x[i]} stacks`);
      break;
    case K.INTERRUPT:
    case K.DISPEL:
      if (p.spells[p.aux[i]]) parts.push(p.spells[p.aux[i]].name);
      break;
    case K.ENERGIZE:
      parts.push(`+${thousands(p.a[i])} ${POWER_NAMES[p.aux[i]] ?? ''}`);
      if (p.x[i]) parts.push(`${thousands(p.x[i])} wasted`);
      break;
    default:
      break;
  }
  return parts.join(' · ');
};

const kindLabel = (p: PullStore, i: number) => {
  const kind = p.k[i];
  if (kind === K.APPLY) return p.f[i] & F.DEBUFF ? 'Debuff on' : 'Buff on';
  if (kind === K.REMOVE) return p.f[i] & F.DEBUFF ? 'Debuff off' : 'Buff off';
  return KIND_NAMES[kind];
};

const EventsView = ({
  ctx,
  tab,
  who,
  onWatch,
}: {
  ctx: Ctx;
  tab: EventTab;
  who: string | null;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const list = React.useMemo(() => matchEvents(ctx, tab, who), [ctx, tab, who]);
  const [scroll, setScroll] = React.useState({ list, top: 0 });
  const top = scroll.list === list ? scroll.top : 0;
  const box = React.useRef<HTMLDivElement>(null);
  const height = 560;
  const first = Math.max(0, Math.floor(top / ROW) - 10);
  const last = Math.min(list.idx.length, first + Math.ceil(height / ROW) + 20);
  const multi = ctx.pulls.length > 1;

  React.useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [list]);

  return (
    <div className="flex flex-col gap-y-2">
      <div className="text-xs text-foreground">
        {thousands(list.idx.length)} events
        {list.capped ? ' (the first 250,000)' : ''}
        {onWatch ? ' · click one to watch that moment' : ''}
      </div>
      <div
        ref={box}
        className="relative overflow-y-auto rounded-md border border-card bg-background/40 text-xs"
        style={{ height }}
        onScroll={(e) => setScroll({ list, top: e.currentTarget.scrollTop })}
      >
        <div style={{ height: list.idx.length * ROW, position: 'relative' }}>
          {list.idx.slice(first, last).map((i, n) => {
            const pi = list.pulls[first + n];
            const p = ctx.pulls[pi];
            const at = ctx.offsets[pi] + p.t[i];
            const src = p.units[p.s[i]];
            const dst = p.units[p.d[i]];
            const spell = p.spells[p.sp[i]];
            const watchName =
              src && p.units[src.root].player ? p.units[src.root].name : null;
            return (
              <div
                key={`${pi}:${i}`}
                className={`absolute left-0 right-0 flex items-center gap-x-2 px-2 border-b border-card/30 ${
                  onWatch ? 'cursor-pointer hover:bg-card/40' : ''
                }`}
                style={{ top: (first + n) * ROW, height: ROW }}
                onClick={() => onWatch?.(at, watchName)}
              >
                <span className="w-[74px] shrink-0 tabular-nums text-foreground">
                  {mmssms(at)}
                </span>
                {multi && (
                  <span className="w-[56px] shrink-0 text-foreground truncate">
                    {p.label}
                  </span>
                )}
                <span className="w-[74px] shrink-0 text-foreground">
                  {kindLabel(p, i)}
                </span>
                <span
                  className="w-[140px] shrink-0 truncate"
                  style={{ color: unitColor(p, p.s[i]) }}
                >
                  {src?.name || '–'}
                </span>
                <span className="w-[170px] shrink-0 truncate text-foreground-lighter">
                  {spell?.name ?? ''}
                </span>
                <span
                  className="w-[140px] shrink-0 truncate"
                  style={{ color: unitColor(p, p.d[i]) }}
                >
                  {dst?.name ? `→ ${dst.name}` : ''}
                </span>
                <span className="truncate tabular-nums text-foreground-lighter">
                  {describe(p, i)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EventsView;
