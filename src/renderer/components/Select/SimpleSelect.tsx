import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './Select';
import { settingsFieldClass } from '../SettingsCard/SettingsCard';
import { cn } from '../utils';

/**
 * [RoomFortyRecorder] The shared select for a plain list of choices: the
 * Radix `Select` styled like the ones on Settings, with the same call shape
 * as a native `<select>` (string value, `onChange(value)`).
 *
 * - An option may have the value `''` ("Everyone"): Radix can't hold an empty
 *   item value, so it is mapped to a placeholder token and back.
 * - A `value` of `''` with no such option shows `placeholder` ("Pick a role…").
 * - `groups` replaces the native `<optgroup>`.
 * - Name it with `aria-label` or by putting it inside a `<label>`.
 */

export type SelectOption = {
  /** React key when values can repeat across rows (defaults to the value). */
  key?: string;
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SelectGroupOptions = { label: string; options: SelectOption[] };

const EMPTY = '__rf-empty__';
const toItem = (value: string) => (value === '' ? EMPTY : value);
const fromItem = (value: string) => (value === EMPTY ? '' : value);

type Props = {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroupOptions[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Classes for the button (width, height, text size). */
  className?: string;
};

export function SimpleSelect({
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: Props) {
  const all = [...(options ?? []), ...(groups ?? []).flatMap((g) => g.options)];
  const hasEmptyOption = all.some((o) => o.value === '');
  // A value that isn't in the list shows the placeholder, as a native select
  // shows its first option.
  const known = all.some((o) => o.value === value);
  const current =
    known && (value !== '' || hasEmptyOption) ? toItem(value) : '';

  const item = (o: SelectOption) => (
    <SelectItem
      key={o.key ?? o.value}
      value={toItem(o.value)}
      disabled={o.disabled}
    >
      {o.label}
    </SelectItem>
  );

  return (
    <Select
      value={current}
      onValueChange={(next) => onChange(fromItem(next))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          settingsFieldClass,
          'w-auto min-w-[8rem] gap-x-2',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {(options ?? []).map(item)}
        {(groups ?? []).map((g) => (
          <SelectGroup key={g.label}>
            <SelectLabel className="pl-2 text-xs font-normal text-foreground">
              {g.label}
            </SelectLabel>
            {g.options.map(item)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
