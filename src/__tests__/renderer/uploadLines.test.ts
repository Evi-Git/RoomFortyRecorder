import type { PullUploadState } from '../../main/types';
import { describeBackfill, describeUpload } from '../../renderer/uploadLines';

const at = new Date(2026, 10, 10, 21, 41).getTime();
const base: PullUploadState = {
  state: 'sent',
  encounterName: "Kith'ix",
  difficultyId: 16,
  result: 'wipe',
  at,
};

test('every state has a line, and the tone fits', () => {
  const tones = (
    [
      'waiting',
      'uploading',
      'sent',
      'otherRaider',
      'undecided',
      'skipped',
      'notSignedIn',
      'failed',
    ] as const
  ).map((state) => describeUpload({ ...base, state }).tone);
  expect(tones).toEqual([
    'busy',
    'busy',
    'good',
    'quiet',
    'quiet',
    'quiet',
    'warn',
    'bad',
  ]);
});

test('lines name the pull, its time and the reason', () => {
  expect(describeUpload(base).text).toBe(
    "Kith'ix wipe (9:41 PM): your log was used.",
  );
  expect(
    describeUpload({
      ...base,
      state: 'failed',
      error: 'Guild server answered 502',
    }).text,
  ).toContain('(Guild server answered 502)');
});

test('backfill line', () => {
  expect(describeBackfill(null)).toBeNull();
  expect(describeBackfill({ at, uploaded: 2, files: 1 })).toBe(
    'Saved combat logs checked at 9:41 PM: sent 2 missing pulls.',
  );
  expect(describeBackfill({ at, uploaded: 0, files: 1 })).toContain(
    'nothing was missing',
  );
});
