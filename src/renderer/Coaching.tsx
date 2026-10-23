import React from 'react';
import { Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/Dialog/Dialog';
import { Button } from './components/Button/Button';
import { Textarea } from './components/TextArea/textarea';
import { RendererVideo } from 'main/types';

// Must match src/main/CoachClip.ts.
const CLIP_LEAD_SECONDS = 5;
const CLIP_LENGTH_SECONDS = 30;

const STAGE_TEXT: Record<string, string> = {
  cutting: 'Cutting the clip…',
  uploading: 'Uploading the clip…',
  sending: 'Posting to Discord…',
};

/**
 * [RoomFortyRecorder] Coaching: send a recording or clip to a Discord text
 * channel, and the officers' member -> personal channel list. The server
 * side is guild-cloud-server/coach.mjs.
 */

const ipc = window.electron.ipcRenderer;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export const coachCall = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

export type CoachChannel = { id: string; name: string; category: string };

export type CoachConfig = {
  officer: boolean;
  canMapChannels?: boolean;
  me: { discordId: string; name: string };
  myChannel: string;
  channels: CoachChannel[];
  channelError: string;
  personal: { discordId: string; name: string; channelId: string }[];
  members: { discordId: string; name: string }[];
};

const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const selectClass =
  'w-full bg-card text-foreground-lighter rounded-md px-2 py-2 text-sm border border-background';

const loadLastChannel = () => {
  try {
    return localStorage.getItem('rf-coach-last-channel') || '';
  } catch {
    return '';
  }
};

interface SendClipProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The recording, and where to read it: local file if there is one,
  // otherwise the cloud copy.
  video: RendererVideo;
  source: string;
  title: string;
  currentTime: number;
}

