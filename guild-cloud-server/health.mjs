// [RoomFortyRecorder] What /health reports. Local checks only (no R2, no
// Discord), so it answers in milliseconds. Critical checks (storage, state)
// make the answer 503 with ok: false; a warning (a log file that can't be
// written, state.json restored from a backup) does not.
//
// No paths or secrets in the result: /health is public. Details go to the log.
import fsp from 'node:fs/promises';
import path from 'node:path';

export const STORAGE_CACHE_MS = 10000;
/** One failed save is a warning; one that lasts this long fails health. */
export const SAVE_FAILURE_MS = 10 * 60000;

/**
 * createHealth({ storage, getState, logStatus, version, warn, now, cacheMs })
 *   getState() -> { loaded, restoredAt, saveFailedAt }
 *   logStatus() -> { writable, lastError } from server-log.mjs
 * Returns { check() -> { status, body } }.
 */
export const createHealth = ({
  storage,
  getState,
  logStatus = () => ({ writable: false, lastError: 'not installed' }),
  version = null,
  warn = (...args) => console.warn(...args),
  now = Date.now,
  cacheMs = STORAGE_CACHE_MS,
  startedAt = now(),
}) => {
  let cached = null;
  let counter = 0;
  let lastLogged = null;

  const probeStorage = async () => {
    try {
      const stat = await fsp.stat(storage);
      if (!stat.isDirectory()) return { ok: false, detail: 'not a folder' };
      counter += 1;
      const probe = path.join(storage, `.health-${process.pid}-${counter}.tmp`);
      await fsp.writeFile(probe, 'ok');
      await fsp.rm(probe, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error?.code || 'error', message: error?.message || String(error) };
    }
  };

  const storageCheck = async () => {
    const at = now();
    // The promise is cached, so requests that arrive together share one probe.
    if (!cached || at - cached.at >= cacheMs) {
      cached = { at, result: probeStorage() };
    }
    return cached.result;
  };

  const check = async () => {
    const disk = await storageCheck();
    const state = getState();
    const logInfo = logStatus();

    const checks = {
      storage: disk.ok ? { ok: true } : { ok: false, detail: disk.detail },
    };
    if (!state.loaded) checks.state = { ok: false, detail: 'not loaded' };
    else if (state.saveFailedAt && now() - state.saveFailedAt > SAVE_FAILURE_MS) {
      checks.state = { ok: false, detail: 'saving has been failing for over 10 minutes' };
    } else if (state.saveFailedAt) checks.state = { ok: true, warning: 'the last save failed' };
    else if (state.restoredAt) checks.state = { ok: true, warning: 'restored from a backup' };
    else checks.state = { ok: true };
    checks.log = logInfo.writable
      ? { ok: true }
      : { ok: true, warning: 'the log file is not being written' };

    const ok = checks.storage.ok && checks.state.ok;
    // Say what failed once per change, not once per poll.
    const summary = ok
      ? null
      : [
          !disk.ok ? `storage: ${disk.message || disk.detail}` : null,
          !checks.state.ok ? `state: ${checks.state.detail}` : null,
        ]
          .filter(Boolean)
          .join('; ');
    if (summary !== lastLogged) {
      try {
        if (summary) warn(`[guild-cloud] /health is failing (${summary})`);
        else if (lastLogged) warn('[guild-cloud] /health is ok again');
      } catch {
        // logging must not break /health
      }
      lastLogged = summary;
    }

    return {
      status: ok ? 200 : 503,
      body: {
        ok,
        version,
        checks,
        uptimeSec: Math.round((now() - startedAt) / 1000),
      },
    };
  };

  return { check };
};
