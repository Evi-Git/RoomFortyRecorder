import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { promisify } from 'util';
import PullLogCapture, {
  CapturedPull,
  logLineEpochMs,
} from 'parsing/PullLogCapture';
import { leadingFields } from 'parsing/PullLogFilter';
import CloudClient from 'storage/CloudClient';
import { sendWithRetry } from './pullUploadClient';
import { createYielder } from './yieldToLoop';
import {
  BackfillFailure,
  failureAfterIdleRun,
  failureAfterRun,
  notSignedInFailure,
} from './backfillFailure';
import {
  isRetryable,
  MAX_FILE_RECHECKS,
  recordRecheck,
} from './pullUploadRetry';

// 'failed': gave up on a problem that may pass (worth another try later).
// 'refused': the server said no (4xx); sending it again won't help.
export type FullLogResult = 'sent' | 'failed' | 'refused' | 'none';

// Retries of one full log stop after this long (each try can take 10 min).
const FULL_LOG_RETRY_MS = 15 * 60 * 1000;

/**
 * Sends every line of the pull (gzipped) for the Logs page, retrying network
 * trouble and 5xx on the pull upload schedule, for up to about 15 minutes.
 * 'none' when the pull has no full log (it got too big). `shouldStop` (a raid
 * pull started) ends the waits between tries by throwing Paused.
 */
export const uploadFullLog = async (
  client: CloudClient,
  pullId: string,
  pull: CapturedPull,
  // Lets the caller count the request as in flight (see PullDesk).
  track: <T>(request: () => Promise<T>) => Promise<T> = (request) => request(),
  shouldStop?: () => boolean,
): Promise<FullLogResult> => {
  const full = await pull.full;
  if (!full) return 'none';
  console.info(
    `[PullBackfill] Sending pull ${pullId}'s full log:`,
    `${(full.length / 1e6).toFixed(1)} MB gzipped`,
  );
  try {
    await sendWithRetry(
      client,
      `Full log ${pullId}`,
      () =>
        track(() =>
          client.pullDeskRequest(
            'put',
            `/pulls/${encodeURIComponent(pullId)}/full`,
            full,
            { contentType: 'application/gzip', timeout: 600000 },
          ),
        ),
      { maxElapsedMs: FULL_LOG_RETRY_MS, shouldStop },
    );
    return 'sent';
  } catch (error) {
    if (shouldStop?.() && isRetryable(error)) throw new Error('Paused');
    console.warn('[PullBackfill] Full log upload failed', String(error));
    return isRetryable(error) ? 'failed' : 'refused';
  }
};

/**
 * [RoomFortyRecorder] Pull desk backfill: send pulls from saved combat log
 * files that the live capture didn't (the app was closed, signed out, or
 * nobody had "Send my Logs" on). The same filter as the live capture,
 * the same reports on the server; each pull is placed by its real start time.
 *
 * - Automatic: every so often, finished log files from the last week are
 *   checked against the server, and only the pulls it still needs a log for
 *   are sent. Each file is checked once (again only if it grows).
 * - Manual: "Upload from combat log" in the Pull desk, for any file.
 */

const gzip = promisify(zlib.gzip);

// Same as PullLogCapture: 233 is flex Mythic (Kith'ix).
const RAID_DIFFICULTIES = new Set([14, 15, 16, 17, 233]);
const TEST_BUTTON_ENCOUNTER = 9999;
// A recording and a pull in the log agree on the start within this.
const HINT_MATCH_MS = 2 * 60 * 1000;
// Automatic backfill: files written to in this window...
const AUTO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// ...and untouched for this long (the live capture handles the open one).
const AUTO_QUIET_MS = 20 * 60 * 1000;
// A pull in the file and one the server knows are the same within this.
const SAME_PULL_MS = 2000;

type Done = Record<string, string>; // file name -> "v:size:mtime" checked

// Bump to check every recent file again after the capture rules change
// (2: flex Mythic pulls were skipped before).
// 3: re-send last week's pulls with the app's meters (1.9.30).
// 5: meters v4, counted like the Logs page (1.9.88).
const DONE_VERSION = 5;
const doneKey = (f: LogFile) =>
  `${DONE_VERSION}:${f.size}:${Math.round(f.modified)}`;

export type LogFile = { name: string; size: number; modified: number };

export type LogBoss = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  pulls: number;
  kills: number;
  firstAt: number;
  lastAt: number;
};

/** Boss % from a recording of the pull (encounter-specific, phase-aware). */
export type BossPercentHint = {
  encounterId: number;
  difficultyId: number;
  start: number;
  bossPercent: number;
};

