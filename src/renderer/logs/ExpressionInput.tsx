import React from 'react';
import { HelpCircle } from 'lucide-react';
import { TYPE_NAMES } from './expression';
import { K, PullStore } from './store';

/**
 * [RoomFortyRecorder] Logs page filter expression box: suggests what can
 * come next (fields, operators, the pull's ability and unit names, and/or)
 * as you type, and has a cheat sheet with every field and some examples.
 */

export type Vocabulary = { abilities: string[]; units: string[] };

/** Ability and unit names in the pulls, most used first. */
export const vocabularyOf = (pulls: PullStore[]): Vocabulary => {
  const abilities = new Map<string, number>();
  const units = new Map<string, number>();
  pulls.forEach((p) => {
    for (let i = 0; i < p.n; i += 1) {
      const kind = p.k[i];
      if (kind === K.APPLY || kind === K.REMOVE || kind === K.DOSE) continue;
      const spell = p.spells[p.sp[i]];
      if (spell?.name)
        abilities.set(spell.name, (abilities.get(spell.name) ?? 0) + 1);
      const s = p.units[p.s[i]];
      if (s?.name) units.set(s.name, (units.get(s.name) ?? 0) + 1);
      const d = p.units[p.d[i]];
      if (d?.name) units.set(d.name, (units.get(d.name) ?? 0) + 1);
    }
  });
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  return { abilities: sorted(abilities), units: sorted(units) };
};

export const FIELD_HELP: [string, string, string][] = [
  [
    'type',
    'What happened',
    'damage, heal, absorb, cast, begincast, applybuff, applydebuff, removebuff, removedebuff, stacks, death, interrupt, dispel, resource, summon, resurrect, miss',
  ],
  ['source.name', 'Who did it', '"Dwarfix", "Kith\'ix"'],
  ['target.name', 'Who it happened to', '"Zømbicidal"'],
  ['source.type', 'What the source is', 'player, pet, npc'],
  ['target.type', 'What the target is', 'player, pet, npc'],
  ['ability.name', 'The spell', '"Venom Rupture"'],
  ['ability.id', 'The spell ID', '1302914'],
  [
    'amount',
    'Damage (with shields), healing, absorb or resource',
    '500k, 1.5m',
  ],
  ['absorbed', 'Damage soaked by shields', '100k'],
  ['overkill', 'Damage past 0 health', '1'],
  ['overheal', 'Healing past full health', '0'],
  ['mitigated', 'Damage armour and reductions took off', '200k'],
  [
    'hitType',
    'How it landed',
    'crit, normal, tick, miss, dodge, parry, immune',
  ],
  ['time', 'Seconds into the pull', '90'],
  ['target.hp', 'Target health % after the hit or heal', '20'],
  ['extra.name', 'The interrupted or dispelled spell', '"Wail of Terror"'],
];

const FIELDS = FIELD_HELP.map(([f]) => f);
const OPERATORS = ['=', '!=', '~', '>', '<', '>=', '<=', 'in (', 'not in ('];
const CONNECTORS = ['and', 'or', 'and not', ')'];

export const EXAMPLES: [string, string][] = [
  [
    'Venom Rupture hits on raiders',
    'ability.name = "Venom Rupture" and target.type = player',
  ],
  ['Anything with "breath" in its name', 'ability.name ~ "breath"'],
  [
    'Hits over 1m from enemies',
    'type = damage and not source.type = player and amount > 1m',
  ],
  ['Two raiders only', 'target.name in ("Dwarfix", "Angxl")'],
  [
    'Raiders below 20% health',
    'type = damage and target.type = player and target.hp >= 0 and target.hp < 20',
  ],
  ['Crits only', 'hitType = crit'],
  ['The first two minutes', 'time < 120'],
  ['Interrupts and deaths', 'type in (interrupt, death)'],
];

type Suggestion = { label: string; insert: string; hint?: string };

const VALUES_FOR: Record<string, string[]> = {
  'source.type': ['player', 'pet', 'npc'],
  'target.type': ['player', 'pet', 'npc'],
  hitType: ['crit', 'normal', 'tick', 'miss', 'dodge', 'parry', 'immune'],
  type: Object.keys(TYPE_NAMES),
};

