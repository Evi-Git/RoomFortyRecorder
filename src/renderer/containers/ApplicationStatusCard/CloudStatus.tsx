import { Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { CloudDownload, CloudUpload } from 'lucide-react';
import { AppState, CloudState } from 'main/types';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from 'renderer/components/HoverCard/HoverCard';
import { Button } from 'renderer/components/Button/Button';
import Separator from 'renderer/components/Separator/Separator';
import { StatusLightVariant } from 'renderer/components/StatusLight/StatusLight';
import { cn } from 'renderer/components/utils';

type StatusProps = {
  appState: AppState;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  // [RoomFortyRecorder] Shown as "signed in as <name>" when connected.
  userName?: string;
};

const ipc = window.electron.ipcRenderer;

const CloudStatus = ({
  appState,
  setPreviewEnabled,
  userName,
}: StatusProps) => {
  const { cloudStatus, language } = appState;

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
      await ipc.signInWithDiscord();
    } catch (error) {
      console.error('[CloudStatus] Discord sign-in failed', error);
      setSignInError(getLocalePhrase(language, Phrase.StatusSignInFailed));
    } finally {
      setSigningIn(false);
    }
  };

  const phrase = (p: Phrase) => getLocalePhrase(language, p);

  let status: string;
  let variant: StatusLightVariant;
  let text = '';
  // Muted second line: the server's reason for a 401.
  let reason = '';
  let action: { label: string; run: () => void } | null = null;

  if (signIn.state === 'off') {
    status = phrase(Phrase.StatusTitleDisconnected);
    variant = 'disconnected';
    text = phrase(Phrase.StatusDescrDisconnected);
  } else if (signIn.state === 'signedOut') {
    status = phrase(Phrase.StatusTitleSignedOut);
    variant = 'disconnected';
    text = phrase(Phrase.StatusDescrSignedOut);
    action = { label: phrase(Phrase.StatusButtonSignIn), run: startSignIn };
  } else if (signIn.state === 'connecting') {
    status = phrase(Phrase.StatusTitleConnecting);
    variant = 'disconnected';
    text = phrase(Phrase.StatusDescrConnecting);
  } else if (signIn.state === 'offline') {
    const seconds = Math.max(0, Math.ceil((signIn.nextRetryAt - now) / 1000));
    status = phrase(Phrase.StatusTitleOffline);
    variant = 'error';
    text = phrase(Phrase.StatusDescrOffline).replace(
      '{seconds}',
      String(seconds),
    );
    action = {
      label: phrase(Phrase.StatusButtonTryNow),
      run: () => ipc.reconfigureCloud(),
    };
  } else if (signIn.state === 'expired') {
    status = phrase(Phrase.StatusTitleExpired);
    variant = 'error';
    text = phrase(Phrase.StatusDescrExpired);
    reason = signIn.reason;
    action = {
      label: phrase(Phrase.StatusButtonSignInAgain),
      run: startSignIn,
    };
  } else if (signIn.state === 'refused') {
    status = phrase(Phrase.StatusTitleRefused);
    variant = 'error';
    text = signIn.reason;
    action = {
      label: phrase(Phrase.StatusButtonSignInAgain),
      run: startSignIn,
    };
  } else if (cloudStatus.migrated) {
    variant = 'error';
    status = phrase(Phrase.StatusTitleMigrated);
    text = phrase(Phrase.StatusDescrMigrated);
  } else {
    variant =
      cloudState.queuedDownloads > 0 || cloudState.queuedUploads > 0
        ? 'active'
        : 'connected';
    status = phrase(Phrase.StatusTitleConnected);
    text = phrase(Phrase.StatusDescrConnected);
  }

  const actionLabel =
    action && signingIn
      ? phrase(Phrase.StatusButtonWaitingForDiscord)
      : action?.label;

  const description = (
    <div className="flex flex-col gap-y-2">
      <h2 className="text-sm font-semibold">{status}</h2>
      <Separator className="my-1" />
      <p className="text-xs text-popover-foreground/60">{text}</p>
      {reason && (
        <p className="text-xs text-popover-foreground/60 italic">{reason}</p>
      )}
      {signInError && (
        <p className="text-xs text-error-foreground">{signInError}</p>
      )}
      {action && (
        <Button
          size="sm"
          className="w-fit h-7 px-3"
          disabled={signingIn}
          onClick={action.run}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );

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
        {/* [RoomFortyRecorder] Compact row under the recorder status. */}
        <div className="w-full flex items-center gap-x-2 pl-4 text-xs font-sans hover:cursor-pointer min-w-0">
          <span
            className={cn('truncate', {
              'text-foreground':
                variant === 'connected' ||
                variant === 'active' ||
                variant === 'disconnected',
              'text-error-foreground': variant === 'error',
            })}
          >
            {getLocalePhrase(language, Phrase.Cloud)}:{' '}
            {(variant === 'connected' || variant === 'active') && userName
              ? `signed in as ${userName}`
              : status}
          </span>
          <div className="ml-auto flex items-center gap-x-2 shrink-0">
            {action && (
              <button
                type="button"
                className="text-brand hover:underline disabled:opacity-50"
                disabled={signingIn}
                onClick={action.run}
              >
                {actionLabel}
              </button>
            )}
            {renderDownloadIcon()}
            {renderUploadIcon()}
          </div>
        </div>
        <HoverCardContent className="w-[300px] mx-4">
          {description}
        </HoverCardContent>
      </HoverCardTrigger>
    </HoverCard>
  );
};

export default CloudStatus;
