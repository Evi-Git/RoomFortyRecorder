import React from 'react';
import { formatDurationLong } from './format';
import {
  Flag as FlagIcon,
  Lock,
  Maximize,
  Square,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from './components/Button/Button';
import { PageHeader } from './components/PageHeader/PageHeader';
import { EmptyState } from './components/States/States';
import { settingsButtonClass } from './components/SettingsCard/SettingsCard';
import { coachCall, Flag, FlagBar } from './Coaching';

/**
 * [RoomFortyRecorder] Live page: watch a raider's live POV inside the app.
 *
 * - Lists who is live (refreshes every few seconds). Click a name or press
 *   1-9 to watch; Esc stops, F toggles fullscreen.
 * - Playback is WebRTC (WHEP) straight from the guild's MediaMTX, about half
 *   a second behind. The main process does the signed-in HTTP calls.
 * - The guild server only lets Discord roles set on the server (Raider+ and
 *   Officer by default) list or watch streams.
 */

type StreamInfo = {
  name: string;
  since: string | null;
  viewers: number;
};

type LiveList = {
  allowed: boolean;
  signedIn: boolean;
  roles?: string;
  streams: StreamInfo[];
  error?: string;
};

type Stats = {
  width: number;
  height: number;
  fps: number;
  mbps: number;
  bufferMs: number;
  stalledSeconds: number;
};

type WatchStatus = 'idle' | 'connecting' | 'playing' | 'error';

const ipc = window.electron.ipcRenderer;
const LIST_REFRESH_MS = 4000;
const MAX_RETRIES = 3;

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; settings just won't persist.
    }
  },
};

const liveFor = (since: string | null) => {
  if (!since) return '';
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(since)) / 60000),
  );
  return formatDurationLong(minutes * 60);
};

/**
 * MediaMTX puts audio and video in one stream, so the player holds video
 * back to line up with the game audio (OBS's audio usually runs a little
 * behind). Giving the audio its own stream id turns that off: the picture
 * shows as soon as it arrives, and the game audio may trail slightly.
 */
const decoupleAudio = (sdp: string) =>
  sdp
    .split(/(?=^m=)/m)
    .map((section) =>
      section.startsWith('m=audio')
        ? section
            .replace(/^a=msid:\S+/gm, 'a=msid:rf-audio')
            .replace(/(^a=ssrc:\d+ (?:msid|mslabel|cname):)\S+/gm, '$1rf-audio')
        : section,
    )
    .join('');

const waitForIce = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const done = () => {
      if (pc.iceGatheringState === 'complete') resolve();
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 2000);
  });

