import EventEmitter from 'events';
import axios from 'axios';
import noobs, { ObsData, Signal } from 'noobs';
import ConfigService from 'config/ConfigService';
import { getSessionToken } from './secretStore';
import Poller from 'utils/Poller';
import { cloudService } from './cloudService';
import { ESupportedEncoders } from './obsEnums';
import {
  CONNECT_TIMEOUT_MS,
  OBS,
  STABLE_AFTER_MS,
  afterPublishFailure,
  afterStop,
  unreachableMessage,
} from './liveReconnect';

/**
 * [RoomFortyRecorder] Live streaming of the raider's POV to the guild's
 * MediaMTX server over WebRTC (WHIP).
 *
 * - The raider turns it on and off themselves (button in the sidebar).
 * - It stops automatically when WoW closes.
 * - It uses its own 1080p encode, so recording settings are untouched.
 * - It signs in with the raider's existing Discord session; the guild server
 *   decides the stream name and checks the session for MediaMTX.
 */

export type LiveStatus =
  | 'off'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error';

export type LiveState = {
  status: LiveStatus;
  streamName?: string;
  mbps?: number;
  error?: string;
  /** While reconnecting: what happened and which try is next. */
  note?: string;
  /** While reconnecting: false when the stream never went live this time. */
  wasLive?: boolean;
};

const DEFAULT_HEIGHT = 1080;
const DEFAULT_BITRATE_KBPS = 7000;

/** How long a new start waits for the previous stream to finish stopping. */
const STOPPING_WAIT_MS = 3000;

export default class LiveStreamer extends EventEmitter {
  private static instance: LiveStreamer;

  private state: LiveState = { status: 'off' };

  /**
   * Bumped by every start and stop. A start or reconnect that was waiting on
   * the guild server checks it before starting the engine, so a stop that
   * came in meanwhile (WoW closed, recording settings changed, the raider
   * pressed Stop) wins.
   */
  private attempt = 0;

  /** Reconnect tries made since the stream last dropped. */
  private tries = 0;

  /** When the stream last dropped (0 while it's fine). */
  private droppedAt = 0;

  /** Whether this Go live has been live at least once. */
  private everLive = false;

  /** The code of the last failure, and how many came in a row before it. */
  private lastCode?: number;

  private sameCode = 0;

  /** StartStream was called and its first signal hasn't arrived yet. */
  private starting = false;

  private startingSince = 0;

  private retryTimer?: NodeJS.Timeout;

  /** A try that hasn't connected or failed in time counts as failed. */
  private startTimer?: NodeJS.Timeout;

  /** Live long enough: the tries and the give-up window start over. */
  private stableTimer?: NodeJS.Timeout;

  private statsTimer?: NodeJS.Timeout;

  private lastBytes = 0;

  private lastStatsAt = 0;

  private cfg = ConfigService.getInstance();

  static getInstance() {
    if (!LiveStreamer.instance) LiveStreamer.instance = new LiveStreamer();
    return LiveStreamer.instance;
  }

  public getState(): LiveState {
    return { ...this.state };
  }

  public isActive() {
    return (
      this.state.status === 'connecting' ||
      this.state.status === 'live' ||
      this.state.status === 'reconnecting'
    );
  }

  public async toggle() {
    if (this.isActive()) {
      this.stop('Stopped by you');
    } else {
      await this.start();
    }
  }

  public async start() {
    if (this.isActive()) return;
    this.attempt += 1;
    const attempt = this.attempt;
    this.clearTimers();
    this.resetTries();
    this.everLive = false;

    if (!Poller.getInstance().isWowRunning()) {
      this.setState({
        status: 'error',
        error: 'Start WoW first, then go live.',
      });
      return;
    }

    this.setState({ status: 'connecting' });
    await this.connect(attempt);
  }

