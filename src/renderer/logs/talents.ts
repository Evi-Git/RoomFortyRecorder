import React from 'react';
import { PullStore } from './store';

/**
 * [RoomFortyRecorder] Logs page: raiders' passive damage-reduction talents
 * (Elemental Warding, Elemental Resistance and the like). The combat log
 * lists talents as (node, entry, rank); the guild server turns a spec's
 * talent tree into spells and descriptions (Blizzard's data, cached), and
 * this reads "reduces ... damage taken by N%" out of those descriptions.
 */

export type TalentOption = {
  entryId: number;
  spellId: number;
  name: string;
  text: string;
};
type TalentTree = {
  specId: number;
  nodes: Record<string, { rank: number; options: TalentOption[] }[]>;
};

/** A passive reduction: share of damage it removes, for these schools. */
export type PassiveDr = {
  spellId: number;
  name: string;
  r: number;
  /** School bits it applies to (1 physical, 126 all magic, 127 all). */
  schools: number;
};

type Response<T> = { ok: true; data: T } | { ok: false; error: string };
const trees = new Map<number, Promise<TalentTree | null>>();

const loadTree = (specId: number) => {
  const known = trees.get(specId);
  if (known) return known;
  const job = (
    window.electron.ipcRenderer.invoke('pullDesk', [
      { action: 'talentTree', specId },
    ]) as Promise<Response<TalentTree>>
  )
    .then((r) => (r.ok ? r.data : null))
    .catch(() => null);
  trees.set(specId, job);
  // Don't keep a failure for the whole session.
  job.then((t) => {
    if (!t || !Object.keys(t.nodes || {}).length) trees.delete(specId);
  });
  return job;
};

const SCHOOL_WORDS: [RegExp, number][] = [
  [/\bphysical\b/i, 1],
  [/\bholy\b/i, 2],
  [/\bfire\b/i, 4],
  [/\bnature\b/i, 8],
  [/\bfrost\b/i, 16],
  [/\bshadow\b/i, 32],
  [/\barcane\b/i, 64],
  [/\bmagic(al)?\b/i, 126],
];

// Only reductions that are always on: "for 8 sec", "while", "after"... are
// cooldowns or procs (counted from their auras, if at all).
const CONDITIONAL =
  /\b(for \d+(\.\d+)? sec|while|after|when|if\b|chance|below|above|stack|nearby|within|during|each|instead|area|the next)\b/i;

/** "Reduces all magic damage taken by 4%." -> { r: 0.04, schools: 126 }. */
export const parseReduction = (text: string) => {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!])\s+/)
    .filter((s) => /damage (you )?tak(en|e)/i.test(s));
  for (const sentence of sentences) {
    if (CONDITIONAL.test(sentence)) continue;
    const m =
      /reduc\w*[^%.]*?by (\d+(?:\.\d+)?)%/i.exec(sentence) ??
      /(\d+(?:\.\d+)?)% (?:less|reduced)/i.exec(sentence);
    if (!m) continue;
    const r = Number(m[1]) / 100;
    if (!(r > 0 && r < 0.5)) continue;
    let schools = 0;
    SCHOOL_WORDS.forEach(([re, bits]) => {
      if (re.test(sentence)) schools |= bits;
    });
    return { r, schools: schools || 127 };
  }
  return null;
};

/** The talents a raider took, as spells. */
export const talentSpells = (
  talents: [number, number, number][],
  tree: TalentTree,
): TalentOption[] => {
  const out: TalentOption[] = [];
  talents.forEach(([node, entry, rank]) => {
    const ranks = tree.nodes[String(node)];
    if (!ranks?.length) return;
    const picked =
      ranks.find((r) => r.rank === rank) ??
      [...ranks].reverse().find((r) => r.rank <= rank) ??
      ranks[ranks.length - 1];
    const option =
      picked.options.find((o) => o.entryId === entry) ??
      (picked.options.length === 1 ? picked.options[0] : null);
    if (option) out.push(option);
  });
  return out;
};

/**
 * Raider guid -> their passive reduction talents, for these pulls. Loads
 * the talent trees of the raid's specs from the guild server when on.
 */
export const usePassiveTalents = (
  stores: PullStore[],
  enabled: boolean,
  skip: (spellId: number) => boolean,
) => {
  const [result, setResult] = React.useState<{
    key: string;
    drs: Map<string, PassiveDr[]>;
  } | null>(null);
  const key = stores.map((s) => s.id).join(',');
  React.useEffect(() => {
    if (!enabled || !stores.length) return undefined;
    let cancelled = false;
    const raiders = new Map<
      string,
      { specId: number; talents: [number, number, number][] }
    >();
    stores.forEach((p) =>
      p.units.forEach((u) => {
        if (u.raider && u.player && u.talents?.length && u.specId)
          raiders.set(u.guid, { specId: u.specId, talents: u.talents });
      }),
    );
    const specs = [...new Set([...raiders.values()].map((r) => r.specId))];
    Promise.all(
      specs.map((id) => loadTree(id).then((t) => [id, t] as const)),
    ).then((loaded) => {
      if (cancelled) return;
      const bySpec = new Map(loaded);
      const drs = new Map<string, PassiveDr[]>();
      raiders.forEach((r, guid) => {
        const tree = bySpec.get(r.specId);
        if (!tree) return;
        const list: PassiveDr[] = [];
        talentSpells(r.talents, tree).forEach((t) => {
          if (skip(t.spellId)) return;
          const dr = parseReduction(t.text);
          if (dr && !list.some((x) => x.spellId === t.spellId))
            list.push({ spellId: t.spellId, name: t.name, ...dr });
        });
        if (list.length) drs.set(guid, list);
      });
      setResult({ key, drs });
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for the pulls; `skip` is a fixed table lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return enabled && result?.key === key ? result.drs : null;
};
