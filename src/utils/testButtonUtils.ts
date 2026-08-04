import { VideoCategory } from '../types/VideoCategory';
import Poller from './Poller';
import { testDataRaid, testDataDungeon } from './testButtonData';
import CombatLogWatcher from '../parsing/CombatLogWatcher';

let testRunning = false;

const sendTestCombatLogLine = (
  watcher: CombatLogWatcher,
  line: string,
): void => {
  console.debug(
    '[test] Sending test combat log line to the Combat Log Parser',
    line,
  );

  watcher.handleLogLine(line);
};

/**
 * Return a combatlog formatted timestamp representing the current date/time
 * adjusted acording to `seconds` (which can be negative).
 */
const getAdjustedDate = (seconds = 0): string => {
  const now = new Date(new Date().getTime() + seconds * 1000);
  return `${now.getMonth() + 1}/${now.getDate()} ${now.toLocaleTimeString(
    'en-GB',
  )}.${now.getMilliseconds().toString().padStart(3, '0')}`;
};

/**
 * Function to invoke if the user clicks the "run a test" button
 * in the GUI. Uses sample retail raid and Mythic+ log lines.
 */
export const runRetailRecordingTest = (
  category: VideoCategory,
  watcher: CombatLogWatcher,
  endTest = true,
) => {
  console.info('[test] User pressed the test button!');

  if (!endTest) {
    console.info(
      '[test] The test will NOT end on its own and needs to be stopped manually.',
    );
  }

  if (testRunning) {
    console.info('[test] Test already running, not starting test.');
    return;
  }

  if (!Poller.getInstance().isWowRunning()) {
    console.info("[test] WoW isn't running, not starting test.");
    return;
  }

  console.info('[test] WoW is running, starting test.');
  testRunning = true;
  const startDate = getAdjustedDate();
  let testLines: string[];
  let testDuration = 5;

  // We need to use slice here or we end up with a reference and we lose a
  // line on each subsequent .pop() and click of the test button.
  if (category === VideoCategory.Raids) {
    // Run a longer test as the default is to throw away a raid encounter < 15s.
    testDuration = 20;
    testLines = testDataRaid.slice();
  } else if (category === VideoCategory.MythicPlus) {
    testLines = testDataDungeon.slice();
  } else {
    testLines = [];
  }

  const endDate = getAdjustedDate(testDuration);
  const testEndLine = `${endDate}  ${testLines[testLines.length - 1]}`;
  testLines.pop();

  testLines.forEach((line) => {
    const lineWithDate = `${startDate}  ${line}`;
    sendTestCombatLogLine(watcher, lineWithDate);
  });

  if (!endTest) {
    return;
  }

  setTimeout(() => {
    sendTestCombatLogLine(watcher, testEndLine);
    testRunning = false;
  }, testDuration * 1000);
};
