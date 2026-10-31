/**
 * [RoomFortyRecorder] Copy for NSRT (1.9.104): the Time trial's main
 * cooldowns as a Northern Sky Raid Tools reminder string, at the top
 * player's timings (or ours), by phase or from the pull.
 */
import React from 'react';
import { Check, ClipboardCopy, X } from 'lucide-react';
import SpellIcon from '../logs/SpellIcon';
import type { Track } from './trial';
import { castsFor, isCastOf, MainCd, Phase } from './timeline';
import { nsrtString } from './nsrt';

type Whose = 'theirs' | 'ours';
type Timing = 'phase' | 'pull';

const Seg = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string; off?: string }[];
  onChange: (v: T) => void;
}) => (
  <span className="inline-flex rounded border border-card overflow-hidden">
    {options.map((o) => (
      <button
        key={o.v}
        type="button"
        disabled={Boolean(o.off)}
        title={o.off}
        onClick={() => onChange(o.v)}
        className={`px-2.5 py-1 text-xs ${
          value === o.v
            ? 'bg-brand/20 text-foreground-lighter'
            : 'hover:bg-card/50'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {o.label}
      </button>
    ))}
  </span>
);

const CopyNsrt = ({
  you,
  them,
  cooldowns,
  theirPhases,
  ourPhases,
  encounterId,
  difficultyId,
  bossName,
  onClose,
}: {
  you: Track;
  them: Track;
  cooldowns: MainCd[];
  theirPhases: Phase[];
  ourPhases: Phase[];
  encounterId: number;
  difficultyId: number;
  bossName: string;
  onClose: () => void;
}) => {
  const [whose, setWhose] = React.useState<Whose>('theirs');
  const [timing, setTiming] = React.useState<Timing>('phase');
  const [tag, setTag] = React.useState(you.name);
  const [countdown, setCountdown] = React.useState(3);
  const [off, setOff] = React.useState<Set<string>>(new Set());
  const [copied, setCopied] = React.useState(false);

  const phases = whose === 'theirs' ? theirPhases : ourPhases;
  const byPhase = timing === 'phase' && phases.length > 1;
  const track = whose === 'theirs' ? them : you;
  const casts: [number, number][] = [];
  cooldowns
    .filter((cd) => !off.has(cd.key))
    .forEach((cd) => {
      // Show our raider's own spell ID for it when they have one.
      const ownId = you.casts.find(([, id]) =>
        isCastOf(cd, id, you.names),
      )?.[1];
      castsFor(track, cd).forEach((t) => casts.push([t, ownId ?? cd.spellId]));
    });
  const text = nsrtString({
    encounterId,
    difficultyId,
    bossName,
    tag: tag || you.name,
    casts,
    phases: byPhase ? phases : [],
    countdown,
  });
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };
  const field =
    'bg-card text-foreground-lighter rounded px-2 py-1 text-xs border border-background';

  return (
    <div className="rounded-lg border border-card bg-[#1E1A17] p-4 flex flex-col gap-y-3">
      <div className="flex items-center gap-x-2">
        <span className="font-semibold text-sm">Copy for NSRT</span>
        <span className="text-xs text-foreground">
          Northern Sky Raid Tools reminders: in game, /ns → Reminders → Import.
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded hover:bg-card/50"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-x-2">
          Timings
          <Seg<Whose>
            value={whose}
            onChange={setWhose}
            options={[
              { v: 'theirs', label: `Theirs (${them.name})` },
              { v: 'ours', label: `Ours (${you.name})` },
            ]}
          />
        </span>
        <span className="flex items-center gap-x-2">
          Times
          <Seg<Timing>
            value={phases.length > 1 ? timing : 'pull'}
            onChange={setTiming}
            options={[
              {
                v: 'phase',
                label: 'By phase',
                off:
                  phases.length > 1
                    ? undefined
                    : 'No phases for this pull: times are from the pull.',
              },
              { v: 'pull', label: 'From the pull' },
            ]}
          />
        </span>
        <label className="flex items-center gap-x-2">
          For
          <input
            className={`${field} w-32`}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            title="A character name (or an NSRT tag such as melee or healer)"
          />
        </label>
        <label className="flex items-center gap-x-2">
          Show
          <select
            className={field}
            value={countdown}
            onChange={(e) => setCountdown(Number(e.target.value))}
          >
            {[0, 3, 5, 8].map((n) => (
              <option key={n} value={n}>
                {n ? `${n} s countdown` : 'no countdown'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cooldowns.map((cd) => {
          const on = !off.has(cd.key);
          return (
            <button
              key={cd.key}
              type="button"
              onClick={() =>
                setOff((s) => {
                  const next = new Set(s);
                  if (on) next.add(cd.key);
                  else next.delete(cd.key);
                  return next;
                })
              }
              className={`flex items-center gap-x-1 rounded-full border px-2 py-0.5 text-xs ${
                on
                  ? 'border-foreground/40 text-foreground-lighter'
                  : 'border-card text-foreground/50'
              }`}
            >
              <SpellIcon spellId={cd.spellId} name={cd.name} />
              {cd.name || `Spell ${cd.spellId}`}
            </button>
          );
        })}
      </div>
      <textarea
        readOnly
        value={text}
        rows={Math.min(10, text.split('\n').length)}
        className="w-full rounded bg-background/60 border border-card p-2 font-mono text-[11px] text-foreground-lighter"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex items-center gap-x-3">
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-x-1.5 h-8 px-3 rounded border border-brand bg-brand/10 text-sm hover:bg-brand/20"
        >
          {copied ? (
            <Check size={14} className="text-brand" />
          ) : (
            <ClipboardCopy size={14} className="text-brand" />
          )}
          {copied ? 'Copied' : `Copy ${casts.length} reminders`}
        </button>
        <span className="text-xs text-foreground">
          {byPhase
            ? 'Phases follow your boss mod; if a phase doesn’t line up in game, use From the pull.'
            : 'Times from the pull.'}
        </span>
      </div>
    </div>
  );
};

export default CopyNsrt;
