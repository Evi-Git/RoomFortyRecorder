import { PropsWithChildren, ReactNode } from 'react';
import { useContext } from 'react';
import { SidebarRailContext, useMenuContext } from './Menu';
import { cn } from '../utils';

type MenuItemProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  className?: string;
  disabled?: boolean;
  /** Shown on hover when the sidebar is an icon strip. */
  label?: string;
  /** Icon strip only: a small dot for what a badge says (live, new). */
  railDot?: 'live' | 'brand';
};

const Root = ({
  value,
  className,
  children,
  disabled = false,
  label,
  railDot,
}: PropsWithChildren<MenuItemProps>) => {
  const { currentValue, onValueChange } = useMenuContext();
  const rail = useContext(SidebarRailContext);
  const active = currentValue === value && !disabled;
  // [RoomFortyRecorder] Design A: 36 px rows; the selected one gets the
  // raised panel, main-colour text, a brass icon and a 3 px brass bar at
  // the left edge. Icons are muted otherwise.
  return (
    <div
      className={cn(
        'group relative w-full flex flex-row bg-transparent rounded-md px-3 h-9 items-center transition-colors cursor-pointer',
        'text-foreground-lighter text-sm font-sans focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
        {
          'hover:bg-panel-raised/60': !active && !disabled,
          'bg-panel-raised font-medium': active,
          'opacity-50 cursor-not-allowed': disabled,
          // Icon strip: only the icon shows (text is sized away).
          'justify-center px-0 text-[0px] [&_*]:text-[0px] [&_button]:hidden [&_span]:!w-auto [&_.ml-auto]:hidden':
            rail,
        },
        className,
      )}
      title={rail ? label : undefined}
      data-rail={rail}
      data-active={active}
      onClick={
        disabled
          ? undefined
          : (e) => onValueChange(value, e.ctrlKey || e.metaKey)
      }
      // [RoomFortyRecorder] Middle-click opens in a new tab.
      onMouseDown={(e) => {
        if (e.button === 1 && !disabled) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && !disabled) onValueChange(value, true);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-current={active ? 'page' : undefined}
      onKeyDown={(e) => {
        if (disabled || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onValueChange(value, e.ctrlKey || e.metaKey);
        }
      }}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-brand"
        />
      )}
      {rail && railDot && (
        <i
          aria-hidden="true"
          data-rail-dot={railDot}
          className={cn(
            'absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full ring-2 ring-panel',
            railDot === 'live' ? 'bg-green-400' : 'bg-brand',
          )}
        />
      )}
      {children}
    </div>
  );
};

const Icon = ({ children }: { children: ReactNode }) => {
  return (
    <div className="mr-3 group-data-[rail=true]:mr-0 w-4 h-4 shrink-0 flex items-center justify-center text-foreground group-data-[active=true]:text-brand">
      {children}
    </div>
  );
};

type MenuBadgeProps = {
  value?: number;
};

// A count (videos in a category): quiet 12 px text, right-aligned, so brass
// is left for what's new.
const MenuBadge = ({ value }: MenuBadgeProps) => {
  return value ? (
    <span className="ml-auto text-xs tabular-nums text-foreground">
      {value <= 99999 ? value : '99999+'}
    </span>
  ) : null;
};

const Item = Object.assign(Root, { Icon, Badge: MenuBadge });

export default Item;
