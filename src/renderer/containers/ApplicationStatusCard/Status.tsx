import { getLocalePhrase } from 'localisation/translations';
import { Phrase } from 'localisation/phrases';
import { HardDriveDownload, TriangleAlert } from 'lucide-react';
import { ConfigurationSchema } from 'config/configSchema';
import {
  ActivityStatus,
  CombatLoggingStatus,
  AppState,
  RecStatus,
  SaveStatus,
} from 'main/types';
import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { Button } from 'renderer/components/Button/Button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from 'renderer/components/HoverCard/HoverCard';
import Separator from 'renderer/components/Separator/Separator';
import { Tooltip } from 'renderer/components/Tooltip/Tooltip';
import { recorderLine } from 'renderer/sidebarStatus';
import { sidebarLabels } from 'renderer/sidebarLabels';
import Dot from './Dot';
import { cn } from 'renderer/components/utils';
import { secToMmSs } from 'renderer/rendererutils';

type StatusProps = {
  status: RecStatus;
  error: string;
  savingStatus: SaveStatus;
  config: ConfigurationSchema;
  appState: AppState;
  activityStatus: ActivityStatus | null;
  combatLoggingStatus: CombatLoggingStatus;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  /** Folded sidebar: just the dot. */
  compact?: boolean;
  /** The card's other lines, shown first in the hover card when folded. */
  summary?: React.ReactNode;
};