  /**
   * Ask the guild server where to stream (this also checks the sign-in and
   * roles again), then start the engine. Used by Go live and by every
   * reconnect try.
   */
  private async connect(attempt: number) {
    const reconnecting = this.state.status === 'reconnecting';
    const token = await getSessionToken();
    if (attempt !== this.attempt || !this.isActive()) return;

    if (!token) {
      this.giveUp('Sign in with Discord first (Cloud settings).');
      return;
    }

    let whipUrl: string;
    let streamName: string;

    try {
      const res = await axios.get(`${cloudService.apiUrl}/live/publish`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      ({ whipUrl, streamName } = res.data as {
        whipUrl: string;
        streamName: string;
      });
    } catch (error) {
      // A stop while the request was out stays a stop.
      if (attempt !== this.attempt || !this.isActive()) return;
      const failure = afterPublishFailure(error);
      console.error(
        '[LiveStreamer] Guild server check failed',
        axios.isAxiosError(error) ? error.message : String(error),
      );

      if (failure.retry && reconnecting) {
        this.stopped(OBS.CONNECT_FAILED, undefined, unreachableMessage(error));
      } else {
        this.giveUp(
          failure.retry ? unreachableMessage(error) : failure.message,
        );
      }
      return;
    }

    if (attempt !== this.attempt || !this.waitingToConnect()) {
      // Stopped meanwhile, or an earlier try that timed out went live after
      // all: either way, no second stream.
      console.info('[LiveStreamer] Not starting: stopped or already live');
      return;
    }

    // The previous stream (just stopped, or dropped) may still be shutting
    // down; the engine refuses a second one until it has.
    const shutDownBy = Date.now() + STOPPING_WAIT_MS;
    while (LiveStreamer.engineActive() && Date.now() < shutDownBy) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (attempt !== this.attempt || !this.waitingToConnect()) return;
    if (LiveStreamer.engineActive()) {
      this.giveUp('The last stream is still stopping. Try again in a moment.');
      return;
    }

    try {
      const encoder = LiveStreamer.pickEncoder(
        this.cfg.get<string>('obsRecEncoder'),
        noobs.ListVideoEncoders(),
      );
      const bitrate =
        this.cfg.get<number>('liveBitrate') || DEFAULT_BITRATE_KBPS;
      const settings = LiveStreamer.encoderSettings(encoder, bitrate);
      const { width, height } = LiveStreamer.outputSize(
        this.cfg.get<string>('liveResolution'),
      );
      const fpsDivisor = this.cfg.get<string>('liveFps') === 'half' ? 2 : 1;

      console.info('[LiveStreamer] Starting stream', {
        streamName,
        encoder,
        width,
        height,
        bitrate,
        fpsDivisor,
        reconnectTry: reconnecting ? this.tries : 0,
      });
      this.state.streamName = streamName;
      noobs.StartStream(
        whipUrl,
        token,
        encoder,
        settings,
        width,
        height,
        fpsDivisor,
      );
      // The result arrives as a "stream-start" or "stream-stop" signal.
      this.starting = true;
      this.startingSince = Date.now();
      this.clearStartTimer();
      this.startTimer = setTimeout(() => {
        this.startTimer = undefined;
        if (attempt !== this.attempt || !this.starting || !this.isActive()) {
          return;
        }
        // Connected just now: the start signal is on its way. Stopping it
        // here would end a stream that works.
        if (LiveStreamer.engineActive()) return;
        console.warn('[LiveStreamer] No answer from the live server in time');
        this.starting = false;
        try {
          noobs.StopStream();
        } catch (error) {
          console.error('[LiveStreamer] StopStream failed', error);
        }
        this.stopped(
          OBS.CONNECT_FAILED,
          undefined,
          'The live server didn’t answer in time.',
        );
      }, CONNECT_TIMEOUT_MS);
    } catch (error) {
      // The engine refused to start the output at all (no WebRTC plugin, no
      // encoder): trying again won't help.
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LiveStreamer] Failed to start', message);
      this.giveUp(message);
    }
  }

  public stop(reason: string) {
    // Also stop a stream the engine still runs while the state says off or
    // error (a try that went live after Go live gave up).
    if (!this.isActive() && !LiveStreamer.engineActive()) return;
    this.attempt += 1;
    this.clearTimers();
    console.info('[LiveStreamer] Stopping stream:', reason);

    try {
      noobs.StopStream();
    } catch (error) {
      console.error('[LiveStreamer] StopStream failed', error);
    }

    // The "stream-stop" signal confirms; flip the UI immediately anyway.
    this.stopStats();
    this.setState({ status: 'off', streamName: this.state.streamName });
  }

