/**
 * [RoomFortyRecorder] Config keys the renderer must never read or write.
 * The renderer shows guild-supplied text, so treat it as untrusted: the
 * Discord session token stays in the main process. Pure, no Electron imports.
 */
export const SECRET_KEYS: readonly string[] = [
  'cloudSessionToken',
  'cloudSessionTokenEnc',
];

export const isSecretKey = (key: unknown): boolean =>
  typeof key === 'string' && SECRET_KEYS.includes(key);

/** What the renderer's `config get` returns for a key. */
export const valueForRenderer = (key: unknown, value: unknown): unknown =>
  isSecretKey(key) ? '' : value;

/** Whether a renderer `set` / `set_values` for this key may be applied. */
export const rendererMayWrite = (key: unknown): boolean => !isSecretKey(key);

/** Copy of a config object with secret values masked, for logging. */
export const redactForLog = <T extends Record<string, unknown>>(
  config: T,
): T => {
  const copy: Record<string, unknown> = { ...config };
  SECRET_KEYS.forEach((key) => {
    if (copy[key]) copy[key] = '**********';
  });
  return copy as T;
};
