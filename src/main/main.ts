import path from 'path';
import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Tray,
  Menu,
  clipboard,
  protocol,
} from 'electron';
import os from 'os';
import fs from 'fs';
import { uIOhook } from 'uiohook-napi';
import assert from 'assert';
import { getLocalePhrase, Language } from 'localisation/translations';
import {
  resolveHtmlPath,
  openSystemExplorer,
  getAvailableDisplays,
  getAssetPath,
  handleSafeVodRequest,
  runFirstTimeSetupActionsObs,
  runFirstTimeSetupActionsNoObs,
  createDiagsBundle,
  readTimelineFile,
} from './util';
import {
  OurDisplayType,
  RendererVideo,
  SoundAlerts,
  VideoPlayerSettings,
} from './types';
import ConfigService from '../config/ConfigService';
import Manager from './Manager';
import AppUpdater from './AppUpdater';
import MenuBuilder from './menu';
import { Phrase } from 'localisation/phrases';
import CloudClient from 'storage/CloudClient';
import DiskClient from 'storage/DiskClient';
import Poller from 'utils/Poller';
import Recorder from './Recorder';
import LiveStreamer from './LiveStreamer';
import LiveViewer from './LiveViewer';
import PullDesk from './PullDesk';
import SpellIcons from './SpellIcons';
import AsyncQueue from 'utils/AsyncQueue';
import { getApplicationLogDir, setupApplicationLogging } from './logging';

setupApplicationLogging();
const appVersion = app.getVersion();
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tzOffset = new Date().getTimezoneOffset() * -1; // Offset is wrong direction so flip it.
const tzOffsetStr = `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset / 60}`;

console.info('[Main] App starting, version:', appVersion);
console.info('[Main] Node version', process.versions.node);
console.info('[Main] ICU version', process.versions.icu);
console.info('[Main] On OS:', os.platform(), os.release());
console.info('[Main] In timezone:', tz, tzOffsetStr);

let window: BrowserWindow | null = null;
let tray: Tray | null = null;

// [RoomFortyRecorder] Match the installer's app ID so the running window
// shares the pinned/Start menu shortcut's taskbar button and icon (and
// Windows notifications are attributed to the app).
if (process.platform === 'win32') {
  app.setAppUserModelId('org.RoomFortyRecorder');
}
let rendererRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

const recoverRenderer = (reason: string, details?: unknown) => {
  if (rendererRecoveryTimer || !window || window.isDestroyed()) return;

  console.error(
    '[Main] Renderer unavailable; scheduling reload',
    reason,
    details,
  );
  rendererRecoveryTimer = setTimeout(() => {
    rendererRecoveryTimer = null;
    const contents = window?.webContents;

    if (!contents || contents.isDestroyed()) return;

    try {
      contents.reload();
    } catch (error) {
      console.error('[Main] Failed to reload renderer', error);
    }
  }, 100);
};

const manager = new Manager();

/**
 * Create a settings store to handle the config.
 * This defaults to a path like:
 *   - (prod) "C:\Users\alexa\AppData\Roaming\WarcraftRecorder\config-v3.json"
 *   - (dev)  "C:\Users\alexa\AppData\Roaming\Electron\config-v3.json"
 */
const cfg = ConfigService.getInstance();

// Don't bother to signal any changes to the frontend here, they Window isn't
// shown yet so they can't have opened the settings.
const firstTimeSetup = cfg.get<boolean>('firstTimeSetup');

if (firstTimeSetup) {
  // Things we want to do before we initialize OBS.
  console.info('[Main] Run first time setup actions');
  runFirstTimeSetupActionsNoObs();
  cfg.set('firstTimeSetup', false); // This gets done again when we default the encoder.
}

// It's a common problem that hardware acceleration causes rendering issues.
// Unclear why this happens and surely not an application bug but we can
// make it easy for users to disable it if they want to. This is applied on launch
// and while the config can be changed the setting is immutable for the remainder
// of the processes lifetime.
const hardwareAccelerationAtStartup = cfg.get<boolean>('hardwareAcceleration');

if (!hardwareAccelerationAtStartup) {
  console.info('[Main] Disabling hardware acceleration');
  app.disableHardwareAcceleration();
}

ipcMain.handle('getHardwareAcceleration', () => {
  return hardwareAccelerationAtStartup;
});

