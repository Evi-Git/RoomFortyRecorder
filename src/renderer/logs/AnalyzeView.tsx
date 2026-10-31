/**
 * [RoomFortyRecorder] Logs → Analyze (1.9.108): widgets after WoWAnalyzer
 * for one raider in one pull. Each spec has its own layout on this PC
 * (guild presets per spec come later); "+ Add widget" opens the builder.
 */
import React from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import SpellIcon from './SpellIcon';
import { classColor, compact, mmss } from './format';
import { Ctx, raiders } from './query';
import { POWER_NAMES, PullStore } from './store';
import {
  KIND_INFO,
  newWidgetId,
  Result,
  runWidget,
  SpellRef,
  spellChoices,
  starterLayout,
  unitOf,
  WidgetKind,
  WidgetSpec,
} from './analyze';
import { specializationById } from '../../main/constants';

const GOOD = '#7CC47F';
const OK = '#E5A55F';
const BAD = '#E57F7F';
const BRASS = '#CCA85C';
const BLUE = '#6EA8FE';

const layoutKey = (specId: number) => `rf-analyze-layout-${specId}`;
const loadLayout = (specId: number, healer: boolean): WidgetSpec[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey(specId)) || 'null');
    if (Array.isArray(saved)) return saved;
  } catch {
    // Fall through.
  }
  return starterLayout(healer);
};
const saveLayout = (specId: number, list: WidgetSpec[]) => {
  try {
    localStorage.setItem(layoutKey(specId), JSON.stringify(list));
  } catch {
    // Not saved.
  }
};

const specInfo = (id: number) =>
  (
    specializationById as Record<
      number,
      { label: string; name: string; role: string }
    >
  )[id];

const pctColor = (v: number) => {
  if (v >= 0.9) return GOOD;
  return v >= 0.75 ? OK : BAD;
};

const titleOf = (w: WidgetSpec) => {
  if (w.title) return w.title;
  switch (w.kind) {
    case 'cooldownWindow':
      return `${w.spell?.name ?? 'Cooldown'}: what was cast`;
    case 'resourceWaste':
      return w.power !== undefined
        ? `${POWER_NAMES[w.power] ?? 'Resource'} lost at the cap`
        : 'Resource lost at the cap';
    case 'count':
      return w.spells?.length
        ? w.spells.map((s) => s.name).join(', ')
        : `All ${w.what ?? 'casts'}`;
    case 'breakdown':
      return w.metric === 'damage' ? 'Damage by spell' : 'Healing by spell';
    case 'activeTime':
      return 'Active time';
    default:
      return w.spell?.name ?? KIND_INFO[w.kind].name;
  }
};

