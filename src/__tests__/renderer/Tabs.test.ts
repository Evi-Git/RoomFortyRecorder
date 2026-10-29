/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { AppState, Pages, StorageFilter } from '../../main/types';
import { VideoCategory } from '../../types/VideoCategory';
import { MAX_TABS, tabLabel, useTabs } from '../../renderer/tabs/tabs';

const initial = (): AppState =>
  ({
    page: Pages.Logs,
    category: VideoCategory.Raids,
    selectedVideos: [],
    multiPlayerMode: false,
    viewpointSelectionOpen: false,
    videoFilterTags: [],
    dateRangeFilter: { startDate: null, endDate: null },
    storageFilter: StorageFilter.BOTH,
    videoFullScreen: false,
    playing: false,
    language: 'English',
    cloudStatus: { enabled: false },
    diskStatus: { usage: 0, limit: 0 },
    chatOpen: false,
    preferredViewpoint: '',
  }) as unknown as AppState;

const video = (name: string) =>
  ({ videoName: name, encounterName: name, difficulty: 'Mythic' }) as never;

describe('tabs', () => {
  test('each tab keeps its own navigation; shared state is shared', () => {
    const { result } = renderHook(() => useTabs(initial()));
    const first = result.current.api.activeId;

    act(() => result.current.api.openTab({ page: Pages.PullDesk }));
    const second = result.current.api.activeId;
    expect(second).not.toBe(first);
    expect(result.current.appState.page).toBe(Pages.PullDesk);

    act(() =>
      result.current.setAppState((prev) => ({
        ...prev,
        diskStatus: { usage: 5, limit: 10 },
      })),
    );
    act(() => result.current.api.activate(first));
    expect(result.current.appState.page).toBe(Pages.Logs);
    expect(result.current.appState.diskStatus.usage).toBe(5);
  });

  test('a tab keeps the same AppState object while nothing changes', () => {
    const { result } = renderHook(() => useTabs(initial()));
    const tab = result.current.api.tabs[0];
    const before = result.current.appStateFor(tab);
    act(() => result.current.api.openTab({ page: Pages.PullDesk }));
    const same = result.current.api.tabs.find((t) => t.id === tab.id)!;
    expect(result.current.appStateFor(same)).toBe(before);
  });

  test('watch opens one watch tab per source and reuses it', () => {
    const { result } = renderHook(() => useTabs(initial()));
    const logs = result.current.api.activeId;
    const nav = (n: string) => ({
      page: Pages.None,
      category: VideoCategory.Raids,
      selectedVideos: [video(n)],
    });

    act(() => result.current.api.openWatch(logs, nav("Ula'tek"), 42));
    expect(result.current.api.tabs).toHaveLength(2);
    const watch = result.current.api.activeId;
    expect(result.current.activeTab.progress.current).toBe(42);
    expect(tabLabel(result.current.activeTab)).toBe("Ula'tek Mythic");

    act(() => result.current.api.activate(logs));
    act(() => result.current.api.openWatch(logs, nav('Kithix'), 100));
    expect(result.current.api.tabs).toHaveLength(2);
    expect(result.current.api.activeId).toBe(watch);
    expect(result.current.activeTab.progress.current).toBe(100);
    expect(result.current.activeTab.rev).toBe(1);
    expect(result.current.appState.selectedVideos[0].videoName).toBe(
      'Kithix',
    );
  });

  test('singleton pages have one tab; closing returns to the opener', () => {
    const { result } = renderHook(() => useTabs(initial()));
    const logs = result.current.api.activeId;
    act(() => result.current.api.openTab({ page: Pages.Settings }));
    const settings = result.current.api.activeId;
    act(() => result.current.api.activate(logs));
    act(() => result.current.api.openTab({ page: Pages.Settings }));
    expect(result.current.api.tabs).toHaveLength(2);
    expect(result.current.api.activeId).toBe(settings);

    act(() => result.current.api.close(settings));
    expect(result.current.api.activeId).toBe(logs);
  });

  test('closing the last tab leaves a fresh recordings tab', () => {
    const { result } = renderHook(() => useTabs(initial()));
    act(() => result.current.api.close(result.current.api.activeId));
    expect(result.current.api.tabs).toHaveLength(1);
    expect(result.current.appState.page).toBe(Pages.None);
  });

  test(`stops at ${MAX_TABS} tabs`, () => {
    const onLimit = jest.fn();
    const { result } = renderHook(() => useTabs(initial(), onLimit));
    for (let i = 0; i < MAX_TABS + 2; i++) {
      act(() => result.current.api.openTab());
    }
    expect(result.current.api.tabs).toHaveLength(MAX_TABS);
    expect(onLimit).toHaveBeenCalledTimes(3);
  });

  test('move reorders', () => {
    const { result } = renderHook(() => useTabs(initial()));
    const a = result.current.api.activeId;
    act(() => result.current.api.openTab({ page: Pages.PullDesk }));
    act(() => result.current.api.move(a, 1));
    expect(result.current.api.tabs[1].id).toBe(a);
  });
});
