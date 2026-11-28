// Every route the guild server answers, with the access a request needs to
// reach its handler. handleApi (server.mjs) matches each /api request here
// first: a path that isn't listed is a 404, a listed path with another method
// is a 405, and the access rule is enforced before any handler runs.
//
// access:
//   'public'       anyone
//   'adminSecret'  the x-admin-secret header (GUILD_CLOUD_ADMIN_SECRET)
//   'member'       any signed-in session. Handlers may still tell own things
//                  from other people's (see the note) or hold back parts.
//   'owner'        an owner (GUILD_CLOUD_OWNER_IDS) who is not "viewing as" a
//                  role
//   'ownerAlways'  an owner, even while viewing as a role (permissions.mjs)
//   <capability>   a key from permissions.mjs capabilities(); the person
//                  needs that capability
//   [<cap>, ...]   a list of capability keys: any one of them is enough
//                  (needs a `denied` message of its own)
//   'other'        not gated: served before handleApi, or by a module that
//                  does its own check. Listed for documentation, with a note.
//
// `access` is the minimum to reach the handler as the code behaves today.
// The handlers keep their own checks as well (a second layer, with specific
// messages). `denied` is the 403 message when it differs from the default
// for the capability (DENIED below).
//
// A new route needs an entry here, and, if the app calls it, an example in
// the call-site list in routes.test.mjs.

export const ACCESS_KINDS = ['public', 'adminSecret', 'member', 'owner', 'ownerAlways', 'other'];

/** The 403 message for a capability when a route has no `denied` of its own. */
export const DENIED = {
  analysisView: 'Your Discord role cannot see Analysis',
  analysisEdit: 'Your Discord role cannot edit the pull desk',
  watcherManage: 'Only officers can change the guild watcher',
  clipChannels: 'Your Discord role cannot edit personal channels',
  owner: 'Only the owner can do that',
  ownerAlways: 'Only the owner can change permissions',
};
export const DEFAULT_DENIED = 'Your Discord role cannot do that';

/** The 403 message for a route the person may not use. */
export const deniedMessage = (route) =>
  route.denied || (typeof route.access === 'string' && DENIED[route.access]) || DEFAULT_DENIED;

