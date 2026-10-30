import {
  addMonths,
  bossResult,
  difficultiesOf,
  groupByDifficulty,
  monthGrid,
  nightSummary,
  stepNight,
  weekGrid,
} from '../../renderer/logs/nightCalendar';

const boss = (
  encounterId: number,
  difficultyId: number,
  kills: number,
  extra: object = {},
) => ({
  encounterId,
  encounterName: `Boss ${encounterId}`,
  difficultyId,
  pulls: 3,
  kills,
  ...extra,
});

describe('night calendar', () => {
  test('October 2026 starts on Thursday and fills 5 Sunday-first weeks', () => {
    const weeks = monthGrid('2026-10-29');
    expect(weeks).toHaveLength(5);
    weeks.forEach((w) => expect(w).toHaveLength(7));
    expect(weeks[0][0]).toEqual({
      date: '2026-09-27',
      day: 27,
      inMonth: false,
    });
    expect(weeks[0][4]).toEqual({ date: '2026-10-01', day: 1, inMonth: true });
    expect(weeks[4][6]).toEqual({ date: '2026-10-31', day: 31, inMonth: true });
  });

  test('months needing 6 rows and exactly 4 rows', () => {
    expect(monthGrid('2026-08-01')).toHaveLength(6); // Aug 1 is a Saturday
    expect(monthGrid('2026-02-10')).toHaveLength(4); // Feb 2026: Sun 1 – Sat 28
  });

  test('week grid and month steps', () => {
    expect(weekGrid('2026-10-29').map((d) => d.date)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  test('summary, groups and results', () => {
    const bosses = [
      boss(1, 15, 1),
      boss(2, 233, 0, { bestPercent: 12.34 }),
      boss(3, 16, 1),
    ];
    expect(nightSummary(bosses)).toBe('Mythic 1/2 · Heroic 1/1');
    expect(groupByDifficulty(bosses).map((g) => g.name)).toEqual([
      'Mythic',
      'Heroic',
    ]);
    expect(bossResult(bosses[1])).toBe('12.3%');
    expect(bossResult(boss(4, 16, 0))).toBe('3 pulls');
    expect(bossResult(bosses[0])).toBe('Kill');
  });

  test('stepping between raid nights honours the filter', () => {
    const nights = [
      { night: '2026-10-29', bosses: [boss(1, 16, 1)] },
      { night: '2026-10-28', bosses: [boss(1, 15, 1)] },
      { night: '2026-10-27', bosses: [boss(1, 16, 0)] },
    ];
    expect(stepNight(nights, '2026-10-29', -1)).toBe('2026-10-28');
    expect(stepNight(nights, '2026-10-29', -1, 'Mythic')).toBe('2026-10-27');
    expect(stepNight(nights, '2026-10-29', 1)).toBeNull();
    expect(stepNight(nights, '2026-10-27', 1, 'Heroic')).toBe('2026-10-28');
    expect(difficultiesOf(nights)).toEqual(['Mythic', 'Heroic']);
  });
});
