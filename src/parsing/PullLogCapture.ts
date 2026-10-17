import PullLogFilter, { leadingFields } from './PullLogFilter';

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
};

// Retail raid difficulties: LFR, Normal, Heroic, Mythic.
const RAID_DIFFICULTIES = new Set([14, 15, 16, 17]);

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

    if (pull.filter.keep(line)) {
      pull.lines.push(line);
      pull.bytes += line.length + 1;

      if (pull.bytes > MAX_CAPTURE_BYTES) {
        console.warn('[PullLogCapture] Pull too large, dropping it');
        this.current = null;
        return;
      }
    }

    if (line.includes('  ENCOUNTER_END,')) this.finish(line);
  }

  private begin(line: string) {
    // A START without an END (crash, disconnect): drop the unfinished pull.
    this.current = null;
    if (!this.enabled()) return;

    const [, encounterId, encounterName, difficultyId] = leadingFields(line, 4);
    const difficulty = Number(difficultyId);
    if (!RAID_DIFFICULTIES.has(difficulty)) return;
    if (Number(encounterId) === TEST_BUTTON_ENCOUNTER) return;

    this.current = {
      encounterId: Number(encounterId),
      encounterName: encounterName || `Encounter ${encounterId}`,
      difficultyId: difficulty,
      startedAt: logLineEpochMs(line),
      filter: new PullLogFilter(),
      lines: [line],
      bytes: line.length + 1,
    };
  }

  private finish(line: string) {
    const pull = this.current;
    this.current = null;
    if (!pull) return;

    const [, encounterId, , , , success, fightMs] = leadingFields(line, 7);
    if (Number(encounterId) !== pull.encounterId) return;

    const measured = Number(fightMs) / 1000;
    const fallback = (logLineEpochMs(line) - pull.startedAt) / 1000;

    this.onPull({
      encounterId: pull.encounterId,
      encounterName: pull.encounterName,
      difficultyId: pull.difficultyId,
      startedAt: pull.startedAt,
      duration: measured > 0 ? measured : Math.max(0, fallback),
      result: success === '1',
      log: `${pull.lines.join('\n')}\n`,
      lineCount: pull.lines.length,
    });
  }
}
