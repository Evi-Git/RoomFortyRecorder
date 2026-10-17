import { ConfigurationSchema } from 'config/configSchema';
import { AudioSource, CharacterFilter } from 'main/types';
import * as React from 'react';

export const getConfigValue = <T>(configKey: string): T => {
  return window.electron.ipcRenderer.sendSync('config', [
    'get',
    configKey,
  ]) as T;
};

export const setConfigValue = (configKey: string, value: any): void => {
  window.electron.ipcRenderer.sendMessage('config', ['set', configKey, value]);
};

export const setConfigValues = (dict: { [key: string]: any }): void => {
  window.electron.ipcRenderer.sendMessage('config', ['set_values', dict]);
};

export const getSettings = (): ConfigurationSchema => {
  const configValues = {
    storagePath: getConfigValue<string>('storagePath'),
    bufferStoragePath: getConfigValue<string>('bufferStoragePath'),
    separateBufferPath: getConfigValue<boolean>('separateBufferPath'),
    retailLogPath: getConfigValue<string>('retailLogPath'),
    retailPtrLogPath: getConfigValue<string>('retailPtrLogPath'),
    maxStorage: getConfigValue<number>('maxStorage'),
    minEncounterDuration: getConfigValue<number>('minEncounterDuration'),
    monitorIndex: getConfigValue<number>('monitorIndex'),
    audioSources: getConfigValue<AudioSource[]>('audioSources'),
    startUp: getConfigValue<boolean>('startUp'),
    startMinimized: getConfigValue<boolean>('startMinimized'),
    recordRetail: getConfigValue<boolean>('recordRetail'),
    recordRetailPtr: getConfigValue<boolean>('recordRetailPtr'),
    recordRaids: getConfigValue<boolean>('recordRaids'),
    recordDungeons: getConfigValue<boolean>('recordDungeons'),
    obsOutputResolution: getConfigValue<string>('obsOutputResolution'),
    obsFPS: getConfigValue<number>('obsFPS'),
    obsForceMono: getConfigValue<boolean>('obsForceMono'),
    obsQuality: getConfigValue<string>('obsQuality'),
    obsCaptureMode: getConfigValue<string>('obsCaptureMode'),
    obsRecEncoder: getConfigValue<string>('obsRecEncoder'),
    minKeystoneLevel: getConfigValue<number>('minKeystoneLevel'),
    minimizeOnQuit: getConfigValue<boolean>('minimizeOnQuit'),
    minimizeToTray: getConfigValue<boolean>('minimizeToTray'),
    minRaidDifficulty: getConfigValue<string>('minRaidDifficulty'),
    chatOverlayEnabled: getConfigValue<boolean>('chatOverlayEnabled'),
    chatOverlayOwnImage: getConfigValue<boolean>('chatOverlayOwnImage'),
    chatOverlayOwnImagePath: getConfigValue<string>('chatOverlayOwnImagePath'),
    chatOverlayScale: getConfigValue<number>('chatOverlayScale'),
    chatOverlayXPosition: getConfigValue<number>('chatOverlayXPosition'),
    chatOverlayYPosition: getConfigValue<number>('chatOverlayYPosition'),
    chatOverlayCropX: getConfigValue<number>('chatOverlayCropX'),
    chatOverlayCropY: getConfigValue<number>('chatOverlayCropY'),
    captureCursor: getConfigValue<boolean>('captureCursor'),
    selectedCategory: getConfigValue<number>('selectedCategory'),
    deathMarkers: getConfigValue<number>('deathMarkers'),
    encounterMarkers: getConfigValue<boolean>('encounterMarkers'),
    pushToTalk: getConfigValue<boolean>('pushToTalk'),
    pushToTalkKey: getConfigValue<number>('pushToTalkKey'),
    pushToTalkMouseButton: getConfigValue<number>('pushToTalkMouseButton'),
    pushToTalkModifiers: getConfigValue<string>('pushToTalkModifiers'),
    pushToTalkReleaseDelay: getConfigValue<number>('pushToTalkReleaseDelay'),
    obsAudioSuppression: getConfigValue<boolean>('obsAudioSuppression'),
    raidOverrun: getConfigValue<number>('raidOverrun'),
    dungeonOverrun: getConfigValue<number>('dungeonOverrun'),
    cloudStorage: getConfigValue<boolean>('cloudStorage'),
    cloudUpload: getConfigValue<boolean>('cloudUpload'),
    cloudUploadRetail: getConfigValue<boolean>('cloudUploadRetail'),
    cloudUploadRateLimit: getConfigValue<boolean>('cloudUploadRateLimit'),
    cloudUploadRateLimitMbps: getConfigValue<number>(
      'cloudUploadRateLimitMbps',
    ),
    cloudSessionToken: getConfigValue<string>('cloudSessionToken'),
    liveResolution: getConfigValue<string>('liveResolution'),
    liveFps: getConfigValue<string>('liveFps'),
    liveBitrate: getConfigValue<number>('liveBitrate'),
    pullDeskUpload: getConfigValue<boolean>('pullDeskUpload'),
    cloudDiscordName: getConfigValue<string>('cloudDiscordName'),
    cloudUploadDungeons: getConfigValue<boolean>('cloudUploadDungeons'),
    cloudUploadRaids: getConfigValue<boolean>('cloudUploadRaids'),
    cloudUploadRaidMinDifficulty: getConfigValue<string>(
      'cloudUploadRaidMinDifficulty',
    ),
    cloudUploadDungeonMinLevel: getConfigValue<number>(
      'cloudUploadDungeonMinLevel',
    ),
    cloudUploadClips: getConfigValue<boolean>('cloudUploadClips'),
    language: getConfigValue<string>('language'),
    hideEmptyCategories: getConfigValue<boolean>('hideEmptyCategories'),
    hardwareAcceleration: getConfigValue<boolean>('hardwareAcceleration'),
    recordCurrentRaidEncountersOnly: getConfigValue<boolean>(
      'recordCurrentRaidEncountersOnly',
    ),
    uploadCurrentRaidEncountersOnly: getConfigValue<boolean>(
      'uploadCurrentRaidEncountersOnly',
    ),
    forceSdr: getConfigValue<boolean>('forceSdr'),
    videoSourceScale: getConfigValue<number>('videoSourceScale'),
    videoSourceXPosition: getConfigValue<number>('videoSourceXPosition'),
    videoSourceYPosition: getConfigValue<number>('videoSourceYPosition'),
    manualRecord: getConfigValue<boolean>('manualRecord'),
    manualRecordHotKey: getConfigValue<number>('manualRecordHotKey'),
    manualRecordHotKeyModifiers: getConfigValue<string>(
      'manualRecordHotKeyModifiers',
    ),
    manualRecordSoundAlert: getConfigValue<boolean>('manualRecordSoundAlert'),
    manualRecordUpload: getConfigValue<boolean>('manualRecordUpload'),
    firstTimeSetup: getConfigValue<boolean>('firstTimeSetup'),
    chatUserNameAgreed: getConfigValue<string>('chatUserNameAgreed'),
    validateLogPaths: getConfigValue<boolean>('validateLogPaths'),
    validateNtfs: getConfigValue<boolean>('validateNtfs'),
    characterUploadFilters: getConfigValue<CharacterFilter[]>(
      'characterUploadFilters',
    ),
  };

  return configValues;
};

export const useSettings = (): [
  ConfigurationSchema,
  React.Dispatch<React.SetStateAction<ConfigurationSchema>>,
] => {
  const configValues = getSettings();
  return React.useState<ConfigurationSchema>(configValues);
};
