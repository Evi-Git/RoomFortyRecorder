# Room Forty Toolkit (RoomFortyRecorder)

Fork of Warcraft Recorder for the Room Forty guild: an Electron app ("Room
Forty Toolkit") that records raids, plus a home-hosted Node guild server
(`guild-cloud-server/`). The repo is **public**: never commit secrets. They
live only in the server's `.env` (see `guild-cloud-server/.env.example`).

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
- App: `npx jest src/__tests__/parsing`, `npx eslint --fix <files>`,
  `node node_modules/typescript/bin/tsc --noEmit -p .` (ignore the existing
  errors in ConfigService.ts, LiveStreamer.ts and uiohook).
- Don't run Prettier over `guild-cloud-server/*.mjs` (they aren't formatted
  with it).

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

## Spell icons (how they flow)

Combat logs have spell IDs, not icon names. Icon name: app `SpellIcons`
(disk cache) -> guild server `POST /journal/spells` (Wowhead, Blizzard API,
Warcraft Logs; cached in `journal/spells.json`) -> Wowhead from the PC.
Image: `rficon://icon/<name>` -> app `userData/icons` -> server
`GET /journal/icon/:name` (icon pack in `GUILD_CLOUD_ICON_DIR` first, then
Blizzard/Wowhead CDNs) -> CDNs directly. App log lines start
`[SpellIcons]` / `[PullDesk]`; server lines start `[journal]`.
