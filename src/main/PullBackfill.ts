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

/**
 * [RoomFortyRecorder] Pull desk "Upload from combat log": send pulls from a
 * saved combat log file (a night nobody had "Send my pull logs" on). The
 * same filter as the live capture, the same reports on the server; each pull
 * is placed by its real start time. Pulls the server already has a log for
 * are skipped.
 */

const gzip = promisify(zlib.gzip);

const RAID_DIFFICULTIES = new Set([14, 15, 16, 17]);
const TEST_BUTTON_ENCOUNTER = 9999;
// A recording and a pull in the log agree on the start within this.
const HINT_MATCH_MS = 2 * 60 * 1000;

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
    file: '',
    found: 0,
    uploaded: 0,
    alreadyThere: 0,
    skipped: 0,
    failed: 0,
    error: '',
    finishedAt: null,
  };

  constructor(private logDir: () => string) {}

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
    for await (const line of lines(this.resolve(name))) {
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
    if (this.status.running) throw new Error('An upload is already running');
    const file = this.resolve(name);
    this.status = {
      running: true,
      file: path.basename(file),
      found: 0,
      uploaded: 0,
      alreadyThere: 0,
      skipped: 0,
      failed: 0,
      error: '',
      finishedAt: null,
    };
    this.run(file, new Set(keys), hints)
      .catch((error) => {
        this.status.error = String(error?.message || error);
      })
      .finally(() => {
        this.status.running = false;
        this.status.finishedAt = Date.now();
      });
  }

  private async run(file: string, keys: Set<string>, hints: BossPercentHint[]) {
    const client = CloudClient.getInstance();
    if (!client.pullDeskReady()) {
      throw new Error('Sign in with Discord in Cloud settings first.');
    }

    const queue: CapturedPull[] = [];
    const capture = new PullLogCapture((pull) => {
      if (keys.has(`${pull.encounterId}:${pull.difficultyId}`))
        queue.push(pull);
    });

    for await (const line of lines(file)) {
      capture.onLine(line);
      while (queue.length) {
        // One pull at a time, so memory stays at one pull's log.
        await this.send(client, queue.shift() as CapturedPull, hints);
      }
    }
  }

  private async send(
    client: CloudClient,
    pull: CapturedPull,
    hints: BossPercentHint[],
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
      this.status.uploaded += 1;
    } catch (error) {
      console.warn('[PullBackfill] Pull failed', String(error));
      this.status.failed += 1;
    }
  }
}
