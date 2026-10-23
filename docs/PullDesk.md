# Analysis (formerly Pull desk)

Shortly after every tracked raid pull, the guild server builds a report from
one raider's combat log. The report is on the **Analysis** page in the app.
(The code and server routes still use the old name, `pulldesk`.)
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
- **Avoidable hits**: hits per raider from a per-boss list of abilities.
  An ability matches by spell ID *or name*, so every ID it hits as counts
  (casts and hits often differ, e.g. Venom Roar hits as two IDs, one magic
  and one physical).
  Open a raider to see each hit moment per spell; click one to watch their
  recording just before it (ticks within 5 s count as one moment).
- **Defensives**: every raider's personal and external defensives, raid
  cooldowns, health potions, healthstones and combat potions (Light's
  Potential and any others on the server's list, every quality), matched by ability name (the
  same lists as the guild's Warcraft Logs queries). Each death also shows
  what that raider still had ready, from the last use and the ability's base
  cooldown (talents can shorten cooldowns, so treat it as an estimate). The
  list lives in `guild-cloud-server/pulldesk-defensives.mjs`.

The report is split into tabs (Deaths, Defensives, Cooldown plan, Avoidable
hits), and long sections are grouped per raider in rows you can open.

## Consumables & buffs

From each raider's COMBATANT_INFO line at the pull (advanced combat
logging): gear (enchants, gems, weapon oil) and every aura with its
caster. `guild-cloud-server/consumables.mjs` names the auras with Wowhead's
tooltip (cached in `<storage>/journal/spells.json`): "Well Fed" = food,
Flask/Phial or "through death" = flask, "Augment Rune"/"...Augmentation" =
augment rune, "Vantus Rune: ..." = vantus, a combat potion's name = pre-pot.
Raid buffs are known spell IDs. Combat potions possible per pull = 1 + one
per full 5 minutes. Enchant slots: head, shoulders, chest, legs, boots,
rings, weapon; gem slots: head, neck, wrist, belt, rings.

## Night summary and Progression

The buttons at the top of the page switch between **Pulls** (the reports
above), **Night summary** and **Progression**. Both are built by the server
from the reports it already has, so they need nothing extra from raiders.

- **Night summary**: pick a night. For each boss: pulls, kills, best and
  median wipe, time in combat, why pulls ended, a raider table and the list
  of pulls (Open jumps to that pull's report).
  - *Why pulls ended*: a raid-wide mechanic if one killed many at once,
    otherwise the first death's killing blow; short pulls with no deaths
    count as resets.
  - *Early deaths*: the first 2 deaths of each pull, the same rule as the
    recruiting page; later deaths are usually the wipe. Hover a raider's
    number to see what killed them. Click any column to sort.
  - *Avoidable damage*: each avoidable ability with damage taken, hits,
    raiders hit, pulls and deaths; click a row for its raiders. Progression
    has the same panel across all nights.
- **Progression** (pulls up to and including the first kill per difficulty, all recorded history) and **Reclears** (everything after; or every pull, for a boss ticked as killed before we tracked it): pick a boss. Boss health at the end of every pull, the
  best so far, where each night starts and the first kill. Hover for the
  pull, click to open it, or switch to the table. Below: totals per night,
  wipe causes per night (a cause that fades out is a solved mechanic) and
  each raider's early deaths per pull, night by night.

### Missed pulls are sent automatically

Pulls the live capture didn't send (the app was closed, signed out, or
crashed) are picked up from the saved combat logs. With "Send my pull logs"
on, every raider's app checks its finished combat log files from the last
week, 2 minutes after it starts and then every 30 minutes, never during a
pull. It asks the server which pulls it still needs a log for and sends only
those, with the boss % from that raider's recordings. A file is checked once
and again only if it grows. When several raiders have the same night, the
server gives each pull to one of them (the others skip it for 5 minutes, then
check again in case that upload failed).

### Uploading a night from your combat log by hand

