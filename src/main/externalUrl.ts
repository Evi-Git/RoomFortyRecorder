/**
 * [RoomFortyRecorder] Which URLs the app may hand to the OS browser. The
 * renderer shows guild-supplied text, so its requests are untrusted.
 * Pure, no Electron imports.
 */

const isPrivateHttpHost = (host: string): boolean =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host);

export const isSafeExternalUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return !!url.hostname;
  if (url.protocol === 'http:') return isPrivateHttpHost(url.hostname);
  return false;
};
