import React from 'react';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { Button } from './components/Button/Button';
import { Input } from './components/Input/Input';
import {
  Ability,
  AbilityScope,
  clearAbilityCards,
  tagLabel,
} from './AbilityCard';

/**
 * [RoomFortyRecorder] Pull desk Journal view: a boss's Encounter Journal
 * (Blizzard's, via the guild server) by stage, with what each ability did to
 * the raid and a button to put it on the boss's avoidable list. Abilities
 * from the logs that the journal doesn't list come last.
 */

const ipc = window.electron.ipcRenderer;

type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

type Section = {
  id: number;
  title: string;
  text: string;
  spellId: number | null;
  tags: string[];
  depth: number;
  children: Section[];
};

type Journal = {
  journalId: number;
  name: string;
  description: string;
  instance: string | null;
  modes: string[];
  sections: Section[];
};

type Stat = {
  name: string;
  spellId: number | null;
  wipes: number;
  deaths: number;
  earlyDeaths: number;
};

type BossJournal = {
  configured: boolean;
  encounterId: number;
  encounterName: string | null;
  journalId: number | null;
  journal: Journal | null;
  error: string;
  stats: Stat[];
  avoidable: { id: number; name: string | null }[];
};

type NightIndex = {
  night: string;
  bosses: {
    encounterId: number;
    encounterName: string;
    difficultyId: number;
  }[];
};

const DIFFICULTY: Record<number, string> = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  233: 'Mythic',
};
const isMythic = (d: number) => d === 16 || d === 233;
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

const flatten = (sections: Section[]): Section[] =>
  sections.flatMap((s) => [s, ...flatten(s.children)]);

const loadChoice = () => {
  try {
    return localStorage.getItem('rf-pulldesk-journal-boss') || '';
  } catch {
    return '';
  }
};

