import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVATION_TTL_MS,
  expired,
  heldByOther,
  isReserved,
  ownReservation,
  release,
  reserve,
} from './upload-reservations.mjs';

const NOW = 1_700_000_000_000;
const mine = { key: 'a.mp4', userId: '1', userName: 'Evi', bytes: 500, now: NOW };

test('a reservation lasts a day, far longer than the one-hour upload URL', () => {
  assert.equal(RESERVATION_TTL_MS, 24 * 60 * 60 * 1000);
  const r = {};
  assert.deepEqual(reserve(r, mine), {
    userId: '1',
    userName: 'Evi',
    bytes: 500,
    at: NOW,
    expiresAt: NOW + RESERVATION_TTL_MS,
  });
  assert.equal(r['a.mp4'].bytes, 500);
});

test('only the member who reserved a key owns it; everyone else is held off', () => {
  const r = {};
  reserve(r, mine);
  assert.ok(ownReservation(r, 'a.mp4', '1', NOW + 1000));
  assert.equal(ownReservation(r, 'a.mp4', 1, NOW + 1000)?.bytes, 500); // ids compare as text
  assert.equal(ownReservation(r, 'a.mp4', '2', NOW + 1000), null);
  assert.equal(ownReservation(r, 'b.mp4', '1', NOW + 1000), null);
  assert.equal(ownReservation(r, 'a.mp4', '', NOW), null);
  assert.equal(heldByOther(r, 'a.mp4', '2', NOW + 1000), true);
  assert.equal(heldByOther(r, 'a.mp4', '1', NOW + 1000), false);
  assert.equal(heldByOther(r, 'b.mp4', '2', NOW + 1000), false);
  assert.equal(isReserved(r, 'a.mp4', NOW + 1000), true);
});

test('names that exist on every object are not keys', () => {
  const r = {};
  assert.equal(ownReservation(r, 'constructor', '1', NOW), null);
  assert.equal(heldByOther(r, 'toString', '1', NOW), false);
  assert.equal(isReserved(r, '__proto__', NOW), false);
});

test('an expired reservation is nobody\'s, and anyone may take the key over', () => {
  const r = {};
  reserve(r, mine);
  const later = NOW + RESERVATION_TTL_MS;
  assert.equal(ownReservation(r, 'a.mp4', '1', later), null);
  assert.equal(heldByOther(r, 'a.mp4', '2', later), false);
  assert.equal(isReserved(r, 'a.mp4', later), false);
  assert.equal(heldByOther(r, 'a.mp4', '2', later - 1), true);
  reserve(r, { ...mine, userId: '2', userName: 'Bob', bytes: 9, now: later });
  assert.equal(ownReservation(r, 'a.mp4', '2', later + 1)?.bytes, 9);
  assert.equal(heldByOther(r, 'a.mp4', '1', later + 1), true);
});

test('the same member asking again replaces their reservation', () => {
  const r = {};
  reserve(r, mine);
  reserve(r, { ...mine, bytes: 800, now: NOW + 5000 });
  assert.equal(Object.keys(r).length, 1);
  assert.equal(r['a.mp4'].bytes, 800);
  assert.equal(r['a.mp4'].expiresAt, NOW + 5000 + RESERVATION_TTL_MS);
});

test('release removes a reservation', () => {
  const r = {};
  reserve(r, mine);
  release(r, 'a.mp4');
  assert.deepEqual(r, {});
  release(r, 'a.mp4'); // nothing there: fine
});

test('expired() returns and removes only the expired ones', () => {
  const r = {};
  reserve(r, { ...mine, key: 'old.mp4', now: NOW });
  reserve(r, { ...mine, key: 'fresh.mp4', now: NOW + RESERVATION_TTL_MS });
  r['broken.mp4'] = null;
  r['odd.mp4'] = { userId: '3' }; // no expiry
  const gone = expired(r, NOW + RESERVATION_TTL_MS + 1);
  assert.deepEqual(gone.map((e) => e.key).sort(), ['broken.mp4', 'odd.mp4', 'old.mp4']);
  assert.equal(gone.find((e) => e.key === 'old.mp4').userId, '1');
  assert.deepEqual(Object.keys(r), ['fresh.mp4']);
  assert.deepEqual(expired(r, NOW + RESERVATION_TTL_MS + 1), []);
});
