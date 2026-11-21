import { dateTime } from 'renderer/clock';
import React from 'react';
import { Check, Eye, RotateCcw, X } from 'lucide-react';
import { Button } from './components/Button/Button';
import { PageHeader } from './components/PageHeader/PageHeader';
import { SimpleSelect } from './components/Select/SimpleSelect';
import { Tooltip } from './components/Tooltip/Tooltip';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/Dialog/Dialog';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from './components/States/States';
import {
  refreshPermissions,
  setViewAs,
  usePermissions,
} from './usePermissions';

/**
 * [RoomFortyRecorder] Admin page, for the owner only (GUILD_CLOUD_OWNER_IDS
 * on the guild server): who can see and do what per Discord role, and
 * "view as" a role.
 */

const ipc = window.electron.ipcRenderer;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

const EVERYONE = '@everyone';

type Capability = {
  key: string;
  group: string;
  label: string;
  help: string;
  defaults: string[];
  grants: string[];
};

type GuildRole = { id: string; name: string; position: number; color: number };

type Table = {
  capabilities: Capability[];
  columns: string[];
  roles: GuildRole[];
  roleError: string;
  customized: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
};

const roleColor = (color: number) =>
  color ? `#${color.toString(16).padStart(6, '0')}` : 'hsl(30 8% 55%)';

// The Logs tables' look: a rounded box, a header row that stays in view.
const TABLE_BOX =
  'overflow-auto max-h-[60vh] rounded-lg border border-panel-line bg-panel-deep';
const TH =
  'sticky top-0 z-10 h-9 bg-panel-deep px-3 text-[13px] font-normal text-foreground whitespace-nowrap';
const ROW = 'border-t border-panel-line hover:bg-panel-raised';

