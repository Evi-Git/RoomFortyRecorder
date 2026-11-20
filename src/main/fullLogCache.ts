/**
 * [RoomFortyRecorder] Pure parts of the full-log cache (userData/pull-logs):
 * one download per pull at a time, a check that a file is a whole gzip, and
 * the names of the temporary files a download is written to before it is
 * renamed into place. No Electron imports so it can be unit tested.
 */
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

/**
 * Runs `task` once per key at a time: callers that arrive while it is running
 * get the same promise (and the same result or error). The key is free again
 * when it settles, so a failed download is tried afresh next time.
 */
export const createSingleFlight = () => {
  const running = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const existing = running.get(key);
      if (existing) return existing as Promise<T>;
      const promise = (async () => task())().finally(() => {
        if (running.get(key) === promise) running.delete(key);
      });
      running.set(key, promise);
      return promise;
    },
    get size() {
      return running.size;
    },
  };
};

/** A gzip stream starts with the bytes 1f 8b 08; the size is judged apart. */
export const looksLikeGzip = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 &&
  bytes[0] === 0x1f &&
  bytes[1] === 0x8b &&
  bytes[2] === 0x08;

export type CachedFileVerdict = 'ok' | 'check' | 'bad';

/**
 * What to do with a cached file before serving it. 'bad': delete it (not gzip,
 * or too small to be a whole one). 'check': looks right but has not been
 * decompressed in full yet this session, so do that once. 'ok': served.
 */
export const judgeCachedFile = (input: {
  head: Uint8Array;
  size: number;
  verified: boolean;
}): CachedFileVerdict => {
  if (input.size < 18 || !looksLikeGzip(input.head)) return 'bad';
  return input.verified ? 'ok' : 'check';
};

/** Reads the file and decides, with the call shape the app uses. */
export const judgeCachedBytes = (
  cached: Uint8Array,
  verified: boolean,
): CachedFileVerdict =>
  judgeCachedFile({
    head: cached.subarray(0, 4),
    size: cached.length,
    verified,
  });

/** True when `bytes` gunzip to the end without an error (so it is not cut short). */
export const gunzipsCleanly = async (bytes: Uint8Array): Promise<boolean> => {
  try {
    await pipeline(
      Readable.from([
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length),
      ]),
      zlib.createGunzip(),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
};

const TMP_SUFFIX = '.tmp';

/** Where a download is written before it is renamed to `file`. */
export const tempPathFor = (file: string): string => `${file}${TMP_SUFFIX}`;

/** A leftover from a crash: a temp file nobody has written to for a while. */
export const isStaleTemp = (
  name: string,
  modifiedMs: number,
  now: number,
  graceMs = 15 * 60 * 1000,
): boolean => name.endsWith(TMP_SUFFIX) && now - modifiedMs > graceMs;

/** Pauses (ms) between tries to rename a finished download into place. */
export const RENAME_RETRY_DELAYS = [100, 250, 400, 250];

/**
 * Runs `attempt`, retrying after each delay on failure (Windows can refuse a
 * rename for a moment while an antivirus scan or indexer has the file open).
 * Resolves true when it worked, false when every try failed.
 */
export const retryOperation = async (
  attempt: () => Promise<void>,
  delays: number[] = RENAME_RETRY_DELAYS,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): Promise<boolean> => {
  for (let i = 0; i <= delays.length; i += 1) {
    try {
      await attempt();
      return true;
    } catch {
      if (i === delays.length) return false;

      await wait(delays[i]);
    }
  }
  return false;
};
