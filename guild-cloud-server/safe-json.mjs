// [RoomFortyRecorder] One safe way to save and load the server's JSON files.
//
// Saving: write to a temp file of its own, flush it to disk, then rename it
// over the real file, so a crash or a full disk leaves the old file whole.
//
// The files that can't be rebuilt (state.json, pulldesk/index.json,
// coach.json, permissions.json) are also copied to a `backups` folder next
// to them: at most one copy an hour, plus one whenever the server starts.
// Kept: the newest 24, then the last copy of each day for 14 days.
// Loading falls back to the newest copy that still reads when the file is
// damaged or gone, and keeps the damaged file for a look later.
import fsp from 'node:fs/promises';
import path from 'node:path';

const HOUR = 3600000;
const DAY = 86400000;

/** Newest copies kept, whatever their age. */
export const KEEP_RECENT = 24;
/** Beyond those: the last copy of each day, for this many days. */
export const KEEP_DAYS = 14;
/** A new copy is made at most this often. */
export const BACKUP_GAP_MS = HOUR;
/** At a start: a copy unless one was made in the last few minutes. */
export const START_GAP_MS = 5 * 60000;

let counter = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// On Windows a rename can fail for a moment while antivirus or a backup
// tool has the file open.
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Write `body` to `file` so the file is always either the old or the new one. */
export const writeFileAtomic = async (file, body) => {
  counter += 1;
  const temp = `${file}.${process.pid}.${counter}.tmp`;
  try {
    const handle = await fsp.open(temp, 'w');
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fsp.rename(temp, file);
        return;
      } catch (error) {
        if (attempt >= 4 || !RETRY_CODES.has(error.code)) throw error;
        await sleep(50 * (attempt + 1));
      }
    }
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

export const backupDirOf = (file) => path.join(path.dirname(file), 'backups');

// state.json -> state.2026-11-15T19-05-00.json (UTC, sorts by time).
const stampOf = (ms) => new Date(ms).toISOString().slice(0, 19).replace(/:/g, '-');
const STAMP = /\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/;
const stemOf = (file) => path.basename(file).replace(/\.json$/, '');

/** A file's backups, newest first: [{ file, at }]. */
export const listBackups = async (file) => {
  const dir = backupDirOf(file);
  const stem = stemOf(file);
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const m = STAMP.exec(name);
      if (!m || name.slice(0, m.index) !== stem) return null;
      return { file: path.join(dir, name), at: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) };
    })
    .filter((b) => b && Number.isFinite(b.at))
    .sort((a, b) => b.at - a.at);
};

/** Which of `backups` (newest first) to delete. */
export const backupsToPrune = (backups, now = Date.now()) => {
  const days = new Set();
  return backups.filter((backup, i) => {
    if (i < KEEP_RECENT) return false;
    const day = new Date(backup.at).toISOString().slice(0, 10);
    if (now - backup.at <= KEEP_DAYS * DAY && !days.has(day)) {
      days.add(day);
      return false;
    }
    return true;
  });
};

/**
 * Copy `file` as it is now into its backups folder, unless a copy was made
 * within `gap` ms. Never throws: a failed backup must not stop a save.
 * Returns the copy's path, or null when none was made.
 */
export const backupNow = async (file, { now = Date.now(), gap = BACKUP_GAP_MS, log = console.error } = {}) => {
  try {
    const backups = await listBackups(file);
    if (backups.length && now - backups[0].at < gap) return null;
    const text = await fsp.readFile(file, 'utf8');
    // Only keep what can be loaded again.
    JSON.parse(text);
    const dir = backupDirOf(file);
    await fsp.mkdir(dir, { recursive: true });
    const copy = path.join(dir, `${stemOf(file)}.${stampOf(now)}.json`);
    await writeFileAtomic(copy, text);
    const stale = backupsToPrune([{ file: copy, at: now }, ...backups], now);
    await Promise.all(stale.map((b) => fsp.rm(b.file, { force: true }).catch(() => {})));
    return copy;
  } catch (error) {
    if (error.code !== 'ENOENT') log('[guild-cloud] Could not back up', file, error?.message || error);
    return null;
  }
};

/**
 * Save a JSON file. `body` is the text to write (or a value to stringify).
 * With `backup`, the file being replaced is copied to its backups folder
 * first (at most once an hour).
 */
export const writeJsonSafe = async (file, body, { backup = false, now, log } = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (backup) await backupNow(file, { ...(now ? { now } : {}), ...(log ? { log } : {}) });
  await writeFileAtomic(file, text);
};

/**
 * Load a JSON file that has backups.
 *
 *   { value, from: 'file' }                 read normally
 *   { value, from: 'backup', backup, at }   the file was damaged or gone;
 *                                           the newest good copy was put back
 *   { value: null, from: 'none' }           no file and no backups (first run)
 *
 * Throws when the file is damaged and no copy reads either: the caller must
 * not start from empty data over a file a person could still repair.
 */
export const readJsonSafe = async (file, { log = console.error, now = Date.now() } = {}) => {
  let problem = null;
  try {
    const value = JSON.parse(await fsp.readFile(file, 'utf8'));
    // A copy at every start: the updater restarts the server, so this is
    // also the copy from just before a new version touches the file.
    await backupNow(file, { now, log, gap: START_GAP_MS });
    return { value, from: 'file' };
  } catch (error) {
    problem = error;
  }
  const missing = problem.code === 'ENOENT';
  if (!missing && !(problem instanceof SyntaxError)) throw problem;

  const backups = await listBackups(file);
  for (const backup of backups) {
    let text;
    let value;
    try {
      text = await fsp.readFile(backup.file, 'utf8');
      value = JSON.parse(text);
    } catch {
      continue;
    }
    if (!missing) {
      const aside = `${file}.damaged-${stampOf(now)}`;
      await fsp.rename(file, aside).catch(() => {});
      log(`[guild-cloud] ${path.basename(file)} could not be read (${problem.message}). The damaged file was kept as ${path.basename(aside)}.`);
    }
    await writeFileAtomic(file, text);
    log(`[guild-cloud] ${path.basename(file)} was restored from the copy made ${new Date(backup.at).toISOString()} (${backup.file}). Anything saved after that is missing.`);
    return { value, from: 'backup', backup: backup.file, at: backup.at };
  }
  if (missing) return { value: null, from: 'none' };
  throw Object.assign(
    new Error(
      `${file} is damaged (${problem.message}) and there is no backup that reads. Repair the file or put a copy back, then start the server again.`,
    ),
    { code: 'DAMAGED_JSON' },
  );
};
