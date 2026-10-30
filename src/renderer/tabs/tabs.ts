/**
 * [RoomFortyRecorder] Browser-style tabs.
 *
 * Every tab keeps its own navigation (page, category, picked recording,
 * filters) and its own player position, and its page stays mounted while
 * hidden, so flipping between a recording, the Logs page and the Dashboard
 * keeps each one exactly where it was. Everything else in AppState (language,
 * cloud and disk status, preferred viewpoint) is shared by all tabs.
 */
import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  Pages,
  RendererVideo,
  StorageFilter,
} from '../../main/types';
import { VideoCategory } from '../../types/VideoCategory';

export const NAV_KEYS = [
  'page',
  'category',
  'selectedVideos',
  'multiPlayerMode',
  'viewpointSelectionOpen',
  'videoFilterTags',
  'dateRangeFilter',
  'storageFilter',
  'videoFullScreen',
  'playing',
  'chatOpen',
] as const;

type NavKey = (typeof NAV_KEYS)[number];
export type NavState = Pick<AppState, NavKey>;
type SharedState = Omit<AppState, NavKey>;

export type Tab = {
  id: string;
  nav: NavState;
  /** The tab's player position (its own persistentProgressRef). */
  progress: { current: number };
  /** Bumped to reload the tab's recordings page (e.g. a new Watch). */
  rev: number;
  /** The tab this one was opened from (focus returns there on close). */
  openerId?: string;
  /** The tab that this tab's "click to watch" opens recordings in. */
  watchTabId?: string;
  /** Set by the page (e.g. the Logs page's picked pull). */
  title?: string;
  /** shared + nav: the AppState this tab's pages see (same object until
   * either changes). */
  app?: AppState;
};

type TabsState = {
  shared: SharedState;
  tabs: Tab[];
  activeId: string;
};

export const MAX_TABS = 10;

/**
 * Pages that hold something only one copy of can use (the OBS preview, the
 * live connection, the instant replay buffer). There is at most one tab of
 * each, and it unmounts while hidden.
 */
export const SINGLETON_PAGES = new Set<Pages>([
  Pages.Settings,
  Pages.SceneEditor,
  Pages.InstantReplay,
  Pages.Live,
  Pages.Admin,
]);

export const defaultNav = (): NavState => ({
  page: Pages.None,
  category: VideoCategory.Raids,
  selectedVideos: [],
  multiPlayerMode: false,
  viewpointSelectionOpen: false,
  videoFilterTags: [],
  dateRangeFilter: { startDate: null, endDate: null },
  storageFilter: StorageFilter.BOTH,
  videoFullScreen: false,
  playing: false,
  chatOpen: false,
});

const pickNav = (state: AppState): NavState => {
  const nav = {} as Record<string, unknown>;
  NAV_KEYS.forEach((key) => {
    nav[key] = state[key];
  });
  return nav as NavState;
};

const pickShared = (state: AppState): SharedState => {
  const shared = { ...state } as Record<string, unknown>;
  NAV_KEYS.forEach((key) => {
    delete shared[key];
  });
  return shared as SharedState;
};

const sameKeys = (a: object, b: object, keys: readonly string[]) =>
  keys.every(
    (key) =>
      (a as Record<string, unknown>)[key] ===
      (b as Record<string, unknown>)[key],
  );

let nextId = 1;
const makeTab = (nav: NavState, extra: Partial<Tab> = {}): Tab => ({
  id: `tab-${nextId++}`,
  nav,
  progress: { current: 0 },
  rev: 0,
  ...extra,
});

/** Applies a setAppState update to one tab (and the shared state). */
const applyTo = (
  prev: TabsState,
  id: string,
  update: SetStateAction<AppState>,
): TabsState => {
  const index = prev.tabs.findIndex((t) => t.id === id);
  if (index < 0) return prev;
  const tab = prev.tabs[index];
  const merged = { ...prev.shared, ...tab.nav } as AppState;
  const next = typeof update === 'function' ? update(merged) : update;
  if (next === merged) return prev;

  const nav = pickNav(next);
  const shared = pickShared(next);
  const navChanged = !sameKeys(nav, tab.nav, NAV_KEYS);
  const sharedChanged = !sameKeys(
    shared,
    prev.shared,
    Object.keys(shared).concat(Object.keys(prev.shared)),
  );
  if (!navChanged && !sharedChanged) return prev;

  const nextShared = sharedChanged ? shared : prev.shared;
  const tabs = prev.tabs.map((t, i) => {
    if (i === index && navChanged) {
      return { ...t, nav, app: { ...nextShared, ...nav } as AppState };
    }
    if (sharedChanged) {
      return { ...t, app: { ...nextShared, ...t.nav } as AppState };
    }
    return t;
  });
  return { ...prev, tabs, shared: nextShared };
};

