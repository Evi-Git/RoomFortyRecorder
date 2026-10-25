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
import { toPng } from './icon-pack.mjs';

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

export const createJournal = ({ storage, env, fetchImpl = fetch, wcl = null }) => {
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

  // A saved journal, rebuilt from Blizzard's raw answer so changes to how
  // it's shown (merging difficulty copies, text cleanup) apply right away.
  const stored = async (id) => {
    const rawCopy = await readJson(`raw-${id}.json`, null);
    return rawCopy ? journalFromApi(rawCopy) : readJson(`encounter-${id}.json`, null);
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
      return entry.id ? stored(entry.id) : null;
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
      if (entry?.id) return stored(entry.id);
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

  // Blizzard's spell API, for when Wowhead has nothing or is busy: it knows
  // player spells (not boss ones) and their icons.
  const blizzardSpell = async (id) => {
    if (!configured) return null;
    try {
      const [info, media] = await Promise.all([
        api(`/data/wow/spell/${id}`).catch(() => null),
        api(`/data/wow/media/spell/${id}`).catch(() => null),
      ]);
      const iconUrl = (media?.assets || []).find((a) => a.key === 'icon')?.value || '';
      const icon = /\/([a-z0-9_-]+)\.jpg$/i.exec(iconUrl)?.[1]?.toLowerCase() || null;
      if (!info?.name && !icon) return null;
      return { id, name: info?.name || null, text: info?.description || '', icon };
    } catch {
      return null;
    }
  };

  // Warcraft Logs lookups never hold a request up: its client pauses for up
  // to an hour when the hourly points run low (imports share them).
  const wclQuick = (text, ms = 8000) => {
    if (!wcl?.configured) return Promise.resolve(null);
    let timer;
    return Promise.race([
      wcl.query(text, {}, { quiet: true }).catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  // Warcraft Logs' game data knows every spell's icon (needs WCL set up).
  const wclSpell = async (id) => {
    if (!wcl?.configured) return null;
    try {
      const data = await wclQuick(`{ gameData { ability(id: ${Number(id)}) { id name icon } } }`);
      const ability = data?.gameData?.ability;
      const icon = /^([a-z0-9_-]+)(\.(jpg|png))?$/i.exec(String(ability?.icon || ''))?.[1]?.toLowerCase() || null;
      if (!icon || icon === 'inv_misc_questionmark') return ability?.name ? { id, name: ability.name, text: '', icon: null } : null;
      return { id, name: ability?.name || null, text: '', icon };
    } catch {
      return null;
    }
  };

  const inFlight = new Map();
  const fetchSpell = async (id, difficultyId) => {
    const fromWowhead = await fetchWowhead(id, difficultyId);
    if (fromWowhead?.icon) return { ...fromWowhead, checkedAt: Date.now() };
    // No icon from Wowhead (busy, blocked or doesn't know it): Blizzard's
    // spell data, then Warcraft Logs'.
    const others = [await blizzardSpell(id)];
    if (!others[0]?.icon) others.push(await wclSpell(id));
    const withIcon = others.find((o) => o?.icon);
    const any = withIcon || others.find(Boolean);
    if (any) {
      return {
        id,
        name: fromWowhead?.name || withIcon?.name || any.name || null,
        text: fromWowhead?.text || others.find((o) => o?.text)?.text || '',
        icon: withIcon?.icon || null,
        checkedAt: Date.now(),
      };
    }
    // Nobody knew it (or answered): remembered for a few hours so it
    // doesn't hold up every batch.
    return { ...(fromWowhead || {}), missing: true, checkedAt: Date.now() };
  };
  // Answers without an icon are asked again once a day.
  const stale = (hit) =>
    !hit.icon && Date.now() - (hit.checkedAt || 0) > (hit.missing ? NOT_FOUND_TTL : DAY);
  const wowheadWarned = new Set();
  // After Wowhead refuses or times out, leave it alone for a while so every
  // spell doesn't wait on it.
  let wowheadPausedUntil = 0;
  const fetchWowhead = async (id, difficultyId) => {
    if (Date.now() < wowheadPausedUntil) return null;
    await slot();
    try {
      const url = `${wowheadBase}/${id}?dataEnv=1&locale=0${difficultyId ? `&dd=${difficultyId}` : ''}`;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
      if (response.status === 404) return { missing: true };
      if (!response.ok) {
        if (response.status === 403 || response.status === 429 || response.status >= 500) {
          wowheadPausedUntil = Date.now() + 30 * 60 * 1000;
        }
        // Say so once per status, so a blocked Wowhead shows in the log.
        if (!wowheadWarned.has(response.status)) {
          wowheadWarned.add(response.status);
          console.warn(`[journal] Wowhead tooltips answered ${response.status}; using Blizzard / Warcraft Logs for spell icons.`);
        }
        return null; // try again another time
      }
      const body = await response.json();
      return {
        id,
        name: typeof body.name === 'string' ? body.name : null,
        text: tooltipText(body.tooltip),
        icon: typeof body.icon === 'string' && /^[a-z0-9_-]+$/i.test(body.icon) ? body.icon.toLowerCase() : null,
      };
    } catch {
      wowheadPausedUntil = Date.now() + 10 * 60 * 1000;
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
    if (cache[key] && !stale(cache[key])) return cache[key].missing ? null : cache[key];
    if (!inFlight.has(key)) {
      inFlight.set(
        key,
        fetchSpell(id, dd).then(async (value) => {
          inFlight.delete(key);
          if (value) {
            cache[key] = value;
            await saveSpells();
          } else if (cache[key]) {
            // Nobody answered: keep what we had, ask again tomorrow.
            cache[key].checkedAt = Date.now();
          }
          const kept = value || cache[key];
          return kept && !kept.missing ? kept : null;
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
  const spells = async (spellIds, difficultyId = null, budget = 24, waitMs = 4000) => {
    const ids = [...new Set(spellIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 400);
    const dd = Number(difficultyId) || 0;
    const cache = await spellsLoaded();
    const out = {};
    const todo = [];
    ids.forEach((id) => {
      const hit = cache[`${id}:${dd}`];
      if (hit && !stale(hit)) {
        if (!hit.missing) out[id] = hit;
      } else todo.push(id);
    });
    // What's cached goes back now; new lookups get a few seconds, and the
    // rest carry on in the background for the next call.
    const batch = todo.slice(0, budget);
    let done = 0;
    const jobs = batch.map((id) =>
      spell(id, dd).then((value) => {
        done += 1;
        if (value) out[id] = value;
      }),
    );
    let timer;
    await Promise.race([
      Promise.all(jobs),
      new Promise((resolve) => {
        timer = Number.isFinite(waitMs) ? setTimeout(resolve, waitMs) : null;
      }),
    ]);
    clearTimeout(timer);
    return { spells: { ...out }, pending: todo.length - done };
  };

  // ---- Items: name, quality, slot and icon -----------------------------------
  //
  // For the Logs page's gear widget: the combat log lists item IDs and item
  // levels only. Blizzard's item and item-media endpoints, once per item,
  // kept for good (a miss is asked again after a day).
  let itemCache = null;
  let itemSave = Promise.resolve();
  const ITEM_RETRY_MS = 24 * 60 * 60 * 1000;
  const fetchItem = async (id) => {
    try {
      const [item, media] = await Promise.all([api(`/data/wow/item/${id}`), api(`/data/wow/media/item/${id}`)]);
      if (!item) return { missing: true, checkedAt: Date.now() };
      const url = (media?.assets || []).find((a) => a.key === 'icon')?.value || '';
      const icon = url ? url.split('/').pop().replace(/\.(jpg|png)$/i, '') : null;
      return {
        name: item.name || '',
        quality: item.quality?.type || '',
        slot: item.inventory_type?.type || '',
        icon,
      };
    } catch {
      return { missing: true, checkedAt: Date.now() };
    }
  };
  const items = async (itemIds, budget = 30, waitMs = 5000) => {
    const ids = [...new Set(itemIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 400);
    itemCache ??= await readJson('items.json', {});
    const out = {};
    const todo = ids.filter((id) => {
      const hit = itemCache[id];
      if (hit && !(hit.missing && Date.now() - (hit.checkedAt || 0) > ITEM_RETRY_MS)) {
        if (!hit.missing) out[id] = hit;
        return false;
      }
      return true;
    });
    if (todo.length && configured) {
      const batch = todo.slice(0, budget);
      let done = 0;
      const jobs = (async () => {
        for (let i = 0; i < batch.length; i += 6) {
          // eslint-disable-next-line no-await-in-loop
          const got = await Promise.all(batch.slice(i, i + 6).map((id) => fetchItem(id).then((v) => [id, v])));
          got.forEach(([id, v]) => {
            itemCache[id] = v;
            if (!v.missing) out[id] = v;
            done += 1;
          });
        }
        itemSave = itemSave.then(() => writeJson('items.json', itemCache)).catch(() => {});
      })();
      let timer;
      await Promise.race([jobs, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
      clearTimeout(timer);
      return { items: { ...out }, pending: todo.length - done };
    }
    return { items: out, pending: configured ? 0 : todo.length };
  };

  // ---- Warcraft Logs' spell names --------------------------------------------
  //
  // Several spells often share a name (a talent's extra Eviscerate hit);
  // Warcraft Logs names them apart ("Eviscerate (Ancient Arts)"). Asked
  // once per spell, 30 to a query, and kept for good.
  let wclNames = null;
  let wclNamesSave = Promise.resolve();
  const names = async (spellIds) => {
    const ids = [...new Set(spellIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 120);
    wclNames ??= await readJson('wcl-names.json', {});
    const todo = ids.filter((id) => !(id in wclNames));
    if (todo.length && wcl?.configured) {
      for (let i = 0; i < todo.length; i += 30) {
        const chunk = todo.slice(i, i + 30);
        try {
          const fields = chunk.map((id) => `a${id}: ability(id: ${id}) { name }`).join(' ');
          const data = await wclQuick(`{ gameData { ${fields} } }`);
          if (!data) continue; // busy or paused: next time
          chunk.forEach((id) => {
            const name = data?.gameData?.[`a${id}`]?.name;
            wclNames[id] = typeof name === 'string' && name ? name : null;
          });
        } catch {
          // Leave them for next time.
        }
      }
      wclNamesSave = wclNamesSave.then(() => writeJson('wcl-names.json', wclNames)).catch(() => {});
      await wclNamesSave;
    }
    return { names: Object.fromEntries(ids.filter((id) => id in wclNames).map((id) => [id, wclNames[id]])) };
  };

  // ---- Icon images ----------------------------------------------------------
  //
  // Spell icons by name ("spell_holy_powerwordbarrier"), fetched once and
  // kept under journal/icons/ for good, so raiders' apps load them from this
  // server instead of each reaching Blizzard's or Wowhead's image servers.
  // Sources, first that has it:
  //   GUILD_CLOUD_ICON_DIR       a folder of icons on this machine, e.g. an
  //                              upscaled HD pack's ICONS folder. Any layout;
  //                              files named <icon>.blp/.tga/.png/.jpg (game
  //                              formats are turned into PNGs once, kept in
  //                              journal/icons-pack/)
  //   GUILD_CLOUD_ICON_PACK_URL  a URL template, {name} = icon name, for a
  //                              pack hosted as separate image files
  //   Blizzard's render server, then Wowhead's icon CDN.
  const ICON_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const iconDir = path.join(dir, 'icons');
  const packDir = env.GUILD_CLOUD_ICON_DIR || '';
  const iconSources = [
    env.GUILD_CLOUD_ICON_PACK_URL || '',
    'https://render.worldofwarcraft.com/us/icons/56/{name}.jpg',
    'https://wow.zamimg.com/images/wow/icons/large/{name}.jpg',
  ].filter(Boolean);
  const iconMissing = new Map(); // name -> when we last found nothing
  const iconFlight = new Map();
  const imageType = (bytes) => {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
    return null;
  };
  // The pack folder's files by icon name, read again when a name isn't
  // there and the last look was a while ago (a pack added without a restart).
  const PACK_EXTS = ['png', 'jpg', 'webp', 'blp', 'tga'];
  let packIndex = null;
  let packIndexedAt = 0;
  let packIndexing = null;
  const indexPack = async () => {
    const found = new Map();
    const walk = async (folder, depth) => {
      let entries = [];
      try {
        entries = await fsp.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          if (depth < 4) await walk(full, depth + 1);
          continue;
        }
        const m = /^(.+)\.([a-z]+)$/i.exec(entry.name);
        const ext = m?.[2].toLowerCase();
        if (!m || !PACK_EXTS.includes(ext)) continue;
        const key = m[1].toLowerCase();
        const known = found.get(key);
        // Browser formats first, then BLP, then TGA.
        if (!known || PACK_EXTS.indexOf(ext) < PACK_EXTS.indexOf(known.ext)) found.set(key, { file: full, ext });
      }
    };
    await walk(packDir, 0);
    packIndex = found;
  };
  // v2: TGAs whose alpha byte was all 0 had been saved as invisible PNGs.
  const packCacheDir = path.join(dir, 'icons-pack-v2');
  const readPack = async (name) => {
    if (!packDir) return null;
    const cached = await readIcon(packCacheDir, name);
    if (cached) return cached;
    // One walk of the folder at a time (a pack has tens of thousands of
    // files), at most every 10 minutes for names it doesn't have.
    if (!packIndex || (!packIndex.has(name) && Date.now() - packIndexedAt > 10 * 60 * 1000)) {
      if (!packIndexing) {
        packIndexedAt = Date.now();
        packIndexing = indexPack().finally(() => {
          packIndexing = null;
        });
      }
      await packIndexing;
    }
    const hit = packIndex.get(name);
    if (!hit) return null;
    try {
      const bytes = await fsp.readFile(hit.file);
      const png = ICON_TYPES[hit.ext] ? (imageType(bytes) ? bytes : null) : toPng(bytes, hit.ext);
      if (!png) return null;
      const ext = imageType(png);
      await fsp.mkdir(packCacheDir, { recursive: true });
      await fsp.writeFile(path.join(packCacheDir, `${name}.${ext}`), png);
      return { bytes: png, type: ICON_TYPES[ext] };
    } catch {
      return null;
    }
  };
  const readIcon = async (folder, name) => {
    for (const ext of Object.keys(ICON_TYPES)) {
      try {
        const bytes = await fsp.readFile(path.join(folder, `${name}.${ext}`));
        if (imageType(bytes)) return { bytes, type: ICON_TYPES[imageType(bytes)] };
      } catch {
        // Not this one.
      }
    }
    return null;
  };
  const downloadIcon = async (name) => {
    for (const template of iconSources) {
      try {
        const response = await fetchImpl(template.replaceAll('{name}', name), { signal: AbortSignal.timeout(10000) });
        if (!response.ok) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        const ext = imageType(bytes);
        if (!ext || bytes.length > 2 * 1024 * 1024) continue;
        await fsp.mkdir(iconDir, { recursive: true });
        await fsp.writeFile(path.join(iconDir, `${name}.${ext}`), bytes);
        return { bytes, type: ICON_TYPES[ext] };
      } catch {
        // Try the next source.
      }
    }
    return null;
  };

  /** An icon image by name: { bytes, type } or null. */
  const icon = async (rawName) => {
    const name = String(rawName || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,120}$/.test(name)) return null;
    const local = (await readPack(name)) || (await readIcon(iconDir, name));
    if (local) return local;
    if (Date.now() - (iconMissing.get(name) || 0) < NOT_FOUND_TTL) return null;
    if (!iconFlight.has(name)) {
      iconFlight.set(
        name,
        downloadIcon(name).then((found) => {
          iconFlight.delete(name);
          if (!found) iconMissing.set(name, Date.now());
          return found;
        }),
      );
    }
    return iconFlight.get(name);
  };

  /** The untouched API answer, for checking what Blizzard sends. */
  const raw = (journalId) => readJson(`raw-${Number(journalId)}.json`, null);

  // ---- Talent trees: what COMBATANT_INFO's talent IDs are ------------------
  //
  // The combat log lists each raider's talents as (node ID, entry ID, rank).
  // Blizzard's talent tree for their spec says which spell (and description,
  // with that rank's numbers) each node and entry is. Fetched once per spec
  // and kept for a week (talents change with patches).

  const TALENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const talentInFlight = new Map();

  /** Every node with its rank tooltips, wherever the API nests them. */
  const talentNodes = (tree) => {
    const out = {};
    const tooltipOf = (t) => {
      const spell = t?.spell_tooltip?.spell;
      if (!spell?.id) return null;
      return {
        entryId: Number(t?.talent?.id) || 0,
        spellId: Number(spell.id),
        name: spell.name || t?.talent?.name || '',
        text: String(t?.spell_tooltip?.description || ''),
      };
    };
    const walk = (value) => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (Number.isInteger(value.id) && Array.isArray(value.ranks)) {
        const ranks = value.ranks
          .map((r) => {
            const options = [r.tooltip, ...(r.choice_of_tooltips || [])].map(tooltipOf).filter(Boolean);
            return options.length ? { rank: Number(r.rank) || 1, options } : null;
          })
          .filter(Boolean);
        if (ranks.length) out[value.id] = ranks;
      }
      Object.values(value).forEach(walk);
    };
    walk(tree);
    return out;
  };

  const fetchTalents = async (specId) => {
    const index = await api('/data/wow/talent-tree/index');
    const hrefs = JSON.stringify(index || {}).match(/talent-tree\/\d+\/playable-specialization\/\d+/g) || [];
    const route = hrefs.find((h) => h.endsWith(`/playable-specialization/${specId}`));
    if (!route) return { specId, nodes: {} };
    const tree = await api(`/data/wow/${route}`);
    return { specId, nodes: talentNodes(tree) };
  };

  /** A spec's talent nodes: node ID -> ranks -> spells (with descriptions). */
  const talents = async (specIdValue) => {
    const specId = Number(specIdValue);
    if (!Number.isInteger(specId) || specId <= 0) return null;
    if (!configured) return null;
    const file = `talents-${specId}.json`;
    const cached = await readJson(file, null);
    if (cached && Date.now() - (cached.at || 0) < TALENT_TTL_MS) return cached;
    if (!talentInFlight.has(specId)) {
      talentInFlight.set(
        specId,
        fetchTalents(specId)
          .then(async (data) => {
            const value = { ...data, at: Date.now() };
            if (Object.keys(data.nodes).length) await writeJson(file, value);
            return value;
          })
          .catch(() => cached)
          .finally(() => talentInFlight.delete(specId)),
      );
    }
    return talentInFlight.get(specId);
  };

  return { configured, encounter, spell, spells, raw, talents, icon, names, items };
};
