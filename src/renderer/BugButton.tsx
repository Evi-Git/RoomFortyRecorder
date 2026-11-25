import { Dispatch, SetStateAction, useRef, useState } from 'react';
import { Bug } from 'lucide-react';
import { AppState, Pages } from 'main/types';
import { Button } from './components/Button/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/Dialog/Dialog';
import { Textarea } from './components/TextArea/textarea';

const ipc = window.electron.ipcRenderer;

const PAGE_NAMES: Record<number, string> = {
  [Pages.SceneEditor]: 'Scene',
  [Pages.Settings]: 'Settings',
  [Pages.InstantReplay]: 'Instant replay',
  [Pages.Live]: 'Watch live',
  [Pages.PullDesk]: 'Dashboard',
  [Pages.Admin]: 'Admin',
  [Pages.Logs]: 'Logs',
  [Pages.TopLogs]: 'Top logs',
};

const MAX = 1500;

/**
 * [RoomFortyRecorder] Report a bug: a small text box that goes to the bug
 * channel in Discord through the guild server.
 */
export default function BugButton({
  appState,
  setPreviewEnabled,
}: {
  appState: AppState;
  /** Hides the recorder preview while the dialog is open, as Diagnostics does. */
  setPreviewEnabled?: Dispatch<SetStateAction<boolean>>;
}) {
  const [open, setOpen] = useState(false);
  // The preview setting from before the dialog opened (Scene may have it off).
  const previewBefore = useRef(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const page =
    appState.page === Pages.None
      ? String(appState.category)
      : (PAGE_NAMES[appState.page] ?? '');

  const send = async () => {
    if (sending || text.trim().length < 3) return;
    setSending(true);
    setStatus(null);
    try {
      const result = (await ipc.invoke('bugReport', [text.trim(), page])) as {
        ok: boolean;
        error?: string;
      };
      if (result.ok) {
        setText('');
        setStatus({ ok: true, text: 'Sent. Thanks!' });
      } else {
        setStatus({ ok: false, text: result.error || 'Could not send.' });
      }
    } catch (error) {
      setStatus({ ok: false, text: String(error) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPreviewEnabled?.((prev) => {
            previewBefore.current = prev;
            return false;
          });
        } else {
          setPreviewEnabled?.(previewBefore.current);
        }
        if (next) setStatus(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          id="bug-button"
          type="button"
          variant="ghost"
          size="icon"
          title="Report a bug"
          aria-label="Report a bug"
        >
          <Bug size={20} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            {`Goes to #toolkitbugs with your name${page ? ` and page (${page})` : ''}.`}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={text}
          maxLength={MAX}
          aria-label="What went wrong"
          placeholder="What went wrong, and what were you doing?"
          className="min-h-[120px] text-sm border-panel-line bg-walnut"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
        />
        <DialogFooter className="items-center gap-x-2 gap-y-2 sm:space-x-0">
          {status && (
            <span
              role="status"
              className={`mr-auto text-sm ${
                status.ok ? 'text-success' : 'text-error-text'
              }`}
            >
              {status.text}
            </span>
          )}
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button disabled={sending || text.trim().length < 3} onClick={send}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
