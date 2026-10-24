import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import CloudClient from 'storage/CloudClient';

/**
 * [RoomFortyRecorder] Spell ID -> icon name (e.g. 204018 ->
 * "spell_holy_blessingofprotection"), looked up from Wowhead's tooltip API
 * the first time a spell is seen and cached on disk. The renderer loads the
 * image itself from Wowhead's icon CDN, which Chromium caches.
 *
 * Nothing is bundled, so the installer doesn't grow. Offline, the timeline
 * falls back to coloured tiles.
 */

const TOOLTIP_API = 'https://nether.wowhead.com/tooltip/spell';
const CONCURRENCY = 6;
const TIMEOUT_MS = 6000;

// Spells Wowhead has no icon for are remembered as '' so we don't ask again.
type Cache = Record<string, string>;

export default class SpellIcons {
  private static instance: SpellIcons;

  private cache: Cache = {};

  private loaded: Promise<void> | null = null;

  private saveTimer: NodeJS.Timeout | null = null;

  private inFlight = new Map<number, Promise<void>>();

  private wowheadWarned = false;

  static getInstance() {
    if (!SpellIcons.instance) SpellIcons.instance = new SpellIcons();
    return SpellIcons.instance;
  }

  private file() {
    return path.join(app.getPath('userData'), 'spell-icons.json');
  }

  private load() {
    if (!this.loaded) {
      this.loaded = fs
        .readFile(this.file(), 'utf8')
        .then((text) => {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') this.cache = parsed;
        })
        .catch(() => {
          // No cache yet, or unreadable: start empty.
        });
    }
    return this.loaded;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      fs.writeFile(this.file(), JSON.stringify(this.cache)).catch((error) =>
        console.warn('[SpellIcons] Could not save cache', String(error)),
      );
    }, 2000);
  }

  private async fetchOne(spellId: number) {
    try {
      const response = await fetch(`${TOOLTIP_API}/${spellId}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 404) {
        this.cache[spellId] = '';
        this.scheduleSave();
        return;
      }

      if (!response.ok) {
        if (!this.wowheadWarned) {
          this.wowheadWarned = true;
          console.warn('[SpellIcons] Wowhead answered', response.status);
        }
        return; // Try again next time.
      }
      const body = (await response.json()) as { icon?: unknown };
      const icon = typeof body.icon === 'string' ? body.icon : '';
      this.cache[spellId] = /^[a-z0-9_-]+$/i.test(icon)
        ? icon.toLowerCase()
        : '';
      this.scheduleSave();
    } catch (error) {
      // Offline or timed out: leave it uncached so a later view retries.
      if (!this.wowheadWarned) {
        this.wowheadWarned = true;
        console.warn('[SpellIcons] Wowhead lookup failed:', String(error));
      }
    }
  }

  // When we last asked the guild server about a spell it didn't know.
  private serverAsked = new Map<number, number>();

  /**
   * The guild server's spell cache (shared by the guild, reaches Blizzard
   * and Warcraft Logs too). Answers within a few seconds with what it has.
   */
  private async fromServer(ids: number[]) {
    const client = CloudClient.getInstance();
    if (!client.pullDeskReady()) return;
    const now = Date.now();
    const ask = ids.filter(
      (id) => now - (this.serverAsked.get(id) ?? 0) > 20000,
    );
    if (!ask.length) return;
    ask.forEach((id) => this.serverAsked.set(id, now));
    try {
      const data = await client.pullDeskRequest<{
        spells: Record<string, { icon?: string | null }>;
      }>('post', '/journal/spells', { ids: ask }, { timeout: 15000 });
      Object.entries(data?.spells ?? {}).forEach(([id, info]) => {
        const icon = info?.icon;
        if (typeof icon === 'string' && /^[a-z0-9_-]+$/i.test(icon)) {
          this.cache[id] = icon.toLowerCase();
        }
      });
      this.scheduleSave();
    } catch (error) {
      // Server busy or offline: Wowhead below, and asked again later.
      console.warn('[SpellIcons] Guild server lookup failed:', String(error));
    }
  }

  /** Icon names for these spells; '' or missing means no icon. */
  async get(spellIds: number[]): Promise<Record<string, string>> {
    await this.load();

    const ids = [...new Set(spellIds)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    // The guild server first (quick once the guild has seen a spell), then
    // Wowhead directly for what it didn't have.
    const started = Date.now();
    const unknown = ids.filter((id) => !this.cache[id]).length;
    await this.fromServer(ids.filter((id) => !this.cache[id]));
    const serverMs = Date.now() - started;
    const missing = ids.filter((id) => this.cache[id] === undefined);

    // A few at a time, so a long fight's spell list doesn't hammer Wowhead.
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const id = missing[next];
        next += 1;
        let pending = this.inFlight.get(id);
        if (!pending) {
          pending = this.fetchOne(id).finally(() => this.inFlight.delete(id));
          this.inFlight.set(id, pending);
        }

        await pending;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const result: Record<string, string> = {};
    ids.forEach((id) => {
      if (this.cache[id]) result[id] = this.cache[id];
    });
    if (unknown) {
      // What the icon lookup did, for when icons don't show.
      console.info(
        `[SpellIcons] ${ids.length} asked, ${unknown} not cached:`,
        `guild server ${serverMs} ms,`,
        `Wowhead ${missing.length} in ${Date.now() - started - serverMs} ms,`,
        `${ids.length - Object.keys(result).length} still without an icon`,
      );
    }
    return result;
  }
}
