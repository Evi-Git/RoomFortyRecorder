# Room Forty Toolkit (RoomFortyRecorder)

Fork of Warcraft Recorder for the Room Forty guild: an Electron app ("Room
Forty Toolkit") that records raids, plus a home-hosted Node guild server
(`guild-cloud-server/`). The repo is **public**: never commit secrets. They
live only in the server's `.env` (see `guild-cloud-server/.env.example`).

## How Claude works here (advise and orchestrate)

The main conversation model (Fable when available, otherwise Opus) is the
**advisor and orchestrator**, not the bulk worker:

- **Advise first.** Read the code, say what you'd do and why, name the
  trade-offs and risks, and recommend an order. The maintainer decides.
- **Orchestrate the build.** Map the code and write a complete blueprint for
  each piece (goal, context, files, steps, constraints, output format, what
  done looks like), then hand it to subagents:
  - **Sonnet** for fast, well-defined execution (one worker per release).
  - **Opus** for deep reasoning and hard judgment calls, and for a read-only
    adversarial review of each diff before it merges.
- **Verify, then merge.** Review every worker's diff yourself, run the checks
  below, send fixes back to the same worker, and only then open the PR.
  Never pass on a worker's claim unchecked.
- **Do it yourself** when the task is small, or when it needs judgment that
  can't be written into a blueprint.
- Workers that edit get their own git worktree
  (`git worktree add ../<name> -b <branch> origin/main`, with `node_modules`
  symlinked). Tell each worker to save its output as it goes. Keep agent
  counts modest. `tools/audit/` has a worked blueprint and lessons.

## Layout

- `src/main/` Electron main process. `PullDesk.ts` (guild server IPC,
  pull uploads, full-log cache, `rficon://` icon cache), `SpellIcons.ts`
  (spell ID -> icon name, disk cache; guild server first, then Wowhead),
  `PullBackfill.ts`.
- `src/parsing/` combat log reading: `LogEvents.ts` (one line -> fields),
  `PullMeters.ts` (meters, `DAMAGE_REDUCTION` table), `PullLogCapture.ts`.
- `src/renderer/logs/` the Logs page (Warcraft Logs-style explorer):
  `store.ts` (columnar event store), `query.ts` (meters, auras, mitigation
  estimate, ability grouping), `MeterView.tsx`, `LogsExplorer.tsx`,
  `SpellIcon.tsx` (icons + tooltips), `talents.ts` (talent/buff damage
  reductions).
- `guild-cloud-server/` `server.mjs`, `pulldesk.mjs` (routes), `journal.mjs`
  (Blizzard journal, spell cache, icons, Warcraft Logs names),
  `icon-pack.mjs` (BLP/TGA -> PNG), `server-files.txt` (what the server
  updater installs).
- `docs/` PullDesk.md, GuildCloudServer.md, RELEASING.md.

## Checks

- Server: `cd guild-cloud-server && node --test`
- App tests: `npx jest src/__tests__/parsing src/__tests__/renderer
  src/__tests__/main src/__tests__/cloud` (the other suites need native
  Windows modules).
- Types: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.ci.json`,
  must be 0 errors. Not `npx tsc` (it runs the deprecated `tsc` package,
  which fails), and not `-p .`: tsconfig.json's resolution can't follow some
  packages' `exports` maps, so it reports errors that aren't real (editors
  using it show them too). The CI config also points the native Windows
  modules at their real typings: `noobs` at `native/noobs/index.d.ts`,
  `uiohook-napi` at `src/types/ci/uiohook-napi.d.ts`.
- Lint: `npx eslint src --ext .ts,.tsx --max-warnings 12`, must be 0 errors;
  the warning count may only go down (then lower the number here and in
  `tests.yml`). `npx eslint --fix <files>` for formatting. A lint disable
  needs its reason on the same line (`-- why`).
- Don't run Prettier over `guild-cloud-server/*.mjs` (they aren't formatted
  with it).
- CI: `.github/workflows/tests.yml` runs tsc, eslint, the app suites that work on
  Linux (parsing, renderer, main, cloud) and the server tests on every PR;
  `node.js.yml` builds on Windows. Both must pass before merging.

## Releasing

1. Branch from `main`.
2. Bump the version in `release/app/package.json` (line 3) and
   `release/app/package-lock.json` (lines 3 and 9).
3. Add a CHANGELOG entry above the previous version.
4. PR to `main`. CI builds on Windows.
5. Squash-merge, then run the Release workflow on `main`. It makes a
   **draft** release; the maintainer publishes it.
6. After publishing: the app auto-updates. The server is updated by running
   `update-server.cmd` on the server PC; it installs only the files in
   `server-files.txt` and rolls back if `/health` doesn't answer.

A new server module must be added to `server-files.txt` (a test checks).

A release that changes any file in `server-files.txt` must also bump
`SERVER_CHANGED_IN` in `src/renderer/serverVersion.ts` to that release's
version: apps then show "The guild server needs an update" until
`update-server.cmd` has been run.

## React Compiler (renderer)

The renderer build runs the React Compiler (`react-compiler-webpack`). It
memoizes reads of module-level mutable state (a `Map` filled later) by the
component's props, so a component that reads such a cache during render
never sees updates, even when it re-renders. Use `'use no memo'` in those
files (as `logs/SpellIcon.tsx` and `AbilityCard.tsx` do), or
`useSyncExternalStore`. A browser test harness must run the compiler too
(babel-plugin-react-compiler) or it won't reproduce these bugs.

## Testing UI changes without the app

`tools/harness/` builds renderer pages for a plain browser (esbuild, with
the React Compiler, and a mocked `window.electron.ipcRenderer`) and drives
them with Playwright: `node tools/harness/build.mjs`, then
`node tools/harness/smoke.mjs --log <a pull's .log.gz>`. See its README for
adding an entry or overriding a mock answer. Dev only; never shipped. Real
pull logs stay out of the repo.

The whole app also runs there (`?entry=app`) against the real guild server
started locally and seeded from a folder of pull logs:
`node tools/harness/shots.mjs --logs <folder> --out <dir>` saves a screenshot
of every page (scenes in `scenes.mjs`, including failure variants). Use it to
check a UI change before a PR. `tools/audit/` describes how a full audit is
run with worker agents.

## UI conventions

- Design system for A (tokens with usage notes, brand book, component
  cards): the claude.ai artifact "Room Forty Toolkit: design system (A,
  Brass & Walnut)", https://claude.ai/artifact/N1NMs7m5eF4ZX2uAg3kYDh.
  Read its README before restyling a page.
- Text colours: `text-foreground-lighter` is the main text (#E6DED1);
  `text-foreground` is the **muted** one (#958C83, 5.2:1 on `panel`) for
  labels and help lines. Don't fade either with opacity. Error text on dark
  surfaces: `text-error-text` (not `text-error`, which is 2:1).
- Settings rows: `components/SettingsCard/SettingsCard.tsx`
  (`SettingsSection`, `SettingRow`, `useScopedIds` for ids that stay unique
  when two tabs are mounted).
- Colours: Tailwind tokens, not hex. `walnut` (page), `panel`,
  `panel-deep`, `panel-raised`, `panel-line` (surfaces and their lines),
  `brand` (brass). Literal colours for charts/MUI live in `renderer/brand.ts`.
- Loading, empty and error states: `components/States/States.tsx`
  (`LoadingState`, `Skeleton`, `EmptyState`, `ErrorState` with Try again and
  Copy details; errors go through `renderer/friendlyError.ts`). They set
  `data-state="loading|empty|failed"` so harness tests can wait on them.
- Times of day: `renderer/clock.ts` (12-hour, the PC's time zone).
- Design A ("Brass & Walnut everywhere", design canvas "Room Forty Toolkit:
  one visual language"): page titles and view tabs through
  `components/PageHeader/PageHeader.tsx` (`PageHeader`, and `UnderlineTabs`
  for tabs inside a page); serif (`font-display`) headings; brass underline
  for the active tab.
- Class colours: `getWoWClassColor` / `logs/format` `classColor` return the
  readable tints in `renderer/classColors.ts`, not Blizzard's exact values.
- Pull lists: `renderer/resets.ts` (`isReset`, pulls under 10 s;
  `useShowResets`, one switch for every page) and
  `components/BossBar/BossBar.tsx` (fills as the boss loses health).
- Open the Logs page at a pull: `logs/openTarget.ts` (`setLogsTarget`, then
  open a Logs tab; the Logs page calls `takeLogsTarget` on mount).

## Spell icons (how they flow)

Combat logs have spell IDs, not icon names. Icon name: app `SpellIcons`
(disk cache) -> guild server `POST /journal/spells` (Wowhead, Blizzard API,
Warcraft Logs; cached in `journal/spells.json`) -> Wowhead from the PC.
Image (Logs page): `iconImage` IPC -> data: URL from app `userData/icons-v2` -> server
`GET /journal/icon/:name` (icon pack in `GUILD_CLOUD_ICON_DIR` first, then
Blizzard/Wowhead CDNs) -> CDNs directly. App log lines start
`[SpellIcons]` / `[PullDesk]`; server lines start `[journal]`.