export const ROUTES = [
  { method: 'GET', path: '/health', access: 'other', note: 'Local health check (health.mjs). Handled in requestHandler, not by the gate.' },
  { method: 'POST', path: '/internal/mediamtx-auth', access: 'other', note: 'MediaMTX asks who may publish or watch (session token or raider/viewer password). Handled in requestHandler.' },
  { method: 'GET', path: '/auth/discord/start', access: 'other', note: 'Discord OAuth start. Handled in requestHandler.' },
  { method: 'GET', path: '/auth/discord/callback', access: 'other', note: 'Discord OAuth callback. Handled in requestHandler.' },
  { method: 'GET', path: '/link/:id', access: 'other', note: 'Public share page (Discord embed). Handled in requestHandler.' },
  { method: 'GET', path: '/link/:id/video', access: 'other', note: 'Public redirect to the signed video URL. Handled in requestHandler.' },
  { method: 'GET', path: '/link/:id/thumb.jpg', access: 'other', note: 'Public coaching clip preview image. Handled in requestHandler.' },
  { method: 'POST', path: '/link/:id/like', access: 'other', note: 'Public like button on the share page. Handled in requestHandler.' },
  { method: 'GET', path: '/recruit', access: 'other', note: 'Recruiting page: cookie session, recruit.mjs checks the recruit role itself.' },
  { method: 'GET', path: '/recruit/score.mjs', access: 'other', note: 'Script for the recruiting page (recruit.mjs).' },
  { method: 'GET', path: '/recruit/logout', access: 'other', note: 'Clears the recruiting cookie (recruit.mjs).' },
  { method: 'GET', path: '/api/recruit/state', access: 'other', note: 'Cookie session; recruit.mjs checks the recruit role itself. Dispatched before handleApi, so the gate never sees it.' },
  { method: 'GET', path: '/api/recruit/results', access: 'other', note: 'Cookie session; recruit.mjs checks the recruit role itself. Dispatched before handleApi, so the gate never sees it.' },
  { method: 'POST', path: '/api/recruit/crawl', access: 'other', note: 'Cookie session; recruit.mjs checks the recruit role itself. Dispatched before handleApi, so the gate never sees it.' },
  { method: 'POST', path: '/api/recruit/stop', access: 'other', note: 'Cookie session; recruit.mjs checks the recruit role itself. Dispatched before handleApi, so the gate never sees it.' },
  { method: 'PUT', path: '/api/recruit/settings', access: 'other', note: 'Cookie session; recruit.mjs checks the recruit role itself. Dispatched before handleApi, so the gate never sees it.' },
  { method: 'POST', path: '/api/auth/discord/exchange', access: 'public', note: 'Trades the one-time login code for a session token.' },
  { method: 'GET', path: '/api/admin/users', access: 'adminSecret' },
  { method: 'POST', path: '/api/admin/revoke', access: 'adminSecret' },
  { method: 'POST', path: '/api/admin/revoke-all', access: 'adminSecret' },
  { method: 'GET', path: '/api/admin/orphans', access: 'adminSecret' },
  { method: 'POST', path: '/api/admin/orphans/delete', access: 'adminSecret' },
  { method: 'POST', path: '/api/bug-report', access: 'member' },
  { method: 'GET', path: '/api/live/publish', access: 'member', note: '404 when live streaming is not configured.' },
  { method: 'GET', path: '/api/live/streams', access: 'member', note: 'The handler answers allowed:false for people without the live-watch capability instead of a 403.' },
  { method: 'GET', path: '/api/user/affiliations', access: 'member', note: 'The old handler ignored the method; the app only GETs.' },
  { method: 'GET', path: '/api/guild/:guild', access: 'member' },
  { method: 'GET', path: '/api/guild/:guild/video', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/video', access: 'member', note: 'Own recording, or videoManage to replace someone else\'s (checked in the handler).' },
  { method: 'GET', path: '/api/guild/:guild/video/:key/timeline', access: 'member' },
  { method: 'PUT', path: '/api/guild/:guild/video/:key/timeline', access: 'member', note: 'Own video, or videoManage (checked in the handler).' },
  { method: 'GET', path: '/api/guild/:guild/video/:key/size', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/video/:key/link', access: 'member', note: 'Any member; one link per recording.' },
  { method: 'DELETE', path: '/api/guild/:guild/video/:key/link', access: 'member', note: 'Stop sharing: removes the recording link and the Discord clip links of that recording the caller may stop (their own, or all if they are the uploader or have videoManage; checked in the handler). Answers { removed, clips }.' },
  { method: 'POST', path: '/api/guild/:guild/upload', access: 'member', note: 'Own recording, or videoManage to overwrite someone else\'s (checked in the handler).' },
  { method: 'GET', path: '/api/guild/:guild/usage', access: 'member' },
  { method: 'GET', path: '/api/guild/:guild/limit', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/housekeeper', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/bulk/delete', access: 'member', note: 'Own recordings, or videoManage for others (the handler filters per video).' },
  { method: 'POST', path: '/api/guild/:guild/bulk/protect', access: 'member', note: 'Own recordings, or videoManage for others (the handler filters per video).' },
  { method: 'POST', path: '/api/guild/:guild/bulk/tag', access: 'member', note: 'Own recordings, or videoManage for others (the handler filters per video).' },
  { method: 'POST', path: '/api/guild/:guild/chat/:video/:start', access: 'member' },
  { method: 'GET', path: '/api/guild/:guild/chat/:correlator', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/chat/:correlator', access: 'member' },
  { method: 'DELETE', path: '/api/guild/:guild/chat/:id', access: 'member', note: 'Own message, or chatModerate (checked in the handler).' },
  { method: 'POST', path: '/api/guild/:guild/named-chat/:name', access: 'member' },
  { method: 'GET', path: '/api/guild/:guild/permissions/me', access: 'member' },
  { method: 'GET', path: '/api/guild/:guild/permissions', access: 'ownerAlways', note: 'permissions.mjs ignores "view as", so the owner can always switch back.' },
  { method: 'PUT', path: '/api/guild/:guild/permissions', access: 'ownerAlways', note: 'permissions.mjs ignores "view as", so the owner can always switch back.' },
  { method: 'GET', path: '/api/guild/:guild/permissions/members', access: 'ownerAlways', note: 'permissions.mjs ignores "view as", so the owner can always switch back.' },
  { method: 'POST', path: '/api/guild/:guild/permissions/sign-out', access: 'ownerAlways', note: 'permissions.mjs ignores "view as", so the owner can always switch back.' },
  { method: 'POST', path: '/api/guild/:guild/permissions/reset', access: 'ownerAlways', note: 'permissions.mjs ignores "view as", so the owner can always switch back.' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/config', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/claim', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/backfill', access: 'member' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/backfill/check', access: 'member' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/journal/boss/:id', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/journal/spell/:id', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/journal/talents/:id', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/journal/icon/:name', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/journal/raw/:id', access: 'analysisEdit', note: 'analysisEdit implies analysisView (IMPLIES in permissions.mjs).' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/journal/names', access: 'analysisView' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/journal/items', access: 'analysisView' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/journal/spells', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/toplogs', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/toplogs/ours', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/toplogs/rankings', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/toplogs/trial', access: 'analysisView' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/toplogs/retry', access: 'analysisView', note: 'Asks again for up to 25 Top logs rows that failed; same access as reading them.' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/toplogs/crawl', access: 'analysisEdit', denied: 'Officers only', note: 'analysisEdit implies analysisView (IMPLIES in permissions.mjs).' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/season', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/settings', access: 'analysisView' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/settings', access: 'analysisEdit' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/analyze-presets', access: 'analysisView' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/analyze-presets/:specId', access: 'analysisEdit', denied: 'Your Discord role cannot edit guild presets' },
  { method: 'DELETE', path: '/api/guild/:guild/pulldesk/analyze-presets/:specId', access: 'analysisEdit', denied: 'Your Discord role cannot edit guild presets' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/progression-list', access: 'analysisEdit' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/meters/trends', access: 'analysisView' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/wcl/fights', access: 'owner', denied: 'Only the owner can compare with Warcraft Logs' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/wcl/table', access: 'owner', denied: 'Only the owner can compare with Warcraft Logs' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/import/guild', access: 'owner', denied: 'Only the owner can import a whole tier' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/import/guild/scan', access: 'owner', denied: 'Only the owner can import a whole tier' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/import/tier', access: 'owner', denied: 'Only the owner can import a whole tier' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/import', access: 'analysisEdit' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/pulls', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/pulls/:id', access: 'analysisView' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/pulls/:id/log', access: 'member', note: 'Only the raider the server picked for this pull (checked in the handler).' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/pulls/:id/full', access: 'member', note: 'Only the raider the server picked for this pull (checked in the handler).' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/pulls/:id/full', access: 'analysisView' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/pulls/:id/reanalyze', access: 'analysisEdit' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/pulls/:id/meters', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/summary/nights', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/summary/night/:date', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/summary/boss/:id', access: 'analysisView' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/bosses/:id', access: 'analysisView' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/bosses/:id/note', access: 'analysisEdit' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/bosses/:id/avoidable', access: 'analysisEdit' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/bosses/:id/channel', access: 'analysisEdit' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/bosses/:id/avoidable-toggle', access: 'analysisEdit' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/bosses/:id/journal', access: 'analysisEdit' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/bosses/:id/killed-before', access: 'analysisEdit' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/watcher', access: 'analysisView', note: 'The handler tells the app whether they are an officer.' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/watcher/settings', access: 'watcherManage' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/watcher/crawl', access: 'watcherManage' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/watcher/stop', access: 'watcherManage' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/coach/config', access: 'member' },
  { method: 'PUT', path: '/api/guild/:guild/pulldesk/coach/mapping', access: 'clipChannels' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/coach/send', access: 'member', note: 'clipSendAny, or clipSendOwn plus the raider\'s own mapped channel (checked in the handler).' },
  { method: 'GET', path: '/api/guild/:guild/pulldesk/coach/flags', access: ['analysisView', 'liveWatch'], denied: 'Your Discord role cannot see flagged moments', note: 'Shown on the Dashboard and on Watch live.' },
  { method: 'POST', path: '/api/guild/:guild/pulldesk/coach/flags', access: 'liveWatch', denied: 'Your Discord role cannot flag moments', note: 'Flags are made on Watch live.' },
  { method: 'PATCH', path: '/api/guild/:guild/pulldesk/coach/flags/:id', access: 'member', note: 'Own flag, or flagsModerate (checked in the handler).' },
  { method: 'DELETE', path: '/api/guild/:guild/pulldesk/coach/flags/:id', access: 'member', note: 'Own flag, or flagsModerate (checked in the handler).' },
];

// ---- Matching -----------------------------------------------------------------

// Path segments: a literal, ':name' (exactly one segment) or a final '*'
// (one or more segments, for a handler that really takes any depth).
const compile = (route) => {
  const segments = route.path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (part === '*') return { kind: 'rest' };
      if (part.startsWith(':')) return { kind: 'param', name: part.slice(1) };
      return { kind: 'literal', value: part };
    });
  return { route, segments };
};

// Same splitting and decoding as the server's parseParts. A caller that has
// the parts already passes them, so nothing is decoded twice.
const toParts = (pathname) =>
  pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

const matchPath = (compiled, parts) => {
  const { segments } = compiled;
  const params = {};
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.kind === 'rest') {
      if (parts.length <= i) return null;
      params['*'] = parts.slice(i);
      return params;
    }
    if (i >= parts.length) return null;
    if (segment.kind === 'literal') {
      if (segment.value !== parts[i]) return null;
    } else {
      params[segment.name] = parts[i];
    }
  }
  return parts.length === segments.length ? params : null;
};

