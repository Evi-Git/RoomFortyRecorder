# Bellhop

Room Forty's raid assistant (the repository and internal name are still RoomFortyRecorder).

The recording, review and live-view app for the **Room Forty** raid team.

It records every raid pull and Mythic+ run automatically, uploads them to the
guild's private cloud, and lets anyone on the team rewatch any pull from any
raider's point of view. The team's analyst can also watch raiders live with
under a second of delay.

It's built for one guild and is not a commercial product.

## For raiders

1. Download the latest installer:
   **https://github.com/Evi-Git/RoomFortyRecorder/releases/latest**
2. Install it, open **Cloud settings**, and **Sign in with Discord**. You must be
   in the Room Forty Discord with a raider role.
3. Play. Pulls are recorded, saved and uploaded on their own.

The app updates itself. When a new version is ready you'll see a prompt.
Nothing installs until you click it.

### What it does

- **Automatic recording:** raid encounters, Mythic+, with the combat log used
  to name, sort and mark each pull (kills, wipes, deaths).
- **Guild cloud:** every upload is available to the whole team, with every
  raider's POV of the same pull and synced switching between them.
- **Spell timeline:** under each raid pull, the boss's casts (cast bars,
  interrupts), adds' casts and your own casts. Click one to jump there.
- **Go live:** stream your POV to the team's analyst in 1080p. Turn it on
  from the sidebar; it stops by itself when WoW closes.
- **Watch live:** Raider+ and Officer can watch anyone who is live, inside
  the app, about half a second behind.
- **Chat, clips, drawing and shareable links** for reviewing pulls together.

## How it fits together

```
RoomFortyRecorder (each raider's PC)
  |-- uploads videos ------------------> Cloudflare R2 (video storage)
  |-- signs in, lists videos --------> Guild server (home PC, behind Caddy)
  |                                      Discord sign-in, metadata, chat,
  |                                      links, spell timelines
  |-- Go live (WebRTC) --------------> MediaMTX (home PC)
  '-- Watch live (WebRTC) <----------- MediaMTX (role checked by the guild server)

Watching a video: app -> Cloudflare Worker -> R2 (served from Cloudflare's edge)
```

| Folder | What's in it |
|---|---|
| `src/` | The desktop app (Electron, React, TypeScript) |
| `native/noobs/` | Our changes to the recording engine (adds live streaming) |
| `guild-cloud-server/` | The guild server (`server.mjs`) and the Cloudflare Worker that serves videos |
| `docs/` | Release process and server setup notes |

## For maintainers

- **Releasing a new version:** [docs/RELEASING.md](docs/RELEASING.md). In short:
  bump the version, run **Actions → Release**, test the draft, publish.
- **Upstream fixes:** the **Upstream sync** workflow checks the original Warcraft
  Recorder every Thursday and opens a pull request when there's something
  new. See [docs/RELEASING.md](docs/RELEASING.md).
- **Guild server:** see [docs/GuildCloudServer.md](docs/GuildCloudServer.md) and
  `guild-cloud-server/r2-worker/TESTING.md`. Secrets live only in the
  server's `.env`, never in this repository.

### Building locally (optional)

```
npm install
npm run package
```

The installer lands in `release/build`. Windows only.

## Credits and licence

RoomFortyRecorder is a fork of
[Warcraft Recorder](https://github.com/aza547/wow-recorder), the open-source
WoW recorder, and is distributed under the same licence, the
**GNU GPL v2** (see [LICENSE](LICENSE)). The guild cloud, Discord sign-in, live
streaming, spell timeline and release tooling are Room Forty's own additions.
