import fs from 'fs';
import http from 'http';
import axios, { AxiosRequestConfig } from 'axios';
import {
  CloudMetadata,
  CloudStatus,
  CompleteMultiPartUploadRequestBody,
  CreateMultiPartUploadResponseBody,
  RendererVideo,
  UploadQueueItem,
} from 'main/types';
import path from 'path';
import { z } from 'zod';
import {
  Affiliation,
  ChatMessageWithId,
  KeystoneTimerResponse,
  PublicGuildInfo,
  TAffiliation,
  TKeystoneTimerResponse,
} from 'types/api';
import WebSocket, { RawData } from 'ws';
import {
  cloudSignedMetadataToRendererVideo,
  convertKoreanVideoCategory,
  logAxiosError,
} from 'main/util';
import StorageClient from './StorageClient';
import { getCloudConfig } from 'utils/configUtils';
import ConfigService from 'config/ConfigService';
import { clipboard, ipcMain } from 'electron';
import VideoProcessQueue from 'main/VideoProcessQueue';
import { send } from 'main/main';
import { VideoCategory } from 'types/VideoCategory';
import { cloudService } from 'main/cloudService';

const enum VideoMessages {
  CREATE = 'vc',
  DELETE = 'vd',
  PROTECT = 'vp',
  UNPROTECT = 'vu',
  TAG = 'vt',
  CHAT_CREATE = 'vm',
  CHAT_DELETE = 'vmd',
}

const enum GuildMessages {
  MTIME = 'mtime',
  USAGE = 'gu',
  LIMIT = 'gl',
}

/**
 * A client for retrieving resources from the cloud.
 */
export default class CloudClient implements StorageClient {
  /**
   * Singleton instance.
   */
  private static instance: CloudClient;

  /**
   * Singleton instance accessor.
   */
  public static getInstance() {
    if (!this.instance) this.instance = new this();
    return this.instance;
  }

  /**
   * Whether the cloud client is enabled or not.
   */
  private enabled = false;

  /**
   * Indicates whether the client is authenticated or not.
   */
  private authenticated = false;

  /**
   * Whether the client is authorized or not.
   */
  private authorized = false;

  /**
   * Whether the selected guild has been migrated or not.
   */
  private migrated = false;

  /**
   * The Discord display name of the cloud user.
   */
  private user = '';

  /**
   * The guild returned by the server. Room Forty is the only supported guild.
   */
  private guild = '';

  /**
   * The total storage usage in bytes for the current guild.
   */
  private usage = 0;

  /**
   * The maximum storage limit in bytes for the current guild.
   */
  private limit = 0;

  /**
   * Permissions for the current user in the selected guild.
   * - read: Whether the user can read/download files.
   * - write: Whether the user can upload files.
   * - del: Whether the user can delete files.
   */
  private read = false;
  private write = false;
  private del = false;

  /**
   * Available guilds the user can choose from.
   */
  private affiliations: TAffiliation[] = [];

  /**
   * The auth header for the WCR API, which uses basic HTTP auth using the cloud
   * user and password.
   */
  private authHeader?: string;

  /**
   * The cloud API endpoint. This is used for authentication, retrieval and
   * manipulation of video state from the video database, and various
   * bits of object-store interaction. It is configured at build time so a fork
   * can use its own hosted service.
   */
  private static api = cloudService.apiUrl;

  /**
   * The polling websocket endpoint. This is used to get real-time updates
   * from the cloud API in an efficient manner and is configured at build time.
   */
  private static poll = cloudService.pollUrl;

  /**
   * The cloud website, used by the client to build shareable links.
   */
  private static website = cloudService.websiteUrl;

  /**
   * Files above this threshold use multipart upload. The private guild server
   * can accept large streamed single-part uploads, so its build uses a 5GB
   * threshold to avoid unnecessary multipart work. R2-compatible builds can
   * lower it through WCR_CLOUD_MULTIPART_SIZE_MB.
   */
  private multiPartSizeBytes = cloudService.multipartSizeBytes;

  /**
   * WebSocket connection for real-time updates.
   */
  private ws: WebSocket | null = null;

  /**
   * We don't start polling immediately on creation of this class. This track if
   * startPolling has been called or not.
   */
  private polling = false;
  private pollingTimer: NodeJS.Timeout | null = null;

  /**
   * It's common to receive a bunch of video modifications at once due to
   * the housekeeper, or bulk changes. Batch these up and send them to the
   * frontend every second to avoid spurious re-renders.
   */
  private videoDeleteBatch: string[] = [];
  private videoProtectBatch: string[] = [];
  private videoUnprotectBatch: string[] = [];

  /**
   * Constructor.
   */
  private constructor() {
    console.info('[CloudClient] Creating cloud client');
    this.setupListeners();
    this.configure();
    this.startHeartbeatTimer();
    this.startReconnectTimer();
    this.startBatchTimer();
  }

