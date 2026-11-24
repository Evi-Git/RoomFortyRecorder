/**
 * Browser stand-in for the Electron preload (`window.electron.ipcRenderer`).
 * Import this FIRST in every entry: some renderer modules read the bridge at
 * import time.
 *
 * - `invoke(channel, [request])`: answers come from (in order) a test
 *   override (`__harness.answer`), then the table below. `pullDesk` is sent
 *   to `POST /ipc/pullDesk` (serve.mjs: the app's own PullDesk against a
 *   local guild server); without a backend it falls back to a few canned
 *   answers (the single-page smoke test).
 * - `sendSync('config', ...)` is backed by an in-memory copy of the default
 *   config (signed in, "Send my Logs" on, a retail log path set).
 * - `on(channel, fn)` returns an unsubscribe. State the main process pushes
 *   at start (recorder status, disk/cloud status, recordings, ...) is
 *   delivered when the renderer subscribes; `__harness.emit(channel, ...args)`
 *   pushes more later.
 * - Start-up options come from `window.__harnessInit` (set by
 *   `page.addInitScript`): `{ config, answers, version }`.
 */
import { configSchema } from 'config/configSchema';
import { cloudVideos, diskVideos } from './fixtures/recordings';

type Answer = (...args: any[]) => unknown;
type Listener = (...args: any[]) => void;

type Harness = {
  /** Override the answer for `channel` or `channel:action` (e.g. 'pullDesk:season'). */
  answer: (key: string, fn: Answer | unknown) => void;
  /** Drop an override (or all of them). */
  clearAnswers: (key?: string) => void;
  /** Every invoke so far, for assertions. */
  calls: { channel: string; args: unknown[] }[];
  /** Fire-and-forget messages (sendMessage) so far. */
  messages: { channel: string; args: unknown[] }[];
  overrides: Map<string, Answer | unknown>;
  /** Deliver an event to the renderer, as the main process would. */
  emit: (channel: string, ...args: unknown[]) => void;
  /** Change settings. The renderer reads them when it mounts: set before. */
  config: (patch?: Record<string, unknown>) => Record<string, unknown>;
  /** pullDesk actions that failed (ok: false) or whose request threw. */
  failures: { action: string; error: string }[];
};

type Init = {
  config?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  version?: string;
  /** Force the sidebar's sign-in state (default: from config). */
  signIn?: { state: string; [key: string]: unknown };
};
const init: Init = (window as any).__harnessInit ?? {};

const overrides = new Map<string, Answer | unknown>(
  Object.entries(init.answers ?? {}),
);
const calls: Harness['calls'] = [];
const messages: Harness['messages'] = [];
const failures: Harness['failures'] = [];

// ---- Config ---------------------------------------------------------------

const defaults: Record<string, unknown> = Object.fromEntries(
  Object.entries(configSchema).map(([k, v]) => [k, (v as any).default]),
);
const config: Record<string, unknown> = {
  ...defaults,
  storagePath: 'D:\\Recordings',
  retailLogPath: 'C:\\Games\\World of Warcraft\\_retail_\\Logs',
  recordRetail: true,
  firstTimeSetup: false,
  cloudStorage: true,
  cloudUpload: true,
  cloudSessionToken: 'harness-session',
  cloudDiscordName: 'Harness Raider',
  pullDeskUpload: true,
  chatUserNameAgreed: 'Harness Raider',
  ...init.config,
};

const configHandler = (args: any[]) => {
  const [op, key, value] = args;
  if (op === 'get') return config[key];
  if (op === 'set') config[key] = value;
  if (op === 'set_values') Object.assign(config, key);
  return undefined;
};

// ---- Events ---------------------------------------------------------------

const listeners = new Map<string, Set<Listener>>();
// Latest value of state channels, replayed to a new subscriber.
const sticky = new Map<string, unknown[]>();
const STICKY = new Set([
  'updateRecStatus',
  'updateDiskStatus',
  'updateCloudStatus',
  'updateCombatLoggingStatus',
  'updateVersionDisplay',
  'updateStatus',
  'setDiskVideos',
  'setCloudVideos',
  'updateSaveStatus',
  'updateMicStatus',
  'updateActivityStatus',
]);

const emit = (channel: string, ...args: unknown[]) => {
  if (STICKY.has(channel)) sticky.set(channel, args);
  listeners.get(channel)?.forEach((fn) => fn(...args));
};

const on = (channel: string, fn: Listener) => {
  let set = listeners.get(channel);
  if (!set) listeners.set(channel, (set = new Set()));
  set.add(fn);
  const last = sticky.get(channel);
  if (last) setTimeout(() => set?.has(fn) && fn(...last), 0);
  return () => {
    set?.delete(fn);
  };
};

