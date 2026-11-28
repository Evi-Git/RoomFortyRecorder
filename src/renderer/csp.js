/**
 * [RoomFortyRecorder] The renderer's Content-Security-Policy, in one place:
 * index.ejs gets it through HtmlWebpackPlugin (.erb/configs), the browser
 * test harness (tools/harness) reads the same function, and a Jest test
 * pins it. Plain CommonJS so webpack, the harness and Jest can all load it.
 *
 * What each directive allows, and why (inventory of what the renderer loads):
 *
 *  default-src 'self'      Everything not listed below: only the app's own
 *                          files (file:// when packaged; 'self' covers it).
 *  script-src 'self'       Only the bundled scripts. No 'unsafe-eval', no
 *                          'unsafe-inline'. (Excalidraw's font-subsetting
 *                          wasm would need 'wasm-unsafe-eval'; the drawing
 *                          overlay doesn't export, and today's policy blocks
 *                          it too, so it stays off.)
 *  style-src 'self' 'unsafe-inline'
 *                          MUI/emotion and Excalidraw inject <style> tags and
 *                          style attributes at run time. Inline styles can't
 *                          run code.
 *  img-src 'self' data: blob: https: rficon: vod:
 *                          Bundled PNGs (asset/resource, so 'self'); spell
 *                          icons as data: URLs from the `iconImage` IPC;
 *                          `rficon://` (main-process icon cache); icon CDNs
 *                          (wow.zamimg.com, render.worldofwarcraft.com,
 *                          assets.rpglogs.com) and the guild server over
 *                          https; blob: for canvas/export images; Discord
 *                          avatars (cdn.discordapp.com) over https.
 *  media-src 'self' blob: data: https: vod:
 *                          Local recordings play from `vod://wcr/...`
 *                          (custom scheme, registered with bypassCSP in
 *                          main.ts, listed anyway so it reads honestly);
 *                          cloud videos are signed https URLs (R2 / guild
 *                          server); the three alert sounds are bundled mp3s
 *                          ('self'); the Live page's <video> uses a
 *                          MediaStream (srcObject), which CSP doesn't gate.
 *  font-src 'self' data: blob: https:
 *                          Inter / Source Serif woff2 files (assets/fonts,
 *                          'self'); Excalidraw loads its drawing fonts
 *                          through FontFace from its own package or a CDN.
 *  connect-src 'self' https: wss: blob: data: vod: rficon:
 *                          The renderer talks to the main process over IPC
 *                          (not gated), but libraries fetch: Excalidraw
 *                          (fonts, blob/data images), react-player. https:
 *                          because the guild server is a user-set origin.
 *                          wss: for any websocket to that server.
 *                          WebRTC (the Live page) is not gated by
 *                          connect-src: the WHEP POST goes through main.
 *  worker-src 'self' blob: Excalidraw's font-subset worker.
 *  object-src 'none'       No plugins.
 *  base-uri 'none'         No <base> tag tricks.
 *  form-action 'none'      Nothing in the app submits a real form.
 *
 * Not set: frame-ancestors (ignored in a <meta> policy) and frame-src (falls
 * back to default-src 'self': the app embeds nothing, Excalidraw's embeds
 * are off).
 *
 * Development (webpack-dev-server on http://localhost:<port>) also needs the
 * HMR websocket and, for React Refresh, 'unsafe-eval'. The packaged build
 * never gets either.
 */
const contentSecurityPolicy = ({ development = false } = {}) => {
  const directives = {
    'default-src': ["'self'"],
    'script-src': development ? ["'self'", "'unsafe-eval'"] : ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', 'rficon:', 'vod:'],
    'media-src': ["'self'", 'blob:', 'data:', 'https:', 'vod:'],
    'font-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': [
      "'self'",
      'https:',
      'wss:',
      'blob:',
      'data:',
      'vod:',
      'rficon:',
      ...(development ? ['http://localhost:*', 'ws://localhost:*'] : []),
    ],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
};

// eslint-disable-next-line no-undef -- plain CommonJS so webpack, the harness and Jest can all load it
module.exports = { contentSecurityPolicy };
