// Reads the spell cache (filled after a render) through useSpell, so the
// React Compiler must not memoize here (see CLAUDE.md).
'use no memo';

import React from 'react';
import { Ctx } from './query';
import { classColor } from './format';
import { GameIcon } from '../AbilityCard';
import { useSpell } from './SpellIcon';
import FloatingCard, { Anchor, anchorOf } from './Floating';
import { LayoutNode, loadTree, TalentTree } from './talents';

/**
 * [RoomFortyRecorder] Summary widget: a raider's talents drawn like the
 * game's talent page (and Wowhead's calculator): the class tree, the hero
 * tree they picked and the spec tree, with every node, what they took
 * (bright, with ranks) and what they didn't (dimmed). Talents are from the
 * pull's COMBATANT_INFO; the tree's layout from Blizzard via the guild
 * server.
 */

const CELL = 46;
const ICON = 34;
const BRASS = '#CCA85C';
const PARTIAL = '#4ade80';
const LINE_OFF = 'rgba(230, 222, 209, 0.14)';

type Taken = Map<number, { entryId: number; rank: number }>;

/** Grid columns and rows from the game's positions. */
const gridOf = (nodes: LayoutNode[]) => {
  // The usual gap between neighbouring columns (rows): some nodes sit
  // half a step over, so positions stay fractional.
  const step = (values: number[]) => {
    const u = [...new Set(values)].sort((a, b) => a - b);
    const count = new Map<number, number>();
    for (let i = 1; i < u.length; i += 1) {
      const d = u[i] - u[i - 1];
      if (d > 0) count.set(d, (count.get(d) ?? 0) + 1);
    }
    let best = 0;
    let seen = 0;
    count.forEach((n, d) => {
      if (n > seen || (n === seen && d < best)) {
        best = d;
        seen = n;
      }
    });
    return { min: u[0] ?? 0, step: best > 0 ? best : 1 };
  };
  const sx = step(nodes.map((n) => n.x));
  const sy = step(nodes.map((n) => n.y));
  const at = new Map(
    nodes.map((n) => [
      n.id,
      {
        col: (n.x - sx.min) / sx.step,
        row: (n.y - sy.min) / sy.step,
      },
    ]),
  );
  const cols =
    Math.ceil(Math.max(0, ...[...at.values()].map((p) => p.col))) + 1;
  const rows =
    Math.ceil(Math.max(0, ...[...at.values()].map((p) => p.row))) + 1;
  return { at, cols, rows };
};

const Node = ({
  node,
  taken,
  left,
  top,
}: {
  node: LayoutNode;
  taken: Taken;
  left: number;
  top: number;
}) => {
  const got = taken.get(node.id);
  const choice = node.entries.length > 1;
  const entry =
    (got && node.entries.find((e) => e.entryId === got.entryId)) ||
    node.entries[0];
  const spell = useSpell(entry?.spellId ?? 0);
  const [at, setAt] = React.useState<Anchor | null>(null);
  const rank = got ? Math.min(got.rank, node.maxRank) : 0;
  const full = got && rank >= node.maxRank;
  const shape =
    node.type === 'PASSIVE'
      ? 'rounded-full'
      : choice
        ? 'rounded-[10px]'
        : 'rounded-[5px]';
  return (
    <div
      className="absolute"
      style={{ left, top, width: ICON, height: ICON }}
      onMouseEnter={(e) => setAt(anchorOf(e.currentTarget))}
      onMouseLeave={() => setAt(null)}
    >
      <div
        className={`w-full h-full overflow-hidden bg-background ${shape}`}
        style={{
          border: `2px solid ${got ? (full ? BRASS : PARTIAL) : 'rgba(230,222,209,0.18)'}`,
          filter: got ? undefined : 'grayscale(1)',
          opacity: got ? 1 : 0.35,
        }}
      >
        <GameIcon icon={spell?.icon} className="w-full h-full" />
      </div>
      {node.maxRank > 1 && (
        <span
          className="absolute -bottom-1.5 -right-1.5 px-1 rounded text-[10px] leading-[14px] tabular-nums bg-background border border-card"
          style={{ color: got ? (full ? BRASS : PARTIAL) : undefined }}
        >
          {rank}/{node.maxRank}
        </span>
      )}
      {at && (
        <FloatingCard
          anchor={at}
          className="z-[100] w-[300px] rounded-md border border-card bg-background p-2.5 shadow-xl text-xs"
        >
          {node.entries.map((e) => {
            const picked = got && got.entryId === e.entryId;
            return (
              <div key={e.entryId || e.spellId} className="mb-1">
                <span
                  className="font-semibold text-sm"
                  style={{
                    color: picked || (got && !choice) ? BRASS : undefined,
                  }}
                >
                  {e.name || `Spell ${e.spellId}`}
                </span>
                {choice && (
                  <span className="text-foreground">
                    {picked ? ' · picked' : ' · not picked'}
                  </span>
                )}
              </div>
            );
          })}
          <div className="text-foreground">
            {got ? `Rank ${rank} of ${node.maxRank}` : 'Not taken'} · node{' '}
            {node.id}
          </div>
          {spell?.text && (
            <p className="m-0 mt-1 text-foreground-lighter whitespace-pre-line leading-snug">
              {spell.text}
            </p>
          )}
        </FloatingCard>
      )}
    </div>
  );
};

