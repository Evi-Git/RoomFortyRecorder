import React from 'react';
import { getSpecClass, getWoWClassColor } from './rendererutils';

/**
 * [RoomFortyRecorder] Consumables & buffs: what raiders had at each pull
 * (food, flask, augment rune, weapon oil, vantus, pre-pot), combat potions
 * used of those possible, raid buffs, and missing enchants. Built
 * by the guild server from the combat log (guild-cloud-server/consumables.mjs).
 *
 * Night summary and Progression show the raid grid (rates over pulls); a
 * pull shows its raid buffs and who was missing what. The Show dropdown
 * switches to one raider's own view.
 */

type Enchant = { slot: string; ok: boolean | null };
type Gem = { slot: string; count: number; equipped: boolean };

export type PrepPlayer = {
  name: string;
  specId: number;
  food: string | null;
  flask: string | null;
  augment: string | null;
  vantus: string | null;
  weaponOil: boolean | null;
  prepot: boolean;
  potsUsed: number;
  potsPossible: number;
  enchants: Enchant[];
  gems: Gem[];
  enchantsMissing: number;
  gemsMissing: number;
};

export type Prep = {
  players: PrepPlayer[];
  raidBuffs: {
    key: string;
    name: string;
    have: number;
    of: number;
    providers: string[];
  }[];
};

type Check = 'food' | 'flask' | 'augment' | 'weaponOil' | 'vantus' | 'prepot';

type SummaryRaider = {
  name: string;
  specId: number;
  pulls: number;
  potsUsed: number;
  potsPossible: number;
  names: {
    food: string | null;
    flask: string | null;
    augment: string | null;
    vantus: string | null;
  };
  enchants: Enchant[];
  gems: Gem[];
  enchantsMissing: number;
  gemsMissing: number;
} & Record<Check, number>;

export type PrepSummary = {
  pulls: number;
  skipped: number;
  total: { pulls: number; potsUsed: number; potsPossible: number } & Record<
    Check,
    number
  >;
  raiders: SummaryRaider[];
};

const CHECKS: { key: Check; label: string; help: string }[] = [
  { key: 'food', label: 'Food', help: 'Well Fed at the pull' },
  { key: 'flask', label: 'Flask', help: 'A flask or phial at the pull' },
  { key: 'augment', label: 'Aug. rune', help: 'An augment rune at the pull' },
  {
    key: 'weaponOil',
    label: 'Weapon oil',
    help: 'An oil or stone on the main-hand weapon',
  },
  { key: 'vantus', label: 'Vantus', help: 'The boss’s vantus rune' },
];

const GOOD = '#5CC48A';
const WARN = '#E3B341';
const BAD = '#E5735F';
const tone = (pct: number) =>
  pct >= 95
    ? { fg: GOOD, bg: 'rgba(92,196,138,0.13)', mark: '✓' }
    : pct >= 75
      ? { fg: WARN, bg: 'rgba(227,179,65,0.13)', mark: '~' }
      : { fg: BAD, bg: 'rgba(229,115,95,0.14)', mark: '!' };

const pctOf = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

const classColor = (specId: number) =>
  getWoWClassColor(getSpecClass(specId)) || undefined;

/** A pull's prep in the same shape as a summary (one pull each). */
export const summaryFromPrep = (prep: Prep): PrepSummary => {
  const total = {
    pulls: 0,
    potsUsed: 0,
    potsPossible: 0,
    food: 0,
    flask: 0,
    augment: 0,
    weaponOil: 0,
    vantus: 0,
    prepot: 0,
  };
  const raiders = prep.players.map((p) => {
    const has: Record<Check, number> = {
      food: p.food ? 1 : 0,
      flask: p.flask ? 1 : 0,
      augment: p.augment ? 1 : 0,
      weaponOil: p.weaponOil ? 1 : 0,
      vantus: p.vantus ? 1 : 0,
      prepot: p.prepot ? 1 : 0,
    };
    total.pulls += 1;
    total.potsUsed += p.potsUsed;
    total.potsPossible += p.potsPossible;
    CHECKS.forEach(({ key }) => {
      total[key] += has[key];
    });
    return {
      name: p.name,
      specId: p.specId,
      pulls: 1,
      potsUsed: p.potsUsed,
      potsPossible: p.potsPossible,
      names: {
        food: p.food,
        flask: p.flask,
        augment: p.augment,
        vantus: p.vantus,
      },
      enchants: p.enchants,
      gems: p.gems,
      enchantsMissing: p.enchantsMissing,
      gemsMissing: p.gemsMissing,
      ...has,
    };
  });
  return { pulls: 1, skipped: 0, total, raiders };
};

