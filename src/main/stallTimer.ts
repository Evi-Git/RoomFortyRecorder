// Idle ("stall") detection for long transfers. A 4 GB upload may legitimately
// take an hour, so a total timeout is wrong; what matters is that bytes keep
// moving. Nothing here touches Electron or the network: feed it byte counts
// and a clock, and it says when to give up.

/** No bytes for this long means the transfer is stuck. */
export const STALL_MS = 60_000;

export class StallDetector {
  private best = -1;

  private lastMoved: number;

  constructor(
    public readonly stallMs: number = STALL_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.lastMoved = this.now();
  }

  /** Total bytes moved so far; any increase counts as progress. */
  public record(bytes: number) {
    if (Number.isFinite(bytes) && bytes > this.best) {
      this.best = bytes;
      this.lastMoved = this.now();
    }
  }

  public idleMs() {
    return Math.max(0, this.now() - this.lastMoved);
  }

  public isStalled() {
    return this.idleMs() >= this.stallMs;
  }
}

export type StallWatch = {
  /** Report total bytes moved (from a progress event). */
  record: (bytes: number) => void;
  /** True once the watch has fired. */
  readonly stalled: boolean;
  /** Always call when the transfer ends, however it ends. */
  stop: () => void;
};

/**
 * Check every `checkMs`; once `stallMs` pass with no new bytes call `onStall`
 * (once) and stop checking. Typically `onStall` aborts an AbortController.
 */
export const startStallWatch = (options: {
  onStall: () => void;
  stallMs?: number;
  checkMs?: number;
  now?: () => number;
}): StallWatch => {
  const detector = new StallDetector(
    options.stallMs ?? STALL_MS,
    options.now ?? Date.now,
  );
  let fired = false;
  const timer = setInterval(() => {
    if (fired || !detector.isStalled()) return;
    fired = true;
    clearInterval(timer);
    options.onStall();
  }, options.checkMs ?? 5_000);
  // Never keep the app alive just for this.
  (timer as { unref?: () => void }).unref?.();

  return {
    record: (bytes) => detector.record(bytes),
    get stalled() {
      return fired;
    },
    stop: () => clearInterval(timer),
  };
};
