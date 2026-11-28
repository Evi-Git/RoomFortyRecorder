import { EventEmitter } from 'stream';
import fs, { watch, FSWatcher } from 'fs';
import util from 'util';
import { FileInfo } from 'main/types';
import path from 'path';
import { getFileInfo, getSortedFiles } from '../main/util';
import LogLine from './LogLine';
import AsyncQueue from '../utils/AsyncQueue';
import { WATCHER_SCHEDULE, delayFor } from '../main/retrySchedule';

/**
 * Setup a bunch of promisified fs calls for convienence.
 */
const open = util.promisify(fs.open);
const read = util.promisify(fs.read);
const close = util.promisify(fs.close);

/**
 * [RoomFortyRecorder] Longest unterminated line we will hold onto between
 * reads. Real log lines are far shorter (COMBATANT_INFO is a few KiB).
 */
const MAX_TAIL_BYTES = 1024 * 1024;

/**
 * Watches a directory for combat logs, read the new data from them
 * and emits events containing a LogLine object for processing elsewhere.
 *
 * I'm a bit nervous about race conditions here in multiple read calls. I
 * considered using p-queue, but I think it's probably fine as almost
 * certainly we won't have combat log writes close enough together to hit it.
 */
export default class CombatLogWatcher extends EventEmitter {
  /**
   * The directory to watch for logs.
   */
  private logDir: string;

  /**
   * The watcher object itself.
   */
  private watcher?: FSWatcher;

  /**
   * We need to keep track of some info about each log file to know how much we
   * should read.
   */
  private state: Record<string, FileInfo> = {};

  /**
   * [RoomFortyRecorder] The unterminated end of each file, kept as raw bytes
   * (not a string, so a multi-byte character split across two reads is not
   * corrupted). WoW writes in chunks, so a read often ends mid-line; the rest
   * of that line arrives with the next read.
   */
  private tails: Record<string, Buffer> = {};

  /**
   * [RoomFortyRecorder] Files seeded at startup, whose saved size may fall
   * in the middle of a line. Their first read checks the byte before it.
   */
  private unverified = new Set<string>();

  /**
   * [RoomFortyRecorder] Files where we are discarding bytes up to the next
   * newline, because a read began mid-line.
   */
  private skipping = new Set<string>();

  /**
   * A promise queue we use to ensure that we only have one active attempt to
   * parse the file at a time.
   */
  private queue = new AsyncQueue(Number.MAX_SAFE_INTEGER);

  /**
   * The most recently updated log file, we remember this purely so we can
   * log when it changes.
   */
  private current = '';

  /**
   * [RoomFortyRecorder] Set by unwatch(); a re-watch in flight gives up.
   */
  private stopped = false;

  /** Pending re-watch after the folder watcher died. */
  private rewatchTimer?: NodeJS.Timeout;

  /** How many re-watch attempts have failed since the watcher last worked. */
  private rewatchAttempts = 0;

  /** True between WATCHER_DOWN and WATCHER_UP. */
  private down = false;

  /**
   * [RoomFortyRecorder] Optional hook that sees every raw line before it is
   * parsed, used by the pull desk to keep a copy of each raid pull.
   */
  public lineTap?: (line: string) => void;

  /**
   * Constructor, unit of timeout is minutes. No events will be emitted until
   * watch() is called.
   */
  constructor(logDir: string) {
    super();
    this.logDir = logDir;
  }

  /**
   * Start watching the directory.
   */
  public async watch() {
    this.stopped = false;
    try {
      await this.getLogDirectoryState();
      this.startWatcher();
    } catch (e) {
      // e.g. the folder doesn't exist yet: keep trying rather than throwing.
      console.warn('[CombatLogWatcher] Could not watch the folder', e);
      this.setDown(String((e as Error)?.message ?? e));
      this.rewatchLater();
    }
  }

