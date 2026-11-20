import { getLocalePhrase } from 'localisation/translations';
import { Language, Phrase } from 'localisation/phrases';
import {
  CalendarDays,
  Eye,
  Joystick,
  Gamepad2,
  Hash,
  Hourglass,
  MapPinned,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';

export const EncounterHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Gamepad2 className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderEncounter)}
    </span>
  </span>
);

export const ResultHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Trophy className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderResult)}
    </span>
  </span>
);

export const PullHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Hash className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderPull)}
    </span>
  </span>
);

export const DifficultyHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Swords className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderDifficulty)}
    </span>
  </span>
);

export const DurationHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Hourglass className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderDuration)}
    </span>
  </span>
);

export const DateHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <CalendarDays className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderDate)}
    </span>
  </span>
);

export const ClippedAtHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <CalendarDays className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.ClippedAtLabel)}
    </span>
  </span>
);

export const ViewpointsHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Eye className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderViewpoints)}
    </span>
  </span>
);

export const MapHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <MapPinned className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderMap)}
    </span>
  </span>
);

export const LevelHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Swords className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderDifficulty)}
    </span>
  </span>
);

export const AffixesHeader = () => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Zap className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">Affixes</span>
  </span>
);

export const TypeHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Joystick className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.TableHeaderType)}
    </span>
  </span>
);

export const ActivityHeader = (language: Language) => (
  <span className="inline-flex min-w-0 items-center gap-x-1">
    <Gamepad2 className="h-[18px] w-[18px] shrink-0" />
    <span className="truncate">
      {getLocalePhrase(language, Phrase.Activity)}
    </span>
  </span>
);

export const DetailsHeader = () => (
  <span className="inline-flex min-w-0 items-center gap-x-1"></span>
);
