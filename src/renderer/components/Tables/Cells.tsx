import { CellContext, stockFeatures } from '@tanstack/react-table';
import {
  CloudStatus,
  DialogType,
  RendererClip,
  RendererVideo,
} from 'main/types';
import {
  getVideoResultText,
  raidResultToPercent,
  getFormattedDuration,
  dateToHumanReadable,
  stopPropagation,
  countUniqueViewpoints,
  getPlayerClass,
  getPlayerName,
  getPlayerSpecID,
  getWoWClassColor,
  povDiskFirstNameSort,
  isRaidUtil,
  isMythicPlusUtil,
  getDungeonName,
} from 'renderer/rendererutils';
import { Box } from '@mui/material';
import { affixImages, specImages } from 'renderer/images';
import { Language, Phrase } from 'localisation/phrases';
import { Button } from '../Button/Button';
import { Tooltip } from '../Tooltip/Tooltip';
import { getLocalePhrase } from 'localisation/translations';
import {
  Clapperboard,
  ExternalLink,
  LockKeyhole,
  LockOpen,
  MessageSquare,
  MessageSquareMore,
} from 'lucide-react';
import * as React from 'react';
import { Dispatch, SetStateAction } from 'react';
import { dungeonAffixesById } from 'main/constants';
import wcrIcon from '../../../../assets/icon/small-icon.png';
import LockButton from './LockButton';
import TagButton from './TagButton';
import MultiLockButton from './MultiLockButton';
import SaveIcon from '@mui/icons-material/Save';
import CloudIcon from '@mui/icons-material/Cloud';
import MultiTagButton from './MultiTagButton';
import { BRAND } from 'renderer/brand';
import BossBar from '../BossBar/BossBar';
import { ROW_ICON_SIZE, rowButtonClass } from './rowButton';

/** The shape shared by every result pill (kill, timed, depleted...). */
const PILL =
  'inline-flex h-[22px] items-center rounded-full border px-2 text-xs font-semibold whitespace-nowrap';

export const populateResultCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
) => {
  const video = info.getValue() as RendererVideo;
  const resultText = getVideoResultText(video, language);

  if (isRaidUtil(video)) {
    if (video.result) {
      return (
        <span className={`${PILL} border-green-400/50 text-green-400`}>
          {resultText}
        </span>
      );
    }

    const bossPercent = raidResultToPercent(video);

    if (typeof bossPercent === 'number') {
      // A wipe: how far the boss got, as a bar and the number.
      return (
        <span className="inline-flex items-center gap-x-2 text-[13px] tabular-nums text-foreground-lighter">
          <BossBar
            bossPercent={bossPercent}
            kill={false}
            className="w-12 bg-foreground/30"
          />
          {resultText}
        </span>
      );
    }

    return <span className="text-[13px] text-foreground">{resultText}</span>;
  }

  if (isMythicPlusUtil(video)) {
    // Finished but no keystone upgrade recorded: nothing to say.
    if (!resultText) return null;

    if (!video.result) {
      // Abandoned.
      return (
        <span className={`${PILL} border-panel-line text-foreground`}>
          {resultText}
        </span>
      );
    }

    if (video.upgradeLevel !== undefined && video.upgradeLevel < 1) {
      // Finished, but over the time limit.
      return (
        <span className={`${PILL} border-warning-border text-warning`}>
          {resultText}
        </span>
      );
    }

    return (
      <span className={`${PILL} border-green-400/50 text-green-400`}>
        {resultText}
      </span>
    );
  }

  return (
    <span
      className={
        video.result
          ? `${PILL} border-green-400/50 text-green-400`
          : `${PILL} border-panel-line text-foreground`
      }
    >
      {resultText}
    </span>
  );
};

export const populateDurationCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const rawValue = info.getValue() as RendererVideo;
  return getFormattedDuration(rawValue);
};

export const populateEncounterNameCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const encounter = info.getValue() as string;
  return (
    <div className="truncate font-medium text-foreground-lighter">
      {encounter}
    </div>
  );
};

export const populateMapCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const map = info.getValue() as string;
  return (
    <div className="truncate font-medium text-foreground-lighter">{map}</div>
  );
};

export const populateDateCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const date = info.getValue() as Date;
  return <div className="truncate">{dateToHumanReadable(date)}</div>;
};

export const populateActivityCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
) => {
  const video = info.getValue() as RendererVideo;
  let activity = getLocalePhrase(language, Phrase.Unknown);

  if (isRaidUtil(video) && video.encounterName) {
    activity = video.encounterName;
  } else if (isMythicPlusUtil(video) && video.mapID) {
    const dungeonName = getDungeonName(video);
    if (dungeonName) activity = dungeonName;
  } else if (video.zoneName) {
    activity = video.zoneName;
  }

  return (
    <div className="truncate font-medium text-foreground-lighter">
      {activity}
    </div>
  );
};

