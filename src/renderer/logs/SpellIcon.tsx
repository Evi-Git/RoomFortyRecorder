import React from 'react';
import ReactDOM from 'react-dom';
import { GameIcon } from '../AbilityCard';

/**
 * [RoomFortyRecorder] Logs page spell icons with a hover tooltip (name,
 * spell ID and Wowhead's tooltip text), fetched through the guild server's
 * spell cache in batches and kept for the session.
 */

type SpellInfo = { name: string | null; text: string; icon: string | null };
type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const ipc = window.electron.ipcRenderer;
const known = new Map<number, SpellInfo | null>();
const wanted = new Set<number>();
const tries = new Map<number, number>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

const notify = () => listeners.forEach((fn) => fn());

const flush = async () => {
  timer = null;
  if (busy) return;
  const ids = [...wanted].slice(0, 120);
  if (!ids.length) return;
  busy = true;
  try {
    const response = (await ipc.invoke('pullDesk', [
      { action: 'journalSpells', ids },
    ])) as Response<{
      spells: Record<string, SpellInfo>;
      pending: number;
    }>;
    if (!response.ok) {
      // The server couldn't answer: try again a few times, then give up.
      ids.forEach((id) => {
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        if (n >= 4) {
          wanted.delete(id);
          known.set(id, null);
        }
      });
    } else {
      ids.forEach((id) => {
        const info = response.data.spells[id];
        if (info) {
          known.set(id, info);
          wanted.delete(id);
        }
      });
      // The server fetches a few at a time; anything left comes next call.
      // Ones it couldn't get (Wowhead busy) are asked again a few times.
      if (response.data.pending === 0) {
        ids.forEach((id) => {
          if (known.has(id)) return;
          const n = (tries.get(id) ?? 0) + 1;
          tries.set(id, n);
          if (n >= 4) {
            known.set(id, null);
            wanted.delete(id);
          }
        });
      }
    }
  } catch {
    ids.forEach((id) => wanted.delete(id));
  } finally {
    busy = false;
    notify();
    if (wanted.size) timer = setTimeout(flush, tries.size ? 2500 : 1200);
  }
};

const ask = (id: number) => {
  if (id <= 1 || known.has(id) || wanted.has(id)) return;
  wanted.add(id);
  if (!timer) timer = setTimeout(flush, 60);
};

/** A spell's icon and text, filled in once the server has it. */
export const useSpell = (id: number): SpellInfo | null => {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    ask(id);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, [id]);
  return known.get(id) ?? null;
};

const MELEE_ICON = 'inv_sword_04';

/** A small spell icon; hover for its tooltip. */
const SpellIcon = ({ spellId, name }: { spellId: number; name?: string }) => {
  const info = useSpell(spellId);
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  const icon = spellId === 1 ? MELEE_ICON : info?.icon;
  return (
    <span
      className="inline-flex shrink-0 align-middle"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ x: r.left, y: r.bottom + 6 });
      }}
      onMouseLeave={() => setAt(null)}
    >
      <GameIcon
        icon={icon}
        className="w-[18px] h-[18px] rounded-[3px] border border-black/40"
      />
      {at &&
        ReactDOM.createPortal(
          <div
            className="fixed z-[100] w-[320px] rounded-md border border-card bg-background p-2.5 shadow-xl pointer-events-none text-xs"
            style={{
              left: Math.min(at.x, window.innerWidth - 336),
              top: Math.min(at.y, window.innerHeight - 160),
            }}
          >
            <div className="flex items-center gap-x-2 mb-1">
              <GameIcon icon={icon} className="w-8 h-8 rounded" />
              <div className="min-w-0">
                <div className="font-semibold text-sm text-foreground-lighter truncate">
                  {info?.name || name || 'Unknown spell'}
                </div>
                <div className="text-foreground">
                  {spellId > 1 ? `Spell ${spellId}` : 'Auto attack'}
                </div>
              </div>
            </div>
            {info?.text ? (
              <p className="m-0 text-foreground-lighter whitespace-pre-line leading-snug">
                {info.text}
              </p>
            ) : (
              spellId > 1 && (
                <p className="m-0 text-foreground">
                  {known.has(spellId) ? 'No description.' : 'Loading…'}
                </p>
              )
            )}
          </div>,
          document.body,
        )}
    </span>
  );
};

export default SpellIcon;
