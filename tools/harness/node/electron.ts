// Stand-in for `electron` in the Node bundle: only what PullDesk touches.
import { state } from './state';

export const app = {
  getPath: (name: string) => `${state().userData}/${name}`,
  getVersion: () => '9.9.9-harness',
};
export const ipcMain = { on() {}, handle() {} };
export const clipboard = {};
export default { app, ipcMain, clipboard };
