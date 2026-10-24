import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The updater installs only what server-files.txt lists, so a module the
// server imports but the list misses breaks the server on update.
test('server-files.txt lists every module the server imports', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const listed = new Set(
    fs
      .readFileSync(path.join(dir, 'server-files.txt'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(listed.has(file), `${file} is imported but not in server-files.txt`);
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([^'"]+)['"]/g)) visit(m[1]);
  };
  visit('server.mjs');
  assert.ok(seen.has('icon-pack.mjs'));
});