  /**
   * Stop and wait until the engine reports the stream is gone. Needed before
   * the video context can be reset (libobs refuses while an output runs).
   */
  public async stopAndWait(reason: string, timeoutMs = 5000) {
    if (
      !this.isActive() &&
      !LiveStreamer.engineActive() &&
      !this.startPending()
    ) {
      return;
    }
    this.stop(reason);
    const deadline = Date.now() + timeoutMs;

    // A start still connecting isn't "active" yet and can't be stopped
    // until its first signal; wait for that too.
    while (
      (LiveStreamer.engineActive() || this.startPending()) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Signals of type "stream" from the engine. */
  public handleSignal(signal: Signal) {
    console.info('[LiveStreamer] Signal', signal);

    if (signal.id === 'stream-start') {
      this.starting = false;
      this.clearStartTimer();

      // Stopped before the engine confirmed: make sure it really stops.
      if (!this.isActive()) {
        try {
          noobs.StopStream();
        } catch (error) {
          console.error('[LiveStreamer] StopStream failed', error);
        }
        return;
      }
      if (this.tries > 0) {
        console.info(`[LiveStreamer] Back live after ${this.tries} tries`);
      }
      // A late start from a try that timed out also counts: no new try.
      this.clearRetry();
      this.everLive = true;
      this.setState({ status: 'live', streamName: this.state.streamName });
      this.startStats();

      // Only a stream that stays up starts the tries over; one that drops
      // every few seconds keeps counting toward giving up.
      this.clearStableTimer();
      this.stableTimer = setTimeout(() => {
        this.stableTimer = undefined;
        if (this.state.status === 'live') this.resetTries();
      }, STABLE_AFTER_MS);
      return;
    }

    if (signal.id === 'stream-stop') {
      this.starting = false;
      this.clearStartTimer();
      this.clearStableTimer();
      this.stopStats();

      if (signal.code === 0 || !this.isActive()) {
        if (this.state.status !== 'error') {
          this.setState({ status: 'off', streamName: this.state.streamName });
        }
        return;
      }

      this.stopped(signal.code, signal.error);
    }
  }

  /**
   * The stream stopped on its own (or a reconnect try couldn't reach the
   * guild server): reconnect after a pause, or give up with the reason.
   */
  private stopped(code: number, error?: string, reason?: string) {
    this.clearRetry();

    if (!Poller.getInstance().isWowRunning()) {
      this.setState({ status: 'off', streamName: this.state.streamName });
      return;
    }

    if (!this.droppedAt) this.droppedAt = Date.now();
    if (code === this.lastCode) {
      this.sameCode += 1;
    } else {
      this.lastCode = code;
      this.sameCode = 0;
    }
    const decision = afterStop({
      code,
      sameCodeTries: this.sameCode,
      tries: this.tries,
      msSinceDrop: Date.now() - this.droppedAt,
      everLive: this.everLive,
      reason,
    });

    if (!decision.retry) {
      console.warn('[LiveStreamer] Giving up', {
        code,
        error,
        tries: this.tries,
      });
      this.giveUp(decision.message);
      return;
    }

    console.info('[LiveStreamer] Reconnecting', {
      code,
      error,
      inMs: decision.delayMs,
      tries: this.tries,
    });
    this.setState({
      status: 'reconnecting',
      streamName: this.state.streamName,
      note: decision.note,
      wasLive: this.everLive,
    });

    const { attempt } = this;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (attempt !== this.attempt || this.state.status !== 'reconnecting') {
        return;
      }
      if (!Poller.getInstance().isWowRunning()) {
        this.setState({ status: 'off', streamName: this.state.streamName });
        return;
      }
      this.tries += 1;
      this.connect(attempt).catch((e) =>
        console.error('[LiveStreamer] Reconnect failed', e),
      );
    }, decision.delayMs);
  }

  private giveUp(message: string) {
    this.clearTimers();
    this.stopStats();
    this.resetTries();
    if (LiveStreamer.engineActive()) {
      try {
        noobs.StopStream();
      } catch (error) {
        console.error('[LiveStreamer] StopStream failed', error);
      }
    }
    this.setState({
      status: 'error',
      streamName: this.state.streamName,
      error: message,
    });
  }

  private waitingToConnect() {
    return (
      this.state.status === 'connecting' || this.state.status === 'reconnecting'
    );
  }

