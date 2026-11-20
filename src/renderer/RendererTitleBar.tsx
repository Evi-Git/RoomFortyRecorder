import React, { ComponentProps } from 'react';
import { Copy, Minus, X } from 'lucide-react';
import { cn } from './components/utils';
import KeyholeMark from './components/Brand/KeyholeMark';
import { setViewAs, usePermissions } from './usePermissions';

const ipc = window.electron.ipcRenderer;

const TitleBarButton = ({
  children,
  className,
  ...props
}: ComponentProps<'button'>) => {
  return (
    <button
      type="button"
      className={cn(
        'w-8 h-8 inline-flex items-center justify-center align-top bg-transparent border-0 text-foreground-lighter outline-none hover:bg-card',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
};

// [RoomFortyRecorder] The owner's "view as role" banner (Admin page).
const ViewAsBanner = () => {
  const permissions = usePermissions();
  if (!permissions?.viewAs) return null;
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 top-[4px] flex items-center gap-x-2 rounded-full bg-brand px-3 h-[24px] text-xs font-semibold text-background"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      Viewing as{' '}
      {permissions.viewAs === '@everyone' ? 'Everyone' : permissions.viewAs}
      <button
        type="button"
        onClick={() => setViewAs(null)}
        className="underline underline-offset-2"
      >
        Exit
      </button>
    </div>
  );
};

export default function RendererTitleBar() {
  const clickedHide = () => {
    ipc.sendMessage('window', ['minimize']);
  };

  const clickedResize = () => {
    ipc.sendMessage('window', ['resize']);
  };

  const clickedQuit = () => {
    ipc.sendMessage('window', ['quit']);
  };

  return (
    <div
      id="title-bar"
      className="w-full h-[32px] bg-background flex items-center justify-start px-4 pr-0 absolute top-0 left-0"
    >
      {/* [RoomFortyRecorder] Lockup sits over the sidebar, left aligned. */}
      <KeyholeMark size={18} className="text-brand mr-2" />
      <div className="text-sm whitespace-nowrap [html[data-rail='1']_&]:hidden">
        <span className="font-display font-semibold text-foreground-lighter">
          Room Forty
        </span>{' '}
        <span className="font-sans text-foreground">Toolkit</span>
      </div>
      <ViewAsBanner />
      {/* Above the tab strip and the pages: both are positioned layers that
          start at the top of the window and would otherwise cover these. */}
      <div id="title-bar-btns" className="absolute right-0 top-0 z-30 flex">
        <TitleBarButton
          id="min-btn"
          aria-label="Minimize"
          title="Minimize"
          onClick={clickedHide}
        >
          <Minus size={14} />
        </TitleBarButton>
        <TitleBarButton
          id="max-btn"
          aria-label="Maximize or restore"
          title="Maximize or restore"
          onClick={clickedResize}
        >
          <Copy size={12} />
        </TitleBarButton>
        <TitleBarButton
          id="close-btn"
          aria-label="Close"
          title="Close"
          className="hover:bg-destructive hover:text-white"
          onClick={clickedQuit}
        >
          <X size={14} />
        </TitleBarButton>
      </div>
    </div>
  );
}
