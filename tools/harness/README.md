# Browser test harness (dev only)

Builds renderer pages for a plain browser with a mocked Electron bridge, so
they can be driven with Playwright without the app. Nothing here is shipped.

## Commands

From the repo root:

    node tools/harness/build.mjs [--out /tmp/rf-harness-out]
    node tools/harness/smoke.mjs --log <pull.log.gz> [--shots dir] [--out dir]
    node tools/harness/serve.mjs --log <pull.log.gz> [--port 4173]
    # then open http://127.0.0.1:4173/?entry=logs-explorer

`build.mjs` bundles every file in `entries/` with esbuild (Babel + the React
Compiler first, like the real renderer build) and builds Tailwind into
`app.css`. esbuild and Playwright are taken from the repo's `node_modules`, or
from `/opt/npm-tools/node_modules` if missing there. `smoke.mjs` serves the
out dir, opens the Logs explorer (locale en-GB) and checks the Damage Done
table, Enemies > Healing, and that there are no uncaught page errors.
`GET /log.gz` serves the file given by `--log`.

## Add an entry

Create `entries/<name>.tsx`. The first line must be `import '../mock';`
(some modules, e.g. `Meters.tsx`, read `window.electron` at import time).
Render into `#root`. Open it with `/?entry=<name>`. Wrap in whatever
providers the page needs.

## Override a mock answer

`mock.ts` answers `invoke(channel, [request])`. In a test (or in an entry):

    window.__harness.answer('pullDesk:season', () => ({ ok: true, data: {...} }));
    window.__harness.answer('spellIcons', { 123: 'inv_misc_questionmark' });

Keys are `channel` or `pullDesk:<action>`; the value is a function of the
args array, or a plain value. `window.__harness.calls` lists every invoke.
Unmocked calls answer `{ ok: false, error: 'not mocked' }`.

## Gotchas

- Run the React Compiler in the harness or bugs that depend on memoization
  will not reproduce (see CLAUDE.md, React Compiler).
- Harness files are not scanned by Tailwind: use inline styles in them.
- In harness-compiled JSX, text next to an expression on one line
  (`You {n}`) can lose its space; use template strings.
- Wait on `[data-state="loading|empty|failed"]` and visible text, not sleeps.
- Pull logs are real data: never copy one into the repo.
- Icon/image requests fail offline; console errors about them are expected.