export type BackfillStatus = {
  running: boolean;
  auto: boolean;
  file: string;
  found: number;
  uploaded: number;
  alreadyThere: number;
  skipped: number;
  failed: number;
  error: string;
  finishedAt: number | null;
};

const lines = (file: string) =>
  readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

export default class PullBackfill {
  public status: BackfillStatus = {
    running: false,
    auto: false,
    file: '',
    found: 0,
    uploaded: 0,
    alreadyThere: 0,
    skipped: 0,
    failed: 0,
    error: '',
    finishedAt: null,
  };

  /** The last automatic check, for the Pull desk to show. */
  public lastAuto: { at: number; uploaded: number; files: number } | null =
    null;

  /**
   * Why the last automatic check didn't go well, for the Pull desk to show.
   * Cleared by a later check that does; a pause (a pull started) is not one.
   */
  public lastFailure: BackfillFailure | null = null;

  constructor(
    private logDir: () => string,
    private storageDir: () => string = () => '',
    private statePath = '',
  ) {}

  /** Combat log files in the retail Logs folder, newest first. */
  public async listLogs(): Promise<LogFile[]> {
    const dir = this.logDir();
    if (!dir) throw new Error('Set the retail log folder in Settings first.');
    const names = (await fs.promises.readdir(dir)).filter((name) =>
      /^WoWCombatLog.*\.txt$/i.test(name),
    );
    const files = await Promise.all(
      names.map(async (name) => {
        const stat = await fs.promises.stat(path.join(dir, name));
        return { name, size: stat.size, modified: stat.mtimeMs };
      }),
    );
    return files.sort((a, b) => b.modified - a.modified).slice(0, 30);
  }

  // Only files in the log folder, by name.
  private resolve(name: string) {
    const dir = this.logDir();
    const base = path.basename(String(name || ''));
    if (!/^WoWCombatLog.*\.txt$/i.test(base)) {
      throw new Error('Not a combat log file');
    }
    return path.join(dir, base);
  }

  /** Raid bosses in a log: pulls and kills per boss and difficulty. */
  public async scan(name: string): Promise<LogBoss[]> {
    const bosses = new Map<string, LogBoss>();
    const yieldNow = createYielder();
    for await (const line of lines(this.resolve(name))) {
      await yieldNow();
      if (!line.includes('  ENCOUNTER_')) continue;
      const isStart = line.includes('  ENCOUNTER_START,');
      const isEnd = line.includes('  ENCOUNTER_END,');
      if (!isStart && !isEnd) continue;
      const [, id, encounterName, difficulty, , success] = leadingFields(
        line,
        6,
      );
      const encounterId = Number(id);
      const difficultyId = Number(difficulty);
      if (!RAID_DIFFICULTIES.has(difficultyId)) continue;
      if (encounterId === TEST_BUTTON_ENCOUNTER) continue;
      const key = `${encounterId}:${difficultyId}`;
      const at = logLineEpochMs(line);
      const boss = bosses.get(key) ?? {
        encounterId,
        encounterName,
        difficultyId,
        pulls: 0,
        kills: 0,
        firstAt: at,
        lastAt: at,
      };
      if (isStart) boss.pulls += 1;
      if (isEnd && success === '1') boss.kills += 1;
      boss.lastAt = at;
      bosses.set(key, boss);
    }
    return [...bosses.values()].sort((a, b) => a.firstAt - b.firstAt);
  }

  /** Upload the chosen bosses' pulls from a log, in the background. */
  public start(name: string, keys: string[], hints: BossPercentHint[]) {
    if (this.status.running) {
      throw new Error(
        this.status.auto
          ? 'The app is already sending missing pulls automatically; try again in a few minutes.'
          : 'An upload is already running',
      );
    }
    const file = this.resolve(name);
    this.status = {
      running: true,
      auto: false,
      file: path.basename(file),
      found: 0,
      uploaded: 0,
      alreadyThere: 0,
      skipped: 0,
      failed: 0,
      error: '',
      finishedAt: null,
    };
    const wanted = new Set(keys);
    this.run(
      file,
      (pull) => wanted.has(`${pull.encounterId}:${pull.difficultyId}`),
      hints,
    )
      .catch((error) => {
        this.status.error = String(error?.message || error);
      })
      .finally(() => {
        this.status.running = false;
        this.status.finishedAt = Date.now();
      });
  }