  /** A start that hasn't answered yet (and isn't long dead). */
  private startPending() {
    return (
      this.starting && Date.now() - this.startingSince < CONNECT_TIMEOUT_MS
    );
  }

  private resetTries() {
    this.tries = 0;
    this.droppedAt = 0;
    this.lastCode = undefined;
    this.sameCode = 0;
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private clearStartTimer() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  private clearStableTimer() {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
  }

  private clearTimers() {
    this.clearRetry();
    this.clearStartTimer();
    this.clearStableTimer();
  }

  private setState(next: LiveState) {
    this.state = next;
    this.emit('state', this.getState());
  }

  private startStats() {
    this.stopStats();
    this.lastBytes = 0;
    this.lastStatsAt = Date.now();

    this.statsTimer = setInterval(() => {
      const { active, bytes } = noobs.GetStreamStatus();
      if (!active) return;
      const now = Date.now();
      const seconds = (now - this.lastStatsAt) / 1000;
      const mbps =
        seconds > 0 ? ((bytes - this.lastBytes) * 8) / seconds / 1e6 : 0;
      this.lastBytes = bytes;
      this.lastStatsAt = now;
      this.setState({ ...this.state, mbps: Math.max(0, mbps) });
    }, 2000);
  }

  private stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = undefined;
  }

  private static engineActive() {
    try {
      return noobs.GetStreamStatus().active;
    } catch {
      return false;
    }
  }

  /**
   * H.264 from the same GPU vendor the raider records with, so the stream
   * uses spare hardware encoder capacity rather than the CPU.
   */
  public static pickEncoder(recordingEncoder: string, available: string[]) {
    const prefer: string[] = [];
    const rec = recordingEncoder || '';

    if (rec.startsWith('obs_nvenc')) prefer.push(ESupportedEncoders.NVENC_H264);
    if (rec.endsWith('_amf')) prefer.push(ESupportedEncoders.AMD_H264);
    if (rec.startsWith('obs_qsv'))
      prefer.push('obs_qsv11_v2', ESupportedEncoders.QSV_H264);

    // Any hardware H.264 before falling back to the CPU.
    prefer.push(
      ESupportedEncoders.NVENC_H264,
      ESupportedEncoders.AMD_H264,
      'obs_qsv11_v2',
      ESupportedEncoders.QSV_H264,
      ESupportedEncoders.OBS_X264,
    );

    return (
      prefer.find((id) => available.includes(id)) || ESupportedEncoders.OBS_X264
    );
  }

  /** Constant bitrate, 1s keyframes (fast joins), no B-frames (WebRTC). */
  public static encoderSettings(
    encoder: string,
    bitrate = DEFAULT_BITRATE_KBPS,
  ): ObsData {
    const base: ObsData = {
      rate_control: 'CBR',
      bitrate,
      keyint_sec: 1,
      bf: 0,
    };

    if (encoder.startsWith('obs_nvenc')) {
      return {
        ...base,
        // p3 + ultra-low-latency tune: the fastest NVENC path that still
        // looks clean at 7 Mbps 1080p60 (measured ~200 ms glass-to-glass on p5/ll).
        preset: 'p3',
        tune: 'ull',
        multipass: 'disabled',
        profile: 'high',
        lookahead: false,
      };
    }

    if (encoder.endsWith('_amf')) {
      // 'speed' keeps AMF off its slow quality path for live viewing.
      return { ...base, preset: 'speed', profile: 'high' };
    }

    if (encoder.startsWith('obs_qsv')) {
      return { ...base, profile: 'high', bframes: 0 };
    }

    return {
      ...base,
      preset: 'veryfast',
      tune: 'zerolatency',
      profile: 'high',
    };
  }

  /**
   * Downscale to the chosen height (720/900/1080/1440) if the canvas is
   * bigger; "source" or a smaller canvas streams at canvas size (0x0).
   */
  public static outputSize(resolution?: string) {
    const { canvasWidth, canvasHeight } = noobs.GetPreviewInfo();
    const target =
      resolution === 'source' ? 0 : Number(resolution) || DEFAULT_HEIGHT;

    if (!target || !canvasHeight || canvasHeight <= target) {
      return { width: 0, height: 0 };
    }

    const width = Math.round((canvasWidth * target) / canvasHeight / 2) * 2;
    return { width, height: target };
  }
}