const Status = ({
  status,
  error,
  savingStatus,
  config,
  appState,
  activityStatus,
  combatLoggingStatus,
  setPreviewEnabled,
  compact = false,
  summary,
}: StatusProps) => {
  const { language } = appState;
  const [recTimerSec, setRecTimerSec] = useState(0);

  useEffect(() => {
    if (!activityStatus) return;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - activityStatus.start) / 1000);
      setRecTimerSec(elapsed);
    };

    tick();
    const id = setInterval(tick, 1000);

    return () => {
      clearInterval(id);
      setRecTimerSec(0);
    };
  }, [activityStatus]);

  const stopRecording = () => {
    window.electron.ipcRenderer.forceStopRecording();
  };

  const getConfiguredFlavours = () => {
    const flavours: string[] = [];

    if (config.recordRetail) {
      const s = getLocalePhrase(language, Phrase.Retail);
      flavours.push(s);
    }

    if (config.recordRetailPtr) {
      const s = getLocalePhrase(language, Phrase.RetailPtr);
      flavours.push(s);
    }

    if (flavours.length > 0) {
      return `${flavours.join(', ')}.`;
    }

    return getLocalePhrase(language, Phrase.StatusDescriptionNothing);
  };

  // The description for each status, which shows in the popover when the status title is hovered
  // This can be undefined, to skip the popover functionality altogether
  const RecStatusDescription: Record<RecStatus, React.ReactNode | undefined> = {
    [RecStatus.Recording]: (
      <div className="flex flex-col gap-y-2">
        <h2 className="text-sm font-semibold">
          {getLocalePhrase(language, Phrase.StatusDescriptionRecording)}
        </h2>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(language, Phrase.StatusDescriptionForceEnd)}
        </p>
        <div className="flex w-full justify-end">
          <Button size="sm" onClick={stopRecording} className="mt-2 w-1/3">
            {getLocalePhrase(language, Phrase.StatusButtonForceEndLabel)}
          </Button>
        </div>
      </div>
    ),
    [RecStatus.WaitingForWoW]: (
      <div className="flex flex-col gap-y-2">
        <h2 className="text-sm font-semibold">
          {getLocalePhrase(language, Phrase.StatusDescriptionWaiting)}
        </h2>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(
            language,
            Phrase.StatusDescriptionConfiguredToRecord,
          )}{' '}
          {getConfiguredFlavours()}
        </p>
      </div>
    ),
    [RecStatus.InvalidConfig]: (
      <div className="flex flex-col gap-y-2">
        <h2 className="text-sm font-semibold">
          {getLocalePhrase(language, Phrase.StatusDescriptionMisconfigured)}
        </h2>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(language, Phrase.StatusDescriptionPleaseResolve)}
        </p>
        <p className="text-xs text-error-text">{error}</p>
      </div>
    ),
    [RecStatus.ReadyToRecord]: (
      <div className="flex flex-col gap-y-2">
        <h2 className="text-sm font-semibold">
          {getLocalePhrase(language, Phrase.StatusDescriptionDetectedRunning)}
        </h2>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(language, Phrase.StatusDescriptionWatchingLogs)}
          {': '}
        </p>
        <ul className="text-xs text-popover-foreground/60 list-disc pl-4">
          {config.recordRetail && (
            <li>
              <span className="font-bold">
                {getLocalePhrase(language, Phrase.Retail)}
                {': '}
              </span>
              {!combatLoggingStatus.retail.advanced && (
                <Tooltip
                  content={getLocalePhrase(
                    language,
                    Phrase.AdvancedCombatLoggingDisabledWarning,
                  )}
                >
                  <TriangleAlert
                    size={12}
                    fill="#facc15"
                    className="text-yellow-900 mr-1 inline align-middle -mt-0.5"
                  />
                </Tooltip>
              )}
              <code>{config.retailLogPath}</code>
            </li>
          )}

          {config.recordRetailPtr && (
            <li>
              <span className="font-bold">
                {getLocalePhrase(language, Phrase.RetailPtr)}
                {': '}
              </span>
              {!combatLoggingStatus.retailPtr.advanced && (
                <Tooltip
                  content={getLocalePhrase(
                    language,
                    Phrase.AdvancedCombatLoggingDisabledWarning,
                  )}
                >
                  <TriangleAlert
                    size={12}
                    fill="#facc15"
                    className="text-yellow-900 mr-1 inline align-middle -mt-0.5"
                  />
                </Tooltip>
              )}
              <code>{config.retailPtrLogPath}</code>
            </li>
          )}
        </ul>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          <span className="font-bold">
            {getLocalePhrase(language, Phrase.StatusDescriptionTip)}
            {': '}
          </span>
          {getLocalePhrase(language, Phrase.StatusDescriptionIfNoRecording)}
        </p>
      </div>
    ),
    [RecStatus.FatalError]: (
      <div className="flex flex-col gap-y-2">
        <h2 className="text-sm font-semibold">
          {getLocalePhrase(language, Phrase.StatusDescriptionFatalError)}
        </h2>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(language, Phrase.StatusDescriptionPleaseResolve)}
        </p>
        <p className="text-xs text-error-text">{error}</p>
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(language, Phrase.StatusDescriptionIfRecurring)}
        </p>
      </div>
    ),
    [RecStatus.Overrunning]: (
      <div className="flex flex-col gap-y-2">
        <h2 className="text-sm font-semibold">Overrunning ...</h2>
        <Separator className="my-1" />
        <p className="text-xs text-popover-foreground/60">
          {getLocalePhrase(language, Phrase.StatusDescriptionOverrunning)}
        </p>
      </div>
    ),
    [RecStatus.Reconfiguring]: undefined,
  };

  const statusDescription = RecStatusDescription[status];

  const line = recorderLine(status, error, sidebarLabels(language));
  // "Ready to record" while WoW isn't running yet: the card says what it's waiting for.
  const waiting = status === RecStatus.WaitingForWoW;
  const isSaving = savingStatus === SaveStatus.Saving;
  const hasCard = !!statusDescription || (compact && !!summary);

  return (
    <HoverCard
      openDelay={300}
      onOpenChange={(open) => {
        if (statusDescription) setPreviewEnabled(!open);
      }}
    >
      <HoverCardTrigger asChild>
        {/* [RoomFortyRecorder] Design A: 8 px dot + one line, details on hover. */}
        {compact ? (
          <button
            type="button"
            data-status="recorder"
            data-state={line.tone}
            aria-label={line.text}
            className="relative flex h-6 w-6 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          >
            <Dot tone={line.tone} pulse={line.pulse} />
          </button>
        ) : (
          <div
            data-status="recorder"
            data-state={line.tone}
            className="w-full flex items-center gap-x-2 hover:cursor-pointer min-h-5"
          >
            <Dot tone={line.tone} pulse={line.pulse} />
            <div
              className="rf-status-text min-w-0 flex items-center gap-x-1.5 text-[13px] leading-5 font-medium text-foreground-lighter whitespace-nowrap"
              title={
                waiting
                  ? getLocalePhrase(language, Phrase.StatusDescriptionWaiting)
                  : undefined
              }
            >
              <span
                className={cn('truncate', {
                  'text-error-text': line.tone === 'bad',
                  'text-yellow-400': line.tone === 'warn',
                })}
              >
                {line.text}
              </span>
              {recTimerSec > 0 && (
                <span className="font-normal tabular-nums text-foreground">
                  {secToMmSs(recTimerSec)}
                </span>
              )}
              {isSaving && (
                <HardDriveDownload
                  size={14}
                  className="animate-pulse text-foreground"
                />
              )}
            </div>
          </div>
        )}
      </HoverCardTrigger>
      {hasCard && (
        <HoverCardContent
          className={compact ? 'w-[340px] mx-4' : 'w-[500px] mx-4'}
          side={compact ? 'right' : undefined}
        >
          {compact && summary && (
            <div className="flex flex-col gap-y-1 mb-3">{summary}</div>
          )}
          {statusDescription}
        </HoverCardContent>
      )}
    </HoverCard>
  );
};

export default Status;
