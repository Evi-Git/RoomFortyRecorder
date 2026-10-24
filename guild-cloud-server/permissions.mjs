// [RoomFortyRecorder] Who can do what, per Discord role, edited by the owner
// in the app (Admin page). One file: <storage>/permissions.json.
//
//   GUILD_CLOUD_OWNER_IDS  Discord user IDs (comma-separated) with every
//                          capability, always, and the only ones who can edit
//                          this or "view as" a role.
//
// Until the owner saves the table, each capability uses the role list from
// the old .env setting it replaces, so nothing changes on update.
//
// "View as role": the owner's app sends `X-View-As-Role: <role>`, and every
// check for that request answers as if they only had that role. Admin
// routes ignore it, so the owner can always switch back.

import fsp from 'node:fs/promises';
import path from 'node:path';

export const EVERYONE = '@everyone';

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

// An empty .env list meant "everyone" for these settings.
const orEveryone = (roles) => (roles.length ? roles : [EVERYONE]);

/** The capabilities, in the order the Admin page shows them. */
export const capabilities = (env = {}) => {
  const liveViewers = list(
    env.GUILD_CLOUD_LIVE_VIEWER_ROLES ?? 'Raider+,Officer',
  );
  const editors = list(
    env.GUILD_CLOUD_PULLDESK_EDITOR_ROLES ??
      env.GUILD_CLOUD_LIVE_VIEWER_ROLES ??
      'Raider+,Officer',
  );
  const officers = list(env.GUILD_CLOUD_COACH_OFFICER_ROLES ?? 'Officer');
  const recruiters = list(env.GUILD_CLOUD_RECRUIT_ROLES ?? 'Officer');
  return [
    {
      key: 'analysisView',
      group: 'Analysis',
      label: 'See Analysis',
      help: 'Pull reports, Night summary, Progression and the Journal.',
      defaults: [EVERYONE],
    },
    {
      key: 'analysisEdit',
      group: 'Analysis',
      label: 'Edit Analysis',
      help: 'Boss settings, the avoidable list, cooldown notes, imports, Re-run and the combat potion list.',
      defaults: orEveryone(editors),
    },
    {
      key: 'watcherManage',
      group: 'Analysis',
      label: 'Manage top-guild watcher',
      help: 'Pick the guilds Progression compares against and run the crawl.',
      defaults: orEveryone(officers),
    },
    {
      key: 'liveWatch',
      group: 'Live',
      label: 'Watch live streams',
      help: 'See and watch who is live. Anyone signed in can go live.',
      defaults: orEveryone(liveViewers),
    },
    {
      key: 'clipSendOwn',
      group: 'Coaching',
      label: 'Send clips to their own channel',
      help: 'Send to Discord, to the personal channel an officer mapped for them.',
      defaults: [EVERYONE],
    },
    {
      key: 'clipSendAny',
      group: 'Coaching',
      label: 'Send clips to any channel',
      help: 'Any raider’s channel or a main text channel (the channel override).',
      defaults: orEveryone(officers),
    },
    {
      key: 'clipChannels',
      group: 'Coaching',
      label: 'Edit personal channels',
      help: 'Map raiders to their personal Discord channels.',
      defaults: orEveryone(officers),
    },
    {
      key: 'flagsModerate',
      group: 'Coaching',
      label: 'Edit anyone’s flags',
      help: 'Rename or delete flags other people made (everyone can edit their own).',
      defaults: orEveryone(officers),
    },
    {
      key: 'recruit',
      group: 'Recruiting',
      label: 'Recruiting page',
      help: 'The /recruit web page.',
      defaults: orEveryone(recruiters),
    },
  ];
};

const cleanRole = (role) =>
  String(role ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 100);

/**
 * @param {object} options
 * @param {string} options.storage
 * @param {object} options.env
 * @param {(discordId: string) => Promise<string[]|null>} options.memberRoleNames lower-case names
 * @param {() => Promise<{id:string,name:string,position:number,color:number}[]>} [options.guildRoles]
 */
