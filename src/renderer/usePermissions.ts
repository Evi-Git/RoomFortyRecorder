import React from 'react';

/**
 * [RoomFortyRecorder] What the signed-in person can do, from the guild
 * server (guild-cloud-server/permissions.mjs). Shared by every component;
 * refreshed every minute and after "view as" changes.
 */

export type Permissions = {
  owner: boolean;
  viewAs: string | null;
  roles: string[];
  can: Record<string, boolean>;
};

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const ipc = window.electron.ipcRenderer;

let current: Permissions | null = null;
const listeners = new Set<(p: Permissions | null) => void>();
let inFlight: Promise<void> | null = null;
// Bumped by every answer that is published, so a refresh that was asked
// before it (a slow "who am I" after "view as") doesn't overwrite it.
let published = 0;

const publish = (next: Permissions | null) => {
  published += 1;
  current = next;
  listeners.forEach((listener) => listener(next));
};

export const refreshPermissions = () => {
  const askedAt = published;
  inFlight ??= (
    ipc.invoke('pullDesk', [{ action: 'permissionsMe' }]) as Promise<
      Response<Permissions>
    >
  )
    .then((response) => {
      if (published !== askedAt) return;
      // An older server (no permissions yet): leave everything visible.
      publish(response.ok ? response.data : null);
    })
    .catch(() => {
      if (published === askedAt) publish(null);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
};

/** Switch "view as role" (owner only); null goes back to yourself. */
export const setViewAs = async (role: string | null) => {
  const response = (await ipc.invoke('pullDesk', [
    { action: 'setViewAs', role },
  ])) as Response<Permissions>;
  if (response.ok) publish(response.data);
  return response;
};

/**
 * True unless the server says no. Before it answers (or on an older
 * server) everything stays visible, as before.
 */
export const allows = (p: Permissions | null, key: string) =>
  !p || p.can[key] !== false;

export const usePermissions = () => {
  const [value, setValue] = React.useState<Permissions | null>(current);
  React.useEffect(() => {
    listeners.add(setValue);
    if (!current) refreshPermissions();
    const timer = setInterval(refreshPermissions, 60000);
    return () => {
      listeners.delete(setValue);
      clearInterval(timer);
    };
  }, []);
  return value;
};
