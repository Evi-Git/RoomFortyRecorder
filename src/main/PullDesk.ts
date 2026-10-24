import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { app } from 'electron';
import { promisify } from 'util';
import axios from 'axios';
import ConfigService from 'config/ConfigService';
import CloudClient from 'storage/CloudClient';
import PullLogCapture, { CapturedPull } from 'parsing/PullLogCapture';
import PullBackfill, { BossPercentHint, uploadFullLog } from './PullBackfill';
import { makeCoachClip } from './CoachClip';
import { RendererVideo } from './types';
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

// Automatic backfill from saved combat logs.
const AUTO_BACKFILL_FIRST_MS = 2 * 60 * 1000;
const AUTO_BACKFILL_EVERY_MS = 30 * 60 * 1000;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type PullDeskRequest =
  | { action: 'config' }
  | { action: 'list'; days?: number }
  | { action: 'report'; id: string }
  | { action: 'meters'; id: string }
  | { action: 'metersTrends'; encounterId: number; difficultyId?: number }
  | { action: 'reanalyze'; id: string }
  | { action: 'boss'; encounterId: number }
  | { action: 'setNote'; encounterId: number; note: string }
  | { action: 'setAvoidable'; encounterId: number; spells: number[] }
  | { action: 'setChannel'; encounterId: number; channelId: string }
  | { action: 'nights' }
  | { action: 'night'; night: string }
  | { action: 'fullLog'; id: string }
  | {
      action: 'progression';
      encounterId: number;
      difficultyId?: number;
      phase?: 'progression' | 'reclear';
      exclude?: string[];
    }
  | { action: 'setKilledBefore'; encounterId: number; on: boolean }
  | { action: 'importWcl'; reports: string[] }
  | { action: 'importGuild' }
  | {
      action: 'importScan';
      name: string;
      realm: string;
      region: string;
      months: number;
    }
  | { action: 'importTier'; codes: string[] }
  | { action: 'setProgressionList'; shown: string[] }
  | { action: 'journalBoss'; encounterId: number; difficultyId?: number }
  | {
      action: 'journalSpell';
      spellId: number;
      encounterId?: number;
      difficultyId?: number;
      name?: string;
    }
  | { action: 'journalSpells'; ids: number[]; difficultyId?: number }
  | { action: 'talentTree'; specId: number }
  | {
      action: 'avoidableToggle';
      encounterId: number;
      spellId: number;
      name?: string;
      on: boolean;
    }
  | { action: 'setJournalId'; encounterId: number; journalId: string }
  | { action: 'logFiles' }
  | { action: 'scanLog'; file: string }
  | {
      action: 'backfillLog';
      file: string;
      bosses: string[];
      hints: BossPercentHint[];
    }
  | { action: 'backfillStatus' }
  | { action: 'watcher' }
  | {
      action: 'setWatcher';
      settings: {
        guilds?: { name: string; realm: string; region: string }[];
        zoneName?: string;
        frozen?: boolean;
      };
    }
  | { action: 'watcherCrawl' }
  | { action: 'watcherStop' }
  | { action: 'coachConfig' }
  | {
      action: 'setPersonalChannels';
      mapping: { discordId: string; name: string; channelId: string }[];
    }
  | {
      action: 'sendClip';
      // The recording, and where to read it from (local path or cloud URL).
      video: RendererVideo;
      source: string;
      at: number;
      channelId: string;
      note: string;
      title: string;
    }
  | { action: 'flags'; days?: number }
  | { action: 'addFlag'; streamer: string; at: number; note?: string }
  | { action: 'editFlag'; id: string; note: string }
  | { action: 'deleteFlag'; id: string }
  | { action: 'permissionsMe' }
  | { action: 'permissions' }
  | {
      action: 'setPermissions';
      grants: Record<string, string[]>;
      columns: string[];
    }
  | { action: 'resetPermissions' }
  | { action: 'setViewAs'; role: string | null }
  | { action: 'settings' }
  | { action: 'setSettings'; combatPotions: string[] };

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

  // Pulls from saved combat log files: automatic, and the manual
  // "Upload from combat log".
  private backfill = new PullBackfill(
    () => this.cfg.get<string>('retailLogPath'),
    () => this.cfg.get<string>('storagePath'),
    path.join(app.getPath('userData'), 'pull-backfill.json'),
  );

  // Boss % from the recorder's encounter logic, by encounter ID.
  private bossPercents = new Map<number, number>();

  static getInstance() {
    if (!PullDesk.instance) PullDesk.instance = new PullDesk();
    return PullDesk.instance;
  }

  constructor() {
    // Automatic backfill: shortly after start, then every half hour. Only
    // with "Send my pull logs" on, and never during a pull.
    const tick = () => {
      if (this.cfg.get<boolean>('pullDeskUpload') === false) return;
      if (this.capture.capturing) return;
      this.backfill
        .auto(() => this.capture.capturing)
        .then(() => {
          if (this.backfill.lastAuto?.uploaded) send('pullDeskUpdated');
        })
        .catch((error) =>
          console.warn('[PullDesk] Automatic backfill failed', String(error)),
        );
    };
    setTimeout(tick, AUTO_BACKFILL_FIRST_MS);
    setInterval(tick, AUTO_BACKFILL_EVERY_MS);
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
    await uploadFullLog(client, claim.pullId as string, pull);
  }

  private iconFlight = new Map<string, Promise<Response>>();

  /**
   * A spell icon image for the rficon:// protocol: from userData/icons, else
   * the guild server's icon cache (which may serve an HD pack), else
   * Blizzard's or Wowhead's image servers directly. Kept on disk for good.
   */
  public icon(rawName: string): Promise<Response> {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9_-]{1,120}$/.test(name)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    const known = this.iconFlight.get(name);
    if (known) return known.then((r) => r.clone());
    const job = this.loadIcon(name);
    this.iconFlight.set(name, job);
    job.finally(() => this.iconFlight.delete(name));
    return job.then((r) => r.clone());
  }

  private async loadIcon(name: string): Promise<Response> {
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
    };
    const kind = (b: Uint8Array) => {
      if (b[0] === 0x89 && b[1] === 0x50) return 'png';
      if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
      if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45)
        return 'webp';
      return null;
    };
    const reply = (bytes: Uint8Array, ext: string) =>
      new Response(Buffer.from(bytes), {
        headers: { 'Content-Type': types[ext] },
      });
    const dir = path.join(app.getPath('userData'), 'icons');
    for (const ext of Object.keys(types)) {
      try {
        const bytes = await fs.promises.readFile(
          path.join(dir, `${name}.${ext}`),
        );
        if (kind(bytes)) return reply(bytes, ext);
      } catch {
        // Not cached as this type.
      }
    }
    const save = (bytes: Uint8Array, ext: string) =>
      fs.promises
        .mkdir(dir, { recursive: true })
        .then(() =>
          fs.promises.writeFile(path.join(dir, `${name}.${ext}`), bytes),
        )
        .catch(() => {});

    const client = CloudClient.getInstance();
    if (client.pullDeskReady()) {
      try {
        const data = await client.pullDeskRequest<ArrayBuffer>(
          'get',
          `/journal/icon/${name}`,
          undefined,
          { responseType: 'arraybuffer', timeout: 20000 },
        );
        const bytes = new Uint8Array(data);
        const ext = kind(bytes);
        if (ext) {
          await save(bytes, ext);
          return reply(bytes, ext);
        }
      } catch {
        // Older server or no such icon: try the image servers directly.
      }
    }
    for (const url of [
      `https://render.worldofwarcraft.com/us/icons/56/${name}.jpg`,
      `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`,
    ]) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const ext = kind(bytes);
          if (ext) {
            await save(bytes, ext);
            return reply(bytes, ext);
          }
        }
      } catch {
        // Next source.
      }
    }
    return new Response(null, { status: 404 });
  }

  /**
   * A pull's full combat log (gzipped), for the Logs page: from the cache
   * in userData, else downloaded from the guild server and cached.
   */
  private async fullLog(client: CloudClient, pullId: string) {
    if (!/^[\w-]{1,80}$/.test(pullId)) throw new Error('Bad pull id');
    const dir = path.join(app.getPath('userData'), 'pull-logs');
    const file = path.join(dir, `${pullId}.log.gz`);
    try {
      const cached = await fs.promises.readFile(file);
      // Touch it so the cache keeps what's in use.
      fs.promises.utimes(file, new Date(), new Date()).catch(() => {});
      return { bytes: new Uint8Array(cached) };
    } catch {
      // Not cached yet.
    }
    let data: ArrayBuffer;
    try {
      data = await client.pullDeskRequest<ArrayBuffer>(
        'get',
        `/pulls/${encodeURIComponent(pullId)}/full`,
        undefined,
        { responseType: 'arraybuffer', timeout: 600000 },
      );
    } catch (error) {
      // Errors come back as bytes too: turn them into the usual JSON.
      const response = axios.isAxiosError(error) ? error.response : undefined;
      if (response && response.data instanceof ArrayBuffer) {
        try {
          response.data = JSON.parse(Buffer.from(response.data).toString());
        } catch {
          // Leave it.
        }
      }
      throw error;
    }
    const bytes = Buffer.from(data);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(file, bytes);
    await this.pruneLogCache(dir);
    return { bytes: new Uint8Array(bytes) };
  }

  /** Keeps the newest cached full logs under 1.5 GB. */
  private async pruneLogCache(dir: string) {
    const LIMIT = 1.5 * 1024 * 1024 * 1024;
    const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
    const files = (
      await Promise.all(
        names.map(async (name) => {
          const stat = await fs.promises
            .stat(path.join(dir, name))
            .catch(() => null);
          return stat ? { name, size: stat.size, at: stat.mtimeMs } : null;
        }),
      )
    )
      .filter((f): f is { name: string; size: number; at: number } =>
        Boolean(f),
      )
      .sort((a, b) => b.at - a.at);
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (total > LIMIT) {
        await fs.promises.unlink(path.join(dir, f.name)).catch(() => {});
      }
    }
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
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Coaching clip: cut 5 s before the moment to 25 s after, upload it, and
   * have the bot post it with the note and a preview frame.
   */
  private async sendClip(
    client: CloudClient,
    request: Extract<PullDeskRequest, { action: 'sendClip' }>,
  ) {
    const clip = await makeCoachClip(
      request.video,
      request.source,
      request.at,
      (stage) => send('coachClipStage', stage),
    );
    send('coachClipStage', 'sending');
    return client.pullDeskRequest(
      'post',
      '/coach/send',
      {
        videoName: clip.videoName,
        channelId: request.channelId,
        note: request.note,
        title: request.title,
        thumbnail: clip.thumbnail,
      },
      { timeout: 60000 },
    );
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
      case 'metersTrends':
        return client.pullDeskRequest(
          'get',
          `/meters/trends?encounterId=${id(request.encounterId)}${
            request.difficultyId ? `&difficulty=${request.difficultyId}` : ''
          }`,
          undefined,
          { timeout: 120000 },
        );
      case 'meters':
        return client.pullDeskRequest('get', `/pulls/${id(request.id)}/meters`);
      case 'fullLog':
        return this.fullLog(client, request.id);
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
          `/summary/boss/${id(request.encounterId)}?phase=${
            request.phase ?? 'progression'
          }${request.difficultyId ? `&difficulty=${request.difficultyId}` : ''}${
            request.exclude?.length
              ? `&exclude=${encodeURIComponent(request.exclude.join('|'))}`
              : ''
          }`,
          undefined,
          { timeout: 120000 },
        );
      case 'journalBoss':
        return client.pullDeskRequest(
          'get',
          `/journal/boss/${id(request.encounterId)}${
            request.difficultyId ? `?difficulty=${request.difficultyId}` : ''
          }`,
          undefined,
          { timeout: 60000 },
        );
      case 'journalSpell': {
        const params = new URLSearchParams();
        if (request.encounterId) {
          params.set('encounterId', String(request.encounterId));
        }
        if (request.difficultyId) {
          params.set('difficulty', String(request.difficultyId));
        }
        if (request.name) params.set('name', request.name);
        return client.pullDeskRequest(
          'get',
          `/journal/spell/${id(request.spellId)}?${params.toString()}`,
        );
      }
      case 'talentTree':
        return client.pullDeskRequest(
          'get',
          `/journal/talents/${id(request.specId)}`,
          undefined,
          { timeout: 60000 },
        );
      case 'journalSpells':
        return client.pullDeskRequest(
          'post',
          '/journal/spells',
          { ids: request.ids, difficulty: request.difficultyId },
          { timeout: 60000 },
        );
      case 'avoidableToggle':
        return client.pullDeskRequest(
          'put',
          `/bosses/${id(request.encounterId)}/avoidable-toggle`,
          { spellId: request.spellId, name: request.name, on: request.on },
          { timeout: 120000 },
        );
      case 'setJournalId':
        return client.pullDeskRequest(
          'put',
          `/bosses/${id(request.encounterId)}/journal`,
          { journalId: request.journalId },
        );
      case 'logFiles':
        return this.backfill.listLogs();
      case 'scanLog':
        return this.backfill.scan(request.file);
      case 'backfillLog':
        this.backfill.start(request.file, request.bosses, request.hints);
        return this.backfill.status;
      case 'backfillStatus':
        return { ...this.backfill.status, lastAuto: this.backfill.lastAuto };
      case 'importWcl':
        return client.pullDeskRequest(
          'post',
          '/import',
          { reports: request.reports },
          { timeout: 300000 },
        );
      case 'watcher':
        return client.pullDeskRequest('get', '/watcher');
      case 'setWatcher':
        return client.pullDeskRequest(
          'put',
          '/watcher/settings',
          request.settings,
        );
      case 'watcherCrawl':
        return client.pullDeskRequest('post', '/watcher/crawl');
      case 'watcherStop':
        return client.pullDeskRequest('post', '/watcher/stop');
      case 'coachConfig':
        return client.pullDeskRequest('get', '/coach/config');
      case 'setPersonalChannels':
        return client.pullDeskRequest('put', '/coach/mapping', {
          mapping: request.mapping,
        });
      case 'sendClip':
        return this.sendClip(client, request);
      case 'flags':
        return client.pullDeskRequest(
          'get',
          `/coach/flags?days=${request.days ?? 7}`,
        );
      case 'addFlag':
        return client.pullDeskRequest('post', '/coach/flags', {
          streamer: request.streamer,
          at: request.at,
          note: request.note ?? '',
        });
      case 'editFlag':
        return client.pullDeskRequest(
          'patch',
          `/coach/flags/${id(request.id)}`,
          {
            note: request.note,
          },
        );
      case 'deleteFlag':
        return client.pullDeskRequest(
          'delete',
          `/coach/flags/${id(request.id)}`,
        );
      case 'setProgressionList':
        return client.pullDeskRequest('put', '/progression-list', {
          shown: request.shown,
        });
      case 'importGuild':
        return client.pullDeskRequest('get', '/import/guild');
      case 'importScan':
        return client.pullDeskRequest(
          'post',
          '/import/guild/scan',
          {
            name: request.name,
            realm: request.realm,
            region: request.region,
            months: request.months,
          },
          { timeout: 180000 },
        );
      case 'importTier':
        return client.pullDeskRequest('post', '/import/tier', {
          codes: request.codes,
        });
      case 'setKilledBefore':
        return client.pullDeskRequest(
          'put',
          `/bosses/${id(request.encounterId)}/killed-before`,
          { on: request.on },
        );
      case 'permissionsMe':
        return client.pullDeskRequest('get', '/me', undefined, {
          area: 'permissions',
        });
      case 'permissions':
        return client.pullDeskRequest('get', '', undefined, {
          area: 'permissions',
        });
      case 'setPermissions':
        return client.pullDeskRequest(
          'put',
          '',
          { grants: request.grants, columns: request.columns },
          { area: 'permissions' },
        );
      case 'resetPermissions':
        return client.pullDeskRequest('post', '/reset', undefined, {
          area: 'permissions',
        });
      case 'setViewAs':
        CloudClient.viewAsRole = request.role
          ? request.role.trim().toLowerCase()
          : null;
        return client.pullDeskRequest('get', '/me', undefined, {
          area: 'permissions',
        });
      case 'settings':
        return client.pullDeskRequest('get', '/settings');
      case 'setSettings':
        return client.pullDeskRequest('put', '/settings', {
          combatPotions: request.combatPotions,
        });
      default:
        throw new Error('Unknown pull desk request');
    }
  }
}
