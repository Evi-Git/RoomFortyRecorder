import { useState } from 'react';
import { Bug } from 'lucide-react';
import { AppState, Pages } from 'main/types';
import { Button } from './components/Button/Button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './components/Popover/Popover';
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
export default function BugButton({ appState }: { appState: AppState }) {
  const [open, setOpen] = useState(false);
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
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStatus(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id="bug-button"
          type="button"
          variant="ghost"
          size="icon"
          title="Report a bug"
        >
          <Bug size={20} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[320px] p-3">
        <div className="flex flex-col gap-y-2">
          <div className="text-sm font-semibold text-foreground-lighter">
            Report a bug
          </div>
          <Textarea
            autoFocus
            value={text}
            maxLength={MAX}
            placeholder="What went wrong, and what were you doing?"
            className="min-h-[96px] text-sm"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
          />
          <div className="flex items-center gap-x-2">
            <span
              className={`text-xs ${
                status ? (status.ok ? 'text-green-400' : 'text-red-400') : ''
              }`}
            >
              {status?.text ??
                `Goes to #toolkitbugs with your name${page ? ` and page (${page})` : ''}.`}
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={sending || text.trim().length < 3}
              onClick={send}
            >
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
