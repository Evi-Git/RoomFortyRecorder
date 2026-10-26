import React from 'react';
import { Eye } from 'lucide-react';
import { Ctx } from './query';
import {
  DeathDetail,
  deathDetails,
  foldDeaths,
  killingBlows,
  RecapKind,
} from './deaths';
import { classColor, compact, ENEMY_COLOR, mmss, thousands } from './format';
import SpellIcon from './SpellIcon';

/**
 * [RoomFortyRecorder] Logs page Deaths tab (Warcraft Logs style): every
 * raider death in the pulls picked, with a death recap for the one chosen.
 */

const th = 'px-2 py-1.5 font-normal whitespace-nowrap text-left';
const td = 'px-2 py-1 tabular-nums whitespace-nowrap';

const KIND_LABEL: Record<RecapKind, string> = {
  damage: 'Damage',
  heal: 'Heal',
  shield: 'Shield',
  cast: 'Cast',
  buff: 'Defensive on',
  buffGone: 'Defensive off',
  debuff: 'Debuff',
};

const KIND_COLOR: Record<RecapKind, string> = {
  damage: 'hsl(0 65% 62%)',
  heal: 'hsl(140 50% 55%)',
  shield: 'hsl(200 60% 62%)',
  cast: 'hsl(var(--foreground-lighter))',
  buff: 'hsl(var(--brand))',
  buffGone: 'hsl(var(--foreground))',
  debuff: 'hsl(280 45% 68%)',
};

type Show = 'damage' | 'healing' | 'casts' | 'auras';
const SHOW_KINDS: Record<Show, RecapKind[]> = {
  damage: ['damage'],
  healing: ['heal', 'shield'],
  casts: ['cast'],
  auras: ['buff', 'buffGone', 'debuff'],
};
const SHOW_LABEL: Record<Show, string> = {
  damage: 'Damage',
  healing: 'Healing',
  casts: 'Their casts',
  auras: 'Defensives & debuffs',
};

