import React from 'react';

/**
 * [RoomFortyRecorder] Design A segmented control: one bordered group, the
 * active part filled brass with walnut text. 34px tall (36px with `tall`,
 * to sit level with 36px inputs).
 */
export type SegmentItem<K extends string> = {
  key: K;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
};

export function Segmented<K extends string>({
  items,
  value,
  onChange,
  label,
  tall = false,
}: {
  items: SegmentItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** For screen readers, e.g. "Friendlies or enemies". */
  label: string;
  tall?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex ${
        tall ? 'h-9' : 'h-[34px]'
      } shrink-0 overflow-hidden rounded-lg border border-panel-line`}
    >
      {items.map((item) => {
        const on = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={on}
            data-state={on ? 'active' : 'inactive'}
            title={item.title}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={`inline-flex items-center gap-x-1.5 px-2.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'bg-brand text-walnut'
                : 'bg-panel text-foreground hover:text-foreground-lighter'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
