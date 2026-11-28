import * as React from 'react';
import {
  AppState,
  DialogType,
  RendererClip,
  RendererVideo,
  StorageFilter,
} from 'main/types';
import {
  Dispatch,
  RefObject,
  SetStateAction,
  useCallback,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GripHorizontal,
  LockKeyhole,
  Trash,
  LockOpen,
  CloudUpload,
  CloudDownload,
  ArrowLeftFromLine,
  ArrowRightToLine,
  Cloud,
} from 'lucide-react';
import {
  getLocaleCategoryLabel,
  getLocalePhrase,
} from 'localisation/translations';
import { VideoCategory } from '../types/VideoCategory';
import SearchBar from './SearchBar';
import VideoMarkerToggles from './VideoMarkerToggles';
import { useSettings } from './useSettings';
import {
  findClipParent,
  getFriendlyCodecName,
  getVideoCategoryFilter,
  getVideoParent,
  getVideoStorageFilter,
  lockVideos,
  povDiskFirstNameSort,
} from './rendererutils';
import { Button } from './components/Button/Button';
import VideoSelectionTable from './components/Tables/VideoSelectionTable';
import DeleteDialog from './DeleteDialog';
import MultiPovPlaybackToggles from './MultiPovPlaybackToggles';
import VideoFilter from './VideoFilter';
import { Resizable, ResizeCallback } from 're-resizable';
import { Direction } from 're-resizable/lib/resizer';
import VideoPlayer, { VideoPlayerRef } from './VideoPlayer';
import ViewpointSelection from './components/Viewpoints/ViewpointSelection';
import useVideoSelectionTable from './components/Tables/useVideoSelectionTable';
import { Tooltip } from './components/Tooltip/Tooltip';
import DateRangePicker from './DateRangePicker';
import StorageFilterToggle from './StorageFilterToggle';
import VideoCorrelator from './VideoCorrelator';
import { Phrase } from 'localisation/phrases';
import BulkTransferDialog from './BulkTransferDialog';
import VideoChat from './VideoChat';
import ConfirmChatNamePrompt from './ConfirmChatNamePrompt';
import LockDialog from './LockDialog';
import TagDialog from './TagDialog';
import KillVideoDialog from './KillVideoDialog';
import { PageHeader } from './components/PageHeader/PageHeader';
import { EmptyState } from './components/States/States';
import { DisabledReason } from './components/Tooltip/DisabledReason';
import { nameAndReason } from './components/Tooltip/reason';

interface IProps {
  category: VideoCategory;
  videoState: RendererVideo[];
  setVideoState: Dispatch<SetStateAction<RendererVideo[]>>;
  appState: AppState;
  setAppState: Dispatch<SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
  playerHeightRef: RefObject<number>;
}

const DEFAULT_PLAYER_HEIGHT = 500;

/** A 36 px icon button in the header's selection actions. */
const ACTION_BUTTON =
  'h-9 w-9 p-0 rounded-lg border border-panel-line bg-panel text-foreground hover:bg-panel-raised hover:text-foreground-lighter';

/**
 * How tall the player shows, and the most it can be dragged to. The height
 * the user chose stays in `playerHeightRef`; a short window only limits what
 * shows, so the player grows back when the window does. An untouched player
 * (the default) also leaves room for the header, the filter bar and a few table rows.
 */
const playerHeights = (chosen: number, windowHeight: number) => {
  const max = Math.max(280, windowHeight - 245);
  const shown =
    chosen === DEFAULT_PLAYER_HEIGHT
      ? Math.min(chosen, Math.max(280, windowHeight - 345))
      : Math.min(chosen, max);
  return { shown, max };
};

/**
 * A page representing a video category.
 */
