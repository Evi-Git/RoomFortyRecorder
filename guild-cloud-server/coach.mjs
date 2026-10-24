// Coaching: "flag this moment" from Watch live, and sending any recording or
// clip to a Discord text channel as a share link (Discord embeds the video,
// so there's no file-size limit).
//
// Who can send where:
//   - Officers (GUILD_CLOUD_COACH_OFFICER_ROLES, default "Officer") can send
//     to any text channel and edit the member -> personal channel list.
//   - Everyone else can only send to their own personal channel.
//
// Routes, under /api/guild/<guild>/pulldesk/coach/:
//   GET    config            who you are, the channels you may send to,
//                            and (officers) the mapping and member list
//   PUT    mapping           officers: [{ discordId, name, channelId }]
//   POST   send              { videoName, channelId, note, at, title }
//   GET    flags?days=7      flags, newest first
//   POST   flags             { streamer, at (epoch ms), note }
//   PATCH  flags/<id>        { note }  (your own flag, or officers)
//   DELETE flags/<id>        (your own flag, or officers)
//
// Stored in <storage>/coach.json.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CACHE_MS = 5 * 60 * 1000;
const MAX_NOTE = 500;
const MAX_FLAGS = 5000;
const FLAG_DAYS_KEPT = 120;

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const isSnowflake = (value) => /^\d{5,25}$/.test(String(value || ''));

