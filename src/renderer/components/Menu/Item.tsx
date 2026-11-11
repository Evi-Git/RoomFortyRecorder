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
};

const Root = ({
  value,
  className,
  children,
  disabled = false,
  label,
}: PropsWithChildren<MenuItemProps>) => {
  const { currentValue, onValueChange } = useMenuContext();
  const rail = useContext(SidebarRailContext);
  const active = currentValue === value && !disabled;
  // [RoomFortyRecorder] Brass sidebar: compact rows; the selected one gets
  // a brass tint, a brass bar at its left edge and brass text and icon.
  return (
    <div
      className={cn(
        'group relative w-full flex flex-row bg-transparent rounded-md px-3 py-2 items-center transition-colors',
        'text-foreground-lighter/80 text-sm font-sans',
        {
          'hover:bg-card/50 hover:text-foreground-lighter':
            !active && !disabled,
          'bg-brand/15 text-brand font-semibold': active,
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
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-brand"
        />
      )}
      {children}
    </div>
  );
};

const Icon = ({ children }: { children: ReactNode }) => {
  return (
    <div className="mr-3 group-data-[rail=true]:mr-0 w-[18px] h-[18px] shrink-0 flex items-center justify-center opacity-70 group-data-[active=true]:opacity-100 group-data-[active=true]:text-brand">
      {children}
    </div>
  );
};

type MenuBadgeProps = {
  value?: number;
};

// A count (videos in a category): a quiet pill, so brass is left for
// what's new.
const MenuBadge = ({ value }: MenuBadgeProps) => {
  return value ? (
    <span className="ml-auto rounded-full bg-panel-line px-2 text-[11px] leading-[18px] font-semibold tabular-nums text-foreground">
      {value <= 99999 ? value : '99999+'}
    </span>
  ) : null;
};

const Item = Object.assign(Root, { Icon, Badge: MenuBadge });

export default Item;
