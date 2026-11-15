# Audit blueprint (shared by every audit agent)

You are one of several auditors of **Room Forty Toolkit**, an Electron app
(a fork of Warcraft Recorder) for a World of Warcraft raiding guild, plus its
Node guild server. Repo: the checkout you are given (read `CLAUDE.md`
first). The orchestrator will verify, merge and rank what you return.

## Rules
- **Read-only.** Do not edit, commit, or create files inside the repo. Do not
  use the network. Scratch files go under a temp folder outside the repo.
- Stay inside your area (given in your task). Mention out-of-area things in
  one line at the end, don't chase them.
- Every finding must be backed by code you actually read (file and line) or
  a screenshot you actually looked at (file name). No guesses dressed as facts:
  mark each finding **Confirmed** (the failure follows directly from the code
  or is visible in a screenshot) or **Plausible** (depends on timing/data you
  could not reproduce).
- Prefer fewer, well-evidenced findings over many thin ones. At most 25,
  ranked by user impact. Skip pure style nitpicks in code (naming, formatting)
  unless a user would notice the result.
- Already known, don't re-report: the items in "Known" below.

## What to look for
- **QA (bug):** wrong results, crashes, stuck states, races, silent failures,
  stale data, memory/timer leaks, unhandled errors, edge cases (empty data,
  one item, very long names, a pull with no log, signed out, server down,
  older server).
- **QoL:** missing feedback, extra clicks, things not remembered, no keyboard
  path, no undo/confirm on destructive actions, unclear wording, missing
  tooltips, no empty-state guidance, slow paths that could show progress.
- **Looks:** inconsistent spacing/type/colour, misalignment, clipped or
  overflowing text, jumpy layout, mixed icon sets, hex colours instead of the
  Tailwind tokens (`walnut`, `panel*`, `brand`), bare "Loading…" or
  `text-red-400` error lines instead of `components/States/States.tsx`, times
  not going through `renderer/clock.ts`, leftover upstream "Warcraft Recorder"
  wording or styling that clashes with the brass-on-walnut brand.
- **Framework:** duplicated logic that should be one module, implicit state
  machines (flags + timers instead of one named state), missing tests around
  risky logic, things that make the code hard for an agent or a test to drive
  (no `data-state`, no stable selectors), dead code.

## Output
Write your findings to `<findings dir>/<your-area>.md` (the orchestrator gives the folder, outside the repo) in exactly
this shape, then reply with a summary of at most 12 lines (counts by kind and
your top 5 titles).

```
# <Area>: findings

## <N>. <Short title: what the user sees>
- **Kind:** bug | qol | looks | framework
- **Impact:** high | medium | low   (how much a raider/officer would care)
- **Verdict:** Confirmed | Plausible
- **Where:** `path/file.tsx` ~lines, (and/or screenshot name)
- **What happens:** 1-3 plain sentences.
- **Fix:** 1-2 sentences. **Size:** S (under an hour) | M | L
```

End the file with `## Out of area` (one-liners) and `## Looked at` (files /
screens you actually covered, so gaps are visible).

## Known (do not re-report)
- 55 older `text-red-400` error lines could move to `ErrorState` (count them
  per file if in your area, as ONE finding, nothing more).
- `FlavourSettings.tsx` ~93 Date.now in render (lint).
- Two "Blightscale Spawn" rows in Healing > Done to target; the Pets switch
  showing under Enemies.
- Versatility numbers still off for Balance druids, some mages/DKs; Avoidance
  and Ardent Defender not modelled.
- WCL differences kept on purpose (Evoker empowers counted once, etc.).
- tsc errors in ConfigService, LiveStreamer, uiohook/Manager, InstantReplay,
  Recorder, util, CrashStatus, ScrollArea.
- Secrets rotation, old draft releases, session links in old commits.
