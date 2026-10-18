import React from 'react';
import { ListFilter, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover/Popover';
import SpellIcon from './SpellIcon';
import { KIND_LABEL, Row } from './timelineUtils';

/**
 * [RoomFortyRecorder] The timeline's Spells menu: every boss, add and own
 * spell in the pull with its icon and cast count, search, and All/None per
 * group. Hidden spell IDs are kept by the parent.
 */

interface IProps {
  rows: Row[];
  icons: Record<string, string>;
  hiddenSpells: number[];
  setHiddenSpells: React.Dispatch<React.SetStateAction<number[]>>;
}

const SpellFilterMenu = ({
  rows,
  icons,
  hiddenSpells,
  setHiddenSpells,
}: IProps) => {
  const [search, setSearch] = React.useState('');
  const hiddenSet = React.useMemo(() => new Set(hiddenSpells), [hiddenSpells]);

  // Every spell per row, most cast first.
  const spellLists = React.useMemo(
    () =>
      rows.map((row) => {
        const counts = new Map<number, { name: string; count: number }>();
        row.items.forEach((item) => {
          const entry = counts.get(item.spellId) || {
            name: item.name,
            count: 0,
          };
          entry.count += 1;
          counts.set(item.spellId, entry);
        });
        return {
          row,
          spells: [...counts.entries()]
            .map(([spellId, entry]) => ({ spellId, ...entry }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        };
      }),
    [rows],
  );

  const toggleSpell = (spellId: number) =>
    setHiddenSpells((list) =>
      list.includes(spellId)
        ? list.filter((id) => id !== spellId)
        : [...list, spellId],
    );

  const setGroup = (spellIds: number[], show: boolean) =>
    setHiddenSpells((list) => {
      const without = list.filter((id) => !spellIds.includes(id));
      return show ? without : [...without, ...spellIds];
    });

  const hiddenHere = spellLists.reduce(
    (n, { spells }) =>
      n + spells.filter((x) => hiddenSet.has(x.spellId)).length,
    0,
  );

  const query = search.trim().toLowerCase();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-x-1 px-2 rounded text-[11px] border ${
            hiddenHere
              ? 'border-brand/70 text-brand'
              : 'border-foreground/30 text-foreground'
          }`}
          title="Choose which spells show on the timeline"
        >
          <ListFilter size={12} />
          Spells{hiddenHere ? ` · ${hiddenHere} hidden` : ''}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0 text-xs text-foreground-lighter"
      >
        <div className="flex items-center gap-x-2 border-b border-background px-3 py-2">
          <Search size={13} className="text-foreground/50" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a spell"
            className="flex-1 bg-transparent outline-none placeholder:text-foreground/40"
          />
          {hiddenHere > 0 && (
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() =>
                setGroup(
                  spellLists.flatMap(({ spells }) =>
                    spells.map((x) => x.spellId),
                  ),
                  true,
                )
              }
            >
              Show all
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {spellLists.map(({ row, spells }) => {
            const shown = spells.filter(
              (x) => !query || x.name.toLowerCase().includes(query),
            );
            if (!shown.length) return null;
            const ids = shown.map((x) => x.spellId);
            return (
              <div key={row.key} className="pb-1">
                <div className="flex items-center px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-foreground/50">
                  <span className="flex-1 truncate">
                    {KIND_LABEL[row.kind]}
                    {row.kind !== 'enemy' && row.label !== KIND_LABEL[row.kind]
                      ? ` · ${row.label}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="normal-case hover:text-brand"
                    onClick={() => setGroup(ids, true)}
                  >
                    All
                  </button>
                  <span className="px-1">/</span>
                  <button
                    type="button"
                    className="normal-case hover:text-brand"
                    onClick={() => setGroup(ids, false)}
                  >
                    None
                  </button>
                </div>
                {shown.map((spell) => {
                  const on = !hiddenSet.has(spell.spellId);
                  return (
                    <label
                      key={spell.spellId}
                      className="flex items-center gap-x-2 px-3 py-1 cursor-pointer hover:bg-background/40"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleSpell(spell.spellId)}
                        className="accent-[hsl(var(--brand))]"
                      />
                      <SpellIcon
                        spellId={spell.spellId}
                        name={spell.name}
                        icon={icons[spell.spellId]}
                        size={18}
                        className={on ? '' : 'opacity-40 grayscale'}
                      />
                      <span
                        className={`flex-1 truncate ${on ? '' : 'text-foreground/40'}`}
                      >
                        {spell.name}
                      </span>
                      <span className="text-foreground/50">{spell.count}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SpellFilterMenu;
