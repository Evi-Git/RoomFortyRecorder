import { nsrtString } from '../../renderer/toplogs/nsrt';

describe('Copy for NSRT', () => {
  const base = {
    encounterId: 3513,
    difficultyId: 233,
    bossName: "Kith'ix",
    tag: 'Jawnathanx',
    casts: [
      [120.4, 51271],
      [1, 51271],
      [96, 279302],
    ] as [number, number][],
  };

  test('from the pull: everything in phase 1', () => {
    expect(nsrtString({ ...base, phases: [] })).toBe(
      [
        "EncounterID:3513;Difficulty:Mythic;Name:Kith'ix;",
        'time:1;ph:1;tag:Jawnathanx;spellid:51271;',
        'time:96;ph:1;tag:Jawnathanx;spellid:279302;',
        'time:120;ph:1;tag:Jawnathanx;spellid:51271;',
      ].join('\n'),
    );
  });

  test("by phase: seconds into each phase, Warcraft Logs' phase IDs", () => {
    const phases = [
      { name: 'Stage One', short: 'P1', from: 0, to: 95, id: 1 },
      { name: 'Intermission', short: 'Int', from: 95, to: 112, id: 2 },
      { name: 'Stage Two', short: 'P2', from: 112, to: 293, id: 3 },
    ];
    const out = nsrtString({ ...base, phases, countdown: 3, bossName: 'A;B' });
    expect(out.split('\n')).toEqual([
      'EncounterID:3513;Difficulty:Mythic;Name:A B;',
      'time:1;ph:1;tag:Jawnathanx;spellid:51271;countdown:3;',
      'time:1;ph:2;tag:Jawnathanx;spellid:279302;countdown:3;',
      'time:8;ph:3;tag:Jawnathanx;spellid:51271;countdown:3;',
    ]);
  });
});