// ---- Fixtures for what the main process knows -----------------------------

const GB = 1024 ** 3;
const version = init.version ?? '1.9.125';

const FIXTURE_STREAMS = {
  allowed: true,
  signedIn: true,
  roles: 'Raider+ or Officer',
  streams: [
    { name: 'Fixture-Aldra', since: new Date(Date.now() - 42 * 60000).toISOString(), viewers: 2, whepUrl: 'https://fixture.invalid/whep' },
    { name: 'Fixture-Bram', since: new Date(Date.now() - 7 * 60000).toISOString(), viewers: 0, whepUrl: 'https://fixture.invalid/whep' },
  ],
};

const FIXTURE_TIMELINE = {
  v: 1,
  sources: [
    { name: 'Fixture-Aldra', kind: 'player' },
    { name: "Ula'tek", kind: 'boss', npcId: 1 },
  ],
  spells: { 20473: 'Holy Shock', 1022: 'Blessing of Protection', 99999: 'Fixture Strike' },
  casts: [
    [50, 20473, 0, 1],
    [220, 20473, 0, 1],
    [400, 99999, 1, 0],
    [410, 99999, 1, 1],
    [800, 1022, 0, 1],
  ],
};

const encoders = ['obs_x264', 'obs_nvenc_h264_tex', 'obs_nvenc_hevc_tex', 'obs_nvenc_av1_tex'];

const displays = [
  {
    id: 1,
    index: 0,
    physicalPosition: 'left',
    primary: true,
    displayFrequency: 144,
    depthPerComponent: 8,
    size: { width: 2560, height: 1440 },
    physicalSize: { width: 2560, height: 1440 },
    aspectRatio: 16 / 9,
    scaleFactor: 1,
  },
  {
    id: 2,
    index: 1,
    physicalPosition: 'right',
    primary: false,
    displayFrequency: 60,
    depthPerComponent: 8,
    size: { width: 1920, height: 1080 },
    physicalSize: { width: 1920, height: 1080 },
    aspectRatio: 16 / 9,
    scaleFactor: 1,
  },
];

const audioChoices = {
  name: 'device_id',
  type: 'list',
  items: [
    { name: 'Default', value: 'default' },
    { name: 'Speakers (Fixture Audio)', value: 'speakers' },
    { name: 'Headset (Fixture Audio)', value: 'headset' },
  ],
};

// The sign-in state the main process would report for this config: off,
// signed out (no token) or connected. A scene can force another with
// init.signIn (offline, expired, refused).
const forced = init.signIn && { ...init.signIn };
// `nextRetryIn` (ms from page load) stands in for nextRetryAt.
if (forced && typeof forced.nextRetryIn === 'number') {
  forced.nextRetryAt = Date.now() + forced.nextRetryIn;
  delete forced.nextRetryIn;
}
const signIn = forced ?? {
  state: !config.cloudStorage
    ? 'off'
    : config.cloudSessionToken
      ? 'connected'
      : 'signedOut',
};
const signedIn = signIn.state === 'connected';

// What the main process pushes once the window is up.
const startupState: [string, unknown[]][] = [
  // RecStatus.WaitingForWoW = 0
  ['updateRecStatus', [0, '']],
  ['updateDiskStatus', [{ usage: 18.4 * GB, limit: 50 * GB }]],
  [
    'updateCloudStatus',
    [
      {
        signIn,
        enabled: Boolean(config.cloudStorage),
        authenticated: signedIn,
        authorized: signedIn,
        guild: signedIn ? 'Room Forty' : '',
        available: ['Room Forty'],
        read: true,
        write: true,
        del: true,
        usage: 212 * GB,
        limit: 1000 * GB,
        migrated: false,
      },
    ],
  ],
  [
    'updateCombatLoggingStatus',
    [{ retail: { advanced: true, latestLogAgeMs: Date.now() - 4000 /* an mtime, despite the name */ }, retailPtr: { advanced: true, latestLogAgeMs: -1 } }],
  ],
  ['updateVersionDisplay', [`v${version}`]],
  ['updateStatus', [{ state: 'idle' }]],
  ['setDiskVideos', [diskVideos]],
  ['setCloudVideos', [cloudVideos]],
];
startupState.forEach(([channel, args]) => sticky.set(channel, args));

// ---- pullDesk -------------------------------------------------------------