/** Fills in `app` for tabs that don't have it (new or re-navigated). */
const withApps = (state: TabsState): TabsState =>
  state.tabs.every((t) => t.app)
    ? state
    : {
        ...state,
        tabs: state.tabs.map((t) =>
          t.app ? t : { ...t, app: { ...state.shared, ...t.nav } as AppState },
        ),
      };

/** The words on a tab. */
export const tabLabel = (tab: Tab): string => {
  if (tab.title) return tab.title;
  const { nav } = tab;
  switch (nav.page) {
    case Pages.Logs:
      return 'Logs';
    case Pages.TopLogs:
      return 'Top logs';
    case Pages.PullDesk:
      return 'Dashboard';
    case Pages.Live:
      return 'Watch live';
    case Pages.InstantReplay:
      return 'Instant replay';
    case Pages.Settings:
      return 'Settings';
    case Pages.SceneEditor:
      return 'Scene';
    case Pages.Admin:
      return 'Admin';
    default: {
      const video: RendererVideo | undefined = nav.selectedVideos[0];
      if (!video) return nav.category;
      const name =
        video.encounterName || video.zoneName || video.videoName || '';
      const difficulty = video.difficulty ? ` ${video.difficulty}` : '';
      return `${name}${difficulty}` || nav.category;
    }
  }
};

export type OpenOptions = {
  /** Where the new tab's player starts (seconds). */
  progress?: number;
  /** Switch to the new tab (default true). */
  activate?: boolean;
};

export type TabsApi = {
  tabs: Tab[];
  activeId: string;
  /** Opens a tab (or focuses the one tab of a singleton page). */
  openTab: (nav?: Partial<NavState>, options?: OpenOptions) => void;
  /**
   * "Click to watch" from tab `sourceId`: opens the recording in that tab's
   * watch tab (made the first time, reused after) and switches to it.
   */
  openWatch: (
    sourceId: string,
    nav: Partial<NavState>,
    progress: number,
  ) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  cycle: (step: number) => void;
  move: (id: string, toIndex: number) => void;
  setTitle: (id: string, title: string | undefined) => void;
};

