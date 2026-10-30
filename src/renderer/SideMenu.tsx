import {
  Castle,
  Clapperboard,
  ClipboardList,
  Cog,
  FileText,
  HardHat,
  MonitorCog,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Radio,
  ScrollText,
  Trophy,
  ShieldCheck,
  Square,
  Swords,
  Tv,
} from 'lucide-react';
import {
  ActivityStatus,
  CombatLoggingStatus,
  AppState,
  ErrorReport,
  InstantReplayState,
  MicStatus,
  Pages,
  RecStatus,
  SaveStatus,
} from 'main/types';
import {
  Dispatch,
  RefObject,
  SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ConfigurationSchema } from 'config/configSchema';
import {
  getLocaleCategoryLabel,
  getLocalePhrase,
} from 'localisation/translations';
import { VideoCategory } from '../types/VideoCategory';
import { setConfigValue } from './useSettings';
import { getCategoryIndex } from './rendererutils';
import Menu from './components/Menu';
import { SidebarRailContext } from './components/Menu/Menu';
import Separator from './components/Separator/Separator';
import TestButton from './TestButton';
import BugButton from './BugButton';
import LiveButton from './LiveButton';
import ApplicationStatusCard from './containers/ApplicationStatusCard/ApplicationStatusCard';
import { ScrollArea } from './components/ScrollArea/ScrollArea';
import UpdateNotifier from './containers/UpdateNotifier/UpdateNotifier';
import UpdateCheck from './containers/UpdateNotifier/UpdateCheck';
import { Phrase } from 'localisation/phrases';
import { Button } from './components/Button/Button';
import { Tooltip } from './components/Tooltip/Tooltip';
import DiagnosticsDialog from './DiagnosticsDialog';
import { allows, usePermissions } from './usePermissions';
import { SINGLETON_PAGES, TabsContext } from './tabs/tabs';

const ipc = window.electron.ipcRenderer;

interface IProps {
  recorderStatus: RecStatus;
  videoCounters: Record<VideoCategory, number>;
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
  error: string;
  micStatus: MicStatus;
  errorReports: ErrorReport[];
  savingStatus: SaveStatus;
  config: ConfigurationSchema;
  updateAvailable: boolean;
  recorderCategory: VideoCategory | undefined;
  activityStatus: ActivityStatus | null;
  combatLoggingStatus: CombatLoggingStatus;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  instantReplayState: InstantReplayState;
  setInstantReplayState: Dispatch<SetStateAction<InstantReplayState>>;
}

