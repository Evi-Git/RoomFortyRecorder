import { F, K, MISS_TYPES, PullStore } from './store';

/**
 * [RoomFortyRecorder] Logs page filter expressions, in the spirit of
 * Warcraft Logs':
 *
 *   ability.name = "Venom Rupture" and target.name in ("Dwarfix", "Angxl")
 *   type = "damage" and amount > 500000
 *   not source.type = "player"
 *   ability.name ~ "breath"            (~ means "contains")
 *
 * Fields: type, source.name, source.type, target.name, target.type,
 * ability.name, ability.id, amount, absorbed, overkill, overheal,
 * mitigated, hitType ("crit", "normal", "tick", "miss"), time (seconds into
 * the pull), target.hp (% after the hit), extra.name (the interrupted or
 * dispelled spell).
 */

export type Predicate = (p: PullStore, i: number) => boolean;

export const EXPRESSION_FIELDS = [
  'type',
  'source.name',
  'source.type',
  'target.name',
  'target.type',
  'ability.name',
  'ability.id',
  'amount',
  'absorbed',
  'overkill',
  'overheal',
  'mitigated',
  'hitType',
  'time',
  'target.hp',
  'extra.name',
];

export const TYPE_NAMES: Record<string, (p: PullStore, i: number) => boolean> =
  {
    damage: (p, i) => p.k[i] === K.DMG,
    heal: (p, i) => p.k[i] === K.HEAL,
    absorb: (p, i) => p.k[i] === K.ABSORB,
    absorbed: (p, i) => p.k[i] === K.ABSORB,
    cast: (p, i) => p.k[i] === K.CAST,
    begincast: (p, i) => p.k[i] === K.BEGIN,
    applybuff: (p, i) => p.k[i] === K.APPLY && !(p.f[i] & F.DEBUFF),
    applydebuff: (p, i) => p.k[i] === K.APPLY && Boolean(p.f[i] & F.DEBUFF),
    removebuff: (p, i) => p.k[i] === K.REMOVE && !(p.f[i] & F.DEBUFF),
    removedebuff: (p, i) => p.k[i] === K.REMOVE && Boolean(p.f[i] & F.DEBUFF),
    stacks: (p, i) => p.k[i] === K.DOSE,
    death: (p, i) => p.k[i] === K.DIED,
    interrupt: (p, i) => p.k[i] === K.INTERRUPT,
    dispel: (p, i) => p.k[i] === K.DISPEL,
    resource: (p, i) => p.k[i] === K.ENERGIZE,
    energize: (p, i) => p.k[i] === K.ENERGIZE,
    summon: (p, i) => p.k[i] === K.SUMMON,
    resurrect: (p, i) => p.k[i] === K.RES,
    miss: (p, i) => p.k[i] === K.MISS,
  };

const unitType = (p: PullStore, unit: number) => {
  if (unit < 0) return '';
  const u = p.units[unit];
  if (u.player) return 'player';
  if (u.owner >= 0) return 'pet';
  return 'npc';
};

type Value = string | number;

const fieldValue = (field: string): ((p: PullStore, i: number) => Value) => {
  switch (field) {
    case 'source.name':
      return (p, i) => p.units[p.s[i]]?.name ?? '';
    case 'target.name':
      return (p, i) => p.units[p.d[i]]?.name ?? '';
    case 'source.type':
      return (p, i) => unitType(p, p.s[i]);
    case 'target.type':
      return (p, i) => unitType(p, p.d[i]);
    case 'ability.name':
      return (p, i) => p.spells[p.sp[i]]?.name ?? '';
    case 'ability.id':
      return (p, i) => p.spells[p.sp[i]]?.id ?? 0;
    case 'amount':
      return (p, i) => (p.k[i] === K.DMG ? p.a[i] + p.b[i] : p.a[i]);
    case 'absorbed':
      return (p, i) => (p.k[i] === K.DMG ? p.b[i] : 0);
    case 'overkill':
      return (p, i) => (p.k[i] === K.DMG ? p.aux[i] : 0);
    case 'overheal':
      return (p, i) => (p.k[i] === K.HEAL ? p.x[i] : 0);
    case 'mitigated':
      return (p, i) =>
        p.k[i] === K.DMG ? Math.max(0, p.x[i] - p.a[i] - p.b[i]) : 0;
    case 'hitType':
      return (p, i) => {
        if (p.k[i] === K.MISS)
          return MISS_TYPES[p.aux[i]]?.toLowerCase() || 'miss';
        if (p.f[i] & F.CRIT) return 'crit';
        if (p.f[i] & F.TICK) return 'tick';
        return 'normal';
      };
    case 'time':
      return (p, i) => p.t[i];
    case 'target.hp':
      return (p, i) => (p.hp[i] === 255 ? -1 : p.hp[i]);
    case 'extra.name':
      return (p, i) =>
        p.k[i] === K.INTERRUPT || p.k[i] === K.DISPEL
          ? (p.spells[p.aux[i]]?.name ?? '')
          : '';
    default:
      throw new Error(
        `Unknown field "${field}". Try: ${EXPRESSION_FIELDS.join(', ')}`,
      );
  }
};

type Token = {
  kind: 'word' | 'string' | 'number' | 'op' | 'punct';
  text: string;
};

