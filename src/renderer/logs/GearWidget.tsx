// Reads the item cache (filled after a render), so the React Compiler must
// not memoize here (see CLAUDE.md).
'use no memo';

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Ctx } from './query';
import { GearItem } from './store';
import { classColor } from './format';
import { GameIcon } from '../AbilityCard';

/**
 * [RoomFortyRecorder] Summary widget: each raider's item level, missing
 * enchants and gems, from what they wore at the pull (COMBATANT_INFO).
 * Click a raider to see their gear. Item names, quality and icons come
 * from Blizzard through the guild server.
 */

const ipc = window.electron.ipcRenderer;
type Response<T> = { ok: true; data: T } | { ok: false; error: string };

type ItemInfo = {
  name: string;
  quality: string;
  slot: string;
  icon: string | null;
};

export const SLOT_NAMES = [
  'Head',
  'Neck',
  'Shoulders',
  'Shirt',
  'Chest',
  'Waist',
  'Legs',
  'Feet',
  'Wrist',
  'Hands',
  'Ring 1',
  'Ring 2',
  'Trinket 1',
  'Trinket 2',
  'Back',
  'Main hand',
  'Off hand',
  'Tabard',
];

/** Slots that take an enchant this expansion (off hand: weapons only). */
export const ENCHANTABLE = new Set([0, 2, 4, 6, 7, 10, 11, 15]);

const QUALITY: Record<string, string> = {
  POOR: '#9d9d9d',
  COMMON: '#ffffff',
  UNCOMMON: '#1eff00',
  RARE: '#0070dd',
  EPIC: '#a335ee',
  LEGENDARY: '#ff8000',
  ARTIFACT: '#e6cc80',
  HEIRLOOM: '#00ccff',
};

/** Equipped item level the way the game works it out. */
export const averageIlvl = (gear: GearItem[]) => {
  const by = new Map(gear.map((g) => [g.slot, g]));
  let sum = 0;
  for (let slot = 0; slot < 17; slot += 1) {
    if (slot === 3) continue; // shirt
    if (slot === 16 && !by.has(16)) {
      // A two-hander counts twice.
      sum += by.get(15)?.ilvl ?? 0;
    } else sum += by.get(slot)?.ilvl ?? 0;
  }
  return sum / 16;
};

/** Each raider's gear from the last pull they were in. */
export const gearRows = (ctx: Ctx) => {
  const out = new Map<
    string,
    { guid: string; name: string; specId: number; gear: GearItem[] }
  >();
  ctx.pulls.forEach((p) =>
    p.units.forEach((u) => {
      if (u.raider && u.player && u.gear?.length)
        out.set(u.guid, {
          guid: u.guid,
          name: u.name,
          specId: u.specId,
          gear: u.gear,
        });
    }),
  );
  return [...out.values()].map((r) => {
    const missing = r.gear.filter(
      (g) => ENCHANTABLE.has(g.slot) && !g.enchants.length,
    ).length;
    return {
      ...r,
      ilvl: averageIlvl(r.gear),
      missing,
      gems: r.gear.reduce((n, g) => n + g.gems.length, 0),
    };
  });
};

