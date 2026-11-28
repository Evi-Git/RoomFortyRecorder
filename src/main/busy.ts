import { app, BrowserWindow, dialog, Tray } from 'electron';
import LogHandler from 'parsing/LogHandler';
import Poller from 'utils/Poller';
import LiveStreamer from './LiveStreamer';
import PullDesk from './PullDesk';
import VideoProcessQueue from './VideoProcessQueue';
import {
  busyDialogButtons,
  busyReasonFrom,
  DeferredAction,
  DeferredKind,
} from './busyLogic';

/**
 * [RoomFortyRecorder] Is anything running that a quit or update install would
 * throw away? Sources checked:
 *  - LogHandler.activity: an activity (raid pull, Mythic+ run, manual) is
 *    being recorded,
 *  - PullDesk's log capture: an encounter started in the combat log,
 *  - LiveStreamer: Go live is connecting or live,
 *  - VideoProcessQueue: recordings being cut or re-encoded, and cloud video
 *    uploads (not downloads),
 *  - PullDesk: a pull log request running right now. A pull waiting for the
 *    guild server to come back doesn't count: the backfill catches it later.
 * Returns null when idle, else a short reason.
 */
export const currentBusyReason = (): string | null => {
  try {
    const queue = VideoProcessQueue.getInstance().busyCounts();

    return busyReasonFrom({
      activity: LogHandler.activity
        ? { category: String(LogHandler.activity.category) }
        : null,
      // Capture only counts while WoW runs: if WoW crashes mid-pull the
      // capture stays open until the next pull, which would block quitting
      // for days. (Resetting it instead would risk dropping a real pull.)
      capturingPull:
        PullDesk.getInstance().isCapturing &&
        Poller.getInstance().isWowRunning(),
      finishing: LogHandler.finishing > 0 || LogHandler.overrunning,
      live: LiveStreamer.getInstance().isActive(),
      saving: queue.saving,
      uploading: queue.uploading,
      sendingLog: PullDesk.getInstance().pullUploadsInFlight,
    });
  } catch (error) {
    // Never block the user from quitting because the check itself broke.
    console.warn('[Busy] Check failed', String(error));
    return null;
  }
};

// The pull desk's scheduled backfill waits for an idle app.
PullDesk.setBusyCheck(currentBusyReason);

const POLL_MS = 2000;

const deferred = new DeferredAction();
let timer: NodeJS.Timeout | null = null;
let allowClose = false;
let dialogOpen = false;
let trayRef: (() => Tray | null) | null = null;
let installRunner: (() => void) | null = null;

/** True once the app is really quitting (code path or user choice). */
export const isQuitAllowed = () => allowClose;

/** Called from before-quit and session-end: stop gating the window close. */
export const allowQuitNow = () => {
  allowClose = true;
};

export const setBusyTray = (getTray: () => Tray | null) => {
  trayRef = getTray;
};

const setTooltip = (text: string) => {
  const tray = trayRef?.();
  if (tray && !tray.isDestroyed()) tray.setToolTip(text);
};

const stopPolling = () => {
  if (timer) clearInterval(timer);
  timer = null;
  deferred.cancel();
  setTooltip('Room Forty Toolkit');
};

const fire = (kind: DeferredKind) => {
  stopPolling();
  allowClose = true;

  if (kind === 'install' && installRunner) {
    installRunner();
  } else {
    app.quit();
  }
};

const startPolling = (kind: DeferredKind) => {
  deferred.request(kind);
  setTooltip(
    kind === 'quit'
      ? 'Will quit after this is done'
      : 'Will install the update after this is done',
  );

  if (timer) return;

  timer = setInterval(() => {
    const due = deferred.tick(currentBusyReason());
    if (due) fire(due);
  }, POLL_MS);
};

/**
 * Run `action` now if idle, otherwise ask. Returns true if it ran at once.
 * `parent` may be null (window hidden in the tray).
 */
export const confirmWhenBusy = async (
  kind: DeferredKind,
  parent: BrowserWindow | null,
  action: () => void,
): Promise<boolean> => {
  const reason = currentBusyReason();

  if (reason === null) {
    stopPolling();
    action();
    return true;
  }

  // One dialog at a time: a second request just brings the window forward.
  if (dialogOpen) {
    if (parent && !parent.isDestroyed()) parent.focus();
    return false;
  }

  const waiting = deferred.current !== null;
  const { labels, choices } = busyDialogButtons(kind, waiting);
  const options = {
    type: 'warning' as const,
    title: 'Room Forty Toolkit',
    message: reason,
    detail:
      kind === 'quit' ? 'Quitting now loses it.' : 'Installing now loses it.',
    buttons: labels,
    defaultId: 0,
    cancelId: waiting ? 1 : labels.length - 1,
    noLink: true,
  };

  // A minimized owner can swallow the box: bring it back first.
  if (parent && !parent.isDestroyed() && parent.isMinimized()) parent.restore();
  const usable = parent && !parent.isDestroyed() && parent.isVisible();

  dialogOpen = true;
  let response: number;
  try {
    ({ response } = usable
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options));
  } finally {
    dialogOpen = false;
  }
  const choice = choices[response] ?? 'cancel';

  if (choice === 'now') {
    stopPolling();
    action();
    return true;
  }

  if (choice === 'stop') stopPolling();
  if (choice === 'wait') startPolling(kind);
  return false;
};

/** User-initiated quit (window close, tray Quit). */
export const requestQuit = (parent: BrowserWindow | null) =>
  confirmWhenBusy('quit', parent, () => {
    allowClose = true;
    app.quit();
  });

/** User chose "Restart and update". `start` sends the screen and installs. */
export const requestInstall = (
  parent: BrowserWindow | null,
  start: () => void,
) => {
  installRunner = start;
  return confirmWhenBusy('install', parent, () => {
    allowClose = true;
    start();
  });
};
