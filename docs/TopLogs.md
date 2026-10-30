# Top logs and Time trial

**Analysis → Top logs** shows Warcraft Logs' top 25 kills per boss, difficulty (Heroic, Mythic) and spec, with each player's main cooldowns on the fight clock. **Race me** on a row opens a Time trial against any raider's pull.

## Setup (guild server)
- Uses the same Warcraft Logs API client as the recruiting page (`GUILD_CLOUD_WCL_CLIENT_ID` / `_SECRET`), and spends at most 85% of its hourly points.
- The raid comes from `GUILD_CLOUD_RAID_ZONE` (Warcraft Logs' name for it, default The Venomous Abyss). Change it each tier.
- Optional: `GUILD_CLOUD_TOPLOGS_DIFFICULTIES` (mythic,heroic), `GUILD_CLOUD_TOPLOGS_REGIONS` (world; add US,EU for region tabs), `GUILD_CLOUD_TOPLOGS_HOUR` (5, server time), `GUILD_CLOUD_TOPLOGS=off`.

## What's fetched, and when
- **Rankings:** once a day, every boss × difficulty × spec × region (about 800 small queries for 10 bosses and 2 difficulties). A spec that hasn't been crawled yet is fetched when someone opens it.
- **Casts:** a top player's casts in their kill are fetched the first time someone opens that spec (rank order, a few seconds each). The page fills in as they arrive.
- **Damage or healing second by second:** fetched on Race me.
- Reports don't change, so casts and tracks are kept for good under `<storage>/toplogs/tracks/`. Rankings are in `<storage>/toplogs/rankings.json`.

## Main cooldowns
Worked out from the top players' casts: an ability counts when at least 60% of them press it and the median gap between presses is 45 s or more (once in a fight counts as the whole fight). Up to 12, most used first. The shortest gap anyone left is shown as the estimated cooldown.

## Time trial
- **You:** any of our pulls with a full log on that boss and difficulty (kills first), and any raider in it. The raider you pick is remembered on your PC; otherwise someone of the same spec is picked.
- Our side is counted with the Logs page's rules; theirs is Warcraft Logs' damage done (hits plus absorbed) or healing (heals and absorbs, without overheal) for the player and their pets.
- Later: the ghost card and lanes on your VoD, and boss pace by phase.
