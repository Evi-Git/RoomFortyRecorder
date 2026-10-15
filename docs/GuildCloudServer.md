# RoomFortyRecorder private guild cloud

> **Out of date (October 2026).** Videos no longer live on the Windows
> server. They are stored in Cloudflare R2 and played back through the
> Cloudflare Worker in `guild-cloud-server/r2-worker/`. The home server only
> handles Discord sign-in, metadata, chat, admin and share links. See
> `guild-cloud-server/r2-worker/TESTING.md` for the Worker, and
> `docs/RELEASING.md` for shipping new app versions. The Caddy, Task
> Scheduler and Discord sections below are still accurate.

This is the **one-time host setup** for the guild member who owns the Windows
server. Once it is done, a normal raider only needs to:

1. Install the RoomFortyRecorder `.exe`.
2. Open Cloud settings.
3. Click **Sign in with Discord** and authorize with the Room Forty Discord server.

No raider needs Tailscale, Node.js, Caddy, the repository, or router access.

```text
RoomFortyRecorder PC -- HTTPS --> roomfortyrecorder.com -- Caddy --> Node server --> D:\GuildCloud
```

The local Windows machine still stores the videos. Caddy is only the secure
HTTPS front door. There is no hosted video-storage subscription.

## What the cloud login is

The app uses Discord OAuth. The server sends the user to Discord, verifies that
they belong to the configured Room Forty Discord server and have an allowed
role, then returns a 30-day cloud session to the app. Discord client secrets stay only in the server's
private `.env` file; they are never included in the installer.

The guild is fixed by `GUILD_CLOUD_GUILD` and is not selected in the app.
`GUILD_CLOUD_SECRET` signs video URLs and app sessions; it is only for the
server.

## Capacity

A wired, genuinely symmetric 1 Gb/s connection should handle 20 guild members
uploading and watching videos at the same time:

- 1 Gb/s is roughly 125 MB/s in each direction.
- Twenty 20-Mb/s streams consume about 400 Mb/s.
- The server streams files from the SSD and supports HTTP range requests for
  seeking/scrubbing.
- The practical limits are the ISP's real upload speed, SSD throughput, and
  the 1.8 TB quota—not the number 20 itself.

The host should be wired to the router. Test the connection from the host, and
keep old recordings unprotected or add a retention policy so the disk does not
fill.

## Before starting: hostname and public IP

Production builds use this stable HTTPS hostname:

```text
roomfortyrecorder.com
```

Point its DNS `A` record at the home's public IPv4 address. If the address
changes, enable the router's dynamic-DNS updater or use the DNS provider's
updater. A custom hostname also works, but it must be configured in both the
server and client build as described below.

If the router's WAN address is private or does not match the address shown by a
public “what is my IP” site, the connection is behind CGNAT and port forwarding
will not work. The ISP must provide a public IPv4 address, or we need a VPS or
a chunked-upload tunnel instead.

If Cloudflare manages the DNS, use **DNS only** (the grey cloud), not the orange
proxy. The free Cloudflare HTTP proxy has a 100 MB request-body limit, while
RoomFortyRecorder uploads whole video files. Caddy will provide HTTPS directly.

## 1. Prepare the Windows machine

### Install the prerequisites

Install these using their normal Windows installers:

