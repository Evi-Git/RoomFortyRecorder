import React from 'react';
import { Snowflake, Play, Square } from 'lucide-react';
import { Button } from './components/Button/Button';
import { Input } from './components/Input/Input';

/**
 * [RoomFortyRecorder] Top-guild watcher (server: guild-cloud-server/
 * watcher.mjs). 1-3 guilds that log publicly, crawled from Warcraft Logs
 * for their Mythic progression: every pull on each boss up to the first
 * kill. Frozen (no automatic crawls) until an officer unfreezes it.
 */

const ipc = window.electron.ipcRenderer;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

export type WatchedBoss = {
  encounterId: number;
  name: string;
  pulls: number;
  nights: number;
  best: number;
  kill: { pull: number; at: number; night: string } | null;
  series: {
    n: number;
    at: number;
    night: string;
    percent: number;
    kill: boolean;
  }[];
};

export type WatchedGuild = {
  name: string;
  realm: string;
  region: string;
  updatedAt?: number;
  bosses?: Record<string, WatchedBoss>;
};

export type WatcherState = {
  settings: {
    zoneName: string;
    frozen: boolean;
    guilds: { name: string; realm: string; region: string }[];
  };
  officer: boolean;
  configured: boolean;
  status: {
    running: boolean;
    startedAt: number | null;
    finishedAt: number | null;
    log: string[];
    error: string;
  };
  results: { zone?: { id: number; name: string }; guilds: WatchedGuild[] };
};

export const guildKey = (g: { name: string; realm: string }) =>
  `${g.name}-${g.realm}`.toLowerCase();

export const loadWatcher = () => call<WatcherState>({ action: 'watcher' });

const date = (at: number) =>
  new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

