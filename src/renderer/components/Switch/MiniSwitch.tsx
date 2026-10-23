import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';

/**
 * [RoomFortyRecorder] A small on/off switch for table rows (include or
 * leave out a raider or a wipe cause).
 */
const MiniSwitch = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) => (
  <SwitchPrimitives.Root
    checked={checked}
    onCheckedChange={onChange}
    aria-label={label}
    title={label}
    onClick={(e) => e.stopPropagation()}
    className="inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand data-[state=checked]:bg-brand data-[state=unchecked]:bg-card"
  >
    <SwitchPrimitives.Thumb className="pointer-events-none block h-3 w-3 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitives.Root>
);

export default MiniSwitch;