  /**
   * [RoomFortyRecorder] Open the folder watcher and hook it up. Never leaves
   * two live watchers: an old one is closed first. Throws if the folder
   * can't be watched (the caller of watch() sees nothing; see rewatchLater).
   */
  private startWatcher() {
    this.closeWatcher();
    this.watcher = watch(this.logDir);
    const mine = this.watcher;

    // An FSWatcher that emits 'error' with no listener throws in the main
    // process, and a dead one silently stops every recording trigger.
    mine.on('error', (err) => {
      if (this.watcher !== mine) return;
      console.warn('[CombatLogWatcher] Folder watcher failed', err);
      this.closeWatcher();
      this.setDown(String((err as Error)?.message ?? err));
      this.rewatchLater();
    });

    mine.on('change', (type, file) => {
      if (typeof file !== 'string') {
        return;
      }

      if (!file.startsWith('WoWCombatLog')) {
        return;
      }

      if (type === 'rename') {
        // Despite this being a 'change' listener, we can still get
        // rename events here, see the Node watch API. The rename event
        // misleadingly fires for both file creation and deletion.
        //
        // We reset the position in a file on either, such that a file
        // recreated with the same name will be read from the start. See
        // Issue 624.
        console.info('[CombatLogWatcher] Create or delete event', file);
        const fullPath = path.join(this.logDir, file);
        // Done through the queue so it is ordered with any read in flight.
        this.queue.add(async () => this.forget(fullPath));
        return;
      }

      if (file !== this.current) {
        console.info('[CombatLogWatcher] New active log file', file);
        this.current = file;
      }

      this.queue.add(() => this.process(file));
    });
  }

  /**
   * [RoomFortyRecorder] Forget everything we know about a file.
   */
  private forget(fullPath: string) {
    delete this.state[fullPath];
    delete this.tails[fullPath];
    this.unverified.delete(fullPath);
    this.skipping.delete(fullPath);
  }

  /**
   * Stop watching the directory.
   */
  public async unwatch() {
    this.stopped = true;
    if (this.rewatchTimer) {
      clearTimeout(this.rewatchTimer);
      this.rewatchTimer = undefined;
    }
    this.closeWatcher();
  }

  /** Close the current folder watcher, if any. Safe to call twice. */
  private closeWatcher() {
    const w = this.watcher;
    this.watcher = undefined;
    try {
      w?.close();
    } catch (e) {
      console.warn('[CombatLogWatcher] Closing the watcher failed', e);
    }
  }

  private setDown(reason: string) {
    if (this.down) return;
    this.down = true;
    this.emit('WARCRAFT_RECORDER_WATCHER_DOWN', reason);
  }

  /**
   * [RoomFortyRecorder] Try to watch the folder again after the backoff wait.
   * Per-file offsets (state, tails, unverified, skipping) are kept, so the
   * catch-up after a re-watch reads only what was written meanwhile.
   */
  private rewatchLater() {
    if (this.stopped || this.rewatchTimer) return;
    const wait = delayFor(WATCHER_SCHEDULE, this.rewatchAttempts);
    if (wait === null) return;
    this.rewatchAttempts += 1;
    console.info('[CombatLogWatcher] Re-watching the folder in', wait, 'ms');
    this.rewatchTimer = setTimeout(() => {
      this.rewatchTimer = undefined;
      this.rewatch().catch((e) => {
        console.warn('[CombatLogWatcher] Re-watch failed', e);
        this.rewatchLater();
      });
    }, wait);
  }

  private async rewatch() {
    if (this.stopped) return;
    this.startWatcher();
    // startWatcher can succeed on a folder that is already gone again; the
    // watcher's own error event then brings us back here.
    this.rewatchAttempts = 0;
    if (this.down) {
      this.down = false;
      console.info('[CombatLogWatcher] Watching the folder again');
      this.emit('WARCRAFT_RECORDER_WATCHER_UP');
    }
    await this.catchUp();
  }

  /**
   * [RoomFortyRecorder] Read whatever was written while no watcher was alive.
   * Files we know are read from their last offset; new ones from the start.
   */
  private async catchUp() {
    let logs: FileInfo[] = [];
    try {
      logs = await getSortedFiles(this.logDir, 'WoWCombatLog.*.txt');
    } catch (e) {
      console.warn('[CombatLogWatcher] Catch-up listing failed', e);
      return;
    }
    // A file deleted while we weren't watching: a later file with the same
    // name must be read from the start.
    const present = new Set(logs.map((l) => l.name));
    Object.keys(this.state)
      .filter((name) => !present.has(name))
      .forEach((name) => this.queue.add(async () => this.forget(name)));
    logs.forEach((info) => {
      const known = this.state[info.name];
      if (known && known.size === info.size) return;
      this.queue.add(() => this.process(path.basename(info.name)));
    });
  }

  /**
   * We need this in-case WCR is launched mid activity where a partial log file
   * already exists.
   */
  private async getLogDirectoryState() {
    const logs = await getSortedFiles(this.logDir, 'WoWCombatLog.*.txt');

    if (logs.length < 1) {
      return;
    }

    const fileInfoPromises = logs.map((f) => f.name).map(getFileInfo);
    const fileInfo = await Promise.all(fileInfoPromises);

    fileInfo.forEach((info) => {
      this.state[info.name] = info;
      this.unverified.add(info.name);
    });
  }

