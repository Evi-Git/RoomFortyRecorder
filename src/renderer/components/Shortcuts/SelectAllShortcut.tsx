import { Language, Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { Tooltip } from '../Tooltip/Tooltip';

const SelectAllShortcut = ({ language }: { language: Language }) => {
  return (
    <div className="flex gap-1 items-center text-foreground text-sm cursor-default">
      <Tooltip content={getLocalePhrase(language, Phrase.SelectAll)}>
        <div className="inline-flex whitespace-nowrap items-center rounded-md border border-panel-line bg-panel-raised px-1.5 py-0.5 text-[13px] text-foreground">
          Ctrl + A
        </div>
      </Tooltip>
    </div>
  );
};

export default SelectAllShortcut;
