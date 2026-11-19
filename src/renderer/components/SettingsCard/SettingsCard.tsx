import React from 'react';
import { cn } from '../utils';

/**
 * [RoomFortyRecorder] Design A settings layout: a section is a serif heading
 * over a card, and every setting is a row in that card (label and one help
 * line on the left, the control on the right).
 */

/** Look for inputs and select buttons inside a settings row. */
export const settingsFieldClass =
  'h-9 rounded-lg border-panel-line bg-walnut hover:bg-walnut';

/** Look for secondary buttons inside a settings row. */
export const settingsButtonClass =
  'h-9 rounded-lg border border-panel-line bg-panel-raised text-foreground-lighter hover:bg-panel-line';

/**
 * Ids for one pane. Hidden tabs stay mounted, so plain names would repeat;
 * `sid('name')` is unique to this pane instance.
 */
export function useScopedIds() {
  const base = React.useId();
  return (name: string) => `${base}-${name}`;
}

type SectionProps = {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function SettingsSection({ title, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      <h2 className="font-display text-lg font-bold text-foreground-lighter">
        {title}
      </h2>
      <div className="divide-y divide-panel-line rounded-lg border border-panel-line bg-panel">
        {children}
      </div>
    </section>
  );
}

type RowProps = {
  label: React.ReactNode;
  /** One plain sentence about what the setting does. */
  help?: React.ReactNode;
  /** The id of the control, so the label is its accessible name. */
  htmlFor?: string;
  /** For a control that must not take focus from a label click (paths,
   * hotkeys): the id of the label text; give the control aria-labelledby. */
  labelId?: string;
  /** Small status text next to the label. */
  aside?: React.ReactNode;
  /** Put the control under the text, full width (long lists, wide inputs). */
  stacked?: boolean;
  children?: React.ReactNode;
  className?: string;
};

export function SettingRow({
  label,
  help,
  htmlFor,
  labelId,
  aside,
  stacked = false,
  children,
  className,
}: RowProps) {
  const labelClass = 'text-sm font-medium text-foreground-lighter';
  return (
    <div
      className={cn(
        'gap-6 px-[18px] py-3.5',
        stacked ? 'flex flex-col gap-3' : 'flex items-center justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className={labelClass}>
              {label}
            </label>
          ) : (
            <span id={labelId} className={labelClass}>
              {label}
            </span>
          )}
          {aside}
        </div>
        {help && (
          <div className="mt-0.5 text-[13px] leading-snug text-foreground">
            {help}
          </div>
        )}
      </div>
      {children !== undefined && (
        <div
          className={cn(
            'flex items-center gap-2',
            stacked ? 'w-full' : 'shrink-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
