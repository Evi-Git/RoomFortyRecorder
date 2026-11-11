/**
 * Browser stand-in for the Electron preload (`window.electron.ipcRenderer`).
 * Import this FIRST in every entry: some renderer modules read the bridge at
 * import time.
 *
 * Callers use `invoke(channel, [request])` (args is an array), so the pullDesk
 * action is `args[0].action`.
 */

type Answer = (...args: any[]) => unknown;

type Harness = {
  /** Override the answer for `channel` or `channel:action` (e.g. 'pullDesk:season'). */
  answer: (key: string, fn: Answer | unknown) => void;
  /** Every invoke so far, for assertions. */
  calls: { channel: string; args: unknown[] }[];
  overrides: Map<string, Answer | unknown>;
};

const overrides = new Map<string, Answer | unknown>();
const calls: Harness['calls'] = [];

const logBytes = async () => {
  const res = await fetch('/log.gz');
  if (!res.ok) throw new Error(`/log.gz answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

const pullDesk = async (req: { action?: string } & Record<string, any>) => {
  switch (req?.action) {
    case 'fullLog':
      return { ok: true, data: { bytes: await logBytes() } };
    case 'analyzePresets':
      // AnalyzeView reads `data.presets || {}`: an object, not an array.
      return { ok: true, data: { presets: {} } };
    case 'permissionsMe':
      return {
        ok: true,
        data: { owner: true, viewAs: null, roles: [], can: {} },
      };
    case 'journalSpells':
      return { ok: true, data: { spells: {}, pending: 0 } };
    case 'spellNames':
      return { ok: true, data: { names: {} } };
    default:
      return { ok: false, error: 'not mocked' };
  }
};

const defaults: Record<string, Answer> = {
  pullDesk: (args) => pullDesk((args as any[])?.[0] ?? {}),
  // Caller reads got?.[id]: an empty map means "no icon known".
  spellIcons: () => ({}),
  // null: the image falls back to the CDN (fails offline; fine).
  iconImage: () => null,
};

const invoke = async (channel: string, args: unknown[] = []) => {
  calls.push({ channel, args });
  const action = channel === 'pullDesk' ? (args as any[])?.[0]?.action : null;
  for (const key of [action ? `${channel}:${action}` : '', channel]) {
    if (key && overrides.has(key)) {
      const o = overrides.get(key);
      return typeof o === 'function' ? (o as Answer)(args) : o;
    }
  }
  const d = defaults[channel];
  return d ? d(args) : { ok: false, error: 'not mocked' };
};

const noop = () => {};

(window as any).electron = {
  ipcRenderer: {
    invoke,
    sendMessage: noop,
    sendSync: () => undefined,
    on: () => noop,
    once: noop,
    removeAllListeners: noop,
    removeListener: noop,
  },
};

(window as any).__harness = {
  answer: (key, fn) => overrides.set(key, fn),
  calls,
  overrides,
} satisfies Harness;

export {};
