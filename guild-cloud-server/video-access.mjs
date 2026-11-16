// [RoomFortyRecorder] Who may change a recording or a chat message, and who
// still counts as a guild member. Pure rules; server.mjs supplies the
// session and the (possibly slow) Discord permission lookups.
//
// A recording is its uploader's own once the server has stamped it with
// `uploadedBy`. Recordings from before the stamp belong to nobody, so only
// someone with "Manage anyone's recordings" may change them.

const same = (a, b) => a != null && b != null && String(a) !== '' && String(a) === String(b);

/** Did this person upload the recording? (Needs the server's stamp.) */
export const ownsVideo = (video, userId) => same(video?.uploadedBy, userId);

/** Own recording, or `hasManage`. */
export const canChangeVideo = (video, userId, hasManage) =>
  ownsVideo(video, userId) || hasManage === true;

/**
 * A change check for one request. `hasManage` may call Discord, so it only
 * runs when a recording isn't the caller's own, and only once.
 * @param {string} userId
 * @param {() => Promise<boolean>} hasManage
 */
export const createChangeCheck = (userId, hasManage) => {
  let manage = null;
  return async (video) => {
    if (ownsVideo(video, userId)) return true;
    manage ??= Promise.resolve(hasManage()).then((value) => value === true);
    return manage;
  };
};

/** Splits recordings into those the caller may change and those refused. */
export const splitByAccess = async (videos, mayChange) => {
  const allowed = [];
  const refused = [];
  for (const video of videos) (await mayChange(video) ? allowed : refused).push(video);
  return { allowed, refused };
};

/**
 * The ownership stamp for a stored recording. The client's own values are
 * never kept. A replaced entry keeps its original owner (or none).
 */
export const stampVideo = (body, existing, userId, userName) => {
  const { uploadedBy, uploadedByName, ...rest } = body;
  if (!existing) return { ...rest, uploadedBy: userId, uploadedByName: userName };
  const stamped = { ...rest };
  if (existing.uploadedBy) stamped.uploadedBy = existing.uploadedBy;
  if (existing.uploadedByName) stamped.uploadedByName = existing.uploadedByName;
  return stamped;
};

/**
 * Is this chat message the caller's own? Only the stored Discord id counts:
 * display names are free to change.
 */
export const ownsMessage = (message, userId) => same(message?.discordId, userId);

export const canDeleteMessage = (message, userId, hasModerate) =>
  ownsMessage(message, userId) || hasModerate === true;

/**
 * One-time fill of `discordId` on chat messages written before the server
 * stored it: only when exactly one known user has that name. Anything else
 * stays unowned (officers only). Returns true when it changed `state`, so
 * the caller saves; once `chatOwnersBackfilled` is set it never runs again.
 */
export const backfillChatOwners = (state) => {
  if (state.chatOwnersBackfilled) return false;
  const byName = new Map();
  for (const [discordId, info] of Object.entries(state.knownUsers ?? {})) {
    const name = info?.userName;
    if (!name) continue;
    byName.set(name, byName.has(name) ? null : discordId);
  }
  for (const chat of state.chats ?? []) {
    for (const message of chat.messages ?? []) {
      if (message.discordId) continue;
      const owner = byName.get(message.userName);
      if (owner) message.discordId = owner;
    }
  }
  state.chatOwnersBackfilled = true;
  return true;
};

/**
 * Does a signed-in member still qualify? Discord roles are otherwise only
 * checked at sign-in, and sessions last 30 days.
 * `roleNames` is lower-case and null when Discord can't be reached with
 * nothing cached: that passes, so an outage doesn't sign everyone out.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export const roleRecheck = ({ isOwner, roleNames, allowedRoles }) => {
  if (isOwner) return { ok: true };
  if (roleNames === null || roleNames === undefined) return { ok: true };
  if (!allowedRoles?.length) return { ok: true };
  if (roleNames.some((name) => allowedRoles.includes(String(name).toLowerCase()))) return { ok: true };
  return {
    ok: false,
    message: 'Your Discord roles no longer allow access. Sign in again after an officer fixes your roles.',
  };
};
