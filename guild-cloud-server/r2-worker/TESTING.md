# Testing the R2 download Worker in isolation

This lets you confirm range-request/scrubbing behavior through R2 works
before we change anything in `server.mjs` or touch the live app.

## 1. Install Wrangler and log in

```
npm install -g wrangler
wrangler login
```

## 2. Create the R2 bucket

```
wrangler r2 bucket create roomforty-videos
```

If you name it something other than `roomforty-videos`, update
`bucket_name` in `wrangler.toml` to match.

## 3. Upload one real test video

Pick any existing `.mp4` from `D:\GuildCloud\videos` and upload it as-is
(same filename, since the token will reference this exact key):

```
wrangler r2 object put roomforty-videos/YOUR-TEST-VIDEO.mp4 --file="D:\GuildCloud\videos\YOUR-TEST-VIDEO.mp4"
```

## 4. Set the shared secret

This must be the **exact same value** as `GUILD_CLOUD_SECRET` in your
server's `.env`:

```
wrangler secret put GUILD_CLOUD_SECRET
```

(paste the value when prompted -- it isn't saved to any file here)

Also double check `GUILD_CLOUD_GUILD` in `wrangler.toml` matches your
server's `.env` exactly.

## 5. Deploy the Worker

```
wrangler deploy
```

This prints your Worker's URL, something like:
`https://roomforty-r2-download.YOUR-SUBDOMAIN.workers.dev`

## 6. Mint a test token

```
node scripts/make-test-token.mjs "your-actual-secret" "Room Forty" YOUR-TEST-VIDEO.mp4
```

Copy the printed token.

## 7. Test basic playback (no range)

```
curl -v "https://roomforty-r2-download.YOUR-SUBDOMAIN.workers.dev/download/<token>" --output test-full.mp4
```

Should download the full file. Check that `test-full.mp4` plays and
matches the original.

## 8. Test range requests (the part that matters for scrubbing)

```
curl -v -H "Range: bytes=1000000-2000000" "https://roomforty-r2-download.YOUR-SUBDOMAIN.workers.dev/download/<token>" --output test-range.bin
```

Check the response:
- Status should be `206 Partial Content`
- `Content-Range` header should read `bytes 1000000-2000000/<total size>`
- `test-range.bin` should be exactly 1,000,001 bytes

## 9. The real test: actually scrub in a video player

Easiest way -- make a throwaway local HTML file:

```html
<video controls src="https://roomforty-r2-download.YOUR-SUBDOMAIN.workers.dev/download/<token>"></video>
```

Open it in a browser, let it load, and drag the scrub bar around
repeatedly, including jumping far ahead and far back. This is the actual
behavior that matters -- if this feels smooth and instant, range requests
are working correctly end to end through R2.

## 10. Test failure cases (should all fail cleanly)

- Wait for the token to expire (or edit `make-test-token.mjs` to set a
  1-minute expiry) and confirm you get a `403`
- Try a token with the wrong guild name and confirm `404`
- Try requesting a key that was never uploaded and confirm `404`

## Once this all checks out

This confirms the token verification and range-serving logic works
correctly against real R2 data. The next step is the `server.mjs` diff so
it actually issues R2-flavored upload/download tokens as part of the real
flow, instead of you hand-minting test tokens.
