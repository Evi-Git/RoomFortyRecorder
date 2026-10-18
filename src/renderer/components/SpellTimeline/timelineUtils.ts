import { SpellTimeline as SpellTimelineData } from 'main/types';

/**
 * [RoomFortyRecorder] Shared pieces of the spell timeline: row building,
 * colours, formatting and a localStorage wrapper that never throws.
 */

export type Row = {
  key: string;
  label: string;
  kind: 'boss' | 'enemy' | 'player';
  items: Item[];
};

export type Item = {
  start: number; // seconds
  end?: number; // seconds, for cast bars
  spellId: number;
  name: string;
  interrupted?: boolean;
};

export const KIND_LABEL: Record<Row['kind'], string> = {
  boss: 'Boss',
  enemy: 'Adds',
  player: 'You',
};

export const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; settings just won't persist.
    }
  },
};

export const spellColor = (spellId: number) => {
  const hue = (spellId * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 65% 55%)`;
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const fmt = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** Pair cast starts with their success into bars; leftovers are markers. */
export const buildRows = (timeline: SpellTimelineData): Row[] => {
  const perSource = new Map<number, Item[]>();

  timeline.sources.forEach((_, index) => perSource.set(index, []));
  const pending = new Map<string, number[]>(); // source:spell -> start times

  timeline.casts.forEach(([tenths, spellId, sourceIndex, kind]) => {
    const t = tenths / 10;
    const name = timeline.spells[String(spellId)] || String(spellId);
    const items = perSource.get(sourceIndex);
    if (!items) return;
    const pairKey = `${sourceIndex}:${spellId}`;

    if (kind === 0) {
      const list = pending.get(pairKey) || [];
      list.push(t);
      pending.set(pairKey, list);
      return;
    }

    const starts = pending.get(pairKey);
    const start = starts?.shift();

    if (start !== undefined && t - start <= 15) {
      items.push({ start, end: t, spellId, name });
    } else {
      items.push({ start: t, spellId, name });
    }
  });

  // Starts that never finished: interrupted or cancelled casts.
  pending.forEach((starts, pairKey) => {
    const [sourceIndex, spellId] = pairKey.split(':').map(Number);
    const name = timeline.spells[String(spellId)] || String(spellId);
    starts.forEach((start) =>
      perSource
        .get(sourceIndex)
        ?.push({ start, spellId, name, interrupted: true }),
    );
  });

  const rows: Row[] = [];
  const bossItems: Item[] = [];
  const enemyItems: Item[] = [];
  let bossLabel = 'Boss';

  timeline.sources.forEach((source, index) => {
    const items = perSource.get(index) || [];

    if (source.kind === 'boss') {
      bossItems.push(...items);
      bossLabel = source.name;
    } else if (source.kind === 'enemy') {
      enemyItems.push(...items);
    } else {
      rows.push({
        key: 'player',
        label: source.name || 'You',
        kind: 'player',
        items,
      });
    }
  });

  const sortByTime = (a: Item, b: Item) => a.start - b.start;
  const result: Row[] = [];
  if (bossItems.length)
    result.push({
      key: 'boss',
      label: bossLabel,
      kind: 'boss',
      items: bossItems.sort(sortByTime),
    });
  if (enemyItems.length)
    result.push({
      key: 'enemy',
      label: 'Adds',
      kind: 'enemy',
      items: enemyItems.sort(sortByTime),
    });
  return [
    ...result,
    ...rows.map((r) => ({ ...r, items: r.items.sort(sortByTime) })),
  ];
};
