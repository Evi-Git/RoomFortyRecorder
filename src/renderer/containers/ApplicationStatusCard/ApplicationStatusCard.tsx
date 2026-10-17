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
import CloudStatus from './CloudStatus';

type ApplicationStatusCardProps = {
  recorderStatus: RecStatus;
  error: string;
  micStatus: MicStatus;
  errorReports: ErrorReport[];
  savingStatus: SaveStatus;
  config: ConfigurationSchema;
  appState: AppState;
  activityStatus: ActivityStatus | null;
  combatLoggingStatus: CombatLoggingStatus;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
};

const ApplicationStatusCard = ({
  recorderStatus,
  error,
  micStatus,
  errorReports,
  savingStatus,
  config,
  appState,
  activityStatus,
  combatLoggingStatus,
  setPreviewEnabled,
}: ApplicationStatusCardProps) => {
  // [RoomFortyRecorder] One compact card: recorder status on top (with the
  // mic and crash icons), cloud status underneath. Each row keeps its own
  // hover details.
  return (
    <div className="w-full rounded-lg bg-card/60 px-3 py-2.5 mb-3 flex flex-col gap-y-1">
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
      />
    </div>
  );
};

export default ApplicationStatusCard;
