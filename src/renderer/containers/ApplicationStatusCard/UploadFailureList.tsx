import { Button } from 'renderer/components/Button/Button';
import Separator from 'renderer/components/Separator/Separator';
import { timeOfDay } from 'renderer/clock';
import type { UploadFailure } from 'main/uploadFailures';

/**
 * [RoomFortyRecorder] Video uploads that gave up, in the Cloud status card:
 * what failed, why in plain English, and Try again / Dismiss.
 */
type Props = {
  failures: UploadFailure[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
};

const UploadFailureList = ({
  failures,
  onRetry,
  onDismiss,
  onDismissAll,
}: Props) => {
  if (failures.length < 1) return null;

  return (
    <div className="flex flex-col gap-y-2" data-state="failed">
      <Separator className="my-1" />
      <div className="flex items-center justify-between gap-x-2">
        <h3 className="text-xs font-semibold text-error-text">
          {failures.length === 1
            ? '1 upload failed'
            : `${failures.length} uploads failed`}
        </h3>
        {failures.length > 1 && (
          <button
            type="button"
            className="text-xs text-foreground underline hover:text-foreground-lighter focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand rounded-sm"
            onClick={onDismissAll}
          >
            Dismiss all
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-y-3 m-0 p-0 list-none max-h-[240px] overflow-y-auto">
        {failures.map((f) => (
          <li key={f.id} className="flex flex-col gap-y-1">
            <span className="text-xs text-foreground-lighter truncate">
              {f.name}{' '}
              <span className="text-foreground">{timeOfDay(f.at)}</span>
            </span>
            <span className="text-xs text-error-text">{f.message}</span>
            <div className="flex gap-x-2">
              <Button
                size="sm"
                className="w-fit h-7 px-3"
                onClick={() => onRetry(f.id)}
              >
                Try again
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-fit h-7 px-3"
                onClick={() => onDismiss(f.id)}
              >
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default UploadFailureList;
