/**
 * [RoomFortyRecorder] Bug reports from the app's bug button.
 *
 * The app sends the text to the guild server (signed in with Discord); the
 * server posts it to one Discord channel. Raiders never get the webhook or
 * channel, so reports can only land where the owner pointed them:
 *  - GUILD_CLOUD_BUG_WEBHOOK: a webhook URL made on that channel (simplest), or
 *  - GUILD_CLOUD_BUG_CHANNEL_ID: the channel's ID, posted by the guild bot
 *    (needs Send Messages there).
 */

export const MAX_BUG_TEXT = 1500;
export const BUG_COOLDOWN_MS = 20 * 1000;

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .trim()
    .slice(0, max);

export const createBugReport = ({
  env = {},
  botToken = '',
  discordApi = 'https://discord.com/api/v10',
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) => {
  const webhook = String(env.GUILD_CLOUD_BUG_WEBHOOK || '').trim();
  const channel = String(env.GUILD_CLOUD_BUG_CHANNEL_ID || '').trim();
  const lastSent = new Map();

  const configured = () => Boolean(webhook || (channel && botToken));

  /** The Discord message for one report. */
  const message = ({ userName, text, version, page }) => {
    const head = [`**Bug report** from ${clean(userName, 64) || 'someone'}`];
    const v = clean(version, 32);
    const p = clean(page, 64);
    if (v) head.push(`v${v.replace(/^v/, '')}`);
    if (p) head.push(p);
    const body = clean(text, MAX_BUG_TEXT)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    return `${head.join(' · ')}\n${body}`.slice(0, 2000);
  };

  /** Returns { status, error? } for the HTTP reply. */
  const send = async ({ discordId, userName, text, version, page }) => {
    if (!configured()) {
      return { status: 404, error: 'Bug reports are not set up on the server' };
    }
    const body = clean(text, MAX_BUG_TEXT);
    if (body.length < 3) return { status: 400, error: 'Write a few words about the bug' };

    const key = String(discordId || userName || '');
    const last = lastSent.get(key);
    if (last !== undefined && now() - last < BUG_COOLDOWN_MS) {
      return { status: 429, error: 'Wait a few seconds before sending another report' };
    }

    const payload = {
      content: message({ userName, text: body, version, page }),
      allowed_mentions: { parse: [] },
    };
    const url = webhook
      ? webhook
      : `${discordApi}/channels/${encodeURIComponent(channel)}/messages`;
    const headers = { 'Content-Type': 'application/json' };
    if (!webhook) headers.Authorization = `Bot ${botToken}`;

    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(`[bug-report] Discord said ${response.status}`);
      return { status: 502, error: 'Discord did not accept the report' };
    }
    lastSent.set(key, now());
    console.log(`[bug-report] Report from ${clean(userName, 64)} sent`);
    return { status: 200 };
  };

  return { configured, message, send };
};
