import { Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { AlertTriangle, CloudDownload, CloudUpload } from 'lucide-react';
import { ConfigurationSchema } from 'config/configSchema';
import { AppState, CloudState, CloudStatus as CloudInfo } from 'main/types';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from 'renderer/components/HoverCard/HoverCard';
import { Button } from 'renderer/components/Button/Button';
import Separator from 'renderer/components/Separator/Separator';
import { cn } from 'renderer/components/utils';
import type { UploadFailure } from 'main/uploadFailures';
import UploadFailureList from './UploadFailureList';
import { TONE_TEXT } from './Dot';
import { sidebarLabels } from 'renderer/sidebarLabels';
import { usePermissions } from 'renderer/usePermissions';
import { serverLine } from 'renderer/sidebarStatus';
import type { ServerCheck } from 'renderer/serverVersion';

/**
 * [RoomFortyRecorder] How the sign-in reads on the sidebar's second line:
 * a variant (for the colour) and the short label for the states that aren't
 * "connected". Shared with the folded sidebar's tooltip.
 */
export const signInRow = (
  cloudStatus: CloudInfo,
  language: AppState['language'],
): { variant: 'connected' | 'disconnected' | 'error'; rowLabel: string } => {
  const phrase = (p: Phrase) => getLocalePhrase(language, p);
  const { signIn } = cloudStatus;
  switch (signIn.state) {
    case 'off':
      return {
        variant: 'disconnected',
        rowLabel: phrase(Phrase.StatusTitleDisconnected),
      };
    case 'signedOut':
      return {
        variant: 'disconnected',
        rowLabel: phrase(Phrase.StatusTitleSignedOut),
      };
    case 'connecting':
      return {
        variant: 'disconnected',
        rowLabel: phrase(Phrase.StatusRowConnecting),
      };
    case 'offline':
      return { variant: 'error', rowLabel: phrase(Phrase.StatusRowOffline) };
    case 'expired':
      return { variant: 'error', rowLabel: phrase(Phrase.StatusRowExpired) };
    case 'refused':
      return { variant: 'error', rowLabel: phrase(Phrase.StatusRowRefused) };
    default:
      if (cloudStatus.migrated) {
        return {
          variant: 'error',
          rowLabel: phrase(Phrase.StatusTitleMigrated),
        };
      }
      return {
        variant: 'connected',
        rowLabel: phrase(Phrase.StatusTitleConnected),
      };
  }
};

type StatusProps = {
  appState: AppState;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  // [RoomFortyRecorder] Shown as "signed in as <name>" when connected.
  userName?: string;
  // Keeps the renderer's copy of the settings in step after a sign-in here.
  setConfig?: Dispatch<SetStateAction<ConfigurationSchema>>;
  // The guild server's version check (from its /health).
  server?: ServerCheck;
};

const ipc = window.electron.ipcRenderer;

const CloudStatus = ({
  appState,
  setPreviewEnabled,
  userName,
  setConfig,
  server = { state: 'unknown' },
}: StatusProps) => {
  const { cloudStatus, language } = appState;
  const perms = usePermissions();

  const [cloudState, setCloudState] = useState<CloudState>({
    uploadProgress: 0,
    downloadProgress: 0,
    queuedUploads: 0,
    queuedDownloads: 0,
  });

  useEffect(() => {
    ipc.on('updateUploadProgress', (progress) => {
      setCloudState((prevState) => ({
        ...prevState,
        uploadProgress: progress as number,
      }));
    });

    ipc.on('updateDownloadProgress', (progress) => {
      setCloudState((prevState) => ({
        ...prevState,
        downloadProgress: progress as number,
      }));
    });

    ipc.on('updateDownloadQueueLength', (queued) => {
      setCloudState((prevState) => ({
        ...prevState,
        queuedDownloads: queued as number,
      }));
    });

    ipc.on('updateUploadQueueLength', (queued) => {
      setCloudState((prevState) => ({
        ...prevState,
        queuedUploads: queued as number,
      }));
    });

    return () => {
      ipc.removeAllListeners('updateUploadProgress');
      ipc.removeAllListeners('updateDownloadProgress');
      ipc.removeAllListeners('updateDownloadQueueLength');
      ipc.removeAllListeners('updateUploadQueueLength');
    };
  }, []);

  // [RoomFortyRecorder] Uploads that gave up. The main process owns the list
  // and sends all of it on every change.
  const [failures, setFailures] = useState<UploadFailure[]>([]);

  useEffect(() => {
    let live = true;
    // A push that lands first beats the slower first answer.
    let pushed = false;
    const apply = (list: unknown) => {
      if (live && Array.isArray(list)) setFailures(list as UploadFailure[]);
    };
    ipc
      .invoke('uploadFailureAction', [{ action: 'list' }])
      .then((list) => {
        if (!pushed) apply(list);
      })
      .catch(() => {});
    const unsubscribe = ipc.on('uploadFailures', (list) => {
      pushed = true;
      apply(list);
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  const failureAction = (action: string, id?: string) =>
    ipc
      .invoke('uploadFailureAction', [{ action, id }])
      .then((list) => Array.isArray(list) && setFailures(list))
      .catch(() => {});

  // [RoomFortyRecorder] Sign-in countdown: the main process sends when it will
  // retry (nextRetryAt); we tick once a second to show the seconds left.
  const { signIn } = cloudStatus;
  const retryAt = signIn.state === 'offline' ? signIn.nextRetryAt : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!retryAt) return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [retryAt]);

  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  const startSignIn = async () => {
    setSignInError('');
    setSigningIn(true);
    try {
      const result = await ipc.signInWithDiscord();
      if (result.ok) {
        // Same as the Cloud settings tab, so a later settings change doesn't
        // write back a stale name.
        setConfig?.((prev) => ({
          ...prev,
          cloudStorage: true,
          cloudDiscordName: result.userName,
        }));
      } else if (result.reason !== 'cancelled') {
        setSignInError(result.message);
      }
    } catch (error) {
      console.error('[CloudStatus] Discord sign-in failed', error);
      setSignInError(getLocalePhrase(language, Phrase.StatusSignInFailed));
    } finally {
      setSigningIn(false);
    }
  };

  const phrase = (p: Phrase) => getLocalePhrase(language, p);

  const row = signInRow(cloudStatus, language);
  const { rowLabel } = row;
  let status: string;
  let strong = false;
  let offlineIn = '';
  let text = '';
  let action: { label: string; run: () => void } | null = null;

  if (signIn.state === 'off') {
    status = phrase(Phrase.StatusTitleDisconnected);
    text = phrase(Phrase.StatusDescrDisconnected);
  } else if (signIn.state === 'signedOut') {
    status = phrase(Phrase.StatusTitleSignedOut);
    text = phrase(Phrase.StatusDescrSignedOut);
    action = { label: phrase(Phrase.StatusButtonSignIn), run: startSignIn };
  } else if (signIn.state === 'connecting') {
    status = phrase(Phrase.StatusTitleConnecting);
    text = phrase(Phrase.StatusDescrConnecting);
  } else if (signIn.state === 'offline') {
    const seconds = Math.max(0, Math.ceil((signIn.nextRetryAt - now) / 1000));
    status = phrase(Phrase.StatusTitleOffline);
    text = phrase(Phrase.StatusDescrOffline);
    offlineIn = `${seconds} s`;
    action = {
      label: phrase(Phrase.StatusButtonTryNow),
      run: () => ipc.reconfigureCloud(),
    };
  } else if (signIn.state === 'expired') {
    status = phrase(Phrase.StatusTitleExpired);
    // The heading already says it expired; add only the server's reason.
    text = signIn.reason || phrase(Phrase.StatusDescrExpired);
    strong = true;
    action = {
      label: phrase(Phrase.StatusButtonSignInAgain),
      run: startSignIn,
    };
  } else if (signIn.state === 'refused') {
    status = phrase(Phrase.StatusTitleRefused);
    text = signIn.reason;
    strong = true;
    action = {
      label: phrase(Phrase.StatusButtonSignInAgain),
      run: startSignIn,
    };
  } else if (cloudStatus.migrated) {
    status = phrase(Phrase.StatusTitleMigrated);
    text = phrase(Phrase.StatusDescrMigrated);
  } else {
    status = phrase(Phrase.StatusTitleConnected);
    text = phrase(Phrase.StatusDescrConnected);
  }

  const line = serverLine({
    variant: row.variant,
    rowLabel,
    userName,
    server,
    labels: sidebarLabels(language),
  });

  const actionLabel =
    action && signingIn
      ? phrase(Phrase.StatusButtonWaitingForDiscord)
      : action?.label;

  const description = (
    <div className="flex flex-col gap-y-2">
      <h2 className="text-sm font-semibold">{status}</h2>
      <Separator className="my-1" />
      <p
        className={cn(
          'text-xs',
          strong ? 'text-popover-foreground' : 'text-popover-foreground/60',
        )}
      >
        {offlineIn ? (
          <>
            {text.split('{seconds}')[0]}
            <span className="whitespace-nowrap">{offlineIn}</span>
            {text.split('{seconds}')[1]}
          </>
        ) : (
          text
        )}
      </p>
      {signInError && <p className="text-xs text-error-text">{signInError}</p>}
      {action && (
        <div className="flex gap-x-2">
          <Button
            size="sm"
            className="w-fit h-7 px-3"
            disabled={signingIn}
            onClick={action.run}
          >
            {actionLabel}
          </Button>
          {signingIn && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit h-7 px-3"
              onClick={() => ipc.cancelDiscordSignIn()}
            >
              {phrase(Phrase.Cancel)}
            </Button>
          )}
        </div>
      )}
      {server.state === 'behind' && (
        <p className="text-xs text-yellow-400" data-state="behind">
          {`The guild server is on ${server.server}; ${server.needed} changed it. ${
            perms?.owner
              ? 'Run update-server.cmd on the server PC.'
              : 'Some newer features may not work until the guild owner updates it.'
          }`}
        </p>
      )}
      <UploadFailureList
        failures={failures}
        onRetry={(id) => failureAction('retry', id)}
        onDismiss={(id) => failureAction('dismiss', id)}
        onDismissAll={() => failureAction('dismissAll')}
      />
    </div>
  );

  // In the states where it's the user's move the whole row is a real button.
  const RowTag = action ? 'button' : 'div';

  const renderUploadIcon = () => {
    if (cloudState.queuedUploads < 1) return <></>;
    return (
      <div className="inline-flex gap-x-[2px] text-xs text-foreground-lighter">
        <CloudUpload size={14} />
        {cloudState.uploadProgress.toFixed(0)}%
        <span className="text-[0.60rem] text-foreground mx-[2px]">
          {cloudState.queuedUploads > 1 && `+${cloudState.queuedUploads - 1}`}
        </span>
      </div>
    );
  };

  const renderFailedIcon = () => {
    if (failures.length < 1) return <></>;
    return (
      <div
        className="inline-flex items-center gap-x-[2px] text-xs text-error-text"
        data-state="failed"
        aria-label={`${failures.length} upload${failures.length === 1 ? '' : 's'} failed`}
      >
        <AlertTriangle size={14} />
        {failures.length}
      </div>
    );
  };

  const renderDownloadIcon = () => {
    if (cloudState.queuedDownloads < 1) return <></>;
    return (
      <div className="inline-flex gap-x-[2px] text-xs text-foreground-lighter">
        <CloudDownload size={14} />
        {cloudState.downloadProgress.toFixed(0)}%
        <span className="text-[0.60rem] text-foreground mx-[2px]">
          {cloudState.queuedDownloads > 1 &&
            `+${cloudState.queuedDownloads - 1}`}
        </span>
      </div>
    );
  };

  return (
    <HoverCard
      openDelay={300}
      onOpenChange={(open) => setPreviewEnabled(!open)}
    >
      <HoverCardTrigger>
        {/* [RoomFortyRecorder] Line 2 of the status card: guild server + sign-in. */}
        <RowTag
          {...(action
            ? {
                type: 'button' as const,
                'aria-label': `${getLocalePhrase(language, Phrase.Cloud)}: ${status}. ${action.label}`,
                onClick: action.run,
                disabled: signingIn,
              }
            : {})}
          data-status="server"
          data-state={line.tone}
          className={cn(
            'w-full flex items-center gap-x-2 pl-4 text-xs leading-4 font-sans hover:cursor-pointer min-w-0 text-left',
            action &&
              'rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
          )}
        >
          <span
            className={cn(
              'min-w-0 flex flex-wrap gap-x-1',
              TONE_TEXT[line.tone],
            )}
          >
            <span className="whitespace-nowrap">
              {line.trail ? `${line.lead} ·` : line.lead}
            </span>
            {line.trail && (
              <span className="min-w-0 max-w-full truncate">{line.trail}</span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-x-2 shrink-0">
            {renderFailedIcon()}
            {renderDownloadIcon()}
            {renderUploadIcon()}
          </div>
        </RowTag>
        <HoverCardContent className="w-[300px] mx-4">
          {description}
        </HoverCardContent>
      </HoverCardTrigger>
    </HoverCard>
  );
};

export default CloudStatus;
