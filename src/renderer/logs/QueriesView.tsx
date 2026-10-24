import React from 'react';
import { Trash2 } from 'lucide-react';
import { DAMAGE_REDUCTION } from '../../parsing/PullMeters';
import { compileExpression, EXPRESSION_FIELDS } from './expression';
import { Ctx, scan } from './query';
import { K } from './store';
import { compact, thousands } from './format';
import EventsView from './EventsView';
import ExpressionInput, { Vocabulary } from './ExpressionInput';

/**
 * [RoomFortyRecorder] Logs page Queries: ready-made and saved filter
 * expressions, with what matched added up by ability, source and target,
 * and the matching events underneath.
 */

const LUST_IDS = [2825, 32182, 80353, 264667, 390386, 466904, 444257];
const DEFENSIVES = [
  ...new Set(
    Object.entries(DAMAGE_REDUCTION).flatMap(([id, dr]) =>
      dr.castId ? [Number(id), dr.castId] : [Number(id)],
    ),
  ),
];

export const PRESETS: { name: string; expr: string }[] = [
  { name: 'Deaths', expr: 'type = death' },
  {
    name: 'Big hits on raiders (over 1m)',
    expr: 'type = damage and target.type = player and not source.type = player and amount > 1m',
  },
  {
    name: 'Raiders below 20% health',
    expr: 'type = damage and target.type = player and target.hp >= 0 and target.hp < 20',
  },
  { name: 'Interrupts', expr: 'type = interrupt' },
  { name: 'Dispels', expr: 'type = dispel' },
  {
    name: 'Damage-reduction cooldowns pressed',
    expr: `type = cast and ability.id in (${DEFENSIVES.join(', ')})`,
  },
  {
    name: 'Potions and healthstones',
    expr: 'type = cast and (ability.name ~ "potion" or ability.name ~ "healthstone")',
  },
  {
    name: 'Bloodlust',
    expr: `type = applybuff and ability.id in (${LUST_IDS.join(', ')})`,
  },
  {
    name: 'Boss casts',
    expr: 'type in (cast, begincast) and source.type = npc',
  },
];

const SAVED_KEY = 'rf-logs-queries';
const readSaved = (): { name: string; expr: string }[] => {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const writeSaved = (list: { name: string; expr: string }[]) => {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // Not kept.
  }
};

