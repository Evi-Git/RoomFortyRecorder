// [RoomFortyRecorder] A log file for the guild server.
//
// The server runs under Windows Task Scheduler, so what it prints to the
// console is gone. installServerLog() copies console.log/info/warn/error into
// a daily file (server-YYYY-MM-DD.log, local date) as well as printing it as
// before. Old files are deleted after `keepDays`. Logging never throws into
// the caller: if the folder can't be written, one warning is printed and the
// server carries on without a file (/health shows it as a warning).
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

export const DEFAULT_KEEP_DAYS = 14;
const DAY_MS = 86400000;
// After a failed write, try to open the file again at most this often.
const RETRY_MS = 60000;
const FILE_PATTERN = /^server-(\d{4})-(\d{2})-(\d{2})\.log$/;
const LEVELS = { log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR' };

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date, YYYY-MM-DD. */
export const localDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const logFileName = (date) => `server-${localDate(date)}.log`;

/**
 * Take secrets out of a line before it is written: given secret values
 * (anything shorter than 8 characters is skipped), "Bearer <token>" and the
 * query string of any URL (signed links carry their signature there).
 */
export const redact = (text, secrets = []) => {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[hidden]');
  }
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [hidden]')
    .replace(/(https?:\/\/[^\s?'"<>]+)\?[^\s'"<>]*/gi, '$1?[query hidden]');
};

/** One line (or several, for a stack) as it goes in the file. */
export const formatLine = (level, args, at, secrets = []) => {
  const text = redact(util.format(...args), secrets);
  return `${at.toISOString()} ${level} ${text}\n`;
};

/** Which server-*.log files in `names` are older than `keepDays` at `now`. */
export const oldLogs = (names, now, keepDays) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return names.filter((name) => {
    const m = FILE_PATTERN.exec(name);
    if (!m) return false;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Math.round((today - day) / DAY_MS) > keepDays;
  });
};

/**
 * Start writing the console to `dir`. Returns { status(), close() }.
 * `target` is the console to copy (tests pass a stand-in), `now` gives the
 * current Date, `secrets` are values that must never reach the file.
 */
export const installServerLog = ({
  dir,
  keepDays = DEFAULT_KEEP_DAYS,
  now = () => new Date(),
  target = console,
  secrets = [],
} = {}) => {
  const real = {};
  for (const method of Object.keys(LEVELS)) real[method] = target[method].bind(target);

  let fd = null;
  let currentDay = null;
  let currentFile = null;
  let lastError = null;
  let warned = false;
  let retryAt = 0;
  let lastPrune = null;

  const fail = (error) => {
    lastError = error?.message || String(error);
    closeFile();
    retryAt = now().getTime() + RETRY_MS;
    if (!warned) {
      warned = true;
      try {
        real.warn(`[guild-cloud] Could not write the log file (${lastError}). Carrying on without it.`);
      } catch {
        // nothing left to tell
      }
    }
  };

  const closeFile = () => {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // already gone
      }
    }
    fd = null;
  };

  const prune = (at) => {
    const day = localDate(at);
    if (lastPrune === day) return;
    lastPrune = day;
    try {
      for (const name of oldLogs(fs.readdirSync(dir), at, keepDays)) {
        try {
          fs.rmSync(path.join(dir, name), { force: true });
        } catch {
          // locked by something else: next day's pass tries again
        }
      }
    } catch {
      // the folder is not readable; opening the file reports that
    }
  };

  const open = (at) => {
    const day = localDate(at);
    if (fd !== null && day === currentDay) return true;
    if (fd === null && at.getTime() < retryAt) return false;
    closeFile();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, logFileName(at));
      fd = fs.openSync(file, 'a');
      currentFile = file;
      currentDay = day;
      lastError = null;
      warned = false;
      prune(at);
      return true;
    } catch (error) {
      currentDay = null;
      fail(error);
      return false;
    }
  };

  const write = (level, args) => {
    try {
      const at = now();
      if (!open(at)) return;
      fs.writeSync(fd, formatLine(level, args, at, secrets));
    } catch (error) {
      fail(error);
    }
  };

  for (const [method, level] of Object.entries(LEVELS)) {
    target[method] = (...args) => {
      write(level, args);
      real[method](...args);
    };
  }

  // Create today's file now, so the folder and any problem show at start.
  open(now());

  return {
    /** For /health. The path is for the log only, never for the JSON. */
    status: () => ({
      file: currentFile,
      writable: fd !== null,
      lastError,
    }),
    close: () => {
      closeFile();
      for (const method of Object.keys(LEVELS)) target[method] = real[method];
    },
  };
};

/**
 * An exception nobody caught stops Node. Say why through console.error (so it
 * reaches the log file) and then stop, as Node would have.
 */
export const logUncaughtExceptions = (proc = process, log = (...a) => console.error(...a)) => {
  proc.on('uncaughtException', (error) => {
    log('[guild-cloud] Uncaught exception, stopping', error);
    proc.exit(1);
  });
};