  private async run(
    file: string,
    want: (pull: CapturedPull) => boolean,
    hints: BossPercentHint[],
    shouldStop: () => boolean = () => false,
  ) {
    const client = CloudClient.getInstance();
    if (!client.pullDeskReady()) {
      throw new Error('Sign in with Discord in Cloud settings first.');
    }

    const queue: CapturedPull[] = [];
    const capture = new PullLogCapture((pull) => {
      if (want(pull)) queue.push(pull);
    });

    let count = 0;
    // A saved log can be hundreds of MB: let the rest of the app (OBS, the UI's
    // IPC answers) run between stretches of parsing.
    const yieldNow = createYielder();
    for await (const line of lines(file)) {
      count += 1;
      if (count % 50000 === 0 && shouldStop()) throw new Error('Paused');
      await yieldNow();
      capture.onLine(line);
      while (queue.length) {
        // One pull at a time, so memory stays at one pull's log.
        await this.send(
          client,
          queue.shift() as CapturedPull,
          hints,
          shouldStop,
        );
      }
    }
  }

  private async send(
    client: CloudClient,
    pull: CapturedPull,
    hints: BossPercentHint[],
    shouldStop: () => boolean,
  ) {
    this.status.found += 1;
    const hint = hints
      .filter(
        (h) =>
          h.encounterId === pull.encounterId &&
          h.difficultyId === pull.difficultyId &&
          Math.abs(h.start - pull.startedAt) < HINT_MATCH_MS,
      )
      .sort(
        (a, b) =>
          Math.abs(a.start - pull.startedAt) -
          Math.abs(b.start - pull.startedAt),
      )[0];

    try {
      const claim = await client.pullDeskRequest<{
        skip?: boolean;
        pullId?: string;
        upload?: boolean;
      }>('post', '/backfill', {
        encounterId: pull.encounterId,
        encounterName: pull.encounterName,
        difficultyId: pull.difficultyId,
        startedAt: pull.startedAt,
        duration: pull.duration,
        result: pull.result,
        bossPercent: pull.result ? 0 : hint?.bossPercent,
      });
      if (claim.skip) {
        this.status.skipped += 1;
        return;
      }
      if (!claim.upload || !claim.pullId) {
        this.status.alreadyThere += 1;
        return;
      }
      const body = await gzip(Buffer.from(pull.log, 'utf8'));
      await client.pullDeskRequest(
        'put',
        `/pulls/${encodeURIComponent(claim.pullId)}/log`,
        body,
        { contentType: 'application/gzip', timeout: 180000 },
      );
      const full = await uploadFullLog(
        client,
        claim.pullId,
        pull,
        undefined,
        shouldStop,
      );
      this.status.uploaded += 1;
      // The report is in, but the full log isn't and may still go: count it as
      // failed so the automatic check looks at this file again (a few times)
      // instead of marking it done. A refusal (4xx) won't change: done.
      if (full === 'failed') this.status.failed += 1;
    } catch (error) {
      // A raid pull started during a retry wait: stop the whole run.
      if ((error as Error)?.message === 'Paused') throw error;
      console.warn('[PullBackfill] Pull failed', String(error));
      this.status.failed += 1;
    }
  }

  // ---- Automatic ------------------------------------------------------------

  private async readDone(): Promise<Done> {
    if (!this.statePath) return {};
    try {
      return JSON.parse(await fs.promises.readFile(this.statePath, 'utf8'));
    } catch {
      return {};
    }
  }

  private async writeDone(done: Done) {
    if (!this.statePath) return;
    await fs.promises.writeFile(this.statePath, JSON.stringify(done));
  }

  /** Raid pull starts in a file (ENCOUNTER_START lines only). */
  private async pullStarts(file: string, shouldStop: () => boolean) {
    const starts: {
      encounterId: number;
      difficultyId: number;
      startedAt: number;
    }[] = [];
    let count = 0;
    const yieldNow = createYielder();
    for await (const line of lines(file)) {
      count += 1;
      if (count % 50000 === 0 && shouldStop()) throw new Error('Paused');
      await yieldNow();
      if (!line.includes('  ENCOUNTER_START,')) continue;
      const [, id, , difficulty] = leadingFields(line, 4);
      const difficultyId = Number(difficulty);
      if (!RAID_DIFFICULTIES.has(difficultyId)) continue;
      if (Number(id) === TEST_BUTTON_ENCOUNTER) continue;
      starts.push({
        encounterId: Number(id),
        difficultyId,
        startedAt: logLineEpochMs(line),
      });
    }
    return starts;
  }

