/**
 * Fixture recordings for the Recordings pages: made-up names and times, no
 * video files behind them (the player shows its own error state).
 * Shapes follow RendererVideo (src/main/types.ts).
 */
import { VideoCategory } from 'types/VideoCategory';

type Fixture = Record<string, any>;

const MIN = 60 * 1000;
// 8:49 PM EDT on 21 Oct 2026: the same night as the seeded pulls.
const NIGHT = Date.UTC(2026, 9, 22, 0, 49, 3);

const raidMates = [
  { _GUID: 'Player-1-A', _name: 'Fixture-Aldra', _realm: 'Fixture', _specID: 65, _teamID: 1 },
  { _GUID: 'Player-1-B', _name: 'Fixture-Bram', _realm: 'Fixture', _specID: 250, _teamID: 1 },
  { _GUID: 'Player-1-C', _name: 'Fixture-Cyra', _realm: 'Fixture', _specID: 62, _teamID: 1 },
  { _GUID: 'Player-1-D', _name: 'Fixture-Dov', _realm: 'Fixture', _specID: 71, _teamID: 1 },
];

const base = (name: string, over: Fixture): Fixture => ({
  videoName: name,
  flavour: 'Retail',
  overrun: 15,
  combatants: raidMates,
  player: raidMates[0],
  deaths: [],
  isProtected: false,
  protected: false,
  multiPov: [],
  cloud: false,
  mtime: 0,
  result: true,
  ...over,
});

const raid = (
  name: string,
  startOffsetMin: number,
  encounterName: string,
  encounterID: number,
  difficultyID: number,
  difficulty: string,
  duration: number,
  result: boolean,
  extra: Fixture = {},
) =>
  base(name, {
    category: VideoCategory.Raids,
    start: NIGHT + startOffsetMin * MIN,
    mtime: NIGHT + startOffsetMin * MIN + duration * 1000,
    duration,
    result,
    encounterName,
    encounterID,
    difficultyID,
    difficulty,
    zoneName: 'The Venomous Abyss',
    zoneID: 14663,
    bossPercent: result ? 0 : 38,
    upgradeLevel: 4,
    deaths: result
      ? []
      : [
          { name: 'Fixture-Bram-Fixture', specId: 250, date: new Date(NIGHT), timestamp: 72, friendly: true },
          { name: 'Fixture-Cyra-Fixture', specId: 62, date: new Date(NIGHT), timestamp: 95, friendly: true },
        ],
    ...extra,
  });

const dungeon = (
  name: string,
  startOffsetMin: number,
  mapID: number,
  zoneName: string,
  level: number,
  duration: number,
  result: boolean,
  upgradeLevel = result ? 2 : 0,
) =>
  base(name, {
    category: VideoCategory.MythicPlus,
    start: NIGHT + startOffsetMin * MIN,
    mtime: NIGHT + startOffsetMin * MIN + duration * 1000,
    duration,
    result,
    zoneName,
    zoneID: 2805,
    mapID,
    keystoneLevel: level,
    upgradeLevel,
    affixes: [9, 10],
    combatants: raidMates,
  });

const clip = (name: string, parent: string, startOffsetMin: number, duration: number, parentCategory: VideoCategory) =>
  base(name, {
    category: VideoCategory.Clips,
    parentCategory,
    parentVideoName: parent,
    parentVideoOffset: 40,
    start: NIGHT + startOffsetMin * MIN,
    clippedAt: NIGHT + (startOffsetMin + 30) * MIN,
    mtime: NIGHT + (startOffsetMin + 30) * MIN,
    duration,
    encounterName: parentCategory === VideoCategory.Raids ? "Ula'tek" : undefined,
    zoneName: parentCategory === VideoCategory.MythicPlus ? 'Windrunner Spire' : 'The Venomous Abyss',
    keystoneLevel: parentCategory === VideoCategory.MythicPlus ? 12 : undefined,
    mapID: parentCategory === VideoCategory.MythicPlus ? 557 : undefined,
  });

const manual = (name: string, startOffsetMin: number, duration: number) =>
  base(name, {
    category: VideoCategory.Manual,
    start: NIGHT + startOffsetMin * MIN,
    mtime: NIGHT + startOffsetMin * MIN + duration * 1000,
    duration,
    result: true,
    zoneName: 'Dornogal',
  });

const diskList: Fixture[] = [
  raid('Ulatek-kill', 0, "Ula'tek", 3492, 16, 'Mythic', 596, true),
  raid('Kithix-wipe-1', 33, "Kith'ix", 3513, 233, 'Mythic', 58, false),
  raid('Kithix-wipe-2', 143, "Kith'ix", 3513, 233, 'Mythic', 168, false),
  raid('Kithix-wipe-3', 148, "Kith'ix", 3513, 233, 'Mythic', 159, false),
  raid('Kithix-kill', 155, "Kith'ix", 3513, 233, 'Mythic', 292, true),
  // Protected and tagged, so the lock shows brass and the tag button is "on".
  raid('Ulatek-heroic-kill', -1500, "Ula'tek", 3492, 15, 'Heroic', 410, true, {
    isProtected: true,
    protected: true,
    tag: 'Prog night: tank swap',
  }),
  dungeon('Windrunner-12', 400, 557, 'Windrunner Spire', 12, 1710, true),
  dungeon('Skyreach-10-abandoned', 460, 161, 'Skyreach', 10, 1980, false),
  dungeon('Skyreach-9-depleted', 520, 161, 'Skyreach', 9, 2400, true, 0),
  clip('Ulatek-clip', 'Ulatek-kill', 10, 28, VideoCategory.Raids),
  clip('Windrunner-clip', 'Windrunner-12', 405, 24, VideoCategory.MythicPlus),
  manual('Manual-1', 500, 150),
].map((v, i) => ({
  ...v,
  videoSource: `D:\\Recordings\\${v.videoName}.mp4`,
  uniqueId: `${v.videoName}-disk`,
  size: (400 + i * 37) * 1024 * 1024,
}));

// Two of the raid recordings also exist in the guild cloud, plus one that is
// only there (another raider's POV).
const cloudList: Fixture[] = [
  { ...diskList[0], cloud: true },
  { ...diskList[4], cloud: true },
  {
    ...raid('Ulatek-kill-pov', 0, "Ula'tek", 3492, 16, 'Mythic', 596, true, {
      player: raidMates[2],
      uniqueHash: 'fixture-ulatek',
    }),
    cloud: true,
  },
].map((v) => ({
  ...v,
  videoKey: `${v.videoName}.mp4`,
  videoSource: `https://fixture.invalid/video/${v.videoName}.mp4`,
  uniqueId: `${v.videoName}-cloud`,
  mtime: 0,
}));

export const diskVideos = diskList;
export const cloudVideos = cloudList;