- Node.js LTS from [nodejs.org](https://nodejs.org/).
- Caddy for Windows from [caddyserver.com/download](https://caddyserver.com/download).
- A 2 TB SSD formatted as NTFS.

Use a wired network connection and set Windows power settings to never sleep
while plugged in. Give the SSD a stable drive letter, such as `D:`.

### Create the folders

In File Explorer, create:

```text
C:\RoomFortyRecorder\guild-cloud-server
C:\RoomFortyRecorder\caddy
D:\GuildCloud
```

Copy `server.mjs` and `.env.example` from this repository into
`C:\RoomFortyRecorder\guild-cloud-server`.

Put `caddy.exe` in `C:\RoomFortyRecorder\caddy`.

## 2. Create the server `.env`

Windows may hide file extensions. In File Explorer, enable **View → Show → File
name extensions**. Then right-click `.env.example`, choose **Rename**, and
rename it to exactly:

```text
.env
```

Open `.env` in Notepad. The copied `.env.example` is the authoritative list of
variables and defaults. Replace each `replace-with-...` placeholder, and keep
the other defaults unless this deployment uses a custom hostname, storage
path, or quota.

Keep the Discord client secret and signing secret out of Git and private chats.

In the Discord Developer Portal, create an application, copy its client ID and
secret into `.env`, create a bot user, and copy the bot token into
`GUILD_CLOUD_DISCORD_BOT_TOKEN`. Invite that bot to Room Forty with permission
to read members and roles. Add the exact `GUILD_CLOUD_DISCORD_REDIRECT_URI` as
an OAuth2 redirect URI. Enable Developer Mode in Discord, right-click the Room
Forty server, choose **Copy Server ID**, and use that value for
`GUILD_CLOUD_DISCORD_GUILD_ID`. The app requests only the `identify` scope. The bot checks the member's roles
through Discord's server API. The comma-separated allowed role names are case-
insensitive; a user must have at least one of them to sign in. Keep the bot
token private and ensure the bot is in the Room Forty server with permission to
read members and roles.

## 3. Configure the router

Give the Windows machine a reserved local IP in the router's DHCP settings.
Then create only these port forwards:

| Protocol | Public port | Destination  | Purpose                                        |
| -------- | ----------: | ------------ | ---------------------------------------------- |
| TCP      |          80 | Windows host | Caddy certificate validation and HTTP redirect |
| TCP      |         443 | Windows host | HTTPS video/API traffic                        |

Do **not** forward port `8787`. The Node server is configured to listen only on
`127.0.0.1`, so it is reachable by Caddy on the same machine but not directly
from the internet or LAN.

## 4. Configure Caddy

Open Notepad and create this file:

```text
C:\RoomFortyRecorder\caddy\Caddyfile
```

Its contents should be:

```caddyfile
roomfortyrecorder.com {
    reverse_proxy 127.0.0.1:8787
}
```

Replace `roomfortyrecorder.com` with the real hostname if using a custom domain.
Caddy automatically obtains and renews the HTTPS certificate once DNS points
to the home's public IP and ports 80/443 reach the machine.

## 5. Start and test the server

For the first test, open `C:\RoomFortyRecorder\guild-cloud-server` in File
Explorer, right-click an empty area, choose **Open in Terminal**, and run:

```text
node server.mjs
```

Leave that window open. On the Windows machine, open a browser and visit:

```text
http://127.0.0.1:8787/health
```

It should display:

```text
{"ok":true}
```

If that works, start Caddy from its folder in another terminal:

```text
caddy.exe run --config Caddyfile
```

From a phone using mobile data, or another network outside the house, visit:

```text
https://roomfortyrecorder.com/health
```

It should display the same `{"ok":true}` response with a valid HTTPS
certificate. Testing from outside the house avoids routers that do not support
accessing their own public address from inside the LAN.

## 6. Start both programs automatically

Use the Windows GUI rather than installing another service wrapper.

Open **Task Scheduler → Create Task**. Create one task for Node and one for
Caddy. For each task:

- **General:** choose “Run whether user is logged on or not” and “Run with
  highest privileges”.
- **Triggers:** choose “At startup”; add a one-minute delay.
- **Conditions:** remove any requirement for AC power if this is a desktop.
- **Settings:** enable restart on failure.

### Node task action

- **Name:** `RoomFortyRecorder Guild Cloud`
- **Program:** `C:\Program Files\nodejs\node.exe`
- **Arguments:** `C:\RoomFortyRecorder\guild-cloud-server\server.mjs`
- **Start in:** `C:\RoomFortyRecorder\guild-cloud-server`

### Caddy task action

- **Name:** `RoomFortyRecorder Caddy`
- **Program:** `C:\RoomFortyRecorder\caddy\caddy.exe`
- **Arguments:** `run --config C:\RoomFortyRecorder\caddy\Caddyfile`
- **Start in:** `C:\RoomFortyRecorder\caddy`

Run the Node task first, then the Caddy task. Revisit
`http://127.0.0.1:8787/health` locally and
`https://roomfortyrecorder.com/health` from outside the house after a reboot.

## 7. Build the client

The endpoints are compiled into the installer. Production builds default to
`https://roomfortyrecorder.com`, while local development defaults to
`http://127.0.0.1:8787`. This is done once by the person building
RoomFortyRecorder; raiders do not do it.

From the repository's WSL/Linux build shell:

```bash
npm run package
```

For a custom hostname, override both compiled endpoints:

```bash
WCR_CLOUD_API_URL='https://cloud.example.com/api' \
WCR_CLOUD_WEBSITE_URL='https://cloud.example.com' \
npm run package
```

Do not use `localhost`, a private LAN address, or a Tailscale address in a
distributed build.

## 8. Normal raider setup

Each raider only needs:

1. The current RoomFortyRecorder installer.
2. An internet connection.

In **Settings → Cloud**:

1. Enable cloud playback.
2. Click **Sign in with Discord**.
3. Authorize the Room Forty Discord server in the browser.
4. Enable cloud upload, Retail uploads, and the Raid/Mythic+ filters wanted by
   the guild.

A successful Discord sign-in confirms that the server login works. No Tailscale
installation or invitation is required.

## Share links and likes

The player’s link button is enabled for cloud videos and clips. It copies a
stable public URL such as `https://roomfortyrecorder.com/link/<id>` to the
clipboard; the link remains valid while the recording remains in cloud storage.
Both link types stream the shared recording. Full-video pages accept anonymous
likes, limited to one per browser profile by browser-local storage. Clip pages
do not offer likes. Full-video like counts are stored in `state.json`.

## Backups and maintenance

- `D:\GuildCloud\videos` contains the MP4 recordings.
- `D:\GuildCloud\state.json` contains metadata, chat, and share-link state.
- Back up both locations to a second disk or off-site storage. Tailscale and
  Caddy are not backups.
- Before replacing `server.mjs`, stop the Node task, preserve `.env` and
  `D:\GuildCloud`, replace only the code file, then start Node and Caddy again.
- Keep port `8787` closed in the router and keep the `.env` file private.

## Troubleshooting

| Symptom                                   | Check                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Local `/health` fails                     | Node is not running, `.env` is misnamed, or the Node task uses the wrong **Start in** directory.                           |
| Public `/health` fails                    | Check DNS, the router's 80/443 forwards, the public IP, Caddy, and possible CGNAT.                                         |
| Browser shows a certificate error         | DNS does not point to the host, or Caddy cannot reach ports 80/443 to obtain the certificate.                              |
| App reports `401`                         | Sign in again with a Discord account that belongs to the configured Room Forty server.                                     |
| Discord sign-in fails                     | Check the Discord client ID, client secret, server ID, bot token, allowed roles, and exact OAuth redirect URI in `.env`.   |
| Upload or playback has a signed-URL error | `GUILD_CLOUD_PUBLIC_URL` must be the same reachable HTTPS hostname used by the installer.                                  |
| Large uploads fail                        | Make sure Cloudflare DNS is grey-cloud/DNS-only; do not put the free Cloudflare HTTP proxy in front of whole-file uploads. |
| Works until reboot                        | Check both Task Scheduler tasks, their program paths, arguments, working directories, and last-run results.                |

This is a private guild service restricted to Room Forty Discord members. It
is not intended to be an internet-facing multi-tenant service or a replacement
for a real backup system.