/** What could come at the caret, and what part of the text it replaces. */
const suggest = (
  text: string,
  caret: number,
  vocab: Vocabulary,
): { from: number; items: Suggestion[] } => {
  const before = text.slice(0, caret);
  // The word (or open quote) being typed.
  // Inside an open quote: from the quote; else the word being typed.
  const quotes = (before.match(/"/g) ?? []).length;
  const partial =
    quotes % 2 === 1
      ? before.slice(before.lastIndexOf('"'))
      : (/[A-Za-z_.0-9]*$/.exec(before)?.[0] ?? '');
  const from = caret - partial.length;
  const head = before.slice(0, from).trimEnd();
  const typed = partial.replace(/^"/, '').toLowerCase();
  const match = (list: string[]) =>
    list.filter((v) => v.toLowerCase().includes(typed)).slice(0, 40);

  // After a field: an operator.
  const lastWord = /([A-Za-z_.]+)$/.exec(head)?.[1] ?? '';
  // After an operator (or inside "in (" a list): a value for that field.
  const valueField =
    /([A-Za-z_.]+)\s*(?:=|==|!=|~|>=|<=|>|<)$/.exec(head)?.[1] ??
    /([A-Za-z_.]+)\s+(?:not\s+)?in\s*\((?:[^)]*,)?$/.exec(head)?.[1];

  if (valueField) {
    const names =
      valueField === 'ability.name' || valueField === 'extra.name'
        ? vocab.abilities
        : valueField === 'source.name' || valueField === 'target.name'
          ? vocab.units
          : null;
    if (names) {
      return {
        from,
        items: match(names).map((n) => ({ label: n, insert: `"${n}"` })),
      };
    }
    const values = VALUES_FOR[valueField];
    if (values) {
      return {
        from,
        items: match(values).map((v) => ({ label: v, insert: v })),
      };
    }
    return { from, items: [] };
  }
  if (FIELDS.includes(lastWord) && !partial) {
    return {
      from,
      items: OPERATORS.map((o) => ({
        label: o,
        insert: o,
        hint: o === '~' ? 'contains' : undefined,
      })),
    };
  }
  // After a value: and / or.
  if (
    /("[^"]*"|\d[\d.]*[kKmM]?|\)|[A-Za-z]+)$/.test(head) &&
    head &&
    !/\b(and|or|not)$/.test(head) &&
    !partial
  ) {
    const open =
      (head.match(/\(/g) ?? []).length - (head.match(/\)/g) ?? []).length;
    return {
      from,
      items: CONNECTORS.filter((c) => c !== ')' || open > 0).map((c) => ({
        label: c,
        insert: c,
      })),
    };
  }
  // Start of a condition: a field.
  return {
    from,
    items: FIELD_HELP.filter(([f]) => f.toLowerCase().includes(typed)).map(
      ([f, help]) => ({ label: f, insert: f, hint: help }),
    ),
  };
};

const ExpressionInput = ({
  value,
  onChange,
  onApply,
  vocab,
  className,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onApply: (v: string) => void;
  vocab: Vocabulary;
  className?: string;
  placeholder?: string;
  label: string;
}) => {
  const input = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [caret, setCaret] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [help, setHelp] = React.useState(false);

  const { from, items } = React.useMemo(
    () => suggest(value, caret, vocab),
    [value, caret, vocab],
  );
  const shown = open ? items : [];

  const accept = (s: Suggestion) => {
    const next = `${value.slice(0, from)}${s.insert} ${value.slice(caret).trimStart()}`;
    const at = from + s.insert.length + 1;
    onChange(next);
    setCaret(at);
    setActive(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };

  return (
    <div className="relative flex-1 min-w-[260px] flex items-center gap-x-1">
      <input
        ref={input}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setOpen(true);
          setActive(0);
        }}
        onKeyUp={(e) => {
          // Picking a suggestion moves the caret itself.
          if (
            ['Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)
          )
            return;
          setCaret(e.currentTarget.selectionStart ?? 0);
        }}
        onClick={(e) => {
          setCaret(e.currentTarget.selectionStart ?? 0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          onApply(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && shown.length) {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (e.key === 'ArrowUp' && shown.length) {
            e.preventDefault();
            setActive((a) => (a - 1 + shown.length) % shown.length);
          } else if (e.key === 'Tab' && shown.length) {
            e.preventDefault();
            accept(shown[active]);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (shown.length && open && value.slice(from, caret)) {
              accept(shown[active]);
            } else {
              setOpen(false);
              onApply(value);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={className}
        aria-label={label}
        aria-autocomplete="list"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => setHelp(!help)}
        aria-label="Filter expression cheat sheet"
        title="Cheat sheet"
        className={`p-1 rounded hover:text-foreground-lighter ${help ? 'text-brand' : 'text-foreground'}`}
      >
        <HelpCircle size={16} />
      </button>
      {shown.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[420px] max-h-[280px] overflow-y-auto rounded-md border border-card bg-background shadow-xl text-xs">
          {shown.map((s, i) => (
            <button
              key={`${s.label}${i}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-baseline gap-x-2 px-2 py-1 text-left ${
                i === active
                  ? 'bg-brand/20 text-foreground-lighter'
                  : 'text-foreground-lighter'
              }`}
            >
              <span className="font-mono">{s.label}</span>
              {s.hint && (
                <span className="text-foreground truncate">{s.hint}</span>
              )}
            </button>
          ))}
          <div className="px-2 py-1 text-[10px] text-foreground border-t border-card">
            Tab or Enter to pick · Enter on its own to filter · ? for the cheat
            sheet
          </div>
        </div>
      )}
      {help && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[720px] max-w-[90vw] max-h-[70vh] overflow-y-auto rounded-md border border-card bg-background shadow-xl p-3 text-xs">
          <div className="flex items-center mb-2">
            <span className="font-semibold text-sm text-foreground-lighter">
              Filter expressions
            </span>
            <button
              type="button"
              className="ml-auto text-brand hover:underline"
              onClick={() => setHelp(false)}
            >
              Close
            </button>
          </div>
          <p className="m-0 mb-2 text-foreground">
            Write{' '}
            <span className="font-mono text-foreground-lighter">
              field operator value
            </span>
            , and join conditions with <span className="font-mono">and</span>,{' '}
            <span className="font-mono">or</span>,{' '}
            <span className="font-mono">not</span> and brackets. Names go in
            quotes. Numbers take k and m (1.5m). Case doesn&apos;t matter.
          </p>
          <table className="w-full mb-3">
            <thead className="text-foreground">
              <tr>
                <th className="text-left font-normal py-0.5 pr-3">Field</th>
                <th className="text-left font-normal py-0.5 pr-3">Means</th>
                <th className="text-left font-normal py-0.5">Values</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_HELP.map(([f, means, values]) => (
                <tr key={f} className="border-t border-card/40 align-top">
                  <td className="py-0.5 pr-3 font-mono text-foreground-lighter whitespace-nowrap">
                    {f}
                  </td>
                  <td className="py-0.5 pr-3 text-foreground-lighter">
                    {means}
                  </td>
                  <td className="py-0.5 text-foreground">{values}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mb-3 text-foreground-lighter">
            <span className="text-foreground">Operators: </span>
            <span className="font-mono">=</span> equals,{' '}
            <span className="font-mono">!=</span> not,{' '}
            <span className="font-mono">~</span> contains,{' '}
            <span className="font-mono">&gt; &lt; &gt;= &lt;=</span>,{' '}
            <span className="font-mono">in (a, b)</span> one of,{' '}
            <span className="font-mono">not in (a, b)</span>.
          </div>
          <div className="text-foreground mb-1">Examples (click to use)</div>
          {EXAMPLES.map(([what, expr]) => (
            <button
              key={expr}
              type="button"
              onClick={() => {
                onChange(expr);
                onApply(expr);
                setHelp(false);
              }}
              className="flex w-full items-baseline gap-x-3 px-1 py-1 text-left rounded hover:bg-card/50"
            >
              <span className="w-[220px] shrink-0 text-foreground-lighter">
                {what}
              </span>
              <span className="font-mono text-foreground">{expr}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExpressionInput;
