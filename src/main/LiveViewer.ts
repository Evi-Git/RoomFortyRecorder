import axios from 'axios';
import ConfigService from 'config/ConfigService';
import { cloudService } from './cloudService';

/**
 * [RoomFortyRecorder] Watching guild live streams inside the app.
 *
 * The renderer owns the WebRTC connection (it plays the video); this side
 * does the HTTP parts so the Discord session token never leaves the main
 * process:
 *  - list who is live (the guild server checks the viewer's Discord role),
 *  - send the renderer's WebRTC offer to MediaMTX (WHEP) and return the answer,
 *  - close the WHEP session when the viewer stops watching.
 */

export type LiveStreamInfo = {
  name: string;
  since: string | null;
  viewers: number;
  whepUrl: string;
};

export type LiveList = {
  allowed: boolean;
  signedIn: boolean;
  roles?: string;
  streams: LiveStreamInfo[];
  error?: string;
};

export default class LiveViewer {
  private static instance: LiveViewer;

  private cfg = ConfigService.getInstance();

  private whepUrls = new Map<string, string>();

  private session?: { url: string; token: string };

  static getInstance() {
    if (!LiveViewer.instance) LiveViewer.instance = new LiveViewer();
    return LiveViewer.instance;
  }

  private token() {
    return this.cfg.get<string>('cloudSessionToken') || '';
  }

  public async list(): Promise<LiveList> {
    const token = this.token();
    if (!token) return { allowed: false, signedIn: false, streams: [] };

    try {
      const res = await axios.get(`${cloudService.apiUrl}/live/streams`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });

      const data = res.data as Omit<LiveList, 'signedIn'>;
      data.streams.forEach((s) => this.whepUrls.set(s.name, s.whepUrl));
      return { ...data, signedIn: true };
    } catch (error) {
      let message = String(error);

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          return {
            allowed: false,
            signedIn: false,
            streams: [],
            error:
              'Your Discord sign-in expired. Sign in again in Cloud settings.',
          };
        }
        message =
          error.response?.status === 404
            ? 'Live viewing is not set up on the guild server yet.'
            : `Couldn't reach the guild server (${error.message}).`;
      }

      return { allowed: true, signedIn: true, streams: [], error: message };
    }
  }

  /** Returns MediaMTX's SDP answer for the renderer's offer. */
  public async watch(name: string, offerSdp: string): Promise<string> {
    await this.stop();
    const token = this.token();
    if (!token) throw new Error('Sign in with Discord first (Cloud settings).');

    if (!this.whepUrls.has(name)) await this.list();
    const whepUrl = this.whepUrls.get(name);
    if (!whepUrl) throw new Error(`${name} isn't live any more.`);

    const res = await axios.post(whepUrl, offerSdp, {
      headers: {
        'Content-Type': 'application/sdp',
        Authorization: `Bearer ${token}`,
      },
      responseType: 'text',
      timeout: 10000,
      validateStatus: () => true,
    });

    if (res.status === 201) {
      const location = res.headers.location as string | undefined;
      if (location) {
        this.session = { url: new URL(location, whepUrl).toString(), token };
      }
      return res.data as string;
    }

    console.warn('[LiveViewer] WHEP refused', res.status, res.data);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Not allowed to watch. Live viewing is for Raider+ and Officer roles.',
      );
    }
    if (res.status === 404) throw new Error(`${name} isn't live any more.`);
    throw new Error(`The live server refused (HTTP ${res.status}).`);
  }

  public async stop() {
    const session = this.session;
    this.session = undefined;
    if (!session) return;

    try {
      await axios.delete(session.url, {
        headers: { Authorization: `Bearer ${session.token}` },
        timeout: 5000,
        validateStatus: () => true,
      });
    } catch {
      // MediaMTX also drops the session when the connection closes.
    }
  }
}
