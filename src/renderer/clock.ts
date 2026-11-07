/**
 * [RoomFortyRecorder] Times of day on a 12-hour clock ("9:05 PM"), in the
 * PC's own time zone (the Windows setting; JavaScript dates use it). The
 * English (US) format is set on purpose: with the system's locale, a PC set
 * to English (UK) shows a 24-hour clock.
 */

type When = number | Date;

const toDate = (at: When) => (at instanceof Date ? at : new Date(at));

/** "9:05 PM", or "9:05:12 PM" with seconds. */
export const timeOfDay = (at: When, opts: { seconds?: boolean } = {}) =>
  toDate(at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hour12: true,
  });

/** "Nov 7" (with the year when it isn't this year: "Nov 7, 2025"). */
export const shortDate = (at: When) => {
  const d = toDate(at);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' }
      : {}),
  });
};

/** "Nov 7, 9:05 PM". */
export const dateTime = (at: When, opts: { seconds?: boolean } = {}) =>
  `${shortDate(at)}, ${timeOfDay(at, opts)}`;