// Register the vod:// protocol as privileged. Required to securely play
// videos from disk.
protocol.registerSchemesAsPrivileged([
  // [RoomFortyRecorder] Spell icons, cached on disk and on the guild server.
  {
    scheme: 'rficon',
    privileges: { bypassCSP: true, standard: true, supportFetchAPI: true },
  },
  {
    scheme: 'vod',
    privileges: {
      bypassCSP: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

/**
 * Default the video player settings on app start.
 */
const videoPlayerSettings: VideoPlayerSettings = {
  muted: false,
  volume: 1,
};

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.info);
};

/**
 * Setup tray icon, menu and event listeners.
 */
const setupTray = () => {
  tray = new Tray(getAssetPath('./icon/small-icon.png'));

  // This wont update without an app restart but whatever.
  const language = cfg.get<string>('language') as Language;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: getLocalePhrase(language, Phrase.SystemTrayOpen),
      click() {
        console.info('[Main] User clicked open on tray icon');
        if (window) window.show();
      },
    },
    {
      label: getLocalePhrase(language, Phrase.SystemTrayQuit),
      click() {
        console.info('[Main] User clicked close on tray icon');

        if (window) {
          window.close();
        }
      },
    },
  ]);

  tray.setToolTip('Room Forty Toolkit');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    console.info('[Main] User double clicked tray icon');

    if (window) {
      window.show();
    }
  });
};

/**
 * Creates the main window.
 */
const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  window = new BrowserWindow({
    show: false,
    height: 1020 * 0.9,
    width: 1980 * 0.8,
    icon: getAssetPath('./icon/small-icon.png'),
    frame: false,
    title: `Room Forty Toolkit v${appVersion}`,
    webPreferences: {
      sandbox: true, // Good security practice.
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Renderer process gone', details);
    if (details.reason !== 'clean-exit') {
      recoverRenderer('render-process-gone', details);
    }
  });

  // Prevent Windows from opening the native window menu on draggable regions.
  window.on('system-context-menu', (event) => event.preventDefault());

  // We need to do this AFTER creating the window as it's used by the preview.
  Recorder.getInstance().initializeObs();
  await manager.startup();

  if (firstTimeSetup) {
    console.info('[Main] Run first time setup actions');
    runFirstTimeSetupActionsObs();
    cfg.set('firstTimeSetup', false);
  }

  // This gets hit on a user triggering refresh with CTRL-R.
  window.on('ready-to-show', async () => {
    console.info('[Main] Ready to show');

    try {
      const status = app.getGPUFeatureStatus();
      const info = await app.getGPUInfo('complete');
      console.info('[Main] GPU info', { status, info });
    } catch (error) {
      console.error('[Main] Failed to get GPU info', error);
    }

    if (!window) {
      throw new Error('window is not defined');
    }

    // This shows the correct version on a release build, not during development.
    send('updateVersionDisplay', `Room Forty Toolkit v${appVersion}`);

    const startMinimized = cfg.get<boolean>('startMinimized');
    if (!startMinimized) window.show();

    // Important to refresh status and videos after a user triggered
    // refresh, otherwise the frontend will be in its default state
    // which may not reflect reality.
    const disk = DiskClient.getInstance();
    const cloud = CloudClient.getInstance();

    await Promise.all([
      manager.refreshStatus(),
      disk.refreshStatus(),
      disk.refreshVideos(),
      cloud.refreshStatus(),
      cloud.refreshVideos(),
    ]);

    manager.pushCombatLoggingStatus();
  });

  window.on('focus', () => {
    send('window-focus-status', true);
  });

  window.on('blur', () => {
    send('window-focus-status', false);
  });

  window.on('closed', () => {
    window = null;
  });

  await window.loadURL(resolveHtmlPath('index.html'));
  setupTray();

  // Open urls in the user's browser
  window.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  uIOhook.start();

  // Runs the auto-updater, which checks GitHub for new releases
  // and will prompt the user if any are available.
  new AppUpdater(window);
};

/**
 * window event listeners.
 */
ipcMain.on('window', (_event, args) => {
  if (window === null) return;

  if (args[0] === 'minimize') {
    console.info('[Main] User clicked minimize');

    if (cfg.get<boolean>('minimizeToTray')) {
      console.info('[Main] Minimize main window to tray');
      send('pausePlayer');
      window.hide();
    } else {
      console.info('[Main] Minimize main window to taskbar');
      window.minimize();
    }
  }

  if (args[0] === 'resize') {
    console.info('[Main] User clicked resize');

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }

  if (args[0] === 'quit') {
    console.info('[Main] User clicked quit button');

    if (cfg.get<boolean>('minimizeOnQuit')) {
      console.info('[Main] Hiding main window');
      send('pausePlayer');
      window.hide();
    } else {
      console.info('[Main] Closing main window');
      window.close();
    }
  }
});

/**
 * Opens a system explorer window to select a path.
 */
ipcMain.handle('selectPath', async () => {
  if (!window) {
    return '';
  }

  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
  });

  if (result.canceled) {
    console.info('[Main] User cancelled path selection');
    return '';
  }

  return result.filePaths[0];
});