const Chip = ({ pct, text }: { pct: number; text: string }) => {
  const t = tone(pct);
  return (
    <span
      className="inline-flex items-center justify-center gap-x-1 min-w-[60px] h-6 px-2 rounded text-xs font-semibold tabular-nums"
      style={{ background: t.bg, color: t.fg }}
    >
      <span aria-hidden="true">{t.mark}</span>
      {text}
    </span>
  );
};

const GearStrip = ({
  title,
  items,
}: {
  title: string;
  items: { slot: string; state: 'ok' | 'bad' | 'none'; note: string }[];
}) => (
  <section className="flex flex-col gap-y-2">
    <h4 className="text-sm font-semibold text-brand">{title}</h4>
    <div
      className="grid gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))`,
      }}
    >
      {items.map((item, i) => (
        <div
          key={`${item.slot}-${i}`}
          className="h-14 rounded-md flex flex-col items-center justify-center gap-0.5 border"
          style={{
            background:
              item.state === 'ok'
                ? 'rgba(92,196,138,0.13)'
                : item.state === 'bad'
                  ? 'rgba(229,115,95,0.14)'
                  : 'rgba(255,255,255,0.03)',
            borderColor:
              item.state === 'ok'
                ? 'rgba(92,196,138,0.35)'
                : item.state === 'bad'
                  ? 'rgba(229,115,95,0.4)'
                  : 'hsl(var(--card))',
          }}
        >
          <span className="text-[13px] font-semibold text-foreground-lighter">
            {item.slot}
          </span>
          <span
            className="text-[11px]"
            style={{
              color:
                item.state === 'ok' ? GOOD : item.state === 'bad' ? BAD : '',
            }}
          >
            {item.note}
          </span>
        </div>
      ))}
    </div>
  </section>
);

/** One raider: gear strips and a card per consumable. */
const RaiderView = ({ r, single }: { r: SummaryRaider; single: boolean }) => {
  const card = (label: string, n: number, detail: string) => {
    const pct = pctOf(n, r.pulls);
    const t = tone(pct);
    return (
      <div
        key={label}
        className="rounded-md border border-card bg-background/40 p-3 flex flex-col gap-y-2"
      >
        <div className="flex items-center gap-x-2">
          <span className="text-sm font-semibold text-foreground-lighter">
            {label}
          </span>
          <span
            className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: t.bg, color: t.fg }}
          >
            {single ? (n ? '✓ Yes' : '! No') : `${pct}%`}
          </span>
        </div>
        {!single && (
          <div className="h-1.5 rounded bg-card overflow-hidden">
            <div
              className="h-1.5"
              style={{ width: `${pct}%`, background: t.fg }}
            />
          </div>
        )}
        <span className="text-[13px] text-foreground leading-snug">
          {detail}
        </span>
      </div>
    );
  };
  const inPulls = (n: number) => (single ? '' : ` in ${n} of ${r.pulls} pulls`);
  const potPct = pctOf(r.potsUsed, r.potsPossible);

  return (
    <div className="flex flex-col gap-y-4">
      <GearStrip
        title="Enchants"
        items={r.enchants
          .filter((e) => e.ok !== null)
          .map((e) => ({
            slot: e.slot,
            state: e.ok ? 'ok' : 'bad',
            note: e.ok ? 'Enchanted' : 'Missing',
          }))}
      />
      <section className="flex flex-col gap-y-2">
        <h4 className="text-sm font-semibold text-brand">Consumables</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {card(
            'Food',
            r.food,
            r.food
              ? `${r.names.food ?? 'Fed'}${inPulls(r.food)}.`
              : 'Not fed at the pull.',
          )}
          {card(
            'Flask',
            r.flask,
            r.flask
              ? `${r.names.flask ?? 'Flask'}${inPulls(r.flask)}.`
              : 'No flask at the pull.',
          )}
          {card(
            'Augment rune',
            r.augment,
            r.augment
              ? `${r.names.augment ?? 'Rune'}${inPulls(r.augment)}.`
              : 'No augment rune at the pull.',
          )}
          <div className="rounded-md border border-card bg-background/40 p-3 flex flex-col gap-y-2">
            <div className="flex items-center gap-x-2">
              <span className="text-sm font-semibold text-foreground-lighter">
                Combat potions
              </span>
              <span
                className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full tabular-nums"
                style={{ background: tone(potPct).bg, color: tone(potPct).fg }}
              >
                {r.potsUsed}/{r.potsPossible}
              </span>
            </div>
            <div className="h-1.5 rounded bg-card overflow-hidden">
              <div
                className="h-1.5"
                style={{ width: `${potPct}%`, background: tone(potPct).fg }}
              />
            </div>
            <span className="text-[13px] text-foreground leading-snug">
              Used {r.potsUsed} of {r.potsPossible} possible (a pre-pot, then
              one per 5 minutes)
              {single ? '' : `; pre-pot in ${r.prepot} of ${r.pulls} pulls`}.
            </span>
          </div>
          {card(
            'Weapon oil',
            r.weaponOil,
            r.weaponOil
              ? `On the weapon${inPulls(r.weaponOil)}.`
              : 'No oil or stone on the weapon.',
          )}
          {card(
            'Vantus rune',
            r.vantus,
            r.vantus
              ? `${r.names.vantus ?? 'Vantus rune'}${inPulls(r.vantus)}.`
              : 'No vantus rune for this boss.',
          )}
        </div>
      </section>
    </div>
  );
};

