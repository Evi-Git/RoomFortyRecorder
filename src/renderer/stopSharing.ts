/**
 * [RoomFortyRecorder] The "Stop sharing" button: when it shows and what it
 * says. Pure, so it can be tested. The fields come from the guild server's
 * video list and are about this person: `stopsLink` (they may stop the
 * recording's own public link), `stopsClips` (how many clips sent to Discord
 * they may stop) and `canStopSharing` (either). A missing `canStopSharing`
 * means an older server, which behaves as before: show while `shared`.
 */

type ShareState = {
  shared?: boolean;
  stopsLink?: boolean;
  stopsClips?: number;
  canStopSharing?: boolean;
};

const clipsText = (count: number) =>
  `${count} ${count === 1 ? 'clip' : 'clips'} sent to Discord`;

export const showStopSharing = (video: ShareState | undefined | null) => {
  if (!video) return false;
  if (video.canStopSharing === undefined) return Boolean(video.shared);
  return video.canStopSharing;
};

/** What a press takes down, for this person: "the public link and 2 clips…". */
const what = (link: boolean, clips: number) => {
  if (link && clips > 0)
    return { text: `the public link and ${clipsText(clips)}`, plural: true };
  if (clips > 0) return { text: clipsText(clips), plural: clips > 1 };
  return { text: 'the public link', plural: false };
};

/** Tooltip and accessible label of the button. */
export const stopSharingLabel = (video: ShareState | undefined | null) => {
  if (video?.canStopSharing === undefined) {
    return 'Stop sharing: the public link stops working';
  }
  const { text, plural } = what(
    Boolean(video.stopsLink),
    video.stopsClips ?? 0,
  );
  return `Stop sharing: ${text} ${plural ? 'stop' : 'stops'} working`;
};

/**
 * Toast text after the server answered: `removed` recording links and
 * `clips` clip links it took down (an older server only sends `removed`).
 */
export const stopSharingDone = (
  removed: number | undefined,
  clips: number | undefined,
) => {
  const c = clips ?? 0;
  // An older server that answered without `removed` stopped the link.
  const link = removed === undefined ? c === 0 : removed > 0;
  const { text, plural } = what(link, c);
  const subject = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return `${subject} no longer ${plural ? 'work' : 'works'}. Someone already watching can usually finish (up to 2 hours), and Discord may keep its copy of a posted clip for a while.`;
};

/**
 * The share state of one recording as the list last sent it. After a Stop
 * sharing press the player hides the button while this stays the same, so a
 * second press can't hit a refusal before the next list arrives.
 */
export const shareStateKey = (
  video: (ShareState & { videoName?: string }) | undefined | null,
) =>
  JSON.stringify([
    video?.videoName,
    video?.shared,
    video?.stopsLink,
    video?.stopsClips,
    video?.canStopSharing,
  ]);
