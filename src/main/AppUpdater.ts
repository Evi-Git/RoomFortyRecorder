import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { currentBusyReason, requestInstall } from './busy';
import { mayDownloadUpdate } from './busyLogic';

const customConsoleLogger = {
  log: (...args: string[]) => console.log('[AutoUpdater]', ...args),
  // Debug logging is too verbose for production.
  // debug: (...args: string[]) => console.debug('[AutoUpdater]', ...args),
  info: (...args: string[]) => console.info('[AutoUpdater]', ...args),
  warn: (...args: string[]) => console.warn('[AutoUpdater]', ...args),
  error: (...args: string[]) => console.error('[AutoUpdater]', ...args),
};

/**
 * [RoomFortyRecorder] What the updater is doing, shown under the version
 * text in the sidebar so a manual "Check for updates" gets an answer.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  | { state: 'downloading'; version?: string; percent: number }
  | { state: 'ready'; version?: string }
  | { state: 'error'; message: string };

export default class AppUpdater {
  private window: BrowserWindow;

  private status: UpdateStatus = { state: 'idle' };

  private pendingVersion?: string;

  constructor(window: BrowserWindow) {
    this.window = window;
    autoUpdater.logger = customConsoleLogger;

    // Don't auto-install on quit. This would force users to update which
    // isn't friendly.
    autoUpdater.autoInstallOnAppQuit = false;

    // Don't download in the background during a pull or stream: we download
    // ourselves once idle (see onUpdateFound).
    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () =>
      this.setStatus({ state: 'checking' }),
    );

    autoUpdater.on('update-not-available', () =>
      this.setStatus({ state: 'upToDate' }),
    );

    autoUpdater.on('update-available', (info) => {
      this.pendingVersion = info?.version;
      this.onUpdateFound();
    });

    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({
        state: 'downloading',
        version: this.pendingVersion,
        percent: Math.round(progress?.percent ?? 0),
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({ state: 'ready', version: info?.version });
      window.webContents.send('updateAvailable');
    });

    autoUpdater.on('error', (err) => {
      this.setStatus({
        state: 'error',
        message: AppUpdater.describeError(err),
      });
    });

    ipcMain.on('doAppUpdate', () => {
      console.info('[AutoUpdater] User triggered auto-update');
      // Asks first if a pull, stream or upload is running. The "Updating"
      // screen only shows once the install really starts.
      requestInstall(window.isDestroyed() ? null : window, () =>
        this.install(),
      ).catch(console.error);
    });

    ipcMain.handle('getUpdateStatus', () => this.status);

    ipcMain.handle('checkForUpdates', async () => {
      console.info('[AutoUpdater] User triggered update check');
      await this.check(true);
      return this.status;
    });

    this.periodicallyCheckUpdate();
  }

  private install() {
    // Show our own "Updating" screen, then hand over to the installer's
    // progress window, which stays up until it reopens the app. (A silent
    // install left nothing on screen while it ran, which looked like a
    // crash.)
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('appUpdating', this.pendingVersion ?? null);
    }
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 1500);
  }

  private downloadTimer?: NodeJS.Timeout;

  /**
   * A check found an update. Download now if idle (or the user asked for the
   * check), otherwise wait and re-check every minute.
   */
  private onUpdateFound(manual = this.manualCheck) {
    this.manualCheck = false;
    if (this.downloadTimer) clearTimeout(this.downloadTimer);
    this.downloadTimer = undefined;

    if (!mayDownloadUpdate(currentBusyReason(), manual)) {
      console.info('[AutoUpdater] Busy, will download the update when idle');
      this.setStatus({ state: 'idle' });
      this.downloadTimer = setTimeout(() => this.onUpdateFound(false), 60_000);
      return;
    }

    this.setStatus({
      state: 'downloading',
      version: this.pendingVersion,
      percent: 0,
    });

    autoUpdater.downloadUpdate().catch((err) =>
      this.setStatus({
        state: 'error',
        message: AppUpdater.describeError(err),
      }),
    );
  }

  private manualCheck = false;

  private setStatus(status: UpdateStatus) {
    this.status = status;

    if (!this.window.isDestroyed()) {
      this.window.webContents.send('updateStatus', status);
    }
  }

  private static describeError(err: unknown) {
    const text = err instanceof Error ? err.message : String(err);

    if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(text)) {
      return "Couldn't reach GitHub. Check your connection.";
    }

    if (/404|latest\.yml|No published versions/i.test(text)) {
      return 'No published release found yet.';
    }

    return 'Update check failed. See the log for details.';
  }

  private async check(manual = false) {
    // Don't restart a download that's running or finished.
    if (
      this.status.state === 'downloading' ||
      this.status.state === 'ready' ||
      this.status.state === 'checking'
    ) {
      return;
    }

    if (!app.isPackaged) {
      if (!manual) return;
      this.setStatus({
        state: 'error',
        message: 'Updates only work in the installed app.',
      });
      return;
    }

    this.manualCheck = manual;

    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // The 'error' event usually fires too, but make sure we never leave
      // the sidebar stuck on "Checking…".
      this.setStatus({
        state: 'error',
        message: AppUpdater.describeError(err),
      });
    }
  }

  private periodicallyCheckUpdate() {
    this.check();

    setTimeout(
      () => {
        this.periodicallyCheckUpdate();
      },
      1000 * 60 * 60 * 24,
    );
  }
}
