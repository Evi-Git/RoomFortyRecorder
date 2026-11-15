/** Shared state for the Node-side stubs (one per process). */
export type HarnessNodeState = {
  apiUrl: string;
  guild: string;
  token: string | null;
  userData: string;
  config: Record<string, unknown>;
  sent: { channel: string; args: unknown[] }[];
};

const g = globalThis as unknown as { __rfHarnessNode?: HarnessNodeState };

export const state = (): HarnessNodeState => {
  g.__rfHarnessNode ??= {
    apiUrl: 'http://127.0.0.1:0/api',
    guild: 'Room Forty',
    token: null,
    userData: '/tmp/rf-harness-userdata',
    config: {},
    sent: [],
  };
  return g.__rfHarnessNode;
};