/** A strip the length of the pull with spans and ticks on it. */
const Strip = ({
  duration,
  spans = [],
  ticks = [],
  base = '#171412',
  span = BRASS,
  tick = '#E6DED1',
  onPick,
}: {
  duration: number;
  spans?: [number, number][];
  ticks?: number[];
  base?: string;
  span?: string;
  tick?: string;
  onPick?: (t: number) => void;
}) => {
  const pct = (t: number) =>
    `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  return (
    <div
      className={`relative h-[18px] rounded-[3px] overflow-hidden ${onPick ? 'cursor-pointer' : ''}`}
      style={{ background: base }}
      onClick={(e) => {
        if (!onPick) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPick(((e.clientX - r.left) / r.width) * duration);
      }}
      role={onPick ? 'button' : undefined}
      title={onPick ? 'Click to watch our VoD there' : undefined}
    >
      {spans.map(([a, b]) => (
        <span
          key={`${a}`}
          className="absolute inset-y-0"
          style={{
            left: pct(a),
            width: `${Math.max(0.3, ((b - a) / duration) * 100)}%`,
            background: span,
          }}
        />
      ))}
      {ticks.map((t) => (
        <span
          key={`t${t}`}
          className="absolute top-0.5 bottom-0.5 w-0.5 -translate-x-1/2"
          style={{ left: pct(t), background: tick }}
        />
      ))}
    </div>
  );
};

const Big = ({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) => (
  <span
    className="text-[28px] leading-none font-bold tabular-nums"
    style={{ color }}
  >
    {children}
  </span>
);
const Note = ({ children }: { children: React.ReactNode }) => (
  <span className="text-xs text-foreground">{children}</span>
);

const WidgetBody = ({
  spec,
  result,
  duration,
  onWatch,
}: {
  spec: WidgetSpec;
  result: Result;
  duration: number;
  onWatch?: (t: number) => void;
}) => {
  switch (result.kind) {
    case 'empty':
      return <Note>{result.reason}</Note>;
    case 'castEfficiency': {
      const idle = result.idle.reduce((s, [a, b]) => s + b - a, 0);
      // On cooldown (brass) everywhere it wasn't ready-but-unused (dark).
      return (
        <>
          <div className="flex items-baseline gap-x-2">
            <Big color={pctColor(result.efficiency)}>
              {`${Math.round(result.efficiency * 100)}%`}
            </Big>
            <Note>
              {`of possible casts · ${result.casts.length} cast${result.casts.length === 1 ? '' : 's'}, about ${result.lost.toFixed(1)} lost`}
            </Note>
          </div>
          <Strip
            duration={duration}
            base={BRASS}
            spans={result.idle}
            span="#171412"
            ticks={result.casts}
            tick="#171412"
            onPick={onWatch}
          />
          <Note>
            {`Brass = on cooldown · dark = ready but not cast (${mmss(idle)}) · cooldown ${Math.round(result.cooldown)} s${
              result.estimated
                ? ' (estimated from the casts; set it in Edit)'
                : ''
            }${result.charges > 1 ? ` · ${result.charges} charges` : ''}`}
          </Note>
        </>
      );
    }
    case 'cooldownWindow': {
      const good = result.windows.filter((w) => w.good).length;
      const graded = Boolean(spec.spells?.length);
      if (spec.show === 'number') {
        return (
          <div className="flex items-baseline gap-x-2">
            <Big
              color={pctColor(
                result.windows.length ? good / result.windows.length : 0,
              )}
            >
              {`${good}/${result.windows.length}`}
            </Big>
            <Note>windows good</Note>
          </div>
        );
      }
      if (spec.show === 'timeline') {
        return (
          <>
            <Strip
              duration={duration}
              spans={result.windows.map((w) => [
                w.at,
                Math.max(w.end, w.at + 1),
              ])}
              span={BRASS}
              onPick={onWatch}
            />
            <Note>{`${result.windows.length} windows${graded ? ` · ${good} good` : ''}`}</Note>
          </>
        );
      }
      if (!result.windows.length) return <Note>Not pressed this pull.</Note>;
      return (
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-[11px] text-foreground text-left">
              <th className="px-2 py-1 font-medium">#</th>
              <th className="px-2 py-1 font-medium">Cast</th>
              <th className="px-2 py-1 font-medium">Ends</th>
              <th className="px-2 py-1 font-medium">Inside</th>
              {graded && <th className="px-2 py-1 font-medium">Grade</th>}
            </tr>
          </thead>
          <tbody>
            {result.windows.map((w, i) => (
              <tr key={w.at} className="border-t border-[#2A2521]">
                <td className="px-2 py-1.5 text-foreground">{i + 1}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {onWatch ? (
                    <button
                      type="button"
                      className="hover:text-brand"
                      onClick={() => onWatch(w.at)}
                      title="Watch our VoD there"
                    >
                      {mmss(w.at)}
                    </button>
                  ) : (
                    mmss(w.at)
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{mmss(w.end)}</td>
                <td className="px-2 py-1.5">
                  {w.casts.length ? (
                    w.casts.map((c, n) => (
                      <span
                        key={c.name}
                        style={{ color: c.good ? BRASS : undefined }}
                      >
                        {`${n ? ', ' : ''}${c.name}${c.count > 1 ? ` ×${c.count}` : ''}`}
                      </span>
                    ))
                  ) : (
                    <span className="text-foreground">nothing</span>
                  )}
                </td>
                {graded && (
                  <td
                    className="px-2 py-1.5"
                    style={{ color: w.good ? GOOD : BAD }}
                  >
                    {w.good ? 'Good' : 'Bad'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'procConsumption': {
      const color = { perfect: BLUE, good: GOOD, wasted: BAD };
      return (
        <>
          <div className="flex gap-2 flex-wrap text-xs">
            {spec.spells?.length ? (
              <span
                className="px-2.5 py-1 rounded-md border"
                style={{ borderColor: BLUE, color: BLUE }}
              >
                <b>{result.perfect}</b> on{' '}
                {spec.spells.map((s) => s.name).join(' / ')}
              </span>
            ) : null}
            <span
              className="px-2.5 py-1 rounded-md border"
              style={{ borderColor: GOOD, color: GOOD }}
            >
              <b>{result.good}</b>{' '}
              {spec.goodSpells?.length
                ? `on ${spec.goodSpells.map((s) => s.name).join(' / ')}`
                : spec.spells?.length
                  ? 'on something else'
                  : 'used'}
            </span>
            <span
              className="px-2.5 py-1 rounded-md border"
              style={{ borderColor: BAD, color: BAD }}
            >
              <b>{result.wasted}</b> wasted
            </span>
          </div>
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {result.procs.map((p, i) => (
              <span
                key={i}
                className="h-3.5 rounded-sm"
                style={{ background: color[p.grade], opacity: 0.8 }}
                title={`${mmss(p.at)}: ${p.grade}${p.by ? ` (${p.by})` : ''}`}
              />
            ))}
          </div>
          <Note>Wasted = it ran out, or a new one overwrote it.</Note>
        </>
      );
    }
    case 'buffUptime':
      return (
        <>
          <div className="flex items-baseline gap-x-2">
            <Big
              color={pctColor(result.uptime)}
            >{`${Math.round(result.uptime * 100)}%`}</Big>
            <Note>uptime</Note>
          </div>
          <Strip
            duration={duration}
            spans={result.windows}
            span={OK}
            onPick={onWatch}
          />
          <Note>
            {`${result.windows.length} window${result.windows.length === 1 ? '' : 's'}${
              result.filled !== null
                ? ` · ${spec.spells?.map((s) => s.name).join(' or ')} cast in ${result.filled}`
                : ''
            }`}
          </Note>
        </>
      );
    case 'resourceWaste':
      return (
        <>
          <div className="flex items-baseline gap-x-2">
            <Big
              color={
                result.gained && result.wasted / result.gained > 0.1
                  ? BAD
                  : undefined
              }
            >
              {result.wasted >= 1000
                ? compact(result.wasted)
                : result.wasted.toFixed(result.wasted % 1 ? 1 : 0)}
            </Big>
            <Note>
              {`${POWER_NAMES[result.power] ?? 'Resource'} lost at the cap${
                result.gained
                  ? ` (${Math.round((result.wasted / result.gained) * 100)}% of ${compact(result.gained)} gained)`
                  : ''
              }`}
            </Note>
          </div>
          {result.byPower.length > 1 && (
            <Note>
              {`Also: ${result.byPower
                .filter(([p]) => p !== result.power)
                .map(
                  ([p, w]) =>
                    `${POWER_NAMES[p] ?? p} ${w >= 1000 ? compact(w) : Math.round(w)}`,
                )
                .join(' · ')}`}
            </Note>
          )}
        </>
      );
    case 'count':
      return (
        <>
          <div className="flex items-baseline gap-x-2">
            <Big>{result.total}</Big>
            <Note>{`${spec.what ?? 'casts'} · ${result.perMinute.toFixed(1)} a minute`}</Note>
          </div>
          {result.total > 0 && (
            <Strip
              duration={duration}
              ticks={result.times}
              tick={BRASS}
              onPick={onWatch}
            />
          )}
          {result.bySpell.length > 1 && (
            <Note>
              {result.bySpell
                .slice(0, 6)
                .map((s) => `${s.name} ${s.count}`)
                .join(' · ')}
            </Note>
          )}
        </>
      );
    case 'breakdown':
      return (
        <div className="flex flex-col gap-y-1">
          {result.rows.slice(0, 8).map((r) => (
            <div
              key={r.name}
              className="grid grid-cols-[minmax(0,1fr)_64px_44px] items-center gap-x-2 text-xs"
            >
              <span className="relative h-5 rounded-sm bg-[#171412] overflow-hidden">
                <span
                  className="absolute inset-y-0 left-0 bg-brand/30"
                  style={{
                    width: `${(r.total / result.rows[0].total) * 100}%`,
                  }}
                />
                <span className="relative flex items-center gap-x-1.5 px-1 h-5">
                  <SpellIcon spellId={r.id} name={r.name} />
                  <span className="truncate">{r.name}</span>
                </span>
              </span>
              <span className="text-right tabular-nums">
                {compact(r.total)}
              </span>
              <span className="text-right tabular-nums text-foreground">{`${(r.share * 100).toFixed(1)}%`}</span>
            </div>
          ))}
        </div>
      );
    case 'activeTime':
      return (
        <>
          <div className="flex items-baseline gap-x-2">
            <Big
              color={pctColor(result.share)}
            >{`${(result.share * 100).toFixed(1)}%`}</Big>
            <Note>{`active · ${mmss(result.active)} of ${mmss(duration)}`}</Note>
          </div>
          <Note>Casting or hitting, with a global cooldown after each.</Note>
        </>
      );
    default:
      return null;
  }
};

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

const input =
  'bg-[#171412] border border-card rounded-md text-foreground-lighter px-2.5 py-1.5 text-[13px] min-h-[34px] box-border';

const SpellField = ({
  value,
  onChange,
  options,
  id,
  placeholder,
}: {
  value?: SpellRef;
  onChange: (v: SpellRef | undefined) => void;
  options: SpellRef[];
  id: string;
  placeholder: string;
}) => (
  <>
    <input
      className={input}
      list={id}
      value={value?.name ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const name = e.target.value;
        const known = options.find(
          (o) => o.name.toLowerCase() === name.trim().toLowerCase(),
        );
        onChange(
          name ? { name: known?.name ?? name, id: known?.id } : undefined,
        );
      }}
    />
    <datalist id={id}>
      {options.map((o) => (
        <option key={`${o.id}${o.name}`} value={o.name} />
      ))}
    </datalist>
  </>
);

const SpellsField = ({
  value = [],
  onChange,
  options,
  id,
  placeholder,
}: {
  value?: SpellRef[];
  onChange: (v: SpellRef[]) => void;
  options: SpellRef[];
  id: string;
  placeholder: string;
}) => {
  const [text, setText] = React.useState('');
  const add = () => {
    const name = text.trim();
    if (!name) return;
    const known = options.find(
      (o) => o.name.toLowerCase() === name.toLowerCase(),
    );
    if (!value.some((v) => v.name.toLowerCase() === name.toLowerCase()))
      onChange([...value, { name: known?.name ?? name, id: known?.id }]);
    setText('');
  };
  return (
    <div className="flex flex-col gap-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={v.name}
              className="flex items-center gap-x-1 rounded-full bg-card px-2 py-0.5 text-xs"
            >
              {v.name}
              <button
                type="button"
                aria-label={`Remove ${v.name}`}
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-x-1.5">
        <input
          className={`${input} flex-1 min-w-0`}
          list={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="px-2.5 rounded-md border border-card text-xs hover:bg-card/50"
        >
          Add
        </button>
      </div>
      <datalist id={id}>
        {options.map((o) => (
          <option key={`${o.id}${o.name}`} value={o.name} />
        ))}
      </datalist>
    </div>
  );
};

const Builder = ({
  initial,
  choices,
  powers,
  specName,
  onSave,
  onClose,
}: {
  initial: WidgetSpec | null;
  choices: { casts: SpellRef[]; buffs: SpellRef[] };
  powers: number[];
  specName: string;
  onSave: (w: WidgetSpec) => void;
  onClose: () => void;
}) => {
  const [w, setW] = React.useState<WidgetSpec>(
    () =>
      initial ?? {
        id: newWidgetId(),
        kind: 'cooldownWindow',
        ends: 'buff',
        show: 'table',
      },
  );
  const set = (patch: Partial<WidgetSpec>) =>
    setW((old) => ({ ...old, ...patch }));
  const label = 'text-xs text-foreground';
  const k = w.kind;
  const all = [
    ...choices.casts,
    ...choices.buffs.filter(
      (b) => !choices.casts.some((c) => c.name === b.name),
    ),
  ];
  const ready =
    k === 'resourceWaste' ||
    k === 'count' ||
    k === 'breakdown' ||
    k === 'activeTime' ||
    Boolean(w.spell?.name);

  return (
    <aside className="flex-[1_1_340px] min-w-0 self-start rounded-[10px] border border-brand bg-[#1E1A17] p-4 flex flex-col gap-y-3.5">
      <div className="flex items-center">
        <h2 className="m-0 text-base font-semibold">
          {initial ? 'Edit widget' : 'New widget'}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ml-auto p-1.5 rounded hover:bg-card/50"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-col gap-y-2">
        <span className={label}>1 · What it measures</span>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(KIND_INFO) as WidgetKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => set({ kind })}
              className={`flex flex-col items-start gap-y-0.5 min-h-[52px] px-2.5 py-2 rounded-md text-left border ${
                k === kind
                  ? 'border-brand bg-[#2A2521]'
                  : 'border-card hover:bg-card/40'
              }`}
            >
              <b className="text-xs">{KIND_INFO[kind].name}</b>
              <span className="text-[11px] text-foreground">
                {KIND_INFO[kind].hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-y-2">
        <span className={label}>2 · Settings</span>
        {k === 'castEfficiency' && (
          <>
            <SpellField
              id="an-cd"
              value={w.spell}
              onChange={(spell) => set({ spell })}
              options={choices.casts}
              placeholder="The cooldown (e.g. Dream Breath)"
            />
            <div className="flex gap-x-2">
              <label className="flex flex-col gap-y-1 flex-1">
                <span className={label}>Cooldown (s, blank: estimate)</span>
                <input
                  className={input}
                  type="number"
                  min={1}
                  value={w.cooldown ?? ''}
                  onChange={(e) =>
                    set({ cooldown: Number(e.target.value) || undefined })
                  }
                />
              </label>
              <label className="flex flex-col gap-y-1 w-24">
                <span className={label}>Charges</span>
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={5}
                  value={w.charges ?? 1}
                  onChange={(e) =>
                    set({ charges: Number(e.target.value) || 1 })
                  }
                />
              </label>
            </div>
          </>
        )}
        {k === 'cooldownWindow' && (
          <>
            <SpellField
              id="an-open"
              value={w.spell}
              onChange={(spell) => set({ spell })}
              options={choices.casts}
              placeholder="Cooldown that opens the window (e.g. Stasis)"
            />
            <span className={label}>Window ends</span>
            <div className="flex gap-x-2 items-center">
              <select
                className={input}
                value={
                  w.ends === undefined || w.ends === 'buff' ? 'buff' : 'fixed'
                }
                onChange={(e) =>
                  set({ ends: e.target.value === 'buff' ? 'buff' : 15 })
                }
              >
                <option value="buff">When its buff ends</option>
                <option value="fixed">After a fixed time</option>
              </select>
              {typeof w.ends === 'number' && (
                <input
                  className={`${input} w-20`}
                  type="number"
                  min={1}
                  value={w.ends}
                  onChange={(e) => set({ ends: Number(e.target.value) || 15 })}
                />
              )}
            </div>
            <span className={label}>
              3 · Good if it holds (leave empty to just list)
            </span>
            <SpellsField
              id="an-good"
              value={w.spells}
              onChange={(spells) => set({ spells })}
              options={choices.casts}
              placeholder="A spell, then Add"
            />
            {Boolean(w.spells?.length) && (
              <label className="flex items-center gap-x-2 text-xs">
                at least
                <input
                  className={`${input} w-16`}
                  type="number"
                  min={1}
                  value={w.min ?? 1}
                  onChange={(e) => set({ min: Number(e.target.value) || 1 })}
                />
                of them
              </label>
            )}
            <span className={label}>Show as</span>
            <div className="flex gap-1.5">
              {(['table', 'timeline', 'number'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set({ show: s })}
                  className={`min-h-[32px] px-2.5 rounded-md border text-xs ${
                    (w.show ?? 'table') === s
                      ? 'border-brand bg-[#2A2521]'
                      : 'border-card'
                  }`}
                >
                  {
                    {
                      table: 'Table of casts',
                      timeline: 'Timeline',
                      number: 'Number',
                    }[s]
                  }
                </button>
              ))}
            </div>
          </>
        )}
        {k === 'procConsumption' && (
          <>
            <SpellField
              id="an-proc"
              value={w.spell}
              onChange={(spell) => set({ spell })}
              options={choices.buffs}
              placeholder="The proc, a buff (e.g. Essence Burst)"
            />
            <span className={label}>Best spent on</span>
            <SpellsField
              id="an-perfect"
              value={w.spells}
              onChange={(spells) => set({ spells })}
              options={choices.casts}
              placeholder="e.g. Emerald Blossom"
            />
            <span className={label}>Fine on</span>
            <SpellsField
              id="an-fine"
              value={w.goodSpells}
              onChange={(goodSpells) => set({ goodSpells })}
              options={choices.casts}
              placeholder="e.g. Echo"
            />
          </>
        )}
        {k === 'buffUptime' && (
          <>
            <SpellField
              id="an-buff"
              value={w.spell}
              onChange={(spell) => set({ spell })}
              options={choices.buffs}
              placeholder="The buff (e.g. Inner Flame)"
            />
            <span className={label}>
              Casts that should land inside (optional)
            </span>
            <SpellsField
              id="an-inside"
              value={w.spells}
              onChange={(spells) => set({ spells })}
              options={choices.casts}
              placeholder="e.g. Dream Breath"
            />
          </>
        )}
        {k === 'resourceWaste' && (
          <select
            className={input}
            value={w.power ?? ''}
            onChange={(e) =>
              set({
                power:
                  e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          >
            <option value="">The one wasted most</option>
            {powers.map((p) => (
              <option key={p} value={p}>
                {POWER_NAMES[p] ?? `Power ${p}`}
              </option>
            ))}
          </select>
        )}
        {k === 'count' && (
          <>
            <select
              className={input}
              value={w.what ?? 'casts'}
              onChange={(e) =>
                set({ what: e.target.value as WidgetSpec['what'] })
              }
            >
              <option value="casts">Casts</option>
              <option value="hits">Hits and heals</option>
              <option value="dispels">Dispels</option>
              <option value="interrupts">Interrupts</option>
            </select>
            <span className={label}>Only these (optional)</span>
            <SpellsField
              id="an-count"
              value={w.spells}
              onChange={(spells) => set({ spells })}
              options={all}
              placeholder="A spell, then Add"
            />
          </>
        )}
        {k === 'breakdown' && (
          <select
            className={input}
            value={w.metric ?? 'healing'}
            onChange={(e) =>
              set({ metric: e.target.value as 'healing' | 'damage' })
            }
          >
            <option value="healing">Healing by spell</option>
            <option value="damage">Damage by spell</option>
          </select>
        )}
        {k === 'activeTime' && <Note>Nothing to set.</Note>}
        <label className="flex flex-col gap-y-1">
          <span className={label}>Title (optional)</span>
          <input
            className={input}
            value={w.title ?? ''}
            placeholder={titleOf(w)}
            onChange={(e) => set({ title: e.target.value || undefined })}
          />
        </label>
      </div>
      <Note>{`Saved in the ${specName} layout on this PC.`}</Note>
      <div className="flex gap-x-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[36px] px-3.5 rounded-md border border-card text-[13px]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onSave(w)}
          className="min-h-[36px] px-4 rounded-md bg-brand text-[#171412] text-[13px] font-semibold disabled:opacity-50"
        >
          {initial ? 'Save' : 'Add widget'}
        </button>
      </div>
    </aside>
  );
};

/* ------------------------------------------------------------------ */
/* The tab                                                             */
/* ------------------------------------------------------------------ */

const AnalyzeView = ({
  ctx,
  onWatch,
}: {
  ctx: Ctx;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const store: PullStore | undefined = ctx.pulls[0];
  const roster = raiders(ctx);
  const [guid, setGuid] = React.useState(() => {
    try {
      return localStorage.getItem('rf-analyze-raider') || '';
    } catch {
      return '';
    }
  });
  const me =
    roster.find((r) => r.guid === guid) ??
    roster.find((r) => r.name === guid) ??
    roster[0];
  const specId = me?.specId ?? 0;
  const spec = specInfo(specId);
  const healer = spec?.role === 'healer';
  const [layouts, setLayouts] = React.useState<Record<number, WidgetSpec[]>>(
    {},
  );
  const list = layouts[specId] ?? loadLayout(specId, healer);
  const update = (next: WidgetSpec[]) => {
    setLayouts((l) => ({ ...l, [specId]: next }));
    saveLayout(specId, next);
  };
  const [editing, setEditing] = React.useState<WidgetSpec | null | 'new'>(null);

  if (!store || !me)
    return <p className="text-sm text-foreground">No raiders in this pull.</p>;
  const unit = unitOf(store, me.guid);
  const choices = spellChoices(store, unit);
  const powers = [...(store.powers.get(unit)?.keys() ?? [])];
  const specName = spec ? `${spec.name} ${spec.label}` : 'this spec';
  const watch = onWatch ? (t: number) => onWatch(t, me.name) : undefined;
  const pick = (g: string) => {
    setGuid(g);
    setEditing(null);
    try {
      localStorage.setItem(
        'rf-analyze-raider',
        roster.find((r) => r.guid === g)?.name ?? g,
      );
    } catch {
      // Not remembered.
    }
  };
  const move = (i: number, by: number) => {
    const next = [...list];
    const [w] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, w);
    update(next);
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex-[999_1_640px] min-w-0 flex flex-col gap-y-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-x-2 px-2.5 py-1.5 rounded-lg border border-card bg-[#1E1A17] text-[13px]">
            Raider
            <select
              className="bg-transparent text-foreground-lighter font-semibold"
              value={me.guid}
              onChange={(e) => pick(e.target.value)}
              style={{ color: classColor(me.specId) }}
            >
              {roster.map((r) => {
                const s = specInfo(r.specId);
                return (
                  <option key={r.guid} value={r.guid}>
                    {`${r.name}${s ? ` · ${s.name} ${s.label}` : ''}`}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="text-xs text-foreground">{`Widgets: ${specName} layout on this PC`}</span>
          {ctx.pulls.length > 1 && (
            <span className="text-xs text-yellow-400">
              Analyze looks at the first pull picked.
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                update(starterLayout(healer));
                setEditing(null);
              }}
              className="min-h-[34px] px-3 rounded-md border border-card bg-[#1E1A17] text-[13px] hover:bg-card/50"
              title="Back to the starting widgets for this spec"
            >
              Reset layout
            </button>
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="flex items-center gap-x-1 min-h-[34px] px-3.5 rounded-md bg-brand text-[#171412] text-[13px] font-semibold"
            >
              <Plus size={14} /> Add widget
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {list.map((w, i) => {
            const result = runWidget(store, me.guid, w);
            const wide =
              (w.kind === 'cooldownWindow' &&
                (w.show ?? 'table') === 'table') ||
              w.kind === 'breakdown';
            return (
              <section
                key={w.id}
                className={`rounded-lg border bg-[#1E1A17] px-4 py-3.5 flex flex-col gap-y-2.5 min-w-0 ${
                  wide ? 'lg:col-span-2' : ''
                } ${editing !== 'new' && editing?.id === w.id ? 'border-brand' : 'border-card'}`}
              >
                <div className="flex items-center gap-x-1.5">
                  <span className="text-[11px] text-foreground uppercase tracking-wide">
                    {w.kind === 'breakdown' && w.metric === 'damage'
                      ? 'Damage breakdown'
                      : KIND_INFO[w.kind].name}
                  </span>
                  <span className="ml-auto flex gap-x-0.5 text-foreground">
                    <button
                      type="button"
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="p-1 rounded hover:bg-card/50 disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      title="Move down"
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                      className="p-1 rounded hover:bg-card/50 disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => setEditing(w)}
                      className="p-1 rounded hover:bg-card/50"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => update(list.filter((x) => x.id !== w.id))}
                      className="p-1 rounded hover:bg-card/50"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <h3 className="m-0 text-[15px] font-semibold text-[#E5C46F] flex items-center gap-x-2">
                  {w.spell && result.kind !== 'empty' && (
                    <SpellIcon spellId={w.spell.id ?? 0} name={w.spell.name} />
                  )}
                  {titleOf(w)}
                </h3>
                <WidgetBody
                  spec={w}
                  result={result}
                  duration={store.duration}
                  onWatch={watch}
                />
              </section>
            );
          })}
        </div>
        {!list.length && (
          <p className="text-sm text-foreground">
            No widgets for {specName} yet: Add widget, or Reset layout for the
            starting ones.
          </p>
        )}
      </div>
      {editing && (
        <Builder
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          choices={choices}
          powers={powers}
          specName={specName}
          onClose={() => setEditing(null)}
          onSave={(w) => {
            const at = list.findIndex((x) => x.id === w.id);
            update(
              at >= 0 ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w],
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
};

export default AnalyzeView;
