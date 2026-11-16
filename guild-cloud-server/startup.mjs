// [RoomFortyRecorder] Small safety checks for the guild server's start-up
// and for the few places it streams a file to a response.
import fs from 'node:fs';

// What .env.example ships with: copied as is, it's as public as the repo.
const PLACEHOLDERS = new Set([
  'replace-with-a-long-random-value',
  'changeme',
  'change-me',
  'secret',
]);

// Shorter than this is allowed (changing the secret signs everyone out and
// has to be changed on the R2 Worker too), but the server says so at start.
export const SHORT_SECRET = 32;

/**
 * Why GUILD_CLOUD_SECRET can't be used to sign sessions and video links, or
 * null when it can. `guessable` lists values anyone could work out (the old
 * fallback was "<guild>:<Discord client ID>").
 */
export const secretProblem = (value, guessable = []) => {
  const secret = String(value ?? '').trim();
  if (!secret) return 'GUILD_CLOUD_SECRET is not set';
  if (PLACEHOLDERS.has(secret.toLowerCase())) {
    return 'GUILD_CLOUD_SECRET is still the example value';
  }
  if (guessable.some((g) => g && secret === g)) {
    return 'GUILD_CLOUD_SECRET can be guessed from public values';
  }
  return null;
};

/** A one-line warning for a secret that works but is short, else null. */
export const secretWarning = (value) => {
  const secret = String(value ?? '').trim();
  if (secret && secret.length < SHORT_SECRET) {
    return `GUILD_CLOUD_SECRET is short (${secret.length} characters). Use ${SHORT_SECRET} or more random characters when you next rotate it.`;
  }
  return null;
};

/**
 * Stream a file to a response. A read error (file deleted or locked mid-way)
 * ends that one response; without the listener Node treats it as an uncaught
 * exception and the whole server stops.
 */
export const sendFile = (file, res, log = console.error) => {
  const stream = fs.createReadStream(file);
  stream.on('error', (error) => {
    log('[guild-cloud] Could not send a file', file, error?.message || error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Could not read the file');
    } else {
      res.destroy();
    }
  });
  // The raider closed the app or the page mid-download: stop reading.
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return stream;
};

/**
 * Keep the server up when a promise fails with nobody waiting on it (a
 * background save, a crawl step). Node's default is to stop the process,
 * which takes uploads and Watch live down with it mid-raid.
 */
export const logUnhandledRejections = (proc = process, log = console.error) => {
  proc.on('unhandledRejection', (reason) => {
    log('[guild-cloud] A background task failed (the server keeps running)', reason);
  });
};
