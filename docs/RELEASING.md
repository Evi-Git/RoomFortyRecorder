# Releasing a new version

Installed copies of RoomFortyRecorder check this repository's GitHub
Releases for updates when they start, and every 24 hours after that. When
they find a newer **published** release, they download it in the background
and show an "update available" prompt. The update only installs when the
raider clicks that prompt. Draft releases are invisible to the app.

## Every release

1. **Bump the version.** Change `"version"` in `release/app/package.json`
   (not the root `package.json`) to the next number, e.g. `1.4.0` -> `1.4.1`.
   Use the GitHub web editor if you like: open the file, click the pencil,
   then "Commit changes".
2. **Add a changelog entry** at the top of `CHANGELOG.md`.
3. **Build it.** On GitHub, go to **Actions -> Release -> Run workflow**. It
   takes roughly 10-20 minutes. It creates a **draft** release called
   `v<version>` with the installer attached.
   - If the run fails at "Pre-flight checks", the error message says what
     to fix (usually the version wasn't bumped).
4. **Test the draft.** On the **Releases** page, open the draft and download
   `RoomFortyRecorder-Setup<version>.exe`. Install it over your current copy
   (don't uninstall first) and check sign-in, playback and one upload.
5. **Publish.** Edit the draft and click **Publish release**. Raiders get
   the prompt the next time their app starts, or within 24 hours.

Release Thursday-Sunday. A broken build that goes out Monday afternoon
lands right before raid.

## If a release is bad

Publish a new version with the fix (or the previous code) and a higher
version number. The updater never moves to a lower version, so you can't
"un-release" by deleting the bad one. Delete it anyway so nobody new
downloads it.

## Building on your own PC (optional, for debugging)

```
git clone https://github.com/Evi-Git/RoomFortyRecorder
cd RoomFortyRecorder
npm install
npm run package
```

The installer lands in `release\build`. Production builds point at
`https://roomfortyrecorder.com` automatically (see
`.erb/configs/webpack.config.base.ts`). Don't set the `WCR_CLOUD_*`
environment variables to empty values, because an empty value overrides
that default and breaks sign-in.

## Pulling in fixes from the original Warcraft Recorder

This app is based on [aza547/wow-recorder](https://github.com/aza547/wow-recorder).
When WoW or OBS changes break recording, or a new raid tier needs new boss
data, the fix usually lands there first.

The **Upstream sync** workflow checks for new upstream changes every Thursday
(or run it any time from **Actions -> Upstream sync -> Run workflow**):

- **It opens a pull request** called "Merge upstream Warcraft Recorder" when
  the changes merge cleanly. The version number and changelog are sorted out
  automatically. Skim the list of changes, click **Merge pull request**, then
  do a normal release (above), noting "Merged Warcraft Recorder x.y.z" in the
  changelog.
- **It opens an issue** when upstream changed the same lines this fork
  changed (usually cloud sign-in or upload code). Nothing is changed. Attach
  this repo to a Claude session and ask it to merge upstream; it's the same
  job as the first merge in October 2026.
- It does nothing if upstream hasn't changed.

To merge by hand instead:

```
git remote add upstream https://github.com/aza547/wow-recorder
git fetch upstream
git merge upstream/main
```

### Why this works

RoomFortyRecorder was originally a plain copy of Warcraft Recorder, with no
shared git history, so git couldn't merge between them. The commit "Link
history to upstream Warcraft Recorder" records the upstream commit it was
copied from (`0566da1`, 3 Sep 2026), so merges only bring in newer changes.
Don't squash or rebase that commit away.

## Licence

The app is GPL v2 (see `LICENSE`), inherited from Warcraft Recorder. Keep
the licence file and the original copyright notices, and keep this
repository public. Publishing the source here is how you meet the GPL's
source requirement.