/** The watched guilds on one boss, next to Room Forty. */
export const WatcherTable = ({
  state,
  encounterId,
  encounterName,
  home,
}: {
  state: WatcherState;
  encounterId: number;
  encounterName: string;
  home: {
    pulls: number;
    kill: number | null;
    nights: number;
    best: number | null;
  };
}) => {
  const rows = state.results.guilds.map((g) => {
    const boss =
      g.bosses?.[encounterId] ??
      Object.values(g.bosses ?? {}).find((b) => b.name === encounterName);
    return { guild: g, boss };
  });

  const cell = 'px-2 py-1 text-right tabular-nums';
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-foreground border-b border-card">
        <tr>
          <th className="px-2 py-1 text-left font-normal">Guild</th>
          <th className="px-2 py-1 text-right font-normal">Pulls</th>
          <th className="px-2 py-1 text-right font-normal">Nights</th>
          <th className="px-2 py-1 text-right font-normal">Best</th>
          <th className="px-2 py-1 text-right font-normal">Killed</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-card/40">
          <td className="px-2 py-1 text-foreground-lighter">Room Forty</td>
          <td className={cell}>{home.pulls}</td>
          <td className={cell}>{home.nights}</td>
          <td className={cell}>
            {home.kill ? 'Kill' : home.best === null ? '–' : `${home.best}%`}
          </td>
          <td className={cell}>{home.kill ? `pull ${home.kill}` : '–'}</td>
        </tr>
        {rows.map(({ guild, boss }) => (
          <tr key={guildKey(guild)} className="border-b border-card/40">
            <td className="px-2 py-1">
              {guild.name}{' '}
              <span className="text-xs text-foreground">
                {guild.realm}-{guild.region.toUpperCase()}
              </span>
            </td>
            {boss ? (
              <>
                <td className={cell}>{boss.pulls}</td>
                <td className={cell}>{boss.nights}</td>
                <td className={cell}>{boss.kill ? 'Kill' : `${boss.best}%`}</td>
                <td className={cell}>
                  {boss.kill
                    ? `pull ${boss.kill.pull} · ${date(boss.kill.at)}`
                    : '–'}
                </td>
              </>
            ) : (
              <td
                colSpan={4}
                className="px-2 py-1 text-right text-foreground/60"
              >
                {guild.updatedAt ? 'No Mythic pulls logged' : 'Not crawled yet'}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Officers: which guilds to watch, freeze/unfreeze, crawl now. */
export const WatcherSettings = ({
  state,
  onChange,
}: {
  state: WatcherState;
  onChange: () => void;
}) => {
  const [guilds, setGuilds] = React.useState(state.settings.guilds);
  const [zoneName, setZoneName] = React.useState(state.settings.zoneName);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState('');

  const save = async (patch: Record<string, unknown>) => {
    setSaved('');
    const response = await call({ action: 'setWatcher', settings: patch });
    if (!response.ok) {
      setError(response.error);
      return false;
    }
    setError('');
    setSaved('Saved.');
    onChange();
    return true;
  };

  const run = async (action: 'watcherCrawl' | 'watcherStop') => {
    const response = await call({ action });
    if (!response.ok) setError(response.error);
    onChange();
  };

  const { status } = state;
  const update = (i: number, key: 'name' | 'realm' | 'region', value: string) =>
    setGuilds((current) =>
      current.map((g, idx) => (idx === i ? { ...g, [key]: value } : g)),
    );

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center gap-x-3 flex-wrap">
        <span
          className={`flex items-center gap-x-1.5 text-sm ${
            state.settings.frozen ? 'text-sky-300' : 'text-green-400'
          }`}
        >
          <Snowflake size={14} />
          {state.settings.frozen
            ? 'Frozen: no automatic crawls'
            : 'Live: crawls daily at 6 am (server time)'}
        </span>
        {state.officer && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => save({ frozen: !state.settings.frozen })}
          >
            {state.settings.frozen ? 'Unfreeze for a new tier' : 'Freeze'}
          </Button>
        )}
        {state.officer &&
          (status.running ? (
            <Button
              size="xs"
              variant="outline"
              className="gap-x-1"
              onClick={() => run('watcherStop')}
            >
              <Square size={12} /> Stop
            </Button>
          ) : (
            <Button
              size="xs"
              className="gap-x-1"
              disabled={!state.settings.guilds.length || !state.configured}
              onClick={() => run('watcherCrawl')}
            >
              <Play size={12} /> Crawl now
            </Button>
          ))}
        {!state.configured && (
          <span className="text-xs text-red-400">
            Needs the Warcraft Logs API keys in the server&apos;s .env (same as
            recruiting).
          </span>
        )}
      </div>

      {state.officer ? (
        <div className="flex flex-col gap-y-2">
          {guilds.map((g, i) => (
            // Rows have no stable id until saved; index is fine here.
            <div key={i} className="flex items-center gap-x-2">
              <Input
                className="h-8 text-sm"
                placeholder="Guild name"
                value={g.name}
                onChange={(e) => update(i, 'name', e.target.value)}
              />
              <Input
                className="h-8 text-sm"
                placeholder="Realm"
                value={g.realm}
                onChange={(e) => update(i, 'realm', e.target.value)}
              />
              <select
                className="h-8 bg-card text-foreground-lighter rounded-md px-2 text-sm border border-background"
                value={g.region}
                onChange={(e) => update(i, 'region', e.target.value)}
              >
                {['us', 'eu', 'kr', 'tw'].map((r) => (
                  <option key={r} value={r}>
                    {r.toUpperCase()}
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setGuilds((current) => current.filter((_, idx) => idx !== i))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-x-2 flex-wrap">
            <Button
              size="xs"
              variant="outline"
              disabled={guilds.length >= 3}
              onClick={() =>
                setGuilds((current) => [
                  ...current,
                  { name: '', realm: '', region: 'us' },
                ])
              }
            >
              Add guild
            </Button>
            <label className="flex items-center gap-x-2 text-xs text-foreground">
              Raid
              <Input
                className="h-8 w-56 text-sm"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
              />
            </label>
            <Button size="xs" onClick={() => save({ guilds, zoneName })}>
              Save
            </Button>
            {saved && <span className="text-xs text-green-400">{saved}</span>}
          </div>
          <p className="text-xs text-foreground">
            Up to 3 guilds that log publicly on Warcraft Logs (name and realm as
            shown there). At a new tier, set the raid&apos;s name and unfreeze.
          </p>
        </div>
      ) : (
        <p className="text-xs text-foreground">
          Officers choose the watched guilds.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {(status.running || status.log.length > 0) && (
        <pre className="max-h-40 overflow-y-auto rounded bg-background/60 p-2 text-[11px] leading-4 text-foreground whitespace-pre-wrap">
          {status.log.join('\n')}
        </pre>
      )}
    </div>
  );
};
