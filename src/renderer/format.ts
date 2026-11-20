/**
 * [RoomFortyRecorder] The one place numbers and durations are formatted, so
 * the same kind of value looks the same on every page. Dates and times of
 * day live next to it in `clock.ts`. Pure (no imports), so the Logs format
 * module, the Dashboard and the tests can all use it.
 *
 * Format at display time only: never round a value you calculate with.
 */

/**
 * Big numbers in a table or on a chart axis: 612.0k, 1.23m, 4.56b. Lower
 * case, one decimal for thousands, two for millions and billions.
 */
export const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

/**
 * `compact` for narrow labels: no decimals from 100 of a unit up ("123m"),
 * one below ("1.2m", "12.3k").
 */
export const compactShort = (n: number) => {
  const a = Math.abs(n);
  const unit = a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 0;
  if (!unit) return String(Math.round(n));
  const suffix = unit === 1e9 ? 'b' : unit === 1e6 ? 'm' : 'k';
  const v = n / unit;
  return `${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)}${suffix}`;
};

/** An exact whole number with thousands separators: 491,238. */
export const grouped = (n: number) =>
  Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** A share (0.123) as a percentage: "12.3%". */
export const ratioPercent = (fraction: number, digits = 1) =>
  `${(fraction * 100).toFixed(digits)}%`;

/** A value that is already a percentage (12.3): "12.3%"; a dash when unknown. */
export const percentValue = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? '–' : `${value.toFixed(digits)}%`;

/**
 * Boss health left: a whole number from 10% up ("13%"), one decimal below 10
 * when not whole ("0.4%", "4.8%", "5%"), and never "0%" for a value above 0
 * (that reads as a kill). A dash when unknown; "Kill" is the caller's.
 */
export const bossPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  if (value <= 0) return '0%';
  if (value >= 10) return `${Math.round(value)}%`;
  const tenth = Math.max(0.1, Math.round(value * 10) / 10);
  if (tenth >= 10) return '10%';
  return Number.isInteger(tenth) ? `${tenth}%` : `${tenth.toFixed(1)}%`;
};

/** `part` of `whole` as a percentage; a dash when there is no whole. */
export const pct = (part: number, whole: number, digits = 2) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '–';

/** A signed gap in percent: "+3.2%", "-1.0%". */
export const percentSigned = (value: number, digits = 1) =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;

/**
 * A length of time: m:ss under an hour (4:52, 12:05), h:mm:ss from an hour
 * (1:02:03). Fight clocks, pull lengths, video positions. Seconds are cut
 * (not rounded) so a clock never runs ahead of the fight. A negative time
 * (a pre-pull use) keeps its sign: -0:03.
 */
export const formatDuration = (seconds: number): string => {
  const total = Math.floor(Math.abs(seconds));
  if (seconds < 0 && total > 0) return `-${formatDuration(total)}`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
};

/** Like `formatDuration`, but seconds are rounded (chart axes, summed times). */
export const formatDurationRounded = (seconds: number) =>
  formatDuration(Math.round(Math.max(0, seconds)));

/** `formatDuration` with tenths: 4:52.3 (the spell timeline's fine ticks). */
export const formatDurationTenths = (seconds: number) => {
  const tenths = Math.round(Math.max(0, seconds) * 10) / 10;
  const m = Math.floor(tenths / 60);
  const s = (tenths - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** `formatDuration` with milliseconds: 4:52.307 (the event list). */
export const formatDurationMillis = (seconds: number) => {
  const sec = Math.max(0, seconds);
  const ms = String(Math.floor((sec % 1) * 1000)).padStart(3, '0');
  return `${formatDuration(sec)}.${ms}`;
};

/**
 * Zero-padded video positions: 04:52, 01:02:03. For the recordings list
 * and the video player, whose labels line up in a column.
 */
export const formatDurationPadded = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(total % 60)}`;
  return `${pad(m)}:${pad(total % 60)}`;
};

/** Spoken length: "45 min", "1 h 23 min", "2 h". */
export const formatDurationLong = (seconds: number) => {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/** File sizes: "12 MB", "1.4 GB". */
export const fileSize = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
