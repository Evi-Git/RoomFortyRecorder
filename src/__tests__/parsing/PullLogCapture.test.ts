import fs from 'fs';
import path from 'path';
import PullLogCapture, { CapturedPull } from '../../parsing/PullLogCapture';
import PullLogFilter, { leadingFields } from '../../parsing/PullLogFilter';

/**
 * [RoomFortyRecorder] Pull desk capture, run over the real logs used by the
 * integration tests.
 */

const logs = path.join(__dirname, '../../../tests/logs/retail');

const capture = (file: string, enabled = true) => {
  const pulls: CapturedPull[] = [];
  const capturer = new PullLogCapture(
    (pull) => pulls.push(pull),
    () => enabled,
  );
  const text = fs.readFileSync(path.join(logs, file), 'utf8');
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => capturer.onLine(line));
  return pulls;
};

test('leadingFields honours quotes', () => {
  const line =
    '4/30/2026 20:05:17.7771  ENCOUNTER_START,3182,"Belo\'ren, Child of Al\'ar",16,20,2913';
  expect(leadingFields(line, 4)).toEqual([
    'ENCOUNTER_START',
    '3182',
    "Belo'ren, Child of Al'ar",
    '16',
  ]);
});

test('captures a Mythic pull and shrinks it', () => {
  const pulls = capture('beloren_boss_hp.txt');
  expect(pulls).toHaveLength(1);

  const [pull] = pulls;
  expect(pull.encounterId).toBe(3182);
  expect(pull.encounterName).toBe("Belo'ren, Child of Al'ar");
  expect(pull.difficultyId).toBe(16);
  expect(pull.result).toBe(false);
  expect(pull.duration).toBeCloseTo(172.13, 1);

  const lines = pull.log.trim().split('\n');
  expect(lines[0]).toContain('  ENCOUNTER_START,');
  expect(lines[lines.length - 1]).toContain('  ENCOUNTER_END,');
  expect(lines.filter((l) => l.includes('  COMBATANT_INFO,'))).toHaveLength(20);
  expect(
    lines.filter((l) =>
      / {2}UNIT_DIED,[^,]*,[^,]*,[^,]*,[^,]*,Player-/.test(l),
    ),
  ).toHaveLength(20);

  // 40 MB raw; the upload should be a small fraction of that.
  expect(pull.log.length).toBeLessThan(6 * 1024 * 1024);
});

test('ignores dungeon encounters', () => {
  expect(capture('mythic_plus.txt')).toHaveLength(0);
});

test("ignores the Test button's fake Hogger pull", () => {
  const pulls: CapturedPull[] = [];
  const capturer = new PullLogCapture((pull) => pulls.push(pull));
  capturer.onLine(
    '4/30/2026 20:05:17.7771  ENCOUNTER_START,9999,"Hogger",16,21,2481',
  );
  capturer.onLine(
    '4/30/2026 20:05:47.7771  ENCOUNTER_END,9999,"Hogger",16,21,1,143557',
  );
  expect(pulls).toHaveLength(0);
});

test('captures nothing when the setting is off', () => {
  expect(capture('beloren_boss_hp.txt', false)).toHaveLength(0);
});

test('filter keeps player damage and drops heals', () => {
  const filter = new PullLogFilter();
  const toPlayer =
    '4/30/2026 20:05:18.8131  SPELL_DAMAGE,Creature-0-4244-2913-38715-240387-000073A7B0,"Belo\'ren",0x10a48,0x80000000,Player-3674-091C4D69,"Psiethyr-TwistingNether-EU",0x514,0x80000000,1241932,"Voidlight Convergence",0x22';
  const heal =
    '4/30/2026 20:05:18.8131  SPELL_HEAL,Player-3674-091C4D69,"Psiethyr-TwistingNether-EU",0x514,0x80000000,Player-3674-091C4D69,"Psiethyr-TwistingNether-EU",0x514,0x80000000,1,"Heal",0x2';
  expect(filter.keep(toPlayer)).toBe(true);
  expect(filter.keep(heal)).toBe(false);
});

test('filter samples damage to an enemy once a second', () => {
  const filter = new PullLogFilter();
  const hit = (time: string) =>
    `4/30/2026 20:05:${time}  SPELL_DAMAGE,Player-1,"A",0x514,0x0,Creature-0-1-1-1-240387-0001,"Boss",0x10a48,0x0,8092,"Mind Blast",0x20`;
  expect(filter.keep(hit('17.1000'))).toBe(true);
  expect(filter.keep(hit('17.5000'))).toBe(false);
  expect(filter.keep(hit('18.2000'))).toBe(true);
});

test("captures flex Mythic (difficulty 233, e.g. Kith'ix)", () => {
  const pulls: CapturedPull[] = [];
  const capturer = new PullLogCapture((pull) => pulls.push(pull));
  const text = fs
    .readFileSync(path.join(logs, 'beloren_boss_hp.txt'), 'utf8')
    // The same pull, as if the raid's Mythic were flex (10-30 players).
    .replace(/(ENCOUNTER_(?:START|END),3182,"[^"]*",)16,/g, '$1233,');
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => capturer.onLine(line));
  expect(pulls).toHaveLength(1);
  expect(pulls[0].difficultyId).toBe(233);
});
