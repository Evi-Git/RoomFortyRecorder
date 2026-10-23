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

/** Wowhead tooltip HTML -> the description, as plain text. */
export const tooltipText = (html) => {
  if (typeof html !== 'string' || !html) return '';
  // The description sits in <div class="q"> blocks; else take everything
  // after the header table (name, range, cast time).
  const blocks = [...html.matchAll(/<div class="q[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  const body = blocks.length ? blocks.join('<br>') : html.replace(/^[\s\S]*?<\/table>/, '');
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // 1250110 -> 1,250,110
    .replace(/\b\d{5,}\b/g, (n) => Number(n).toLocaleString('en-US'))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * The journal lists an ability once per difficulty version (the web API
 * doesn't say which), so the same heading can appear 2-3 times in a row.
 * Merge siblings with the same title and spell: keep each distinct line of
 * text once, and merge their abilities the same way.
 */
export const mergeVariants = (nodes) => {
  const out = [];
  nodes.forEach((node) => {
    const same = out.find((o) => o.title === node.title && o.spellId === node.spellId);
    if (!same) {
      out.push({ ...node, children: mergeVariants(node.children) });
      return;
    }
    const lines = same.text ? same.text.split('\n') : [];
    (node.text ? node.text.split('\n') : []).forEach((line) => {
      if (!lines.includes(line)) lines.push(line);
    });
    same.text = lines.join('\n');
    same.tags = [...new Set([...same.tags, ...node.tags])];
    same.children = mergeVariants([...same.children, ...node.children]);
  });
  return out;
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
    sections: mergeVariants(walk(encounter.sections || [])),
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

  // ---- Spell text and icons: Wowhead ---------------------------------------
  //
  // Blizzard's spell endpoints answer "not found" for boss spells referenced
  // by the journal (a known gap), and the journal itself carries no ability
  // text. So each spell's tooltip comes from Wowhead's tooltip API, the one
  // its tooltip widget uses: once per spell per difficulty, cached for good
  // and shared by the whole guild, a few requests at a time.

  const wowheadBase = env.GUILD_CLOUD_WOWHEAD_TOOLTIP || 'https://nether.wowhead.com/tooltip/spell';
  let spellCache = null; // "id:difficulty" -> { id, name, text, icon } | { missing: true }
  let spellSave = Promise.resolve();
  const spellsLoaded = async () => {
    spellCache ??= await readJson('spells.json', {});
    return spellCache;
  };
  const saveSpells = () => {
    spellSave = spellSave.then(() => writeJson('spells.json', spellCache)).catch(() => {});
    return spellSave;
  };

  // At most WOWHEAD_PARALLEL requests at once, WOWHEAD_GAP_MS apart.
  const WOWHEAD_PARALLEL = 3;
  const WOWHEAD_GAP_MS = 150;
  let active = 0;
  const waiting = [];
  const slot = async () => {
    if (active >= WOWHEAD_PARALLEL) await new Promise((r) => waiting.push(r));
    active += 1;
  };
  const release = () => {
    setTimeout(() => {
      active -= 1;
      waiting.shift()?.();
    }, WOWHEAD_GAP_MS);
  };

  const inFlight = new Map();
  const fetchSpell = async (id, difficultyId) => {
    await slot();
    try {
      const url = `${wowheadBase}/${id}?dataEnv=1&locale=0${difficultyId ? `&dd=${difficultyId}` : ''}`;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      if (response.status === 404) return { missing: true };
      if (!response.ok) return null; // try again another time
      const body = await response.json();
      return {
        id,
        name: typeof body.name === 'string' ? body.name : null,
        text: tooltipText(body.tooltip),
        icon: typeof body.icon === 'string' && /^[a-z0-9_-]+$/i.test(body.icon) ? body.icon.toLowerCase() : null,
      };
    } catch {
      return null;
    } finally {
      release();
    }
  };

  /** A spell's name, tooltip text (for that difficulty) and icon name. */
  const spell = async (spellId, difficultyId = null) => {
    const id = Number(spellId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const dd = Number(difficultyId) || 0;
    const key = `${id}:${dd}`;
    const cache = await spellsLoaded();
    if (cache[key]) return cache[key].missing ? null : cache[key];
    if (!inFlight.has(key)) {
      inFlight.set(
        key,
        fetchSpell(id, dd).then(async (value) => {
          inFlight.delete(key);
          if (value) {
            cache[key] = value;
            await saveSpells();
          }
          return value && !value.missing ? value : null;
        }),
      );
    }
    return inFlight.get(key);
  };

  /**
   * Many spells for one difficulty (the Journal view). Returns what's ready
   * and fetches at most `budget` more per call, so the view fills in over a
   * few calls instead of waiting on a whole raid's worth.
   */
  const spells = async (spellIds, difficultyId = null, budget = 24) => {
    const ids = [...new Set(spellIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 400);
    const dd = Number(difficultyId) || 0;
    const cache = await spellsLoaded();
    const out = {};
    const todo = [];
    ids.forEach((id) => {
      const hit = cache[`${id}:${dd}`];
      if (hit) {
        if (!hit.missing) out[id] = hit;
      } else todo.push(id);
    });
    const batch = todo.slice(0, budget);
    const fetched = await Promise.all(batch.map((id) => spell(id, dd)));
    batch.forEach((id, i) => {
      if (fetched[i]) out[id] = fetched[i];
    });
    return { spells: out, pending: todo.length - batch.length };
  };

  /** The untouched API answer, for checking what Blizzard sends. */
  const raw = (journalId) => readJson(`raw-${Number(journalId)}.json`, null);

  return { configured, encounter, spell, spells, raw };
};
