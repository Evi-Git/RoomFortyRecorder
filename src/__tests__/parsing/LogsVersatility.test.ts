import type { PullStore } from '../../renderer/logs/store';
import { versTimelines } from '../../renderer/logs/versatility';
import type { VersShare } from '../../renderer/logs/versatility';

type Aura = {
  id: number;
  src?: number;
  dst: number;
  start: number;
  end: number;
};

/** Just the parts of a pull the versatility timeline reads. */
const pull = (opts: {
  vers: number;
  secondary?: [number, number, number];
  encounter?: string;
  enemies?: string[];
  auras: Aura[];
}) => {
  const units = [
    { name: 'Raider', guid: 'Player-1', raider: true, root: 0, npcId: 0 },
    { name: 'Druid', guid: 'Player-2', raider: true, root: 1, npcId: 0 },
    ...(opts.enemies ?? []).map((name, i) => ({
      name,
      guid: `Creature-${i}`,
      raider: false,
      root: 2 + i,
      npcId: 100 + i,
    })),
  ];
  const spells = opts.auras.map((a) => ({ id: a.id, name: '', school: 1 }));
  return {
    duration: 300,
    encounter: opts.encounter ?? '',
    units,
    spells,
    auras: opts.auras.map((a, i) => ({
      spell: i,
      src: a.src ?? a.dst,
      dst: a.dst,
      start: a.start,
      end: a.end,
      debuff: false,
    })),
    vers: new Map([['Player-1', opts.vers]]),
    secondary: new Map([['Player-1', opts.secondary ?? [900, 800, 700]]]),
  } as unknown as PullStore;
};

const shares: VersShare[] = [];

test('a pre-pull Liquid Luster is taken out of the snapshot and counted while up', () => {
  // Drunk 14.5 s before the pull: 3 stacks (1,260) in the snapshot.
  const at = versTimelines(
    pull({
      vers: 1260 + 108,
      auras: [{ id: 1295147, dst: 0, start: 0, end: 15.5 }],
    }),
  );
  expect(at(0, 1, shares)).toBeCloseTo((108 + 1260) / 54, 5);
  expect(at(0, 4, shares)).toBeCloseTo(
    30 + ((108 + 1680 - 1620) * 0.9) / 54,
    5,
  );
  // Five stacks: past 1,620 rating a point costs more, past 2,160 more
  // again.
  expect(at(0, 12, shares)).toBeCloseTo(
    30 + (540 * 0.9) / 54 + ((108 + 2100 - 2160) * 0.8) / 54,
    5,
  );
  expect(at(0, 20, shares)).toBeCloseTo(2, 5);
  expect(at(0, 250, shares)).toBeCloseTo(2, 5);
});

test('a potion drunk mid-fight ramps from its first stack', () => {
  const at = versTimelines(
    pull({ vers: 108, auras: [{ id: 1295147, dst: 0, start: 100, end: 130 }] }),
  );
  expect(at(0, 99, shares)).toBeCloseTo(2, 5);
  expect(at(0, 101, shares)).toBeCloseTo((108 + 420) / 54, 5);
  expect(at(0, 113, shares)).toBeCloseTo((108 + 3 * 420) / 54, 5);
});

test('a Vantus Rune counts on its own boss only, on top of the snapshot', () => {
  const rune = [{ id: 1303187, dst: 0, start: 0, end: 300 }];
  const on = versTimelines(
    pull({ vers: 108, encounter: "Ula'tek", auras: rune }),
  );
  expect(on(0, 50, shares)).toBeCloseTo((108 + 162) / 54, 5);
  const off = versTimelines(
    pull({ vers: 108, encounter: "Kith'ix", auras: rune }),
  );
  expect(off(0, 50, shares)).toBeCloseTo(2, 5);
  // Named after a boss inside an encounter with another name.
  const inside = versTimelines(
    pull({
      vers: 108,
      encounter: 'The Coiled Altar',
      enemies: ["Zul'jan"],
      auras: [{ id: 1303186, dst: 0, start: 0, end: 300 }],
    }),
  );
  expect(inside(0, 50, shares)).toBeCloseTo((108 + 162) / 54, 5);
  const comma = versTimelines(
    pull({
      vers: 108,
      encounter: "Nek'zali the Soulcoiler",
      auras: [{ id: 1303180, dst: 0, start: 0, end: 300 }],
    }),
  );
  expect(comma(0, 50, shares)).toBeCloseTo((108 + 162) / 54, 5);
});

test("Mark of the Wild is its caster's share, not the raider's own", () => {
  const at = versTimelines(
    pull({
      vers: 108,
      auras: [{ id: 1126, src: 1, dst: 0, start: 0, end: 200 }],
    }),
  );
  expect(at(0, 50, shares)).toBeCloseTo(2, 5);
  expect(shares).toEqual([
    { caster: 1, spellId: 1126, name: 'Mark of the Wild', pct: 3 },
  ]);
  expect(at(0, 250, shares)).toBeCloseTo(2, 5);
  expect(shares).toEqual([]);
});

test('a pre-pull Potion of Recklessness gives its versatility back afterwards', () => {
  // Versatility is the lowest stat: the snapshot is 231 under the gear.
  const at = versTimelines(
    pull({
      vers: -27,
      secondary: [855, 902, 3119],
      auras: [{ id: 1236994, dst: 0, start: 0, end: 16 }],
    }),
  );
  expect(at(0, 5, shares)).toBe(0);
  expect(at(0, 30, shares)).toBeCloseTo(204 / 54, 5);
});

test('procs count while up', () => {
  const at = versTimelines(
    pull({
      vers: 108,
      auras: [
        { id: 1295898, dst: 0, start: 40, end: 55 },
        { id: 1307922, dst: 0, start: 50, end: 62 },
      ],
    }),
  );
  expect(at(0, 45, shares)).toBeCloseTo((108 + 50) / 54, 5);
  expect(at(0, 52, shares)).toBeCloseTo((108 + 50 - 33) / 54, 5);
  expect(at(0, 60, shares)).toBeCloseTo((108 - 33) / 54, 5);
});