export const createPermissions = ({
  storage,
  env = {},
  memberRoleNames,
  guildRoles,
}) => {
  const file = path.join(storage, 'permissions.json');
  const caps = capabilities(env);
  const capKeys = new Set(caps.map((c) => c.key));
  const owners = new Set(
    String(env.GUILD_CLOUD_OWNER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d{5,25}$/.test(id)),
  );

  // { grants: { [cap]: string[] }, columns: string[], updatedAt, updatedBy }
  let saved = null;
  let loaded = null;
  const ready = () => {
    loaded ??= fsp
      .readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') saved = parsed;
      })
      .catch((error) => {
        if (error.code !== 'ENOENT')
          console.warn('[permissions] Could not read', error.message);
      });
    return loaded;
  };

  const grantsFor = (key) => {
    const cap = caps.find((c) => c.key === key);
    if (!cap) return [];
    const stored = saved?.grants?.[key];
    return Array.isArray(stored) ? stored : cap.defaults;
  };

  const isOwner = (discordId) => owners.has(String(discordId ?? ''));

  // The role the owner is viewing as, or null.
  const viewAsOf = (req) => {
    if (!isOwner(req?.cloudUserId)) return null;
    const raw = req?.headers?.['x-view-as-role'];
    const role = cleanRole(Array.isArray(raw) ? raw[0] : raw);
    return role || null;
  };

  /** The role names a check uses for this person (lower-case), or null. */
  const rolesOf = async (discordId, viewAs = null) => {
    if (viewAs) return viewAs === EVERYONE ? [] : [viewAs];
    return memberRoleNames(discordId);
  };

  const allowed = (key, roles, owner) => {
    if (!capKeys.has(key)) return false;
    if (owner) return true;
    const grants = grantsFor(key);
    if (grants.includes(EVERYONE)) return true;
    return Boolean(
      roles?.some((role) => grants.includes(String(role).toLowerCase())),
    );
  };

  /** Can this signed-in request do `key`? Honors "view as". */
  const can = async (req, key) => {
    await ready();
    const viewAs = viewAsOf(req);
    const owner = isOwner(req?.cloudUserId) && !viewAs;
    if (owner) return capKeys.has(key);
    return allowed(key, await rolesOf(req?.cloudUserId, viewAs), false);
  };

  /** Same, for a Discord ID without a request (web sessions, MediaMTX). */
  const canUser = async (discordId, key) => {
    await ready();
    if (isOwner(discordId)) return capKeys.has(key);
    return allowed(key, await memberRoleNames(discordId), false);
  };

  const save = async (next) => {
    await fsp.mkdir(storage, { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 1));
    await fsp.rename(tmp, file);
    saved = next;
  };

  // Columns the table shows: what the owner picked, else every role the
  // defaults mention plus "trial" if the server has it.
  const columnsOf = (roleNames) => {
    if (Array.isArray(saved?.columns)) return saved.columns;
    const named = new Set(caps.flatMap((c) => c.defaults));
    if (roleNames.includes('trial')) named.add('trial');
    named.add(EVERYONE);
    return [...named];
  };

  /**
   * Routes under /api/permissions:
   *   GET  /api/permissions/me   what this person (or the role they view as) can do
   *   GET  /api/permissions      the table (owner only)
   *   PUT  /api/permissions      { grants, columns } (owner only)
   */
  const handle = async (req, res, rest, { readBody, json, fail }) => {
    await ready();
    const [first] = rest;
    if (first === 'me' && req.method === 'GET') {
      const viewAs = viewAsOf(req);
      const owner = isOwner(req.cloudUserId);
      const roles = await rolesOf(req.cloudUserId, viewAs);
      const result = {};
      for (const cap of caps)
        result[cap.key] = allowed(cap.key, roles, owner && !viewAs);
      return json(res, 200, {
        owner,
        viewAs,
        roles: viewAs ? (viewAs === EVERYONE ? [] : [viewAs]) : roles || [],
        can: result,
      });
    }

    if (!isOwner(req.cloudUserId))
      return fail(res, 403, 'Only the owner can change permissions');

    let roleList = [];
    let roleError = '';
    try {
      roleList = guildRoles ? await guildRoles() : [];
    } catch (error) {
      roleError = error.message;
    }
    // The owner's own role (named like them, e.g. "Evi") isn't a column:
    // the "You" column already covers it.
    const personal = String(req.cloudUserName ?? '')
      .trim()
      .toLowerCase();
    roleList = roleList.filter((r) => r.name.toLowerCase() !== personal);
    const roleNames = roleList.map((r) => r.name.toLowerCase());

    if (!first && req.method === 'GET') {
      return json(res, 200, {
        capabilities: caps.map(({ key, group, label, help, defaults }) => ({
          key,
          group,
          label,
          help,
          defaults,
          grants: grantsFor(key),
        })),
        columns: columnsOf(roleNames).filter((c) => c !== personal),
        roles: roleList,
        roleError,
        customized: Boolean(saved),
        updatedAt: saved?.updatedAt ?? null,
        updatedBy: saved?.updatedBy ?? null,
      });
    }

    if (!first && req.method === 'PUT') {
      const body = await readBody(req, 64 * 1024);
      if (!body || typeof body.grants !== 'object')
        return fail(res, 400, 'Expected { grants, columns }');
      const grants = {};
      for (const cap of caps) {
        const value = body.grants[cap.key];
        grants[cap.key] = Array.isArray(value)
          ? [...new Set(value.map(cleanRole).filter(Boolean))].slice(0, 100)
          : grantsFor(cap.key);
      }
      const columns = Array.isArray(body.columns)
        ? [...new Set(body.columns.map(cleanRole).filter(Boolean))].slice(0, 50)
        : columnsOf(roleNames);
      await save({
        grants,
        columns,
        updatedAt: Date.now(),
        updatedBy: req.cloudUserName || req.cloudUserId,
      });
      return json(res, 200, { ok: true, grants, columns });
    }

    if (first === 'reset' && req.method === 'POST') {
      await fsp.rm(file, { force: true });
      saved = null;
      return json(res, 200, { ok: true });
    }

    return fail(res, 404, 'Not found');
  };

  return {
    ready,
    can,
    canUser,
    isOwner,
    handle,
    capabilities: caps,
    configured: owners.size > 0,
  };
};