const SideMenu = (props: IProps) => {
  const {
    recorderStatus,
    recorderCategory,
    videoCounters,
    appState,
    setAppState,
    persistentProgressRef,
    error,
    micStatus,
    errorReports,
    savingStatus,
    config,
    updateAvailable,
    activityStatus,
    combatLoggingStatus,
    setPreviewEnabled,
    instantReplayState,
    setInstantReplayState,
  } = props;
  const tabs = useContext(TabsContext);

  const [appVersion, setAppVersion] = useState<string>();
  // [RoomFortyRecorder] The sidebar folds down to an icon strip; the page
  // next to it takes the room.
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem('rf-sidebar-rail') === '1';
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setRail((was) => {
      try {
        localStorage.setItem('rf-sidebar-rail', was ? '0' : '1');
      } catch {
        // Not remembered.
      }
      return !was;
    });
  const { category, language } = appState;
  const lastManualStartStopClickRef = useRef(0);

  useEffect(() => {
    window.electron.ipcRenderer.on('updateVersionDisplay', (t: unknown) => {
      if (typeof t === 'string') {
        setAppVersion(t.split('v')[1] as string);
      }
    });
  }, []);

  useEffect(() => {
    // If the recording status changes, reset the last manual start/stop click time.
    lastManualStartStopClickRef.current = 0;
  }, [recorderStatus]);

  const renderManualStopStartButton = () => {
    const recordingOrReady =
      recorderStatus !== RecStatus.Recording &&
      recorderStatus !== RecStatus.ReadyToRecord;

    const recordingNonManual =
      recorderCategory && recorderCategory !== VideoCategory.Manual;

    const disabled =
      !config.manualRecord || // Disable the buttons if manual recording is disabled.
      recordingOrReady || // Disable if not recording or ready to record.
      recordingNonManual; // If recording something else don't show the stop button.

    if (disabled) {
      return <></>;
    }

    let icon = <Play size={14} fill="currentColor" />;
    let tooltip = getLocalePhrase(language, Phrase.StartManualRecordingTooltip);

    if (recorderStatus === RecStatus.Recording) {
      icon = <Square size={14} fill="currentColor" />;
      tooltip = getLocalePhrase(language, Phrase.StopManualRecordingTooltip);
    }

    return (
      <Tooltip content={tooltip}>
        <Button
          size="sm"
          variant="ghost"
          className="mx-2 p-1 h-6 w-6 hover:bg-secondary"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Drops spam clicks, only let one click per second.
            // Gets reset on recorder status change.
            const now = Date.now();
            if (now - lastManualStartStopClickRef.current < 1000) return;
            lastManualStartStopClickRef.current = now;
            ipc.toggleManualRecording();
          }}
        >
          {icon}
        </Button>
      </Tooltip>
    );
  };

  const renderCategoryTab = (
    tabCategory: VideoCategory,
    tabIcon: string | React.ReactNode,
  ) => {
    const numTotalVideos = Object.values(videoCounters).reduce((t, v) => t + v);
    const numCategoryVideos = videoCounters[tabCategory];

    const forceShowManual =
      tabCategory === VideoCategory.Manual && config.manualRecord;

    if (
      config.hideEmptyCategories && // Hide empty categories is enabled.
      numTotalVideos > 0 && // Only hide categories if there are atleast some videos.
      !forceShowManual && // Always show manual if manual recording is enabled, it has buttons on it.
      numCategoryVideos < 1 // If this category has no videos, so hide it.
    ) {
      return <></>;
    }

    return (
      <Menu.Item
        value={tabCategory}
        label={getLocaleCategoryLabel(language, tabCategory)}
      >
        <Menu.Item.Icon>
          {typeof tabIcon === 'string' ? (
            <img
              src={tabIcon}
              alt={tabCategory}
              width="25"
              height="25"
              style={{ transform: 'translate(-15px, 0px)' }}
            />
          ) : (
            tabIcon
          )}
        </Menu.Item.Icon>
        {getLocaleCategoryLabel(language, tabCategory)}
        {tabCategory === VideoCategory.Manual && renderManualStopStartButton()}
        <Menu.Item.Badge value={numCategoryVideos} />
      </Menu.Item>
    );
  };

  // [RoomFortyRecorder] Who can see what (Admin page), from the server.
  const permissions = usePermissions();

  // [RoomFortyRecorder] Meters from our own logs (Warcraft Logs-style).
  const renderLogsTab = () => (
    <Menu.Item value={Pages.Logs} label="Logs">
      <span className="inline-flex items-center w-full">
        <Menu.Item.Icon>
          <ScrollText size={18} />
        </Menu.Item.Icon>
        <span>Logs</span>
      </span>
    </Menu.Item>
  );

  // [RoomFortyRecorder] Warcraft Logs' top 25 per spec, and Time trial.
  const renderTopLogsTab = () => (
    <Menu.Item value={Pages.TopLogs} label="Top logs">
      <span className="inline-flex items-center w-full">
        <Menu.Item.Icon>
          <Trophy size={18} />
        </Menu.Item.Icon>
        <span>Top logs</span>
      </span>
    </Menu.Item>
  );

  const renderAdminTab = () => (
    <Menu.Item value={Pages.Admin} label="Admin">
      <Menu.Item.Icon>
        <ShieldCheck size={18} />
      </Menu.Item.Icon>
      Admin
    </Menu.Item>
  );

  const renderSettingsTab = () => {
    return (
      <Menu.Item
        value={Pages.Settings}
        label={getLocalePhrase(language, Phrase.GeneralButtonText)}
      >
        <Menu.Item.Icon>
          <Cog size={18} />
        </Menu.Item.Icon>
        {getLocalePhrase(language, Phrase.GeneralButtonText)}
      </Menu.Item>
    );
  };

  const renderSceneTab = () => {
    return (
      <Menu.Item
        value={Pages.SceneEditor}
        label={getLocalePhrase(language, Phrase.SceneButtonText)}
      >
        <Menu.Item.Icon>
          <MonitorCog size={18} />
        </Menu.Item.Icon>
        {getLocalePhrase(language, Phrase.SceneButtonText)}
      </Menu.Item>
    );
  };

  const renderInstantReplayTab = () => {
    const disabled = !(
      instantReplayState.current || appState.page === Pages.InstantReplay
    );

    let spanClassName = 'inline-flex items-center w-full';
    let radioClassName = '';
    let textClassName = '';

    if (!disabled) {
      spanClassName += ' animate-pulse';
      radioClassName = 'text-brand';
      textClassName += ' text-brand';
      textClassName += ' drop-shadow-[0_0_6px_rgba(204,168,92,0.35)]';
    }

    const tooltip = disabled
      ? getLocalePhrase(language, Phrase.InstantReplayDisabled)
      : getLocalePhrase(language, Phrase.InstantReplayLabel);

    return (
      <Menu.Item
        value={Pages.InstantReplay}
        disabled={disabled}
        label={tooltip}
      >
        <Tooltip content={tooltip}>
          <span className={spanClassName}>
            <Menu.Item.Icon>
              <Radio size={18} className={radioClassName} />
            </Menu.Item.Icon>

            <span className={textClassName}>
              {getLocalePhrase(language, Phrase.InstantReplayLabel)}
            </span>
          </span>
        </Tooltip>
      </Menu.Item>
    );
  };

  // [RoomFortyRecorder] Watch raiders live in the app. Shows how many are
  // live; the page itself explains if your role can't watch.
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      ipc
        .invoke('liveListStreams', [])
        .then((list) => {
          const { allowed, streams } = list as {
            allowed: boolean;
            streams: unknown[];
          };
          if (!cancelled) setLiveCount(allowed ? streams.length : 0);
        })
        .catch(() => {});

    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const renderLiveTab = () => {
    const someoneLive = liveCount > 0;

    return (
      <Menu.Item
        value={Pages.Live}
        label={someoneLive ? `Watch live (${liveCount} live)` : 'Watch live'}
      >
        <span className="inline-flex items-center w-full">
          <Menu.Item.Icon>
            <Tv size={18} className={someoneLive ? 'text-brand' : ''} />
          </Menu.Item.Icon>
          <span>Watch live</span>
          {someoneLive && (
            <span className="ml-auto rounded-full bg-brand px-2 text-[11px] font-bold text-primary-foreground">
              {liveCount}
            </span>
          )}
        </span>
      </Menu.Item>
    );
  };

  // [RoomFortyRecorder] Per-pull wipe reports from the guild server.
  const renderPullDeskTab = () => (
    <Menu.Item value={Pages.PullDesk} label="Dashboard">
      <span className="inline-flex items-center w-full">
        <Menu.Item.Icon>
          <ClipboardList size={18} />
        </Menu.Item.Icon>
        <span>Dashboard</span>
      </span>
    </Menu.Item>
  );

  const handleChangeCategory = (value: VideoCategory, newTab?: boolean) => {
    const index = getCategoryIndex(value);
    setConfigValue('selectedCategory', index);

    if (newTab && tabs) {
      tabs.openTab({ page: Pages.None, category: value });
      return;
    }

    persistentProgressRef.current = 0;

    setAppState((prevState) => {
      return {
        ...prevState,
        videoFilterTags: [],
        page: Pages.None,
        category: value,
        selectedVideos: [],
        multiPlayerMode: false,
        playing: false,
      };
    });
  };

  const handleChangePage = (newPage: Pages, newTab?: boolean) => {
    if (
      newPage === Pages.InstantReplay &&
      (newTab || appState.page !== Pages.InstantReplay)
    ) {
      setInstantReplayState((prev) => {
        return {
          ...prev,
          open: prev.current,
        };
      });
    }

    if (newTab && tabs) {
      tabs.openTab({ page: newPage });
      return;
    }

    // [RoomFortyRecorder] Settings, Scene, Instant replay, Watch live and
    // Admin have one tab at most: go to it if another tab has it.
    const elsewhere = tabs?.tabs.find(
      (t) => t.nav.page === newPage && t.id !== tabs.activeId,
    );
    if (tabs && elsewhere && SINGLETON_PAGES.has(newPage)) {
      tabs.activate(elsewhere.id);
      return;
    }

    persistentProgressRef.current = 0;

    setAppState((prevState) => {
      return {
        ...prevState,
        page: newPage,
      };
    });
  };

  // [RoomFortyRecorder] One line-icon style across the sidebar.
  const ICON = 18;
  const mythicPlusIcon = <Castle size={ICON} />;
  const raidsIcon = <Swords size={ICON} />;

  return (
    <SidebarRailContext.Provider value={rail}>
      <div
        className={`flex flex-col h-full bg-background shrink-0 items-center pt-[44px] pb-2 border-r border-card/60 transition-[width] duration-150 ${
          rail ? 'w-14 px-1.5' : 'w-60 px-3'
        }`}
      >
        <ApplicationStatusCard
          compact={rail}
          recorderStatus={recorderStatus}
          activityStatus={activityStatus}
          error={error}
          micStatus={micStatus}
          errorReports={errorReports}
          savingStatus={savingStatus}
          config={config}
          appState={appState}
          combatLoggingStatus={combatLoggingStatus}
          setPreviewEnabled={setPreviewEnabled}
        />
        <LiveButton compact={rail} />

        <ScrollArea
          className="w-full flex-1 min-h-0"
          withScrollIndicators={false}
        >
          <>
            <Menu
              className="mt-3"
              initialValue={
                appState.page === Pages.InstantReplay ||
                appState.page === Pages.Live
                  ? appState.page
                  : false
              }
              onChange={handleChangePage}
            >
              {renderInstantReplayTab()}
              {allows(permissions, 'liveWatch') && renderLiveTab()}
            </Menu>
            {allows(permissions, 'analysisView') && (
              <Menu
                className="mt-5"
                initialValue={
                  appState.page === Pages.PullDesk ||
                  appState.page === Pages.Logs ||
                  appState.page === Pages.TopLogs
                    ? appState.page
                    : false
                }
                onChange={handleChangePage}
                label="Analysis"
                foldKey="analysis"
              >
                {renderPullDeskTab()}
                {renderLogsTab()}
                {renderTopLogsTab()}
              </Menu>
            )}
          </>

          <Menu
            initialValue={appState.page === Pages.None ? category : false}
            onChange={handleChangeCategory}
            className="mt-5"
            label={getLocalePhrase(language, Phrase.RecordingsHeading)}
            foldKey="recordings"
          >
            {renderCategoryTab(VideoCategory.MythicPlus, mythicPlusIcon)}
            {renderCategoryTab(VideoCategory.Raids, raidsIcon)}
            {renderCategoryTab(
              VideoCategory.Clips,
              <Clapperboard size={ICON} />,
            )}
            {renderCategoryTab(VideoCategory.Manual, <HardHat size={ICON} />)}
          </Menu>
          <Menu
            className="mt-5"
            initialValue={
              appState.page === Pages.Settings ||
              appState.page === Pages.SceneEditor ||
              appState.page === Pages.Admin
                ? appState.page
                : false
            }
            onChange={handleChangePage}
            label={getLocalePhrase(language, Phrase.SettingsHeading)}
            foldKey="settings"
          >
            {renderSettingsTab()}
            {renderSceneTab()}
            {permissions?.owner && renderAdminTab()}
          </Menu>
        </ScrollArea>
        <div className="mt-auto w-full">
          <Separator className="mb-4" />
          <div
            className={`flex items-center justify-center ${
              rail ? 'flex-col gap-y-1' : 'gap-x-3'
            }`}
          >
            <UpdateNotifier
              updateAvailable={updateAvailable}
              appState={appState}
            />
            <DiagnosticsDialog
              appState={appState}
              setPreviewEnabled={setPreviewEnabled}
            >
              <Button variant="ghost" size="icon">
                <FileText size={20} />
              </Button>
            </DiagnosticsDialog>
            <TestButton recorderStatus={recorderStatus} appState={appState} />
            <BugButton appState={appState} />
            <Tooltip
              content={rail ? 'Show the sidebar' : 'Fold the sidebar'}
              side="top"
            >
              <Button variant="ghost" size="icon" onClick={toggleRail}>
                {rail ? (
                  <PanelLeftOpen size={20} />
                ) : (
                  <PanelLeftClose size={20} />
                )}
              </Button>
            </Tooltip>
          </div>
          {!rail && (
            <UpdateCheck
              versionLabel={getLocalePhrase(language, Phrase.Version)}
              version={appVersion}
            />
          )}
        </div>
      </div>
    </SidebarRailContext.Provider>
  );
};

export default SideMenu;