/**
 * Opens a system explorer window to select a path.
 */
ipcMain.handle('selectFile', async () => {
  if (!window) {
    return '';
  }

  const result = await dialog.showOpenDialog(window);

  if (result.canceled) {
    console.info('[Main] User cancelled file selection');
    return '';
  }

  return result.filePaths[0];
});

/**
 * Opens a system explorer window to select a path.
 */
ipcMain.handle('selectImage', async () => {
  if (!window) {
    return '';
  }

  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['gif', 'png'] }],
  });

  if (result.canceled) {
    console.info('[Main] User cancelled file selection');
    return '';
  }

  return result.filePaths[0];
});

/**
 * Listener to open the folder containing the Warcraft Recorder logs.
 */
ipcMain.on('logPath', (_event, args) => {
  if (args[0] === 'open') {
    const logDir = getApplicationLogDir();
    // `explorer /select` on a folder silently does nothing in some setups,
    // so open the folder itself (making sure it exists) and fall back.
    fs.promises
      .mkdir(logDir, { recursive: true })
      .then(() => shell.openPath(logDir))
      .then((error) => {
        if (!error) return;
        console.warn('[Main] Could not open log folder', logDir, error);
        openSystemExplorer(logDir);
      })
      .catch((error) => {
        console.warn('[Main] Could not open log folder', logDir, error);
        openSystemExplorer(logDir);
      });
  }
});

/**
 * Where the application logs are, plus the recent icon/Logs-page lines from
 * the newest log files, so they can be copied without hunting for files.
 */
