/**
 * [RoomFortyRecorder] Is the guild server new enough for this app?
 *
 * SERVER_CHANGED_IN is the last app release that changed the guild server
 * (a file in guild-cloud-server/server-files.txt). Bump it in the same PR
 * as any such change, so raiders and the owner are told to run
 * update-server.cmd.
 */
export const SERVER_CHANGED_IN = '1.9.117';

/** "v1.9.112" or "1.9.112" -> [1, 9, 112]; anything else -> null. */
export const parseVersion = (text: string | null | undefined) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** Negative when a is older than b, 0 when the same, positive when newer. */
export const compareVersions = (a: number[], b: number[]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export type ServerCheck =
  /** No version to go by (signed out, unreachable, not installed by the updater). */
  | { state: 'unknown' }
  | { state: 'current'; server: string }
  /** Older than the last release that changed the server. */
  | { state: 'behind'; server: string; needed: string };

export const checkServer = (
  server: string | null | undefined,
  needed = SERVER_CHANGED_IN,
): ServerCheck => {
  const have = parseVersion(server);
  const want = parseVersion(needed);
  if (!have || !want) return { state: 'unknown' };
  const shown = have.join('.');
  if (compareVersions(have, want) < 0)
    return { state: 'behind', server: shown, needed: want.join('.') };
  return { state: 'current', server: shown };
};
