import * as React from 'react';
import { getLocalePhrase } from 'localisation/translations';
import { Language, Phrase } from 'localisation/phrases';

/**
 * [RoomFortyRecorder] Design A table headers: plain sentence-case text, no
 * icons. The first and last columns have no visible title, only one for
 * screen readers.
 */
const Title = ({ children }: { children: React.ReactNode }) => (
  <span className="truncate">{children}</span>
);

export const EncounterHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderEncounter)}</Title>
);

export const ResultHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderResult)}</Title>
);

export const PullHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderPull)}</Title>
);

export const DifficultyHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderDifficulty)}</Title>
);

export const DurationHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderDuration)}</Title>
);

export const DateHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderDate)}</Title>
);

export const ClippedAtHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.ClippedAtLabel)}</Title>
);

export const ViewpointsHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderViewpoints)}</Title>
);

export const MapHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderMap)}</Title>
);

export const LevelHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderDifficulty)}</Title>
);

export const AffixesHeader = () => <Title>Affixes</Title>;

export const TypeHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.TableHeaderType)}</Title>
);

export const ActivityHeader = (language: Language) => (
  <Title>{getLocalePhrase(language, Phrase.Activity)}</Title>
);

/** The protect (lock) column. */
export const DetailsHeader = () => <span className="sr-only">Protected</span>;

/** The row actions column (tag, kill video, clip source). */
export const ActionsHeader = () => <span className="sr-only">Actions</span>;
