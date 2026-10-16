import { Phrase } from 'localisation/phrases';
import { defaultAudioTrack } from 'main/constants';
import { AudioSource, AudioSourceType, CharacterFilter } from 'main/types';

export type ConfigurationSchema = {
  storagePath: string;
  bufferStoragePath: string;
  separateBufferPath: boolean;
  retailLogPath: string;
  retailPtrLogPath: string;
  maxStorage: number;
  monitorIndex: number;
  selectedCategory: number;
  audioSources: AudioSource[];
  minEncounterDuration: number;
  startUp: boolean;
  startMinimized: boolean;
  obsOutputResolution: string;
  obsFPS: number;
  obsForceMono: boolean;
  obsQuality: string;
  obsCaptureMode: string; // 'window_capture' or 'game_capture' or 'monitor_capture'
  obsRecEncoder: string;
  recordRetail: boolean;
  recordRetailPtr: boolean;
  recordRaids: boolean;
  recordDungeons: boolean;
  captureCursor: boolean;
  minKeystoneLevel: number;
  minRaidDifficulty: string;
  minimizeOnQuit: boolean;
  minimizeToTray: boolean;
  chatOverlayEnabled: boolean;
  chatOverlayOwnImage: boolean;
  chatOverlayOwnImagePath: string;
  chatOverlayScale: number;
  chatOverlayXPosition: number;
  chatOverlayYPosition: number;
  chatOverlayCropX: number;
  chatOverlayCropY: number;
  deathMarkers: number;
  encounterMarkers: boolean;
  pushToTalk: boolean;
  pushToTalkKey: number;
  pushToTalkMouseButton: number;
  pushToTalkModifiers: string;
  pushToTalkReleaseDelay: number;
  obsAudioSuppression: boolean;
  raidOverrun: number;
  dungeonOverrun: number;
  cloudStorage: boolean;
  cloudUpload: boolean;
  cloudUploadRetail: boolean;
  cloudUploadRateLimit: boolean;
  cloudUploadRateLimitMbps: number;
  cloudSessionToken: string;
  liveResolution: string;
  liveFps: string;
  liveBitrate: number;
  cloudDiscordName: string;
  cloudUploadDungeons: boolean;
  cloudUploadRaids: boolean;
  cloudUploadRaidMinDifficulty: string;
  cloudUploadDungeonMinLevel: number;
  cloudUploadClips: boolean;
  language: string;
  hideEmptyCategories: boolean;
  hardwareAcceleration: boolean;
  recordCurrentRaidEncountersOnly: boolean;
  uploadCurrentRaidEncountersOnly: boolean;
  forceSdr: boolean;
  videoSourceScale: number;
  videoSourceXPosition: number;
  videoSourceYPosition: number;
  manualRecord: boolean;
  manualRecordHotKey: number;
  manualRecordHotKeyModifiers: string;
  manualRecordSoundAlert: boolean;
  manualRecordUpload: boolean;
  firstTimeSetup: boolean;
  chatUserNameAgreed: string;
  validateLogPaths: boolean;
  validateNtfs: boolean;
  characterUploadFilters: CharacterFilter[];
};

export type ConfigurationSchemaKey = keyof ConfigurationSchema;

/**
 * Config schema. The descriptions included here may get displayed in the UI.
 */
