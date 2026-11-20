import { Language, Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { ArrowDownUp } from 'lucide-react';
import { Tooltip } from '../Tooltip/Tooltip';

const NavigateShortcut = ({ language }: { language: Language }) => {
  return (
    <div className="flex gap-1 items-center text-foreground text-sm cursor-default">
      <Tooltip content={getLocalePhrase(language, Phrase.Navigate)}>
        <div className="inline-flex whitespace-nowrap items-center rounded-md border border-panel-line bg-panel-raised px-1.5 py-0.5 text-[13px] text-foreground gap-1">
          {getLocalePhrase(language, Phrase.Arrows)}
          <ArrowDownUp size={16} />
        </div>
      </Tooltip>
    </div>
  );
};

export default NavigateShortcut;
