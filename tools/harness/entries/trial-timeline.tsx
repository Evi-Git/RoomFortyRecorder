import '../mock';
import { createRoot } from 'react-dom/client';
import React from 'react';
import TrialTimeline from 'renderer/toplogs/TrialTimeline';
import { asIs, MainCd, phasesOf } from 'renderer/toplogs/timeline';
import type { Track } from 'renderer/toplogs/trial';

// Time trial's timeline on made-up tracks whose cooldown casts are close
// together (every few seconds, and a cluster at the end), so labels that
// would overprint show. Scenes: toplogs-timeline-close-casts.
const DURATION = 300;
const names: Record<number, string> = {
  1: 'Fixture Avatar',
  2: 'Fixture Bladestorm',
  3: 'Fixture Warbreaker',
  9: 'Fixture Boss Smash',
};

const amounts = (rate: number) => {
  let sum = 0;
  return Array.from({ length: DURATION }, (_, i) => {
    sum += rate * (i % 60 < 15 ? 1.6 : 0.85);
    return Math.round(sum);
  });
};

const theirCasts: [number, number][] = [
  // Avatar: bursts of close casts.
  ...[6, 14, 22, 30, 38, 96, 99, 103, 185, 188, 192, 286, 291, 297].map(
    (t) => [t, 1] as [number, number],
  ),
  // Bladestorm: spread out, one pair close together.
  ...[20, 140, 143, 260].map((t) => [t, 2] as [number, number]),
  // Warbreaker: every 20 s.
  ...Array.from({ length: 13 }, (_, i) => [8 + i * 22, 3] as [number, number]),
];
const yourCasts: [number, number][] = theirCasts
  .filter((_, i) => i % 5 !== 3)
  .map(([t, id]) => [t + ((t * 7) % 9) - 3, id] as [number, number]);

const them: Track = {
  name: 'Fixture Player 02',
  duration: DURATION,
  amounts: amounts(640000),
  casts: theirCasts.sort((a, b) => a[0] - b[0]),
  names,
  phases: [
    [0, 1],
    [105, 2],
    [210, 3],
  ],
  phaseNames: { 1: 'Stage One', 2: 'Stage Two', 3: 'Stage Three' },
};
const you: Track = {
  name: 'Fixture Raider',
  duration: DURATION - 8,
  amounts: amounts(600000).slice(0, DURATION - 8),
  casts: yourCasts.sort((a, b) => a[0] - b[0]),
  names,
};
const cooldowns: MainCd[] = [1, 2, 3].map((id) => ({
  key: `n:${names[id].toLowerCase()}`,
  name: names[id],
  spellId: id,
  spellIds: [id],
  cooldown: 45,
}));
const boss = [
  { t: 4, spellId: 9, name: 'Fixture Boss Smash' },
  { t: 12, spellId: 9, name: 'Fixture Boss Smash' },
  { t: 40, spellId: 9, name: 'Fixture Boss Smash' },
  { t: 150, spellId: 9, name: 'Fixture Boss Smash' },
];

const Page = () => {
  const [marker, setMarker] = React.useState<number | null>(null);
  return (
    <div style={{ padding: 16 }}>
      <TrialTimeline
        you={you}
        them={them}
        aligned={asIs(them)}
        cooldowns={cooldowns}
        boss={boss}
        bossName="Fixture Boss"
        ourPhases={phasesOf(them)}
        theirPhases={phasesOf(them)}
        unit="DPS"
        marker={marker}
        setMarker={setMarker}
        onWatch={() => {}}
      />
    </div>
  );
};

createRoot(document.getElementById('root') as HTMLElement).render(<Page />);
