import type { AuraTrack, TimelineData } from '../LogsTimeline';
import { mergeSpans } from './query';
import { K, PullStore } from './store';

/**
 * [RoomFortyRecorder] Logs page Timelines: one pull's cooldown casts, cooldown
 * buffs, Bloodlust and boss debuffs, in the shape the timeline views take.
 */

const LUST = new Set([2825, 32182, 80353, 264667, 390386, 466904, 444257]);
const MAX_COOLDOWN_CASTS = 8;

export const timelineOf = (p: PullStore): TimelineData => {
  const name = (u: number) => (u >= 0 ? p.units[p.units[u].root].name : '');
  // Casts per raider and spell.
  const casts = new Map<
    number,
    Map<number, { name: string; times: number[] }>
  >();
  for (let i = 0; i < p.n; i += 1) {
    if (p.k[i] !== K.CAST || p.s[i] < 0) continue;
    const root = p.units[p.s[i]].root;
    if (!p.units[root].raider) continue;
    const spell = p.spells[p.sp[i]];
    if (!spell) continue;
    const bySpell = casts.get(root) ?? new Map();
    const entry = bySpell.get(spell.id) ?? { name: spell.name, times: [] };
    entry.times.push(Math.round(p.t[i] * 10) / 10);
    bySpell.set(spell.id, entry);
    casts.set(root, bySpell);
  }
  const cooldowns = new Map<number, Set<number>>();
  const castRows = [...casts.entries()]
    .map(([unit, spells]) => {
      const picked = [...spells.entries()].filter(
        ([, s]) => s.times.length <= MAX_COOLDOWN_CASTS,
      );
      cooldowns.set(unit, new Set(picked.map(([id]) => id)));
      return {
        name: name(unit),
        specId: p.units[unit].specId,
        spells: picked
          .map(([spellId, s]) => ({ spellId, name: s.name, times: s.times }))
          .sort((a, b) => a.times[0] - b.times[0]),
      };
    })
    .filter((r) => r.spells.length)
    .sort((a, b) => a.name.localeCompare(b.name));

  type Agg = AuraTrack & { target: number; debuff: boolean };
  const auras = new Map<string, Agg>();
  p.auras.forEach((a) => {
    if (a.src < 0 || a.dst < 0) return;
    const caster = p.units[a.src].root;
    if (!p.units[caster].raider) return;
    const spell = p.spells[a.spell];
    if (!spell) return;
    const key = `${a.dst}|${spell.id}|${caster}`;
    const agg = auras.get(key) ?? {
      spellId: spell.id,
      name: spell.name,
      caster: name(caster),
      intervals: [],
      target: a.dst,
      debuff: a.debuff,
    };
    agg.intervals.push([
      Math.round(a.start * 10) / 10,
      Math.round(a.end * 10) / 10,
    ]);
    auras.set(key, agg);
  });

  const lust = new Map<number, AuraTrack>();
  const buffsBy = new Map<number, AuraTrack[]>();
  const bossDebuffs: AuraTrack[] = [];
  auras.forEach((agg, key) => {
    const intervals = mergeSpans(agg.intervals).filter(([s, e]) => e > s);
    if (!intervals.length) return;
    const track: AuraTrack = {
      spellId: agg.spellId,
      name: agg.name,
      caster: agg.caster,
      intervals,
    };
    if (agg.debuff) {
      if (agg.target === p.boss) bossDebuffs.push(track);
      return;
    }
    if (!p.units[agg.target].raider) return;
    if (LUST.has(agg.spellId)) {
      if (!lust.has(agg.spellId)) lust.set(agg.spellId, track);
      return;
    }
    const caster = Number(key.split('|')[2]);
    if (!cooldowns.get(caster)?.has(agg.spellId)) return;
    const up = intervals.reduce((n, [s, e]) => n + e - s, 0);
    if (up >= p.duration * 0.9) return;
    const list = buffsBy.get(agg.target) ?? [];
    list.push(track);
    buffsBy.set(agg.target, list);
  });
  const uptime = (t: AuraTrack) =>
    t.intervals.reduce((n, [s, e]) => n + e - s, 0);
  return {
    duration: p.duration,
    casts: castRows,
    buffs: [...buffsBy.entries()]
      .map(([unit, list]) => ({
        name: p.units[unit].name,
        specId: p.units[unit].specId,
        auras: list.sort((a, b) => a.intervals[0][0] - b.intervals[0][0]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    raidBuffs: [...lust.values()],
    bossDebuffs: bossDebuffs.sort((a, b) => uptime(b) - uptime(a)).slice(0, 40),
    deaths: p.deaths.map((d) => ({
      t: d.t,
      name: p.units[d.unit].name,
      spell: d.spell >= 0 ? (p.spells[d.spell]?.name ?? null) : null,
    })),
  };
};
