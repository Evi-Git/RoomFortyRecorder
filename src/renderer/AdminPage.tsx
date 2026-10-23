import React from 'react';
import { Check, Eye, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { Button } from './components/Button/Button';
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

const Card = ({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="rounded-md border border-card bg-background/40 p-4 flex flex-col gap-y-3">
    <div className="flex items-center gap-x-2 flex-wrap">
      <h2 className="font-display text-lg text-foreground-lighter">{title}</h2>
      {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
    </div>
    {children}
  </section>
);

const AdminPage = () => {
  const permissions = usePermissions();
  const [table, setTable] = React.useState<Table | null>(null);
  const [grants, setGrants] = React.useState<Record<string, string[]>>({});
  const [columns, setColumns] = React.useState<string[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [viewRole, setViewRole] = React.useState('');
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    call<Table>({ action: 'permissions' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
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
      setError(response.error);
      return;
    }
    setNotice('Back to the defaults from the server .env.');
    setTick((t) => t + 1);
    refreshPermissions();
  };

  const startViewAs = async (role: string | null) => {
    const response = await setViewAs(role);
    if (!response.ok) setError(response.error);
  };

  if (permissions && !permissions.owner) {
    return (
      <div className="w-full h-full pt-[48px] px-6 text-sm text-foreground">
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
      <div className="flex items-center gap-x-2 px-4 py-2 border-b border-card min-h-[52px]">
        <ShieldCheck size={18} className="text-brand" />
        <span className="font-display text-lg font-bold">Admin</span>
        <span className="text-xs text-foreground ml-2">
          Only you see this page. You always have every permission.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-y-4 max-w-[1200px]">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-green-400">{notice}</p>}

        <Card title="View as role">
          <p className="text-sm text-foreground m-0">
            See the app the way a role does: menus, buttons and what the server
            lets you do. Only you, only until you switch back or restart the
            app.
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
              <select
                className="h-9 rounded-md border border-card bg-background px-2 text-sm"
                value={viewRole}
                onChange={(e) => setViewRole(e.target.value)}
              >
                <option value="">Pick a role…</option>
                {viewChoices.map((role) => (
                  <option key={role} value={role}>
                    {role === EVERYONE ? 'Everyone (no roles)' : label(role)}
                  </option>
                ))}
              </select>
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

        <Card
          title="Permissions by Discord role"
          aside={
            <>
              {unusedRoles.length > 0 && (
                <select
                  className="h-8 rounded-md border border-card bg-background px-2 text-xs"
                  value=""
                  onChange={(e) => addColumn(e.target.value)}
                >
                  <option value="">Add a role column…</option>
                  {unusedRoles.map((r) => (
                    <option key={r.id} value={r.name.toLowerCase()}>
                      {r.name}
                    </option>
                  ))}
                </select>
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
            <p className="text-sm text-foreground">Loading…</p>
          )}
          {table?.roleError && (
            <p className="text-xs text-yellow-400">
              Couldn&apos;t load the Discord roles ({table.roleError}); role
              names show as saved.
            </p>
          )}
          {table && (
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse">
                <thead>
                  <tr className="text-xs text-foreground border-b border-card">
                    <th className="px-2 py-2 text-left font-normal min-w-[260px]">
                      Permission
                    </th>
                    <th className="px-2 py-2 font-normal text-center whitespace-nowrap">
                      You
                    </th>
                    {columns.map((role) => (
                      <th
                        key={role}
                        className="px-2 py-2 font-normal text-center whitespace-nowrap"
                      >
                        <span className="inline-flex items-center gap-x-1">
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
                            className="opacity-50 hover:opacity-100"
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
                      <tr>
                        <td
                          colSpan={columns.length + 2}
                          className="px-2 pt-3 pb-1 text-xs uppercase tracking-wide text-brand"
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
                            <tr
                              key={cap.key}
                              className="border-b border-card/40 hover:bg-card/20"
                            >
                              <td className="px-2 py-1.5">
                                <div className="text-foreground-lighter">
                                  {cap.label}
                                </div>
                                <div className="text-[11px] text-foreground">
                                  {cap.help}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <Check
                                  size={14}
                                  className="inline text-foreground/50"
                                />
                              </td>
                              {columns.map((role) => {
                                const direct = list.includes(role);
                                const implied = !direct && everyone;
                                return (
                                  <td
                                    key={role}
                                    className="px-2 py-1.5 text-center"
                                  >
                                    <input
                                      type="checkbox"
                                      aria-label={`${cap.label}: ${label(role)}`}
                                      title={
                                        implied
                                          ? 'Everyone has this already'
                                          : undefined
                                      }
                                      checked={direct || implied}
                                      disabled={implied}
                                      onChange={() => toggle(cap.key, role)}
                                      className="w-4 h-4 accent-[hsl(var(--brand))] cursor-pointer disabled:opacity-40"
                                    />
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
              <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
                <RotateCcw size={14} className="mr-1" /> Reset to .env defaults
              </Button>
            )}
            <span className="text-xs text-foreground ml-auto">
              {table?.updatedAt
                ? `Last saved ${new Date(table.updatedAt).toLocaleString()} by ${table.updatedBy}`
                : 'Using the defaults from the server .env'}
            </span>
          </div>
          <p className="text-xs text-foreground m-0">
            Someone with several roles gets everything any of them allows. Who
            can sign in at all is still set by GUILD_CLOUD_DISCORD_ALLOWED_ROLES
            on the server.
          </p>
        </Card>
      </div>
    </div>
  );
};

export default AdminPage;
