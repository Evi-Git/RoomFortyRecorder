# Browser test harness (dev only)

Renders the whole renderer (`src/renderer/App.tsx`) in plain Chromium, with a
mocked Electron bridge and a real local guild server, so every page can be
driven and screenshotted with Playwright. Nothing here is shipped.

## Commands

From the repo root:

    node tools/harness/build.mjs [--out /tmp/rf-harness-out]
    node tools/harness/shots.mjs --logs <dir of pull .log.gz> --out <dir> [--only a,b] [--reseed]
    node tools/harness/serve.mjs --logs <dir> [--keep <dir>] [--port 4173]
    # then open http://127.0.0.1:4173/?entry=app
    node tools/harness/smoke.mjs --log <pull.log.gz>      # single-page Logs explorer check
    node tools/harness/backend.mjs --logs <dir>            # just the seeded guild server

`shots.mjs` builds if the sources changed, starts the backend, runs every
scene in `scenes.mjs` at 1440x900 (en-US, America/New_York) and writes
`<out>/<nn>-<name>.png` and `<out>/manifest.json` (per scene: what it shows,
status, error, console errors, failed `pullDesk` actions, time). A scene that
can't be reached is recorded as an error and the run goes on. The first run
seeds the logs (about a minute); the seeded data is kept in
`/tmp/rf-harness-backend-cache` and reused while the log files are the same
(`--reseed` or `--keep` to change). esbuild and Playwright come from the repo's
`node_modules`, or `/opt/npm-tools/node_modules`.

## What is real, fixture, or mocked

- Real: the guild server (`guild-cloud-server/server.mjs`, child process, temp
  storage, dummy env: no Discord, R2 or Warcraft Logs keys; `@aws-sdk` is
  stubbed if not installed). The harness user is its owner.
- Real: the app's own `PullDesk.ts` (the `pullDesk` action -> route table,
  full-log cache) and `PullBackfill.ts` / `PullLogCapture.ts` / `PullMeters.ts`,
  bundled for Node by `build.mjs` with stubs for `electron`, `ConfigService`,
  `main/main`, `CoachClip` and a thin `CloudClient` (`node/`). Seeding sends
  each log through backfill exactly as the app would (filtered log + meters
  line + full log). `serve.mjs` answers `POST /ipc/pullDesk` with it.
- Fixtures (`fixtures.mjs`, `fixtures/recordings.ts`; made-up "Fixture ..."
  names): Top logs rankings, Time trial track, Journal boss and spells, talent
  tree, watched guilds ("Fixture Guild"), spell names; recordings (no video
  files behind them: the player shows its own error state); live streams.
  Without keys the real server would answer these with "needs the API keys".
- Mocked in `mock.ts`: config (in-memory defaults, signed in, Send my Logs on),
  status events, encoders, displays, audio, updates, chat, timeline.
- Not mocked: OBS preview, WebRTC (Watch live shows its connect error, so the
  "No picture" overlay is not reachable), native dialogs, real video playback,
  spell icon images (offline: icons show as blanks).

## Scenes

`scenes.mjs` exports a list of `{ name, shows, steps, init?, viewport?,
continue?, wait?, after? }`. `steps(t)` uses the helpers in `helpers.mjs`
(`t.nav('Logs')`, `t.click(text)`, `t.text(text)`, `t.pickNight('2026-10-21',
'Nov 10')`, `t.emit(channel, ...)`, `t.answer(key, value)`, `t.page`). A scene
without `continue: true` opens a fresh page (fresh storage). `init` is read by
`mock.ts` before the app mounts: `{ config: {...}, answers: { 'pullDesk:list':
{...} } }` (plain JSON answers). To add one, append to `scenes.mjs` and run
`shots.mjs --only <name>` (scenes that `continue` need their predecessors).

## Mock API (browser)

    window.__harness.answer('pullDesk:season', (args) => ({ ok: true, data }))
    window.__harness.emit('updateRecStatus', 1, '')   // push as the main process
    window.__harness.config({ cloudSessionToken: '' }) // set BEFORE the app mounts
    window.__harness.calls / messages / failures       // for assertions

Keys are `channel` or `pullDesk:<action>`. `on(channel, fn)` returns an
unsubscribe; state channels (rec status, videos, ...) are replayed to a new
subscriber. Unmocked invokes answer `{ ok: false, error: 'not mocked' }`.

## Add an entry

`entries/<name>.tsx`, first line `import '../mock';`. Open `/?entry=<name>`.
`entries/app.tsx` is the whole app, `entries/logs-explorer.tsx` one page.

## Gotchas

- The harness runs the React Compiler like the real build (see CLAUDE.md).
- Harness files are not scanned by Tailwind: use inline styles in them.
- In harness-compiled JSX, text next to an expression can lose its space; use
  template strings.
- Wait on `[data-state="loading|empty|failed"]` and visible text, not sleeps.
- Pull logs are real data: never copy one (or anything derived) into the repo.
  The backend keeps everything under `/tmp`.
- The browser blocks every non-127.0.0.1 request; icon images fail offline.
