# Pull desk

Shortly after every tracked raid pull, the guild server builds a report from
one raider's combat log. The report is on the **Pull desk** page in the app.
Posting a summary of every pull to Discord is optional and off by default
(`GUILD_CLOUD_PULLDESK_POST_PULLS=true` turns it on).

Each report has:

- **Wipe cause**: a raid-wide mechanic ("Erupting Void Echo killed 14 at
  2:39"), the first death, and the first tank or healer death.
- **Boss HP** over the pull, with a tick for each death.
- **Deaths**: time, killing blow, the last hits on that raider, and a
  **Watch** button that opens their recording 10 s before the death.
- **Cooldown plan**: every assignment in the boss's note checked against what
  the raider actually cast: on time, late, early, missed, or dead before
  their timing.
- **Avoidable hits**: hits per raider from a per-boss list of spell IDs.

## How a pull gets to the server

1. While a raid encounter is running, every raider's app keeps a filtered
   copy of the combat log: damage on players, deaths, casts, and one sample
   per second of damage on enemies. Heals and auras are dropped. A 40 MB
   Mythic pull becomes about 0.4 MB to upload.
2. When the encounter ends, each app tells the server how many lines it
   kept. After 3 seconds the server picks the most complete log, and only
   that app uploads. If it never does, the next best uploads after about a
   minute.
3. The server analyzes the log and saves the report (and posts to Discord if
   `GUILD_CLOUD_PULLDESK_POST_PULLS` is on).

Raiders can turn **Send my pull logs** off on the Pull desk page. Pulls are
only captured on retail raid difficulties, and the server only reports on
the difficulties in `GUILD_CLOUD_PULLDESK_DIFFICULTIES` (Mythic by default).

## Server setup (one time)

1. Copy `pulldesk.mjs` and `pulldesk-analyze.mjs` from `guild-cloud-server/`
   into the server folder next to `server.mjs`, and copy the new
   `server.mjs` too. No new npm packages are needed.
2. Add the pull desk lines from `.env.example` to the server's `.env`. At
   minimum set `GUILD_CLOUD_PULLDESK_DEFAULT_CHANNEL` to a Discord channel
   ID.
3. In Discord, give the bot **View Channel**, **Send Messages** and **Embed
   Links** in the boss channels (or in their category).
4. Restart Node. Reports are stored in `<storage>\pulldesk\`; back it up
   with `state.json`.

Who can edit notes, avoidable spells and channels in the app is set by
`GUILD_CLOUD_PULLDESK_EDITOR_ROLES` (defaults to the live viewer roles,
Raider+ and Officer). Leave it unset rather than empty: an empty value lets
everyone edit.

## Per-boss settings (in the app)

Open a pull for the boss, then **Boss settings**:

- **Cooldown note**: paste the same note you Send in NSRT. MRT style
  (`{time:1:30}Name {spell:31821}`) and NSRT style
  (`time:90;tag:Name;spellid:31821;`) lines are both read. Lines timed by
  phase (`{time:0:30,p2}`) are skipped for now. Saving re-checks the last 24
  hours of pulls for that boss.
- **Avoidable spells**: spell IDs, comma-separated. Saving re-checks recent
  pulls too.
- **Discord channel**: the channel ID for this boss's reports. Empty uses
  the server default.

## Test guide

Do steps 1-4 before a raid night; 5-8 happen during it.

1. **Server.** Deploy the three files and restart Node. For a first test on
   Heroic, set `GUILD_CLOUD_PULLDESK_DIFFICULTIES=heroic,mythic`.
2. **App.** Install the build on your PC and at least one raider's PC, and
   sign in with Discord.
3. **Pull desk page.** Open it from the sidebar. It should say "No pulls
   yet", with no error.
4. **Channel.** Set `GUILD_CLOUD_PULLDESK_DEFAULT_CHANNEL`, or set the
   channel per boss once the first report exists.
5. **First pull.** Pull a tracked boss and wipe or kill. Within about 10 s
   of the encounter ending:
   - the pull appears at the top of the Pull desk list,
   - a summary is posted in the boss's Discord channel,
   - the server console shows no `[pulldesk]` warnings.
6. **Watch.** In the report, click **Watch** on a death of a raider whose
   recording you have. Their recording should open about 10 s before the
   death.
7. **Note.** Paste your NSRT note into Boss settings and save. The open
   report should refresh with a Cooldown plan section. Check one assignment
   you know was missed.
8. **Two PCs.** With several raiders running the app, each pull should still
   appear once, uploaded by one raider ("log from …" in the report header).

### If something doesn't work

| Symptom | Check |
| --- | --- |
| Page says the pull desk isn't set up | The server is still running the old `server.mjs`. Copy all three files and restart Node. |
| No pulls appear | The difficulty isn't in `GUILD_CLOUD_PULLDESK_DIFFICULTIES`, nobody has Send my pull logs on, or nobody is signed in. The app log shows `[PullDesk]` lines for each pull. |
| Pull appears but no Discord post | No channel set, or the bot lacks Send Messages or Embed Links there. The server console shows the Discord error. |
| Watch is greyed out | You don't have that raider's recording of that pull (not uploaded, or not recorded). |
| Plan check shows "named nobody in the pull" | The names in the note don't match character names. Names are matched without realm and ignoring case. |
