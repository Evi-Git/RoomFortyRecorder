import React from 'react';
import { Radio, Settings2 } from 'lucide-react';
import { Button } from './components/Button/Button';
import { Tooltip } from './components/Tooltip/Tooltip';
import LiveSettingsDialog from './LiveSettingsDialog';

/**
 * [RoomFortyRecorder] Go live / stop button for streaming this raider's POV
 * to the guild. State lives in the main process (LiveStreamer).
 */

type LiveState = {
  status: 'off' | 'connecting' | 'live' | 'reconnecting' | 'error';
  streamName?: string;
  mbps?: number;
  error?: string;
  /** While reconnecting: what happened and which try is next. */
  note?: string;
  /** While reconnecting: false when the stream never went live this time. */
  wasLive?: boolean;
};

const ipc = window.electron.ipcRenderer;

/** compact: the folded sidebar's icon-only button. */
const LiveButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [state, setState] = React.useState<LiveState>({ status: 'off' });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    ipc
      .invoke('liveStreamGetState', [])
      .then((s) => setState(s as LiveState))
      .catch(() => {});

    const unsubscribe = ipc.on('liveStreamState', (s) =>
      setState(s as LiveState),
    );
    return () => unsubscribe?.();
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      setState((await ipc.invoke('liveStreamToggle', [])) as LiveState);
    } finally {
      setBusy(false);
    }
  };

  const live = state.status === 'live';
  const reconnecting = state.status === 'reconnecting';
  // Waiting on the live server: pulse, and offer Stop.
  const connecting = state.status === 'connecting' || reconnecting;

  let label = 'Go live';
  if (state.status === 'connecting') label = 'Connecting…';
  if (reconnecting)
    label = state.wasLive === false ? 'Connecting…' : 'Reconnecting…';
  if (live)
    label = state.mbps ? `LIVE · ${state.mbps.toFixed(1)} Mbps` : 'LIVE';

  let message = '';
  if (state.status === 'error') message = state.error ?? '';
  if (reconnecting) message = state.note ?? '';

  let tooltip =
    'Stream your POV to the guild. Stops by itself when WoW closes.';
  if (live || state.status === 'connecting')
    tooltip = `Streaming to the guild as "${state.streamName ?? 'you'}". Click to stop.`;
  if (reconnecting)
    tooltip = `${state.note ?? 'Reconnecting…'} Click to stop trying.`;

  if (compact) {
    return (
      <Tooltip content={`${label} · ${tooltip}`} side="right">
        <Button
          variant={live ? 'destructive' : 'outline'}
          size="icon"
          className={`h-10 w-10 ${connecting ? 'animate-pulse' : ''}`}
          disabled={busy}
          onClick={toggle}
          aria-label={
            live ? 'Live. Stop' : connecting ? `${label} Stop` : label
          }
        >
          <Radio size={16} className={live ? 'animate-pulse' : 'text-brand'} />
        </Button>
      </Tooltip>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-x-1">
        <Tooltip content={tooltip} side="right">
          <Button
            variant={live ? 'destructive' : 'outline'}
            size="sm"
            className={`h-10 flex-1 justify-center gap-x-2 text-sm text-foreground-lighter ${live ? '' : 'border-brand/60 bg-transparent hover:bg-brand/10'} ${connecting ? 'animate-pulse' : ''}`}
            disabled={busy}
            onClick={toggle}
          >
            <Radio
              size={15}
              className={live ? 'animate-pulse' : 'text-brand'}
            />
            <span>{label}</span>
            {(live || connecting) && (
              <span className="ml-1 text-xs opacity-80">· Stop</span>
            )}
          </Button>
        </Tooltip>
        <LiveSettingsDialog>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-10 w-10 text-foreground"
            title="Go live quality (resolution, frame rate, bitrate)"
          >
            <Settings2 size={16} />
          </Button>
        </LiveSettingsDialog>
      </div>
      {/* Always mounted, so screen readers announce each new line. */}
      <p
        aria-live="polite"
        className={`text-xs leading-snug ${
          state.status === 'error' ? 'text-error-text' : 'text-foreground'
        } ${message ? 'mt-1' : ''}`}
      >
        {message}
      </p>
    </div>
  );
};

export default LiveButton;