const Card = ({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex min-h-9 items-center gap-x-2 flex-wrap">
      <h2 className="font-display text-lg font-bold text-foreground-lighter">
        {title}
      </h2>
      {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
    </div>
    <div className="flex flex-col gap-y-3 rounded-lg border border-panel-line bg-panel p-[18px]">
      {children}
    </div>
  </section>
);

type Member = {
  discordId: string;
  userName: string;
  /** Epoch seconds. */
  lastLogin: number;
  signedOut: boolean;
  owner?: boolean;
};

/**
 * Who has signed in, and a way to end someone's 30-day sign-in. An older
 * guild server answers "Not found" for the route: the section stays hidden.
 */
const MembersCard = () => {
  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [error, setError] = React.useState('');
  const [oldServer, setOldServer] = React.useState(false);
  const [target, setTarget] = React.useState<Member | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    call<{ members: Member[] }>({ action: 'permissionMembers' }).then(
      (response) => {
        if (cancelled) return;
        if (response.ok) {
          setError('');
          setMembers(response.data.members);
        } else if (/^not found\.?$/i.test(response.error.trim())) {
          setOldServer(true);
        } else {
          setError(response.error);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const signOut = async () => {
    if (!target) return;
    setBusy(true);
    const response = await call({
      action: 'signOutMember',
      discordId: target.discordId,
    });
    setBusy(false);
    setTarget(null);
    if (!response.ok) {
      setActionError(response.error);
      return;
    }
    setActionError('');
    setTick((t) => t + 1);
  };

  if (oldServer) return null;

  return (
    <Card title="Members">
      <p className="text-sm text-foreground m-0">
        Everyone who has signed in to the Toolkit with Discord. Signing someone
        out ends their sign-in on every PC.
      </p>
      {actionError && (
        <ErrorState error={actionError} what="Couldn't sign them out" />
      )}
      {error && (
        <ErrorState
          error={error}
          what="Couldn't load the members"
          onRetry={() => setTick((t) => t + 1)}
        />
      )}
      {!members && !error && <LoadingState label="Loading members…" />}
      {members && members.length === 0 && (
        <EmptyState>Nobody has signed in yet.</EmptyState>
      )}
      {members && members.length > 0 && (
        <div className={TABLE_BOX}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Member</th>
                <th className={`${TH} text-left`}>Last sign-in</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.discordId} className={ROW}>
                  <td className="px-3 py-1.5 text-foreground-lighter">
                    {m.userName}
                    {m.owner && (
                      <span className="ml-2 rounded-full border border-brand/50 px-2 py-0.5 text-[11px] text-brand">
                        Owner
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-foreground whitespace-nowrap">
                    {m.signedOut
                      ? 'Signed out'
                      : m.lastLogin
                        ? dateTime(m.lastLogin * 1000)
                        : 'Unknown'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {m.owner || m.signedOut ? (
                      <Tooltip
                        content={
                          m.owner
                            ? "The owner can't be signed out here"
                            : 'Already signed out'
                        }
                        side="left"
                      >
                        <span className="inline-block">
                          <Button size="xs" variant="outline" disabled>
                            Sign out
                          </Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setTarget(m)}
                      >
                        Sign out
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && !busy && setTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Sign out ${target?.userName ?? ''}?`}</DialogTitle>
            <DialogDescription>
              They&apos;re signed out of the Toolkit on every PC right away.
              They can sign in again if they still have a Room Forty role, so to
              keep someone out, remove their Discord role first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={signOut} disabled={busy}>
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

const AdminPage = () => {
  const permissions = usePermissions();
  const [table, setTable] = React.useState<Table | null>(null);
  const [grants, setGrants] = React.useState<Record<string, string[]>>({});
  const [columns, setColumns] = React.useState<string[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState('');
  // What the failed step was, shown before the friendly reason.
  const [errorWhat, setErrorWhat] = React.useState("Couldn't load the page");
  // What "Try again" runs: the step that failed, not always a reload (a
  // reload would drop unsaved permission edits).
  const [retry, setRetry] = React.useState<(() => void) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [viewRole, setViewRole] = React.useState('');
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    call<Table>({ action: 'permissions' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setErrorWhat("Couldn't load the permissions");
        setRetry(() => () => setTick((t) => t + 1));
        setError(response.error);
        return;
      }
      setError('');
      setTable(response.data);
      setGrants(
        Object.fromEntries(
          response.data.capabilities.map((c) => [c.key, c.grants]),
        ),
      );
      setColumns(response.data.columns);
      setDirty(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const roleByName = React.useMemo(
    () => new Map((table?.roles ?? []).map((r) => [r.name.toLowerCase(), r])),
    [table],
  );

  const label = (role: string) =>
    role === EVERYONE ? 'Everyone' : (roleByName.get(role)?.name ?? role);

  const toggle = (cap: string, role: string) => {
    setGrants((prev) => {
      const list = prev[cap] ?? [];
      const next = list.includes(role)
        ? list.filter((r) => r !== role)
        : [...list, role];
      return { ...prev, [cap]: next };
    });
    setDirty(true);
    setNotice('');
  };

  const addColumn = (role: string) => {
    if (!role || columns.includes(role)) return;
    // Keep Discord's order (highest role first), Everyone last.
    const order = (r: string) =>
      r === EVERYONE ? -1 : (roleByName.get(r)?.position ?? 0);
    setColumns([...columns, role].sort((a, b) => order(b) - order(a)));
    setDirty(true);
  };

  const removeColumn = (role: string) => {
    setColumns(columns.filter((r) => r !== role));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    const response = await call({ action: 'setPermissions', grants, columns });
    setBusy(false);
    if (!response.ok) {
      setErrorWhat("Couldn't save the permissions");
      setRetry(() => save);
      setError(response.error);
      return;
    }
    setNotice(
      'Saved. It applies right away (apps pick it up within a minute).',
    );
    setTick((t) => t + 1);
    refreshPermissions();
  };

  const reset = async () => {
    setBusy(true);
    const response = await call({ action: 'resetPermissions' });
    setBusy(false);
    if (!response.ok) {
      setErrorWhat("Couldn't reset the permissions");
      setRetry(() => reset);
      setError(response.error);
      return;
    }
    setNotice('Back to the defaults from the server .env.');
    setTick((t) => t + 1);
    refreshPermissions();
  };

  const startViewAs = async (role: string | null) => {
    const response = await setViewAs(role);
    if (!response.ok) {
      setErrorWhat("Couldn't switch the view");
      setRetry(() => () => startViewAs(role));
      setError(response.error);
    }
  };

  // Re-reads the Discord roles only: grants, columns and unsaved edits stay.
  const refreshRoles = async () => {
    const response = await call<Table>({ action: 'permissions' });
    if (!response.ok) return;
    setTable((prev) =>
      prev
        ? {
            ...prev,
            roles: response.data.roles,
            roleError: response.data.roleError,
          }
        : prev,
    );
  };

  if (permissions && !permissions.owner) {
    return (
      <div className="w-full h-full bg-background-higher pt-[48px] px-6 text-sm text-foreground">
        Only the owner can open the Admin page.
      </div>
    );
  }

  const unusedRoles = (table?.roles ?? []).filter(
    (r) => !columns.includes(r.name.toLowerCase()),
  );
  const groups = [...new Set((table?.capabilities ?? []).map((c) => c.group))];
  const viewChoices = [
    ...columns.filter((c) => c !== EVERYONE),
    ...(table?.roles ?? [])
      .map((r) => r.name.toLowerCase())
      .filter((r) => !columns.includes(r)),
    EVERYONE,
  ];

  return (
    <div className="flex flex-col w-full h-full bg-background-higher text-foreground-lighter pt-[32px]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-y-[22px] px-7 py-6 pb-10">
          <PageHeader
            title="Admin"
            subtitle="Only you see this page. You always have every permission."
          />

          {error && (
            <ErrorState
              error={error}
              what={errorWhat}
              onRetry={() => {
                const again = retry;
                setError('');
                again?.();
              }}
            />
          )}
          {notice && (
            <p role="status" className="m-0 text-sm text-success">
              {notice}
            </p>
          )}

          <Card title="View as role">
            <p className="text-sm text-foreground m-0">
              See the app the way a role does: menus, buttons and what the
              server lets you do. Only you, only until you switch back or
              restart the app.
            </p>
            {permissions?.viewAs ? (
              <div className="flex items-center gap-x-3">
                <span className="text-sm">
                  Viewing as{' '}
                  <span className="font-semibold text-brand">
                    {label(permissions.viewAs)}
                  </span>
                </span>
                <Button size="sm" onClick={() => startViewAs(null)}>
                  Back to yourself
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-x-2">
                <SimpleSelect
                  className="w-56"
                  aria-label="Role to view as"
                  value={viewRole}
                  placeholder="Pick a role…"
                  onChange={setViewRole}
                  options={viewChoices.map((role) => ({
                    value: role,
                    label:
                      role === EVERYONE ? 'Everyone (no roles)' : label(role),
                  }))}
                />
                <Button
                  size="sm"
                  disabled={!viewRole}
                  onClick={() => startViewAs(viewRole)}
                >
                  <Eye size={14} className="mr-1" /> View as
                </Button>
              </div>
            )}
          </Card>

          {(table || !error) && (
            <Card
              title="Permissions by Discord role"
              aside={
                <>
                  {unusedRoles.length > 0 && (
                    <SimpleSelect
                      className="h-8 w-48 text-xs"
                      aria-label="Add a role column"
                      value=""
                      placeholder="Add a role column…"
                      onChange={addColumn}
                      options={unusedRoles.map((r) => ({
                        value: r.name.toLowerCase(),
                        label: r.name,
                      }))}
                    />
                  )}
                  {!columns.includes(EVERYONE) && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => addColumn(EVERYONE)}
                    >
                      + Everyone
                    </Button>
                  )}
                </>
              }
            >
              {!table && !error && (
                <LoadingState label="Loading permissions…" />
              )}
              {table?.roleError && (
                <ErrorState
                  error={table.roleError}
                  what="Couldn't load the Discord roles (names show as saved)"
                  message="The guild server couldn't reach Discord. Try again in a minute."
                  onRetry={() => {
                    refreshRoles();
                  }}
                  compact
                />
              )}
              {table && (
                <div className={TABLE_BOX}>
                  <table className="text-sm border-collapse w-full">
                    <thead>
                      <tr>
                        <th className={`${TH} text-left min-w-[260px]`}>
                          Permission
                        </th>
                        <th className={`${TH} text-center`}>You</th>
                        {columns.map((role) => (
                          <th key={role} className={`${TH} text-center`}>
                            <span className="inline-flex items-center gap-x-1.5">
                              {role !== EVERYONE && (
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{
                                    background: roleColor(
                                      roleByName.get(role)?.color ?? 0,
                                    ),
                                  }}
                                />
                              )}
                              <span className="text-foreground-lighter">
                                {label(role)}
                              </span>
                              <button
                                type="button"
                                aria-label={`Hide ${label(role)}`}
                                title="Hide this column (its permissions stay)"
                                onClick={() => removeColumn(role)}
                                className="rounded-sm text-foreground hover:text-foreground-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => (
                        <React.Fragment key={group}>
                          <tr className="border-t border-panel-line bg-panel">
                            <td
                              colSpan={columns.length + 2}
                              className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-brand"
                            >
                              {group}
                            </td>
                          </tr>
                          {table.capabilities
                            .filter((c) => c.group === group)
                            .map((cap) => {
                              const list = grants[cap.key] ?? [];
                              const everyone = list.includes(EVERYONE);
                              return (
                                <tr key={cap.key} className={ROW}>
                                  <td className="px-3 py-1.5">
                                    <div className="text-foreground-lighter">
                                      {cap.label}
                                    </div>
                                    <div className="text-[11px] text-foreground">
                                      {cap.help}
                                    </div>
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    <Tooltip
                                      content="You always have every permission"
                                      side="top"
                                    >
                                      <span className="inline-flex">
                                        <Check
                                          size={14}
                                          aria-label="You always have this"
                                          className="text-foreground"
                                        />
                                      </span>
                                    </Tooltip>
                                  </td>
                                  {columns.map((role) => {
                                    const direct = list.includes(role);
                                    const implied = !direct && everyone;
                                    const box = (
                                      <input
                                        type="checkbox"
                                        aria-label={`${cap.label}: ${label(role)}`}
                                        checked={direct || implied}
                                        disabled={implied}
                                        onChange={() => toggle(cap.key, role)}
                                        className="w-4 h-4 accent-[hsl(var(--brand))] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                      />
                                    );
                                    return (
                                      <td
                                        key={role}
                                        className="px-3 py-1.5 text-center"
                                      >
                                        {implied ? (
                                          <Tooltip
                                            content="Locked: Everyone has this already, so every role does. Untick it under Everyone to change it."
                                            side="top"
                                            maxWidth={240}
                                          >
                                            <span className="inline-flex">
                                              {box}
                                            </span>
                                          </Tooltip>
                                        ) : (
                                          box
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center gap-x-2 flex-wrap">
                <Button size="sm" disabled={!dirty || busy} onClick={save}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!dirty || busy}
                  onClick={() => setTick((t) => t + 1)}
                >
                  Discard changes
                </Button>
                {table?.customized && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={reset}
                  >
                    <RotateCcw size={14} className="mr-1" /> Reset to .env
                    defaults
                  </Button>
                )}
                <span className="text-xs text-foreground ml-auto">
                  {table?.updatedAt
                    ? `Last saved ${dateTime(table.updatedAt)} by ${table.updatedBy}`
                    : 'Using the defaults from the server .env'}
                </span>
              </div>
              <p className="text-xs text-foreground m-0">
                Someone with several roles gets everything any of them allows.
                Who can sign in at all is still set by
                GUILD_CLOUD_DISCORD_ALLOWED_ROLES on the server.
              </p>
            </Card>
          )}

          <MembersCard />
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
