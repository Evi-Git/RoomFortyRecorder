/**
 * Boss strip for the Logs page (1.9.95): a portrait per boss of the season
 * in raid order, plus a Heroic/Mythic switch, instead of a dropdown.
 * Bosses not pulled this night at the shown difficulty are greyed out.
 */
import React from 'react';
import { Check } from 'lucide-react';
import { GameIcon } from '../AbilityCard';
import {
  SeasonBoss,
  StripNightBoss,
  bossKey,
  initials,
  pickForMode,
  stripItems,
  stripModes,
  stripSummary,
} from './bossStripModel';
import { difficultyName } from './nightCalendar';

const ipc = window.electron.ipcRenderer;

// The season list, once per app window (every tab shares it).
let seasonCache: SeasonBoss[] | null = null;
let seasonFlight: Promise<SeasonBoss[]> | null = null;
export const loadSeason = () => {
  if (seasonCache) return Promise.resolve(seasonCache);
  seasonFlight ??= (
    ipc.invoke('pullDesk', [{ action: 'season' }]) as Promise<
      { ok: true; data: { bosses: SeasonBoss[] } } | { ok: false }
    >
  )
    .then((r) => (r.ok && Array.isArray(r.data?.bosses) ? r.data.bosses : []))
    .catch(() => [] as SeasonBoss[])
    .then((bosses) => {
      // An older server has no list: ask again next time.
      if (bosses.length) seasonCache = bosses;
      seasonFlight = null;
      return bosses;
    });
  return seasonFlight;
};

/** One boss portrait (Logs page strip, Top logs). */
export const BossButton = ({
  encounterId,
  name,
  title,
  picked,
  enabled,
  killed = false,
  onClick,
}: {
  encounterId: number;
  name: string;
  title: string;
  picked: boolean;
  enabled: boolean;
  killed?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    role="option"
    aria-selected={picked}
    aria-label={name}
    title={title}
    disabled={!enabled}
    onClick={onClick}
    className={`relative h-11 w-11 shrink-0 rounded-md overflow-hidden bg-card transition ${
      picked
        ? 'ring-2 ring-white'
        : enabled
          ? 'ring-1 ring-background hover:ring-foreground hover:brightness-110'
          : 'opacity-30 grayscale cursor-default'
    }`}
  >
    <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
      {initials(name)}
    </span>
    <GameIcon
      icon={`wclboss-${encounterId}`}
      className="absolute inset-0 h-full w-full object-cover"
    />
    {killed && (
      <span
        className="absolute bottom-0 right-0 rounded-tl bg-green-600 p-px"
        title="Killed this night"
      >
        <Check size={10} className="text-white" strokeWidth={3} />
      </span>
    )}
  </button>
);

export const MODE_TEXT: Record<string, string> = {
  Mythic: 'text-orange-300',
  Heroic: 'text-purple-300',
  Normal: 'text-green-300',
  LFR: 'text-sky-300',
};

type Props<B extends StripNightBoss> = {
  /** This night's bosses (every difficulty). */
  bosses: B[];
  /** The boss shown now. */
  boss: B | undefined;
  onPick: (key: string) => void;
};

const BossStrip = <B extends StripNightBoss>({
  bosses,
  boss,
  onPick,
}: Props<B>) => {
  const [season, setSeason] = React.useState<SeasonBoss[]>(
    () => seasonCache ?? [],
  );
  React.useEffect(() => {
    let live = true;
    loadSeason().then((list) => {
      if (live) setSeason(list);
    });
    return () => {
      live = false;
    };
  }, []);

  const mode = boss ? difficultyName(boss.difficultyId) : 'Mythic';
  const modes = stripModes(bosses);
  const items = stripItems(season, bosses, mode);

  return (
    <div className="flex items-center gap-x-3 flex-wrap gap-y-2">
      <div className="flex items-center gap-x-1.5" role="listbox">
        {items.map((item) => {
          const picked = Boolean(
            item.boss && boss?.encounterId === item.encounterId,
          );
          const title = item.boss
            ? `${item.name} — ${stripSummary(item.boss)}`
            : `${item.name} — not pulled this night on ${mode}`;
          return (
            <BossButton
              key={item.encounterId}
              encounterId={item.encounterId}
              name={item.name}
              title={title}
              picked={picked}
              enabled={Boolean(item.boss)}
              killed={Boolean(item.boss && item.boss.kills > 0)}
              onClick={() => item.boss && onPick(bossKey(item.boss))}
            />
          );
        })}
      </div>
      <div className="flex rounded-lg border border-card bg-background/60 p-0.5">
        {modes.map(({ mode: m, count }) => {
          const on = m === mode;
          return (
            <button
              key={m}
              type="button"
              disabled={!count}
              title={
                count
                  ? `${count} ${count === 1 ? 'boss' : 'bosses'} on ${m} this night`
                  : `No ${m} pulls this night`
              }
              onClick={() => {
                if (on) return;
                const next = pickForMode(bosses, m, boss?.encounterId ?? null);
                if (next) onPick(bossKey(next));
              }}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                on
                  ? `bg-card ${MODE_TEXT[m] ?? 'text-foreground-lighter'}`
                  : count
                    ? 'text-foreground hover:text-foreground-lighter'
                    : 'text-foreground/40 cursor-default'
              }`}
            >
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BossStrip;
