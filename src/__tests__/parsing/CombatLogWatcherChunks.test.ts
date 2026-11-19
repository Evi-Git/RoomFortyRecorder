import fs from 'fs';
import os from 'os';
import path from 'path';
import CombatLogWatcher from '../../parsing/CombatLogWatcher';

// main/util pulls in electron and native input hooks; the watcher only needs
// these two helpers from it, so stand in a plain fs.stat version.
jest.mock('../../main/util', () => {
  const nodeFs = require('fs');

  const nodePath = require('path');
  return {
    getFileInfo: async (pathSpec: string) => {
      const name = nodePath.resolve(pathSpec);
      const st = nodeFs.statSync(name);
      return {
        name,
        size: st.size,
        mtime: st.mtime.getTime(),
        birthTime: st.birthtime.getTime(),
      };
    },
    getSortedFiles: async () => [],
  };
});

/**
 * [RoomFortyRecorder] The combat log reader must never split a line (or a
 * multi-byte character) at a read boundary. These tests append real log bytes
 * to a real file in pieces and call the watcher's internal process() after
 * each piece, as the fs watcher would.
 */

const logs = path.join(__dirname, '../../../tests/logs/retail');
const FILE = 'WoWCombatLog-111111_000000.txt';

let dir: string;
let watcher: CombatLogWatcher;
let seen: string[];

/** The private bits of the watcher these tests drive directly. */
type Internals = {
  process: (file: string) => Promise<void>;
  queue: { add: (task: () => Promise<void>) => void };
  tails: Record<string, Buffer>;
};

const internals = () => watcher as unknown as Internals;

const feed = async (file = FILE) => {
  await internals().process(file);
};

const append = (data: Buffer | string, file = FILE) =>
  fs.appendFileSync(path.join(dir, file), data);

