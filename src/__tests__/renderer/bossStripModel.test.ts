import {
  initials,
  pickForMode,
  stripItems,
  stripModes,
  stripSummary,
  zoneBosses,
} from '../../renderer/logs/bossStripModel';

const season = [
  { encounterId: 1, name: 'Coiled Altar' },
  { encounterId: 2, name: "Ula'tek" },
  { encounterId: 3, name: "Kith'ix" },
];
const night = [
  {
    encounterId: 1,
    encounterName: 'Coiled Altar',
    difficultyId: 16,
    pulls: 3,
    kills: 1,
  },
  {
    encounterId: 1,
    encounterName: 'Coiled Altar',
    difficultyId: 15,
    pulls: 1,
    kills: 1,
  },
  {
    encounterId: 3,
    encounterName: "Kith'ix",
    difficultyId: 233,
    pulls: 12,
    kills: 0,
    bestPercent: 4.2,
  },
  {
    encounterId: 3,
    encounterName: "Kith'ix",
    difficultyId: 16,
    pulls: 2,
    kills: 0,
  },
  {
    encounterId: 9,
    encounterName: 'Trash Boss',
    difficultyId: 16,
    pulls: 1,
    kills: 1,
  },
];

describe('boss strip', () => {
  test('season order, greyed when not pulled, extra bosses at the end', () => {
    const items = stripItems(season, night, 'Mythic');
    expect(
      items.map((i) => [i.encounterId, i.boss?.difficultyId ?? null]),
    ).toEqual([
      [1, 16],
      [2, null],
      [3, 233], // flex Mythic had more pulls than Mythic
      [9, 16],
    ]);
    const heroic = stripItems(season, night, 'Heroic');
    expect(heroic.map((i) => i.boss?.encounterId ?? null)).toEqual([
      1,
      null,
      null,
      null,
    ]);
  });

  test('without a season list the night bosses still show', () => {
    expect(stripItems([], night, 'Mythic').map((i) => i.encounterId)).toEqual([
      1, 3, 9,
    ]);
  });

  test('modes: Heroic and Mythic always, others only when pulled', () => {
    expect(stripModes(night)).toEqual([
      { mode: 'Heroic', count: 1 },
      { mode: 'Mythic', count: 4 },
    ]);
    expect(
      stripModes([{ ...night[0], difficultyId: 17 }]).map((m) => m.mode),
    ).toEqual(['LFR', 'Heroic', 'Mythic']);
  });

  test('switching keeps the boss when it was pulled there', () => {
    expect(pickForMode(night, 'Heroic', 1)?.difficultyId).toBe(15);
    expect(pickForMode(night, 'Mythic', 1)?.difficultyId).toBe(16);
    // Not pulled on Heroic: the busiest Heroic boss.
    expect(pickForMode(night, 'Heroic', 3)?.encounterId).toBe(1);
    expect(pickForMode(night, 'Normal', 1)).toBeNull();
  });

  test('summary and initials', () => {
    expect(stripSummary(night[0])).toBe('Kill · 3 pulls');
    expect(stripSummary(night[2])).toBe('Best 4.2% · 12 pulls');
    expect(stripSummary({ ...night[3], pulls: 1 })).toBe('1 pull');
    expect(initials('The Coiled Altar')).toBe('CA');
    expect(initials("Kith'ix")).toBe('K');
  });
});

describe('zoneBosses', () => {
  it("drops bosses from other raids, which show only on nights they're pulled", () => {
    const list = [
      ...season,
      { encounterId: 50, name: "Belo'ren", inZone: false },
      { encounterId: 51, name: "L'ura", inZone: false },
    ];
    const zone = zoneBosses(list);
    const tonight = night.filter((b) => b.encounterId !== 9);
    expect(zone.map((b) => b.encounterId)).toEqual([1, 2, 3]);
    // Not pulled this night: not on the strip.
    expect(
      stripItems(zone, tonight, 'Mythic').map((i) => i.encounterId),
    ).toEqual([1, 2, 3]);
    // Pulled this night: added at the end.
    const withOld = [
      ...tonight,
      {
        encounterId: 50,
        encounterName: "Belo'ren",
        difficultyId: 16,
        pulls: 1,
        kills: 1,
      },
    ];
    expect(
      stripItems(zone, withOld, 'Mythic').map((i) => i.encounterId),
    ).toEqual([1, 2, 3, 50]);
  });

  it('keeps everything when the server has no raid list', () => {
    const list = [{ encounterId: 50, name: "Belo'ren", inZone: false }];
    expect(zoneBosses(list)).toEqual(list);
  });
});