To send a file right away, anyone who was in the raid can use **Upload from
combat log** on the Night summary or Progression view. It lists the combat
log files in your WoW Logs folder (WoW writes one per session, e.g.
`WoWCombatLog-102126_195812.txt`). Pick the
night's file, **Scan**, tick the bosses and **Upload**. Every pull gets the
same full report as a live upload, placed at its real time, with the boss %
from your recording where there is one. Pulls the server already has a log
for are skipped, so it's safe to run twice or from two raiders' PCs.

### Importing pulls from Warcraft Logs

If a night wasn't captured (nobody had "Send my pull logs" on, or it was
before the app), editors can click **Import from Warcraft Logs** on the Night
summary or Progression view and paste the report links. Boss pulls on the
tracked difficulties are added with their result, boss %, roster and deaths,
so wipe causes, early deaths and the progression curve all work. Pulls the
app already has are skipped. Imported pulls have no cooldown plan, avoidable
hits or defensives (those need the app's own log) and show "WCL" instead of
an Open button. Needs the Warcraft Logs API keys in `.env` (see
Recruiting.md).

Pulls the app saw but never got a log for also count in both views after
10 minutes, with the result, boss % and length the app reported.

### Journal view and ability cards

- **Journal** (fourth view): pick a boss and difficulty. Blizzard's
  Encounter Journal by stage, each ability with its text, spell ID, tags,
  your raid's wipes and deaths to it on that difficulty, and (for editors)
  **Add to avoidable**. Abilities from your logs that the journal doesn't
  name are listed under **Also hit your raid**.
- **Ability cards**: hover any underlined ability name (wipe causes, killing
  blows, Progression causes) for the same text, the spell ID (copy button),
  your raid's numbers and the avoidable button.
- The avoidable list is per boss (all difficulties), as in Boss settings.
- Where the data comes from: the stages, overview and ability list from
  Blizzard's Encounter Journal (free API); ability text and icon names from
  Wowhead's tooltips for the difficulty shown, because Blizzard's API has no
  text for abilities and its spell endpoints don't answer for boss spells.
  The guild server asks Wowhead once per spell per difficulty and keeps the
  answer (`<storage>/journal/spells.json`); icon images load from Blizzard's
  image server. The journal lists some abilities once per difficulty without
  saying which, so those copies are merged.
- Setup: a free client at https://develop.battle.net (API Access → Create
  Client). Put `GUILD_CLOUD_BLIZZARD_CLIENT_ID` and
  `GUILD_CLOUD_BLIZZARD_CLIENT_SECRET` in the server `.env` and restart. The
  server caches each boss's journal for a day and spells/icons for good.
- If a boss isn't found by name, paste its journal encounter ID or a journal
  link (e.g. one ending in `#encounter=2896`) in the Journal view.

### Top guilds (Progression)

Officers add up to 3 guilds that log publicly on Warcraft Logs (name, realm,
region as shown there) under **Top guilds**, then **Crawl now**. The server
fetches their Mythic pulls on every boss of the raid named there, up to and
including each first kill (farm kills are ignored), using the same Warcraft
Logs API keys as the recruiting page. The table shows each guild's pulls,
nights and kill date on the selected boss next to Room Forty's, and
**Compare with…** on the chart draws that guild's best-so-far line beside
ours (pull 1 lined up with pull 1).

The watcher starts **frozen**: no automatic crawls. At the start of a new
tier, set the raid's name, click **Unfreeze**, and it crawls every day at
6 am (server time). Reports older than a day are cached, so daily crawls
cost few points.

## Coaching: flags and sending clips

