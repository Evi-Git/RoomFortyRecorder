import EventEmitter from 'events';
import axios from 'axios';
import noobs, { ObsData, Signal } from 'noobs';
import ConfigService from 'config/ConfigService';
import Poller from 'utils/Poller';
import { cloudService } from './cloudService';
import { ESupportedEncoders } from './obsEnums';

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

export type LiveStatus = 'off' | 'connecting' | 'live' | 'error';

export type LiveState = {
  status: LiveStatus;
  streamName?: string;
  mbps?: number;
  error?: string;
};

const STREAM_HEIGHT = 1080;
const BITRATE_KBPS = 7000;

export default class LiveStreamer extends EventEmitter {
  private static instance: LiveStreamer;

  private state: LiveState = { status: 'off' };

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
    return this.state.status === 'connecting' || this.state.status === 'live';
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

    if (!Poller.getInstance().isWowRunning()) {
      this.setState({
        status: 'error',
        error: 'Start WoW first, then go live.',
      });
      return;
    }

    const token = this.cfg.get<string>('cloudSessionToken');

    if (!token) {
      this.setState({
        status: 'error',
        error: 'Sign in with Discord first (Cloud settings).',
      });
      return;
    }

    this.setState({ status: 'connecting' });

    try {
      const res = await axios.get(`${cloudService.apiUrl}/live/publish`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });

      const { whipUrl, streamName } = res.data as {
        whipUrl: string;
        streamName: string;
      };
      const encoder = LiveStreamer.pickEncoder(
        this.cfg.get<string>('obsRecEncoder'),
        noobs.ListVideoEncoders(),
      );
      const settings = LiveStreamer.encoderSettings(encoder);
      const { width, height } = LiveStreamer.outputSize();

      console.info('[LiveStreamer] Starting stream', {
        streamName,
        encoder,
        width,
        height,
      });
      this.state.streamName = streamName;
      noobs.StartStream(whipUrl, token, encoder, settings, width, height);
      // The result arrives as a "stream-start" or "stream-stop" signal.
    } catch (error) {
      const message = LiveStreamer.describeError(error);
      console.error('[LiveStreamer] Failed to start', message);
      this.setState({ status: 'error', error: message });
    }
  }

  public stop(reason: string) {
    if (!this.isActive()) return;
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
    if (!this.isActive() && !LiveStreamer.engineActive()) return;
    this.stop(reason);
    const deadline = Date.now() + timeoutMs;

    while (LiveStreamer.engineActive() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Signals of type "stream" from the engine. */
  public handleSignal(signal: Signal) {
    console.info('[LiveStreamer] Signal', signal);

    if (signal.id === 'stream-start') {
      this.setState({ status: 'live', streamName: this.state.streamName });
      this.startStats();
      return;
    }

    if (signal.id === 'stream-stop') {
      this.stopStats();

      if (signal.code === 0 || this.state.status === 'off') {
        this.setState({ status: 'off', streamName: this.state.streamName });
      } else {
        this.setState({
          status: 'error',
          streamName: this.state.streamName,
          error: LiveStreamer.describeStopCode(signal.code, signal.error),
        });
      }
    }
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
  public static encoderSettings(encoder: string): ObsData {
    const base: ObsData = {
      rate_control: 'CBR',
      bitrate: BITRATE_KBPS,
      keyint_sec: 1,
      bf: 0,
    };

    if (encoder.startsWith('obs_nvenc')) {
      return {
        ...base,
        preset: 'p5',
        tune: 'll',
        multipass: 'disabled',
        profile: 'high',
        lookahead: false,
      };
    }

    if (encoder.endsWith('_amf')) {
      return { ...base, preset: 'quality', profile: 'high' };
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

  /** Downscale to 1080p if the canvas is bigger; 0x0 means "canvas size". */
  public static outputSize() {
    const { canvasWidth, canvasHeight } = noobs.GetPreviewInfo();

    if (!canvasHeight || canvasHeight <= STREAM_HEIGHT) {
      return { width: 0, height: 0 };
    }

    const width =
      Math.round((canvasWidth * STREAM_HEIGHT) / canvasHeight / 2) * 2;
    return { width, height: STREAM_HEIGHT };
  }

  private static describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401)
        return 'Your Discord sign-in expired. Sign in again in Cloud settings.';
      if (error.response?.status === 404)
        return 'Live streaming is not set up on the guild server yet.';
      return `Couldn't reach the guild server (${error.message}).`;
    }

    return error instanceof Error ? error.message : String(error);
  }

  private static describeStopCode(code: number, error?: string) {
    // OBS_OUTPUT_* codes from libobs.
    const reasons: Record<number, string> = {
      [-1]: 'The live server URL is wrong.',
      [-2]: 'Couldn’t connect to the live server.',
      [-3]: 'The live server refused the stream (sign-in or name not allowed).',
      [-4]: 'The live server refused the stream.',
      [-5]: 'The connection to the live server dropped.',
      [-6]: 'The stream settings aren’t supported by this PC.',
      [-7]: 'Not enough disk space.',
      [-8]: 'The stream encoder failed.',
    };

    const reason =
      reasons[code] || `The stream stopped unexpectedly (code ${code}).`;
    return error ? `${reason} ${error}` : reason;
  }
}