/** The protect column: just the lock, brass when protected. */
export const populateDetailsCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
  cloudStatus: CloudStatus,
  setVideoState: Dispatch<SetStateAction<RendererVideo[]>>,
  setDialog: Dispatch<SetStateAction<DialogType>>,
  setLockDialogVideoTargetId: Dispatch<SetStateAction<string | null>>,
) => {
  const video = ctx.row.original;
  const group = [video, ...video.multiPov];

  return (
    <div className="flex items-center">
      {group.length > 1 ? (
        <MultiLockButton
          language={language}
          parent={video}
          setDialog={setDialog}
          setLockDialogVideoTargetId={setLockDialogVideoTargetId}
        />
      ) : (
        <LockButton
          language={language}
          cloudStatus={cloudStatus}
          video={video}
          setVideoState={setVideoState}
        />
      )}
    </div>
  );
};

/**
 * The actions at the end of a row: the tag, then whatever the category adds
 * (the kill video creator on raids, the source recording on clips).
 */
export const populateActionsCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
  cloudStatus: CloudStatus,
  setDialog: Dispatch<SetStateAction<DialogType>>,
  setTagDialogVideoTargetId: Dispatch<SetStateAction<string | null>>,
  extra?: React.ReactNode,
) => {
  const video = ctx.row.original;
  const group = [video, ...video.multiPov];

  return (
    <div className="flex items-center justify-end">
      {group.length > 1 ? (
        <MultiTagButton
          language={language}
          parent={video}
          setDialog={setDialog}
          setTagDialogVideoTargetId={setTagDialogVideoTargetId}
        />
      ) : (
        <TagButton
          language={language}
          cloudStatus={cloudStatus}
          video={video}
          setDialog={setDialog}
          setTagDialogVideoTargetId={setTagDialogVideoTargetId}
        />
      )}
      {extra}
    </div>
  );
};

export const populateSourceCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
  getClipParent: (clip: RendererClip) => RendererVideo | undefined,
  goToClipParent: (clip: RendererClip) => void,
) => {
  const clip = ctx.getValue() as RendererClip;
  const parent = getClipParent(clip);
  const disabled = parent === undefined;

  const tooltip = disabled
    ? getLocalePhrase(language, Phrase.ClipSourceUnavailableTooltip)
    : getLocalePhrase(language, Phrase.ClipSourceTooltip);

  const goToSource = (e: React.MouseEvent<HTMLButtonElement>) => {
    stopPropagation(e);
    goToClipParent(clip);
  };

  return (
    <Tooltip content={tooltip}>
      <div>
        <Button
          variant="ghost"
          size="xs"
          className={rowButtonClass()}
          aria-label={tooltip}
          onClick={goToSource}
          disabled={disabled}
        >
          <ExternalLink size={ROW_ICON_SIZE} />
        </Button>
      </div>
    </Tooltip>
  );
};

export const populateKillVideoCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
  setDialog: Dispatch<SetStateAction<DialogType>>,
  setKillVideoDialogVideoTargetId: Dispatch<SetStateAction<string | null>>,
) => {
  const video = ctx.getValue() as RendererVideo;
  const cloud = [video, ...video.multiPov].filter((rv) => rv.cloud);
  const disk = [video, ...video.multiPov].filter((rv) => !rv.cloud);
  const disabled = disk.length < 2;

  let tooltip = getLocalePhrase(language, Phrase.KillVideoCreatorTooltip);

  if (disabled && cloud.length + disk.length > 1) {
    tooltip = getLocalePhrase(
      language,
      Phrase.KillVideoCreatorTooltipNotEnoughLocal,
    );
  } else if (disabled) {
    tooltip = getLocalePhrase(
      language,
      Phrase.KillVideoCreatorTooltipNotEnoughPov,
    );
  }

  return (
    <Tooltip content={tooltip}>
      <div>
        <Button
          variant="ghost"
          size="xs"
          className={rowButtonClass()}
          aria-label={tooltip}
          disabled={disabled}
          onClick={(event) => {
            stopPropagation(event);
            setKillVideoDialogVideoTargetId(video.uniqueId);
            setDialog(DialogType.KILL);
          }}
        >
          <Clapperboard size={ROW_ICON_SIZE} />
        </Button>
      </div>
    </Tooltip>
  );
};

export const populateLevelCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const video = info.getValue() as RendererVideo;
  return (
    <span className="font-medium text-foreground-lighter">{`+${video.keystoneLevel || video.level || 0}`}</span>
  );
};

export const populateAffixesCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const video = info.getValue() as RendererVideo;

  const renderAffix = (id: number) => {
    const affixName = dungeonAffixesById[id];
    const affixImage = affixImages[id as keyof typeof affixImages];

    return (
      <Tooltip content={affixName} key={affixName}>
        <Box
          key={affixName}
          component="img"
          src={affixImage}
          sx={{
            height: '25px',
            width: '25px',
            border: '1px solid black',
            borderRadius: '15%',
            boxSizing: 'border-box',
            objectFit: 'cover',
          }}
        />
      </Tooltip>
    );
  };

  if (!video.affixes) {
    return <></>;
  }

  return (
    <div className="flex flex-row">{video.affixes.sort().map(renderAffix)}</div>
  );
};

