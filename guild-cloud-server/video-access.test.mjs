import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canChangeVideo,
  backfillChatOwners,
  canDeleteMessage,
  createChangeCheck,
  ownsMessage,
  ownsVideo,
  roleRecheck,
  splitByAccess,
  stampVideo,
} from './video-access.mjs';

test('a stamped video is its uploader\'s own; an unstamped one is nobody\'s', () => {
  assert.equal(ownsVideo({ uploadedBy: '5' }, '5'), true);
  assert.equal(ownsVideo({ uploadedBy: '5' }, '6'), false);
  assert.equal(ownsVideo({ videoName: 'old' }, '5'), false);
  assert.equal(ownsVideo({ uploadedBy: '' }, ''), false);
  assert.equal(ownsVideo({ uploadedBy: '5' }, undefined), false);
  assert.equal(ownsVideo(undefined, '5'), false);
});

test('only the uploader or a manager may change a video', () => {
  assert.equal(canChangeVideo({ uploadedBy: '5' }, '5', false), true);
  assert.equal(canChangeVideo({ uploadedBy: '5' }, '6', false), false);
  assert.equal(canChangeVideo({ uploadedBy: '5' }, '6', true), true);
  assert.equal(canChangeVideo({}, '5', false), false);
  assert.equal(canChangeVideo({}, '5', true), true);
});

test('the manager lookup only runs for videos that are not the caller\'s, and once', async () => {
  let lookups = 0;
  const check = createChangeCheck('5', async () => {
    lookups += 1;
    return false;
  });
  assert.equal(await check({ uploadedBy: '5' }), true);
  assert.equal(lookups, 0);
  assert.equal(await check({ uploadedBy: '6' }), false);
  assert.equal(await check({}), false);
  assert.equal(lookups, 1);
});

test('a bulk request splits into allowed and refused', async () => {
  const mine = { videoName: 'a', uploadedBy: '5' };
  const theirs = { videoName: 'b', uploadedBy: '6' };
  const old = { videoName: 'c' };
  const videos = [mine, theirs, old];

  const plain = await splitByAccess(videos, createChangeCheck('5', async () => false));
  assert.deepEqual(plain.allowed, [mine]);
  assert.deepEqual(plain.refused, [theirs, old]);

  const officer = await splitByAccess(videos, createChangeCheck('9', async () => true));
  assert.deepEqual(officer.allowed, videos);
  assert.deepEqual(officer.refused, []);

  assert.deepEqual(await splitByAccess([], createChangeCheck('5', async () => false)), {
    allowed: [],
    refused: [],
  });
});

test('stamping ignores what the client sent and keeps the first owner', () => {
  const forged = { videoKey: 'k.mp4', videoName: 'n', uploadedBy: 'evil', uploadedByName: 'Evil' };
  assert.deepEqual(stampVideo(forged, undefined, '5', 'Evi'), {
    videoKey: 'k.mp4',
    videoName: 'n',
    uploadedBy: '5',
    uploadedByName: 'Evi',
  });
  const owned = { uploadedBy: '5', uploadedByName: 'Evi' };
  const replaced = stampVideo(forged, owned, '9', 'Officer');
  assert.equal(replaced.uploadedBy, '5');
  assert.equal(replaced.uploadedByName, 'Evi');
  // An old entry stays unowned, and the client can't claim it.
  const old = stampVideo(forged, { videoKey: 'k.mp4' }, '9', 'Officer');
  assert.equal('uploadedBy' in old, false);
  assert.equal('uploadedByName' in old, false);
});

test('a chat message is its writer\'s by Discord id only', () => {
  assert.equal(ownsMessage({ discordId: '5', userName: 'Evi' }, '5'), true);
  assert.equal(ownsMessage({ discordId: '5', userName: 'Evi' }, '6'), false);
  // A name proves nothing: anyone can rename themselves.
  assert.equal(ownsMessage({ userName: 'Evi' }, '6'), false);
  assert.equal(ownsMessage({}, '6'), false);
});

test('moderators delete anyone\'s message', () => {
  assert.equal(canDeleteMessage({ discordId: '5' }, '6', false), false);
  assert.equal(canDeleteMessage({ discordId: '5' }, '6', true), true);
  assert.equal(canDeleteMessage({ discordId: '6' }, '6', false), true);
  assert.equal(canDeleteMessage({ userName: 'Bob' }, '6', false), false);
});

test('the chat backfill names a writer only when one known user has that name', () => {
  const make = () => ({
    knownUsers: {
      1: { userName: 'Evi' },
      2: { userName: 'Twin' },
      3: { userName: 'Twin' },
    },
    chats: [
      {
        correlator: 'c',
        messages: [
          { id: 1, userName: 'Evi' },
          { id: 2, userName: 'Twin' },
          { id: 3, userName: 'Gone' },
          { id: 4, userName: 'Evi', discordId: '9' },
        ],
      },
    ],
  });
  const state = make();
  assert.equal(backfillChatOwners(state), true);
  assert.deepEqual(
    state.chats[0].messages.map((m) => m.discordId),
    ['1', undefined, undefined, '9'],
  );
  assert.equal(state.chatOwnersBackfilled, true);

  // Done once: later runs change nothing, even if a user appeared since.
  state.knownUsers[4] = { userName: 'Gone' };
  assert.equal(backfillChatOwners(state), false);
  assert.equal(state.chats[0].messages[2].discordId, undefined);

  const flagged = { ...make(), chatOwnersBackfilled: true };
  assert.equal(backfillChatOwners(flagged), false);
  assert.equal(flagged.chats[0].messages[0].discordId, undefined);
});

test('the role re-check', () => {
  const allowedRoles = ['raider', 'officer'];
  const ok = { ok: true };
  assert.deepEqual(roleRecheck({ isOwner: true, roleNames: [], allowedRoles }), ok);
  assert.deepEqual(roleRecheck({ isOwner: false, roleNames: ['everyone', 'Raider'], allowedRoles }), ok);
  assert.deepEqual(roleRecheck({ isOwner: false, roleNames: ['trial'], allowedRoles }).ok, false);
  // Not a member any more.
  const gone = roleRecheck({ isOwner: false, roleNames: [], allowedRoles });
  assert.equal(gone.ok, false);
  assert.match(gone.message, /no longer allow access/);
  // Discord unreachable, nothing cached: fail open.
  assert.deepEqual(roleRecheck({ isOwner: false, roleNames: null, allowedRoles }), ok);
  // No sign-in roles configured: nothing to re-check.
  assert.deepEqual(roleRecheck({ isOwner: false, roleNames: [], allowedRoles: [] }), ok);
});
