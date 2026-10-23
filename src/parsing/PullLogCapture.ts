import zlib from 'zlib';
import PullLogFilter, { leadingFields } from './PullLogFilter';
import PullMeters, { METERS_LINE_PREFIX } from './PullMeters';

/**
 * [RoomFortyRecorder] Pull desk: collects one raid pull's combat log lines,
 * from ENCOUNTER_START to ENCOUNTER_END, keeping only what the pull report
 * needs (see PullLogFilter). Fed every raw line by the combat log watcher.
 *
 * No Electron dependencies so it can be tested against real logs.
 */

export type CapturedPull = {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  /** Combat log time of ENCOUNTER_START, this PC's clock, epoch ms. */
  startedAt: number;
  /** Fight length from ENCOUNTER_END, the same on every raider's PC. */
  duration: number;
  result: boolean;
  /** Filtered lines, newline-joined, ending with a newline. */
  log: string;
  /** How many lines were kept: the server uploads the fullest log. */
  lineCount: number;
  /** Every line of the pull, gzipped (null if it got too big). */
  full: Promise<Buffer | null>;
};

// The full log is gzipped as it comes in; above this (raw) it's dropped.
// A 5-minute Mythic pull is about 100 MB raw, 10 MB gzipped.
const MAX_FULL_BYTES = 1024 * 1024 * 1024;
const FULL_FLUSH_CHARS = 512 * 1024;

/** Gzips lines as they arrive, so a pull's full log costs ~10 MB, not 100. */
class FullLog {
  private gz = zlib.createGzip({ level: 6 });

  private chunks: Buffer[] = [];

  private pending: string[] = [];

  private pendingChars = 0;

  private bytes = 0;

  private dropped = false;

  private done: Promise<Buffer | null>;

  constructor() {
    this.gz.on('data', (chunk: Buffer) => this.chunks.push(chunk));
    this.done = new Promise((resolve) => {
      this.gz.on('end', () =>
        resolve(this.dropped ? null : Buffer.concat(this.chunks)),
      );
      this.gz.on('error', () => resolve(null));
    });
  }

  public add(line: string) {
    if (this.dropped) return;
    this.pending.push(line);
    this.pendingChars += line.length + 1;
    this.bytes += line.length + 1;
    if (this.bytes > MAX_FULL_BYTES) {
      this.dropped = true;
      this.pending = [];
      this.chunks = [];
      return;
    }
    if (this.pendingChars >= FULL_FLUSH_CHARS) this.flush();
  }

  private flush() {
    if (!this.pending.length) return;
    this.gz.write(`${this.pending.join('\n')}\n`);
    this.pending = [];
    this.pendingChars = 0;
  }

  public finish(): Promise<Buffer | null> {
    if (!this.dropped) this.flush();
    this.gz.end();
    return this.done;
  }

  public abandon() {
    this.dropped = true;
    this.pending = [];
    this.gz.end();
  }
}

// Retail raid difficulties: Normal, Heroic, Mythic, LFR, and flex Mythic
// (233: raids like Kith'ix whose Mythic takes 10-30 players).
const RAID_DIFFICULTIES = new Set([14, 15, 16, 17, 233]);

// The app's Test button fakes a Mythic "Hogger" kill with this encounter ID.
const TEST_BUTTON_ENCOUNTER = 9999;

// A pull bigger than this is abandoned rather than eating memory. Filtered
// Mythic pulls run about 1.5 MB a minute, so this is far beyond any real pull.
const MAX_CAPTURE_BYTES = 150 * 1024 * 1024;

/**
 * Epoch ms from a combat log timestamp like "4/30/2026 20:05:17.7771" or the
 * older "4/30 20:05:17.777", read as this PC's local time, keeping the
 * milliseconds. Matches how the app dates its recordings.
 */
