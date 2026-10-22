import zlib from 'zlib';
import { promisify } from 'util';
import axios from 'axios';
import ConfigService from 'config/ConfigService';
import CloudClient from 'storage/CloudClient';
import PullLogCapture, { CapturedPull } from 'parsing/PullLogCapture';
import { send } from './main';

/**
 * [RoomFortyRecorder] Pull desk, app side.
 *
 * 1. Capture: every retail combat log line passes through PullLogCapture,
 *    which keeps a filtered copy of each raid pull.
 * 2. Upload: when a pull ends, ask the guild server whether this PC should
 *    upload it (only the first raider to ask does), then send the gzipped
 *    slice. The server writes the report and posts it to Discord.
 * 3. Pull desk page: the renderer asks for reports and boss settings
 *    through the 'pullDesk' IPC channel; this side makes the HTTP calls so
 *    the Discord session token stays in the main process.
 */

const gzip = promisify(zlib.gzip);

// Wait this long after ENCOUNTER_END before claiming, so the recorder's
// encounter-specific boss % has been reported.
const CLAIM_DELAY_MS = 1500;

type ClaimResponse = {
  skip?: boolean;
  pullId?: string;
  upload?: boolean;
  // Come back after this long: the server is collecting claims.
  waitMs?: number;
  // Someone else was chosen; check once more in case they never upload.
  standby?: boolean;
};

// If the raider chosen to upload hasn't after this long, the server hands
// the pull to the next best log.
const STANDBY_CHECK_MS = 70 * 1000;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type PullDeskRequest =
  | { action: 'config' }
  | { action: 'list'; days?: number }
  | { action: 'report'; id: string }
  | { action: 'reanalyze'; id: string }
  | { action: 'boss'; encounterId: number }
  | { action: 'setNote'; encounterId: number; note: string }
  | { action: 'setAvoidable'; encounterId: number; spells: number[] }
  | { action: 'setChannel'; encounterId: number; channelId: string }
  | { action: 'nights' }
  | { action: 'night'; night: string }
  | { action: 'progression'; encounterId: number; difficultyId?: number };

export type PullDeskResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; signedOut?: boolean };

export default class PullDesk {
  private static instance: PullDesk;

  private cfg = ConfigService.getInstance();

  private capture = new PullLogCapture(
    (pull) => this.onPullFinished(pull),
    () => this.cfg.get<boolean>('pullDeskUpload'),
  );

  // Boss % from the recorder's encounter logic, by encounter ID.
  private bossPercents = new Map<number, number>();

  static getInstance() {
    if (!PullDesk.instance) PullDesk.instance = new PullDesk();
    return PullDesk.instance;
  }

  /** Raw combat log line from the retail log watcher. */
  public onLogLine(line: string) {
    try {
      this.capture.onLine(line);
    } catch (error) {
      // Never let the pull desk break log handling for recording.
      console.warn('[PullDesk] Capture failed on a line', String(error));
    }
  }

  /** Called by the log handler as a raid encounter ends. */
  public reportBossPercent(encounterId: number, percent: number) {
    if (Number.isFinite(percent)) this.bossPercents.set(encounterId, percent);
  }

  private onPullFinished(pull: CapturedPull) {
    setTimeout(() => {
      this.upload(pull).catch((error) =>
        console.warn('[PullDesk] Pull upload failed', String(error)),
      );
    }, CLAIM_DELAY_MS);
  }

