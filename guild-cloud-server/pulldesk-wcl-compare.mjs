// [RoomFortyRecorder] Compare with Warcraft Logs (owner only): a report's
// fights, and Warcraft Logs' own tables for one fight (damage done, healing,
// damage taken, casts, buffs, debuffs), so the app can put our numbers next
// to theirs. Answers are kept for 30 minutes: each table costs points.

import { reportCode } from './pulldesk-import.mjs';

export const TABLE_TYPES = ['DamageDone', 'Healing', 'DamageTaken', 'Casts', 'Buffs', 'Debuffs'];
const VIEWS = ['Default', 'Ability', 'Source', 'Target'];
const HOSTILITY = ['Friendlies', 'Enemies'];
const TTL_MS = 30 * 60 * 1000;

const parse = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const createWclCompare = ({ wcl, now = () => Date.now() }) => {
  const cache = new Map();
  const cached = async (key, load) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    const value = await load();
    cache.set(key, { at: now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  };

  const need = (report) => {
    if (!wcl?.configured) {
      throw Object.assign(new Error('Set GUILD_CLOUD_WCL_CLIENT_ID and GUILD_CLOUD_WCL_CLIENT_SECRET in the server .env (same as recruiting).'), {
        status: 400,
      });
    }
    const code = reportCode(report);
    if (!code) throw Object.assign(new Error('Paste a Warcraft Logs report link'), { status: 400 });
    return code;
  };

  /** The report's boss fights, with absolute start times. */
  const fights = async (report) => {
    const code = need(report);
    return cached(`fights:${code}`, async () => {
      const data = await wcl.query(
        `query($code: String!) { reportData { report(code: $code) {
          code title startTime
          fights { id name encounterID difficulty kill startTime endTime fightPercentage }
          masterData { actors(type: "Player") { id name subType } } } } }`,
        { code },
      );
      const r = data.reportData?.report;
      if (!r) throw Object.assign(new Error('Warcraft Logs has no such report (or it is private)'), { status: 404 });
      return {
        code: r.code || code,
        title: r.title || '',
        startTime: Number(r.startTime) || 0,
        fights: (r.fights || [])
          .filter((f) => Number(f.encounterID) > 0)
          .map((f) => ({
            id: Number(f.id),
            name: String(f.name || ''),
            encounterId: Number(f.encounterID),
            difficulty: Number(f.difficulty) || 0,
            kill: Boolean(f.kill),
            start: (Number(r.startTime) || 0) + (Number(f.startTime) || 0),
            seconds: Math.round((Number(f.endTime) - Number(f.startTime)) / 1000),
            percent: f.fightPercentage ?? null,
          })),
        players: (r.masterData?.actors || []).map((a) => ({ id: Number(a.id), name: String(a.name || ''), className: a.subType || '' })),
      };
    });
  };

  /** One of Warcraft Logs' tables for a fight, as they send it. */
  const table = async (report, { fight, type, source = null, view = 'Default', hostility = 'Friendlies' } = {}) => {
    const code = need(report);
    const fightId = Number(fight);
    if (!Number.isInteger(fightId) || fightId <= 0) throw Object.assign(new Error('Pick a fight'), { status: 400 });
    if (!TABLE_TYPES.includes(type)) throw Object.assign(new Error('Unknown table'), { status: 400 });
    const viewBy = VIEWS.includes(view) ? view : 'Default';
    const side = HOSTILITY.includes(hostility) ? hostility : 'Friendlies';
    const sourceId = source === null || source === undefined || source === '' ? null : Number(source);
    if (sourceId !== null && !Number.isInteger(sourceId)) throw Object.assign(new Error('Bad source'), { status: 400 });
    return cached(`table:${code}:${fightId}:${type}:${sourceId}:${viewBy}:${side}`, async () => {
      const data = await wcl.query(
        `query($code: String!, $fight: Int!, $type: TableDataType!, $source: Int, $view: ViewType, $side: HostilityType) {
          reportData { report(code: $code) {
            table(dataType: $type, fightIDs: [$fight], sourceID: $source, viewBy: $view, hostilityType: $side) } } }`,
        { code, fight: fightId, type, source: sourceId, view: viewBy, side },
      );
      const t = parse(data.reportData?.report?.table);
      return t?.data || t || {};
    });
  };

  return { fights, table };
};
