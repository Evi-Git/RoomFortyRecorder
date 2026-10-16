import React from 'react';
import { Radio } from 'lucide-react';
import { Button } from './components/Button/Button';
import { Tooltip } from './components/Tooltip/Tooltip';

/**
 * [RoomFortyRecorder] Go live / stop button for streaming this raider's POV
 * to the guild. State lives in the main process (LiveStreamer).
 */

type LiveState = {
  status: 'off' | 'connecting' | 'live' | 'error';
  streamName?: string;
  mbps?: number;
  error?: string;
};

const ipc = window.electron.ipcRenderer;

const LiveButton: React.FC = () => {
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
  const connecting = state.status === 'connecting';

  let label = 'Go live';
  if (connecting) label = 'Connecting…';
  if (live)
    label = state.mbps ? `LIVE · ${state.mbps.toFixed(1)} Mbps` : 'LIVE';

  const tooltip =
    live || connecting
      ? `Streaming to the guild as "${state.streamName ?? 'you'}". Click to stop.`
      : 'Stream your POV to the guild. Stops by itself when WoW closes.';

  return (
    <div className="px-3 pb-2">
      <Tooltip content={tooltip} side="right">
        <Button
          variant={live ? 'destructive' : 'outline'}
          size="sm"
          className={`w-full justify-start gap-x-2 ${connecting ? 'animate-pulse' : ''}`}
          disabled={busy}
          onClick={toggle}
        >
          <Radio size={16} className={live ? 'animate-pulse' : ''} />
          <span className="font-semibold">{label}</span>
          {(live || connecting) && (
            <span className="ml-auto text-xs opacity-80">Stop</span>
          )}
        </Button>
      </Tooltip>
      {state.status === 'error' && state.error && (
        <p className="mt-1 text-xs text-red-400 leading-snug">{state.error}</p>
      )}
    </div>
  );
};

export default LiveButton;