/** Pick a channel, add a note, send. */
export const SendClipDialog = (props: SendClipProps) => {
  const { open, onOpenChange, video, source, title, currentTime } = props;
  const [config, setConfig] = React.useState<CoachConfig | null>(null);
  const [error, setError] = React.useState('');
  const [channelId, setChannelId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [stage, setStage] = React.useState('');

  // Progress from the main process while the clip is cut and uploaded.
  React.useEffect(
    () =>
      window.electron.ipcRenderer.on('coachClipStage', (value) =>
        setStage(String(value)),
      ),
    [],
  );

  const clipStart = Math.max(0, Math.floor(currentTime) - CLIP_LEAD_SECONDS);
  const [sent, setSent] = React.useState('');

  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    coachCall<CoachConfig>({ action: 'coachConfig' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setError(response.data.channelError || '');
      setConfig(response.data);
      const ids = response.data.channels.map((c) => c.id);
      const last = loadLastChannel();
      setChannelId((current) => {
        if (current && ids.includes(current)) return current;
        if (last && ids.includes(last)) return last;
        if (ids.includes(response.data.myChannel))
          return response.data.myChannel;
        return ids[0] || '';
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const changeOpen = (next: boolean) => {
    if (!next) {
      setSent('');
      setNote('');
    }
    onOpenChange(next);
  };

  const send = async () => {
    setSending(true);
    setStage('cutting');
    setError('');
    const response = await coachCall<{ url: string }>({
      action: 'sendClip',
      video,
      source,
      at: Math.floor(currentTime),
      channelId,
      note,
      title: `${title} at ${mmss(currentTime)}`,
    });
    setSending(false);
    setStage('');
    if (!response.ok) {
      setError(response.error);
      return;
    }
    try {
      localStorage.setItem('rf-coach-last-channel', channelId);
    } catch {
      // Storage unavailable: the channel just isn't remembered.
    }
    const channel = config?.channels.find((c) => c.id === channelId);
    setSent(channel ? `#${channel.name}` : 'the channel');
  };

  // Personal channels first, labelled with their raider, then the rest by
  // category.
  const personalByChannel = new Map(
    (config?.personal ?? []).map((p) => [p.channelId, p.name]),
  );
  const personal = (config?.channels ?? []).filter((c) =>
    personalByChannel.has(c.id),
  );
  const categories = new Map<string, CoachChannel[]>();
  (config?.channels ?? [])
    .filter((c) => !personalByChannel.has(c.id))
    .forEach((c) => {
      const key = c.category || 'Other channels';
      categories.set(key, [...(categories.get(key) ?? []), c]);
    });

  const renderBody = () => {
    if (sent) {
      return (
        <div className="flex flex-col gap-y-3">
          <p className="text-sm text-foreground-lighter">
            Sent to {sent}. Discord shows it as a playable video.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => changeOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      );
    }

    if (!config) {
      return (
        <p className="text-sm text-foreground">
          {error || 'Loading channels…'}
        </p>
      );
    }

    if (!config.channels.length) {
      return (
        <p className="text-sm text-foreground">
          {config.officer
            ? error ||
              'The bot cannot see any text channels. Check its permissions in Discord.'
            : 'You don’t have a personal channel yet. Ask an officer to add you under Analysis → Personal channels.'}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-y-3">
        <label className="flex flex-col gap-y-1 text-sm">
          Channel
          <select
            className={selectClass}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            disabled={!config.officer && config.channels.length === 1}
          >
            {personal.length > 0 && (
              <optgroup label="Personal channels">
                {personal.map((c) => (
                  <option key={c.id} value={c.id}>
                    {personalByChannel.get(c.id)} · #{c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {[...categories.entries()].map(([category, list]) => (
              <optgroup key={category} label={category}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-y-1 text-sm">
          Note
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What to look for, e.g. “Watch the orb soak at 2:31 — this is the spot.”"
            maxLength={500}
            rows={3}
          />
        </label>

        <p className="text-sm text-foreground">
          Sends a {CLIP_LENGTH_SECONDS} s clip from{' '}
          <span className="text-foreground-lighter">{mmss(clipStart)}</span> to{' '}
          <span className="text-foreground-lighter">
            {mmss(clipStart + CLIP_LENGTH_SECONDS)}
          </span>
          : {CLIP_LEAD_SECONDS} s before where you are, so there&apos;s a lead
          up. It plays right in Discord and is saved under Clips.
        </p>
        {sending && stage && (
          <p className="text-sm text-foreground-lighter">
            {STAGE_TEXT[stage] ?? stage}
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-between gap-x-2">
          <span className="text-xs text-foreground">
            {config.officer
              ? 'Officers can send to any channel.'
              : 'You can send to your own channel.'}
          </span>
          <Button
            size="sm"
            onClick={send}
            disabled={!channelId || sending}
            className="gap-x-1"
          >
            <Send size={14} />
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to Discord</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  );
};

type MappingRow = { discordId: string; name: string; channelId: string };

/** Officers: which raider owns which personal channel. */
export const PersonalChannelsDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [config, setConfig] = React.useState<CoachConfig | null>(null);
  const [rows, setRows] = React.useState<MappingRow[]>([]);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [adding, setAdding] = React.useState('');

  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    coachCall<CoachConfig>({ action: 'coachConfig' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setError(response.data.channelError || '');
      setConfig(response.data);
      setRows(
        [...response.data.personal].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    const response = await coachCall<{ count: number }>({
      action: 'setPersonalChannels',
      mapping: rows.filter((r) => r.channelId),
    });
    setSaving(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setError('');
    setMessage(`Saved ${response.data.count} personal channels.`);
  };

  const unmapped = (config?.members ?? []).filter(
    (m) => !rows.some((r) => r.discordId === m.discordId),
  );

  const renderBody = () => {
    if (!config) {
      return <p className="text-sm text-foreground">{error || 'Loading…'}</p>;
    }
    if (!(config.canMapChannels ?? config.officer)) {
      return (
        <p className="text-sm text-foreground">
          Your Discord role can&apos;t edit personal channels.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-y-3">
        <div className="max-h-[50vh] overflow-y-auto flex flex-col gap-y-1.5 pr-1">
          {rows.length === 0 && (
            <p className="text-sm text-foreground">
              Nobody yet. Add raiders below.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.discordId}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-x-2 items-center"
            >
              <span className="truncate text-sm text-foreground-lighter">
                {row.name}
              </span>
              <select
                className={selectClass}
                value={row.channelId}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r) =>
                      r.discordId === row.discordId
                        ? { ...r, channelId: e.target.value }
                        : r,
                    ),
                  )
                }
              >
                <option value="">Pick a channel</option>
                {config.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.category ? `${c.category} / ` : ''}#{c.name}
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setRows((current) =>
                    current.filter((r) => r.discordId !== row.discordId),
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-x-2">
          <select
            className={selectClass}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">Add a raider…</option>
            {unmapped.map((m) => (
              <option key={m.discordId} value={m.discordId}>
                {m.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!adding}
            onClick={() => {
              const member = unmapped.find((m) => m.discordId === adding);
              if (!member) return;
              setRows((current) => [...current, { ...member, channelId: '' }]);
              setAdding('');
            }}
          >
            Add
          </Button>
        </div>
        <p className="text-xs text-foreground">
          The list of raiders comes from Discord when the bot has the Server
          Members intent; otherwise it shows everyone who has signed in to the
          app.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-green-400">{message}</p>}

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personal channels</DialogTitle>
          <DialogDescription>
            Raiders can send clips only to their own channel. Officers can send
            to any channel.
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  );
};

export type Flag = {
  id: string;
  at: number;
  streamer: string;
  by: string;
  byId: string;
  note: string;
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

/**
 * Tonight's flags on Watch live: newest first, each with an editable note.
 * `flags` is owned by the page so the hotkey can add to it.
 */
export const FlagBar = ({
  flags,
  onChange,
}: {
  flags: Flag[];
  onChange: (flags: Flag[]) => void;
}) => {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  const saveNote = async (flag: Flag) => {
    setEditing(null);
    if (draft === flag.note) return;
    const response = await coachCall<Flag>({
      action: 'editFlag',
      id: flag.id,
      note: draft,
    });
    if (response.ok) {
      onChange(flags.map((f) => (f.id === flag.id ? response.data : f)));
    }
  };

  const remove = async (flag: Flag) => {
    const response = await coachCall({ action: 'deleteFlag', id: flag.id });
    if (response.ok) onChange(flags.filter((f) => f.id !== flag.id));
  };

  if (!flags.length) {
    return (
      <span className="text-xs text-foreground">
        Press B (or Flag) to mark a moment; it shows up in the Analysis report
        for that pull.
      </span>
    );
  }

  return (
    <div className="flex items-center gap-x-2 overflow-x-auto">
      {flags.map((flag) => (
        <div
          key={flag.id}
          className="flex items-center gap-x-1.5 shrink-0 rounded-md border border-card bg-background/60 px-2 py-1 text-xs"
        >
          <span className="tabular-nums text-foreground-lighter">
            {clock(flag.at)}
          </span>
          <span className="text-foreground">
            {flag.streamer || 'stream'} · {flag.by}
          </span>
          {editing === flag.id ? (
            <input
              autoFocus
              className="bg-card rounded px-1 py-0.5 w-48 text-foreground-lighter"
              value={draft}
              maxLength={500}
              placeholder="What happened?"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => saveNote(flag)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNote(flag);
                if (e.key === 'Escape') setEditing(null);
                e.stopPropagation();
              }}
            />
          ) : (
            <button
              type="button"
              className={flag.note ? 'text-foreground-lighter' : 'text-brand'}
              onClick={() => {
                setDraft(flag.note);
                setEditing(flag.id);
              }}
            >
              {flag.note || 'Add note'}
            </button>
          )}
          <button
            type="button"
            title="Remove flag"
            className="text-foreground/60 hover:text-red-400"
            onClick={() => remove(flag)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
