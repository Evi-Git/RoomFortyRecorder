import { Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import type { AppState } from 'main/types';
import type { SidebarLabels } from './sidebarStatus';

/** The status card's wording in the app's language. */
export const sidebarLabels = (
  language: AppState['language'],
): SidebarLabels => {
  const t = (p: Phrase) => getLocalePhrase(language, p);
  return {
    ready: t(Phrase.SidebarReady),
    waiting: t(Phrase.SidebarWaiting),
    recording: t(Phrase.SidebarRecording),
    notReady: t(Phrase.SidebarNotReady),
    finishing: t(Phrase.SidebarFinishing),
    gettingReady: t(Phrase.SidebarGettingReady),
    guildServer: t(Phrase.SidebarGuildServer),
    lastPull: t(Phrase.SidebarLastPull),
    needsUpdate: t(Phrase.SidebarNeedsUpdate),
    signedInAs: t(Phrase.SidebarSignedInAs),
    sent: t(Phrase.SidebarSent),
    queued: t(Phrase.SidebarQueued),
    notSent: t(Phrase.SidebarNotSent),
    sending: t(Phrase.SidebarSending),
    connected: t(Phrase.SidebarConnected),
  };
};