- **Flag this moment** (Watch live): click **Flag** or press **B** while
  watching. The flag is timed to what was on screen (the stream buffer is
  taken off). Tonight's flags are listed under the header; click *Add note*
  to say what happened. In Pull desk, flags raised during a pull show as
  brass ticks on its boss health line and in a list under it, with a Watch
  button (the streamer's own recording if their Discord name matches a
  raider, otherwise anyone's recording of that pull).
- **Send to Discord** (any recording or clip): the paper plane button next to
  the share link. Pick a channel, add a note, Send. The app cuts a 30 s clip
  starting 5 s before where you are in the video, re-encodes it to 720p
  H.264 (a few MB, so Discord plays it inline; whole recordings are too big
  for Discord's player), uploads it to the guild cloud (it also shows under
  Clips) and the bot posts it with your note and a preview of the moment.
  - **Officers** (`GUILD_CLOUD_COACH_OFFICER_ROLES`, default `Officer`) can
    send to any text channel. Example: Mage A's clip sent to Mage B's channel
    as "this is how to soak it".
  - **Raiders** can only send to their own personal channel.
- **Personal channels** (officers, Pull desk header): add a raider, pick
  their channel, Save. The raider list comes from Discord if the bot has the
  **Server Members Intent** (Discord Developer Portal → Bot → Privileged
  Gateway Intents); without it, the list is everyone who has signed in to
  the app.
- The bot needs **View Channel, Send Messages and Embed Links** in every
  channel it posts to (granting them on the category is easiest).

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
4. From 1.9.32 the same app also sends the pull's **full** combat log
   (every line, gzipped: about 10 MB for a 5-minute Mythic pull) for the
   **Logs** page. The server stores it under `full/` and serves it to the
   app, which reads it on your PC: Tables, Timelines, Events and Queries,
   with every filter. Full logs are pruned with the other logs after
   `GUILD_CLOUD_PULLDESK_LOG_DAYS` (30 by default), so expect roughly
   200-300 MB of disk per raid night until then. The app caches the logs
   you open (up to 1.5 GB) in its settings folder.

Raiders can turn **Send my pull logs** off on the Pull desk page. Pulls are
only captured on retail raid difficulties, and the server only reports on
the difficulties in `GUILD_CLOUD_PULLDESK_DIFFICULTIES` (Mythic by default).

## Server setup (one time)

1. Update the server code with `update-server.cmd` (see "Updating the
   server" in `GuildCloudServer.md`). No new npm packages are needed.
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

## Admin page and permissions

The owner (`GUILD_CLOUD_OWNER_IDS` in the server `.env`, Discord user IDs)
gets an **Admin** item under Settings:

- **Permissions by Discord role**: one row per capability (see Analysis,
  edit Analysis, top-guild watcher, watch live, send clips to their own
  channel or any channel, edit personal channels, edit anyone's flags,
  recruiting page), one column per role. Someone with several roles gets
  everything any of them allows. The owner always has everything. Saved to
  `<storage>/permissions.json`. Until then each capability uses its old
  `.env` role list (`GUILD_CLOUD_LIVE_VIEWER_ROLES`,
  `GUILD_CLOUD_PULLDESK_EDITOR_ROLES`, `GUILD_CLOUD_COACH_OFFICER_ROLES`,
  `GUILD_CLOUD_RECRUIT_ROLES`). Who can sign in at all stays
  `GUILD_CLOUD_DISCORD_ALLOWED_ROLES`.
- **View as role**: the app sends `X-View-As-Role` and the server answers
  as that role (owner only; the Admin routes ignore it). A pill in the title
  bar shows it, with Exit. A restart always comes back as yourself.
- **Combat potions**: the names counted as combat potions.

## Per-boss settings (in the app)

Open a pull for the boss, then **Boss settings**:

- **Cooldown note**: paste the same note you Send in NSRT. MRT style
  (`{time:1:30}Name {spell:31821}`) and NSRT style
  (`time:90;tag:Name;spellid:31821;`) lines are both read. Lines timed by
  phase (`{time:0:30,p2}`) are skipped for now. Saving re-checks the last 24
  hours of pulls for that boss.
- **Avoidable spells**: spell IDs, comma-separated (or add them from an
  ability's hover card or the Journal, which also records the name so every
  spell ID it hits as counts). Saving re-checks recent pulls now and older
  ones in the background.
- **Discord channel**: the channel ID for this boss's reports. Empty uses
  the server default.

## Test guide

Do steps 1-4 before a raid night; 5-8 happen during it.

1. **Server.** Run `update-server.cmd`. For a first test on
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