const Tree = ({
  title,
  nodes,
  taken,
}: {
  title: string;
  nodes: LayoutNode[];
  taken: Taken;
}) => {
  const { at, cols, rows } = React.useMemo(() => gridOf(nodes), [nodes]);
  if (!nodes.length) return null;
  const pad = 8;
  const width = cols * CELL + pad * 2;
  const height = rows * CELL + pad * 2;
  const center = (id: number) => {
    const p = at.get(id);
    return p
      ? [pad + p.col * CELL + ICON / 2, pad + p.row * CELL + ICON / 2]
      : null;
  };
  const ids = new Set(nodes.map((n) => n.id));
  const spent = nodes.reduce(
    (n, node) => n + Math.min(taken.get(node.id)?.rank ?? 0, node.maxRank),
    0,
  );
  return (
    <div className="flex flex-col gap-y-1">
      <div className="text-xs text-foreground">
        <span className="text-foreground-lighter font-semibold">{title}</span> ·{' '}
        {spent} points
      </div>
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0" width={width} height={height}>
          {nodes.flatMap((n) =>
            n.next
              .filter((to) => ids.has(to))
              .map((to) => {
                const a = center(n.id);
                const b = center(to);
                if (!a || !b) return null;
                const lit = taken.has(n.id) && taken.has(to);
                return (
                  <line
                    key={`${n.id}-${to}`}
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke={lit ? BRASS : LINE_OFF}
                    strokeWidth={lit ? 2.5 : 2}
                  />
                );
              }),
          )}
        </svg>
        {nodes.map((n) => {
          const p = at.get(n.id);
          if (!p) return null;
          return (
            <Node
              key={n.id}
              node={n}
              taken={taken}
              left={pad + p.col * CELL}
              top={pad + p.row * CELL}
            />
          );
        })}
      </div>
    </div>
  );
};

const TalentWidget = ({ ctx }: { ctx: Ctx }) => {
  const raiders = React.useMemo(() => {
    const out = new Map<
      string,
      {
        guid: string;
        name: string;
        specId: number;
        talents: [number, number, number][];
      }
    >();
    ctx.pulls.forEach((p) =>
      p.units.forEach((u) => {
        if (u.raider && u.player && u.talents?.length && u.specId)
          out.set(u.guid, {
            guid: u.guid,
            name: u.name,
            specId: u.specId,
            talents: u.talents,
          });
      }),
    );
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [ctx]);
  const [pick, setPick] = React.useState<string | null>(null);
  const raider = raiders.find((r) => r.guid === pick) ?? raiders[0];
  const [tree, setTree] = React.useState<{
    specId: number;
    tree: TalentTree | null;
  } | null>(null);
  const specId = raider?.specId ?? 0;
  React.useEffect(() => {
    if (!specId) return undefined;
    let cancelled = false;
    loadTree(specId).then((t) => {
      if (!cancelled) setTree({ specId, tree: t });
    });
    return () => {
      cancelled = true;
    };
  }, [specId]);
  if (!raider) return null;
  const taken: Taken = new Map(
    raider.talents.map(([node, entryId, rank]) => [node, { entryId, rank }]),
  );
  const current = tree && tree.specId === specId ? tree.tree : undefined;
  const layout = current?.layout;
  const hero = layout?.hero.find((h) => h.nodes.some((n) => taken.has(n.id)));
  return (
    <section className="rounded-md border border-card bg-background/40 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-card/40">
        <h4 className="m-0 text-sm font-semibold text-foreground-lighter">
          Talents
        </h4>
        <select
          className="h-7 px-2 rounded-md border border-background bg-card text-xs"
          style={{ color: classColor(raider.specId) }}
          value={raider.guid}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Raider"
        >
          {raiders.map((r) => (
            <option key={r.guid} value={r.guid}>
              {r.name}
            </option>
          ))}
        </select>
        {layout && (
          <span className="text-xs text-foreground">
            {layout.specName} {layout.className}
            {hero ? ` · ${hero.name}` : ''}
          </span>
        )}
      </div>
      <div className="p-3 overflow-x-auto">
        {current === undefined && (
          <p className="text-sm text-foreground m-0">Loading the tree…</p>
        )}
        {current === null && (
          <p className="text-sm text-foreground m-0">
            The guild server couldn&apos;t get this spec&apos;s talent tree
            (Blizzard API keys in its .env).
          </p>
        )}
        {current && !layout && (
          <p className="text-sm text-foreground m-0">
            Update the guild server to draw talent trees.
          </p>
        )}
        {layout && (
          <div className="flex flex-wrap gap-x-8 gap-y-4 items-start">
            <Tree title={layout.className} nodes={layout.class} taken={taken} />
            {hero && (
              <Tree title={hero.name} nodes={hero.nodes} taken={taken} />
            )}
            <Tree title={layout.specName} nodes={layout.spec} taken={taken} />
          </div>
        )}
      </div>
    </section>
  );
};

export default TalentWidget;
