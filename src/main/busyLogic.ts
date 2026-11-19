/**
 * [RoomFortyRecorder] Pure decision logic for "is it safe to quit or install
 * an update right now?". No Electron imports so it can be unit tested.
 */

export type BusyInputs = {
  /** The activity being recorded, if any (a VideoCategory string). */
  activity: { category: string } | null;
  /** An encounter has started in the combat log and not ended. */
  capturingPull: boolean;
  /** Go live is connecting or streaming. */
  live: boolean;
  /** Recordings being cut or re-encoded. */
  saving: number;
  /** Cloud video uploads queued or running. */
  uploading: number;
};

/**
 * Returns null when nothing would be lost, otherwise a short plain-English
 * reason. Order is by how much the user would lose.
 */
export const busyReasonFrom = (inputs: BusyInputs): string | null => {
  if (inputs.activity) {
    switch (inputs.activity.category) {
      case 'Mythic+':
        return 'A Mythic+ run is being recorded.';
      case 'Raids':
        return 'A pull is being recorded.';
      default:
        return 'A recording is in progress.';
    }
  }

  if (inputs.capturingPull) return 'A pull is being recorded.';
  if (inputs.live) return "You're live.";
  if (inputs.saving > 0) return 'A recording is still being saved.';
  if (inputs.uploading > 0) return 'A recording is uploading.';
  return null;
};

export type DeferredKind = 'quit' | 'install';

/**
 * "Do it when it's done": remembers one pending action and says when to fire
 * it. A new request replaces the old one (installing implies quitting).
 */
export class DeferredAction {
  private pending: DeferredKind | null = null;

  public get current() {
    return this.pending;
  }

  public request(kind: DeferredKind) {
    this.pending = kind;
  }

  public cancel() {
    this.pending = null;
  }

  /** Call on each poll with the current busy reason. */
  public tick(reason: string | null): DeferredKind | null {
    if (!this.pending || reason !== null) return null;
    const kind = this.pending;
    this.pending = null;
    return kind;
  }
}

/** What the user chose in the busy dialog. */
export type BusyChoice = 'wait' | 'now' | 'cancel';

/**
 * Buttons for the dialog: the first is the default. While already waiting, a
 * second request offers to stop waiting instead.
 */
export const busyDialogButtons = (
  kind: DeferredKind,
  alreadyWaiting: boolean,
): { labels: string[]; choices: BusyChoice[] } => {
  const verb = kind === 'quit' ? 'Quit' : 'Install';

  if (alreadyWaiting) {
    return {
      labels: [`${verb} now`, 'Keep waiting'],
      choices: ['now', 'cancel'],
    };
  }

  return {
    labels: [`${verb} when it's done`, `${verb} now`, 'Cancel'],
    choices: ['wait', 'now', 'cancel'],
  };
};

/** Should the updater download right now? Manual checks always may. */
export const mayDownloadUpdate = (busy: string | null, manual: boolean) =>
  manual || busy === null;
