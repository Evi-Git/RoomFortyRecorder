// [RoomFortyRecorder] Who asked for an upload URL, per recording key. Pure
// rules with no I/O; server.mjs keeps the object at `state.uploadReservations`
// (key -> { userId, userName, bytes, at, expiresAt }) and saves it.
//
// The app asks for a URL (POST /upload), sends the file straight to R2, then
// registers it (POST /video). A recording can only be registered by the
// member holding the reservation for its key, and the file that landed in R2
// is checked against the size they declared. A reservation nobody used is
// how the server finds an abandoned upload to delete.

/**
 * How long a reservation lasts. It must outlive the slowest multi-GB upload,
 * so it is NOT the one-hour life of the presigned URL.
 */
export const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

const has = (reservations, key) => Object.hasOwn(reservations, key);
const same = (a, b) => a != null && b != null && String(a) !== '' && String(a) === String(b);
const isLive = (entry, now) => Number.isFinite(entry?.expiresAt) && entry.expiresAt > now;

/** Records (or overwrites) a member's reservation for `key`. Returns it. */
export const reserve = (reservations, { key, userId, userName, bytes, now }) => {
  const entry = { userId, userName, bytes, at: now, expiresAt: now + RESERVATION_TTL_MS };
  reservations[key] = entry;
  return entry;
};

/** The caller's own live reservation for `key`, or null. */
export const ownReservation = (reservations, key, userId, now) => {
  if (!has(reservations, key)) return null;
  const entry = reservations[key];
  return isLive(entry, now) && same(entry.userId, userId) ? entry : null;
};

/** Does another member hold a live reservation for `key`? */
export const heldByOther = (reservations, key, userId, now) => {
  if (!has(reservations, key)) return false;
  const entry = reservations[key];
  return isLive(entry, now) && !same(entry.userId, userId);
};

/** Is there any live reservation for `key`? */
export const isReserved = (reservations, key, now) =>
  has(reservations, key) && isLive(reservations[key], now);

/** Drops the reservation for `key`. */
export const release = (reservations, key) => {
  delete reservations[key];
};

/**
 * Removes every expired reservation and returns them as `{ key, ...entry }`.
 * A malformed entry counts as expired.
 */
export const expired = (reservations, now) => {
  const gone = [];
  for (const key of Object.keys(reservations)) {
    const entry = reservations[key];
    if (isLive(entry, now)) continue;
    gone.push({ key, ...(entry && typeof entry === 'object' ? entry : {}) });
    delete reservations[key];
  }
  return gone;
};
