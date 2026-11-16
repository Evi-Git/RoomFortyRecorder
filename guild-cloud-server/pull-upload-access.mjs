// Who may upload a pull's logs, and a streaming check of a full log.
import zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

// A full log may be 150 MB gzipped (MAX_FULL_BYTES in pulldesk.mjs) and
// combat logs compress roughly 10-20x, so a real one is at most about 3 GB
// of text. Anything that expands past that is a gzip bomb, not a pull.
export const MAX_FULL_TEXT_BYTES = 3 * 1024 ** 3;

// A line longer than this is not a combat log line: skip it rather than
// hold it all in memory.
const MAX_LINE_CHARS = 1024 * 1024;

// The raider this server asked to send the pull: the one it picked live
// (claim) or the one that asked to backfill it. Nobody else, whatever their role.
export const mayUploadFor = (pull, who) => {
  const id = typeof who === 'string' ? who : '';
  if (!pull || !id) return false;
  return (typeof pull.chosen === 'string' && pull.chosen === id) || (typeof pull.backfillBy === 'string' && pull.backfillBy === id);
};

// Gunzips a full log as a stream (never all in memory) and reads what the
// server needs from it: buff ids (friendly casters on players), spec ids
// (COMBATANT_INFO), the encounter ids of its ENCOUNTER_START lines, and how
// many bytes of text it holds. Rejects with status 413 past maxOutputBytes,
// and with status 400 when it does not gunzip.
export const scanFullLog = (gz, { maxOutputBytes = MAX_FULL_TEXT_BYTES } = {}) =>
  new Promise((resolve, reject) => {
    const buffs = new Set();
    const specs = new Set();
    const encounterIds = new Set();
    let textBytes = 0;
    let rest = '';
    const decoder = new StringDecoder('utf8');
    const take = (line) => {
      const at = line.indexOf('  ');
      if (at < 0) return;
      const body = line.slice(at + 2);
      if (body.startsWith('SPELL_AURA_APPLIED,')) {
        const f = body.split(',', 14);
        // src flags: friendly (0x10); dst a player; a buff.
        if (!(Number(f[3]) & 0x10) || !f[5]?.startsWith('Player-')) return;
        if (!/,BUFF(,|$)/.test(body)) return;
        const id = Number(f[9]);
        if (id > 1) buffs.add(id);
      } else if (body.startsWith('COMBATANT_INFO,')) {
        const spec = Number(body.split(',', 26)[25]);
        if (spec > 0) specs.add(spec);
      } else if (body.startsWith('ENCOUNTER_START,')) {
        const id = Number(body.split(',', 3)[1]);
        if (Number.isInteger(id)) encounterIds.add(id);
      }
    };
    let done = false;
    const stream = zlib.createGunzip();
    const finish = (error, value) => {
      if (done) return;
      done = true;
      if (error) {
        stream.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    stream.on('data', (chunk) => {
      if (done) return;
      textBytes += chunk.length;
      if (textBytes > maxOutputBytes) {
        finish(Object.assign(new Error('Log expands to too much text'), { status: 413 }));
        return;
      }
      const lines = (rest + decoder.write(chunk)).split('\n');
      rest = lines.pop() ?? '';
      if (rest.length > MAX_LINE_CHARS) rest = '';
      lines.forEach((l) => take(l.endsWith('\r') ? l.slice(0, -1) : l));
    });
    stream.on('end', () => {
      rest += decoder.end();
      if (rest) take(rest.endsWith('\r') ? rest.slice(0, -1) : rest);
      finish(null, { buffs, specs, encounterIds, textBytes });
    });
    stream.on('error', (error) => finish(Object.assign(error, { status: 400 })));
    stream.end(gz);
  });