const expectedLines = (data: Buffer) =>
  data
    .toString('utf-8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s);

/** Small deterministic PRNG so failures are reproducible. */
const mulberry32 = (seed: number) => () => {
  seed += 0x6d2b79f5;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const count = (lines: string[], type: string) =>
  lines.filter((l) => l.includes(`  ${type},`)).length;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-watcher-'));
  watcher = new CombatLogWatcher(dir);
  seen = [];
  watcher.lineTap = (line) => seen.push(line);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('CombatLogWatcher chunk boundaries', () => {
  it('reads a short sample whole when split at every byte offset', async () => {
    const sample = Buffer.from(
      [
        '8/3 22:09:58.548  ENCOUNTER_START,9999,"Hogger",16,21,2481',
        '8/3 22:09:59.001  SPELL_DAMAGE,Player-1-A,"Ståbby-Area52",0x511,0x0,Creature-0-1,"Zoë",0x10a48,0x0,1,"Fireball",0x4,10,0',
        '8/3 22:10:20.000  ENCOUNTER_END,9999,"Hogger",16,21,0,1000',
        '',
      ].join('\n'),
      'utf-8',
    );
    const want = expectedLines(sample);
    expect(want).toHaveLength(3);

    for (let cut = 0; cut <= sample.length; cut++) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-watcher-'));
      watcher = new CombatLogWatcher(dir);
      seen = [];
      watcher.lineTap = (line) => seen.push(line);

      append(sample.subarray(0, cut));
      await feed();
      append(sample.subarray(cut));
      await feed();

      expect(seen).toEqual(want);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['raid_wipe.txt', 'mythic_plus.txt'])(
    'reads %s identically when fed at random offsets',
    async (name) => {
      // A real log ends every line with a newline; some of these files don't.
      const raw = fs.readFileSync(path.join(logs, name));
      const data =
        raw[raw.length - 1] === 0x0a
          ? raw
          : Buffer.concat([raw, Buffer.from('\n')]);
      const want = expectedLines(data);
      const rand = mulberry32(1234);

      let pos = 0;
      while (pos < data.length) {
        const next = Math.min(
          data.length,
          pos + 1 + Math.floor(rand() * 20000),
        );
        append(data.subarray(pos, next));
        await feed();
        pos = next;
      }

      expect(seen.length).toBe(want.length);
      expect(seen).toEqual(want);
      expect(count(seen, 'ENCOUNTER_START')).toBe(
        count(want, 'ENCOUNTER_START'),
      );
      expect(count(seen, 'ENCOUNTER_END')).toBe(count(want, 'ENCOUNTER_END'));
    },
  );

  it('keeps non-ASCII names intact when a read ends inside a character', async () => {
    const raw = fs.readFileSync(path.join(logs, 'mythic_plus.txt'));
    const data =
      raw[raw.length - 1] === 0x0a
        ? raw
        : Buffer.concat([raw, Buffer.from('\n')]);
    const want = expectedLines(data);
    expect(want.some((l) => /[^\p{ASCII}]/u.test(l))).toBe(true);

    // Cut in the middle of the first few hundred multi-byte characters.
    const cuts: number[] = [];
    for (let i = 1; i < data.length && cuts.length < 300; i++) {
      if ((data[i] & 0xc0) === 0x80) cuts.push(i);
    }
    expect(cuts.length).toBeGreaterThan(0);

    let pos = 0;
    for (const cut of cuts) {
      append(data.subarray(pos, cut));
      await feed();
      pos = cut;
    }
    append(data.subarray(pos));
    await feed();

    expect(seen).toEqual(want);
    expect(seen.join('').includes('�')).toBe(want.join('').includes('�'));
  });

  it('handles CRLF line endings, including a cut between CR and LF', async () => {
    const text = 'A line one\r\nB line two\r\nC line three\r\n';
    const buf = Buffer.from(text);
    const cut = text.indexOf('\r\nB') + 1; // between \r and \n
    append(buf.subarray(0, cut));
    await feed();
    expect(seen).toEqual([]);
    append(buf.subarray(cut));
    await feed();
    expect(seen).toEqual(['A line one', 'B line two', 'C line three']);
  });

  it('does not emit a line until its newline arrives', async () => {
    append('8/3 22:09:58.548  ENCOUNTER_START,1,"X",16,21,1');
    await feed();
    expect(seen).toEqual([]);
    append('\n');
    await feed();
    expect(seen).toEqual(['8/3 22:09:58.548  ENCOUNTER_START,1,"X",16,21,1']);
  });

  it('still emits the activity event on every read', async () => {
    const onActivity = jest.fn();
    watcher.on('WARCRAFT_RECORDER_LOG_ACTIVITY', onActivity);
    append('partial');
    await feed();
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('discards a tail over the cap, once, and recovers on the next line', async () => {
    append(Buffer.alloc(1024 * 1024 + 10, 0x41)); // no newline
    await feed();
    expect(seen).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String((console.error as jest.Mock).mock.calls[0][0])).toContain(
      '[CombatLogWatcher]',
    );
    expect(internals().tails[path.join(dir, FILE)]).toBeUndefined();

    append('\nnext line\n');
    await feed();
    // The leftover of the discarded line is a fragment, but later lines are fine.
    expect(seen[seen.length - 1]).toBe('next line');
  });

  it('starts from the beginning when the file is replaced by a shorter one', async () => {
    append('old line one\nold line two\nhalf an old li');
    await feed();
    expect(seen).toEqual(['old line one', 'old line two']);

    fs.writeFileSync(path.join(dir, FILE), 'new one\nnew two\n');
    await feed();
    expect(seen).toEqual([
      'old line one',
      'old line two',
      'new one',
      'new two',
    ]);
    expect(internals().tails[path.join(dir, FILE)]).toBeUndefined();
  });

  it('keeps separate tails for separate files', async () => {
    const other = 'WoWCombatLog-222222_000000.txt';
    append('aaa', FILE);
    append('bbb', other);
    await feed(FILE);
    await feed(other);
    append('1\n', FILE);
    append('2\n', other);
    await feed(FILE);
    await feed(other);
    expect(seen).toEqual(['aaa1', 'bbb2']);
  });

  it('queues change events one at a time, so reads cannot overlap', async () => {
    // watch() hands every change to an AsyncQueue that awaits each task.
    const data = Buffer.from('l1\nl2\nl3\nl4\n');
    append(data.subarray(0, 4));
    internals().queue.add(() => internals().process(FILE));
    append(data.subarray(4, 9));
    internals().queue.add(() => internals().process(FILE));
    append(data.subarray(9));
    internals().queue.add(() => internals().process(FILE));
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual(['l1', 'l2', 'l3', 'l4']);
  });
});