  /**
   * If we have an open websocket, we want to keep it alive. This timer will
   * send a ping to do that. The server is configured to return a pong in response.
   *
   * It will close after 5 minutes of no activity so we must send messages more
   * frequently than this. Not sure this is a defined timeout, couldn't find it in
   * the Cloudflare Websocket docs, but surely every minute is fine.
   */
  private startHeartbeatTimer() {
    setInterval(() => {
      if (!this.ws) {
        // We're not connected.
        return;
      }

      if (this.ws.readyState !== WebSocket.OPEN) {
        // The socket isn't ready to send messages.
        return;
      }

      try {
        this.ws.ping();
      } catch (error) {
        console.warn(
          '[CloudClient] Error sending websocket ping',
          String(error),
        );
      }
    }, 60 * 1000);
  }

  /**
   * Timer for reconnecting the WebSocket connection. We don't try to reconnect
   * if the websocket is closed by the server. We just wait on this timer to fire.
   */
  private startReconnectTimer() {
    setInterval(() => {
      if (this.ws || !CloudClient.poll) {
        // We're already connected, or this server uses HTTP polling.
        return;
      }

      if (!this.polling) {
        // We've not been told to start polling yet.
        return;
      }

      try {
        this.connectPollingWebsocket();
      } catch (error) {
        // Not sure if this is really possible, but just being safe.
        // I think errors instead come through the on('error') handler.
        console.warn('[CloudClient] Error connecting websocket', String(error));
      }
    }, 10000);
  }

  /**
   * Timer for batch updating the frontend when the remote state changes.
   */
  private startBatchTimer() {
    setInterval(() => {
      if (this.videoDeleteBatch.length > 0) {
        const batch = this.videoDeleteBatch.splice(0);
        send('displayRemoveCloudVideos', batch);
      }

      if (this.videoProtectBatch.length > 0) {
        const batch = this.videoProtectBatch.splice(0);
        send('displayProtectCloudVideos', batch);
      }

      if (this.videoUnprotectBatch.length > 0) {
        const batch = this.videoUnprotectBatch.splice(0);
        send('displayUnprotectCloudVideos', batch);
      }
    }, 1000);
  }

  /**
   * Check if the client is ready for use.
   */
  public async ready() {
    return (
      this.enabled && this.authenticated && this.authorized && !this.migrated
    );
  }

  /**
   * Get this list of guild affiliations for the user. Optionally
   * logout the user if we get a 401 response, but not as part of
   * the configure function to avoid looping forever.
   */
  public async fetchAffiliations(logoutOn401: boolean) {
    let success = false;

    try {
      this.affiliations = await this.getUserAffiliations(logoutOn401);
      success = true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const msg = '[CloudClient] Failed to get user affiliations';
        logAxiosError(msg, error);
      } else {
        console.error('[CloudClient] Unexpected error', error);
      }
    }

