// Test-only stand-in for Discord's member and roles endpoints, so the guild
// server's role checks can run without Discord. Never shipped.
//
// `node --import ./discord-stub.mjs server.mjs` with
// RF_HARNESS_DISCORD_FIXTURE=<json file>, read on every request so a test can
// change it while the server runs:
//   { "fail": false,
//     "roles": [{ "id": "1", "name": "Raider" }],
//     "members": { "<discordId>": ["1"] } }
// An id not in `members` is not in the guild (404); `fail` answers 500;
// `hang` never answers (the request ends when its AbortSignal fires, like a
// real fetch that times out).
import fs from 'node:fs';

export const installDiscordStub = (fixturePath) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== 'discord.com') return realFetch(input, init);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (fixture.hang) {
      return new Promise((resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // no timeout set: hangs for good, as Discord would
        const abort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (fixture.fail) return reply(500, { message: 'stub failure' });
    if (/\/guilds\/[^/]+\/roles$/.test(url.pathname)) return reply(200, fixture.roles ?? []);
    const member = /\/guilds\/[^/]+\/members\/([^/]+)$/.exec(url.pathname);
    if (member) {
      const roles = fixture.members?.[decodeURIComponent(member[1])];
      return roles ? reply(200, { roles }) : reply(404, { message: 'Unknown Member' });
    }
    return reply(404, { message: 'not stubbed' });
  };
};

if (process.env.RF_HARNESS_DISCORD_FIXTURE) installDiscordStub(process.env.RF_HARNESS_DISCORD_FIXTURE);