export const logLineEpochMs = (line: string): number => {
  const match =
    /^(\d+)\/(\d+)(?:\/(\d+))?\s+(\d+):(\d+):(\d+)(?:\.(\d+))?/.exec(line);
  if (!match) return Date.now();
  const [, month, day, year, hours, mins, secs, fraction] = match;
  const date = new Date();
  if (year) date.setFullYear(Number(year));
  date.setMonth(Number(month) - 1, Number(day));
  date.setHours(Number(hours), Number(mins), Number(secs), 0);
  const ms = fraction ? Number(`0.${fraction}`) * 1000 : 0;
  return date.getTime() + Math.round(ms);
};

export default class PullLogCapture {
  private current: {
    encounterId: number;
    encounterName: string;
    difficultyId: number;
    startedAt: number;
    filter: PullLogFilter;
    // Damage, healing... from every line, not just the kept ones.
    meters: PullMeters;
    // Every line, gzipped as it comes, for the Logs page.
    fullLog: FullLog;
    lines: string[];
    bytes: number;
  } | null = null;

  constructor(
    private onPull: (pull: CapturedPull) => void,
    private enabled: () => boolean = () => true,
  ) {}

  public get capturing() {
    return this.current !== null;
  }

  /** Feed one raw combat log line (timestamp included). */
  public onLine(line: string) {
    // Cheap check first: almost every line arrives outside a pull.
    const isStart = line.includes('  ENCOUNTER_START,');

    if (isStart) {
      this.begin(line);
      return;
    }

    const pull = this.current;
    if (!pull) return;

    pull.fullLog.add(line);
    try {
      pull.meters.feed(line);
    } catch {
      // One odd line shouldn't lose the pull.
    }

    if (pull.filter.keep(line)) {
      pull.lines.push(line);
      pull.bytes += line.length + 1;

      if (pull.bytes > MAX_CAPTURE_BYTES) {
        console.warn('[PullLogCapture] Pull too large, dropping it');
        pull.fullLog.abandon();
        this.current = null;
        return;
      }
    }

    if (line.includes('  ENCOUNTER_END,')) this.finish(line);
  }

  private begin(line: string) {
    // A START without an END (crash, disconnect): drop the unfinished pull.
    this.current?.fullLog.abandon();
    this.current = null;
    if (!this.enabled()) return;

    const [, encounterId, encounterName, difficultyId] = leadingFields(line, 4);
    const difficulty = Number(difficultyId);
    if (!RAID_DIFFICULTIES.has(difficulty)) return;
    if (Number(encounterId) === TEST_BUTTON_ENCOUNTER) return;

    const fullLog = new FullLog();
    fullLog.add(line);
    this.current = {
      encounterId: Number(encounterId),
      encounterName: encounterName || `Encounter ${encounterId}`,
      difficultyId: difficulty,
      startedAt: logLineEpochMs(line),
      filter: new PullLogFilter(),
      meters: new PullMeters(logLineEpochMs(line), logLineEpochMs),
      fullLog,
      lines: [line],
      bytes: line.length + 1,
    };
  }

  private finish(line: string) {
    const pull = this.current;
    this.current = null;
    if (!pull) return;

    const [, encounterId, , , , success, fightMs] = leadingFields(line, 7);
    if (Number(encounterId) !== pull.encounterId) {
      pull.fullLog.abandon();
      return;
    }

    const measured = Number(fightMs) / 1000;
    const fallback = (logLineEpochMs(line) - pull.startedAt) / 1000;

    const duration = measured > 0 ? measured : Math.max(0, fallback);
    // The meters ride along as one extra line at the end of the log.
    let metersLine = '';
    try {
      metersLine = `${METERS_LINE_PREFIX}${JSON.stringify(pull.meters.finish(duration))}\n`;
    } catch (error) {
      console.warn('[PullLogCapture] Meters failed', String(error));
    }

    this.onPull({
      encounterId: pull.encounterId,
      encounterName: pull.encounterName,
      difficultyId: pull.difficultyId,
      startedAt: pull.startedAt,
      duration,
      result: success === '1',
      log: `${pull.lines.join('\n')}\n${metersLine}`,
      lineCount: pull.lines.length,
      full: pull.fullLog.finish(),
    });
  }
}