ipcMain.handle('getLogDiagnostics', async () => {
  const dir = getApplicationLogDir();
  const pattern = /\[(SpellIcons|PullDesk|Logging)\]|rficon|journal/;
  try {
    const names = (await fs.promises.readdir(dir)).filter(
      (name) => name.startsWith('RoomFortyRecorder') && name.endsWith('.log'),
    );
    const stats = await Promise.all(
      names.map(async (name) => ({
        file: path.join(dir, name),
        mtime: (await fs.promises.stat(path.join(dir, name))).mtimeMs,
      })),
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    const newest = stats.slice(0, 3).reverse();
    const lines: string[] = [];
    for (const { file } of newest) {
      const text = await fs.promises.readFile(file, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (pattern.test(line)) lines.push(line);
      }
    }
    return {
      dir,
      files: newest.map((f) => path.basename(f.file)),
      lines: lines.slice(-400),
    };
  } catch (error) {
    return { dir, files: [], lines: [], error: String(error) };
  }
});

/**
 * Zips a diags bundle up in the log folder and return the path.
 */
ipcMain.handle('createDiagsBundle', async () => {
  const logDir = getApplicationLogDir();
  return createDiagsBundle(logDir);
});

/**
 * Generic open a file in system explorer listener.
 */
ipcMain.on('systemExplorer', (_event, target) => {
  const targetPath = target as string;
  openSystemExplorer(targetPath);
});

/**
 * Listener to write to clipboard.
 */
ipcMain.on('writeClipboard', (_event, args) => {
  clipboard.writeText(args[0] as string);
});

// Enforces serial execution of calls to reconfigureBase. Also has a limit
// of 1 queued task and will drop any extra tasks, which is appropriate for
// deduplicating reconfigure work.
const reconfigureBaseQueue = new AsyncQueue(1);

/**
 * A reconfig is triggered when a base setting changes.
 */
ipcMain.on('reconfigureBase', () => {
  console.info('[Main] Queue a reconfigure');
  reconfigureBaseQueue.add(() => manager.reconfigureBase());
});

/**
 * Opens a URL in the default browser.
 */
ipcMain.on('openURL', (event, args) => {
  event.preventDefault();
  require('electron').shell.openExternal(args[0]);
});

/**
 * Get all displays.
 */
ipcMain.handle('getAllDisplays', (): OurDisplayType[] => {
  return getAvailableDisplays();
});

ipcMain.handle('signInWithDiscord', async () => {
  const client = CloudClient.getInstance();
  return client.signInWithDiscord((url) => shell.openExternal(url));
});

ipcMain.handle('signOutDiscord', async () => {
  await CloudClient.getInstance().signOutDiscord();
});

// [RoomFortyRecorder] Icon names for spell IDs, for the spell timeline.
ipcMain.handle('spellIcons', async (_event, args) => {
  const ids = Array.isArray(args[0]) ? (args[0] as unknown[]).map(Number) : [];
  return SpellIcons.getInstance().get(ids);
});

// [RoomFortyRecorder] Spell timeline for a video (raid pulls only). Returns
// null when the video has none, e.g. older recordings.
ipcMain.handle('getTimeline', async (_event, args) => {
  const video = args[0] as RendererVideo & { videoKey?: string };

  try {
    if (video.cloud) {
      const key = video.videoKey || `${video.videoName}.mp4`;
      return await CloudClient.getInstance().getTimeline(key);
    }

    return await readTimelineFile(video.videoSource);
  } catch (error) {
    console.warn('[Main] Failed to get timeline', String(error));
    return null;
  }
});

// [RoomFortyRecorder] Live streaming to the guild.
ipcMain.handle('liveStreamToggle', async () => {
  await LiveStreamer.getInstance().toggle();
  return LiveStreamer.getInstance().getState();
});

ipcMain.handle('liveStreamGetState', () =>
  LiveStreamer.getInstance().getState(),
);

// [RoomFortyRecorder] Watching live streams in the app (Live page).
ipcMain.handle('liveListStreams', () => LiveViewer.getInstance().list());

ipcMain.handle('liveWatch', async (_event, args) => {
  try {
    const answer = await LiveViewer.getInstance().watch(args[0], args[1]);
    return { answer };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('liveUnwatch', () => LiveViewer.getInstance().stop());

// [RoomFortyRecorder] Pull desk page: reports and per-boss settings.
ipcMain.handle('pullDesk', (_event, args) =>
  PullDesk.getInstance().handle(args[0]),
);

LiveStreamer.getInstance().on('state', (state) =>
  send('liveStreamState', state),
);

ipcMain.handle('getOrCreateChatCorrelator', async (event, video) => {
  const client = CloudClient.getInstance();
  return client.getOrCreateChatCorrelator(video);
});

ipcMain.handle('getChatMessages', async (event, correlator) => {
  const client = CloudClient.getInstance();
  return client.getChatMessages(correlator);
});

ipcMain.on('postChatMessage', (event, correlator, message) => {
  const client = CloudClient.getInstance();
  client.postChatMessage(correlator, message);
});

ipcMain.on('deleteChatMessage', (event, id) => {
  const client = CloudClient.getInstance();
  client.deleteChatMessage(id);
});

/**
 * Set/get global video player settings.
 */
ipcMain.on('videoPlayerSettings', (event, args) => {
  const action = args[0];

  if (action === 'get') {
    event.returnValue = videoPlayerSettings;
    return;
  }

  if (action === 'set') {
    const settings = args[1] as VideoPlayerSettings;
    videoPlayerSettings.muted = settings.muted;
    videoPlayerSettings.volume = settings.volume;
  }
});

/**
 * Shutdown the app if all windows closed.
 */
app.on('window-all-closed', async () => {
  console.info('[Main] User closed app');
  app.quit();
});

/**
 * Before quit events, also called invoked the automatic quit on upgrade.
 */
app.on('before-quit', () => {
  console.info('[Main] Running before-quit actions');

  if (tray) {
    console.info('[Main] Destroy tray icon');
    tray.destroy();
    tray = null;
  }

  Poller.getInstance().stop();
  uIOhook.stop();
  Recorder.getInstance().shutdownOBS();
});

/**
 * App start-up.
 */
app
  .whenReady()
  .then(() => {
    console.info('[Main] App ready');
    const singleInstanceLock = app.requestSingleInstanceLock();

    if (!singleInstanceLock) {
      console.warn('[Main] Blocked attempt to launch a second instance');
      app.quit();
      return;
    }

    app.on('second-instance', () => {
      console.info('[Main] Second instance attempted, will restore app');
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });

    new MenuBuilder().buildMenu();

    // Required by the video player to safely play files from disk.
    protocol.handle('vod', handleSafeVodRequest);
    protocol.handle('rficon', (request) =>
      PullDesk.getInstance().icon(
        decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, '')),
      ),
    );

    createWindow();
  })
  .catch(console.error);

const send = (channel: string, ...args: unknown[]) => {
  const contents = window?.webContents;
  if (!contents || contents.isDestroyed()) return; // Can happen on shutdown.

  if (contents.isCrashed()) {
    recoverRenderer(`renderer crashed before ${channel}`);
    return;
  }

  try {
    contents.send(channel, ...args);
  } catch (error) {
    console.error(`[Main] Failed to send ${channel} to renderer`, error);
    recoverRenderer(`IPC send failed: ${channel}`, error);
  }
};

const playSoundAlert = (alert: SoundAlerts) => {
  if (!window || window.isDestroyed()) return; // Can happen on shutdown.
  console.info('[Main] Playing sound alert', alert);
  send('playAudio', alert);
};

const getNativeWindowHandle = () => {
  assert(window);
  assert(!window.isDestroyed()); // Can't tolerate this here. But this shouldn't be possible.
  return window.getNativeWindowHandle();
};

export { send, getNativeWindowHandle, playSoundAlert };