export const populateViewpointCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const video = info.getValue() as RendererVideo;
  const count = countUniqueViewpoints(video);

  // Prioritize the any videos with a disk copy as that's likely to be the
  // local users viewpoint so most relevant to them.
  const povs = [video, ...video.multiPov].sort(povDiskFirstNameSort);
  const first = povs[0];

  const { player } = first;

  if (!player || !player._specID) {
    // We don't have enough to render a spec icon and name so
    // just return the viewpoint count.
    return <div className="text-foreground">{count}</div>;
  }

  const playerClass = getPlayerClass(first);
  const playerSpecID = getPlayerSpecID(first);
  let playerName = getPlayerName(first);
  let playerClassColor = getWoWClassColor(playerClass);
  let specIcon = specImages[playerSpecID as keyof typeof specImages];

  if (playerName === 'WCR Multipov Name') {
    playerName = 'Multiview';
    playerClassColor = BRAND;
    specIcon = wcrIcon;
  }

  return (
    <div className="flex min-w-0 items-center gap-x-2">
      <Box
        key={player._GUID}
        component="img"
        src={specIcon}
        className="bg-panel-deep shrink-0"
        sx={{
          display: 'flex',
          height: '22px',
          width: '22px',
          border: '1px solid',
          borderColor: 'hsl(var(--border))',
          borderRadius: '15%',
          boxSizing: 'border-box',
          objectFit: 'cover',
        }}
      />
      <div
        className="min-w-0 truncate text-sm font-medium"
        style={{ color: playerClassColor }}
      >
        {playerName}
      </div>
      {count > 1 && (
        <div className="shrink-0 text-[13px] text-foreground">{`+${count - 1}`}</div>
      )}
    </div>
  );
};

export const populateTagCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const { row } = ctx;
  const { tag } = row.original;

  const icon = tag ? (
    <MessageSquareMore size={18} />
  ) : (
    <MessageSquare size={18} />
  );

  return <div className="flex justify-center items-center">{icon}</div>;
};

export const populateStorageCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const { row } = ctx;
  const { cloud } = row.original;

  const icon = cloud ? (
    <CloudIcon
      sx={{
        height: '18px',
        width: '18px',
        color: 'white',
        opacity: 0.3,
        marginBottom: '3px',
      }}
    />
  ) : (
    <SaveIcon
      sx={{
        height: '18px',
        width: '18px',
        color: 'white',
        opacity: 0.3,
        marginBottom: '3px',
      }}
    />
  );

  return <div className="flex justify-center items-center">{icon}</div>;
};

export const populatePlayerCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
) => {
  const video = info.getValue() as RendererVideo;
  const { player } = video;

  if (!player || !player._specID) {
    return <div>{getLocalePhrase(language, Phrase.Unknown)}</div>;
  }

  const playerClass = getPlayerClass(video);
  const playerSpecID = getPlayerSpecID(video);
  const playerName = getPlayerName(video);
  const playerClassColor = getWoWClassColor(playerClass);
  const specIcon = specImages[playerSpecID as keyof typeof specImages];

  const renderSpecAndName = () => {
    return (
      <div className="flex items-center pl-2 min-w-0">
        <Box
          component="img"
          src={specIcon}
          className="bg-background-higher shrink-0"
          sx={{
            height: '25px',
            width: '25px',
            border: '1px solid black',
            borderRadius: '15%',
            boxSizing: 'border-box',
            objectFit: 'cover',
          }}
        />

        <div
          className="font-sans font-semibold text-sm text-shadow-instance mx-1 truncate min-w-0"
          style={{ color: playerClassColor }}
        >
          {playerName}
        </div>
      </div>
    );
  };

  return <div className="flex truncate">{renderSpecAndName()}</div>;
};

export const populateTagStatusCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
) => {
  const { row } = info;
  const { tag } = row.original;
  const text = tag ? tag : getLocalePhrase(language, Phrase.NoCustomTag);
  return <div className="truncate text-sm mx-2">{text}</div>;
};

export const populateLockCell = (
  ctx: CellContext<typeof stockFeatures, RendererVideo, unknown>,
) => {
  const video = ctx.getValue() as RendererVideo;
  const { isProtected } = video;

  const icon = isProtected ? <LockKeyhole size={18} /> : <LockOpen size={18} />;

  return <div className="flex justify-center items-center">{icon}</div>;
};

export const populateLockedStatusCell = (
  info: CellContext<typeof stockFeatures, RendererVideo, unknown>,
  language: Language,
) => {
  const { row } = info;
  const { isProtected } = row.original;

  if (isProtected) {
    return (
      <div className="flex truncate text-sm">
        {getLocalePhrase(language, Phrase.SafeFromAutomaticDeletion)}
      </div>
    );
  }
  return (
    <div className="flex truncate text-sm">
      {getLocalePhrase(language, Phrase.EligibleForAutomaticDeletion)}
    </div>
  );
};
