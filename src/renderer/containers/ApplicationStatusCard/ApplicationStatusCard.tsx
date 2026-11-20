import {
  ActivityStatus,
  AppState,
  CombatLoggingStatus,
  ErrorReport,
  MicStatus,
  RecStatus,
  SaveStatus,
} from 'main/types';
import { Dispatch, SetStateAction } from 'react';
import { ConfigurationSchema } from 'config/configSchema';
import MicrophoneStatus from './MicStatus';
import Status from './Status';
import ErrorReporter from './ErrorReporter';
import CloudStatus, { signInRow } from './CloudStatus';
import Dot, { TONE_TEXT } from './Dot';
import { pullLine, recorderLine, serverLine } from 'renderer/sidebarStatus';
import { useLastPull, useServerCheck } from 'renderer/useSidebarStatus';
import { describeUpload } from 'renderer/uploadLines';
import { cn } from 'renderer/components/utils';

type ApplicationStatusCardProps = {
  recorderStatus: RecStatus;
  error: string;
  micStatus: MicStatus;
  errorReports: ErrorReport[];
  savingStatus: SaveStatus;
  config: ConfigurationSchema;
  setConfig?: Dispatch<SetStateAction<ConfigurationSchema>>;
  appState: AppState;
  activityStatus: ActivityStatus | null;
  combatLoggingStatus: CombatLoggingStatus;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  /** Folded sidebar: just the recorder's status dot (details on hover). */
  compact?: boolean;
};

const ApplicationStatusCard = ({
  recorderStatus,
  error,
  micStatus,
  errorReports,
  savingStatus,
  config,
  setConfig,
  appState,
  activityStatus,
  combatLoggingStatus,
  setPreviewEnabled,
  compact = false,
}: ApplicationStatusCardProps) => {
  const signInState = appState.cloudStatus.signIn.state;
  const server = useServerCheck(signInState);
  const lastPull = useLastPull();
  const pull = pullLine(
    lastPull,
    lastPull ? describeUpload(lastPull).text : '',
  );

  if (compact) {
    // Folded sidebar: one dot for the recorder, a small second dot when the
    // guild server needs a look; the lines are in the hover card.
    const rec = recorderLine(recorderStatus, error);
    const row = signInRow(appState.cloudStatus, appState.language);
    const srv = serverLine({
      variant: row.variant,
      rowLabel: row.rowLabel,
      userName: config.cloudDiscordName,
      server,
    });
    const attention =
      srv.tone === 'bad' || srv.tone === 'warn' ? srv.tone : null;
    const summary = (
      <>
        <span className={cn('text-sm font-semibold', TONE_TEXT[rec.tone])}>
          {rec.text}
        </span>
        <span className={cn('text-xs', TONE_TEXT[srv.tone])}>
          {srv.trail ? `${srv.lead} · ${srv.trail}` : srv.lead}
        </span>
        {pull && (
          <span className={cn('text-xs', TONE_TEXT[pull.tone])}>
            {pull.text}
          </span>
        )}
      </>
    );
    return (
      <div className="w-full rounded-lg border border-panel-line bg-walnut py-2 mb-2 flex justify-center">
        <div className="relative">
          <Status
            status={recorderStatus}
            error={error}
            savingStatus={savingStatus}
            config={config}
            appState={appState}
            activityStatus={activityStatus}
            combatLoggingStatus={combatLoggingStatus}
            setPreviewEnabled={setPreviewEnabled}
            compact
            summary={summary}
          />
          {attention && (
            <Dot
              tone={attention}
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 pointer-events-none shadow-none ring-2 ring-walnut"
            />
          )}
        </div>
      </div>
    );
  }

  // [RoomFortyRecorder] Design A status card: line 1 is the recorder (ready,
  // recording, not ready) with the mic and crash icons; line 2 the guild
  // server and sign-in; line 3 the last pull, only when there is one.
  return (
    <div className="w-full rounded-lg border border-panel-line bg-walnut p-3 mb-3 flex flex-col gap-y-2">
      <div className="flex items-center gap-x-2">
        <div className="min-w-0 flex-1">
          <Status
            status={recorderStatus}
            error={error}
            savingStatus={savingStatus}
            config={config}
            appState={appState}
            activityStatus={activityStatus}
            combatLoggingStatus={combatLoggingStatus}
            setPreviewEnabled={setPreviewEnabled}
          />
        </div>
        <div className="flex items-center gap-x-1.5 text-foreground shrink-0 [&_svg]:w-4 [&_svg]:h-4">
          <MicrophoneStatus micStatus={micStatus} appState={appState} />
          <ErrorReporter errorReports={errorReports} appState={appState} />
        </div>
      </div>
      <CloudStatus
        appState={appState}
        setPreviewEnabled={setPreviewEnabled}
        userName={config.cloudDiscordName}
        setConfig={setConfig}
        server={server}
      />
      {pull && (
        <p
          data-status="last-pull"
          data-state={pull.tone}
          title={pull.title}
          className={cn(
            'pl-4 text-xs leading-4 font-sans m-0 truncate',
            TONE_TEXT[pull.tone],
            pull.tone === 'brass' && 'animate-pulse',
          )}
        >
          {pull.text}
        </p>
      )}
    </div>
  );
};

export default ApplicationStatusCard;
