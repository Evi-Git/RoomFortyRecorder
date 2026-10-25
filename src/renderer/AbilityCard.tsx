import React from 'react';
import ReactDOM from 'react-dom';
import { Check, Copy, Plus } from 'lucide-react';

/**
 * [RoomFortyRecorder] Boss ability hover card: hover (or focus) an ability
 * name anywhere in Analysis to see its journal text, spell ID, what it
 * did to the raid, and add it to the boss's avoidable list.
 *
 * Text and icons come from Blizzard's Encounter Journal via the guild server
 * (guild-cloud-server/journal.mjs); cards are cached for the session.
 */

const ipc = window.electron.ipcRenderer;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

export type AbilityCardData = {
  configured: boolean;
  spellId: number;
  name: string | null;
  icon: string | null;
  text: string;
  source: 'journal' | 'spell' | null;
  tags: string[];
  stats: {
    wipes: number;
    deaths: number;
    earlyDeaths: number;
    spellIds?: number[];
    hits?: number;
  } | null;
  avoidable: boolean;
  error: string;
};

const cache = new Map<string, AbilityCardData>();

// Icon images: the app's icon cache first (disk, then the guild server's
// cache, which can serve an HD pack), sent over IPC as a data: URL, then
// Blizzard's and Wowhead's servers.
const ICON_CDNS = [
  (icon: string) =>
    `https://render.worldofwarcraft.com/us/icons/56/${icon}.jpg`,
  (icon: string) => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`,
];

// Data URLs from the app (null = it has none), shared by every icon.
const iconData = new Map<string, string | null>();
const iconDataFlight = new Map<string, Promise<string | null>>();
const loadIconData = (icon: string) => {
  if (iconData.has(icon)) return Promise.resolve(iconData.get(icon) ?? null);
  let job = iconDataFlight.get(icon);
  if (!job) {
    job = (ipc.invoke('iconImage', [icon]) as Promise<string | null>)
      .then((url) =>
        typeof url === 'string' && url.startsWith('data:image/') ? url : null,
      )
      .catch(() => null)
      .then((url) => {
        iconData.set(icon, url);
        iconDataFlight.delete(icon);
        return url;
      });
    iconDataFlight.set(icon, job);
  }
  return job;
};

// A CDN image that neither loads nor fails within this counts as failed.
const ICON_SOURCE_MS = 6000;

// What each icon on screen is doing, for "Copy icon log lines".
const iconStates = new Map<number, string>();
let iconSeq = 0;
export const iconDebugLines = () => {
  const lines = [...iconStates.values()];
  const pending = [...iconDataFlight.keys()];
  const known = [...iconData.entries()].map(
    ([name, url]) => `${name}=${url ? `${url.length}b` : 'none'}`,
  );
  return [
    `[Renderer] ${lines.length} icons on screen; app images known: ${known.length}, still loading: ${pending.length}${pending.length ? ` (${pending.slice(0, 10).join(', ')})` : ''}`,
    ...lines.slice(0, 60).map((l) => `[Renderer] ${l}`),
    `[Renderer] known: ${known.slice(0, 60).join(' ')}`,
  ];
};

/** A spell icon by its name (e.g. "ability_creature_poison_02"). */
// Keyed by the icon name, so an icon that mounted before its name was known
// starts fresh once it arrives (a fresh mount always loads).
export const GameIcon = (props: {
  icon: string | null | undefined;
  className: string;
}) => {
  const { icon } = props;
  return <GameIconInner key={icon ?? ''} {...props} />;
};

const GameIconInner = ({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className: string;
}) => {
  const [data, setData] = React.useState<{
    icon: string;
    url: string | null;
  } | null>(() =>
    icon && iconData.has(icon)
      ? { icon, url: iconData.get(icon) ?? null }
      : null,
  );
  // Which CDN this icon is on, once the app had nothing (a new icon starts over).
  const [cdn, setCdn] = React.useState<{
    icon: string | null | undefined;
    n: number;
  }>({
    icon,
    n: 0,
  });
  const [loaded, setLoaded] = React.useState('');

  React.useEffect(() => {
    if (!icon) return undefined;
    let live = true;
    loadIconData(icon).then((url) => {
      if (live) setData({ icon, url });
    });
    return () => {
      live = false;
    };
  }, [icon]);

  const appData = data && data.icon === icon ? data : null;
  const cdnIndex = cdn.icon === icon ? cdn.n : 0;
  let src = '';
  if (icon && appData) {
    if (appData.url && cdnIndex === 0) src = appData.url;
    else {
      const i = appData.url ? cdnIndex - 1 : cdnIndex;
      if (i < ICON_CDNS.length) src = ICON_CDNS[i](icon);
    }
  }

  const next = React.useCallback(
    () => setCdn({ icon, n: cdnIndex + 1 }),
    [icon, cdnIndex],
  );

  React.useEffect(() => {
    if (!src || src.startsWith('data:') || loaded === src) return undefined;
    const timer = setTimeout(next, ICON_SOURCE_MS);
    return () => clearTimeout(timer);
  }, [src, loaded, next]);

  const [seq] = React.useState(() => (iconSeq += 1));
  iconStates.set(
    seq,
    `${icon || '(no name)'}: app ${appData ? (appData.url ? 'has image' : 'has none') : 'loading'}, source ${cdnIndex}, ${src ? (src.startsWith('data:') ? 'data' : 'cdn') : 'blank'}${loaded && loaded === src ? ', drawn' : ''}`,
  );
  React.useEffect(
    () => () => {
      iconStates.delete(seq);
    },
    [seq],
  );

  if (!src) {
    return <span className={`${className} border border-card bg-card/50`} />;
  }
  return (
    <img
      key={src.length > 200 ? `data:${icon}` : src}
      src={src}
      alt=""
      draggable={false}
      onLoad={() => setLoaded(src)}
      onError={next}
      className={className}
    />
  );
};

const DIFFICULTY: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  233: 'Mythic',
};

const TAG_LABEL: Record<string, string> = {
  tank: 'Tank',
  healer: 'Healer',
  damage: 'Damage',
  heroic: 'Heroic',
  mythic: 'Mythic',
  deadly: 'Deadly',
  important: 'Important',
  interruptible: 'Interruptible',
  magic: 'Magic',
  curse: 'Curse',
  poison: 'Poison',
  disease: 'Disease',
  enrage: 'Enrage',
  bleed: 'Bleed',
};

export const tagLabel = (tag: string) => TAG_LABEL[tag] ?? tag;

/** "Digestive Juices (raid-wide)" -> "Digestive Juices" */
export const abilityName = (name: string) =>
  name.replace(/ \(raid-wide\)$/, '');

const keyOf = (spellId: number, encounterId?: number, difficultyId?: number) =>
  `${spellId}:${encounterId ?? ''}:${difficultyId ?? ''}`;

/** Forget cached cards, e.g. after the avoidable list changed. */
export const clearAbilityCards = () => cache.clear();

type Props = {
  name: string;
  spellId?: number | null;
  encounterId?: number;
  difficultyId?: number;
  canEdit?: boolean;
  className?: string;
};

const CARD_WIDTH = 380;

/**
 * An ability name with a hover card. Without a spell ID it's plain text.
 */
const AbilityName = (props: Props) => {
  const { name, spellId, encounterId, difficultyId, canEdit, className } =
    props;
  const anchor = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ left: 0, top: 0, above: false });
  const [data, setData] = React.useState<AbilityCardData | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  React.useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  if (!spellId) return <span className={className}>{name}</span>;

  const load = async () => {
    const key = keyOf(spellId, encounterId, difficultyId);
    const hit = cache.get(key);
    if (hit) {
      setData(hit);
      return;
    }
    const response = await call<AbilityCardData>({
      action: 'journalSpell',
      spellId,
      encounterId,
      difficultyId,
      name: abilityName(name),
    });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    cache.set(key, response.data);
    setData(response.data);
  };

  const show = () => {
    clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - CARD_WIDTH - 8,
      );
      // Below the name, or above it near the bottom of the window.
      const below = rect.bottom + 6;
      const above = below + 300 > window.innerHeight;
      setPos({ left, top: above ? rect.top - 6 : below, above });
      setOpen(true);
      load();
    }, 250);
  };

  const hide = () => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 200);
  };

  const toggleAvoidable = async () => {
    if (!data || !encounterId) return;
    setBusy(true);
    const response = await call({
      action: 'avoidableToggle',
      encounterId,
      spellId,
      name: data.name ?? abilityName(name),
      on: !data.avoidable,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    clearAbilityCards();
    setData({ ...data, avoidable: !data.avoidable });
  };

  const copyId = () => {
    navigator.clipboard?.writeText(String(spellId)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const card = open
    ? ReactDOM.createPortal(
        <div
          role="dialog"
          aria-label={abilityName(name)}
          onMouseEnter={() => clearTimeout(hideTimer.current)}
          onMouseLeave={hide}
          className="fixed z-50 rounded-lg border border-card bg-background p-3 shadow-2xl flex flex-col gap-y-2.5 text-sm"
          style={{
            left: pos.left,
            top: pos.top,
            width: CARD_WIDTH,
            transform: pos.above ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className="flex items-center gap-x-3">
            <GameIcon
              icon={data?.icon}
              className="w-10 h-10 rounded border border-brand/60 shrink-0"
            />
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-foreground-lighter truncate">
                {data?.name ?? abilityName(name)}
              </span>
              <span className="text-xs text-foreground">
                {difficultyId ? (
                  <span className="text-brand">
                    {DIFFICULTY[difficultyId] ?? `Difficulty ${difficultyId}`}
                  </span>
                ) : null}
                {difficultyId ? ' · ' : ''}
                Spell ID {spellId}
              </span>
            </div>
            <button
              type="button"
              aria-label="Copy spell ID"
              title="Copy spell ID"
              onClick={copyId}
              className="ml-auto w-8 h-8 rounded border border-card flex items-center justify-center hover:text-foreground-lighter"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>

          {data && data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-card text-foreground-lighter"
                >
                  {tagLabel(tag)}
                </span>
              ))}
            </div>
          )}

          {!data && !error && (
            <p className="text-xs text-foreground">Loading…</p>
          )}
          {data?.text && (
            <p className="m-0 text-[13px] leading-relaxed text-foreground-lighter/90 whitespace-pre-line max-h-48 overflow-y-auto">
              {data.text}
            </p>
          )}
          {data && !data.text && (
            <p className="text-xs text-foreground">
              No tooltip text for this spell yet.
            </p>
          )}

          {data?.stats && (
            <div className="grid grid-cols-3 gap-2 rounded-md bg-background-higher p-2">
              <div className="flex flex-col">
                <span className="text-base font-semibold text-foreground-lighter">
                  {data.stats.wipes}
                </span>
                <span className="text-[11px] text-foreground">
                  pulls it ended
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-base font-semibold text-foreground-lighter">
                  {data.stats.deaths}
                </span>
                <span className="text-[11px] text-foreground">
                  raiders killed
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-base font-semibold text-foreground-lighter">
                  {data.stats.earlyDeaths}
                </span>
                <span className="text-[11px] text-foreground">
                  early deaths
                </span>
              </div>
              {(data.stats.spellIds ?? []).some((id) => id !== spellId) && (
                <span className="col-span-3 text-[11px] text-foreground">
                  Hits as{' '}
                  {(data.stats.spellIds ?? [])
                    .filter((id) => id !== spellId)
                    .slice(0, 6)
                    .join(', ')}
                </span>
              )}
              <span className="col-span-3 text-[11px] text-foreground/70">
                All your pulls on this boss
                {difficultyId
                  ? ` on ${DIFFICULTY[difficultyId] ?? 'this difficulty'}`
                  : ''}
              </span>
            </div>
          )}

          {canEdit && encounterId && data && (
            <button
              type="button"
              disabled={busy}
              onClick={toggleAvoidable}
              className={`h-9 rounded-md text-[13px] font-semibold flex items-center justify-center gap-x-1.5 ${
                data.avoidable
                  ? 'border border-brand text-brand'
                  : 'bg-brand text-background'
              }`}
            >
              {data.avoidable ? <Check size={14} /> : <Plus size={14} />}
              {data.avoidable
                ? 'On the avoidable list (click to remove)'
                : 'Add to avoidable for this boss'}
            </button>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <span
        ref={anchor}
        role="button"
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`underline decoration-dotted decoration-foreground/50 underline-offset-[3px] cursor-help ${className ?? ''}`}
      >
        {name}
      </span>
      {card}
    </>
  );
};

export default AbilityName;

type Scope = {
  encounterId?: number;
  difficultyId?: number;
  spellIds?: Record<string, number>;
  canEdit?: boolean;
};

const AbilityContext = React.createContext<Scope>({});

/** Which boss and difficulty the ability names inside belong to. */
export const AbilityScope = ({
  children,
  ...scope
}: Scope & { children: React.ReactNode }) => {
  const { encounterId, difficultyId, spellIds, canEdit } = scope;
  const value = React.useMemo(
    () => ({ encounterId, difficultyId, spellIds, canEdit }),
    [encounterId, difficultyId, spellIds, canEdit],
  );
  return (
    <AbilityContext.Provider value={value}>{children}</AbilityContext.Provider>
  );
};

/**
 * An ability name inside an AbilityScope: finds its spell ID by name and
 * shows the hover card. `spellId` overrides the lookup.
 */
export const Ability = ({
  name,
  spellId,
  className,
}: {
  name: string;
  spellId?: number | null;
  className?: string;
}) => {
  const scope = React.useContext(AbilityContext);
  const id = spellId ?? scope.spellIds?.[abilityName(name)] ?? null;
  return (
    <AbilityName
      name={name}
      spellId={id}
      encounterId={scope.encounterId}
      difficultyId={scope.difficultyId}
      canEdit={scope.canEdit}
      className={className}
    />
  );
};
