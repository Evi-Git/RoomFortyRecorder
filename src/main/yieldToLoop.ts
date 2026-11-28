/**
 * [RoomFortyRecorder] Lets a long synchronous loop (parsing a saved combat
 * log line by line) hand the main process back to the event loop now and
 * then, so OBS and UI IPC answers aren't stuck behind it. Call the returned
 * function once per line; it only looks at the clock every `every` calls and
 * only actually yields once `budgetMs` of work has passed since the last turn.
 */

export type Yielder = () => Promise<void>;

export const createYielder = (
  options: {
    /** Longest stretch of work between turns of the event loop. */
    budgetMs?: number;
    /** Look at the clock only once per this many calls (it isn't free). */
    every?: number;
    now?: () => number;
    /** What a turn is; the default is setImmediate. */
    turn?: () => Promise<void>;
  } = {},
): Yielder => {
  const budgetMs = options.budgetMs ?? 10;
  const every = Math.max(1, options.every ?? 256);
  const now = options.now ?? (() => performance.now());
  const turn =
    options.turn ??
    (() =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      }));

  let calls = 0;
  let last = now();

  return async () => {
    calls += 1;
    if (calls % every !== 0) return;
    if (now() - last < budgetMs) return;
    await turn();
    last = now();
  };
};
