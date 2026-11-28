import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import realTimers from 'timers';
import CombatLogWatcher from '../../parsing/CombatLogWatcher';

jest.mock('../../main/util', () => {
  const nodeFs = require('fs');
  const nodePath = require('path');
  const info = (name: string) => {
    const st = nodeFs.statSync(name);
    return {
      name,
      size: st.size,
      mtime: st.mtime.getTime(),
      birthTime: st.birthtime.getTime(),
    };
  };
  return {
    getFileInfo: async (p: string) => info(nodePath.resolve(p)),
    getSortedFiles: async (dir: string) =>
      nodeFs
        .readdirSync(dir)
        .filter((f: string) => f.startsWith('WoWCombatLog'))
        .map((f: string) => info(nodePath.join(dir, f))),
  };
});

/**
 * [RoomFortyRecorder] A dead folder watcher must not crash the app, must be
 * replaced, and must keep reading each file from where it stopped.
 */

class FakeWatcher extends EventEmitter {
  closed = false;

  close() {
    this.closed = true;
  }
}

const FILE = 'WoWCombatLog-111111_000000.txt';
let dir: string;
let fakes: FakeWatcher[];
let seen: string[];
let watcher: CombatLogWatcher;

const append = (s: string) => fs.appendFileSync(path.join(dir, FILE), s);
const live = () => fakes.filter((f) => !f.closed);
// Real file reads finish on the real event loop; fake timers don't cover the
// `timers` module, so wait a little in real time.
const realWait = (ms: number) =>
  new Promise<void>((r) => {
    realTimers.setTimeout(r, ms);
  });
const flush = async () => {
  await jest.advanceTimersByTimeAsync(0);
  await realWait(60);
};

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  fakes = [];
  jest.spyOn(fs, 'watch').mockImplementation((() => {
    const f = new FakeWatcher();
    fakes.push(f);
    return f;
  }) as unknown as typeof fs.watch);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-rewatch-'));
  watcher = new CombatLogWatcher(dir);
  seen = [];
  watcher.lineTap = (l) => seen.push(l);
});

afterEach(async () => {
  await watcher.unwatch();
  jest.useRealTimers();
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('CombatLogWatcher folder watcher errors', () => {
  it('an error event does not throw, and a new watcher replaces the dead one', async () => {
    const events: string[] = [];
    watcher.on('WARCRAFT_RECORDER_WATCHER_DOWN', () => events.push('down'));
    watcher.on('WARCRAFT_RECORDER_WATCHER_UP', () => events.push('up'));
    await watcher.watch();
    expect(fakes).toHaveLength(1);

    expect(() => fakes[0].emit('error', new Error('EPERM'))).not.toThrow();
    expect(fakes[0].closed).toBe(true);
    expect(events).toEqual(['down']);
    expect(live()).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1999);
    expect(fakes).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fakes).toHaveLength(2);
    expect(live()).toHaveLength(1);
    expect(events).toEqual(['down', 'up']);
  });

  it('keeps retrying with the backoff when watching keeps failing', async () => {
    await watcher.watch();
    (fs.watch as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    fakes[0].emit('error', new Error('gone'));
    // 2 s fails, then 5 s, then 15 s, then 30 s each.
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(15000);
    expect((fs.watch as jest.Mock).mock.calls.length).toBe(4);
    await jest.advanceTimersByTimeAsync(29999);
    expect((fs.watch as jest.Mock).mock.calls.length).toBe(4);
    await jest.advanceTimersByTimeAsync(1);
    expect((fs.watch as jest.Mock).mock.calls.length).toBe(5);
  });

  it('keeps file offsets across a re-watch and reads only what is new', async () => {
    append('A one\nB two\n');
    await watcher.watch();
    // Seeded at startup: the first read of an existing file verifies its
    // offset, then continues from there.
    fakes[0].emit('change', 'change', FILE);
    await flush();
    append('C three\n');
    fakes[0].emit('change', 'change', FILE);
    await flush();
    expect(seen).toEqual(['C three']);

    fakes[0].emit('error', new Error('network drive dropped'));
    append('D four\nE fi'); // written while no watcher was alive
    await jest.advanceTimersByTimeAsync(2000);
    await flush();
    expect(seen).toEqual(['C three', 'D four']);
    expect(live()).toHaveLength(1);

    append('ve\n');
    live()[0].emit('change', 'change', FILE);
    await flush();
    expect(seen).toEqual(['C three', 'D four', 'E five']);
  });

  it('unwatch cancels a pending re-watch', async () => {
    await watcher.watch();
    fakes[0].emit('error', new Error('x'));
    await watcher.unwatch();
    await jest.advanceTimersByTimeAsync(60000);
    expect(fakes).toHaveLength(1);
    expect(live()).toHaveLength(0);
  });

  it('a late error from an old watcher is ignored and never leaves two live', async () => {
    await watcher.watch();
    fakes[0].emit('error', new Error('x'));
    await jest.advanceTimersByTimeAsync(2000);
    expect(() => fakes[0].emit('error', new Error('late'))).not.toThrow();
    await jest.advanceTimersByTimeAsync(60000);
    expect(live()).toHaveLength(1);
    expect(fakes).toHaveLength(2);
  });

  it('a missing folder at start is not a throw; it retries', async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    (fs.watch as jest.Mock).mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const w = new CombatLogWatcher(dir);
    const down = jest.fn();
    w.on('WARCRAFT_RECORDER_WATCHER_DOWN', down);
    await expect(w.watch()).resolves.toBeUndefined();
    expect(down).toHaveBeenCalledTimes(1);
    await w.unwatch();
    fs.mkdirSync(dir);
  });
});
