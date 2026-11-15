// Entry for the Node bundle: the app's own PullDesk (route table, backfill,
// full-log cache) with the Electron-bound pieces stubbed (see build.mjs).
import PullDesk from 'main/PullDesk';
import { state } from './state';

export { state };
export const desk = () => PullDesk.getInstance();
export const handle = (request: Parameters<PullDesk['handle']>[0]) =>
  PullDesk.getInstance().handle(request);
