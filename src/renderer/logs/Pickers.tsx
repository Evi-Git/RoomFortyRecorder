import React from 'react';
import { Check, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { EnemyFilter, EnemyOption } from './query';
import SpellIcon from './SpellIcon';

/**
 * [RoomFortyRecorder] Logs page pickers: enemies (all, bosses, non-bosses,
 * one kind of NPC, one spawn wave or one instance of it) and abilities
 * (several at once, with + to add each).
 */

const button =
  'inline-flex items-center gap-x-1.5 bg-card text-foreground-lighter rounded px-2 h-8 text-xs border border-background max-w-[240px]';

/** A dropdown panel that closes on an outside click or Escape. */
const usePopover = () => {
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, box };
};

export const enemyLabel = (f: EnemyFilter | null) => {
  if (!f) return 'All enemies';
  if (f.kind === 'bosses') return 'Bosses';
  if (f.kind === 'adds') return 'Non-bosses';
  if (f.instance) return `${f.name} #${f.instance}`;
  if (f.group) return `${f.name} (wave ${f.group})`;
  return f.name;
};

export const EnemyPicker = ({
  value,
  options,
  onChange,
}: {
  value: EnemyFilter | null;
  options: EnemyOption[];
  onChange: (f: EnemyFilter | null) => void;
}) => {
  const { open, setOpen, box } = usePopover();
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const pick = (f: EnemyFilter | null) => {
    onChange(f);
    setOpen(false);
  };
  const same = (o: EnemyOption) =>
    value?.kind === 'npc' && value.npcId === o.npcId;
  // Names used by more than one NPC get their ID shown.
  const counts = new Map<string, number>();
  options.forEach((o) => counts.set(o.name, (counts.get(o.name) ?? 0) + 1));
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className={button}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{enemyLabel(value)}</span>
        <ChevronDown size={13} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-[380px] max-h-[460px] overflow-y-auto rounded-md border border-card bg-background shadow-xl text-xs">
          <div className="grid grid-cols-3 border-b border-card">
            {(
              [
                [null, 'All enemies'],
                [{ kind: 'bosses' }, 'Bosses'],
                [{ kind: 'adds' }, 'Non-bosses'],
              ] as [EnemyFilter | null, string][]
            ).map(([f, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => pick(f)}
                className={`py-2 hover:bg-card/50 ${enemyLabel(value) === label ? 'text-brand font-semibold' : 'text-foreground-lighter'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {options.map((o) => (
            <div key={o.npcId} className="border-b border-card/40">
              <div
                className={`flex items-center ${same(o) ? 'bg-brand/15' : 'hover:bg-card/40'}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    pick({ kind: 'npc', npcId: o.npcId, name: o.name })
                  }
                  className="flex-1 flex items-center gap-x-2 px-2 py-1.5 text-left min-w-0"
                >
                  <span className="truncate text-foreground-lighter">
                    {o.name}
                  </span>
                  {o.boss && (
                    <span className="rounded px-1 text-[10px] bg-brand/20 text-brand shrink-0">
                      Boss
                    </span>
                  )}
                  {o.instances > 1 && (
                    <span className="text-foreground shrink-0">
                      ×{o.instances}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-foreground shrink-0">
                    {(counts.get(o.name) ?? 0) > 1 || o.instances > 1
                      ? `ID ${o.npcId}`
                      : ''}
                  </span>
                </button>
                {o.instances > 1 && (
                  <button
                    type="button"
                    aria-label={`Waves and instances of ${o.name}`}
                    onClick={() =>
                      setExpanded(expanded === o.npcId ? null : o.npcId)
                    }
                    className="px-2 py-1.5 text-foreground hover:text-foreground-lighter"
                  >
                    {expanded === o.npcId ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                )}
              </div>
              {expanded === o.npcId && (
                <div className="px-2 pb-2 bg-card/20">
                  {o.groups > 1 && (
                    <>
                      <div className="text-[10px] text-foreground pt-1.5 pb-1">
                        Waves (spawned together)
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {Array.from({ length: o.groups }, (_, i) => i + 1).map(
                          (g) => (
                            <button
                              key={g}
                              type="button"
                              onClick={() =>
                                pick({
                                  kind: 'npc',
                                  npcId: o.npcId,
                                  name: o.name,
                                  group: g,
                                })
                              }
                              className={`py-1 rounded border border-card hover:bg-card/60 ${
                                value?.kind === 'npc' &&
                                value.npcId === o.npcId &&
                                value.group === g
                                  ? 'bg-brand/25 text-brand'
                                  : 'text-foreground-lighter'
                              }`}
                            >
                              {g}
                            </button>
                          ),
                        )}
                      </div>
                    </>
                  )}
                  <div className="text-[10px] text-foreground pt-1.5 pb-1">
                    Instances (in spawn order)
                  </div>
                  <div className="grid grid-cols-10 gap-1">
                    {Array.from({ length: o.instances }, (_, i) => i + 1).map(
                      (n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() =>
                            pick({
                              kind: 'npc',
                              npcId: o.npcId,
                              name: o.name,
                              instance: n,
                            })
                          }
                          className={`py-1 rounded border border-card hover:bg-card/60 ${
                            value?.kind === 'npc' &&
                            value.npcId === o.npcId &&
                            value.instance === n
                              ? 'bg-brand/25 text-brand'
                              : 'text-foreground-lighter'
                          }`}
                        >
                          {n}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {!options.length && (
            <p className="m-0 p-2 text-foreground">No enemies.</p>
          )}
        </div>
      )}
    </div>
  );
};

export const AbilityPicker = ({
  value,
  options,
  onChange,
}: {
  value: number[];
  options: { id: number; name: string }[];
  onChange: (ids: number[]) => void;
}) => {
  const { open, setOpen, box } = usePopover();
  const [search, setSearch] = React.useState('');
  const names = new Map(options.map((o) => [o.id, o.name]));
  const label = !value.length
    ? 'All abilities'
    : value.length === 1
      ? (names.get(value[0]) ?? `Spell ${value[0]}`)
      : `${value.length} abilities`;
  const shown = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()),
  );
  const toggle = (id: number) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className={button}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-[340px] rounded-md border border-card bg-background shadow-xl text-xs">
          <div className="flex items-center gap-x-2 p-2 border-b border-card">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search abilities"
              className="flex-1 bg-card rounded px-2 h-7 text-xs text-foreground-lighter border border-background"
              aria-label="Search abilities"
            />
            {value.length > 0 && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => onChange([])}
              >
                All
              </button>
            )}
          </div>
          {value.length > 0 && (
            <div className="flex flex-wrap gap-1 p-2 border-b border-card">
              {value.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-x-1 rounded bg-brand/20 text-foreground-lighter pl-1.5 pr-1 py-0.5"
                >
                  {names.get(id) ?? id}
                  <button
                    type="button"
                    aria-label={`Remove ${names.get(id) ?? id}`}
                    onClick={() => toggle(id)}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-[360px] overflow-y-auto">
            {shown.map((o) => {
              const on = value.includes(o.id);
              return (
                <div
                  key={o.id}
                  className={`flex items-center ${on ? 'bg-brand/10' : 'hover:bg-card/40'}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChange([o.id]);
                      setOpen(false);
                    }}
                    title="Show only this"
                    className="flex-1 flex items-center gap-x-2 px-2 py-1 text-left min-w-0"
                  >
                    <SpellIcon spellId={o.id} name={o.name} />
                    <span className="truncate text-foreground-lighter">
                      {o.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(o.id)}
                    aria-label={on ? `Remove ${o.name}` : `Add ${o.name}`}
                    title={on ? 'Remove from the view' : 'Add to the view'}
                    className={`mx-1 p-1 rounded ${on ? 'text-brand' : 'text-foreground hover:text-foreground-lighter'}`}
                  >
                    {on ? <Check size={13} /> : <Plus size={13} />}
                  </button>
                </div>
              );
            })}
            {!shown.length && (
              <p className="m-0 p-2 text-foreground">No abilities match.</p>
            )}
          </div>
          <div className="px-2 py-1 text-[10px] text-foreground border-t border-card">
            Click a name to show only it; + adds it alongside the others.
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Healing: raiders whose healing received is left out ("exclude healing
 * to"), as many as wanted.
 */
export const ExcludeTargetsPicker = ({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: { guid: string; name: string; color: string }[];
  onChange: (guids: string[]) => void;
}) => {
  const { open, setOpen, box } = usePopover();
  const [search, setSearch] = React.useState('');
  const names = new Map(options.map((o) => [o.guid, o.name]));
  const label = !value.length
    ? 'Healing to everyone'
    : value.length === 1
      ? `Not to ${names.get(value[0]) ?? '?'}`
      : `Not to ${value.length} raiders`;
  const shown = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()),
  );
  const toggle = (guid: string) =>
    onChange(
      value.includes(guid) ? value.filter((v) => v !== guid) : [...value, guid],
    );
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className={`${button} ${value.length ? 'border-brand/60' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Leave out healing done to some raiders"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-[280px] rounded-md border border-card bg-background shadow-xl text-xs">
          <div className="flex items-center gap-x-2 p-2 border-b border-card">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search raiders"
              className="flex-1 bg-card rounded px-2 h-7 text-xs text-foreground-lighter border border-background"
              aria-label="Search raiders"
            />
            {value.length > 0 && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {shown.map((o) => {
              const on = value.includes(o.guid);
              return (
                <button
                  key={o.guid}
                  type="button"
                  onClick={() => toggle(o.guid)}
                  className={`w-full flex items-center gap-x-2 px-2 py-1 text-left ${on ? 'bg-brand/10' : 'hover:bg-card/40'}`}
                  aria-pressed={on}
                >
                  <span
                    className={`w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center ${on ? 'border-brand bg-brand/30' : 'border-card'}`}
                  >
                    {on && <X size={10} />}
                  </span>
                  <span className="truncate" style={{ color: o.color }}>
                    {o.name}
                  </span>
                </button>
              );
            })}
            {!shown.length && (
              <p className="m-0 p-2 text-foreground">No raiders match.</p>
            )}
          </div>
          <div className="px-2 py-1 text-[10px] text-foreground border-t border-card">
            Healing received by ticked raiders is left out of every table and
            chart.
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Buffs/Debuffs: jump to another aura (the ones the raider in view had),
 * by section, with a search box.
 */
export const AuraPicker = ({
  value,
  label,
  groups,
  onChange,
}: {
  value: number;
  label: string;
  groups: { title: string; options: { id: number; name: string }[] }[];
  onChange: (id: number) => void;
}) => {
  const { open, setOpen, box } = usePopover();
  const [search, setSearch] = React.useState('');
  const q = search.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      options: g.options.filter(
        (o) => !q || o.name.toLowerCase().includes(q) || String(o.id) === q,
      ),
    }))
    .filter((g) => g.options.length);
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className={button}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Another buff or debuff"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-[360px] rounded-md border border-card bg-background shadow-xl text-xs">
          <div className="p-2 border-b border-card">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or spell ID"
              className="w-full bg-card rounded px-2 h-7 text-xs text-foreground-lighter border border-background"
              aria-label="Search buffs and debuffs"
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto" role="listbox">
            {shown.map((g) => (
              <div key={g.title}>
                <div className="sticky top-0 px-2 py-1 bg-card text-[10px] uppercase tracking-wide text-foreground">
                  {g.title}
                </div>
                {g.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`w-full flex items-center gap-x-2 px-2 py-1 text-left ${o.id === value ? 'bg-brand/10' : 'hover:bg-card/40'}`}
                  >
                    <SpellIcon spellId={o.id} name={o.name} />
                    <span className="flex-1 truncate text-foreground-lighter">
                      {o.name}
                    </span>
                    <span className="text-[10px] text-foreground tabular-nums">
                      {o.id}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && (
              <p className="m-0 p-2 text-foreground">Nothing matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
