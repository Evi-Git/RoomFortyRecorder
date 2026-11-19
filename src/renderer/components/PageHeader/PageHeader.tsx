import React from 'react';
import { cn } from '../utils';

/**
 * [RoomFortyRecorder] Design A ("Brass & Walnut everywhere"): a page's serif
 * title, its view tabs underlined in brass, and the page's actions on the
 * right, over one line. Sub-tabs inside a page use `UnderlineTabs` alone.
 */

export type TabItem<K extends string> = {
  key: K;
  label: React.ReactNode;
  /** Shown as a native tooltip and read by screen readers. */
  title?: string;
  disabled?: boolean;
};

type UnderlineTabsProps<K extends string> = {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** `md` for a page's views, `sm` for tabs inside a page (default). */
  size?: 'md' | 'sm';
  /** For screen readers, e.g. "Dashboard views". */
  label: string;
  className?: string;
};

export function UnderlineTabs<K extends string>({
  items,
  value,
  onChange,
  size = 'sm',
  label,
  className,
}: UnderlineTabsProps<K>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs, as in any tab list.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    for (let i = 1; i <= items.length; i += 1) {
      const next = (index + step * i + items.length) % items.length;
      if (!items[next].disabled) {
        onChange(items[next].key);
        refs.current[next]?.focus();
        return;
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex flex-wrap items-end',
        size === 'md' ? 'gap-x-6' : 'gap-x-5',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            tabIndex={active ? 0 : -1}
            title={item.title}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'inline-flex items-center gap-x-1.5 whitespace-nowrap font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm',
              'disabled:pointer-events-none disabled:opacity-50',
              size === 'md' ? 'h-[38px] text-sm' : 'h-9 text-[13px]',
              active
                ? 'text-foreground-lighter shadow-[inset_0_-2px_0_0_hsl(var(--brand))]'
                : 'text-foreground hover:text-foreground-lighter',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

type PageHeaderProps<K extends string> = {
  title: React.ReactNode;
  /** The page's views; leave out for a page without tabs. */
  tabs?: TabItem<K>[];
  tab?: K;
  onTab?: (key: K) => void;
  /** Right-hand side: buttons, pickers. */
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader<K extends string>({
  title,
  tabs,
  tab,
  onTab,
  actions,
  className,
}: PageHeaderProps<K>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-panel-line',
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-x-7 gap-y-1">
        <h1 className="pb-2.5 font-display text-[26px] font-bold leading-tight text-foreground-lighter">
          {title}
        </h1>
        {tabs && tab !== undefined && onTab && (
          <UnderlineTabs
            items={tabs}
            value={tab}
            onChange={onTab}
            size="md"
            label={typeof title === 'string' ? `${title} views` : 'Views'}
          />
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 pb-2">{actions}</div>
      )}
    </div>
  );
}
