// Mints a single test download token, using the exact same format as
// server.mjs's encodeToken(). Use this to test the Worker end-to-end before
// touching server.mjs's upload/download logic at all.
//
// Usage:
//   node make-test-token.mjs <GUILD_CLOUD_SECRET> <GUILD_CLOUD_GUILD> <video-key.mp4>
//
// Example:
//   node make-test-token.mjs "my-long-random-secret" "Room Forty" test-video.mp4

import crypto from 'node:crypto';

const [secret, guild, key] = process.argv.slice(2);

if (!secret || !guild || !key) {
  console.error(
    'Usage: node make-test-token.mjs <GUILD_CLOUD_SECRET> <GUILD_CLOUD_GUILD> <video-key.mp4>',
  );
  process.exit(1);
}

const payload = {
  action: 'download',
  guild,
  key,
  exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
};

const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
const token = `${body}.${signature}`;

console.log('\nToken:');
console.log(token);
console.log('\nFull test URL (replace with your deployed Worker URL):');
console.log(`https://roomforty-r2-download.<your-subdomain>.workers.dev/download/${token}`);
console.log('');