const Box = ({
  title,
  right,
  children,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="rounded-md border border-card bg-background/40 overflow-hidden min-w-0">
    <div className="flex items-center gap-x-2 px-3 py-2 bg-card/40">
      <h4 className="m-0 text-sm font-semibold text-foreground-lighter">
        {title}
      </h4>
      {right && (
        <div className="ml-auto flex items-center gap-x-2">{right}</div>
      )}
    </div>
    <div className="p-2">{children}</div>
  </section>
);

const sourceColor = (r: { sourcePlayer: boolean; sourceSpec: number }) =>
  r.sourcePlayer ? classColor(r.sourceSpec) : ENEMY_COLOR;

const Recap = ({
  death,
  onWatch,
}: {
  death: DeathDetail;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const [seconds, setSeconds] = React.useState(10);
  const [show, setShow] = React.useState<Record<Show, boolean>>({
    damage: true,
    healing: true,
    casts: true,
    auras: true,
  });
  const kinds = new Set(
    (Object.keys(show) as Show[])
      .filter((k) => show[k])
      .flatMap((k) => SHOW_KINDS[k]),
  );
  const rows = death.recap
    .filter((r) => r.dt >= -seconds && kinds.has(r.kind))
    .reverse();
  const ready = death.available.filter((a) => a.status === 'ready');
  const field =
    'bg-card text-foreground-lighter rounded px-2 h-7 text-xs border border-background';
  return (
    <Box
      title={
        <span>
          <span style={{ color: classColor(death.specId) }}>{death.name}</span>{' '}
          <span className="font-normal text-foreground">
            died at {mmss(death.t)}
            {death.pullLabel ? ` · ${death.pullLabel}` : ''}
          </span>
        </span>
      }
      right={
        onWatch && (
          <button
            type="button"
            className="inline-flex items-center gap-x-1 text-xs text-brand hover:underline"
            onClick={() => onWatch(death.at - 5, death.name)}
            title="Open the recording 5 s before"
          >
            <Eye size={14} /> Watch
          </button>
        )
      }
    >
      <div className="flex flex-col gap-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded border border-card px-2 py-1">
            <div className="text-foreground">Killing blow</div>
            <div className="text-foreground-lighter font-semibold truncate">
              {death.killing
                ? `${death.killing.spell} · ${compact(death.killing.amount)}`
                : 'Unknown'}
            </div>
          </div>
          <div className="rounded border border-card px-2 py-1">
            <div className="text-foreground">Taken, last 5 s</div>
            <div className="text-foreground-lighter font-semibold tabular-nums">
              {compact(death.taken5)}
            </div>
          </div>
          <div className="rounded border border-card px-2 py-1">
            <div className="text-foreground">Healed, last 5 s</div>
            <div className="text-foreground-lighter font-semibold tabular-nums">
              {compact(death.healed5)}
            </div>
          </div>
          <div
            className="rounded border border-card px-2 py-1"
            title="Base cooldowns: talents can make them shorter"
          >
            <div className="text-foreground">Defensives ready</div>
            <div
              className={`font-semibold ${ready.length ? 'text-yellow-400' : 'text-foreground-lighter'}`}
            >
              {ready.length ? ready.length : 'None'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <div>
            <span className="text-foreground">Up when they died: </span>
            {death.up.length ? (
              death.up.map((a) => (
                <span
                  key={a.spellId}
                  className="inline-flex items-center gap-x-1 mr-2"
                >
                  <SpellIcon spellId={a.spellId} name={a.name} />
                  <span className="text-foreground-lighter">{a.name}</span>
                </span>
              ))
            ) : (
              <span className="text-foreground-lighter">no defensive</span>
            )}
          </div>
          <div>
            <span className="text-foreground">Pressed this pull: </span>
            <span className="text-foreground-lighter">
              {death.used.length
                ? death.used
                    .map((u) => `${u.ability} (${mmss(u.t)})`)
                    .join(', ')
                : 'nothing tracked'}
            </span>
          </div>
          <div>
            <span className="text-foreground">Still ready: </span>
            <span className={ready.length ? 'text-yellow-400' : ''}>
              {ready.length
                ? ready.map((a) => a.ability).join(', ')
                : 'nothing'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <select
            className={field}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            aria-label="Seconds before the death"
          >
            {[5, 10, 20, 30].map((s) => (
              <option key={s} value={s}>
                Last {s} s
              </option>
            ))}
          </select>
          {(Object.keys(SHOW_LABEL) as Show[]).map((k) => (
            <label
              key={k}
              className="inline-flex items-center gap-x-1 text-foreground"
            >
              <input
                type="checkbox"
                checked={show[k]}
                onChange={(e) =>
                  setShow((s) => ({ ...s, [k]: e.target.checked }))
                }
              />
              {SHOW_LABEL[k]}
            </label>
          ))}
        </div>

        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-foreground sticky top-0 bg-background">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Event</th>
                <th className={th}>Ability</th>
                <th className={th}>Source</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} w-[22%]`}>Health after</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.t}-${i}`}
                  className={`border-t border-card/50 ${onWatch ? 'cursor-pointer hover:bg-card/30' : ''}`}
                  onClick={() => onWatch?.(death.at + r.dt - 1, death.name)}
                  title={onWatch ? 'Watch this moment' : undefined}
                >
                  <td className={`${td} text-foreground font-mono`}>
                    {r.dt.toFixed(1)}s
                  </td>
                  <td className={td} style={{ color: KIND_COLOR[r.kind] }}>
                    {KIND_LABEL[r.kind]}
                  </td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-x-1.5">
                      {r.spellId > 0 && (
                        <SpellIcon spellId={r.spellId} name={r.spell} />
                      )}
                      <span className="text-foreground-lighter">
                        {r.spell || '–'}
                      </span>
                    </span>
                  </td>
                  <td
                    className={`${td} max-w-[140px] truncate`}
                    style={{ color: sourceColor(r) }}
                  >
                    {r.source}
                  </td>
                  <td
                    className={`${td} text-right`}
                    style={{ color: KIND_COLOR[r.kind] }}
                  >
                    {r.kind === 'damage' ||
                    r.kind === 'heal' ||
                    r.kind === 'shield'
                      ? `${r.kind === 'damage' ? '-' : '+'}${thousands(r.amount + r.absorbed)}`
                      : ''}
                    {r.crit && <span className="text-foreground"> *</span>}
                    {r.absorbed > 0 && r.kind === 'damage' && (
                      <span className="text-foreground">
                        {' '}
                        ({compact(r.absorbed)} absorbed)
                      </span>
                    )}
                    {r.overkill > 0 && (
                      <span className="text-red-400">
                        {' '}
                        ({compact(r.overkill)} overkill)
                      </span>
                    )}
                    {r.overheal > 0 && (
                      <span className="text-foreground">
                        {' '}
                        ({compact(r.overheal)} over)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {r.hp !== null && (
                      <span className="flex items-center gap-x-1.5">
                        <span className="flex-1 h-2 rounded bg-card overflow-hidden">
                          <span
                            className="block h-full"
                            style={{
                              width: `${r.hp}%`,
                              background:
                                r.hp > 50
                                  ? 'hsl(140 45% 45%)'
                                  : r.hp > 20
                                    ? 'hsl(40 80% 50%)'
                                    : 'hsl(0 65% 55%)',
                            }}
                          />
                        </span>
                        <span className="w-8 text-right tabular-nums text-foreground">
                          {r.hp}%
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-foreground">
                    Nothing in the last {seconds} s.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Box>
  );
};

const DeathsView = ({
  ctx,
  onWatch,
}: {
  ctx: Ctx;
  onWatch?: (t: number, name: string | null) => void;
}) => {
  const deaths = React.useMemo(() => deathDetails(ctx), [ctx]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [who, setWho] = React.useState('');
  const [openGroups, setOpenGroups] = React.useState<string[]>([]);
  const shown = who ? deaths.filter((d) => d.guid === who) : deaths;
  const current =
    shown.find((d) => d.key === picked) ?? (shown.length ? shown[0] : null);
  const multi = ctx.pulls.length > 1;
  const blows = killingBlows(shown);
  const people = [...new Map(deaths.map((d) => [d.guid, d])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const counts = new Map<string, number>();
  deaths.forEach((d) => counts.set(d.guid, (counts.get(d.guid) ?? 0) + 1));

  const renderRow = (d: DeathDetail) => {
    const ready = d.available.filter((a) => a.status === 'ready');
    const on = current?.key === d.key;
    return (
      <tr
        key={d.key}
        className={`cursor-pointer border-t border-card/50 ${on ? 'bg-card/60' : 'hover:bg-card/30'}`}
        onClick={() => setPicked(d.key)}
      >
        {multi && <td className={`${td} text-foreground`}>{d.pullLabel}</td>}
        <td className={`${td} text-foreground`}>{d.order}</td>
        <td className={`${td} text-foreground font-mono`}>{mmss(d.t)}</td>
        <td
          className={`${td} font-semibold`}
          style={{ color: classColor(d.specId) }}
        >
          {d.name}
        </td>
        <td className={`${td} max-w-[260px] truncate`}>
          {d.killing ? (
            <span className="inline-flex items-center gap-x-1.5">
              <SpellIcon spellId={d.killing.spellId} name={d.killing.spell} />
              <span className="text-foreground-lighter">{d.killing.spell}</span>
              {d.killing.source && (
                <span className="text-foreground text-xs">
                  {d.killing.source}
                </span>
              )}
            </span>
          ) : (
            <span className="text-foreground">Unknown</span>
          )}
        </td>
        <td className={`${td} text-right text-foreground`}>
          {d.killing?.overkill ? compact(d.killing.overkill) : ''}
        </td>
        <td
          className={`${td} text-right`}
          title={
            ready.length
              ? `Still ready: ${ready.map((a) => a.ability).join(', ')}`
              : 'Nothing ready'
          }
        >
          <span
            className={ready.length ? 'text-yellow-400' : 'text-foreground'}
          >
            {ready.length}
          </span>
        </td>
        <td className="px-1">
          {onWatch && (
            <button
              type="button"
              aria-label="Watch"
              title="Watch it (5 s before)"
              className="text-foreground hover:text-brand"
              onClick={(e) => {
                e.stopPropagation();
                onWatch(d.at - 5, d.name);
              }}
            >
              <Eye size={14} />
            </button>
          )}
        </td>
      </tr>
    );
  };

  if (!deaths.length)
    return (
      <p className="text-sm text-foreground m-1">
        Nobody died{ctx.filters.range ? ' in this slice' : ''}.
      </p>
    );

  return (
    <div className="flex flex-col gap-y-3">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        <Box title={`Killing blows (${shown.length} deaths)`}>
          <div className="flex flex-col gap-y-1 text-sm">
            {blows.slice(0, 8).map((b) => (
              <div key={b.spell} className="flex items-center gap-x-2">
                {b.spellId > 0 && (
                  <SpellIcon spellId={b.spellId} name={b.spell} />
                )}
                <span className="text-foreground-lighter">{b.spell}</span>
                <span className="text-foreground text-xs truncate">
                  {b.names.join(', ')}
                </span>
                <span className="ml-auto tabular-nums font-semibold text-foreground-lighter">
                  {b.count}
                </span>
              </div>
            ))}
          </div>
        </Box>
        <Box title="Deaths by raider">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setWho('')}
              className={`rounded px-2 py-0.5 border ${who === '' ? 'border-brand text-foreground-lighter' : 'border-card text-foreground'}`}
            >
              Everyone ({deaths.length})
            </button>
            {people.map((d) => (
              <button
                key={d.guid}
                type="button"
                onClick={() => setWho(who === d.guid ? '' : d.guid)}
                className={`rounded px-2 py-0.5 border ${who === d.guid ? 'border-brand' : 'border-card'}`}
                style={{ color: classColor(d.specId) }}
              >
                {d.name} ({counts.get(d.guid)})
              </button>
            ))}
          </div>
        </Box>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3 items-start">
        <Box title="Deaths">
          <div className="max-h-[640px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-foreground sticky top-0 bg-background">
                <tr>
                  {multi && <th className={th}>Pull</th>}
                  <th className={th}>#</th>
                  <th className={th}>Time</th>
                  <th className={th}>Raider</th>
                  <th className={th}>Killing blow</th>
                  <th className={`${th} text-right`}>Overkill</th>
                  <th className={`${th} text-right`} title="Base cooldowns">
                    Ready
                  </th>
                  <th className={th} aria-label="Watch" />
                </tr>
              </thead>
              <tbody>
                {foldDeaths(shown).map((group) => {
                  if (group.length === 1) return renderRow(group[0]);
                  const first = group[0];
                  const open = openGroups.includes(first.key);
                  return (
                    <React.Fragment key={`g-${first.key}`}>
                      <tr
                        className="cursor-pointer border-t border-card/50 hover:bg-card/30"
                        onClick={() =>
                          setOpenGroups((g) =>
                            open
                              ? g.filter((k) => k !== first.key)
                              : [...g, first.key],
                          )
                        }
                      >
                        {multi && (
                          <td className={`${td} text-foreground`}>
                            {first.pullLabel}
                          </td>
                        )}
                        <td className={`${td} text-foreground`}>
                          {first.order}
                        </td>
                        <td className={`${td} text-foreground font-mono`}>
                          {mmss(first.t)}
                        </td>
                        <td className={`${td} font-semibold text-red-400`}>
                          {group.length} raiders
                        </td>
                        <td className={`${td} max-w-[260px] truncate`}>
                          <span className="inline-flex items-center gap-x-1.5">
                            {first.killing && (
                              <SpellIcon
                                spellId={first.killing.spellId}
                                name={first.killing.spell}
                              />
                            )}
                            <span className="text-foreground-lighter">
                              {first.killing?.spell}
                            </span>
                          </span>
                        </td>
                        <td className={`${td} text-right text-foreground`} />
                        <td className={`${td} text-right text-foreground`}>
                          {
                            group.filter((d) =>
                              d.available.some(
                                (a) =>
                                  a.status === 'ready' && a.kind !== 'potion',
                              ),
                            ).length
                          }
                        </td>
                        <td className={`${td} text-xs text-brand`}>
                          {open ? 'Hide' : 'Show'}
                        </td>
                      </tr>
                      {open && group.map((d) => renderRow(d))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Box>
        {current && (
          <Recap key={current.key} death={current} onWatch={onWatch} />
        )}
      </div>
    </div>
  );
};

export default DeathsView;
