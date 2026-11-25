import { getLocalePhrase } from 'localisation/translations';
import { Phrase, Language } from 'localisation/phrases';
import { AppState } from 'main/types';
import { Dispatch, SetStateAction, useCallback } from 'react';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import Datepicker, { DateValueType } from 'react-tailwindcss-datepicker';

interface IProps {
  appState: AppState;
  setAppState: Dispatch<SetStateAction<AppState>>;
}

const DateRangePicker = (props: IProps) => {
  const { appState, setAppState } = props;
  const { dateRangeFilter } = appState;

  // [RoomFortyRecorder] "Nov 17 – Nov 19", with the year only when a date
  // isn't this year (as clock.ts's shortDate does). The input is read-only:
  // typed text would be parsed by the library without a year (to 2001), so
  // dates change through the calendar and its shortcuts.
  const thisYear = new Date().getFullYear();
  const otherYear = [dateRangeFilter?.startDate, dateRangeFilter?.endDate].some(
    (d) => d && new Date(d).getFullYear() !== thisYear,
  );
  const format = otherYear ? 'MMM D, YYYY' : 'MMM D';

  let i18n = 'en';

  if (appState.language === Language.KOREAN) {
    i18n = 'ko';
  } else if (appState.language === Language.GERMAN) {
    i18n = 'de';
  } else if (appState.language === Language.CHINESE_SIMPLIFIED) {
    i18n = 'zh-CN';
  }

  const configs = {
    shortcuts: {
      today: getLocalePhrase(appState.language, Phrase.Today),
      yesterday: getLocalePhrase(appState.language, Phrase.Yesterday),
      past: (period: number) => {
        if (period === 7)
          return getLocalePhrase(appState.language, Phrase.Last7Days);
        if (period === 30)
          return getLocalePhrase(appState.language, Phrase.Last30Days);
        return `Last ${period} days`; // Don't expect to see this.
      },
      currentMonth: getLocalePhrase(appState.language, Phrase.ThisMonth),
      pastMonth: getLocalePhrase(appState.language, Phrase.LastMonth),
    },
    footer: {
      cancel: getLocalePhrase(appState.language, Phrase.Cancel),
      apply: getLocalePhrase(appState.language, Phrase.Apply),
    },
  };

  const onChange = useCallback(
    (v: DateValueType) => {
      // This looks a bit verbose, but it seems the react library
      // used here will provide the same date object if the range
      // is a single day, as well as setting the time to the current
      // time. So make sure that we have separate date objects, set
      // to midnight and a minute to midnight to cover the full day.
      const drf: DateValueType = {
        startDate: null,
        endDate: null,
      };

      if (v && v.startDate) {
        drf.startDate = new Date(v.startDate);
        drf.startDate.setHours(0, 0, 0, 0);
      }
      if (v && v.endDate) {
        drf.endDate = new Date(v.endDate);
        drf.endDate.setHours(23, 59, 59, 999);
      }

      setAppState((prev) => ({
        ...prev,
        dateRangeFilter: drf,
      }));
    },
    [setAppState],
  );

  return (
    <div
      role="group"
      aria-label="Date filter"
      className="relative z-20 w-[200px] shrink-0"
    >
      <CalendarDays
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-foreground"
      />
      <Datepicker
        key={appState.language}
        value={dateRangeFilter}
        onChange={onChange}
        separator={getLocalePhrase(
          appState.language,
          Phrase.DateFilterSeparator,
        )}
        displayFormat={format}
        placeholder="Any date"
        readOnly
        showShortcuts
        showFooter
        primaryColor="red"
        containerClassName="relative tailwind-datepicker" // See App.css for tailwind overrides. This library doesn't expose much.
        inputClassName="relative transition-all duration-300 h-9 pl-9 pr-9 w-full border border-panel-line bg-panel text-foreground-lighter placeholder:text-foreground rounded-lg text-sm placeholder:text-sm focus:outline-none focus:border-brand/60"
        toggleClassName="absolute right-0 h-full px-3 text-foreground focus:outline-none"
        toggleIcon={(empty) =>
          empty ? (
            <span role="img" aria-label="Open the date picker">
              <ChevronDown size={15} />
            </span>
          ) : (
            <span title="Clear dates" role="img" aria-label="Clear dates">
              <X size={15} />
            </span>
          )
        }
        i18n={i18n}
        configs={configs}
      />
    </div>
  );
};

export default DateRangePicker;
