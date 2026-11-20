import path from 'path';

const isUnc = (value: string) => /^[\\/]{2}/.test(value);

const uncKey = (value: string) =>
  path.win32.normalize(value).replace(/\\+$/, '').toLowerCase();

/**
 * [RoomFortyRecorder] Validate a path the renderer asks us to show in the
 * file manager. Returns the normalised path, or null if it must be refused.
 * UNC paths (\\server\share) make Windows contact another machine, so they
 * are only allowed inside one of the configured folders (`allowedRoots`,
 * e.g. a recordings folder on a NAS). Pure, no Electron imports.
 */
export const validateExplorerPath = (
  value: unknown,
  allowedRoots: readonly string[] = [],
): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length > 4096 || value.includes('\0')) return null;

  if (isUnc(value)) {
    const normalised = path.win32.normalize(value);
    const key = uncKey(value);
    const inside = allowedRoots.some((root) => {
      if (typeof root !== 'string' || !isUnc(root)) return false;
      const rootKey = uncKey(root);
      return key === rootKey || key.startsWith(`${rootKey}\\`);
    });
    return inside ? normalised : null;
  }

  const normalised = path.normalize(value);
  if (!path.isAbsolute(normalised)) return null;
  return normalised;
};

/**
 * The folder to open when `target` doesn't exist: its nearest ancestor that
 * exists and is a directory. Never returns a file (opening a file would run
 * it). Returns null if there is none.
 */
export const nearestExistingDirectory = (
  target: string,
  isDirectory: (p: string) => boolean,
): string | null => {
  let dir = path.dirname(target);

  for (;;) {
    if (isDirectory(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};