    return success;
  }

  /**
   * Handle changes to the cloud status, does not refresh the videos.
   */
  public async refreshStatus() {
    const status: CloudStatus = {
      enabled: this.enabled,
      authenticated: this.authenticated,
      authorized: this.authorized,
      guild: this.guild,
      available: this.affiliations.map((a) => a.guildName),
      usage: this.usage,
      limit: this.limit,
      read: this.read,
      write: this.write,
      del: this.del,
      migrated: this.migrated,
    };

    const rdy = await this.ready();

    if (!rdy) {
      // Remove the cloud videos from the UI if we're not ready.
      send('setCloudVideos', []);
    }

    send('updateCloudStatus', status);
  }

  /**
   * Get the video state from the WCR API and set it on the frontend.
   */
  public async refreshVideos() {
    const videos = await this.getVideos();
    send('setCloudVideos', videos);
  }

  /**
   * Get the video state from the remote WCR database, and refresh
   * the frontend.
   */
  private async getVideos() {
    const rdy = await this.ready();

    if (!rdy) {
      console.info('[CloudClient] Not ready so no videos');
      return [];
    }

    console.info('[CloudClient] Getting videos from cloud');

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/video`;
    const headers = { Authorization: this.authHeader };

    const statePromise = axios.get(url, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const response = await statePromise;

    console.info(
      '[CloudClient] Loaded',
      response.data.length,
      'videos from cloud',
    );

    const data = [...response.data];
    data.forEach(convertKoreanVideoCategory);
    return data.map(cloudSignedMetadataToRendererVideo);
  }

  /**
   * HTTP-only private servers do not send websocket mutation events.
   */
  private async refreshAfterMutation() {
    if (CloudClient.poll) return;
    await Promise.all([this.refreshStatus(), this.refreshVideos()]);
  }

  /**
   * Delete a set of cloud videos. This is a bulk delete operation, but
   * totally valid to call this on one video at a time.
   */
  public async deleteVideos(videoNames: string[]) {
    console.info('[CloudClient] Attempt to delete', videoNames);

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/bulk/delete`;
    const headers = { Authorization: this.authHeader };

    await axios.post(url, videoNames, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    console.info('[CloudClient] Successfully deleted videos', videoNames);
    await this.refreshAfterMutation();
  }

  /**
   * Protect or unprotect a set of videos.
   */
  public async protectVideos(videoNames: string[], protect: boolean) {
    console.info(
      `[CloudClient] Attempt to ${protect ? 'protect' : 'unprotect'}`,
      videoNames,
    );

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/bulk/protect`;
    const headers = { Authorization: this.authHeader };
    const body = { videos: videoNames, protect: protect };

    await axios.post(url, body, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    console.info(
      `[CloudClient] Successfully ${protect ? 'protected' : 'unprotected'}`,
      videoNames,
    );
    await this.refreshAfterMutation();
  }

  /**
   * Tag a video.
   */
  public async tagVideos(videoNames: string[], tag: string) {
    console.info('[CloudClient] Set tag', tag, 'on', videoNames);

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/bulk/tag`;
    const headers = { Authorization: this.authHeader };
    const body = { videos: videoNames, tag };

    await axios.post(url, body, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    console.info('[CloudClient] Successfully set tag', tag, 'on', videoNames);
    await this.refreshAfterMutation();
  }

  /**
   * Reset the state of the client.
   */
  private reset() {
    this.enabled = false;
    this.authenticated = false;
    this.authorized = false;
    this.user = '';
    this.migrated = false;
    this.authHeader = undefined;
    this.guild = '';
    this.affiliations = [];
    this.usage = 0;
    this.limit = 0;
    this.read = false;
    this.write = false;
    this.del = false;
    this.stopPolling();
  }

  /**
   * Login to the cloud store.
   */
  private async configure() {
    console.info('[CloudClient] Configuring cloud client');
    this.reset();

    const config = getCloudConfig();

    const { cloudStorage, cloudSessionToken, cloudDiscordName, cloudUpload } =
      config;

    console.info('[CloudClient] Configure with:', {
      cloudStorage,
      cloudDiscordName,
      cloudUpload,
    });

    this.enabled = cloudStorage;

    if (!this.enabled) {
      console.info('[CloudClient] Cloud storage is not enabled');
      this.refreshStatus();
      return;
    }

    if (!cloudSessionToken) {
      console.warn('[CloudClient] No Discord session');
      this.refreshStatus();
      return;
    }

    this.user = cloudDiscordName;
    this.authHeader = `Bearer ${cloudSessionToken}`;

    const success = await this.fetchAffiliations(false);

    if (!success) {
      // Probably bad credentials.
      this.refreshStatus();
      return;
    }

    // If we got this far the Discord session is valid.
    this.authenticated = true;

    const affiliation = this.affiliations[0];

    if (!affiliation) {
      console.warn('[CloudClient] User is not affiliated with Room Forty');
      this.refreshStatus();
      return;
    }

    this.guild = affiliation.guildName;
    this.user = affiliation.userName;

    this.read = affiliation.read;
    this.write = affiliation.write;
    this.del = affiliation.del;

    if (cloudUpload && !affiliation.write) {
      console.warn('[CloudClient] User is not authorized to upload');
      this.refreshStatus();
      return;
    }

    // If we got this far the user is authorized for their configuration.
    this.authorized = true;

    // Check the guild hasn't been migrated. If it is the user should
    // login with WCL.
    const info = await this.getGuildInfo();

    if (info.migrated) {
      console.warn('[CloudClient] Guild has been migrated');
      this.migrated = true;
      this.refreshStatus();
      return;
    }

    try {
      const usagePromise = this.getUsage();
      const limitPromise = this.getStorageLimit();
      this.usage = await usagePromise;
      this.limit = await limitPromise;
    } catch (error) {
      // Unlikely to fail here as we've already contacted the server.
      console.error('[CloudClient] Failed to get guild storage info', error);
      this.refreshStatus();
      return;
    }

    this.startPolling();
    this.refreshStatus();
  }

  /**
   * Authenticate the app through the private guild's Discord server.
   */
  public async signInWithDiscord(
    openExternal: (url: string) => void | Promise<void>,
  ) {
    const code = await new Promise<string>((resolve, reject) => {
      let settled = false;

      const server = http.createServer((req, res) => {
        const url = new URL(
          req.url || '/',
          `http://${req.headers.host || '127.0.0.1'}`,
        );

        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }

        const callbackCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><title>RoomFortyRecorder</title>' +
            '<p>Discord sign-in complete. You can close this window.</p>',
        );

        if (error || !callbackCode) {
          finish(new Error('Discord sign-in was not completed.'));
          return;
        }

        finish(undefined, callbackCode);
      });

      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        if (error) reject(error);
        else if (value) resolve(value);
        else reject(new Error('Discord sign-in failed.'));
      };

      const timer = setTimeout(
        () => finish(new Error('Discord sign-in timed out.')),
        5 * 60 * 1000,
      );

      server.on('error', (error) => finish(error));
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          finish(new Error('Could not start the Discord callback.'));
          return;
        }

        const callback = `http://127.0.0.1:${address.port}/callback`;
        const startUrl = `${CloudClient.website}/auth/discord/start?callback=${encodeURIComponent(callback)}`;

        try {
          const response = await axios.get(startUrl, {
            maxRedirects: 0,
            validateStatus: (status) => status >= 300 && status < 400,
          });
          const redirectUrl = response.headers.location;
          if (typeof redirectUrl !== 'string') {
            throw new Error('Cloud server did not start Discord sign-in.');
          }
          await openExternal(redirectUrl);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });

    const response = await axios.post(
      `${CloudClient.api}/auth/discord/exchange`,
      { code },
    );
    const { token, userName, guildName } = response.data || {};

    if (
      typeof token !== 'string' ||
      typeof userName !== 'string' ||
      typeof guildName !== 'string'
    ) {
      throw new Error('The cloud server returned an invalid Discord session.');
    }

    const cfg = ConfigService.getInstance();
    cfg.set('cloudSessionToken', token);
    cfg.set('cloudDiscordName', userName);
    cfg.set('cloudStorage', true);

    await this.configure();
    await this.refreshVideos();
    return { userName, guildName };
  }

  public async signOutDiscord() {
    const cfg = ConfigService.getInstance();
    cfg.set('cloudSessionToken', '');
    cfg.set('cloudDiscordName', '');
    cfg.set('cloudStorage', false);
    await this.configure();
    send('setCloudVideos', []);
  }

  /**
   * Add a video to the WCR database.
   */
  public async postVideo(metadata: CloudMetadata) {
    console.info('[CloudClient] Adding video to database', metadata.videoName);

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/video`;
    const headers = { Authorization: this.authHeader };

    await axios.post(url, metadata, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    console.info(
      '[CloudClient] Added',
      metadata.videoName,
      'to video database.',
    );

    await this.refreshAfterMutation();

    // Always run the housekeeper after an upload so that there
    // will be space for the next upload. Don't need to wait for
    // it to finish as the result doesn't impact the client.
    this.runHousekeeping();
  }

  /**
   * Get an object and write it to a file.
   */
  public async getAsFile(
    key: string,
    url: string,
    dir: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    progressCallback = (_progress: number) => {},
  ) {
    console.info('[CloudClient] Downloading file from cloud store', key);

    const headers = { Authorization: this.authHeader };
    const encGuild = encodeURIComponent(this.guild);
    const encKey = encodeURIComponent(key);

    const sizeUrl = `${CloudClient.api}/guild/${encGuild}/video/${encKey}/size`;

    const sizeRsp = await axios.get(sizeUrl, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const sizeData = sizeRsp.data;
    const { bytes } = sizeData;

    console.info('[CloudClient] Bytes to download', bytes, 'for key', key);

    const config: AxiosRequestConfig = {
      responseType: 'stream',
      onDownloadProgress: (event) =>
        progressCallback(Math.round((100 * event.loaded) / bytes)),
    };

    // Don't worry about 401s here, this is direct to R2.
    const response = await axios.get(url, config);
    const file = path.join(dir, key);
    const writer = fs.createWriteStream(file);

    const finished = new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    response.data.pipe(writer);
    await finished;
  }

  /**
   * Sign a PUT URL by requesting the WCR API signs it. This is our protection
   * against malicious uploads; the content length is included in the header
   * and the WCR API checks the current bucket usage before approving.
   */
  private async signPutUrl(key: string, bytes: number) {
    console.info('[CloudClient] Getting signed PUT URL', key, bytes);

    const headers = { Authorization: this.authHeader };
    const guild = encodeURIComponent(this.guild);

    const url = `${CloudClient.api}/guild/${guild}/upload`;
    const body = { key, bytes };

    const response = await axios.post(url, body, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { data } = response;
    return data.signed;
  }

  /**
   * Create a multi part upload by calling the WCR API to get a list of signed
   * URLs for each part. Once we've uploaded to each URL in turn, must call
   * completeMultiPartUpload.
   */
  private async createMultiPartUpload(
    key: string,
    length: number,
  ): Promise<CreateMultiPartUploadResponseBody> {
    console.info('[CloudClient] Create signed multipart upload', key, length);

    const headers = { Authorization: this.authHeader };
    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/create-multipart-upload`;

    const body = {
      key,
      total: length,
      part: this.multiPartSizeBytes,
    };

    const response = await axios.post(url, body, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { data } = response;
    return data;
  }

  /**
   * Complete a multipart upload by calling the WCR API.
   */
  private async completeMultiPartUpload(key: string, etags: string[]) {
    console.info('[CloudClient] Complete signed multipart upload', key);

    const headers = { Authorization: this.authHeader };
    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/complete-multipart-upload`;

    const body: CompleteMultiPartUploadRequestBody = {
      etags,
      key,
    };

    await axios.post(url, body, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });
  }

  /**
   * Write a file into R2.
   *
   * @param file file path to upload
   * @param rate rate of upload in MB/s, or -1 to signify no limit
   */
  public async putFile(
    file: string,
    rate = -1,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    progressCallback = (_progress: number) => {},
  ) {
    const key = path.basename(file);

    console.info(
      '[CloudClient] Uploading',
      file,
      'to',
      key,
      'with rate limit',
      rate,
    );

    const stats = await fs.promises.stat(file);

    if (stats.size < this.multiPartSizeBytes) {
      await this.doSinglePartUpload(file, rate, progressCallback);
    } else {
      await this.doMultiPartUpload(file, rate, progressCallback);
    }
  }

  /**
   * Start listening for updates using WebSocket.
   */
  public startPolling() {
    this.polling = true;

    if (!CloudClient.poll) {
      console.info('[CloudClient] Start HTTP polling');
      this.pollingTimer = setInterval(() => this.pullCloudData(), 30000);
      this.pullCloudData();
      return;
    }

    console.info('[CloudClient] Start WebSocket polling');
    this.connectPollingWebsocket();
  }

  /**
   * Stop listening for updates using WebSocket or HTTP polling.
   */
  public stopPolling() {
    console.info('[CloudClient] Stop cloud polling');
    this.polling = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Start listening for updates using WebSocket.
   */
  private connectPollingWebsocket() {
    console.info('[CloudClient] Connecting WebSocket for updates');

    if (this.ws) {
      this.ws.close();
      this.ws.removeAllListeners();
      this.ws = null;
    }

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.poll}?guild=${guild}`;
    const headers = { Authorization: this.authHeader };
    this.ws = new WebSocket(url, { headers, followRedirects: true });

    this.ws.on('open', () => {
      console.info('[CloudClient] WebSocket connection established');

      // Once the websocket is open we do a single pull of all the data. After
      // this we can rely on the websocket to notify us of changes. We will
      // come through this again if the websocket has to reconnect so we can
      // be sure we won't have missed updates meanwhile.
      this.pullCloudData();

      // Any open chat windows must be refreshed in case we missed
      // messages while the websocket was disconnected.
      send('refreshChatMessages');
    });

    this.ws.on('message', (data) => this.handleWebsocketMessage(data));

    this.ws.on('error', (error) => {
      console.warn('[CloudClient] WebSocket error:', error);
    });

    this.ws.on('close', (code, reason) => {
      console.warn('[CloudClient] WebSocket closed:', code, reason);

      if (this.ws) {
        // The websocket has been closed, clean up the listeners so it
        // can be garbage collected to avoid a memory leak.
        this.ws.removeAllListeners();
      }

      this.ws = null;
    });
  }

  /**
   * Get the total R2 space in use by the guild.
   */
  public async getUsage() {
    console.info('[CloudClient] Get usage from API');

    const headers = { Authorization: this.authHeader };
    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/usage`;

    const response = await axios.get(url, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { data } = response;
    const { bytes } = data;
    console.info('[CloudClient] Usage was', bytes);
    return bytes;
  }

  /**
   * Get guild max storage.
   */
  public async getStorageLimit() {
    console.info('[CloudClient] Get storage limit from API');
    const headers = { Authorization: this.authHeader };
    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/limit`;

    const response = await axios.get(url, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { data } = response;
    const { bytes } = data;

    console.info('[CloudClient] Storage limit was', bytes);
    return bytes;
  }

  /**
   * Get the guilds the user is affiliated with.
   */
  private async getUserAffiliations(
    logoutOn401: boolean,
  ): Promise<TAffiliation[]> {
    console.info('[CloudClient] Get user affiliations');

    const headers = { Authorization: this.authHeader };
    const url = `${CloudClient.api}/user/affiliations`;

    const cfg: AxiosRequestConfig = { headers };

    if (logoutOn401) {
      cfg.validateStatus = (s) => this.validateResponseStatus(s);
    }

    const response = await axios.get(url, cfg);

    const { data } = response;
    const affiliations = z.array(Affiliation).parse(data);
    console.info('[CloudClient] Got user affiliations', affiliations);
    return affiliations;
  }

  /**
   * Call the API to run housekeeping, typically called after a video
   * upload, but theorically safe to call whenever. Logs the result.
   */
  public async runHousekeeping() {
    console.info('[CloudClient] Run housekeeper');

    const headers = { Authorization: this.authHeader };
    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/housekeeper`;

    const response = await axios.post(url, undefined, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { data } = response;
    console.info('[CloudClient] Housekeeping results:', data);
  }

  /**
   * Pull the entire guild state from the WCR API and refresh the frontend.
   */
  private async pullCloudData() {
    console.info('[CloudClient] Refresh cloud data');

    try {
      // Trigger videos to be refreshed. No need to await this.
      this.refreshVideos();

      // Make sure we have the latest limit and usage for the guild.
      const usagePromise = this.getUsage();
      const limitPromise = this.getStorageLimit();
      this.usage = await usagePromise;
      this.limit = await limitPromise;
      this.refreshStatus();
    } catch (error) {
      console.error(
        '[CloudClient] Failed to refresh cloud data',
        String(error),
      );
    }
  }

  /**
   * Get the content type based on the key name. It's good to pass the to
   * R2 as if we set a video content type, a link to it will be played by
   * browsers, rather than just downloading the file.
   */
  private static getContentType(key: string) {
    if (key.endsWith('.mp4')) {
      return 'video/mp4';
    }

    if (key.endsWith('.png')) {
      return 'image/png';
    }

    console.error('[CloudClient] Tried to upload invalid file type', key);
    throw new Error('Tried to upload invalid file type');
  }

  /**
   * Upload a file to S3 in as a single part. Will fail if the file is larger
   * than 10GB.
   */
  private async doSinglePartUpload(
    file: string,
    rate: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    progressCallback = (_progress: number) => {},
  ) {
    const key = path.basename(file);
    const stats = await fs.promises.stat(file);
    const contentType = CloudClient.getContentType(key);

    const config: AxiosRequestConfig = {
      onUploadProgress: (event) =>
        progressCallback(Math.round((100 * event.loaded) / stats.size)),
      headers: { 'Content-Length': stats.size, 'Content-Type': contentType },

      // Without this, we buffer the whole file (which can be several GB)
      // into memory which is just a disaster. This makes me want to pick
      // a different HTTP library. https://github.com/axios/axios/issues/1045.
      maxRedirects: 0,

      // Apply the rate limit here if it's in-play.
      // Convert units from MB/s to bytes per sec.
      maxRate: rate > 0 ? rate * 1024 ** 2 : undefined,
    };

    const signedUrl = await this.signPutUrl(key, stats.size);
    const start = new Date();

    // Retry the upload up to 5 times to allow for network errors, R2
    // errors or anything else intermittent going wrong.
    let attempts = 0;
    let success = false;

    while (!success && attempts < 5) {
      attempts++;
      const stream = fs.createReadStream(file);

      try {
        // Don't worry about 401s here, this is direct to R2.
        await axios.put(signedUrl, stream, config);
        success = true;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const msg = '[CloudClient] Single part retryable failure: ' + key;
          logAxiosError(msg, error);
        } else {
          console.error('[CloudClient] Not an AxiosError', key, String(error));
        }
      }
    }

    if (!success) {
      console.error('[CloudClient] Failed to upload:', key);
      throw new Error('Retry attempts exhausted');
    }

    const duration = (new Date().valueOf() - start.valueOf()) / 1000;

    console.info(
      '[CloudClient] Single part upload of',
      file,
      `(${stats.size} bytes) took`,
      duration,
      'seconds',
    );
  }

  /**
   * Upload a file to S3 with a multipart approach. Use this method for files
   * larger than 4.995GB as per the Cloudflare docs.
   */
  private async doMultiPartUpload(
    file: string,
    rate: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    progressCallback = (_progress: number) => {},
  ) {
    const key = path.basename(file);
    const stats = await fs.promises.stat(file);
    const contentType = CloudClient.getContentType(key);

    const signedMultipartUpload = await this.createMultiPartUpload(
      key,
      stats.size,
    );

    const start = new Date();
    const { urls } = signedMultipartUpload;

    let offset = 0;
    let remaining = stats.size;

    const numParts = urls.length;
    console.debug('[CloudClient] Multipart upload has', numParts, 'parts');
    const etags: string[] = [];

    // Loop through each of the signed upload URLs, uploading to each in
    // turn. We need to keep track of the etags returned to use when
    // completing the multipart upload.
    for (let part = 0; part < numParts; part++) {
      console.debug('[CloudClient] Starting part', part + 1);

      const url = urls[part];

      const bytes =
        remaining > this.multiPartSizeBytes
          ? this.multiPartSizeBytes
          : remaining;

      const config: AxiosRequestConfig = {
        headers: { 'Content-Length': bytes, 'Content-Type': contentType },
        onUploadProgress: (event) => {
          // This determines the total progress made, accounting for the progress
          // we are through the parts. It falls a bit short on the final part, assuming
          // it's the same size as the others, but it's good enough.
          const previous = 100 * (part / numParts);
          const current = 100 * (event.loaded / bytes);
          const normalized = (1 / numParts) * current;
          const actual = Math.round(previous + normalized);
          progressCallback(actual);
        },

        // Without this, we buffer the whole file (which can be several GB)
        // into memory which is just a disaster. This makes me want to pick
        // a different HTTP library. https://github.com/axios/axios/issues/1045.
        maxRedirects: 0,

        // Apply the rate limit here if it's in-play.
        // Convert units from MB/s to bytes per sec.
        maxRate: rate > 0 ? rate * 1024 ** 2 : undefined,
      };

      // Retry each part upload a few times on failure to allow for
      // intermittent failures the same way we do for single part uploads.
      let attempts = 0;
      let success = false;
      let rsp;

      while (!success && attempts < 5) {
        attempts++;

        const stream = fs.createReadStream(file, {
          start: offset,
          end: offset + bytes - 1,
        });

        try {
          // Don't worry about 401s here, this is direct to R2.
          rsp = await axios.put(url, stream, config);
          success = true;
        } catch (error) {
          // Almost certainly this is an AxiosError.
          if (axios.isAxiosError(error)) {
            const msg = '[CloudClient] Multipart retryable failure: ' + key;
            logAxiosError(msg, error);
          } else {
            console.error(
              '[CloudClient] Not an AxiosError',
              key,
              String(error),
            );
          }
        }
      }

      if (!success || !rsp) {
        console.error('[CloudClient] Multipart upload failed:', key);
        throw new Error('Multipart upload failed, retry attempts exhausted');
      }

      const { headers } = rsp;
      const { etag } = headers;

      if (!etag) {
        console.error('[CloudClient] No etag in response headers', key);
        throw new Error('Multipart upload failed, no etag header');
      }

      // Weirdly axios returns this with quotes included, strip them off.
      const etagNoQuotes = etag.replaceAll('"', '');
      etags.push(etagNoQuotes);

      console.debug(
        '[CloudClient] Finished part',
        part + 1,
        'etag',
        etagNoQuotes,
      );

      // Increment the offset into the file for the next go round the loop.
      offset += bytes;
      remaining -= bytes;

      // Update the progress bar on the frontend. It's a bit worse we only
      // update every time we complete a part here (which are 1GB each), so
      // UX probably a bit worse. Maybe can do better.
      progressCallback(Math.round((100 * offset) / stats.size));
    }

    await this.completeMultiPartUpload(key, etags);
    const duration = (new Date().valueOf() - start.valueOf()) / 1000;

    console.info(
      '[CloudClient] Multipart part upload of',
      file,
      `(${stats.size} bytes) took `,
      duration,
      'seconds',
    );
  }

  /**
   * Get a shareable link for a video.
   */
  public async getShareableLink(videoName: string) {
    console.info('[CloudClient] Getting shareable link', videoName);

    const guild = encodeURIComponent(this.guild);
    const video = encodeURIComponent(videoName);
    const url = `${CloudClient.api}/guild/${guild}/video/${video}/link`;
    const headers = { Authorization: this.authHeader };

    const response = await axios.post(url, undefined, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { id } = z.object({ id: z.string().min(1) }).parse(response.data);
    console.info('[CloudClient] Got shareable link', videoName, id);
    return `${CloudClient.website}/link/${encodeURIComponent(id)}`;
  }

  /**
   * Validate the response status. This is basically just default behaviour plus
   * a check for 401 status codes.
   */
  private validateResponseStatus(status: number) {
    if (status === 401) {
      this.configure();
    }

    return status >= 200 && status < 300;
  }

  private setupListeners() {
    ipcMain.on('reconfigureCloud', async () => {
      console.info('[CloudClient] Reconfiguring cloud client');
      this.configure();
    });

    ipcMain.handle('getShareableLink', async (_event, args) => {
      const videoName = args[0];
      const shareable = await this.getShareableLink(videoName);
      clipboard.writeText(shareable);
    });

    ipcMain.on('deleteVideosCloud', async (_event, args) => {
      const videos = args as RendererVideo[];
      const toDelete = videos.filter((v) => v.cloud).map((v) => v.videoName);
      if (toDelete.length < 1) return;
      this.deleteVideos(toDelete);
    });

    // VideoButton event listeners.
    ipcMain.on('videoButtonCloud', async (_event, args) => {
      const ready = await this.ready();
      const action = args[0] as string;

      if (!ready) {
        console.warn('[Manager] Cannot process event', action, args);
        return;
      }

      if (action === 'protect') {
        const protect = args[1] as boolean;
        const videos = args[2] as RendererVideo[];
        const cloud = videos.filter((v) => v.cloud);
        const toProtect = cloud.map((v) => v.videoName);
        if (toProtect.length < 1) return;
        this.protectVideos(toProtect, protect);
      }

      if (action === 'tag') {
        const tag = args[1] as string;
        const videos = args[2] as RendererVideo[];
        const cloud = videos.filter((v) => v.cloud);
        const toTag = cloud.map((v) => v.videoName);
        if (toTag.length < 1) return;
        this.tagVideos(toTag, tag);
      }

      if (action === 'download') {
        const video = args[1] as RendererVideo;
        VideoProcessQueue.getInstance().queueDownload(video);
      }

      if (action === 'upload') {
        const src = args[1] as string;
        const item: UploadQueueItem = { path: src };
        VideoProcessQueue.getInstance().queueUpload(item);
      }
    });
  }

  /**
   * Handle a websocket message, typically a notification of a change to the
   * guild video store.
   */
  private handleWebsocketMessage(data: RawData) {
    const msg = data.toString();
    const index = msg.indexOf(':');

    if (index === -1) {
      // Any message we need to take action on has a colon in it.
      // This is a ping/pong or something else we don't care about.
      return;
    }

    // Messages beyond this point are of the form key:value. Just log the key
    // to illustrate what it is. Messages may contain signed video URLs which
    // we don't want in the log.
    const key = msg.slice(0, index);
    const value = msg.slice(index + 1);
    console.info('[CloudClient] Received WebSocket message with key:', key);

    if (key === VideoMessages.CREATE) {
      const video = JSON.parse(value);
      console.info('[CloudClient] Adding cloud video', video.videoName);
      const rv = cloudSignedMetadataToRendererVideo(video);
      send('displayAddCloudVideo', rv);
      return;
    }

    if (key === VideoMessages.DELETE) {
      console.info('[CloudClient] Batching cloud video removal', value);
      this.videoDeleteBatch.push(value);
      return;
    }

    if (key === VideoMessages.PROTECT) {
      console.info('[CloudClient] Batching cloud video protection', value);
      this.videoProtectBatch.push(value);
      return;
    }

    if (key === VideoMessages.UNPROTECT) {
      console.info('[CloudClient] Batching cloud video unprotection', value);
      this.videoUnprotectBatch.push(value);
      return;
    }

    if (key === VideoMessages.TAG) {
      // Special case as we need to get the tag value as well. Encoding
      // the videoName with URL encoding in-case it has a colon in it, feels
      // like something Blizzard might do. Format is vt:URLEncodedvideoName:tag
      const tagIndex = value.indexOf(':');

      if (tagIndex === -1) {
        console.warn('[CloudClient] Invalid tag message', msg);
        return;
      }

      const encodedVideoName = value.slice(0, tagIndex);
      const videoName = decodeURIComponent(encodedVideoName);
      const tag = value.slice(tagIndex + 1);

      console.info('[CloudClient] Tagging cloud video', videoName, tag);
      send('displayTagCloudVideo', videoName, tag);
      return;
    }

    if (key === VideoMessages.CHAT_CREATE) {
      console.info('[CloudClient] Video chat message received');
      const message = JSON.parse(value);
      send('displayAddChatMessage', message);
      return;
    }

    if (key === VideoMessages.CHAT_DELETE) {
      console.info('[CloudClient] Video chat message delete received');
      const id = parseInt(value, 10);
      send('displayDeleteChatMessage', id);
      return;
    }

    if (key === GuildMessages.USAGE) {
      console.info('[CloudClient] Guild usage message received', value);
      this.usage = parseInt(value, 10);
      this.refreshStatus();
      return;
    }

    if (key === GuildMessages.LIMIT) {
      console.info('[CloudClient] Guild limit message received', value);
      this.limit = parseInt(value, 10);
      this.refreshStatus();
      return;
    }

    console.info('[CloudClient] No action on this message');
  }

  public async getOrCreateChatCorrelator(video: RendererVideo) {
    console.info('[CloudClient] Get or create chat correlator');

    const { category, uniqueHash, start, videoName, duration, clippedAt } =
      video;

    if (!start || !uniqueHash) {
      console.error(
        '[CloudClient] Unable to get or create chat correlator for this video',
        category,
        start,
        uniqueHash,
        videoName,
        duration,
        clippedAt,
      );

      throw new Error('Unable to get or create chat correlator for this video');
    }

    // Build the URL based on whether we need a named correlator or not. For
    // clips and manual we can't rely on the uniqueHash to actually be unique
    // so we have to build a unique name for the chat correlator.
    const guild = encodeURIComponent(this.guild);
    let url = `${CloudClient.api}/guild/${guild}/`;

    if (category === VideoCategory.Manual || category === VideoCategory.Clips) {
      let uniqueName = `${encodeURIComponent(videoName)} - ${duration.toFixed(2)}`;

      if (category === VideoCategory.Clips) {
        // Clips default to 30s so decent chance of a collision, so
        // also add the clippedAt time.
        uniqueName += ` - ${clippedAt}`;
      }

      url += `named-chat/${uniqueName}`;
    } else {
      url += `chat/${uniqueHash}/${start}`;
    }

    const headers = { Authorization: this.authHeader };

    const rsp = await axios.post(url, undefined, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { correlator } = z.object({ correlator: z.string() }).parse(rsp.data);
    console.info('[CloudClient] Got chat correlator', correlator);
    return correlator;
  }

  public async getChatMessages(correlator: string) {
    console.info(
      '[CloudClient] Getting chat messages for correlator',
      correlator,
    );

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/chat/${correlator}`;
    const headers = { Authorization: this.authHeader };

    const rsp = await axios.get(url, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const chatMessages = z.array(ChatMessageWithId).parse(rsp.data);

    console.info(
      '[CloudClient] Got',
      chatMessages.length,
      'chat messages for correlator',
      correlator,
    );

    return chatMessages;
  }

  public async postChatMessage(correlator: string, message: string) {
    console.info(
      '[CloudClient] Posting chat message for video',
      correlator,
      message,
    );

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/chat/${correlator}`;
    const headers = { Authorization: this.authHeader };
    const body = { message };

    await axios.post(url, body, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    console.info(
      '[CloudClient] Successfully posted chat message',
      message,
      'for correlator',
      correlator,
    );

    if (!CloudClient.poll) send('refreshChatMessages');
  }

  public async deleteChatMessage(id: number) {
    console.info('[CloudClient] Deleting chat message with id', id);

    const guild = encodeURIComponent(this.guild);
    const url = `${CloudClient.api}/guild/${guild}/chat/${id}`;
    const headers = { Authorization: this.authHeader };

    await axios.delete(url, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    console.info('[CloudClient] Successfully deleted chat message with id', id);

    if (!CloudClient.poll) send('refreshChatMessages');
  }

  public async getKeystoneTimers(
    mapId: number,
  ): Promise<TKeystoneTimerResponse> {
    console.info('[CloudClient] Get keystone timers for', mapId);
    const url = `${CloudClient.api}/keystone/timer/${mapId}`;

    const rsp = await axios.get(url, {
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const { data } = rsp;
    const parsed = KeystoneTimerResponse.parse(data);

    console.info(
      '[CloudClient] Successfully got keystone timers for',
      mapId,
      parsed,
    );

    return parsed;
  }

  public async getGuildInfo() {
    console.info('[CloudClient] Get guild info for guild', this.guild);

    const url = `${CloudClient.api}/guild/${encodeURIComponent(this.guild)}`;
    const headers = { Authorization: this.authHeader };

    const rsp = await axios.get(url, {
      headers,
      validateStatus: (s) => this.validateResponseStatus(s),
    });

    const info = PublicGuildInfo.parse(rsp.data);
    console.info('[CloudClient] Successfully got guild info', info);
    return info;
  }
}
