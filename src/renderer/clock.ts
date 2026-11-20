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

/** YYYY-MM-DD (a raid night, a calendar key) → a local Date at noon. */
export const nightDate = (night: string) => {
  const [y, m, d] = night.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

const yearIfOld = (d: Date) =>
  d.getFullYear() !== new Date().getFullYear()
    ? { year: 'numeric' as const }
    : {};

/** "Wed, Oct 21" (with the year when it isn't this year). */
export const dayLabel = (at: When) => {
  const d = toDate(at);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...yearIfOld(d),
  });
};

/** "Oct 21", never with the year (ranges that name the year once). */
export const monthDay = (at: When) =>
  toDate(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "Oct". */
export const monthShort = (at: When) =>
  toDate(at).toLocaleDateString('en-US', { month: 'short' });

/** "October 2026". */
export const monthYear = (at: When) =>
  toDate(at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** "Wed". */
export const weekdayShort = (at: When) =>
  toDate(at).toLocaleDateString('en-US', { weekday: 'short' });

/** A raid night (YYYY-MM-DD) as "Wed, Oct 21". */
export const nightLabel = (night: string) => dayLabel(nightDate(night));

/** A raid night (YYYY-MM-DD) as "Oct 21" ("Oct 21, 2025" in another year). */
export const shortNight = (night: string) => shortDate(nightDate(night));
