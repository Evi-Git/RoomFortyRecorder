import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { UpdateStatus } from 'main/AppUpdater';
import { cn } from 'renderer/components/utils';
import { timeOfDay } from 'renderer/clock';

/**
 * [RoomFortyRecorder] Version line with a "Check for updates" link under
 * it. The updater downloads in the background; once it's ready the link
 * turns into "Restart to update".
 */

const ipc = window.electron.ipcRenderer;

type IProps = {
  versionLabel: string;
  version?: string;
};

const describe = (status: UpdateStatus): string => {
  switch (status.state) {
    case 'checking':
      return 'Checking…';
    case 'upToDate':
      return 'Up to date';
    case 'downloading':
      return `Downloading ${status.version ? `v${status.version} ` : ''}${status.percent}%`;
    case 'ready':
      return `Restart to update${status.version ? ` to v${status.version}` : ''}`;
    case 'error':
      return status.retryAt
        ? `${status.message} Retrying at ${timeOfDay(status.retryAt)}.`
        : status.message;
    default:
      return 'Check for updates';
  }
};

const UpdateCheck: React.FC<IProps> = ({ versionLabel, version }) => {
  const [status, setStatus] = React.useState<UpdateStatus>({ state: 'idle' });

  React.useEffect(() => {
    let live = true;
    // A push that lands first beats the slower first answer.
    let pushed = false;
    ipc
      .invoke('getUpdateStatus', [])
      .then((s) => live && !pushed && s && setStatus(s as UpdateStatus))
      .catch(() => {});

    const unsubscribe = ipc.on('updateStatus', (s) => {
      pushed = true;
      setStatus(s as UpdateStatus);
    });

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  const busy = status.state === 'checking' || status.state === 'downloading';
  const ready = status.state === 'ready';

  const onClick = () => {
    if (ready) {
      ipc.sendMessage('doAppUpdate', []);
      return;
    }

    if (busy) return;
    setStatus({ state: 'checking' });

    ipc
      .invoke('checkForUpdates', [])
      .then((s) => s && setStatus(s as UpdateStatus))
      .catch(() =>
        setStatus({ state: 'error', message: 'Update check failed.' }),
      );
  };

  return (
    <div className="w-full mt-1 flex flex-col items-center font-sans text-xs">
      {!!version && (
        <div className="text-foreground">
          {versionLabel} {version}
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={cn(
          'mt-0.5 flex items-center gap-x-1 rounded px-1.5 py-0.5 transition-colors',
          'text-foreground hover:text-brand disabled:cursor-default disabled:hover:text-foreground',
          {
            'text-brand font-semibold': ready,
            'text-red-400 hover:text-red-300': status.state === 'error',
          },
        )}
      >
        <RefreshCw size={11} className={cn({ 'animate-spin': busy })} />
        <span>{describe(status)}</span>
      </button>
    </div>
  );
};

export default UpdateCheck;