  /** Boss % from the recordings' metadata files near these times. */
  private async recordingHints(from: number, to: number) {
    const dir = this.storageDir();
    if (!dir) return [];
    const hints: BossPercentHint[] = [];
    try {
      const names = (await fs.promises.readdir(dir)).filter((n) =>
        n.endsWith('.json'),
      );
      for (const name of names) {
        const full = path.join(dir, name);
        const stat = await fs.promises.stat(full);
        if (stat.mtimeMs < from - 86400000 || stat.mtimeMs > to + 86400000) {
          continue;
        }
        try {
          const meta = JSON.parse(await fs.promises.readFile(full, 'utf8'));
          if (
            typeof meta.encounterID === 'number' &&
            typeof meta.start === 'number' &&
            typeof meta.bossPercent === 'number'
          ) {
            hints.push({
              encounterId: meta.encounterID,
              difficultyId: Number(meta.difficultyID),
              start: meta.start,
              bossPercent: meta.bossPercent,
            });
          }
        } catch {
          // Not a recording's metadata.
        }
      }
    } catch {
      // No recordings folder: the server works the boss % out from the log.
    }
    return hints;
  }

  /**
   * Check finished log files from the last week and send the pulls the
   * server still needs. `shouldStop` pauses it (a raid pull started).
   */
  public async auto(shouldStop: () => boolean) {
    if (this.status.running) return;
    const client = CloudClient.getInstance();
    if (!client.pullDeskReady()) {
      this.lastFailure = notSignedInFailure(Date.now());
      return;
    }

    const now = Date.now();
    const files = (await this.listLogs()).filter(
      (f) =>
        now - f.modified < AUTO_MAX_AGE_MS && now - f.modified > AUTO_QUIET_MS,
    );
    const done = await this.readDone();
    const todo = files.filter((f) => done[f.name] !== doneKey(f));
    if (!todo.length) {
      this.lastFailure = failureAfterIdleRun(this.lastFailure);
      return;
    }

    this.status = {
      running: true,
      auto: true,
      file: '',
      found: 0,
      uploaded: 0,
      alreadyThere: 0,
      skipped: 0,
      failed: 0,
      error: '',
      finishedAt: null,
    };
    let gaveUp = 0;
    let stopped = false;
    try {
      for (const f of todo) {
        if (shouldStop()) {
          stopped = true;
          break;
        }
        this.status.file = f.name;
        const file = this.resolve(f.name);
        const starts = await this.pullStarts(file, shouldStop);
        let complete = true;
        if (starts.length) {
          const check = await client.pullDeskRequest<{ missing: number[] }>(
            'post',
            '/backfill/check',
            { pulls: starts },
          );
          const missing = check.missing.map((i) => starts[i]);
          if (missing.length) {
            console.info(
              `[PullBackfill] ${f.name}: sending ${missing.length} pulls the server doesn't have`,
            );
            const hints = await this.recordingHints(
              missing[0].startedAt,
              missing[missing.length - 1].startedAt,
            );
            const failedBefore = this.status.failed;
            await this.run(
              file,
              (pull) =>
                missing.some(
                  (m) =>
                    m.encounterId === pull.encounterId &&
                    m.difficultyId === pull.difficultyId &&
                    Math.abs(m.startedAt - pull.startedAt) < SAME_PULL_MS,
                ),
              hints,
              shouldStop,
            );
            complete = this.status.failed === failedBefore;
          }
        }
        // Checked; look again only if the file changes (or a pull failed).
        if (!complete) {
          // Give up on a file after a few rechecks, so a log the server
          // keeps failing on isn't sent every half hour for a week.
          const again = recordRecheck(done[`${f.name}#tries`], doneKey(f));
          if (again.giveUp) {
            console.warn(
              `[PullBackfill] ${f.name}: still failing after ${MAX_FILE_RECHECKS} checks, leaving it`,
            );
            complete = true;
            gaveUp += 1;
          } else {
            done[`${f.name}#tries`] = again.value;
            await this.writeDone(done);
          }
        }
        if (complete) {
          done[f.name] = doneKey(f);
          delete done[`${f.name}#tries`];
          await this.writeDone(done);
        }
      }
    } catch (error) {
      const message = String((error as Error)?.message || error);
      if (message === 'Paused') {
        stopped = true;
      } else {
        this.status.error = message;
        console.warn('[PullBackfill] Automatic backfill failed', message);
      }
    } finally {
      // A pause is not a failure: keep what was known before it.
      if (!stopped || this.status.error) {
        this.lastFailure = failureAfterRun({
          now: Date.now(),
          error: this.status.error || undefined,
          failed: this.status.failed,
          gaveUp,
        });
      }
      this.status.running = false;
      this.status.finishedAt = Date.now();
      this.lastAuto = {
        at: Date.now(),
        uploaded: this.status.uploaded,
        files: todo.length,
      };
    }
  }
}
