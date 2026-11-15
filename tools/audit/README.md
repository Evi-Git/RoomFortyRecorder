# Audit kit (dev only)

How a full QA / quality-of-life / looks audit of the app is run with one
orchestrating model and several cheaper worker agents. Nothing here is
shipped. Findings and screenshots stay OUT of the repo (they contain raiders'
names from real logs).

## Roles

- **Orchestrator** (the strongest model): plans, writes each worker's brief,
  checks the high-impact findings against the code itself, ranks, and writes
  the report. It also looks at the real app for what a mock can't show
  (recording, Go live, sign-in, real server data).
- **Workers** (a cheaper model, one per area, in parallel): read-only. Each
  gets `BLUEPRINT.md` plus an area brief and writes one findings file.
- **Reviewer** (optional, a different strong model): an independent pass over
  a finished diff or the final ranking.

## Steps

1. Screenshots of every page with real data:
   `node tools/harness/shots.mjs --logs <folder of pull .log.gz> --out <dir>`
   (see `tools/harness/README.md`). 66 scenes, including failure variants and
   a small-window pass.
2. Start the code workers (no screenshots needed) at the same time as step 1.
3. Start the visual workers once the screenshots exist.
4. Orchestrator verifies every high-impact finding, merges duplicates, ranks.
5. The report goes in the project notes, not in the repo.

## Areas used on Nov 15, 2026

| Area | Kind | Covers |
| --- | --- | --- |
| `server` | code | `guild-cloud-server/`, updater, docs: data safety, robustness, security, operability |
| `main-process` | code | `src/main`, `src/parsing`, `src/storage`, `src/config`, CI: raid-night reliability, failure handling, IPC |
| `renderer-consistency` | code | `src/renderer`: countable consistency (tokens, shared components, states, keyboard, formats, storage keys, structure, tests) |
| `visual-shell` | screenshots | sidebar, recordings, live, settings, scene, admin, dialogs, failure variants, small window |
| `visual-analysis` | screenshots | Dashboard, Logs, Analyze, Top logs, Time trial |

A worker brief is: "Read `tools/audit/BLUEPRINT.md` and follow it. Your area
name: `<area>`. Save your findings file after every few findings." followed
by the area's scope, an ordered focus list, and what not to report. Tell
workers to save as they go: a stopped worker otherwise leaves nothing.

## Lessons

- Give workers a findings format and a cap (20 to 25); rank by user impact.
- "Confirmed" must mean the worker read the code or saw the screenshot.
- Keep a "Known" list in the blueprint so old items aren't re-reported.
- Interrupting the orchestrator stops its background workers.