/** The whole tab set, its API, and an AppState + setter per tab. */
export const useTabs = (initial: AppState, onLimit?: () => void) => {
  const [state, setRawState] = useState<TabsState>(() => {
    const tab = makeTab(pickNav(initial));
    return withApps({
      shared: pickShared(initial),
      tabs: [tab],
      activeId: tab.id,
    });
  });
  // Every update leaves each tab with its merged AppState.
  const setState = useCallback(
    (update: (prev: TabsState) => TabsState) =>
      setRawState((prev) => withApps(update(prev))),
    [],
  );

  const onLimitRef = useRef(onLimit);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    onLimitRef.current = onLimit;
    stateRef.current = state;
  });

  // One setter per tab (new ones only when tabs open or close).
  const idsKey = state.tabs.map((t) => t.id).join(',');
  const setters = useMemo(() => {
    const map = new Map<string, Dispatch<SetStateAction<AppState>>>();
    idsKey.split(',').forEach((id) => {
      map.set(id, (update) => setState((prev) => applyTo(prev, id, update)));
    });
    return map;
  }, [idsKey, setState]);
  const setterFor = useCallback(
    (id: string) =>
      setters.get(id) ??
      ((update: SetStateAction<AppState>) =>
        setState((prev) => applyTo(prev, id, update))),
    [setters, setState],
  );

  // The active tab's setter: what App's IPC handlers and the sidebar use.
  const setActiveAppState: Dispatch<SetStateAction<AppState>> = useCallback(
    (update) => setState((prev) => applyTo(prev, prev.activeId, update)),
    [setState],
  );

  const appStateFor = useCallback(
    (tab: Tab): AppState =>
      tab.app ?? ({ ...state.shared, ...tab.nav } as AppState),
    [state.shared],
  );

  const openTab = useCallback<TabsApi['openTab']>(
    (nav, options = {}) => {
      const full = { ...defaultNav(), ...nav };
      const now = stateRef.current;
      const singleton =
        SINGLETON_PAGES.has(full.page) &&
        now.tabs.some((t) => t.nav.page === full.page);
      if (!singleton && now.tabs.length >= MAX_TABS) {
        onLimitRef.current?.();
        return;
      }
      const tab = makeTab(full);
      tab.progress.current = options.progress ?? 0;
      setState((prev) => {
        if (SINGLETON_PAGES.has(full.page)) {
          const existing = prev.tabs.find((t) => t.nav.page === full.page);
          if (existing) return { ...prev, activeId: existing.id };
        }
        if (prev.tabs.length >= MAX_TABS) return prev;
        tab.openerId = prev.activeId;
        // New tabs go right after the current one, like a browser.
        const at = prev.tabs.findIndex((t) => t.id === prev.activeId) + 1;
        const tabs = [...prev.tabs];
        tabs.splice(at, 0, tab);
        return {
          ...prev,
          tabs,
          activeId: options.activate === false ? prev.activeId : tab.id,
        };
      });
    },
    [setState],
  );

  const openWatch = useCallback<TabsApi['openWatch']>(
    (sourceId, nav, progress) => {
      const now = stateRef.current;
      const watchId = now.tabs.find((t) => t.id === sourceId)?.watchTabId;
      if (
        !now.tabs.some((t) => t.id === watchId && t.nav.page === Pages.None) &&
        now.tabs.length >= MAX_TABS
      ) {
        onLimitRef.current?.();
        return;
      }
      const fresh = makeTab(
        { ...defaultNav(), ...nav },
        { openerId: sourceId },
      );
      fresh.progress.current = progress;
      setState((prev) => {
        const source = prev.tabs.find((t) => t.id === sourceId);
        const full = { ...defaultNav(), ...nav };
        const reuse = prev.tabs.find(
          (t) => t.id === source?.watchTabId && t.nav.page === Pages.None,
        );
        if (reuse) {
          reuse.progress.current = progress;
          return {
            ...prev,
            activeId: reuse.id,
            tabs: prev.tabs.map((t) =>
              t.id === reuse.id
                ? { ...t, nav: full, rev: t.rev + 1, app: undefined }
                : t,
            ),
          };
        }
        if (prev.tabs.length >= MAX_TABS) return prev;
        const tab = fresh;
        const at = prev.tabs.findIndex((t) => t.id === sourceId) + 1;
        const tabs = prev.tabs.map((t) =>
          t.id === sourceId ? { ...t, watchTabId: tab.id } : t,
        );
        tabs.splice(at, 0, tab);
        return { ...prev, tabs, activeId: tab.id };
      });
    },
    [setState],
  );

  const activate = useCallback(
    (id: string) => {
      setState((prev) =>
        prev.activeId === id || !prev.tabs.some((t) => t.id === id)
          ? prev
          : { ...prev, activeId: id },
      );
    },
    [setState],
  );

  const close = useCallback(
    (id: string) => {
      setState((prev) => {
        const index = prev.tabs.findIndex((t) => t.id === id);
        if (index < 0) return prev;
        // The last tab can't close; it goes back to the recordings instead.
        if (prev.tabs.length === 1) {
          const tab = makeTab(defaultNav());
          return { ...prev, tabs: [tab], activeId: tab.id };
        }
        const closing = prev.tabs[index];
        const tabs = prev.tabs.filter((t) => t.id !== id);
        let { activeId } = prev;
        if (activeId === id) {
          const opener = tabs.find((t) => t.id === closing.openerId);
          activeId = (opener ?? tabs[Math.min(index, tabs.length - 1)]).id;
        }
        return { ...prev, tabs, activeId };
      });
    },
    [setState],
  );

  const cycle = useCallback(
    (step: number) => {
      setState((prev) => {
        const index = prev.tabs.findIndex((t) => t.id === prev.activeId);
        const n = prev.tabs.length;
        const next = prev.tabs[(((index + step) % n) + n) % n];
        return next.id === prev.activeId
          ? prev
          : { ...prev, activeId: next.id };
      });
    },
    [setState],
  );

  const move = useCallback(
    (id: string, toIndex: number) => {
      setState((prev) => {
        const from = prev.tabs.findIndex((t) => t.id === id);
        if (from < 0 || from === toIndex) return prev;
        const tabs = [...prev.tabs];
        const [tab] = tabs.splice(from, 1);
        tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
        return { ...prev, tabs };
      });
    },
    [setState],
  );

  const setTitle = useCallback(
    (id: string, title: string | undefined) => {
      setState((prev) => {
        const tab = prev.tabs.find((t) => t.id === id);
        if (!tab || tab.title === title) return prev;
        return {
          ...prev,
          tabs: prev.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
        };
      });
    },
    [setState],
  );

  const activeTab =
    state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];

  const api = useMemo<TabsApi>(
    () => ({
      tabs: state.tabs,
      activeId: state.activeId,
      openTab,
      openWatch,
      activate,
      close,
      cycle,
      move,
      setTitle,
    }),
    [
      state.tabs,
      state.activeId,
      openTab,
      openWatch,
      activate,
      close,
      cycle,
      move,
      setTitle,
    ],
  );

  return {
    api,
    activeTab,
    appState: appStateFor(activeTab),
    setAppState: setActiveAppState,
    appStateFor,
    setterFor,
  };
};

/** The tab set, for anything that opens or switches tabs. */
export const TabsContext = React.createContext<TabsApi | null>(null);

/** Which tab a component is in, and whether that tab is showing. */
export const TabContext = React.createContext<{ id: string; active: boolean }>({
  id: '',
  active: true,
});

/** Sets this tab's title while mounted (e.g. the Logs page's pull). */
export const useTabTitle = (title: string | undefined) => {
  const tabs = React.useContext(TabsContext);
  const { id } = React.useContext(TabContext);
  React.useEffect(() => {
    if (!tabs || !id) return undefined;
    tabs.setTitle(id, title);
    return () => tabs.setTitle(id, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, id]);
};
