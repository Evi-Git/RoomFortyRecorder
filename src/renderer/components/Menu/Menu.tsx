/* eslint-disable @typescript-eslint/no-explicit-any */
// Disabled the above because the only other option here is to make this context
// with generics, which is just an unnecessary PITA.

import React, { PropsWithChildren, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils';

/**
 * [RoomFortyRecorder] True when the sidebar is folded down to an icon strip:
 * items show only their icon (name on hover) and section headings hide.
 */
export const SidebarRailContext = React.createContext(false);

const readFold = (key: string) => {
  try {
    return localStorage.getItem(`rf-menu-fold-${key}`) === '1';
  } catch {
    return false;
  }
};

const writeFold = (key: string, folded: boolean) => {
  try {
    localStorage.setItem(`rf-menu-fold-${key}`, folded ? '1' : '0');
  } catch {
    // Not remembered.
  }
};

type MenuProps = {
  initialValue?: any;
  onChange: (value: any) => void;
  className?: string;
  /** Section heading; clicking it folds the section away. */
  label?: ReactNode;
  /** Remembers the section's fold under this name. */
  foldKey?: string;
};

interface MenuContextType {
  currentValue?: any;
  onValueChange: (newValue: string) => void;
}

const MenuContext = React.createContext<MenuContextType>({
  onValueChange: () => {},
});

export const useMenuContext = (): MenuContextType => {
  const menuContext = React.useContext(MenuContext);

  if (!menuContext) {
    throw new Error(
      'useMenuContext has to be used within a MenuContextProvider',
    );
  }

  return menuContext;
};

export const Menu = ({
  initialValue,
  children,
  onChange,
  className,
  label,
  foldKey,
}: PropsWithChildren<MenuProps>) => {
  const [currentValue, setCurrentValue] = React.useState(initialValue);
  const rail = React.useContext(SidebarRailContext);
  const [folded, setFolded] = React.useState(() =>
    foldKey ? readFold(foldKey) : false,
  );
  const toggleFold = () => {
    setFolded((was) => {
      if (foldKey) writeFold(foldKey, !was);
      return !was;
    });
  };
  // In the icon strip every item shows, folded or not.
  const hidden = folded && !rail;

  const onValueChange = (newValue: string) => {
    setCurrentValue(newValue);
    onChange(newValue);
  };

  // This is a bit of a janky way to handle it I guess, but it accounts for
  // the fact that the two sections of content and settings are two different menus
  // so when one gets selected, the other needs to be cleared
  React.useEffect(() => {
    setCurrentValue(initialValue || undefined);
  }, [initialValue]);

  return (
    <div
      className={cn('flex flex-col items-center gap-y-0.5 w-full', className)}
    >
      {label !== undefined &&
        (rail ? (
          <div className="w-6 border-t border-card my-1" />
        ) : (
          <button
            type="button"
            onClick={toggleFold}
            aria-expanded={!hidden}
            className="group/label self-stretch flex items-center pl-3 pr-1 mb-1.5 text-xs font-semibold leading-none text-foreground hover:text-foreground-lighter font-sans"
          >
            <span>{label}</span>
            <ChevronDown
              size={14}
              className={cn(
                'ml-auto opacity-0 group-hover/label:opacity-100 transition-transform',
                { '-rotate-90 opacity-100': hidden },
              )}
            />
          </button>
        ))}
      <MenuContext.Provider value={{ currentValue, onValueChange }}>
        {!hidden && children}
      </MenuContext.Provider>
    </div>
  );
};

export const MenuLabel = ({ children }: { children: ReactNode }) => {
  return (
    <small className="text-xs font-semibold leading-none text-foreground pl-3 self-start font-sans mb-1.5">
      {children}
    </small>
  );
};

export default Menu;
