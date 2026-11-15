// Stand-in for main/main: `send` records what the app would push to the
// renderer (the harness does not forward it).
import { state } from './state';

export const send = (channel: string, ...args: unknown[]) => {
  state().sent.push({ channel, args });
};
