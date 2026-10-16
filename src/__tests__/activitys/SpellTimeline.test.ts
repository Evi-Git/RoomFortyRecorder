import RaidEncounter from '../../activitys/RaidEncounter';
import LogLine from '../../parsing/LogLine';
import { Flavour } from '../../main/types';

jest.mock('electron', () => ({ app: { getVersion: () => '1.6.0' } }));
jest.mock('../../config/ConfigService', () => ({
  __esModule: true,
  default: { getInstance: () => ({ get: () => 'English' }) },
}));

const PLAYER = 'Player-1234-0ABCDEF0';
const BOSS = 'Creature-0-4244-2913-38715-240387-000073A7B0';
const ADD = 'Creature-0-4244-2913-38715-111111-000073A7B1';
const FRIENDLY_NPC = 'Creature-0-4244-2913-38715-222222-000073A7B2';
const OTHER_PLAYER = 'Player-1234-0FFFFFF0';

// Hostile NPC flags (reaction hostile 0x40), friendly NPC 0x10 (friendly), self 0x511.
const line = (
  time: string,
  event: string,
  src: string,
  name: string,
  flags: string,
  spellId: number,
  spell: string,
) =>
  new LogLine(
    `10/15/2026 ${time}-4  ${event},${src},"${name}",${flags},0x0,0000000000000000,nil,0x80000000,0x80000000,${spellId},"${spell}",0x20,`,
  );

const damage = (time: string, dest: string, maxHp: number) =>
  new LogLine(
    `10/15/2026 ${time}-4  SPELL_DAMAGE,${PLAYER},"Evi-Realm",0x511,0x0,${dest},"Unit",0x10a48,0x0,1,"Hit",0x1,${dest},0000000000000000,${Math.floor(maxHp / 2)},${maxHp},0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0`,
  );

test('spell timeline records boss, enemy and own casts only', () => {
  const start = new Date('2026-10-15T21:00:00');
  const raid = new RaidEncounter(start, 3009, 'Test Boss', 16, Flavour.Retail);
  raid.playerGUID = PLAYER;

  // Boss is the highest-HP NPC; the add has less.
  raid.onSpellDamage(damage('21:00:01.000', ADD, 50_000_000));
  raid.onSpellDamage(damage('21:00:01.500', BOSS, 900_000_000));

  raid.recordTimelineCast(
    line(
      '21:00:05.250',
      'SPELL_CAST_START',
      BOSS,
      'Big Boss',
      '0x10a48',
      1001,
      'Annihilate',
    ),
    0,
  );
  raid.recordTimelineCast(
    line(
      '21:00:07.750',
      'SPELL_CAST_SUCCESS',
      BOSS,
      'Big Boss',
      '0x10a48',
      1001,
      'Annihilate',
    ),
    1,
  );
  raid.recordTimelineCast(
    line(
      '21:00:08.000',
      'SPELL_CAST_SUCCESS',
      ADD,
      'Minion',
      '0x10a48',
      2002,
      'Zap',
    ),
    1,
  );
  raid.recordTimelineCast(
    line(
      '21:00:09.100',
      'SPELL_CAST_SUCCESS',
      PLAYER,
      'Evi-Realm',
      '0x511',
      3003,
      'Flash Heal',
    ),
    1,
  );
  // Ignored: own cast START, other players, friendly NPCs.
  raid.recordTimelineCast(
    line(
      '21:00:09.000',
      'SPELL_CAST_START',
      PLAYER,
      'Evi-Realm',
      '0x511',
      3003,
      'Flash Heal',
    ),
    0,
  );
  raid.recordTimelineCast(
    line(
      '21:00:10.000',
      'SPELL_CAST_SUCCESS',
      OTHER_PLAYER,
      'Other-Realm',
      '0x514',
      4004,
      'Heroism',
    ),
    1,
  );
  raid.recordTimelineCast(
    line(
      '21:00:11.000',
      'SPELL_CAST_SUCCESS',
      FRIENDLY_NPC,
      'Ally',
      '0xa18',
      5005,
      'Help',
    ),
    1,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timeline = (raid as any).buildTimeline();

  expect(timeline.v).toBe(1);
  expect(timeline.casts).toEqual([
    [53, 1001, 0, 0],
    [78, 1001, 0, 1],
    [80, 2002, 1, 1],
    [91, 3003, 2, 1],
  ]);
  expect(timeline.sources).toEqual([
    { name: 'Big Boss', kind: 'boss', npcId: 240387 },
    { name: 'Minion', kind: 'enemy', npcId: 111111 },
    { name: 'Evi', kind: 'player', npcId: undefined },
  ]);
  expect(timeline.spells).toEqual({
    1001: 'Annihilate',
    2002: 'Zap',
    3003: 'Flash Heal',
  });
});

test('no timeline when nothing was cast', () => {
  const raid = new RaidEncounter(
    new Date(),
    3009,
    'Test Boss',
    16,
    Flavour.Retail,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((raid as any).buildTimeline()).toBeUndefined();
});