const JournalView = ({ canEdit }: { canEdit: boolean }) => {
  const [bosses, setBosses] = React.useState<
    { encounterId: number; name: string; difficulties: number[] }[] | null
  >(null);
  const [choice, setChoice] = React.useState(loadChoice);
  const [difficulty, setDifficulty] = React.useState<number | null>(null);
  const [data, setData] = React.useState<BossJournal | null>(null);
  const [icons, setIcons] = React.useState<Record<string, string>>({});
  const [avoidable, setAvoidable] = React.useState<number[]>([]);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [error, setError] = React.useState('');
  const [journalInput, setJournalInput] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const [activeStage, setActiveStage] = React.useState('');

  const jumpTo = (id: string) => {
    setActiveStage(id);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Bosses the guild has pulled, newest first, with their difficulties.
  React.useEffect(() => {
    let cancelled = false;
    call<{ nights: NightIndex[] }>({ action: 'nights' }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const map = new Map<
        number,
        { encounterId: number; name: string; difficulties: number[] }
      >();
      response.data.nights.forEach((n) =>
        n.bosses.forEach((b) => {
          const entry = map.get(b.encounterId) ?? {
            encounterId: b.encounterId,
            name: b.encounterName,
            difficulties: [],
          };
          if (!entry.difficulties.includes(b.difficultyId)) {
            entry.difficulties.push(b.difficultyId);
          }
          map.set(b.encounterId, entry);
        }),
      );
      const list = [...map.values()];
      setBosses(list);
      setChoice((current) =>
        list.some((b) => String(b.encounterId) === current)
          ? current
          : String(list[0]?.encounterId ?? ''),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const boss = bosses?.find((b) => String(b.encounterId) === choice);
  // Mythic first when the guild has pulled it.
  const difficulties = [...(boss?.difficulties ?? [])].sort(
    (a, b) => Number(isMythic(b)) - Number(isMythic(a)) || b - a,
  );
  const shownDifficulty =
    difficulty && difficulties.includes(difficulty)
      ? difficulty
      : (difficulties[0] ?? null);

  React.useEffect(() => {
    if (!choice) return undefined;
    try {
      localStorage.setItem('rf-pulldesk-journal-boss', choice);
    } catch {
      // Not remembered; fine.
    }
    let cancelled = false;
    call<BossJournal>({
      action: 'journalBoss',
      encounterId: Number(choice),
      difficultyId: shownDifficulty ?? undefined,
    }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setError('');
      setData(response.data);
      setAvoidable(response.data.avoidable.map((a) => a.id));
      const ids = [
        ...flatten(response.data.journal?.sections ?? []).map((s) => s.spellId),
        ...response.data.stats.map((s) => s.spellId),
      ].filter((id): id is number => Boolean(id));
      if (ids.length && response.data.configured) {
        call<{ icons: Record<string, string> }>({
          action: 'journalIcons',
          ids,
        }).then((r) => {
          if (!cancelled && r.ok) setIcons(r.data.icons);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [choice, shownDifficulty, tick]);

  const toggle = async (spellId: number, name: string) => {
    if (!data) return;
    setBusy(spellId);
    const on = !avoidable.includes(spellId);
    const response = await call({
      action: 'avoidableToggle',
      encounterId: data.encounterId,
      spellId,
      name,
      on,
    });
    setBusy(null);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    clearAbilityCards();
    setAvoidable((current) =>
      on ? [...current, spellId] : current.filter((id) => id !== spellId),
    );
  };

  const saveJournalId = async () => {
    if (!data) return;
    const response = await call({
      action: 'setJournalId',
      encounterId: data.encounterId,
      journalId: journalInput,
    });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setJournalInput('');
    setTick((t) => t + 1);
  };

  const statFor = (spellId: number | null, name: string) =>
    data?.stats.find((s) => spellId && s.spellId === spellId) ??
    data?.stats.find((s) => norm(s.name) === norm(name));

  const icon = (spellId: number | null, size: string) =>
    spellId && icons[spellId] ? (
      <img
        src={icons[spellId]}
        alt=""
        className={`${size} rounded border border-card shrink-0`}
      />
    ) : (
      <span
        className={`${size} rounded border border-card bg-card/50 shrink-0`}
      />
    );

  const avoidButton = (spellId: number, name: string) => {
    const on = avoidable.includes(spellId);
    if (!canEdit) {
      return on ? (
        <span className="text-xs text-brand">On the avoidable list</span>
      ) : null;
    }
    return (
      <button
        type="button"
        disabled={busy === spellId}
        onClick={() => toggle(spellId, name)}
        className={`h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-x-1 ${
          on ? 'border border-brand text-brand' : 'bg-brand text-background'
        }`}
        title={
          on
            ? 'Remove from this boss’s avoidable list'
            : 'Add to this boss’s avoidable list'
        }
      >
        {on ? <Check size={12} /> : <Plus size={12} />}
        {on ? 'Avoidable' : 'Add to avoidable'}
      </button>
    );
  };

  // Heroic/Mythic-only abilities on a lower difficulty are dimmed.
  const notThisDifficulty = (s: Section) =>
    shownDifficulty !== null &&
    ((s.tags.includes('mythic') && !isMythic(shownDifficulty)) ||
      (s.tags.includes('heroic') &&
        (shownDifficulty === 14 || shownDifficulty === 17)));

  const renderAbility = (s: Section): React.ReactNode => {
    const stat = s.spellId || s.text ? statFor(s.spellId, s.title) : undefined;
    const dim = notThisDifficulty(s);
    // A heading with nothing of its own (an add's name, a role list): a
    // label over its abilities, not an empty card.
    if (!s.spellId && !s.text) {
      return (
        <div
          key={s.id}
          className={`flex flex-col gap-y-2 ${s.depth > 1 ? 'ml-6' : ''} ${
            dim ? 'opacity-50' : ''
          }`}
        >
          <span className="mt-1 text-sm font-semibold text-foreground-lighter">
            {s.title}
          </span>
          <div className="flex flex-col gap-y-2 border-l border-card pl-3">
            {s.children.map(renderAbility)}
          </div>
        </div>
      );
    }
    return (
      <div
        key={s.id}
        className={`flex flex-col gap-y-2 ${s.depth > 1 ? 'ml-6' : ''} ${
          dim ? 'opacity-50' : ''
        }`}
      >
        <article
          className={`grid ${
            s.spellId
              ? 'grid-cols-[32px_minmax(0,1fr)_auto]'
              : 'grid-cols-[minmax(0,1fr)_auto]'
          } gap-x-3 rounded-md border border-card p-3`}
        >
          {s.spellId ? icon(s.spellId, 'w-8 h-8') : null}
          <div className="flex flex-col gap-y-1 min-w-0">
            <div className="flex items-center gap-x-2 flex-wrap">
              <span className="font-semibold text-foreground-lighter">
                {s.title}
              </span>
              {s.spellId && (
                <span className="text-[11px] px-1.5 py-0.5 rounded border border-card">
                  ID {s.spellId}
                </span>
              )}
              {s.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-card text-foreground-lighter"
                >
                  {tagLabel(tag)}
                </span>
              ))}
            </div>
            {s.text && (
              <p className="m-0 text-[13px] leading-relaxed text-foreground-lighter/85 whitespace-pre-line">
                {s.text}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-y-2 text-right">
            {stat && (stat.wipes > 0 || stat.deaths > 0) && (
              <span className="text-xs whitespace-nowrap">
                <span className="text-foreground-lighter font-semibold">
                  {stat.wipes}
                </span>{' '}
                {stat.wipes === 1 ? 'wipe' : 'wipes'} ·{' '}
                <span className="text-foreground-lighter font-semibold">
                  {stat.deaths}
                </span>{' '}
                {stat.deaths === 1 ? 'death' : 'deaths'}
              </span>
            )}
            {s.spellId && avoidButton(s.spellId, s.title)}
          </div>
        </article>
        {s.children.map(renderAbility)}
      </div>
    );
  };

  if (error && !bosses) return <p className="text-sm text-red-400">{error}</p>;
  if (!bosses) return <p className="text-sm text-foreground">Loading…</p>;
  if (!bosses.length) {
    return <p className="text-sm text-foreground">No pulls yet.</p>;
  }

  const journal = data?.journal ?? null;
  const known = new Set(
    flatten(journal?.sections ?? []).flatMap((s) => [
      s.spellId ? `id:${s.spellId}` : '',
      `name:${norm(s.title)}`,
    ]),
  );
  const extra = (data?.stats ?? []).filter(
    (s) =>
      !(s.spellId && known.has(`id:${s.spellId}`)) &&
      !known.has(`name:${norm(s.name)}`),
  );

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-3 flex-wrap">
        <label className="flex items-center gap-x-2 text-sm">
          Boss
          <select
            className="bg-card text-foreground-lighter rounded px-2 py-1 text-sm border border-background"
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setDifficulty(null);
            }}
          >
            {bosses.map((b) => (
              <option key={b.encounterId} value={String(b.encounterId)}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <div role="tablist" aria-label="Difficulty" className="flex gap-x-1">
          {difficulties.map((d) => (
            <Button
              key={d}
              role="tab"
              aria-selected={d === shownDifficulty}
              size="xs"
              variant={d === shownDifficulty ? 'default' : 'ghost'}
              onClick={() => setDifficulty(d)}
            >
              {DIFFICULTY[d] ?? `Difficulty ${d}`}
            </Button>
          ))}
        </div>
        <span className="text-xs text-foreground">
          Stats are from your pulls on this difficulty.
        </span>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {data && !data.configured && (
        <div className="rounded-md border border-card p-3 text-sm flex flex-col gap-y-1">
          <span className="text-foreground-lighter font-semibold">
            The journal needs Blizzard API keys on the guild server
          </span>
          <span className="text-foreground">
            Create a client at develop.battle.net (API Access), add
            GUILD_CLOUD_BLIZZARD_CLIENT_ID and
            GUILD_CLOUD_BLIZZARD_CLIENT_SECRET to the server&apos;s .env and
            restart it. Until then the list below shows only what your logs saw.
          </span>
        </div>
      )}

      {data?.configured && !journal && (
        <div className="rounded-md border border-card p-3 text-sm flex flex-col gap-y-2">
          <span className="text-foreground-lighter">
            Couldn&apos;t find {data.encounterName ?? 'this boss'} in
            Blizzard&apos;s journal
            {data.error ? ` (${data.error})` : ''}.
          </span>
          {canEdit && (
            <div className="flex items-center gap-x-2">
              <Input
                className="h-8 w-80 text-sm"
                placeholder="Journal encounter ID or link (e.g. ...#encounter=2896)"
                value={journalInput}
                onChange={(e) => setJournalInput(e.target.value)}
              />
              <Button
                size="xs"
                onClick={saveJournalId}
                disabled={!journalInput.trim()}
              >
                Use this
              </Button>
            </div>
          )}
        </div>
      )}

      {journal && (
        <div className="flex flex-col gap-y-1 border-b border-card pb-3">
          <div className="flex items-baseline gap-x-3 flex-wrap">
            <h2 className="m-0 font-display text-2xl text-foreground-lighter">
              {journal.name}
            </h2>
            {journal.instance && (
              <span className="text-sm text-foreground">
                {journal.instance}
              </span>
            )}
            <button
              type="button"
              onClick={() => setTick((t) => t + 1)}
              className="ml-auto text-xs text-foreground hover:text-foreground-lighter inline-flex items-center gap-x-1"
              title="Reload"
            >
              <RefreshCw size={12} /> Journal ID {journal.journalId}
            </button>
          </div>
          {journal.description && (
            <p className="m-0 text-sm text-foreground-lighter/80 max-w-4xl">
              {journal.description}
            </p>
          )}
        </div>
      )}

      <AbilityScope
        encounterId={data?.encounterId}
        difficultyId={shownDifficulty ?? undefined}
        canEdit={canEdit}
      >
        {journal && (
          <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-6">
            {/* Stays in view while the stages scroll past. */}
            <nav
              aria-label="Stages"
              className="flex flex-col gap-y-1 text-sm self-start lg:sticky lg:top-0 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto"
            >
              {journal.sections.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => jumpTo(`journal-${s.id}`)}
                  className={`text-left px-2 py-1.5 rounded hover:bg-card/60 ${
                    activeStage === `journal-${s.id}`
                      ? 'bg-card text-foreground-lighter'
                      : 'text-foreground-lighter/90'
                  }`}
                >
                  {s.title}
                </button>
              ))}
              {extra.length > 0 && (
                <button
                  type="button"
                  onClick={() => jumpTo('journal-extra')}
                  className={`text-left px-2 py-1.5 rounded hover:bg-card/60 ${
                    activeStage === 'journal-extra'
                      ? 'bg-card text-foreground-lighter'
                      : 'text-foreground'
                  }`}
                >
                  Also hit your raid
                </button>
              )}
            </nav>
            <div className="flex flex-col gap-y-6 min-w-0">
              {journal.sections.map((stage) => (
                <section
                  key={stage.id}
                  id={`journal-${stage.id}`}
                  className="flex flex-col gap-y-2"
                >
                  <h3 className="m-0 font-display text-lg text-foreground-lighter">
                    {stage.title}
                  </h3>
                  {stage.text && (
                    <p className="m-0 text-sm text-foreground-lighter/80 whitespace-pre-line">
                      {stage.text}
                    </p>
                  )}
                  {stage.spellId
                    ? renderAbility({ ...stage, children: [] })
                    : null}
                  {stage.children.map(renderAbility)}
                </section>
              ))}
            </div>
          </div>
        )}

        {extra.length > 0 && (
          <section
            id="journal-extra"
            className="flex flex-col gap-y-2 rounded-md border border-card p-3"
          >
            <h3 className="m-0 font-display text-lg text-foreground-lighter">
              Also hit your raid
            </h3>
            <p className="m-0 text-xs text-foreground">
              Abilities that killed raiders in your logs but aren&apos;t in the
              journal under that name (adds, sub-spells). Hover a name for its
              card.
            </p>
            {extra.map((s) => (
              <div
                key={`${s.spellId}-${s.name}`}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-x-3 text-sm py-1 border-b border-card/40"
              >
                {icon(s.spellId, 'w-7 h-7')}
                <span className="text-foreground-lighter truncate">
                  <Ability name={s.name} spellId={s.spellId} />
                  {s.spellId && (
                    <span className="ml-2 text-[11px] text-foreground">
                      ID {s.spellId}
                    </span>
                  )}
                </span>
                <span className="text-xs whitespace-nowrap">
                  {s.wipes} {s.wipes === 1 ? 'wipe' : 'wipes'} · {s.deaths}{' '}
                  {s.deaths === 1 ? 'death' : 'deaths'}
                </span>
                <span>{s.spellId ? avoidButton(s.spellId, s.name) : null}</span>
              </div>
            ))}
          </section>
        )}
      </AbilityScope>

      {journal && (
        <p className="m-0 text-xs text-foreground">
          Ability text: Blizzard&apos;s Encounter Journal. Wipes and deaths:
          your pull logs on{' '}
          {shownDifficulty ? DIFFICULTY[shownDifficulty] : 'this'} difficulty.
          The avoidable list is per boss.
        </p>
      )}
    </div>
  );
};

export default JournalView;
