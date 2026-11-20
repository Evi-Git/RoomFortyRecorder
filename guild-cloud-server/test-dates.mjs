// Test helper (not part of the server): the pull-desk tests were written
// with fixed dates around Oct 21, 2026. The server prunes logs after 30 days
// and lists at most 120 days of pulls, so fixed dates turn into failures as
// time passes. These helpers move every test date forward by whole weeks so
// the latest one is 8–14 days ago, keeping weekdays, times of day and the
// gaps between dates exactly as written.

const DAY = 86400000;
const BASE = Date.UTC(2026, 9, 21); // the latest date the tests use
const now = new Date();
const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

export const SHIFT_DAYS = Math.max(0, Math.floor((today - 8 * DAY - BASE) / (7 * DAY))) * 7;

/** '2026-10-21' → the same weekday, SHIFT_DAYS later, as 'YYYY-MM-DD'. */
export const night = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + SHIFT_DAYS * DAY).toISOString().slice(0, 10);
};

/** '2026-10-21T20:05:00' (local time) → ms, on the shifted night. */
export const at = (local) => {
  const [ymd, hm] = local.split('T');
  return Date.parse(`${night(ymd)}T${hm}`);
};
