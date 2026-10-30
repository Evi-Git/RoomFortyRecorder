// The current raid's bosses, in raid order, for the Logs page's boss strip
// (and Top logs). From Warcraft Logs' zone list, refreshed once a day and
// kept in <storage>/pulldesk/season.json so it still works when Warcraft
// Logs is down or not set up (then bosses from our own pulls fill in).
//
//   GUILD_CLOUD_RAID_ZONE   the raid's name on Warcraft Logs
//                           (default "The Venomous Abyss")

import fsp from 'node:fs/promises';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const RETRY = 60 * 60 * 1000; // after a failed refresh

export const DEFAULT_RAID_ZONE = 'The Venomous Abyss';

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The season's bosses: the zone's encounters in raid order, then any other
 * boss we have pulls on (newest first), so nothing pulled goes missing.
 * @param {{ id: number, name: string }[] | null} encounters
 * @param {{ encounterId: number, encounterName?: string, createdAt?: number }[]} pulls
 */
export const seasonBosses = (encounters, pulls) => {
  const out = (encounters || [])
    .filter((e) => Number(e?.id) > 0)
    .map((e) => ({ encounterId: Number(e.id), name: String(e.name || e.id), inZone: true }));
  const known = new Set(out.map((b) => b.encounterId));
  const extra = new Map();
  (pulls || []).forEach((p) => {
    const id = Number(p.encounterId);
    if (!id || known.has(id)) return;
    const at = Number(p.createdAt) || 0;
    const seen = extra.get(id);
    if (!seen || at > seen.at) extra.set(id, { encounterId: id, name: p.encounterName || String(id), at });
  });
  [...extra.values()]
    .sort((a, b) => b.at - a.at)
    .forEach(({ encounterId, name }) => out.push({ encounterId, name, inZone: false }));
  return out;
};

export const createSeason = ({ storage, env, wcl }) => {
  const zoneName = String(env.GUILD_CLOUD_RAID_ZONE || DEFAULT_RAID_ZONE).trim();
  const file = path.join(storage, 'pulldesk', 'season.json');
  let memo = null;
  let lastTry = 0;
  let flight = null;

  const read = async () => {
    if (memo) return memo;
    try {
      memo = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      memo = null;
    }
    return memo;
  };

  const refresh = async () => {
    const data = await wcl.query('query { worldData { zones { id name encounters { id name } } } }');
    const zone = (data.worldData?.zones || [])
      .filter((z) => norm(z.name) === norm(zoneName))
      .sort((a, b) => b.id - a.id)[0];
    if (!zone) throw new Error(`Warcraft Logs has no zone called "${zoneName}".`);
    const value = {
      at: Date.now(),
      zoneName,
      zone: { id: zone.id, name: zone.name, encounters: (zone.encounters || []).map((e) => ({ id: e.id, name: e.name })) },
    };
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(value));
    await fsp.rename(`${file}.tmp`, file);
    memo = value;
    return value;
  };

  /** The raid zone: { id, name, encounters } or null if unknown. */
  const zone = async () => {
    const saved = await read();
    const usable = saved && norm(saved.zoneName) === norm(zoneName) ? saved : null;
    const stale = !usable || Date.now() - usable.at > DAY;
    if (stale && wcl?.configured && Date.now() - lastTry > RETRY) {
      lastTry = Date.now();
      flight ??= refresh()
        .catch((error) => {
          console.warn(`[season] ${error.message}`);
          return null;
        })
        .finally(() => {
          flight = null;
        });
      // First time: wait for it. Later: answer from the saved copy.
      if (!usable) return (await flight)?.zone ?? null;
    }
    return usable?.zone ?? null;
  };

  return { zone, zoneName };
};
