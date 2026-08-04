import LogLine from '../../parsing/LogLine';
import CombatLogWatcher from '../../parsing/CombatLogWatcher';

test('Basic Retail', async () => {
  const combatLogParser = new CombatLogWatcher('');
  let promiseResolve: (value: LogLine | PromiseLike<LogLine>) => void;

  const testLogLinePromise: Promise<LogLine> = new Promise((resolve) => {
    promiseResolve = resolve;
  });

  combatLogParser.on('ENCOUNTER_START', (line: LogLine) => {
    promiseResolve(line);
  });

  const encounterStartLine =
    '8/3 22:12:04.000  ENCOUNTER_START,9999,"Hogger",16,21,2481';

  combatLogParser.handleLogLine(encounterStartLine);

  const testLogLine = await testLogLinePromise;
  const expectedDate = new Date('2025-08-03T22:12:04');

  expect(testLogLine.date()).toStrictEqual(expectedDate);
  expect(testLogLine.type()).toBe('ENCOUNTER_START');
  expect(testLogLine.arg(1)).toBe('9999');
  expect(testLogLine.arg(2)).toBe('Hogger');
  expect(testLogLine.arg(3)).toBe('16');
  expect(testLogLine.arg(4)).toBe('21');
  expect(testLogLine.arg(5)).toBe('2481');
  expect(testLogLine.toString()).toBe(encounterStartLine);
});

test('Date Parsing', async () => {
  // Pre The War Within expansion there were note years or timezones.
  const preTWW = '8/3 22:12:04.000  ENCOUNTER_START,9999,"Hogger",16,21,2481';
  const parsedPreTWW = new LogLine(preTWW);
  const expectedPreTww = new Date('2025-08-03T22:12:04');
  expect(parsedPreTWW.date()).toStrictEqual(expectedPreTww);

  // Year but no TZ.
  const twwNoTZ =
    '7/28/2025 17:35:43.4931  ENCOUNTER_START,9999,"Hogger",16,21,2481';
  const parsedTwwNoTZ = new LogLine(twwNoTZ);
  const expectedTwwNoTZ = new Date('2025-07-28T17:35:43');
  expect(parsedTwwNoTZ.date()).toStrictEqual(expectedTwwNoTZ);

  // Year and TZ.
  const twwTz =
    '7/28/2025 14:37:54.790-4  ENCOUNTER_START,9999,"Hogger",16,21,2481';
  const parsedTwwTz = new LogLine(twwTz);
  const expectedTwwTz = new Date('2025-07-28T14:37:54');
  expect(parsedTwwTz.date()).toStrictEqual(expectedTwwTz);
});