/** Night summary / Progression: tiles and a raider grid. */
const RaidGrid = ({
  data,
  onPick,
}: {
  data: PrepSummary;
  onPick: (name: string) => void;
}) => {
  const [sort, setSort] = React.useState<string>('name');
  const rate = (r: SummaryRaider, key: string) => {
    if (key === 'name') return 0;
    if (key === 'pots') return pctOf(r.potsUsed, r.potsPossible);
    if (key === 'enchants') return -r.enchantsMissing;
    return pctOf(r[key as Check], r.pulls);
  };
  const rows = [...data.raiders].sort(
    (a, b) =>
      (sort === 'name' ? 0 : rate(a, sort) - rate(b, sort)) ||
      a.name.localeCompare(b.name),
  );
  const t = data.total;
  const tiles = [
    ...CHECKS.map((c) => ({
      label: c.label,
      pct: pctOf(t[c.key], t.pulls),
      sub: 'of raider-pulls',
    })),
    {
      label: 'Combat pots',
      pct: pctOf(t.potsUsed, t.potsPossible),
      sub: `${t.potsUsed} of ${t.potsPossible} possible`,
    },
  ];

  const header = (key: string, label: string, help: string) => (
    <th key={key} className="px-1.5 py-1.5 font-normal" title={help}>
      <button
        type="button"
        onClick={() => setSort(key)}
        className={`hover:text-foreground-lighter ${
          sort === key ? 'text-foreground-lighter' : ''
        }`}
      >
        {label}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        {tiles.map((tile) => {
          const tn = tone(tile.pct);
          return (
            <div
              key={tile.label}
              className="rounded-md border border-card bg-background/40 px-3 py-2 flex flex-col gap-y-1"
            >
              <span className="text-xs text-foreground">{tile.label}</span>
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: tn.fg }}
              >
                {tile.pct}%
              </span>
              <div className="h-1.5 rounded bg-card overflow-hidden">
                <div
                  className="h-1.5"
                  style={{ width: `${tile.pct}%`, background: tn.fg }}
                />
              </div>
              <span className="text-[11px] text-foreground/80">{tile.sub}</span>
            </div>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground border-b border-card">
            <tr className="text-center">
              <th className="px-2 py-1.5 font-normal text-left">
                <button
                  type="button"
                  onClick={() => setSort('name')}
                  className="hover:text-foreground-lighter"
                >
                  Raider
                </button>
              </th>
              {CHECKS.map((c) => header(c.key, c.label, c.help))}
              {header('pots', 'Combat pots', 'Used of possible')}
              {header('enchants', 'Enchants', 'Slots missing an enchant')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="border-b border-card/40 hover:bg-card/30 text-center"
              >
                <td className="px-2 py-1 text-left whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onPick(r.name)}
                    className="font-semibold hover:underline"
                    style={{ color: classColor(r.specId) }}
                    title="Show their own view"
                  >
                    {r.name}
                  </button>
                </td>
                {CHECKS.map((c) => {
                  const pct = pctOf(r[c.key], r.pulls);
                  return (
                    <td key={c.key} className="px-1.5 py-1">
                      <Chip
                        pct={pct}
                        text={
                          data.pulls === 1
                            ? r[c.key]
                              ? 'Yes'
                              : 'No'
                            : `${pct}%`
                        }
                      />
                    </td>
                  );
                })}
                <td className="px-1.5 py-1">
                  <Chip
                    pct={pctOf(r.potsUsed, r.potsPossible)}
                    text={`${r.potsUsed}/${r.potsPossible}`}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <Chip
                    pct={r.enchantsMissing ? 0 : 100}
                    text={
                      r.enchantsMissing ? `${r.enchantsMissing} missing` : 'All'
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** A pull: raid buffs with who brought them, and who was missing what. */
const PullOverview = ({ prep, data }: { prep: Prep; data: PrepSummary }) => {
  const lists = [
    ...CHECKS.map((c) => ({
      what: `No ${c.label.toLowerCase()}`,
      names: data.raiders.filter((r) => !r[c.key]).map((r) => r.name),
    })),
    {
      what: 'Combat pots short',
      names: data.raiders
        .filter((r) => r.potsUsed < r.potsPossible)
        .map((r) => `${r.name} (${r.potsUsed}/${r.potsPossible})`),
    },
    {
      what: 'Missing enchants',
      names: data.raiders
        .filter((r) => r.enchantsMissing)
        .map(
          (r) =>
            `${r.name} (${r.enchants
              .filter((e) => e.ok === false)
              .map((e) => e.slot)
              .join(', ')})`,
        ),
    },
  ];
  const of = data.raiders.length;
  return (
    <div className="flex flex-col gap-y-4">
      <section className="flex flex-col gap-y-2">
        <h4 className="text-sm font-semibold text-brand">
          Raid buffs at the pull
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {prep.raidBuffs.map((b) => {
            const tn = tone(pctOf(b.have, b.of));
            return (
              <div
                key={b.key}
                className="rounded-md border bg-background/40 px-3 py-2 flex flex-col gap-y-0.5"
                style={{ borderColor: `${tn.fg}55` }}
              >
                <span className="text-[13px] font-semibold text-foreground-lighter">
                  {b.name}
                </span>
                <span
                  className="text-xs font-semibold tabular-nums"
                  style={{ color: tn.fg }}
                >
                  {b.have ? `${tn.mark} ${b.have} / ${b.of}` : '! Nobody'}
                </span>
                <span className="text-[11px] text-foreground truncate">
                  {b.providers.length
                    ? `from ${b.providers.join(', ')}`
                    : 'nobody brought it'}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="flex flex-col gap-y-2">
        <h4 className="text-sm font-semibold text-brand">
          Who was missing something
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {lists.map((l) => {
            const pct = pctOf(of - l.names.length, of);
            const tn = tone(pct);
            return (
              <div
                key={l.what}
                className="rounded-md border border-card bg-background/40 px-3 py-2 flex flex-col gap-y-1"
              >
                <div className="flex items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-foreground-lighter">
                    {l.what}
                  </span>
                  <span
                    className="ml-auto text-xs font-bold tabular-nums"
                    style={{ color: tn.fg }}
                  >
                    {l.names.length} of {of}
                  </span>
                </div>
                <span className="text-[13px] text-foreground leading-snug">
                  {l.names.length ? l.names.join(', ') : 'Everyone'}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

/**
 * The widget. Pass `summary` (Night summary, Progression) or `prep` (a
 * pull). Shows nothing when there's no data.
 */
const ConsumablesPanel = ({
  summary,
  prep,
  scope,
}: {
  summary?: PrepSummary | null;
  prep?: Prep | null;
  scope: string;
}) => {
  const [who, setWho] = React.useState('');
  const data = React.useMemo(
    () => (prep ? summaryFromPrep(prep) : (summary ?? null)),
    [prep, summary],
  );

  if (!data || !data.raiders.length) {
    return (
      <p className="text-sm text-foreground">
        No consumables data yet. It comes from pulls sent with advanced combat
        logging; older pulls are rechecked while their logs are kept.
      </p>
    );
  }
  const names = data.raiders.map((r) => r.name).sort();
  const raider = data.raiders.find((r) => r.name === who);

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-2 flex-wrap">
        <span className="text-xs text-foreground">
          {scope}
          {data.skipped
            ? ` · ${data.skipped} older ${data.skipped === 1 ? 'pull' : 'pulls'} without data`
            : ''}
        </span>
        <label
          htmlFor={`consumables-${scope}`}
          className="ml-auto text-xs text-foreground"
        >
          Show
        </label>
        <select
          id={`consumables-${scope}`}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          className="h-8 rounded-md border border-card bg-background px-2 text-sm"
        >
          <option value="">Whole raid</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {raider && <RaiderView r={raider} single={Boolean(prep)} />}
      {!raider && prep && <PullOverview prep={prep} data={data} />}
      {!raider && !prep && <RaidGrid data={data} onPick={setWho} />}
    </div>
  );
};

export default ConsumablesPanel;