  /**
   * Process a change event receieved from the directory watcher.
   */
  private async process(file: string) {
    const fullPath = path.join(this.logDir, file);
    const currentInfo = await getFileInfo(fullPath);
    const lastInfo = this.state[fullPath];

    let bytesToRead;
    let startPosition;

    if (lastInfo && currentInfo.size >= lastInfo.size) {
      // Existing file, read from the last known length.
      bytesToRead = currentInfo.size - lastInfo.size;
      startPosition = lastInfo.size;
    } else {
      // New file, or one that shrank (replaced under the same name), we want
      // to read from the start. Anything held over from the old contents is
      // no longer part of a line.
      this.forget(fullPath);
      bytesToRead = currentInfo.size;
      startPosition = 0;
    }

    if (bytesToRead < 1) {
      // The node fs watcher is known to sometimes emit multiple events for
      // the same write. This lets us drop out early if there is nothing to read.
      return;
    }

    // [RoomFortyRecorder] A file seeded at startup may start mid-line, so
    // also read the byte before our position to find out.
    const lookBehind = this.unverified.delete(fullPath) && startPosition > 0;

    await this.parseFileChunk(
      fullPath,
      currentInfo,
      bytesToRead,
      startPosition,
      lookBehind,
    );
  }

  /**
   * Parse a chunk of the file of length bytes from a specified position.
   */
  private async parseFileChunk(
    file: string,
    info: FileInfo,
    bytes: number,
    position: number,
    lookBehind: boolean,
  ) {
    const extra = lookBehind ? 1 : 0;
    const buffer = Buffer.alloc(bytes + extra);
    const handle = await open(file, 'r');
    let bytesRead;

    try {
      ({ bytesRead } = await read(
        handle,
        buffer,
        0,
        bytes + extra,
        position - extra,
      ));
    } finally {
      close(handle);
    }

    if (bytesRead !== bytes + extra) {
      console.error(
        '[CombatLogParser] Read attempted for',
        bytes + extra,
        'bytes, but read',
        bytesRead,
      );
    }

    this.emit('WARCRAFT_RECORDER_LOG_ACTIVITY');

    let fresh = buffer.subarray(0, bytesRead);

    if (lookBehind && fresh.length > 0) {
      if (fresh[0] !== 0x0a) {
        this.skipping.add(file);
      }
      fresh = fresh.subarray(1);
    }

    // [RoomFortyRecorder] Only count what was really read, so a short read
    // doesn't skip bytes. Committed before any line is dispatched, so a
    // throwing listener can't leave the offset and the tail out of step.
    this.state[file] = { ...info, size: position + fresh.length };

    // Split on raw newline bytes and only handle complete lines; whatever
    // follows the last newline waits for the next read.
    const tail = this.tails[file];
    let data = tail ? Buffer.concat([tail, fresh]) : fresh;

    if (this.skipping.has(file)) {
      // We began mid-line: drop the rest of that line.
      const firstNewline = data.indexOf(0x0a);
      if (firstNewline < 0) {
        delete this.tails[file];
        return;
      }
      this.skipping.delete(file);
      data = data.subarray(firstNewline + 1);
    }

    const lastNewline = data.lastIndexOf(0x0a);
    const remainder = data.subarray(lastNewline + 1);

    if (remainder.length > MAX_TAIL_BYTES) {
      console.error(
        '[CombatLogWatcher] Unterminated line over',
        MAX_TAIL_BYTES,
        'bytes in',
        file,
        ', discarding it',
      );
      delete this.tails[file];
      // The rest of that line is still to come: drop it too.
      this.skipping.add(file);
    } else if (remainder.length > 0) {
      // Copy so we don't keep the whole read buffer alive.
      this.tails[file] = Buffer.from(remainder);
    } else {
      delete this.tails[file];
    }

    if (lastNewline >= 0) {
      data
        .toString('utf-8', 0, lastNewline)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l)
        .forEach((line) => {
          try {
            this.handleLogLine(line);
          } catch (e) {
            console.error(
              '[CombatLogWatcher] Failed to handle line',
              line.slice(0, 80),
              e,
            );
          }
        });
    }
  }

  /**
   * Handle a line from the WoW log. Public as this is called by the test
   * button.
   */
  public handleLogLine(line: string) {
    this.lineTap?.(line);
    const logLine = new LogLine(line);
    const logEventType = logLine.type();
    this.emit(logEventType, logLine);
  }
}