const tokenize = (src: string): Token[] => {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error('A quote is never closed');
      out.push({ kind: 'string', text: src.slice(i + 1, end) });
      i = end + 1;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9][0-9.]*[kKmM]?/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ kind: 'number', text: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(
        src.slice(i),
      ) as RegExpExecArray;
      out.push({ kind: 'word', text: m[0] });
      i += m[0].length;
    } else if (/[=!<>~]/.test(c)) {
      const m = /^(==|!=|>=|<=|=|>|<|~)/.exec(src.slice(i));
      if (!m) throw new Error(`Unexpected "${c}"`);
      out.push({ kind: 'op', text: m[0] });
      i += m[0].length;
    } else if (c === '(' || c === ')' || c === ',') {
      out.push({ kind: 'punct', text: c });
      i += 1;
    } else if (c === '&' && src[i + 1] === '&') {
      out.push({ kind: 'word', text: 'and' });
      i += 2;
    } else if (c === '|' && src[i + 1] === '|') {
      out.push({ kind: 'word', text: 'or' });
      i += 2;
    } else {
      throw new Error(`Unexpected "${c}"`);
    }
  }
  return out;
};

const numberOf = (text: string) => {
  const m = /^([0-9.]+)([kKmM]?)$/.exec(text);
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === 'k' ? n * 1e3 : unit === 'm' ? n * 1e6 : n;
};

/** Compiles an expression, or throws with a readable message. */
export const compileExpression = (src: string): Predicate | null => {
  if (!src.trim()) return null;
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isWord = (w: string) =>
    peek()?.kind === 'word' && peek().text.toLowerCase() === w;
  const expect = (text: string) => {
    if (peek()?.text !== text) throw new Error(`Expected "${text}"`);
    pos += 1;
  };

  const value = (): Value => {
    const t = peek();
    if (!t) throw new Error('A value is missing');
    pos += 1;
    if (t.kind === 'number') return numberOf(t.text);
    if (t.kind === 'string' || t.kind === 'word') return t.text;
    throw new Error(`Unexpected "${t.text}"`);
  };

  const comparison = (): Predicate => {
    const t = peek();
    if (!t || t.kind !== 'word') throw new Error('Expected a field name');
    pos += 1;
    const field = t.text;
    if (field === 'type') {
      // type = "damage" / type in (...)
      const negate = isWord('not');
      if (negate) pos += 1;
      if (isWord('in')) {
        pos += 1;
        expect('(');
        const names: string[] = [];
        while (peek() && peek().text !== ')') {
          names.push(String(value()).toLowerCase());
          if (peek()?.text === ',') pos += 1;
        }
        expect(')');
        const fns = names.map((n) => {
          const fn = TYPE_NAMES[n];
          if (!fn) throw new Error(`Unknown type "${n}"`);
          return fn;
        });
        return (p, i) => fns.some((fn) => fn(p, i)) !== negate;
      }
      const op = peek();
      if (!op || op.kind !== 'op') throw new Error('Expected = after type');
      pos += 1;
      const name = String(value()).toLowerCase();
      const fn = TYPE_NAMES[name];
      if (!fn)
        throw new Error(
          `Unknown type "${name}". Types: ${Object.keys(TYPE_NAMES).join(', ')}`,
        );
      return op.text === '!=' ? (p, i) => !fn(p, i) : fn;
    }
    const get = fieldValue(field);
    let negate = false;
    if (isWord('not')) {
      negate = true;
      pos += 1;
    }
    if (isWord('in')) {
      pos += 1;
      expect('(');
      const values: Value[] = [];
      while (peek() && peek().text !== ')') {
        values.push(value());
        if (peek()?.text === ',') pos += 1;
      }
      expect(')');
      const set = new Set(values.map((v) => String(v).toLowerCase()));
      return (p, i) => set.has(String(get(p, i)).toLowerCase()) !== negate;
    }
    const op = peek();
    if (!op || op.kind !== 'op')
      throw new Error(`Expected =, !=, >, <, >=, <=, ~ or "in" after ${field}`);
    pos += 1;
    const v = value();
    const lower = String(v).toLowerCase();
    const n = typeof v === 'number' ? v : Number(v);
    switch (op.text) {
      case '=':
      case '==':
        return (p, i) => {
          const got = get(p, i);
          return typeof got === 'number'
            ? got === n
            : got.toLowerCase() === lower;
        };
      case '!=':
        return (p, i) => {
          const got = get(p, i);
          return typeof got === 'number'
            ? got !== n
            : got.toLowerCase() !== lower;
        };
      case '~':
        return (p, i) => String(get(p, i)).toLowerCase().includes(lower);
      case '>':
        return (p, i) => Number(get(p, i)) > n;
      case '<':
        return (p, i) => Number(get(p, i)) < n;
      case '>=':
        return (p, i) => Number(get(p, i)) >= n;
      case '<=':
        return (p, i) => Number(get(p, i)) <= n;
      default:
        throw new Error(`Unknown operator ${op.text}`);
    }
  };

  const primary = (): Predicate => {
    if (peek()?.text === '(') {
      pos += 1;

      const inner = orExpr();
      expect(')');
      return inner;
    }
    return comparison();
  };
  const notExpr = (): Predicate => {
    if (isWord('not')) {
      pos += 1;
      const inner = notExpr();
      return (p, i) => !inner(p, i);
    }
    return primary();
  };
  const andExpr = (): Predicate => {
    let left = notExpr();
    while (isWord('and')) {
      pos += 1;
      const l = left;
      const r = notExpr();
      left = (p, i) => l(p, i) && r(p, i);
    }
    return left;
  };
  function orExpr(): Predicate {
    let left = andExpr();
    while (isWord('or')) {
      pos += 1;
      const l = left;
      const r = andExpr();
      left = (p, i) => l(p, i) || r(p, i);
    }
    return left;
  }

  const result = orExpr();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].text}"`);
  return result;
};