  private async upload(pull: CapturedPull) {
    const client = CloudClient.getInstance();

    if (!client.pullDeskReady()) {
      console.info('[PullDesk] Not signed in to the guild server, skipping');
      return;
    }

    const bossPercent = this.bossPercents.get(pull.encounterId);
    this.bossPercents.delete(pull.encounterId);

    const ask = () =>
      client.pullDeskRequest<ClaimResponse>('post', '/claim', {
        encounterId: pull.encounterId,
        encounterName: pull.encounterName,
        difficultyId: pull.difficultyId,
        duration: pull.duration,
        result: pull.result,
        startedAt: pull.startedAt,
        bossPercent: pull.result ? 0 : bossPercent,
        lines: pull.lineCount,
      });

    let claim = await ask();

    // The server collects every raider's claim for a few seconds, then picks
    // the most complete log.
    for (let tries = 0; claim.waitMs && tries < 5; tries++) {
      await sleep(Math.min(claim.waitMs, 10000));
      claim = await ask();
    }

    // Another raider was picked; check once more in case they never upload.
    if (!claim.upload && claim.standby) {
      await sleep(STANDBY_CHECK_MS);
      claim = await ask();
    }

    if (claim.skip) {
      console.info('[PullDesk] Server does not track this difficulty');
      return;
    }

    if (!claim.upload || !claim.pullId) {
      console.info('[PullDesk] Another raider is uploading this pull');
      return;
    }

    const body = await gzip(Buffer.from(pull.log, 'utf8'));
    console.info(
      `[PullDesk] Uploading pull ${claim.pullId}:`,
      `${(pull.log.length / 1e6).toFixed(1)} MB filtered,`,
      `${(body.length / 1e6).toFixed(2)} MB gzipped`,
    );

    const put = () =>
      client.pullDeskRequest<{ status: string }>(
        'put',
        `/pulls/${encodeURIComponent(claim.pullId as string)}/log`,
        body,
        { contentType: 'application/gzip', timeout: 120000 },
      );

    let result;
    try {
      result = await put();
    } catch (error) {
      // One retry for a dropped connection; a 4xx won't get better.
      const status = axios.isAxiosError(error) ? error.response?.status : 0;
      if (status && status < 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
      result = await put();
    }

    console.info('[PullDesk] Pull report', result.status);
    send('pullDeskUpdated');
  }

  /** Renderer requests from the Pull desk page. */
  public async handle(request: PullDeskRequest): Promise<PullDeskResponse> {
    const client = CloudClient.getInstance();

    if (!client.pullDeskReady()) {
      return {
        ok: false,
        signedOut: true,
        error: 'Sign in with Discord in Cloud settings to use the pull desk.',
      };
    }

    try {
      const data = await this.route(client, request);
      return { ok: true, data };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = (error.response?.data as { error?: string } | undefined)
          ?.error;

        if (status === 401) {
          return {
            ok: false,
            signedOut: true,
            error:
              'Your Discord sign-in expired. Sign in again in Cloud settings.',
          };
        }
        // An older guild server without the pull desk answers this way.
        if (status === 404 && message === 'Unknown API route') {
          return {
            ok: false,
            error: 'The pull desk is not set up on the guild server yet.',
          };
        }
        return {
          ok: false,
          error:
            message || `The guild server said no (${status ?? error.message}).`,
        };
      }
      return { ok: false, error: String(error) };
    }
  }

  private route(client: CloudClient, request: PullDeskRequest) {
    const id = (value: string | number) => encodeURIComponent(String(value));

    switch (request.action) {
      case 'config':
        return client.pullDeskRequest('get', '/config');
      case 'list':
        return client.pullDeskRequest(
          'get',
          `/pulls?days=${request.days ?? 7}`,
        );
      case 'report':
        return client.pullDeskRequest('get', `/pulls/${id(request.id)}`);
      case 'reanalyze':
        return client.pullDeskRequest(
          'post',
          `/pulls/${id(request.id)}/reanalyze`,
        );
      case 'boss':
        return client.pullDeskRequest(
          'get',
          `/bosses/${id(request.encounterId)}`,
        );
      case 'setNote':
        return client.pullDeskRequest(
          'put',
          `/bosses/${id(request.encounterId)}/note`,
          { note: request.note },
          { timeout: 120000 },
        );
      case 'setAvoidable':
        return client.pullDeskRequest(
          'put',
          `/bosses/${id(request.encounterId)}/avoidable`,
          { spells: request.spells },
          { timeout: 120000 },
        );
      case 'setChannel':
        return client.pullDeskRequest(
          'put',
          `/bosses/${id(request.encounterId)}/channel`,
          { channelId: request.channelId },
        );
      case 'nights':
        return client.pullDeskRequest('get', '/summary/nights');
      case 'night':
        return client.pullDeskRequest(
          'get',
          `/summary/night/${id(request.night)}`,
          undefined,
          { timeout: 120000 },
        );
      case 'progression':
        return client.pullDeskRequest(
          'get',
          `/summary/boss/${id(request.encounterId)}${
            request.difficultyId ? `?difficulty=${request.difficultyId}` : ''
          }`,
          undefined,
          { timeout: 120000 },
        );
      default:
        throw new Error('Unknown pull desk request');
    }
  }
}