// Item info for the session, filled from the guild server.
const items = new Map<number, ItemInfo | null>();
const useItems = (ids: number[]) => {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const key = [...new Set(ids)].sort((a, b) => a - b).join(',');
  React.useEffect(() => {
    const want = key
      .split(',')
      .map(Number)
      .filter((id) => id > 0 && !items.has(id));
    if (!want.length) return undefined;
    let cancelled = false;
    let tries = 0;
    const ask = async () => {
      const response = (await ipc.invoke('pullDesk', [
        { action: 'journalItems', ids: want.filter((id) => !items.has(id)) },
      ])) as Response<{ items: Record<string, ItemInfo>; pending: number }>;
      if (cancelled) return;
      if (response.ok) {
        Object.entries(response.data.items).forEach(([id, info]) =>
          items.set(Number(id), info),
        );
        bump();
        tries += 1;
        if (response.data.pending > 0 && tries < 6) setTimeout(ask, 3000);
      }
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return items;
};

const th = 'px-2 py-1.5 font-normal whitespace-nowrap';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';

const GearList = ({ gear }: { gear: GearItem[] }) => {
  const info = useItems(gear.flatMap((g) => [g.itemId, ...g.gems]));
  // Shirt and tabard are cosmetic.
  const sorted = gear
    .filter((g) => g.slot !== 3 && g.slot !== 17)
    .sort((a, b) => a.slot - b.slot);
  return (
    <table className="w-full text-sm">
      <tbody>
        {sorted.map((g) => {
          const item = info.get(g.itemId);
          const needsEnchant = ENCHANTABLE.has(g.slot);
          return (
            <tr key={g.slot} className="border-b border-card/40">
              <td className={`${td} text-xs text-foreground w-[90px]`}>
                {SLOT_NAMES[g.slot] ?? g.slot}
              </td>
              <td className={td}>
                <span className="inline-flex items-center gap-x-2">
                  <GameIcon
                    icon={item?.icon}
                    className="w-[22px] h-[22px] rounded-[3px] border border-black/40"
                  />
                  <span
                    style={{
                      color: QUALITY[item?.quality ?? ''] ?? undefined,
                    }}
                    title={`Item ${g.itemId}${g.bonusIds.length ? ` · bonus ${g.bonusIds.join(':')}` : ''}`}
                  >
                    {item?.name || `Item ${g.itemId}`}
                  </span>
                </span>
              </td>
              <td className={`${td} text-right text-foreground-lighter`}>
                {g.ilvl}
              </td>
              <td className={`${td} text-xs`}>
                {g.enchants.length ? (
                  <span
                    className="text-green-400"
                    title={`Enchant ${g.enchants.join(', ')}`}
                  >
                    Enchanted
                  </span>
                ) : needsEnchant ? (
                  <span className="text-yellow-400">No enchant</span>
                ) : (
                  ''
                )}
              </td>
              <td className={`${td} text-xs`}>
                <span className="inline-flex items-center gap-x-1.5">
                  {g.gems.map((gem, i) => {
                    const gi = info.get(gem);
                    return (
                      <span
                        // A gem can be in twice.

                        key={`${gem}-${i}`}
                        className="inline-flex items-center gap-x-1"
                        title={gi?.name || `Gem ${gem}`}
                      >
                        <GameIcon
                          icon={gi?.icon}
                          className="w-[16px] h-[16px] rounded-[2px]"
                        />
                      </span>
                    );
                  })}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const GearWidget = ({ ctx }: { ctx: Ctx }) => {
  const rows = React.useMemo(
    () => gearRows(ctx).sort((a, b) => b.ilvl - a.ilvl),
    [ctx],
  );
  const [open, setOpen] = React.useState<string | null>(null);
  if (!rows.length) return null;
  const avg = rows.reduce((n, r) => n + r.ilvl, 0) / rows.length;
  return (
    <section className="rounded-md border border-card bg-background/40 overflow-hidden">
      <h4 className="m-0 px-3 py-2 text-sm font-semibold text-foreground-lighter bg-card/40">
        Item level · raid average {avg.toFixed(1)}
      </h4>
      <div className="p-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-foreground">
            <tr>
              <th className={`${th} text-left`}>Raider</th>
              <th className={`${th} text-right`}>Item level</th>
              <th className={`${th} text-right`}>Missing enchants</th>
              <th className={`${th} text-right`}>Gems</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.guid}>
                <tr
                  className="cursor-pointer hover:bg-card/30 border-b border-card/40"
                  onClick={() => setOpen(open === r.guid ? null : r.guid)}
                  title="Show their gear"
                >
                  <td className={td}>
                    <span className="inline-flex items-center gap-x-1">
                      {open === r.guid ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span
                        className="font-semibold"
                        style={{ color: classColor(r.specId) }}
                      >
                        {r.name}
                      </span>
                    </span>
                  </td>
                  <td className={`${td} text-right text-foreground-lighter`}>
                    {r.ilvl.toFixed(1)}
                  </td>
                  <td
                    className={`${td} text-right ${r.missing ? 'text-yellow-400' : 'text-foreground'}`}
                  >
                    {r.missing || '–'}
                  </td>
                  <td className={`${td} text-right text-foreground`}>
                    {r.gems}
                  </td>
                </tr>
                {open === r.guid && (
                  <tr>
                    <td colSpan={4} className="bg-card/10 px-4 py-2">
                      <GearList gear={r.gear} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default GearWidget;
