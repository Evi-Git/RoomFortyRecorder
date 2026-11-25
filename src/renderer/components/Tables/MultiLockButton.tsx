import { Language, Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { DialogType, RendererVideo } from 'main/types';
import { stopPropagation } from 'renderer/rendererutils';
import { Button } from '../Button/Button';
import { Tooltip } from '../Tooltip/Tooltip';
import { FolderLocked } from 'renderer/icons/FolderLocked';
import { FolderUnlocked } from 'renderer/icons/FolderUnlocked';
import { ROW_ICON_SIZE, rowButtonClass } from './rowButton';

type MultiLockButtonProps = {
  language: Language;
  parent: RendererVideo;
  setDialog: (dialog: DialogType) => void;
  setLockDialogVideoTargetId: (id: string | null) => void;
};

const MultiLockButton = (props: MultiLockButtonProps) => {
  const { language, parent, setDialog, setLockDialogVideoTargetId } = props;

  const group = [parent, ...parent.multiPov];

  const locked = group.filter((rv) => rv.isProtected).length;
  const total = group.length;

  const tooltip =
    getLocalePhrase(language, Phrase.OpenLockDialog) + ` (${locked}/${total})`;

  const anyLocked = [parent, ...parent.multiPov].some((rv) => rv.isProtected);
  const icon = anyLocked ? (
    <FolderLocked size={ROW_ICON_SIZE + 2} />
  ) : (
    <FolderUnlocked size={ROW_ICON_SIZE + 2} />
  );

  return (
    <Tooltip content={tooltip}>
      <div>
        <Button
          variant="ghost"
          size="xs"
          className={rowButtonClass(anyLocked)}
          aria-label={tooltip}
          onClick={(event) => {
            stopPropagation(event);
            setLockDialogVideoTargetId(parent.uniqueId);
            setDialog(DialogType.LOCK);
          }}
        >
          {icon}
        </Button>
      </div>
    </Tooltip>
  );
};

export default MultiLockButton;
