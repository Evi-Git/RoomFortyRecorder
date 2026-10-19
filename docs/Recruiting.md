# Recruiting

An officer-only page on the guild server, `https://<your domain>/recruit`,
that ranks every DPS raider (or chosen specs) from guilds in a world-rank
range. Use the **Spec** dropdown to rank one spec against itself, or leave it
on **All specs** to rank everyone together (parse is already a percentile
within each spec, so that's fair). It
does the log review the way you'd do it by hand:

1. **Guilds:** Raider.IO's Mythic rankings for the current raid, filtered to
   your region and world-rank range (default US, 200-600).
2. **Pulls:** for each guild, their Warcraft Logs reports, keeping only
   **progression pulls up to and including the first kill** of each tracked
   boss. Farm kills after that are ignored.
3. **Per raider, per boss:**
   - **Early deaths:** in each pull, the first N deaths (default 2) count.
     Deaths to excused abilities (Venom Rupture on Coiled Altar) and deaths
     after the raid leader called the wipe don't count and don't use up N.
   - **Mechanics**, compared with that raider's own raid:
     - *Venom orbs* (Coiled Altar): Volatile / Mutagenic Venom landing on them.
     - *Wail of Terror kicks* (Coiled Altar): successful interrupts only.
       Missed casts never count against anyone.
     - *Eggs before 2:30* (Ula'tek): Noxious Shell picked up in the first
       2:30 of a pull. Picking one up in at least half the pulls marks them as
       on the **assigned** soak team; free-for-all eggs later in the pull are
       ignored.
   - **Parse:** their median (or best) DPS percentile on those bosses for
     their spec.
4. **Score:** within each spec group, parse, early-death rate and mechanics
   are compared with everyone else in the group and combined with the
   weights on the page (default 50 / 30 / 20). The score is a 0-100 rank
   within the group, with short reasons ("dies early far less than the
   group", "on assigned mechanics: Eggs before 2:30").

**Your own guild** (`GUILD_CLOUD_GUILD`, Room Forty) is found in Raider.IO's
rankings above the range and crawled the same way, with every raider kept
(tanks and healers too). It gets its own tab, a yardstick line on the DPS tab
("Room Forty DPS: median parse 87 · early deaths 0.05 per pull · 9 on
assigned mechanics", following the Spec filter), and **Compare with Room
Forty** ranks your raiders alongside the candidates, tagged R40. If it isn't
found, set its realm under Settings -> "Its realm".

Click a row for the per-boss breakdown, what killed them, and links to their
logs, Warcraft Logs character page and Raider.IO.

## Setup (one time)

1. **Warcraft Logs API client.** Sign in to warcraftlogs.com with the account
   that has the subscription (its hourly API points apply), then
   **Settings -> API Clients -> Create Client**. Any name; redirect URL
   `https://roomfortyrecorder.com`. Leave "Public client" unticked.
2. Add the Client ID and Secret to the server's `.env`:

   ```
   GUILD_CLOUD_WCL_CLIENT_ID=...
   GUILD_CLOUD_WCL_CLIENT_SECRET=...
   ```

3. Run `update-server.cmd` (it installs the recruiting files and restarts
   the server). If you edited `.env` after updating, restart the Node task.
4. Open `https://roomfortyrecorder.com/recruit` and sign in with Discord.
   Only the roles in `GUILD_CLOUD_RECRUIT_ROLES` (default **Officer**) get in.
5. Click **Test with 1 guild**. It takes a minute or two; the crawl log at the
   bottom of the page shows what happened. Then **Run crawl** for the full
   range.

## Running it

- **First full crawl:** roughly one to two hours for ~60 guilds. It never uses
  more than 85% of your hourly Warcraft Logs points; if it gets there it
  pauses until the hour resets. The page shows points used.
- **Later crawls:** only new reports are fetched (old ones are cached in
  `<storage>\recruit\`), so they take minutes.
- **Daily crawl:** Settings -> "Daily crawl hour" (server's local time), or
  -1 to only crawl when you press the button.
- **Weights, minimum pulls, parse kind, guild rank filter and search** apply
  instantly and are remembered in your browser.
- **Spec groups** default to `[{ "label": "DPS", "role": "dps" }]`. A group
  can be a role (`dps`, `healer`, `tank`) or a class with specs, e.g.
  `{ "label": "Arms Warrior", "className": "Warrior", "specs": ["Arms"] }`;
  each group gets a tab.
- **Settings** (rank range, region, spec groups, bosses, excused deaths,
  mechanics, death cutoff) apply on the next crawl. Bosses and mechanics are
  edited as JSON; each mechanic is either `"kind": "debuff"` (counts the
  debuff landing on a player) or `"kind": "interrupt"` (counts interrupts of
  that cast), with optional `beforeSeconds` and `assignedShare`.

## Limits

- Guilds that log privately are invisible, just like on the website.
- Parses only exist for kills; someone with few kills on that spec has few.
- Mechanics are compared within each raider's own raid, because assignments
  differ between guilds.
- If a guild's name or realm on Warcraft Logs doesn't match Raider.IO, it's
  skipped with a note in the crawl log.
