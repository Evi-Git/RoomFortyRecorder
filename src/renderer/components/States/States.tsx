import React from 'react';
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react';
import { friendlyError } from '../../friendlyError';
import { cn } from '../utils';

/**
 * [RoomFortyRecorder] One look for "it's loading", "there's nothing here"
 * and "it went wrong" across pages. Each sets `data-state` so tests and
 * agents can wait on it.
 */

/** A grey placeholder in the shape of what's coming (keeps the layout still). */
export const Skeleton = ({ className }: { className?: string }) => (
  <div
    data-state="loading"
    className={cn('rounded-md bg-card/40 animate-pulse', className)}
  />
);

export const LoadingState = ({ label }: { label: string }) => (
  <div className="flex flex-col gap-y-2" data-state="loading">
    <p className="text-sm text-foreground m-0">{label}</p>
    <Skeleton className="h-8 w-[420px] max-w-full" />
    <Skeleton className="h-40 w-full bg-card/30" />
  </div>
);

export const EmptyState = ({
  children,
  action,
}: React.PropsWithChildren<{ action?: React.ReactNode }>) => (
  <div
    className="flex items-center gap-x-3 text-sm text-foreground"
    data-state="empty"
  >
    <span>{children}</span>
    {action}
  </div>
);

/**
 * A friendly line for the error, Try again when there's something to retry,
 * and Copy details with the raw text for a bug report.
 */
export const ErrorState = ({
  error,
  what,
  onRetry,
  compact = false,
}: {
  /** The raw error text (from the server, the network...). */
  error: string;
  /** What failed, e.g. "Couldn't load this night". */
  what?: string;
  onRetry?: () => void;
  compact?: boolean;
}) => {
  const [copied, setCopied] = React.useState(false);
  const friendly = friendlyError(error);
  const copy = () => {
    navigator.clipboard
      ?.writeText(error)
      .then(() => setCopied(true))
      .catch(() => {});
  };
  return (
    <div
      role="alert"
      data-state="failed"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm',
        !compact &&
          'rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2',
      )}
    >
      <AlertTriangle size={15} className="text-red-400 shrink-0" />
      <span className="text-foreground-lighter">
        {what ? `${what}: ` : ''}
        <span className="text-foreground">{friendly}</span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-x-1 text-xs text-brand hover:underline"
        >
          <RotateCcw size={12} /> Try again
        </button>
      )}
      {friendly !== error && (
        <button
          type="button"
          onClick={copy}
          title={error}
          className="flex items-center gap-x-1 text-xs text-foreground hover:text-foreground-lighter"
        >
          <Copy size={12} /> {copied ? 'Copied' : 'Copy details'}
        </button>
      )}
    </div>
  );
};