const logBytes = async () => {
  const res = await fetch('/log.gz');
  if (!res.ok) throw new Error(`/log.gz answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

// Without a backend (serve.mjs without --logs): a few canned answers.
const pullDeskOffline = async (req: { action?: string } & Record<string, any>) => {
  switch (req?.action) {
    case 'fullLog':
      return { ok: true, data: { bytes: await logBytes() } };
    case 'analyzePresets':
      // AnalyzeView reads `data.presets || {}`: an object, not an array.
      return { ok: true, data: { presets: {} } };
    case 'permissionsMe':
      return { ok: true, data: { owner: true, viewAs: null, roles: [], can: {} } };
    case 'journalSpells':
      return { ok: true, data: { spells: {}, pending: 0 } };
    case 'spellNames':
      return { ok: true, data: { names: {} } };
    default:
      return { ok: false, error: 'not mocked' };
  }
};

const pullDesk = async (req: { action?: string } & Record<string, any>) => {
  let res: Response;
  try {
    res = await fetch('/ipc/pullDesk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    return { ok: false, error: `connect ECONNREFUSED (${String(e)})` };
  }
  if (res.status === 404) return pullDeskOffline(req);
  if (req?.action === 'fullLog' && (res.headers.get('content-type') ?? '').includes('octet-stream')) {
    return { ok: true, data: { bytes: new Uint8Array(await res.arrayBuffer()) } };
  }
  return res.json();
};

// ---- Channel table --------------------------------------------------------

const table: Record<string, Answer> = {
  pullDesk: (args) => pullDesk(args?.[0] ?? {}),
  // Caller reads got?.[id]: an empty map means "no icon known".
  spellIcons: () => ({}),
  // null: the image falls back to the CDN (fails offline; fine).
  iconImage: () => null,
  getEncoders: () => encoders,
  getSensibleEncoderDefault: () => 'obs_nvenc_h264_tex',
  getHardwareAcceleration: () => true,
  getAllDisplays: () => displays,
  getDisplayInfo: () => ({ canvasWidth: 1920, canvasHeight: 1080, previewWidth: 960, previewHeight: 540 }),
  getSourcePosition: () => ({ x: 0, y: 0, width: 1920, height: 1080, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, sourceWidth: 1920, sourceHeight: 1080 }),
  getAudioSourceProperties: () => [audioChoices],
  createAudioSource: (args) => args?.[0] ?? 'WCR Audio Source 3',
  audioSettingsOpen: () => undefined,
  audioSettingsClosed: () => undefined,
  getUpdateStatus: () => ({ state: 'idle' }),
  checkForUpdates: () => ({ state: 'upToDate' }),
  liveListStreams: () => FIXTURE_STREAMS,
  liveStreamGetState: () => ({ live: false, state: 'idle' }),
  liveStreamToggle: () => ({ live: false, state: 'idle' }),
  // The fixture streams have no WebRTC server: the Live page's own error.
  liveWatch: () => ({ error: 'The live server (MediaMTX) is not running (harness).' }),
  liveUnwatch: () => undefined,
  getTimeline: () => FIXTURE_TIMELINE,
  getShareableLink: () => 'https://fixture.invalid/link/abc123',
  getOrCreateChatCorrelator: () => 'fixture-correlator',
  getChatMessages: () => [
    { id: 1, timestamp: Date.now() - 600000, userName: 'Fixture-Aldra', message: 'Nice kill!', correlator: 'fixture-correlator' },
    { id: 2, timestamp: Date.now() - 500000, userName: 'Fixture-Bram', message: 'Healers were great.', correlator: 'fixture-correlator' },
  ],
  bugReport: () => ({ ok: true }),
  uploadFailureAction: () => [],
  signInWithDiscord: () => ({ ok: true, userName: 'Harness Raider', guildName: 'Room Forty' }),
  cancelDiscordSignIn: () => undefined,
  signOutDiscord: () => undefined,
  selectPath: () => 'D:\\Recordings',
  selectFile: () => 'C:\\fixture\\file.txt',
  selectImage: () => 'C:\\fixture\\image.png',
  getNextKeyPress: () => ({ keyCode: 59, mouseButton: -1, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, type: 0 }),
  getLogDiagnostics: () => ({
    dir: 'C:\\Users\\fixture\\AppData\\Roaming\\RoomFortyRecorder\\logs',
    files: ['main.log'],
    lines: [
      '2026-10-21 20:40:02 [info] [Manager] Fixture log line one',
      '2026-10-21 20:40:03 [info] [PullDesk] Fixture log line two',
    ],
  }),
  createDiagsBundle: () => 'C:\\fixture\\diagnostics.zip',
};

const invoke = async (channel: string, args: unknown[] = []) => {
  calls.push({ channel, args });
  const action = channel === 'pullDesk' ? (args as any[])?.[0]?.action : null;
  let result: unknown;
  let found = false;
  for (const key of [action ? `${channel}:${action}` : '', channel]) {
    if (key && overrides.has(key)) {
      const o = overrides.get(key);
      result = typeof o === 'function' ? await (o as Answer)(args) : o;
      found = true;
      break;
    }
  }
  if (!found) {
    const d = table[channel];
    result = d ? await d(args) : { ok: false, error: 'not mocked' };
  }
  if (channel === 'pullDesk' && (result as any)?.ok === false) {
    failures.push({ action: String(action), error: String((result as any).error) });
  }
  return result;
};

const sendMessage = (channel: string, args: unknown[] = []) => {
  messages.push({ channel, args });
  if (channel === 'config') configHandler(args as any[]);
};

const sendSync = (channel: string, args: unknown[] = []) => {
  if (channel === 'config') return configHandler(args as any[]);
  if (channel === 'videoPlayerSettings') return { muted: false, volume: 1 };
  return undefined;
};

const noop = () => {};

// The preload also exposes helper methods; most just invoke or send.
const helper = (name: string) => (...args: unknown[]) => {
  messages.push({ channel: name, args });
  return undefined;
};
const asInvoke = (name: string) => (...args: unknown[]) => invoke(name, args);

(window as any).electron = {
  ipcRenderer: {
    invoke,
    sendMessage,
    sendSync,
    on,
    once: (channel: string, fn: Listener) => {
      const off = on(channel, (...a) => {
        off();
        fn(...a);
      });
    },
    removeAllListeners: (channel: string) => listeners.delete(channel),
    removeListener: noop,
    getDisplayInfo: asInvoke('getDisplayInfo'),
    configurePreview: helper('configurePreview'),
    showPreview: helper('showPreview'),
    hidePreview: helper('hidePreview'),
    disablePreview: helper('disablePreview'),
    getSourcePosition: asInvoke('getSourcePosition'),
    setSourcePosition: helper('setSourcePosition'),
    resetSourcePosition: helper('resetSourcePosition'),
    audioSettingsOpen: asInvoke('audioSettingsOpen'),
    audioSettingsClosed: asInvoke('audioSettingsClosed'),
    createAudioSource: asInvoke('createAudioSource'),
    getAudioSourceProperties: asInvoke('getAudioSourceProperties'),
    deleteAudioSource: helper('deleteAudioSource'),
    setAudioSourceDevice: helper('setAudioSourceDevice'),
    setAudioSourceWindow: helper('setAudioSourceWindow'),
    setAudioSourceTracks: helper('setAudioSourceTracks'),
    setAudioSourceVolume: helper('setAudioSourceVolume'),
    setForceMono: helper('setForceMono'),
    setAudioSuppression: helper('setAudioSuppression'),
    reconfigureBase: helper('reconfigureBase'),
    reconfigureVideo: helper('reconfigureVideo'),
    reconfigureAudio: helper('reconfigureAudio'),
    reconfigureOverlay: helper('reconfigureOverlay'),
    reconfigureCloud: helper('reconfigureCloud'),
    getSensibleEncoderDefault: asInvoke('getSensibleEncoderDefault'),
    signInWithDiscord: asInvoke('signInWithDiscord'),
    cancelDiscordSignIn: asInvoke('cancelDiscordSignIn'),
    signOutDiscord: asInvoke('signOutDiscord'),
    getOrCreateChatCorrelator: asInvoke('getOrCreateChatCorrelator'),
    getChatMessages: asInvoke('getChatMessages'),
    postChatMessage: helper('postChatMessage'),
    deleteChatMessage: helper('deleteChatMessage'),
    toggleManualRecording: helper('toggleManualRecording'),
    forceStopRecording: helper('forceStopRecording'),
    createKillVideo: helper('createKillVideo'),
    clipVideo: helper('clipVideo'),
    getHardwareAcceleration: asInvoke('getHardwareAcceleration'),
    createDiagsBundle: asInvoke('createDiagsBundle'),
    getLogDiagnostics: asInvoke('getLogDiagnostics'),
    openSystemExplorer: helper('openSystemExplorer'),
    setOpenInstantReplayFile: helper('setOpenInstantReplayFile'),
    refreshCombatLogStatus: helper('refreshCombatLogStatus'),
  },
};

(window as any).__harness = {
  answer: (key, fn) => overrides.set(key, fn),
  clearAnswers: (key) => (key ? overrides.delete(key) : overrides.clear()),
  calls,
  messages,
  overrides,
  emit,
  config: (patch) => Object.assign(config, patch ?? {}),
  failures,
} satisfies Harness;

export {};