const Tally = ({
  title,
  rows,
}: {
  title: string;
  rows: [string, number, number][];
}) => (
  <section className="rounded-md border border-card bg-background/40 overflow-hidden">
    <h4 className="m-0 px-3 py-2 text-sm font-semibold text-foreground-lighter bg-card/40">
      {title}
    </h4>
    <table className="w-full text-sm">
      <thead className="text-xs text-foreground border-b border-card">
        <tr>
          <th className="px-2 py-1 text-left font-normal">Name</th>
          <th className="px-2 py-1 text-right font-normal">Count</th>
          <th className="px-2 py-1 text-right font-normal">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 15).map(([name, n, amount]) => (
          <tr key={name} className="border-b border-card/40">
            <td className="px-2 py-1 text-foreground-lighter truncate max-w-[200px]">
              {name || '–'}
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              {thousands(n)}
            </td>
            <td className="px-2 py-1 text-right tabular-nums">
              {amount ? compact(amount) : '–'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

const QueriesView = ({
  ctx,
  vocab,
  onWatch,
}: {
  ctx: Ctx;
  vocab: Vocabulary;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const [text, setText] = React.useState(PRESETS[0].expr);
  const [applied, setApplied] = React.useState(PRESETS[0].expr);
  const [saved, setSaved] = React.useState(readSaved);
  const [name, setName] = React.useState('');

  const compiled = React.useMemo(() => {
    try {
      return { fn: compileExpression(applied), error: '' };
    } catch (error) {
      return { fn: null, error: (error as Error).message };
    }
  }, [applied]);

  const qctx = React.useMemo<Ctx>(
    () => ({ ...ctx, filters: { ...ctx.filters, expr: compiled.fn } }),
    [ctx, compiled.fn],
  );

  const tallies = React.useMemo(() => {
    const by = {
      ability: new Map<string, [number, number]>(),
      source: new Map<string, [number, number]>(),
      target: new Map<string, [number, number]>(),
    };
    if (!compiled.fn) return null;
    scan(qctx, (p, i) => {
      const amount =
        p.k[i] === K.DMG
          ? p.a[i] + p.b[i]
          : p.k[i] === K.HEAL || p.k[i] === K.ABSORB || p.k[i] === K.ENERGIZE
            ? p.a[i]
            : 0;
      const add = (m: Map<string, [number, number]>, key: string) => {
        const e = m.get(key) ?? [0, 0];
        e[0] += 1;
        e[1] += amount;
        m.set(key, e);
      };
      add(by.ability, p.spells[p.sp[i]]?.name ?? '');
      add(by.source, p.units[p.s[i]]?.name ?? '');
      add(by.target, p.units[p.d[i]]?.name ?? '');
    });
    const sorted = (m: Map<string, [number, number]>) =>
      [...m.entries()]
        .map(([k, [n, a]]) => [k, n, a] as [string, number, number])
        .sort((a, b) => b[2] - a[2] || b[1] - a[1]);
    return {
      ability: sorted(by.ability),
      source: sorted(by.source),
      target: sorted(by.target),
    };
  }, [qctx, compiled.fn]);

  const field =
    'bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start">
      <div className="flex flex-col gap-y-3">
        <div className="rounded-md border border-card bg-background/40 overflow-hidden">
          <h4 className="m-0 px-3 py-2 text-xs font-semibold text-foreground bg-card/40">
            Ready-made
          </h4>
          {PRESETS.map((q) => (
            <button
              key={q.name}
              type="button"
              onClick={() => {
                setText(q.expr);
                setApplied(q.expr);
              }}
              className={`block w-full text-left px-3 py-1.5 text-sm border-b border-card/40 ${
                applied === q.expr
                  ? 'bg-brand/15 text-foreground-lighter'
                  : 'hover:bg-card/30'
              }`}
            >
              {q.name}
            </button>
          ))}
        </div>
        <div className="rounded-md border border-card bg-background/40 overflow-hidden">
          <h4 className="m-0 px-3 py-2 text-xs font-semibold text-foreground bg-card/40">
            Saved (on this PC)
          </h4>
          {!saved.length && (
            <p className="text-xs text-foreground m-0 px-3 py-2">None yet.</p>
          )}
          {saved.map((q) => (
            <div
              key={q.name}
              className="flex items-center border-b border-card/40"
            >
              <button
                type="button"
                onClick={() => {
                  setText(q.expr);
                  setApplied(q.expr);
                }}
                className={`flex-1 text-left px-3 py-1.5 text-sm ${
                  applied === q.expr
                    ? 'bg-brand/15 text-foreground-lighter'
                    : 'hover:bg-card/30'
                }`}
              >
                {q.name}
              </button>
              <button
                type="button"
                aria-label={`Delete ${q.name}`}
                onClick={() => {
                  const next = saved.filter((x) => x.name !== q.name);
                  setSaved(next);
                  writeSaved(next);
                }}
                className="px-2 text-foreground hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-y-3 min-w-0">
        <form
          className="flex flex-col gap-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(text);
          }}
        >
          <ExpressionInput
            value={text}
            onChange={setText}
            onApply={setApplied}
            vocab={vocab}
            label="Query"
            placeholder="type = death (? for help)"
            className={`${field} font-mono text-xs w-full h-9`}
          />
          <div className="flex items-center gap-x-2 flex-wrap">
            <button
              type="submit"
              className="px-3 h-8 rounded-md bg-brand text-background text-xs font-semibold"
            >
              Run
            </button>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name to save it as"
              className={`${field} h-8 w-[200px]`}
            />
            <button
              type="button"
              disabled={!name.trim() || !text.trim()}
              onClick={() => {
                const next = [
                  ...saved.filter((q) => q.name !== name.trim()),
                  { name: name.trim(), expr: text },
                ];
                setSaved(next);
                writeSaved(next);
                setName('');
              }}
              className="px-3 h-8 rounded-md border border-card text-xs text-foreground-lighter disabled:opacity-40"
            >
              Save
            </button>
            {compiled.error && (
              <span className="text-xs text-red-400">{compiled.error}</span>
            )}
          </div>
          <p className="text-[11px] text-foreground m-0">
            Fields: {EXPRESSION_FIELDS.join(', ')}. Use = != &gt; &lt; ~
            (contains) and in (…), joined with and / or / not. Numbers take k
            and m (1.5m).
          </p>
        </form>
        {tallies && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            <Tally title="By ability" rows={tallies.ability} />
            <Tally title="By source" rows={tallies.source} />
            <Tally title="By target" rows={tallies.target} />
          </div>
        )}
        {compiled.fn && (
          <EventsView ctx={qctx} tab="summary" who={null} onWatch={onWatch} />
        )}
      </div>
    </div>
  );
};

export default QueriesView;
