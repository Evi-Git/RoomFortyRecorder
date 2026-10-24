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

// Icon names come from the app's own icon cache (main process, kept on
// disk: the guild server's spell cache, then Wowhead), separate from the
// tooltip text so a slow or failed text lookup never leaves a blank icon.
// Missing ones are asked again with growing gaps while they're on screen.
const icons = new Map<number, string>();
const iconWanted = new Set<number>();
const iconTries = new Map<number, number>();
let iconTimer: ReturnType<typeof setTimeout> | null = null;
let iconBusy = false;

const scheduleIcons = (ms: number) => {
  if (!iconTimer) iconTimer = setTimeout(flushIcons, ms);
};

const flushIcons = async () => {
  iconTimer = null;
  if (iconBusy) {
    scheduleIcons(500);
    return;
  }
  // A few dozen at a time, so the first ones show while the rest load.
  const ids = [...iconWanted].slice(0, 40);
  if (!ids.length) return;
  iconBusy = true;
  try {
    const got = (await ipc.invoke('spellIcons', [ids])) as Record<
      string,
      string
    > | null;
    ids.forEach((id) => {
      const icon = got?.[id];
      if (icon) {
        icons.set(id, icon);
        iconWanted.delete(id);
        return;
      }
      const n = (iconTries.get(id) ?? 0) + 1;
      iconTries.set(id, n);
      if (n >= 6) iconWanted.delete(id);
    });
  } catch {
    ids.forEach((id) => iconTries.set(id, (iconTries.get(id) ?? 0) + 1));
  } finally {
    iconBusy = false;
    notify();
    if (iconWanted.size) {
      const worst = Math.max(
        0,
        ...[...iconWanted].map((id) => iconTries.get(id) ?? 0),
      );
      scheduleIcons(worst ? Math.min(30000, 1500 * 2 ** worst) : 50);
    }
  }
};

const askIcon = (id: number) => {
  if (id <= 1 || icons.has(id) || iconWanted.has(id)) return;
  if ((iconTries.get(id) ?? 0) >= 6) return;
  iconWanted.add(id);
  scheduleIcons(60);
};

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
          if (!known.get(id)) known.set(id, null);
        }
      });
    } else {
      ids.forEach((id) => {
        const info = response.data.spells[id];
        if (info) {
          known.set(id, info);
          if (info.icon && !icons.has(id)) icons.set(id, info.icon);
          wanted.delete(id);
        }
      });
      // The server fetches a few at a time; anything left comes next call.
      // Ones it couldn't get (Wowhead busy) are asked again a few times.
      if (response.data.pending === 0) {
        ids.forEach((id) => {
          if (!wanted.has(id)) return;
          const n = (tries.get(id) ?? 0) + 1;
          tries.set(id, n);
          if (n >= 4) {
            if (!known.get(id)) known.set(id, null);
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

/**
 * Many spells' text, once the server has answered for all of them (or given
 * up on some): for reading damage reductions out of buff descriptions.
 */
export const loadSpellTexts = (ids: number[]) =>
  new Promise<Map<number, SpellInfo>>((resolve) => {
    const list = [...new Set(ids)].filter((id) => id > 1);
    // Ones only the app's own icon lookup filled in still need the server.
    list.forEach((id) => {
      if (!known.has(id) || (!known.get(id)?.text && !tries.has(id))) {
        if (!wanted.has(id)) wanted.add(id);
      }
    });
    if (!timer && wanted.size) timer = setTimeout(flush, 60);
    const done = () => list.every((id) => !wanted.has(id));
    const finish = () => {
      listeners.delete(check);
      const out = new Map<number, SpellInfo>();
      list.forEach((id) => {
        const info = known.get(id);
        if (info) out.set(id, info);
      });
      resolve(out);
    };
    const check = () => {
      if (done()) finish();
    };
    if (done()) finish();
    else listeners.add(check);
  });

/** A spell's icon and text, filled in once the server has it. */
export const useSpell = (id: number): SpellInfo | null => {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    ask(id);
    askIcon(id);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, [id]);
  const info = known.get(id) ?? null;
  const icon = icons.get(id) ?? info?.icon ?? null;
  return info || icon
    ? { name: info?.name ?? null, text: info?.text ?? '', icon }
    : null;
};

/** What the icon lookup knows, for the tooltip. */
const iconStatus = (id: number) => {
  if (icons.has(id)) return `icon ${icons.get(id)}`;
  if (iconWanted.has(id)) return 'icon: looking up';
  return 'no icon found';
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
                  {spellId > 1
                    ? `Spell ${spellId} · ${iconStatus(spellId)}`
                    : 'Auto attack'}
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

// Warcraft Logs' names for spells that share a name ("Eviscerate (Ancient
// Arts)"), from the guild server (cached there for good).
const labels = new Map<number, string | null>();
const labelWanted = new Set<number>();
let labelTimer: ReturnType<typeof setTimeout> | null = null;

const flushLabels = async () => {
  labelTimer = null;
  const ids = [...labelWanted].slice(0, 60);
  ids.forEach((id) => labelWanted.delete(id));
  if (!ids.length) return;
  try {
    const response = (await ipc.invoke('pullDesk', [
      { action: 'spellNames', ids },
    ])) as Response<{ names: Record<string, string | null> }>;
    ids.forEach((id) =>
      labels.set(id, response.ok ? (response.data.names[id] ?? null) : null),
    );
  } catch {
    ids.forEach((id) => labels.set(id, null));
  }
  notify();
  if (labelWanted.size) labelTimer = setTimeout(flushLabels, 200);
};

/** Warcraft Logs' names for these spells, as they arrive. */
export const useSpellLabels = (ids: number[]) => {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const key = [...new Set(ids)].sort((a, b) => a - b).join(',');
  React.useEffect(() => {
    listeners.add(bump);
    key
      .split(',')
      .filter(Boolean)
      .map(Number)
      .forEach((id) => {
        if (!labels.has(id)) labelWanted.add(id);
      });
    if (labelWanted.size && !labelTimer)
      labelTimer = setTimeout(flushLabels, 60);
    return () => {
      listeners.delete(bump);
    };
  }, [key]);
  return labels;
};
