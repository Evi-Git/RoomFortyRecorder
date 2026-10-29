/**
 * [RoomFortyRecorder] The tab strip, in the title bar next to the sidebar.
 *
 * Click a tab to switch, middle-click or × to close, drag to reorder, + for
 * a new tab. Ctrl+Tab / Ctrl+Shift+Tab cycle, Ctrl+T opens, Ctrl+W closes,
 * Ctrl+1–9 jump.
 */
import React from 'react';
import {
  Castle,
  Clapperboard,
  HardHat,
  LayoutDashboard,
  Plus,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  Swords,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { Pages } from 'main/types';
import { VideoCategory } from 'types/VideoCategory';
import { cn } from '../components/utils';
import { Tab, tabLabel, TabsApi } from './tabs';

const ICON = 14;

const tabIcon = (tab: Tab) => {
  switch (tab.nav.page) {
    case Pages.Logs:
      return <ScrollText size={ICON} />;
    case Pages.PullDesk:
      return <LayoutDashboard size={ICON} />;
    case Pages.Live:
      return <Radio size={ICON} />;
    case Pages.InstantReplay:
      return <Video size={ICON} />;
    case Pages.Settings:
      return <Settings size={ICON} />;
    case Pages.SceneEditor:
      return <Wrench size={ICON} />;
    case Pages.Admin:
      return <ShieldCheck size={ICON} />;
    default:
      switch (tab.nav.category) {
        case VideoCategory.MythicPlus:
          return <Castle size={ICON} />;
        case VideoCategory.Clips:
          return <Clapperboard size={ICON} />;
        case VideoCategory.Manual:
          return <HardHat size={ICON} />;
        default:
          return <Swords size={ICON} />;
      }
  }
};

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

const TabStrip = ({ tabs }: { tabs: TabsApi }) => {
  const { activeId, activate, close, openTab, move } = tabs;
  const [dragId, setDragId] = React.useState<string | null>(null);

  // Keyboard shortcuts, like a browser.
  const latest = React.useRef(tabs);
  React.useLayoutEffect(() => {
    latest.current = tabs;
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const t = latest.current;
      if (e.key === 'Tab') {
        t.cycle(e.shiftKey ? -1 : 1);
      } else if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        t.openTab();
      } else if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        t.close(t.activeId);
      } else if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
        const index = e.key === '9' ? t.tabs.length - 1 : Number(e.key) - 1;
        const tab = t.tabs[index];
        if (!tab) return;
        t.activate(tab.id);
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="absolute top-0 left-0 right-[104px] h-[32px] flex items-end gap-x-0.5 pl-1 z-20 overflow-hidden">
      {tabs.tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const label = tabLabel(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={label}
            draggable
            style={noDrag}
            onMouseDown={(e) => {
              if (e.button === 0) activate(tab.id);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(tab.id);
              }
            }}
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              if (dragId !== tab.id) move(dragId, index);
            }}
            onDragEnd={() => setDragId(null)}
            className={cn(
              'group relative flex items-center gap-x-1.5 h-[27px] min-w-[72px] max-w-[200px] flex-1 basis-[200px] pl-2.5 pr-1 rounded-t-md text-xs font-sans cursor-default select-none transition-colors',
              active
                ? 'bg-background-higher text-foreground-lighter'
                : 'text-foreground hover:bg-card/50 hover:text-foreground-lighter',
              dragId === tab.id && 'opacity-60',
            )}
          >
            {active && (
              <span className="absolute top-0 left-2 right-2 h-[2px] rounded-b bg-brand" />
            )}
            <span
              className={cn(
                'shrink-0 flex',
                active ? 'text-brand' : 'opacity-70',
              )}
            >
              {tabIcon(tab)}
            </span>
            <span className="truncate flex-1">{label}</span>
            <button
              type="button"
              aria-label={`Close ${label}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                close(tab.id);
              }}
              className={cn(
                'shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded hover:bg-card',
                active ? 'opacity-80' : 'opacity-0 group-hover:opacity-80',
              )}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        style={noDrag}
        onClick={() => openTab()}
        className="shrink-0 mb-[3px] ml-0.5 w-[24px] h-[24px] flex items-center justify-center rounded-md text-foreground hover:bg-card/50 hover:text-foreground-lighter"
      >
        <Plus size={14} />
      </button>
    </div>
  );
};

export default TabStrip;
