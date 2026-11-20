// Resets: pulls so short they were a reset or an accidental pull. The app
// hides them (src/renderer/resets.ts, RESET_SECONDS there must match), and
// the server leaves them out of every count and pull number. They are still
// listed, flagged `reset: true`, so the app's "Show resets" switch works.
//
// Pure functions, so every module that counts pulls shares one rule.

/** Pulls shorter than this (seconds) are resets. Same as the app's. */
export const RESET_SECONDS = 10;

/** A pull with no known duration is never treated as a reset. */
export const isReset = (pull) => typeof pull?.duration === 'number' && pull.duration < RESET_SECONDS;

/**
 * Pull numbers in time order for one boss and difficulty, per night and
 * overall, skipping resets. Sets `pullNumber` and `totalPullNumber` on each
 * pull (mutates). A reset gets no number of its own: it carries the number
 * of the last real pull before it (0 before the first), so lists sorted by
 * number keep their order and older apps still have a number to show.
 * @param {{ startedAt?: number|null, createdAt?: number, night?: string, duration?: number }[]} pulls
 */
export const numberPulls = (pulls) => {
  const ordered = [...pulls].sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt));
  const perNight = {};
  let total = 0;
  const lastOfNight = {};
  ordered.forEach((p) => {
    if (isReset(p)) {
      p.pullNumber = lastOfNight[p.night] ?? 0;
      p.totalPullNumber = total;
      return;
    }
    perNight[p.night] = (perNight[p.night] || 0) + 1;
    total += 1;
    lastOfNight[p.night] = perNight[p.night];
    p.pullNumber = perNight[p.night];
    p.totalPullNumber = total;
  });
  return pulls;
};
