// Encounter Journal from Blizzard's Game Data API (free, official): boss
// abilities by stage with their text and spell IDs, plus spell descriptions
// and icons for the Pull desk's Journal view and ability hover cards.
//
// Everything is cached under <storage>/journal/: a boss's journal for a day
// (it only changes with patches), spells and icons for good. So a whole
// guild costs Blizzard a few requests per boss per patch.
//
// Needs a client from https://develop.battle.net (API Access):
//   GUILD_CLOUD_BLIZZARD_CLIENT_ID / GUILD_CLOUD_BLIZZARD_CLIENT_SECRET
//   GUILD_CLOUD_BLIZZARD_REGION (us, eu, kr, tw; default us)

import fsp from 'node:fs/promises';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const JOURNAL_TTL = DAY;
const NOT_FOUND_TTL = 6 * 60 * 60 * 1000;

export const norm = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * Journal text as plain text: drop colour codes and textures, turn bullet
 * markers into "•". Blizzard's text carries the game's formatting codes.
 */
export const cleanText = (value) =>
  String(value || '')
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\|T[^|]*\|t/g, '')
    .replace(/\|H[^|]*\|h(.*?)\|h/g, '$1')
    .replace(/\$bullet;?/gi, '• ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Ability tags the in-game journal shows as icons. Blizzard's web API may or
// may not carry them; whichever of these shapes appears is read.
const ICON_FLAGS = {
  0: 'tank',
  1: 'damage',
  2: 'healer',
  3: 'heroic',
  4: 'deadly',
  5: 'important',
  6: 'interruptible',
  7: 'magic',
  8: 'curse',
  9: 'poison',
  10: 'disease',
  11: 'enrage',
  12: 'mythic',
  13: 'bleed',
};

const tagsOf = (section) => {
  const raw =
    section.icon_flags ?? section.iconFlags ?? section.flags ?? section.header_icons ?? null;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return [
    ...new Set(
      list
        .map((f) => {
          if (typeof f === 'number') return ICON_FLAGS[f];
          const text = String(f?.type ?? f?.name ?? f).toLowerCase();
          return Object.values(ICON_FLAGS).find((tag) => text.includes(tag));
        })
        .filter(Boolean),
    ),
  ];
};

/** One journal encounter from the API -> what the app shows. */
export const journalFromApi = (encounter) => {
  const spells = {};
  const walk = (sections = [], depth = 0) =>
    sections.map((s) => {
      const spellId = Number(s.spell?.id) || null;
      const node = {
        id: s.id,
        title: s.title || s.spell?.name || '',
        text: cleanText(s.body_text),
        spellId,
        tags: tagsOf(s),
        depth,
        children: walk(s.sections || [], depth + 1),
      };
      if (spellId && !spells[spellId]) {
        spells[spellId] = { title: node.title, text: node.text, sectionId: node.id, tags: node.tags };
      }
      return node;
    });
  return {
    journalId: encounter.id,
    name: encounter.name,
    description: cleanText(encounter.description),
    instance: encounter.instance?.name || null,
    modes: (encounter.modes || []).map((m) => m.type || m.name).filter(Boolean),
    sections: walk(encounter.sections || []),
    spells,
  };
};

/** Every ability in a journal, flattened, for matching against logs. */
export const journalAbilities = (journal) => {
  const out = [];
  const walk = (nodes) =>
    nodes.forEach((n) => {
      out.push(n);
      walk(n.children);
    });
  walk(journal?.sections || []);
  return out;
};

export const createJournal = ({ storage, env, fetchImpl = fetch }) => {
  const dir = path.join(storage, 'journal');
  const clientId = env.GUILD_CLOUD_BLIZZARD_CLIENT_ID || '';
  const clientSecret = env.GUILD_CLOUD_BLIZZARD_CLIENT_SECRET || '';
  const region = String(env.GUILD_CLOUD_BLIZZARD_REGION || 'us').toLowerCase();
  const apiBase = env.GUILD_CLOUD_BLIZZARD_API || `https://${region}.api.blizzard.com`;
  const oauthUrl = env.GUILD_CLOUD_BLIZZARD_OAUTH || 'https://oauth.battle.net/token';
  const configured = Boolean(clientId && clientSecret);

  let token = null;
  let tokenExpires = 0;

  const readJson = async (file, fallback) => {
    try {
      return JSON.parse(await fsp.readFile(path.join(dir, file), 'utf8'));
    } catch {
      return fallback;
    }
  };
  const writeJson = async (file, value) => {
    await fsp.mkdir(dir, { recursive: true });
    const full = path.join(dir, file);
    await fsp.writeFile(`${full}.tmp`, JSON.stringify(value));
    await fsp.rename(`${full}.tmp`, full);
  };

  const getToken = async () => {
    if (token && Date.now() < tokenExpires - 60000) return token;
    const response = await fetchImpl(oauthUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(
        `Blizzard sign-in failed (${response.status}). Check GUILD_CLOUD_BLIZZARD_CLIENT_ID and GUILD_CLOUD_BLIZZARD_CLIENT_SECRET.`,
      );
    }
    token = data.access_token;
    tokenExpires = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    return token;
  };

  /** GET a Game Data API path (static namespace, English). */
  const api = async (route, params = {}) => {
    if (!configured) throw new Error('Blizzard API keys are not set in the server .env.');
    const url = new URL(`${apiBase}${route}`);
    url.searchParams.set('namespace', `static-${region}`);
    url.searchParams.set('locale', 'en_US');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    for (let attempt = 1; ; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const bearer = await getToken();
      // eslint-disable-next-line no-await-in-loop
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(20000),
      }).catch((error) => ({ ok: false, status: 0, error }));
      if (response.status === 401 && attempt < 2) {
        token = null;
        continue;
      }
      if ((response.status === 429 || response.status >= 500 || response.status === 0) && attempt < 3) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Blizzard API ${route} failed (${response.status || response.error?.message})`);
      return response.json();
    }
  };

  /** Find a boss's journal encounter ID by name (newest match wins). */
  const findEncounterId = async (name) => {
    const result = await api('/data/wow/search/journal-encounter', {
      'name.en_US': name,
      orderby: 'id:desc',
      _page: 1,
    });
    const want = norm(name);
    const hits = (result?.results || [])
      .map((r) => r.data || {})
      .filter((d) => norm(d.name?.en_US ?? d.name) === want);
    return hits.length ? Math.max(...hits.map((d) => Number(d.id))) : null;
  };

  /**
   * The journal for a boss. `journalId` (set by an officer) wins; otherwise
   * it's found by the boss's name. Returns null if Blizzard has none.
   */
  const encounter = async ({ name, journalId = null, refresh = false }) => {
    const index = await readJson('index.json', {});
    const key = journalId ? `id:${journalId}` : `name:${norm(name)}`;
    const entry = index[key];
    const fresh = entry && Date.now() - entry.at < (entry.id ? JOURNAL_TTL : NOT_FOUND_TTL);
    if (entry && fresh && !refresh) {
      return entry.id ? readJson(`encounter-${entry.id}.json`, null) : null;
    }
    try {
      const id = journalId || (await findEncounterId(name));
      if (!id) {
        index[key] = { id: null, at: Date.now() };
        await writeJson('index.json', index);
        return null;
      }
      const raw = await api(`/data/wow/journal-encounter/${encodeURIComponent(id)}`);
      if (!raw) {
        index[key] = { id: null, at: Date.now() };
        await writeJson('index.json', index);
        return null;
      }
      const journal = journalFromApi(raw);
      await writeJson(`encounter-${journal.journalId}.json`, journal);
      await writeJson(`raw-${journal.journalId}.json`, raw);
      index[key] = { id: journal.journalId, at: Date.now() };
      await writeJson('index.json', index);
      return journal;
    } catch (error) {
      // Keep showing the cached copy if Blizzard is down.
      if (entry?.id) return readJson(`encounter-${entry.id}.json`, null);
      throw error;
    }
  };

  // Spells, kept in memory and saved one write at a time.
  let spellCache = null;
  let spellSave = Promise.resolve();
  const spellsLoaded = async () => {
    spellCache ??= await readJson('spells.json', {});
    return spellCache;
  };
  const saveSpells = () => {
    spellSave = spellSave.then(() => writeJson('spells.json', spellCache)).catch(() => {});
    return spellSave;
  };

  /** A spell's name, description and icon (cached for good). */
  const spell = async (spellId) => {
    const id = Number(spellId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const cache = await spellsLoaded();
    if (cache[id]) return cache[id];
    const [data, media] = await Promise.all([
      api(`/data/wow/spell/${id}`).catch(() => null),
      api(`/data/wow/media/spell/${id}`).catch(() => null),
    ]);
    const icon = (media?.assets || []).find((a) => a.key === 'icon')?.value || null;
    const value = { id, name: data?.name || null, text: cleanText(data?.description), icon };
    if (data || media) {
      cache[id] = value;
      await saveSpells();
    }
    return value;
  };

  /** Icons for many spells at once (journal view), a few requests at a time. */
  const icons = async (spellIds) => {
    const ids = [...new Set(spellIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
    const out = {};
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        // eslint-disable-next-line no-await-in-loop
        const s = await spell(id).catch(() => null);
        if (s?.icon) out[id] = s.icon;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  };

  /** The untouched API answer, for checking what Blizzard sends. */
  const raw = (journalId) => readJson(`raw-${Number(journalId)}.json`, null);

  return { configured, encounter, spell, icons, raw };
};