const CategoryPage = (props: IProps) => {
  // Ids for the hidden reason text of the selection buttons.
  const reasonBase = useId();
  const {
    category,
    videoState,
    setVideoState,
    appState,
    setAppState,
    persistentProgressRef,
    playerHeightRef,
  } = props;

  const {
    selectedVideos,
    videoFilterTags,
    language,
    dateRangeFilter,
    cloudStatus,
    storageFilter,
    chatOpen,
  } = appState;

  const { write, del } = cloudStatus;
  const [config, setConfig] = useSettings();
  const [dialog, setDialog] = useState<DialogType>(DialogType.NONE);

  const setLockDialog = (open: boolean) =>
    setDialog(open ? DialogType.LOCK : DialogType.NONE);

  const setTagDialog = (open: boolean) =>
    setDialog(open ? DialogType.TAG : DialogType.NONE);

  const setDeleteDialog = (open: boolean) =>
    setDialog(open ? DialogType.DELETE : DialogType.NONE);

  const setKillVideoDialog = (open: boolean) =>
    setDialog(open ? DialogType.KILL : DialogType.NONE);

  const [lockDialogVideoTargetId, setLockDialogVideoTargetId] = useState<
    string | null
  >(null);

  const [tagDialogVideoTargetId, setTagDialogVideoTargetId] = useState<
    string | null
  >(null);

  const [killDialogVideoTargetId, setKillDialogVideoTargetId] = useState<
    string | null
  >(null);

  // The category state, recalculated only when required.
  const categoryState = useMemo<RendererVideo[]>(() => {
    const categoryFilter = getVideoCategoryFilter(category);
    return videoState.filter(categoryFilter);
  }, [videoState, category]);

  // Filter by storage type before we apply grouping.
  const correlatedState = useMemo(() => {
    const storageFilterFn = getVideoStorageFilter(storageFilter);
    const storageFilteredState = categoryState.filter(storageFilterFn);
    return VideoCorrelator.correlate(storageFilteredState);
  }, [categoryState, storageFilter]);

  // Now apply filtering based on search tags and date range. Build a lookup
  // map here for efficient finding of the parent row of a video, which is a
  // generally useful thing to have for downstream components.
  const { filteredState, parentLookupMap } = useMemo(() => {
    const queryFilter = (rv: RendererVideo) =>
      new VideoFilter(rv, videoFilterTags, dateRangeFilter, language).filter();

    const filteredState = correlatedState.filter(queryFilter);
    const parentLookupMap = new Map<string, RendererVideo>();

    for (let i = 0; i < filteredState.length; i++) {
      const parent = filteredState[i];
      parentLookupMap.set(parent.uniqueId, parent);

      for (let j = 0; j < parent.multiPov.length; j++) {
        const child = parent.multiPov[j];
        parentLookupMap.set(child.uniqueId, parent);
      }
    }

    return { filteredState, parentLookupMap };
  }, [correlatedState, dateRangeFilter, videoFilterTags, language]);

  // Tanstack table relies on stable references, so while we have the React
  // compiler enabled we still need useCallback here or weird stuff will happen.
  const getClipParent = useCallback(
    (clip: RendererClip) => {
      return findClipParent(clip, videoState);
    },
    [videoState],
  );

  const goToClipParent = useCallback(
    (clip: RendererClip) => {
      const parent = getClipParent(clip);

      if (parent) {
        persistentProgressRef.current =
          clip.parentVideoOffset && clip.parentVideoOffset > 0
            ? clip.parentVideoOffset
            : 0;

        setAppState((prevState) => ({
          ...prevState,
          category: parent.category,
          selectedVideos: [parent],
          multiPlayerMode: false,
          playing: false,
          videoFilterTags: [],
          storageFilter: StorageFilter.BOTH,
          dateRangeFilter: {
            startDate: null,
            endDate: null,
          },
        }));
      }
    },
    [getClipParent, persistentProgressRef, setAppState],
  );

  const table = useVideoSelectionTable(
    filteredState,
    parentLookupMap,
    appState,
    setAppState,
    setVideoState,
    getClipParent,
    goToClipParent,
    setDialog,
    setLockDialogVideoTargetId,
    setTagDialogVideoTargetId,
    setKillDialogVideoTargetId,
  );

  const haveVideos = categoryState.length > 0;
  const isClips = category === VideoCategory.Clips;

  // Handle to reset the video player height.
  const resizableRef = useRef<Resizable>(null);
  const videoPlayerRef = useRef<VideoPlayerRef>(null);

  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const [chosenPlayerHeight, setChosenPlayerHeight] = useState(
    // eslint-disable-next-line react-hooks/refs
    () => playerHeightRef.current,
  );
  const { shown: shownPlayerHeight, max: maxPlayerHeight } = playerHeights(
    chosenPlayerHeight,
    windowHeight,
  );

  useEffect(() => {
    const handleWindowResize = () => {
      // A minimized window reports a tiny height; leave the player alone.
      if (window.innerHeight < 300) return;
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  useEffect(() => {
    resizableRef.current?.updateSize({ height: shownPlayerHeight });
  }, [shownPlayerHeight]);

  const renderChat = (video: RendererVideo | undefined) => {
    if (!video) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-foreground text-sm font-bold">
          <Cloud size={35} className="mb-2" />
          {getLocalePhrase(language, Phrase.ChatUploadToCloudText)}
        </div>
      );
    }

    if (config.cloudDiscordName !== config.chatUserNameAgreed) {
      return (
        <ConfirmChatNamePrompt
          cloudDiscordName={config.cloudDiscordName}
          setConfig={setConfig}
          language={language}
        />
      );
    }

    return (
      <VideoChat
        key={video.videoName}
        videoPlayerRef={videoPlayerRef}
        video={video}
        language={language}
        deletePermissions={del}
      />
    );
  };

  /**
   * Handle a resize event.
   */
  const onResize: ResizeCallback = (
    event: MouseEvent | TouchEvent,
    direction: Direction,
    element: HTMLElement,
  ) => {
    const height = element.clientHeight;
    playerHeightRef.current = height;
    setChosenPlayerHeight(height);
  };

  const renderDrawerOpen = (
    appVersion: string | undefined,
    encoder: string | undefined,
  ) => {
    // Only the first row in the selection is relevant for the drawer display.
    const selectedRows = table.getSelectedRowModel().rows;
    const selectedRow = selectedRows[0];
    let activeParentVideo = null;

    if (selectedRow) {
      activeParentVideo = selectedRow.original;
    } else if (filteredState.length > 0) {
      activeParentVideo = filteredState[0];
    }

    // Only try to find a chat video if we have a video with cloud storage,
    // a start time and a hash, else we cannot find the chat correlator.
    let chatVideo: RendererVideo | undefined = undefined;

    if (activeParentVideo) {
      chatVideo = [activeParentVideo, ...activeParentVideo.multiPov].find(
        (rv) => rv.cloud && rv.uniqueHash && rv.start,
      );
    }

    if (activeParentVideo) {
      chatVideo = [activeParentVideo, ...activeParentVideo.multiPov].find(
        (rv) => rv.cloud && rv.uniqueHash && rv.start,
      );
    }
    const renderTextDescr = () => {
      return (
        <div className="flex items-center justify-start w-full h-[40px] pt-2 mx-2 text-sm font-bold text-foreground">
          {appVersion && (
            <>
              {getLocalePhrase(language, Phrase.RecordedAt)} v{appVersion}.{' '}
            </>
          )}
          {encoder && (
            <>
              {getLocalePhrase(language, Phrase.EncodedWith)}{' '}
              {getFriendlyCodecName(encoder)}.
            </>
          )}
        </div>
      );
    };

    return (
      // [RoomFortyRecorder] Narrower on smaller windows so the player and
      // its controls keep their room (the page used to overflow).
      <div className="w-[clamp(320px,32vw,500px)] shrink-0 h-full bg-panel flex flex-col mx-2 gap-y-2">
        <div className="flex items-start">
          <Button
            onClick={() =>
              setAppState((prev) => ({ ...prev, chatOpen: false }))
            }
            variant="ghost"
            className="mt-2"
            aria-label="Close chat"
            size="xs"
          >
            <ArrowRightToLine size={18} />
          </Button>
          {renderTextDescr()}
        </div>
        <div className="flex items-center justify-center w-full">
          {activeParentVideo && (
            <ViewpointSelection
              video={activeParentVideo}
              appState={appState}
              setAppState={setAppState}
              persistentProgressRef={persistentProgressRef}
            />
          )}
        </div>
        {renderChat(chatVideo)}
      </div>
    );
  };

  const renderDrawerClosed = () => {
    return (
      <div className="h-full relative">
        <Button
          onClick={() => setAppState((prev) => ({ ...prev, chatOpen: true }))}
          variant="ghost"
          className="absolute top-0 right-0 m-2"
          size="xs"
          aria-label="Open chat"
        >
          <ArrowLeftFromLine size={18} />
        </Button>
      </div>
    );
  };

  /**
   * Render the video player. Safe to assume we have videos at this point
   * as we don't call this if haveVideos isn't true.
   *
   * If there is no selected videos (because we've just launched, or just
   * changed category) then just play the first video in the table.
   */
  const getVideoPlayer = () => {
    const toShow = filteredState[0] ? filteredState[0] : categoryState[0];
    const povs = [toShow, ...toShow.multiPov].sort(povDiskFirstNameSort);

    const videosToPlay =
      selectedVideos.length > 0 ? selectedVideos : povs.slice(0, 1);

    const selectedVideoAppVersion =
      videosToPlay.length > 1 ? undefined : videosToPlay[0].appVersion;

    const selectedVideoEncoder =
      videosToPlay.length > 1 ? undefined : videosToPlay[0].encoder;

    return (
      <Resizable
        ref={resizableRef}
        defaultSize={{
          height: `${shownPlayerHeight}px`,
          width: '100%',
        }}
        enable={{
          top: false,
          right: false,
          bottom: true,
          left: false,
          topRight: false,
          bottomRight: false,
          bottomLeft: false,
          topLeft: false,
        }}
        bounds="parent"
        onResize={onResize}
        maxHeight={maxPlayerHeight}
        minHeight={
          chatOpen
            ? Math.min(500, shownPlayerHeight, maxPlayerHeight)
            : undefined
        }
        handleStyles={{
          bottom: {
            width: '50%',
            left: '25%',
            height: '18px',
            bottom: '-18px',
            alignItems: 'center',
            position: 'absolute',
            display: 'flex',
            justifyContent: 'center',
          },
        }}
        handleComponent={{
          bottom: <GripHorizontal className="text-foreground" size={18} />,
        }}
      >
        <div className="flex h-full w-full min-w-0 overflow-hidden rounded-lg border border-panel-line bg-panel">
          <div className="flex-1 min-w-0 h-full">
            <VideoPlayer
              ref={videoPlayerRef}
              instantReplay={null}
              key={videosToPlay.map((rv) => rv.videoName + rv.cloud).join(', ')}
              videos={videosToPlay}
              filteredState={filteredState}
              persistentProgressRef={persistentProgressRef}
              config={config}
              appState={appState}
              setAppState={setAppState}
            />
          </div>

          {chatOpen &&
            renderDrawerOpen(selectedVideoAppVersion, selectedVideoEncoder)}
          {!chatOpen && renderDrawerClosed()}
        </div>
      </Resizable>
    );
  };

  const getAllSelectedViewpoints = () => {
    const { rows } = table.getSelectedRowModel();

    if (rows.length > 0) {
      const parents = rows.map((r) => r.original);
      const children = parents.flatMap((v) => v.multiPov);
      return parents.concat(children);
    }

    const first = filteredState[0] ? filteredState[0] : categoryState[0];
    return [first, ...first.multiPov];
  };

  const getVideoSelection = () => {
    const selectedRows = table.getSelectedRowModel().rows;
    const selectedViewpoints = getAllSelectedViewpoints();

    // We don't want multi player mode to be accessible if there isn't
    // multiple viewpoints, so check for that. Important to filter by
    // unique name here so we don't allow multi player mode for two
    // identical videos with different storage (i.e. disk/cloud).
    //
    // Handle the case where no row is selected yet but we do have atleast
    // an entry in the video selection table so default to the first to
    // decide if we can do multi player mode or not.
    //
    // The dedup function here removes videos with matching names, but
    // possibly alternative storage. We don't want to load a disk and cloud
    // pov of the same video.
    const dedup = (rv: RendererVideo, idx: number, arr: RendererVideo[]) =>
      arr.findIndex((i) => i.videoName === rv.videoName) === idx;

    const selectedRow = selectedRows[0];

    const multiPlayerOpts = (
      selectedRow
        ? [selectedRow.original, ...selectedRow.original.multiPov]
        : filteredState[0]
          ? [filteredState[0], ...filteredState[0].multiPov]
          : [categoryState[0], ...categoryState[0].multiPov]
    )
      .sort(povDiskFirstNameSort)
      .filter(dedup);

    const names = multiPlayerOpts.map((rv) => rv.videoName);
    const unique = [...new Set(names)];
    const allowMultiPlayer = unique.length > 1;

    const renderBulkLockButton = () => {
      const toLock = selectedViewpoints;

      // If any videos in our selection are not protected, then the button's
      // action is to lock.
      const lock = !toLock.every((v) => v.isProtected);

      // Disable the lock button if there are no selected viewpoints, if we
      // don't have write permissions, or if the action is to unlock and we
      // don't have delete permissions.
      const noPermission =
        (!write && toLock.some((v) => v.cloud)) || // Some in the selection are cloud videos and no write permission.
        (!del && !lock && toLock.some((v) => v.cloud)); // Some in the selection are locked cloud videos no delete permission.

      const disabled = noPermission || toLock.length < 1;
      const icon = lock ? <LockKeyhole size={16} /> : <LockOpen size={16} />;

      // The name is always the action; the tooltip is the reason when there
      // is no permission (read through aria-describedby).
      const name = lock
        ? getLocalePhrase(language, Phrase.StarSelected)
        : getLocalePhrase(language, Phrase.UnstarSelected);
      const tooltip = noPermission
        ? getLocalePhrase(language, Phrase.GuildNoPermission)
        : name;
      const reasonId = `${reasonBase}-lock`;

      return (
        <Tooltip content={tooltip}>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              {...nameAndReason(name, tooltip, reasonId)}
              onClick={() => lockVideos(toLock, lock, setVideoState)}
              className={ACTION_BUTTON}
            >
              {icon}
            </Button>
            <DisabledReason id={reasonId} name={name} tooltip={tooltip} />
          </div>
        </Tooltip>
      );
    };

    const renderBulkDeleteButton = () => {
      const toDelete = selectedViewpoints;
      const noPermission = !del && toDelete.some((v) => v.cloud);
      const disabled = toDelete.length < 1 || noPermission;

      const name = getLocalePhrase(language, Phrase.BulkDeleteButtonTooltip);
      const tooltip = noPermission
        ? getLocalePhrase(language, Phrase.GuildNoPermission)
        : name;
      const reasonId = `${reasonBase}-delete`;

      // Only want to pass the parent IDs into the delete dialog.
      const ids = [
        ...new Set(
          toDelete
            .map((rv) => rv.uniqueId)
            .map((id) => getVideoParent(id, parentLookupMap))
            .filter((rv): rv is RendererVideo => Boolean(rv))
            .map((rv) => rv.uniqueId),
        ),
      ];

      return (
        <Tooltip content={tooltip}>
          <div>
            <DeleteDialog
              open={dialog === DialogType.DELETE}
              onOpenChange={setDeleteDialog}
              targetVideoIds={ids}
              parentLookupMap={parentLookupMap}
              setVideoState={setVideoState}
              language={language}
              appState={appState}
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                {...nameAndReason(name, tooltip, reasonId)}
                className={ACTION_BUTTON}
              >
                <Trash size={16} />
              </Button>
            </DeleteDialog>
            <DisabledReason id={reasonId} name={name} tooltip={tooltip} />
          </div>
        </Tooltip>
      );
    };

    const renderBulkTransferButton = (upload: boolean) => {
      const toTransfer = selectedViewpoints
        .filter((rv) => rv.cloud === !upload)
        .filter(
          (rv) =>
            selectedViewpoints.filter((v) => v.videoName === rv.videoName)
              .length < 2, // If we have 2 or more viewpoints with the same name then one must be disk and one cloud.
        );

      const noPermission = upload && !write;

      const disabled =
        storageFilter !== StorageFilter.BOTH ||
        toTransfer.length < 1 ||
        noPermission ||
        !cloudStatus.authorized;

      const name = upload
        ? getLocalePhrase(language, Phrase.BulkUploadButtonTooltip)
        : getLocalePhrase(language, Phrase.BulkDownloadButtonTooltip);
      let tooltip = name;
      const reasonId = `${reasonBase}-${upload ? 'upload' : 'download'}`;

      if (storageFilter !== StorageFilter.BOTH) {
        tooltip = getLocalePhrase(language, Phrase.DisabledDueToFilter);
      } else if (noPermission) {
        tooltip = getLocalePhrase(language, Phrase.GuildNoPermission);
      }

      const icon = upload ? (
        <CloudUpload size={16} />
      ) : (
        <CloudDownload size={16} />
      );

      return (
        <Tooltip content={tooltip}>
          <div>
            <BulkTransferDialog
              key={toTransfer.map((v) => v.videoName).join(',')} // Forces a remount on selection change.
              inScope={toTransfer}
              appState={appState}
              upload={upload}
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                {...nameAndReason(name, tooltip, reasonId)}
                className={ACTION_BUTTON}
              >
                {icon}
              </Button>
            </BulkTransferDialog>
            <DisabledReason id={reasonId} name={name} tooltip={tooltip} />
          </div>
        </Tooltip>
      );
    };

    // [RoomFortyRecorder] Design A: the selection actions sit in the page
    // header, the filters in one row under the player.
    const actions = (
      <>
        <MultiPovPlaybackToggles
          appState={appState}
          setAppState={setAppState}
          allowMultiPlayer={allowMultiPlayer}
          opts={multiPlayerOpts}
        />
        <div
          role="group"
          aria-label={getLocalePhrase(language, Phrase.Selection)}
          className="flex items-center gap-x-1.5"
        >
          {selectedRows.length > 1 && (
            <span className="mr-1 text-[13px] text-foreground">
              {selectedRows.length} selected
            </span>
          )}
          {config.cloudUpload && renderBulkTransferButton(true)}
          {config.cloudStorage && renderBulkTransferButton(false)}
          {renderBulkLockButton()}
          {renderBulkDeleteButton()}
        </div>
      </>
    );

    const content = (
      <>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2.5">
          <div className="relative z-30 min-w-[260px] flex-1">
            <SearchBar
              key={category}
              appState={appState}
              setAppState={setAppState}
              filteredState={filteredState}
            />
          </div>
          <DateRangePicker appState={appState} setAppState={setAppState} />
          {!isClips && (
            <VideoMarkerToggles
              category={category}
              config={config}
              setConfig={setConfig}
              appState={appState}
            />
          )}
          <StorageFilterToggle
            categoryState={categoryState}
            appState={appState}
            setAppState={setAppState}
          />
        </div>
        <div className="min-h-0 w-full flex-1 overflow-hidden">
          <LockDialog
            open={dialog === DialogType.LOCK}
            onOpenChange={setLockDialog}
            targetVideoId={lockDialogVideoTargetId}
            parentLookupMap={parentLookupMap}
            setVideoState={setVideoState}
            language={language}
            cloudStatus={cloudStatus}
          />
          <TagDialog
            open={dialog === DialogType.TAG}
            onOpenChange={setTagDialog}
            targetVideoId={tagDialogVideoTargetId}
            parentLookupMap={parentLookupMap}
            setVideoState={setVideoState}
            language={language}
            cloudStatus={cloudStatus}
          />
          <KillVideoDialog
            open={dialog === DialogType.KILL}
            onOpenChange={setKillVideoDialog}
            targetVideoId={killDialogVideoTargetId}
            parentLookupMap={parentLookupMap}
            language={language}
          />
          <VideoSelectionTable
            table={table}
            appState={appState}
            setAppState={setAppState}
            persistentProgressRef={persistentProgressRef}
            dialogOpen={dialog !== DialogType.NONE}
          />
        </div>
      </>
    );

    return { actions, content };
  };

  const categoryLabel = getLocaleCategoryLabel(language, category);

  /** "7 recordings · 18 of 50 GB on this PC" under the page title. */
  const renderSubtitle = (shown: number, total: number) => {
    const noun = isClips ? 'clip' : 'recording';
    const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
    const count =
      shown === total ? plural(total) : `${shown} of ${plural(total)}`;
    const { usage, limit } = appState.diskStatus;
    const usedGB = Math.round(usage / 1024 ** 3);
    const limitGB = Math.round(limit / 1024 ** 3);
    const disk =
      limitGB === 0
        ? `${usedGB} GB used on this PC`
        : `${usedGB} of ${limitGB} GB on this PC`;
    return `${count} · ${disk}`;
  };

  const emptyMessage = () => {
    switch (category) {
      case VideoCategory.Clips:
        return 'No clips yet. Clip a moment from any recording and it appears here.';
      case VideoCategory.MythicPlus:
        return 'No Mythic+ recordings yet. They appear here after your next key.';
      case VideoCategory.Manual:
        return 'No manual recordings yet. Press your manual recording hotkey (Settings) to start one.';
      default:
        return 'No raid recordings yet. They appear here after your next pull.';
    }
  };

  const renderVideoPage = () => {
    const { actions, content } = getVideoSelection();

    return (
      <div className="flex h-full w-full min-w-0 flex-col bg-walnut pt-[32px] text-foreground-lighter">
        <PageHeader
          title={categoryLabel}
          subtitle={renderSubtitle(
            filteredState.length,
            correlatedState.length,
          )}
          actions={actions}
          className="px-7 pt-5"
        />
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] px-7 pb-5 pt-[18px]">
          {getVideoPlayer()}
          {content}
        </div>
      </div>
    );
  };

  if (haveVideos) {
    return renderVideoPage();
  }

  return (
    <div className="flex h-full w-full flex-col bg-walnut pt-[32px] text-foreground-lighter">
      <PageHeader
        title={categoryLabel}
        subtitle={renderSubtitle(0, 0)}
        className="px-7 pt-5"
      />
      <div className="px-7 pt-[18px]">
        <div className="flex justify-center rounded-lg border border-panel-line bg-panel px-6 py-12 text-center">
          <EmptyState>{emptyMessage()}</EmptyState>
        </div>
      </div>
    </div>
  );
};

export default CategoryPage;
