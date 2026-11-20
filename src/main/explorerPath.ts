import path from 'path';

/**
 * [RoomFortyRecorder] Validate a path the renderer asks us to show in the
 * file manager. Returns the normalised path, or null if it must be refused.
 * Pure, no Electron imports.
 */
export const validateExplorerPath = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length > 4096 || value.includes('\0')) return null;
  // UNC paths (\\server\share) would make Windows contact another machine.
  if (/^[\\/]{2}/.test(value)) return null;
  const normalised = path.normalize(value);
  if (!path.isAbsolute(normalised)) return null;
  return normalised;
};
