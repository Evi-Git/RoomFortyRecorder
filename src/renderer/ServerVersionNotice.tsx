import React from 'react';
import { ServerCog, X } from 'lucide-react';
import { usePermissions } from './usePermissions';
import { checkServer, ServerCheck } from './serverVersion';

/**
 * [RoomFortyRecorder] A small card at the bottom right when the guild
 * server is older than the last release that changed it. The owner is told
 * to run update-server.cmd; everyone else that some features may not work
 * yet. Dismissed per server version (it comes back for the next change).
 */

type Response<T> = { ok: true; data: T } | { ok: false; error: string };
type Health = { server: string | null; app: string };

const ipc = window.electron.ipcRenderer;
const DISMISS_KEY = 'rf-server-notice-dismissed';
const CHECK_EVERY_MS = 10 * 60 * 1000;

const dismissedFor = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) || '';
  } catch {
    return '';
  }
};

const ServerVersionNotice = () => {
  const [check, setCheck] = React.useState<ServerCheck>({ state: 'unknown' });
  const [dismissed, setDismissed] = React.useState(dismissedFor);
  const perms = usePermissions();

  React.useEffect(() => {
    let live = true;
    const ask = () =>
      (
        ipc.invoke('pullDesk', [{ action: 'serverHealth' }]) as Promise<
          Response<Health>
        >
      )
        .then((r) => {
          if (live)
            setCheck(r.ok ? checkServer(r.data.server) : { state: 'unknown' });
        })
        .catch(() => {});
    ask();
    // After update-server.cmd runs, the card goes away on its own.
    const timer = setInterval(ask, CHECK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (check.state !== 'behind') return null;
  const key = `${check.server}:${check.needed}`;
  if (dismissed === key) return null;

  const dismiss = () => {
    setDismissed(key);
    try {
      localStorage.setItem(DISMISS_KEY, key);
    } catch {
      // Shown again next time.
    }
  };

  return (
    <div
      role="status"
      data-state="behind"
      className="fixed bottom-4 right-4 z-50 w-[340px] rounded-lg border border-brand/50 bg-popover shadow-lg p-3 flex gap-x-3 text-sm"
    >
      <ServerCog size={18} className="text-brand shrink-0 mt-0.5" />
      <div className="flex flex-col gap-y-1 min-w-0">
        <span className="font-semibold text-foreground-lighter">
          The guild server needs an update
        </span>
        <span className="text-xs text-foreground">
          {`It's on ${check.server}; ${check.needed} changed it.`}{' '}
          {perms?.owner
            ? 'Run update-server.cmd on the server PC.'
            : 'Some newer features may not work until the guild owner updates it.'}
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        title="Hide until the next server change"
        className="ml-auto self-start rounded p-0.5 text-foreground hover:text-foreground-lighter hover:bg-card/50"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default ServerVersionNotice;
