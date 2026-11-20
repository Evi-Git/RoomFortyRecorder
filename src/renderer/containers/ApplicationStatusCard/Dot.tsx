import { cn } from 'renderer/components/utils';
import type { Tone } from 'renderer/sidebarStatus';

/**
 * [RoomFortyRecorder] The 8 px dot on the sidebar's status card: green
 * ready, brass busy, red broken, yellow needs a look, grey nothing to say.
 */
const TONES: Record<Tone, string> = {
  good: 'bg-success shadow-[0_0_0_3px_rgba(45,216,127,0.18)]',
  brass: 'bg-brand shadow-[0_0_0_3px_rgba(204,168,92,0.2)]',
  bad: 'bg-error-text shadow-[0_0_0_3px_rgba(240,98,98,0.2)]',
  warn: 'bg-yellow-400 shadow-[0_0_0_3px_rgba(250,204,21,0.18)]',
  quiet: 'bg-foreground',
};

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-foreground-lighter',
  brass: 'text-foreground-lighter',
  bad: 'text-error-text',
  warn: 'text-yellow-400',
  quiet: 'text-foreground',
};

const Dot = ({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    data-tone={tone}
    className={cn(
      'inline-block h-2 w-2 shrink-0 rounded-full',
      TONES[tone],
      pulse && 'animate-pulse',
      className,
    )}
  />
);

export default Dot;