const LivePage: React.FC = () => {
  const [list, setList] = React.useState<LiveList | null>(null);
  const [watching, setWatching] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<WatchStatus>('idle');
  const [message, setMessage] = React.useState('');
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [muted, setMuted] = React.useState(
    store.get('rf-live-muted') === 'true',
  );
  const [volume, setVolume] = React.useState(
    Number(store.get('rf-live-volume') ?? '0.8'),
  );

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const attemptRef = React.useRef(0);
  const retriesRef = React.useRef(0);
  const watchingRef = React.useRef<string | null>(null);
  const listRef = React.useRef<LiveList | null>(null);
  const lastBytesRef = React.useRef<{ bytes: number; at: number } | null>(null);
  const lastProgressRef = React.useRef(0);
  const lastBufferRef = React.useRef<{ delay: number; count: number } | null>(
    null,
  );
  const [lipSync, setLipSync] = React.useState(
    store.get('rf-live-lipsync') === 'true',
  );
  const lipSyncRef = React.useRef(lipSync);

  React.useEffect(() => {
    watchingRef.current = watching;
    listRef.current = list;
  }, [watching, list]);

  // [RoomFortyRecorder] Flag this moment: B or the Flag button.
  const [flags, setFlags] = React.useState<Flag[]>([]);
  const [flagError, setFlagError] = React.useState('');
  const bufferMsRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    coachCall<{ flags: Flag[] }>({ action: 'flags', days: 1 }).then(
      (response) => {
        if (!cancelled && response.ok) setFlags(response.data.flags);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const flagMoment = React.useCallback(async () => {
    // What's on screen is the buffer behind real time.
    // Plus about half a second of capture and network delay.
    const at =
      Date.now() -
      (watchingRef.current ? Math.round(bufferMsRef.current) + 500 : 0);
    const response = await coachCall<Flag>({
      action: 'addFlag',
      streamer: watchingRef.current ?? '',
      at,
    });
    if (!response.ok) {
      setFlagError(response.error);
      return;
    }
    setFlagError('');
    setFlags((current) => [response.data, ...current]);
  }, []);

  const closePeer = () => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    lastBytesRef.current = null;
    lastBufferRef.current = null;
    setStats(null);
  };

  const stopWatching = React.useCallback(() => {
    attemptRef.current += 1;
    closePeer();
    setWatching(null);
    setStatus('idle');
    setMessage('');
    ipc.invoke('liveUnwatch', []).catch(() => {});
  }, []);

  const watch = React.useCallback(async (name: string, isRetry = false) => {
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    if (!isRetry) retriesRef.current = 0;

    closePeer();
    setWatching(name);
    setStatus('connecting');
    setMessage('');

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // Audio and video may arrive as separate streams; play both together.
    const playback = new MediaStream();
    pc.ontrack = (event) => {
      const video = videoRef.current;
      if (!video) return;
      playback.addTrack(event.track);
      // Ask for the smallest playout buffer the network allows.
      try {
        (
          event.receiver as RTCRtpReceiver & { jitterBufferTarget: number }
        ).jitterBufferTarget = 0;
      } catch {
        // Older engines: keep the default.
      }
      if (video.srcObject !== playback) video.srcObject = playback;
      video.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (attempt !== attemptRef.current) return;
      const state = pc.connectionState;

      if (state === 'connected') {
        retriesRef.current = 0;
        setStatus('playing');
        return;
      }

      if (
        state === 'failed' ||
        state === 'disconnected' ||
        state === 'closed'
      ) {
        const stillLive = listRef.current?.streams.some((s) => s.name === name);

        if (stillLive && retriesRef.current < MAX_RETRIES) {
          retriesRef.current += 1;
          setStatus('connecting');
          setMessage('Connection dropped, reconnecting…');
          setTimeout(() => {
            // eslint-disable-next-line react-hooks/immutability -- handler is declared later in the component; moving it is not behaviour-neutral
            if (attempt === attemptRef.current) watch(name, true);
          }, 1500);
          return;
        }

        closePeer();
        setStatus('error');
        setMessage(
          stillLive
            ? `Lost the connection to ${name}'s stream.`
            : `${name} stopped streaming.`,
        );
      }
    };

    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      if (attempt !== attemptRef.current) return;

      const result = (await ipc.invoke('liveWatch', [
        name,
        pc.localDescription?.sdp ?? '',
      ])) as { answer?: string; error?: string };

      if (attempt !== attemptRef.current) return;
      if (!result.answer) throw new Error(result.error || 'No answer');
      const answer = lipSyncRef.current
        ? result.answer
        : decoupleAudio(result.answer);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      closePeer();
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Who's live.
  React.useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const next = (await ipc.invoke('liveListStreams', [])) as LiveList;
        if (!cancelled) setList(next);
      } catch {
        // Keep the last list.
      }
    };

    refresh();
    const timer = setInterval(refresh, LIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // The streamer went offline while we were watching.
  React.useEffect(() => {
    if (!watching || !list || list.error) return;
    const live = list.streams.some((s) => s.name === watching);
    if (!live && status === 'playing') {
      attemptRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs state from props/external state on purpose; changing it would alter render timing
      closePeer();
      setStatus('error');
      setMessage(`${watching} stopped streaming.`);
      ipc.invoke('liveUnwatch', []).catch(() => {});
    }
  }, [list, watching, status]);

  // Turning audio sync on or off reconnects the current stream.
  const toggleLipSync = () => {
    const next = !lipSyncRef.current;
    lipSyncRef.current = next;
    setLipSync(next);
    store.set('rf-live-lipsync', String(next));
    if (watchingRef.current && status !== 'error') watch(watchingRef.current);
  };

  // Stop watching when leaving the page.
  React.useEffect(() => () => stopWatching(), [stopWatching]);

  // Volume.
  React.useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = muted;
      video.volume = Math.min(1, Math.max(0, volume));
    }
    store.set('rf-live-muted', String(muted));
    store.set('rf-live-volume', String(volume));
  }, [muted, volume, status]);

  // Stats: resolution, fps, bitrate and the receive buffer.
  React.useEffect(() => {
    if (status !== 'playing') return undefined;

    const timer = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const report = await pc.getStats();

      report.forEach((entry) => {
        if (entry.type !== 'inbound-rtp' || entry.kind !== 'video') return;
        const now = Date.now();
        const prev = lastBytesRef.current;
        const mbps =
          prev && now > prev.at
            ? ((entry.bytesReceived - prev.bytes) * 8) /
              ((now - prev.at) / 1000) /
              1e6
            : 0;
        if (!prev || entry.bytesReceived > prev.bytes) {
          lastProgressRef.current = now;
        }
        lastBytesRef.current = { bytes: entry.bytesReceived, at: now };
        // Buffer over the last second (not the average since the start).
        const prevBuffer = lastBufferRef.current;
        const delay = entry.jitterBufferDelay || 0;
        const count = entry.jitterBufferEmittedCount || 0;
        const frames = prevBuffer ? count - prevBuffer.count : count;
        const bufferMs =
          frames > 0 ? ((delay - (prevBuffer?.delay ?? 0)) / frames) * 1000 : 0;
        lastBufferRef.current = { delay, count };
        bufferMsRef.current = bufferMs;
        setStats({
          width: entry.frameWidth || 0,
          height: entry.frameHeight || 0,
          fps: entry.framesPerSecond || 0,
          mbps,
          bufferMs,
          stalledSeconds: Math.floor((now - lastProgressRef.current) / 1000),
        });
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      boxRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  // Keys: 1-9 watch, Esc stop, F fullscreen, M mute, B flag.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (/^[1-9]$/.test(event.key)) {
        const stream = listRef.current?.streams[Number(event.key) - 1];
        if (stream) watch(stream.name);
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        if (watchingRef.current) stopWatching();
      } else if (event.key === 'f' || event.key === 'F') {
        if (watchingRef.current) toggleFullscreen();
      } else if (event.key === 'm' || event.key === 'M') {
        setMuted((m) => !m);
      } else if (event.key === 'b' || event.key === 'B') {
        flagMoment();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [watch, stopWatching, toggleFullscreen, flagMoment]);

  const renderGate = () => {
    if (!list) {
      return <p className="m-0 text-foreground">Checking who&apos;s live…</p>;
    }

    if (!list.signedIn) {
      return (
        <p className="m-0 text-foreground">
          {list.error ||
            'Sign in with Discord (Cloud settings) to watch live streams.'}
        </p>
      );
    }

    if (!list.allowed) {
      return (
        <div className="flex flex-col items-center gap-y-2 text-foreground-lighter">
          <Lock size={28} />
          <p className="m-0">
            Live viewing is for the {list.roles || 'Raider+ or Officer'} role.
          </p>
          <p className="m-0 text-xs text-foreground">
            You can still go live yourself from the sidebar.
          </p>
        </div>
      );
    }

    return null;
  };

  const gate = renderGate();
  const streams = list?.streams ?? [];
  const showingPicture = status !== 'idle' && !gate;

  let subtitle = 'Checking who is live…';
  if (list) {
    if (gate) subtitle = 'Not available';
    else if (streams.length === 0) subtitle = 'Nobody is live';
    else
      subtitle = `${streams.length} ${
        streams.length === 1 ? 'raider' : 'raiders'
      } live`;
  }

  const iconButton =
    'text-foreground hover:text-foreground-lighter hover:bg-panel-raised';

  return (
    <div className="flex h-full w-full flex-col bg-background-higher pt-[32px] text-foreground-lighter">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col gap-y-3 px-7 pb-4 pt-6">
        <PageHeader
          title="Watch live"
          subtitle={subtitle}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleLipSync}
                title={
                  lipSync
                    ? 'Picture waits for the game audio to stay in sync. Click for the lowest delay.'
                    : 'Lowest delay: the picture shows as soon as it arrives; game audio may trail slightly. Click to sync them.'
                }
                className={`text-[13px] ${iconButton}`}
              >
                {lipSync ? 'Audio sync: on' : 'Lowest delay'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
                aria-label={muted ? 'Unmute' : 'Mute'}
                className={iconButton}
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                className="w-24 accent-brand"
                aria-label="Volume"
              />
              <Button
                variant="ghost"
                size="icon"
                title="Fullscreen (F)"
                aria-label="Fullscreen"
                className={iconButton}
                disabled={!watching}
                onClick={toggleFullscreen}
              >
                <Maximize size={18} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={flagMoment}
                title="Flag this moment (B)"
                className={`gap-x-1 ${settingsButtonClass}`}
              >
                <FlagIcon size={14} /> Flag
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!watching}
                onClick={stopWatching}
                className={`gap-x-1 ${settingsButtonClass}`}
              >
                <Square size={14} /> Stop
              </Button>
            </>
          }
        />

        {!gate && streams.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {streams.map((stream, index) => {
              const active = watching === stream.name && status !== 'error';
              return (
                <button
                  key={stream.name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => watch(stream.name)}
                  title={`Press ${index + 1} to watch`}
                  className={`inline-flex h-9 items-center gap-x-2 rounded-lg border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                    active
                      ? 'border-brand bg-panel-raised text-foreground-lighter'
                      : 'border-panel-line bg-panel text-foreground hover:text-foreground-lighter'
                  }`}
                >
                  <span className="text-xs tabular-nums text-foreground">
                    {index + 1}
                  </span>
                  <span className="font-semibold text-foreground-lighter">
                    {stream.name}
                  </span>
                  <span className="text-xs text-foreground">
                    {liveFor(stream.since)}
                  </span>
                  <span className="flex items-center gap-x-[2px] text-xs text-foreground">
                    <Users size={12} />
                    {stream.viewers}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!gate && list?.error && (
          <p role="alert" className="m-0 text-sm text-error-text">
            {list.error}
          </p>
        )}

        {!gate && (
          <div className="flex min-h-[40px] items-center gap-x-3 rounded-lg border border-panel-line bg-panel px-3 py-1.5">
            <span className="shrink-0 text-xs text-foreground">
              Flags today
            </span>
            {flagError ? (
              <span className="text-xs text-error-text">{flagError}</span>
            ) : (
              <FlagBar flags={flags} onChange={setFlags} />
            )}
          </div>
        )}

        <div
          ref={boxRef}
          className={`relative flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-panel-line [&:fullscreen]:rounded-none [&:fullscreen]:border-0 ${
            showingPicture ? 'bg-black' : 'bg-panel'
          }`}
          onDoubleClick={() => watching && toggleFullscreen()}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="h-full w-full object-contain"
            style={{ display: status === 'playing' ? 'block' : 'none' }}
          />

          {status !== 'playing' && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              {gate || (
                <div className="flex flex-col items-center gap-y-2">
                  {status === 'connecting' && (
                    <p className="m-0 animate-pulse">
                      {message || `Connecting to ${watching}…`}
                    </p>
                  )}
                  {status === 'error' && (
                    <>
                      <p className="m-0 text-error-text">{message}</p>
                      {watching && streams.some((s) => s.name === watching) && (
                        <Button size="sm" onClick={() => watch(watching)}>
                          Try again
                        </Button>
                      )}
                    </>
                  )}
                  {status === 'idle' &&
                    streams.length === 0 &&
                    !list?.error && (
                      <EmptyState>
                        Nobody is live right now. Raiders appear here when they
                        press Go live.
                      </EmptyState>
                    )}
                  {status === 'idle' && streams.length > 0 && (
                    <EmptyState>
                      Pick a raider above, or press 1–
                      {Math.min(9, streams.length)}.
                    </EmptyState>
                  )}
                </div>
              )}
            </div>
          )}

          {status === 'playing' && stats && stats.stalledSeconds >= 3 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-6 text-center">
              <p className="animate-pulse">
                No picture from {watching} for {stats.stalledSeconds}s. Their
                game or connection may have dropped…
              </p>
            </div>
          )}

          {status === 'playing' && stats && (
            <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-[2px] text-[11px] text-white/80">
              {watching} · {stats.width}×{stats.height} · {stats.fps.toFixed(0)}{' '}
              fps · {stats.mbps.toFixed(1)} Mbps · buffer{' '}
              {stats.bufferMs.toFixed(0)} ms
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LivePage;