const RANK = { literal: 2, param: 1, rest: 0 };

// Literal beats ':param' beats '*', segment by segment from the left.
const moreSpecific = (a, b) => {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i++) {
    const ra = a.segments[i] ? RANK[a.segments[i].kind] : -1;
    const rb = b.segments[i] ? RANK[b.segments[i].kind] : -1;
    if (ra !== rb) return ra > rb;
  }
  return false;
};

/**
 * Finds the route for a request. `pathOrParts` is the URL path or the
 * already-split, decoded parts. The order of `routes` doesn't matter.
 * @returns {{route: object, params: object} | {methodNotAllowed: true} | null}
 */
export const createMatcher = (routes) => {
  const compiled = routes.map(compile);
  return (method, pathOrParts) => {
    const parts = Array.isArray(pathOrParts) ? pathOrParts : toParts(pathOrParts);
    let pathKnown = false;
    let best = null;
    for (const entry of compiled) {
      const params = matchPath(entry, parts);
      if (!params) continue;
      pathKnown = true;
      if (entry.route.method !== method) continue;
      if (!best || moreSpecific(entry, best.entry)) best = { entry, params };
    }
    if (best) return { route: best.entry.route, params: best.params };
    return pathKnown ? { methodNotAllowed: true } : null;
  };
};

export const matchRoute = createMatcher(ROUTES);