export const configSchema = {
  storagePath: {
    description: Phrase.StoragePathDescription,
    type: 'string',
    default: '',
  },
  separateBufferPath: {
    description: Phrase.SeparateBufferPathDescription,
    type: 'boolean',
    default: false,
  },
  bufferStoragePath: {
    description: Phrase.BufferStoragePathDescription,
    type: 'string',
    default: '',
  },
  retailLogPath: {
    description: Phrase.RetailLogPathDescription,
    type: 'string',
    default: '',
  },
  retailPtrLogPath: {
    description: Phrase.RetailPtrLogPathDescription,
    type: 'string',
    default: '',
  },
  maxStorage: {
    description: Phrase.MaxStorageDescription,
    type: 'integer',
    default: 50,
    minimum: 0,
  },
  monitorIndex: {
    description: Phrase.MonitorIndexDescription,
    type: 'integer',
    default: 0,
    minimum: 1,
    maximum: 4,
  },
  selectedCategory: {
    description: Phrase.SelectedCategoryDescription,
    type: 'integer',
    default: 1,
  },
  audioSources: {
    description: Phrase.AudioProcessDevicesDescription,
    type: 'array',
    default: [
      {
        id: 'WCR Audio Source 1',
        friendly: 'default',
        device: 'default',
        volume: 1,
        type: AudioSourceType.OUTPUT,
        tracks: defaultAudioTrack,
      },
      {
        id: 'WCR Audio Source 2',
        friendly: 'default',
        device: 'default',
        volume: 1,
        type: AudioSourceType.INPUT,
        tracks: defaultAudioTrack,
      },
    ],
  },
  minEncounterDuration: {
    description: Phrase.MinEncounterDurationDescription,
    type: 'integer',
    default: 15,
    maximum: 10000,
  },
  startUp: {
    description: Phrase.StartUpDescription,
    type: 'boolean',
    default: false,
  },
  startMinimized: {
    description: Phrase.StartMinimizedDescription,
    type: 'boolean',
    default: false,
  },
  obsOutputResolution: {
    description: Phrase.ObsOutputResolutionDescription,
    type: 'string',
    default: '1920x1080',
  },
  obsFPS: {
    description: Phrase.ObsFPSDescription,
    type: 'integer',
    default: 60,
    minimum: 15,
    maximum: 60,
  },
  obsForceMono: {
    description: Phrase.ObsForceMonoDescription,
    type: 'boolean',
    default: true,
  },
  obsQuality: {
    description: Phrase.ObsQualityDescription,
    type: 'string',
    default: 'Moderate',
  },
  obsCaptureMode: {
    description: Phrase.ObsCaptureModeDescription,
    type: 'string',
    default: 'window_capture',
  },
  obsRecEncoder: {
    description: Phrase.ObsRecEncoderDescription,
    type: 'string',
    default: 'obs_x264',
  },
  recordRetail: {
    description: Phrase.RecordRetailDescription,
    type: 'boolean',
    default: false,
  },
  recordRetailPtr: {
    description: Phrase.RecordRetailPtrDescription,
    type: 'boolean',
    default: false,
  },
  recordRaids: {
    description: Phrase.RecordRaidsDescription,
    type: 'boolean',
    default: true,
  },
  recordDungeons: {
    description: Phrase.RecordDungeonsDescription,
    type: 'boolean',
    default: true,
  },
  captureCursor: {
    description: Phrase.CaptureCursorDescription,
    type: 'boolean',
    default: false,
  },
  minKeystoneLevel: {
    description: Phrase.MinKeystoneLevelDescription,
    type: 'integer',
    default: 2,
  },
  minRaidDifficulty: {
    description: Phrase.MinRaidDifficultyDescription,
    type: 'string',
    default: 'LFR',
  },
  minimizeOnQuit: {
    description: Phrase.MinimizeOnQuitDescription,
    type: 'boolean',
    default: true,
  },
  minimizeToTray: {
    description: Phrase.MinimizeToTrayDescription,
    type: 'boolean',
    default: true,
  },
  chatOverlayEnabled: {
    description: Phrase.ChatOverlayEnabledDescription,
    type: 'boolean',
    default: false,
  },
  chatOverlayOwnImage: {
    description: Phrase.ChatOverlayOwnImageDescription,
    type: 'boolean',
    default: false,
  },
  chatOverlayOwnImagePath: {
    description: Phrase.ChatOverlayOwnImagePathDescription,
    type: 'string',
    default: '',
  },
  chatOverlayScale: {
    description: Phrase.ChatOverlayScaleDescription,
    type: 'integer',
    default: 1,
  },
  chatOverlayXPosition: {
    description: Phrase.ChatOverlayXPositionDescription,
    type: 'integer',
    default: 0,
  },
  chatOverlayYPosition: {
    description: Phrase.ChatOverlayYPositionDescription,
    type: 'integer',
    default: 0,
  },
  chatOverlayCropX: {
    description: Phrase.ChatOverlayWidthDescription,
    type: 'integer',
    default: 0,
  },
  chatOverlayCropY: {
    description: Phrase.ChatOverlayHeightDescription,
    type: 'integer',
    default: 0,
  },
  deathMarkers: {
    description: Phrase.DeathMarkersDescription,
    type: 'integer',
    default: 1,
  },
  encounterMarkers: {
    description: Phrase.EncounterMarkersDescription,
    type: 'integer',
    default: true,
  },
  pushToTalk: {
    description: Phrase.PushToTalkDescription,
    type: 'boolean',
    default: false,
  },
  pushToTalkKey: {
    description: Phrase.PushToTalkKeyDescription,
    type: 'integer',
    default: -1,
  },
  pushToTalkMouseButton: {
    description: Phrase.PushToTalkMouseButtonDescription,
    type: 'integer',
    default: -1,
  },
  pushToTalkModifiers: {
    description: Phrase.PushToTalkModifiersDescription,
    type: 'string',
    default: '',
  },
  pushToTalkReleaseDelay: {
    description: Phrase.PushToTalkReleaseDelayDescription,
    type: 'integer',
    default: 0,
    minimum: 0,
    maximum: 2000,
  },
  obsAudioSuppression: {
    description: Phrase.ObsAudioSuppressionDescription,
    type: 'boolean',
    default: true,
  },
  raidOverrun: {
    description: Phrase.RaidOverrunDescription,
    type: 'integer',
    default: 15,
    minimum: 0,
    maximum: 60,
  },
  dungeonOverrun: {
    description: Phrase.DungeonOverrunDescription,
    type: 'integer',
    default: 5,
    minimum: 0,
    maximum: 60,
  },
  cloudStorage: {
    description: Phrase.CloudStorageDescription,
    type: 'boolean',
    default: false,
  },
  cloudUpload: {
    description: Phrase.CloudUploadDescription,
    type: 'boolean',
    default: false,
  },
  cloudUploadRetail: {
    description: Phrase.CloudUploadRetailDescription,
    type: 'boolean',
    default: true,
  },
  cloudUploadRateLimit: {
    description: Phrase.CloudUploadRateLimitDescription,
    type: 'boolean',
    default: false,
  },
  cloudUploadRateLimitMbps: {
    description: Phrase.CloudUploadRateLimitMbpsDescription,
    type: 'integer',
    default: 100,
  },
  cloudSessionToken: {
    description: Phrase.CloudStorageDescription,
    type: 'string',
    default: '',
  },
  // [RoomFortyRecorder] Go live stream quality. Descriptions reuse existing
  // phrases; the settings UI has its own English labels.
  liveResolution: {
    description: Phrase.ObsFPSDescription,
    type: 'string',
    default: '1080',
  },
  liveFps: {
    description: Phrase.ObsFPSDescription,
    type: 'string',
    default: 'full',
  },
  liveBitrate: {
    description: Phrase.ObsFPSDescription,
    type: 'integer',
    default: 7000,
    minimum: 1000,
    maximum: 20000,
  },
  cloudDiscordName: {
    description: Phrase.CloudStorageDescription,
    type: 'string',
    default: '',
  },
  cloudUploadDungeons: {
    description: Phrase.CloudUploadDungeonsDescription,
    type: 'boolean',
    default: true,
  },
  cloudUploadRaids: {
    description: Phrase.CloudUploadRaidsDescription,
    type: 'boolean',
    default: true,
  },
  cloudUploadRaidMinDifficulty: {
    description: Phrase.CloudUploadRaidMinDifficultyDescription,
    type: 'string',
    default: 'LFR',
  },
  cloudUploadDungeonMinLevel: {
    description: Phrase.CloudUploadDungeonMinLevelDescription,
    type: 'integer',
    default: 2,
  },
  cloudUploadClips: {
    description: Phrase.CloudUploadClipsDescription,
    type: 'boolean',
    default: true,
  },
  language: {
    description: Phrase.LanguageDescription,
    type: 'string',
    default: 'English',
  },
  hideEmptyCategories: {
    description: Phrase.HideEmptyCategoriesDescription,
    type: 'boolean',
    default: false,
  },
  hardwareAcceleration: {
    description: Phrase.HardwareAccelerationDescription,
    type: 'boolean',
    default: false,
  },
  recordCurrentRaidEncountersOnly: {
    description: Phrase.RecordCurrentRaidsOnlyDescription,
    type: 'boolean',
    default: false,
  },
  uploadCurrentRaidEncountersOnly: {
    description: Phrase.UploadCurrentRaidsOnlyDescription,
    type: 'boolean',
    default: false,
  },
  forceSdr: {
    description: Phrase.ForceSdrDescription,
    type: 'boolean',
    default: false,
  },
  videoSourceScale: {
    description: Phrase.VideoSourceScaleDescription,
    type: 'number',
    default: 1,
  },
  videoSourceXPosition: {
    description: Phrase.VideoSourceXPositionDescription,
    type: 'number',
    default: 0,
  },
  videoSourceYPosition: {
    description: Phrase.VideoSourceYPositionDescription,
    type: 'number',
    default: 0,
  },
  manualRecord: {
    description: Phrase.ManualRecordDescription,
    type: 'boolean',
    default: false,
  },
  manualRecordHotKey: {
    description: Phrase.ManualRecordHotKeyDescription,
    type: 'integer',
    default: -1,
  },
  manualRecordHotKeyModifiers: {
    description: Phrase.ManualRecordHotKeyDescription,
    type: 'string',
    default: '',
  },
  manualRecordSoundAlert: {
    description: Phrase.ManualRecordSoundAlertDescription,
    type: 'boolean',
    default: true,
  },
  manualRecordUpload: {
    description: Phrase.ManualRecordUploadDescription,
    type: 'boolean',
    default: true,
  },
  firstTimeSetup: {
    description: Phrase.FirstTimeSetupDescription,
    type: 'boolean',
    default: true,
  },
  chatUserNameAgreed: {
    description: Phrase.Unknown, // Not actually exposed.
    type: 'string',
    default: '',
  },
  validateLogPaths: {
    description: Phrase.ValidateLogPathsDescription,
    type: 'boolean',
    default: true,
  },
  validateNtfs: {
    description: Phrase.ValidateNtfsDescription,
    type: 'boolean',
    default: true,
  },
  characterUploadFilters: {
    description: Phrase.Unknown, // Not actually exposed.
    type: 'array',
    default: [],
  },
};
