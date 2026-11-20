import { Language, Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { RendererVideo, DialogType } from 'main/types';
import { stopPropagation } from 'renderer/rendererutils';
import { Button } from '../Button/Button';
import { Tooltip } from '../Tooltip/Tooltip';
import { Dispatch, SetStateAction } from 'react';
import { FolderMessageSquareMore } from 'renderer/icons/FolderMessageSquareMore';
import { FolderMessageSquare } from 'renderer/icons/FolderMessageSquare';
import { ROW_ICON_SIZE, rowButtonClass } from './rowButton';

type MultiTagButtonProps = {
  language: Language;
  parent: RendererVideo;
  setDialog: Dispatch<SetStateAction<DialogType>>;
  setTagDialogVideoTargetId: Dispatch<SetStateAction<string | null>>;
};

const MultiTagButton = (props: MultiTagButtonProps) => {
  const { parent, language, setTagDialogVideoTargetId, setDialog } = props;
  const group = [parent, ...parent.multiPov];

  const tagged = group.filter((rv) => rv.tag).length;
  const total = group.length;

  const tooltip =
    getLocalePhrase(language, Phrase.OpenTagDialog) + ` (${tagged}/${total})`;

  const icon =
    tagged > 0 ? (
      <FolderMessageSquareMore size={ROW_ICON_SIZE} />
    ) : (
      <FolderMessageSquare size={ROW_ICON_SIZE} />
    );

  return (
    <Tooltip content={tooltip}>
      <div>
        <Button
          variant="ghost"
          size="xs"
          className={rowButtonClass()}
          onClick={(event) => {
            stopPropagation(event);
            setTagDialogVideoTargetId(parent.uniqueId);
            setDialog(DialogType.TAG);
          }}
        >
          {icon}
        </Button>
      </div>
    </Tooltip>
  );
};

export default MultiTagButton;
