/**
 * [RoomFortyRecorder] The "Stop sharing" button: when it shows and what it
 * says. Pure, so it can be tested. `shared`, `clipLinks` and `canStopSharing`
 * come from the guild server's video list; a missing `canStopSharing` means
 * an older server, which then behaves as before (show while `shared`).
 */

type ShareState = {
  shared?: boolean;
  clipLinks?: number;
  canStopSharing?: boolean;
};

const clipsText = (count: number) =>
  `${count} ${count === 1 ? 'clip' : 'clips'} sent to Discord`;

export const showStopSharing = (video: ShareState | undefined | null) => {
  if (!video) return false;
  const clips = video.clipLinks ?? 0;
  return Boolean(video.shared || clips > 0) && video.canStopSharing !== false;
};

/** Tooltip and accessible label of the button. */
export const stopSharingLabel = (video: ShareState | undefined | null) => {
  const clips = video?.clipLinks ?? 0;
  if (clips < 1) return 'Stop sharing: the public link stops working';
  const what = video?.shared ? 'the public link and ' : '';
  const verb = clips === 1 && !video?.shared ? 'stops' : 'stop';
  return `Stop sharing: ${what}${clipsText(clips)} ${verb} working`;
};

/** Toast text after the server answered; `clips` is how many it took down. */
export const stopSharingDone = (clips: number | undefined) => {
  const n = clips ?? 0;
  const subject =
    n > 0
      ? `The public link and ${clipsText(n)} no longer work.`
      : 'The public link no longer works.';
  return `${subject} Someone already watching can usually finish (up to 2 hours), and Discord may keep its copy of a posted clip for a while.`;
};