const mmss = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const createCoach = ({
  storage,
  readBody,
  json,
  fail,
  memberRoleNames,
  botToken,
  discordGuildId,
  createShareLink,
  publicUrl,
  env,
  can = null,
}) => {
  const file = path.join(storage, 'coach.json');
  // Preview frames for sent clips: <storage>/coach-thumbs/<link id>.jpg
  const thumbDir = path.join(storage, 'coach-thumbs');
  const thumbFile = (linkId) => path.join(thumbDir, `${String(linkId).replace(/[^A-Za-z0-9_-]/g, '')}.jpg`);
  const discordApi = env.GUILD_CLOUD_COACH_DISCORD_API || 'https://discord.com/api/v10';
  const officerRoles = String(env.GUILD_CLOUD_COACH_OFFICER_ROLES ?? 'Officer')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  let data = { flags: [], channels: {}, users: {} };
  let loaded = null;
  let saveQueue = Promise.resolve();

  const ready = () => {
    loaded ??= (async () => {
      try {
        const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
        data = {
          flags: Array.isArray(parsed.flags) ? parsed.flags : [],
          channels: parsed.channels && typeof parsed.channels === 'object' ? parsed.channels : {},
          users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
        };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    })();
    return loaded;
  };

  const persist = () => {
    const cutoff = Date.now() - FLAG_DAYS_KEPT * 86400000;
    data.flags = data.flags.filter((flag) => flag.at >= cutoff).slice(-MAX_FLAGS);
    const body = JSON.stringify(data);
    saveQueue = saveQueue.then(async () => {
      await fsp.mkdir(storage, { recursive: true });
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, body);
      await fsp.rename(tmp, file);
    });
    return saveQueue;
  };

  // `capability` is the permissions.mjs key; without it, the .env roles.
  const isOfficer = async (req, capability) => {
    if (can) return can(req, capability);
    if (!officerRoles.length) return true;
    const names = await memberRoleNames(req.cloudUserId);
    return Boolean(names?.some((name) => officerRoles.includes(name)));
  };

  const discord = async (method, route, body) => {
    const response = await fetch(`${discordApi}${route}`, {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { ok: response.ok, status: response.status, data: parsed };
  };

  // Text channels in the server, with their category names.
  let channelCache = { at: 0, list: [] };
  const guildChannels = async () => {
    if (Date.now() - channelCache.at < CACHE_MS && channelCache.list.length) {
      return channelCache.list;
    }
    const result = await discord('GET', `/guilds/${encodeURIComponent(discordGuildId)}/channels`);
    if (!result.ok || !Array.isArray(result.data)) {
      throw new Error(`Discord channel list failed (${result.status})`);
    }
    const categories = new Map(
      result.data.filter((c) => c.type === 4).map((c) => [c.id, { name: c.name, position: c.position }]),
    );
    const list = result.data
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({
        id: c.id,
        name: c.name,
        category: categories.get(c.parent_id)?.name || '',
        order: [categories.get(c.parent_id)?.position ?? -1, c.position ?? 0],
      }))
      .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
      .map(({ order, ...rest }) => rest);
    channelCache = { at: Date.now(), list };
    return list;
  };

  // Server members for the mapping list. Needs the bot's Server Members
  // intent; without it, falls back to people who have used the app.
  let memberCache = { at: 0, list: null };
  const guildMembers = async () => {
    if (Date.now() - memberCache.at < CACHE_MS && memberCache.list) return memberCache.list;
    let list = null;
    try {
      const result = await discord(
        'GET',
        `/guilds/${encodeURIComponent(discordGuildId)}/members?limit=1000`,
      );
      if (result.ok && Array.isArray(result.data)) {
        list = result.data
          .filter((m) => m.user && !m.user.bot)
          .map((m) => ({
            discordId: m.user.id,
            name: m.nick || m.user.global_name || m.user.username,
          }));
      }
    } catch {
      list = null;
    }
    if (!list) {
      list = Object.entries(data.users).map(([discordId, user]) => ({
        discordId,
        name: user.name,
      }));
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    memberCache = { at: Date.now(), list };
    return list;
  };

  const seen = (req) => {
    if (!req.cloudUserId) return;
    const before = data.users[req.cloudUserId];
    if (before?.name === req.cloudUserName && Date.now() - (before.seenAt || 0) < 86400000) return;
    data.users[req.cloudUserId] = { name: req.cloudUserName, seenAt: Date.now() };
    persist();
  };

  const flagView = (flag) => ({
    id: flag.id,
    at: flag.at,
    streamer: flag.streamer,
    by: flag.by,
    byId: flag.byId,
    note: flag.note || '',
  });

  const handle = async (req, res, rest, url) => {
    await ready();
    seen(req);
    const [first, second] = rest;

    if (first === 'config' && req.method === 'GET') {
      const officer = await isOfficer(req, 'clipSendAny');
      const mapper = await isOfficer(req, 'clipChannels');
      const mine = data.channels[req.cloudUserId]?.channelId || '';
      let channels = [];
      let channelError = '';
      try {
        const all = await guildChannels();
        channels = officer ? all : all.filter((c) => c.id === mine);
        if (!officer && mine && !channels.length) channels = [{ id: mine, name: 'your channel', category: '' }];
      } catch (error) {
        channelError = error.message;
        if (mine) channels = [{ id: mine, name: 'your channel', category: '' }];
      }
      const personal = Object.entries(data.channels).map(([discordId, entry]) => ({
        discordId,
        name: entry.name,
        channelId: entry.channelId,
      }));
      return json(res, 200, {
        officer,
        canMapChannels: mapper,
        me: { discordId: req.cloudUserId, name: req.cloudUserName },
        myChannel: mine,
        channels,
        channelError,
        // Personal channels are labelled with their raider in the dropdown.
        personal: officer || mapper ? personal : personal.filter((p) => p.discordId === req.cloudUserId),
        members: mapper ? await guildMembers() : [],
      });
    }

    if (first === 'mapping' && req.method === 'PUT') {
      if (!(await isOfficer(req, 'clipChannels'))) return fail(res, 403, 'Your Discord role cannot edit personal channels');
      const body = await readBody(req, 256 * 1024);
      if (!Array.isArray(body?.mapping)) return fail(res, 400, 'Expected { mapping: [...] }');
      const next = {};
      for (const row of body.mapping) {
        if (!isSnowflake(row?.discordId) || !isSnowflake(row?.channelId)) continue;
        next[row.discordId] = { name: clean(row.name, 80) || row.discordId, channelId: row.channelId };
      }
      data.channels = next;
      await persist();
      return json(res, 200, { ok: true, count: Object.keys(next).length });
    }

    if (first === 'send' && req.method === 'POST') {
      // Room for the preview frame (a JPEG, base64) the app sends along.
      const body = await readBody(req, 1024 * 1024);
      const channelId = String(body?.channelId || '');
      if (!isSnowflake(channelId)) return fail(res, 400, 'Pick a channel');
      const officer = await isOfficer(req, 'clipSendAny');
      if (!officer && data.channels[req.cloudUserId]?.channelId !== channelId) {
        return fail(res, 403, 'You can only send clips to your own channel');
      }
      if (!officer && can && !(await can(req, 'clipSendOwn'))) {
        return fail(res, 403, 'Your Discord role cannot send clips');
      }
      const link = await createShareLink(String(body?.videoName || ''));
      if (!link) return fail(res, 404, 'That video is not in the guild cloud. Upload it first.');

      // The app sends the frame being coached as the link's preview image.
      if (typeof body?.thumbnail === 'string' && body.thumbnail.length < 700 * 1024) {
        const jpeg = Buffer.from(body.thumbnail, 'base64');
        if (jpeg[0] === 0xff && jpeg[1] === 0xd8) {
          await fsp.mkdir(thumbDir, { recursive: true });
          await fsp.writeFile(thumbFile(link.id), jpeg);
        }
      }

      const at = Number(body?.at);
      const hasAt = Number.isFinite(at) && at > 0;
      const note = clean(body?.note, MAX_NOTE);
      const title = clean(body?.title, 150);
      const linkUrl = `${publicUrl || ''}/link/${encodeURIComponent(link.id)}${hasAt ? `?t=${Math.floor(at)}` : ''}`;
      const lines = [
        `🎬 **${clean(req.cloudUserName, 80)}** sent a clip${title ? `: ${title}` : ''}${hasAt ? ` (watch from ${mmss(at)})` : ''}`,
        note ? `> ${note.replace(/\n/g, '\n> ')}` : '',
        linkUrl,
      ].filter(Boolean);

      const result = await discord('POST', `/channels/${encodeURIComponent(channelId)}/messages`, {
        content: lines.join('\n'),
        allowed_mentions: { parse: [] },
      });
      if (!result.ok) {
        const reason =
          result.status === 403 || result.status === 404
            ? 'The bot cannot post in that channel (it needs View Channel, Send Messages and Embed Links there).'
            : `Discord refused the message (${result.status}).`;
        return fail(res, 502, reason);
      }
      return json(res, 200, { ok: true, url: linkUrl });
    }

    if (first === 'flags' && !second && req.method === 'GET') {
      const days = Math.min(120, Math.max(1, Number(url?.searchParams.get('days')) || 7));
      const since = Date.now() - days * 86400000;
      return json(res, 200, {
        flags: data.flags.filter((f) => f.at >= since).sort((a, b) => b.at - a.at).map(flagView),
      });
    }

    if (first === 'flags' && !second && req.method === 'POST') {
      const body = await readBody(req, 16 * 1024);
      const at = Number(body?.at);
      if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 6 * 3600000) {
        return fail(res, 400, 'Invalid flag time');
      }
      const flag = {
        id: crypto.randomBytes(6).toString('base64url'),
        at: Math.round(at),
        streamer: clean(body?.streamer, 80),
        by: clean(req.cloudUserName, 80),
        byId: req.cloudUserId,
        note: clean(body?.note, MAX_NOTE),
      };
      data.flags.push(flag);
      await persist();
      return json(res, 200, flagView(flag));
    }

    if (first === 'flags' && second) {
      const flag = data.flags.find((f) => f.id === second);
      if (!flag) return fail(res, 404, 'Flag not found');
      if (flag.byId !== req.cloudUserId && !(await isOfficer(req, 'flagsModerate'))) {
        return fail(res, 403, 'Only the person who flagged it or an officer can change it');
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req, 16 * 1024);
        flag.note = clean(body?.note, MAX_NOTE);
        await persist();
        return json(res, 200, flagView(flag));
      }
      if (req.method === 'DELETE') {
        data.flags = data.flags.filter((f) => f.id !== second);
        await persist();
        return json(res, 200, { ok: true });
      }
    }

    return fail(res, 404, 'Unknown coaching route');
  };

  /** A sent clip's preview image, if it has one. */
  const thumbnailPath = async (linkId) => {
    try {
      await fsp.access(thumbFile(linkId));
      return thumbFile(linkId);
    } catch {
      return null;
    }
  };

  return { handle, ready, thumbnailPath };
};
