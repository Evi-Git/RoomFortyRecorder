import React from 'react';
import { PullMeta, PullStore, StoreBuilder } from './store';

/**
 * [RoomFortyRecorder] Logs page: fetches a pull's full log (gzipped, cached
 * by the main process) and reads it into a PullStore, a slice at a time so
 * the window stays responsive. The last few pulls stay in memory.
 */

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const ipc = window.electron.ipcRenderer;

const KEEP = 8;
const memory = new Map<string, Promise<PullStore>>();
// Everyone waiting on a pull that's still being read gets its progress
// (Compare side by side on the same pull, Time trial and Logs together).
const watchers = new Map<string, Set<(f: number) => void>>();
const lastProgress = new Map<string, number>();
const watch = (id: string, onProgress: (f: number) => void) => {
  let set = watchers.get(id);
  if (!set) {
    set = new Set();
    watchers.set(id, set);
  }
  set.add(onProgress);
  const known = lastProgress.get(id);
  if (known !== undefined) onProgress(known);
};
const report = (id: string, f: number) => {
  lastProgress.set(id, f);
  watchers.get(id)?.forEach((fn) => fn(f));
};
const settle = (id: string) => {
  watchers.delete(id);
  lastProgress.delete(id);
};

const remember = (id: string, p: Promise<PullStore>) => {
  memory.delete(id);
  memory.set(id, p);
  while (memory.size > KEEP) {
    const oldest = memory.keys().next().value as string;
    memory.delete(oldest);
  }
};

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Reads gzipped log bytes into a store; `onProgress` gets 0..1. */
export const readLog = async (
  bytes: Uint8Array,
  meta: PullMeta,
  onProgress: (f: number) => void,
) => {
  const builder = new StoreBuilder();
  let read = 0;
  const total = bytes.byteLength;
  const counting = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      read += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const text = new Blob([bytes])
    .stream()
    .pipeThrough(counting)
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream());
  const reader = text.getReader();
  let rest = '';
  let since = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = rest + value;
    const lines = chunk.split('\n');
    rest = lines.pop() ?? '';
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) builder.feed(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
    since += lines.length;
    if (since > 20000) {
      since = 0;
      onProgress(read / total);

      await yieldToUi();
    }
  }
  if (rest) builder.feed(rest);
  onProgress(1);
  return builder.finish(meta);
};

/** A pull's store (from memory, the app's cache, or the guild server). */
export const loadPull = (
  meta: PullMeta,
  onProgress: (f: number) => void,
): Promise<PullStore> => {
  const known = memory.get(meta.id);
  if (known) {
    // Still being read: follow its progress too.
    if (watchers.has(meta.id)) watch(meta.id, onProgress);
    return known;
  }
  watch(meta.id, onProgress);
  const job = (async () => {
    const response = (await ipc.invoke('pullDesk', [
      { action: 'fullLog', id: meta.id },
    ])) as Response<{ bytes: Uint8Array }>;
    if (!response.ok) throw new Error(response.error);
    return readLog(response.data.bytes, meta, (f) => report(meta.id, f));
  })();
  remember(meta.id, job);
  job.then(
    () => settle(meta.id),
    () => {
      settle(meta.id);
      memory.delete(meta.id);
    },
  );
  return job;
};

export type LoadState = {
  stores: PullStore[];
  /** Pull id -> 0..1 while loading. */
  progress: Record<string, number>;
  /** Pull id -> why it couldn't load. */
  errors: Record<string, string>;
  loading: boolean;
  /** Load the pulls that failed again (Try again). */
  retry: () => void;
};

/** Loads the given pulls; stores come back in the same order. */
export const usePullStores = (metas: PullMeta[]): LoadState => {
  const key = metas.map((m) => m.id).join(',');
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  const [state, setState] = React.useState<
    Omit<LoadState, 'retry'> & { key: string }
  >({
    key: '',
    stores: [],
    progress: {},
    errors: {},
    loading: false,
  });
  React.useEffect(() => {
    let cancelled = false;
    if (!metas.length) return undefined;
    const results: (PullStore | null)[] = metas.map(() => null);
    const errors: Record<string, string> = {};
    // One at a time keeps memory and the UI calm.
    (async () => {
      for (let i = 0; i < metas.length; i += 1) {
        const meta = metas[i];
        try {
          results[i] = await loadPull(meta, (f) => {
            if (!cancelled)
              setState((s) => ({
                ...(s.key === key
                  ? s
                  : {
                      key,
                      stores: [],
                      errors: {},
                      progress: {},
                      loading: true,
                    }),
                progress: {
                  ...(s.key === key ? s.progress : {}),
                  [meta.id]: f,
                },
              }));
          });
        } catch (error) {
          errors[meta.id] = (error as Error).message || String(error);
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      setState({
        key,
        stores: results.filter((s): s is PullStore => s !== null),
        progress: {},
        errors,
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for the list of pulls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  if (!metas.length)
    return { stores: [], progress: {}, errors: {}, loading: false, retry };
  if (state.key !== key)
    return { stores: [], progress: {}, errors: {}, loading: true, retry };
  return { ...state, retry };
};
