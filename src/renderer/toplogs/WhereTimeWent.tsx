/**
 * [RoomFortyRecorder] "Where the time went", option A (1.9.103): what cost
 * the most, biggest first. Show highlights it on the timeline above; Watch
 * opens our VoD there.
 */
import React from 'react';
import { Play } from 'lucide-react';
import SpellIcon from '../logs/SpellIcon';
import { compact, mmss } from '../logs/format';
import { byKind, Finding, KINDS } from './whereTime';

const BAD = '#E57F7F';
const GOOD = '#5FBF7F';

const WhereTimeWent = ({
  list,
  gapEnd,
  shown,
  onShow,
  onWatch,
  watchTip,
  amount,
}: {
  /** "damage" or "healing". */
  amount: string;
  list: Finding[];
  /** You minus them at the end of the shorter pull. */
  gapEnd: number;
  /** The finding shown on the timeline (by index), or null. */
  shown: number | null;
  onShow: (i: number | null) => void;
  onWatch?: (t: number) => void;
  watchTip: string;
}) => {
  const total = list.reduce((s, f) => s + f.cost, 0);
  const kinds = byKind(list);
  const top = list[0]?.cost ?? 1;
  const behind = gapEnd < 0;
  const card = 'rounded-lg border border-card bg-[#1E1A17] px-4 py-3.5';
  const cols =
    'grid grid-cols-[32px_minmax(180px,240px)_minmax(0,1fr)_150px_56px_140px] gap-x-3.5 items-center';

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-baseline gap-x-3">
        <span className="font-display text-lg font-bold">
          Where the time went
        </span>
        <span className="text-xs text-foreground">
          {`Their ${amount} minus yours over each finding's window. Cooldowns pressed together share the seconds they cover.`}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 items-stretch">
        <div className={`${card} flex-[0_0_240px] flex flex-col gap-y-1.5`}>
          <span className="text-xs text-foreground">
            {behind ? 'Behind at the end' : 'Ahead at the end'}
          </span>
          <span
            className="text-3xl font-bold tabular-nums"
            style={{ color: behind ? BAD : GOOD }}
          >
            {`${behind ? '−' : '+'}${compact(Math.abs(gapEnd))}`}
          </span>
          <span className="text-xs text-foreground">
            {list.length
              ? `${list.length} finding${list.length > 1 ? 's' : ''} below cost −${compact(total)}${
                  total > Math.abs(Math.min(0, gapEnd)) + 1
                    ? '; you made some of it back elsewhere'
                    : ''
                }.`
              : 'Nothing cost you much.'}
          </span>
        </div>
        {kinds.length > 0 && (
          <div
            className={`${card} flex-[1_1_480px] min-w-0 flex flex-col gap-y-2.5`}
          >
            <span className="text-xs text-foreground">
              Where it went, by kind
            </span>
            <div className="flex gap-x-0.5 rounded overflow-hidden">
              {kinds.map((k) => (
                <span
                  key={k.kind}
                  className="h-3.5"
                  style={{
                    width: `${(k.cost / total) * 100}%`,
                    background: KINDS[k.kind].color,
                  }}
                  title={`${KINDS[k.kind].label}: −${compact(k.cost)}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {kinds.map((k) => (
                <span key={k.kind} className="flex items-center gap-x-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: KINDS[k.kind].color }}
                  />
                  {KINDS[k.kind].label}{' '}
                  <b className="tabular-nums">{`−${compact(k.cost)}`}</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {list.length > 0 && (
        <div className="rounded-lg border border-card bg-[#1E1A17] overflow-x-auto">
          <div className="min-w-[900px]">
            <div
              className={`${cols} px-4 py-2 text-xs text-foreground border-b border-card`}
            >
              <span>#</span>
              <span>Cooldown</span>
              <span>What happened</span>
              <span>Cost</span>
              <span>From</span>
              <span />
            </div>
            {list.map((f, i) => {
              const kind = KINDS[f.kind];
              const on = shown === i;
              return (
                <div
                  key={`${f.kind}:${f.key ?? ''}:${f.at}`}
                  className={`${cols} px-4 py-3 border-b border-[#2A2521] ${
                    on ? 'bg-brand/10' : ''
                  }`}
                >
                  <span className="text-lg font-bold text-[#8C8276]">
                    {i + 1}
                  </span>
                  <span className="flex items-center gap-x-2.5 min-w-0">
                    {f.spellId ? (
                      <SpellIcon spellId={f.spellId} name={f.title} />
                    ) : (
                      <span className="w-[18px] h-[18px] rounded-[3px] bg-card flex-none" />
                    )}
                    <span className="flex flex-col gap-y-1 min-w-0">
                      <span className="font-semibold text-sm truncate">
                        {f.title}
                      </span>
                      <span
                        className="self-start rounded-full px-2 py-px text-[11px] font-semibold text-[#171412]"
                        style={{ background: kind.color }}
                      >
                        {kind.label}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-col gap-y-0.5 text-[13px] leading-snug">
                    <span>{f.what}</span>
                    <span className="text-xs text-foreground">{f.why}</span>
                  </span>
                  <span className="flex flex-col gap-y-1">
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: BAD }}
                    >
                      {`−${compact(f.cost)}`}
                      <span className="font-normal text-xs text-foreground">
                        {` · ${Math.round((f.cost / total) * 100)}%`}
                      </span>
                    </span>
                    <span className="h-1.5 rounded bg-[#231F1C]">
                      <span
                        className="block h-1.5 rounded"
                        style={{
                          width: `${Math.round((f.cost / top) * 100)}%`,
                          background: kind.color,
                        }}
                      />
                    </span>
                  </span>
                  <span className="text-[13px] tabular-nums">{mmss(f.at)}</span>
                  <span className="flex gap-x-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => onShow(on ? null : i)}
                      className={`px-2.5 py-1.5 rounded-md border text-xs ${
                        on
                          ? 'border-brand text-foreground-lighter'
                          : 'border-card hover:bg-card/50'
                      }`}
                    >
                      {on ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      disabled={!onWatch}
                      title={watchTip}
                      onClick={() => onWatch?.(Math.max(0, f.at - 3))}
                      className="flex items-center gap-x-1 px-2.5 py-1.5 rounded-md border border-brand bg-brand/10 text-xs hover:bg-brand/20 disabled:border-card disabled:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Play size={11} className="text-brand" />
                      Watch
                    </button>
                  </span>
                </div>
              );
            })}
            <div className="px-4 py-2.5 text-xs text-foreground">
              Biggest first. Show highlights it on the timeline above; Watch
              opens our VoD there.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhereTimeWent;
