/**
 * [RoomFortyRecorder] Turns a raw error from the guild server or the
 * network into one line a raider can act on. The raw text stays available
 * ("Copy details") for bug reports.
 */
export const friendlyError = (raw: string | null | undefined) => {
  const text = String(raw ?? '').trim();
  if (!text) return 'Something went wrong.';
  if (/Unknown API route/i.test(text))
    return 'The guild server is older than this app: it needs update-server.cmd.';
  if (/Sign in with Discord|\b401\b/i.test(text))
    return 'Sign in with Discord in Cloud settings first.';
  if (/\b403\b|not allowed|forbidden/i.test(text))
    return "Your Discord roles don't allow this.";
  if (
    /ECONNREFUSED|ENOTFOUND|Could not reach|Network Error|socket hang up/i.test(
      text,
    )
  )
    return "Couldn't reach the guild server. It may be restarting; try again in a minute.";
  if (/timeout|ETIMEDOUT|timed out/i.test(text))
    return 'The guild server took too long to answer.';
  if (/\b50[234]\b/.test(text))
    return 'The guild server is down or restarting.';
  return text;
};
