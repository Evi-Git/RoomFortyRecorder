import {
  bossPercent,
  compact,
  compactShort,
  fileSize,
  formatDuration,
  formatDurationLong,
  formatDurationMillis,
  formatDurationPadded,
  formatDurationRounded,
  formatDurationTenths,
  grouped,
  pct,
  percentSigned,
  percentValue,
  ratioPercent,
} from '../../renderer/format';
import {
  dayLabel,
  monthDay,
  monthShort,
  monthYear,
  nightDate,
  nightLabel,
  shortNight,
  weekdayShort,
} from '../../renderer/clock';

describe('compact numbers', () => {
  it('uses k, m and b in lower case', () => {
    expect(compact(0)).toBe('0');
    expect(compact(999.4)).toBe('999');
    expect(compact(1000)).toBe('1.0k');
    expect(compact(612000)).toBe('612.0k');
    expect(compact(1234567)).toBe('1.23m');
    expect(compact(98765432)).toBe('98.77m');
    expect(compact(2.5e9)).toBe('2.50b');
  });
  it('keeps the sign', () => {
    expect(compact(-1500)).toBe('-1.5k');
    expect(compact(-2.5e6)).toBe('-2.50m');
  });
});

describe('compactShort', () => {
  it('drops decimals from 100 of a unit up', () => {
    expect(compactShort(123450000)).toBe('123m');
    expect(compactShort(1234567)).toBe('1.2m');
    expect(compactShort(612000)).toBe('612k');
    expect(compactShort(12345)).toBe('12.3k');
    expect(compactShort(999)).toBe('999');
  });
});

describe('exact numbers and percentages', () => {
  it('groups thousands', () => {
    expect(grouped(491238)).toBe('491,238');
    expect(grouped(1234.6)).toBe('1,235');
    expect(grouped(12)).toBe('12');
  });
  it('formats percentages', () => {
    expect(ratioPercent(0.1234)).toBe('12.3%');
    expect(ratioPercent(0.5, 0)).toBe('50%');
    expect(percentValue(12.34)).toBe('12.3%');
    expect(percentValue(null)).toBe('–');
    expect(percentValue(undefined)).toBe('–');
    expect(bossPercent(0.4)).toBe('0.4%');
    expect(bossPercent(0.04)).toBe('0.1%');
    expect(bossPercent(0)).toBe('0%');
    expect(bossPercent(4.75)).toBe('4.8%');
    expect(bossPercent(5)).toBe('5%');
    expect(bossPercent(9.96)).toBe('10%');
    expect(bossPercent(12.4)).toBe('12%');
    expect(bossPercent(12.5)).toBe('13%');
    expect(bossPercent(69.6)).toBe('70%');
    expect(bossPercent(70)).toBe('70%');
    expect(bossPercent(null)).toBe('–');
    expect(percentSigned(3.21)).toBe('+3.2%');
    expect(percentSigned(-1)).toBe('-1.0%');
    expect(pct(1, 4)).toBe('25.00%');
    expect(pct(1, 0)).toBe('–');
  });
  it('formats file sizes', () => {
    expect(fileSize(10)).toBe('1 MB');
    expect(fileSize(12.4e6)).toBe('12 MB');
    expect(fileSize(1.45e9)).toBe('1.4 GB');
  });
});

describe('durations', () => {
  it('is m:ss under an hour and h:mm:ss from an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(-3)).toBe('-0:03');
    expect(formatDuration(-65.5)).toBe('-1:05');
    expect(formatDuration(-0.5)).toBe('0:00');
  });
  it('rounds when asked', () => {
    expect(formatDurationRounded(65.6)).toBe('1:06');
    expect(formatDurationRounded(119.6)).toBe('2:00');
  });
  it('has tenths and milliseconds', () => {
    expect(formatDurationTenths(65.34)).toBe('1:05.3');
    expect(formatDurationTenths(59.96)).toBe('1:00.0');
    expect(formatDurationMillis(65.1234)).toBe('1:05.123');
  });
  it('pads video positions', () => {
    expect(formatDurationPadded(292)).toBe('04:52');
    expect(formatDurationPadded(3723)).toBe('01:02:03');
    expect(formatDurationPadded(59.6)).toBe('01:00');
  });
  it('spells long lengths', () => {
    expect(formatDurationLong(45 * 60)).toBe('45 min');
    expect(formatDurationLong(3600)).toBe('1 h');
    expect(formatDurationLong(3600 + 23 * 60)).toBe('1 h 23 min');
    expect(formatDurationLong(7170)).toBe('2 h');
    expect(formatDurationLong(3570)).toBe('1 h');
    expect(formatDurationLong(3540)).toBe('59 min');
  });
});

describe('dates', () => {
  const year = new Date().getFullYear();
  it('labels days', () => {
    const d = new Date(year, 9, 21, 12);
    expect(dayLabel(new Date(2026, 9, 21, 12))).toBe('Wed, Oct 21');
    expect(dayLabel(d)).toContain('Oct 21');
    expect(monthDay(d)).toBe('Oct 21');
    expect(monthShort(d)).toBe('Oct');
    expect(weekdayShort(new Date(2026, 9, 21, 12))).toBe('Wed');
  });
  it('adds the year when it is not this year', () => {
    expect(shortNight(`${year - 1}-10-21`)).toBe(`Oct 21, ${year - 1}`);
    expect(shortNight(`${year}-10-21`)).toBe('Oct 21');
    expect(nightLabel('2020-10-21')).toBe('Wed, Oct 21, 2020');
  });
  it('reads a night key at local noon', () => {
    const d = nightDate('2026-10-21');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 9, 21, 12,
    ]);
    expect(monthYear(d)).toBe('October 2026');
  });
});
