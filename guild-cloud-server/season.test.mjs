import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createSeason, seasonBosses } from './season.mjs';

test('season bosses: zone order, then other pulled bosses newest first', () => {
  const bosses = seasonBosses(
    [
      { id: 3129, name: 'Coiled Altar' },
      { id: 3130, name: "Ula'tek" },
    ],
    [
      { encounterId: 3130, encounterName: "Ula'tek", createdAt: 5 },
      { encounterId: 2900, encounterName: 'Old Boss', createdAt: 1 },
      { encounterId: 3300, encounterName: "Kith'ix", createdAt: 9 },
      { encounterId: 2900, encounterName: 'Old Boss', createdAt: 2 },
    ],
  );
  assert.deepEqual(
    bosses.map((b) => [b.encounterId, b.name, b.inZone]),
    [
      [3129, 'Coiled Altar', true],
      [3130, "Ula'tek", true],
      [3300, "Kith'ix", false],
      [2900, 'Old Boss', false],
    ],
  );
  assert.deepEqual(
    seasonBosses(null, [{ encounterId: 7, encounterName: 'Seven' }]).map((b) => b.encounterId),
    [7],
  );
});

test('season zone: fetched from Warcraft Logs once, then read from disk', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'season-'));
  let queries = 0;
  const wcl = {
    configured: true,
    query: async () => {
      queries += 1;
      return {
        worldData: {
          zones: [
            { id: 40, name: 'The Venomous Abyss', encounters: [{ id: 1, name: 'Old' }] },
            { id: 53, name: 'The Venomous Abyss', encounters: [{ id: 3129, name: 'Coiled Altar' }] },
            { id: 54, name: 'Something Else', encounters: [] },
          ],
        },
      };
    },
  };
  const season = createSeason({ storage, env: {}, wcl });
  const zone = await season.zone();
  assert.equal(zone.id, 53);
  assert.deepEqual(zone.encounters, [{ id: 3129, name: 'Coiled Altar' }]);
  await season.zone();
  assert.equal(queries, 1);

  // A restarted server reads it back without asking again.
  const again = createSeason({ storage, env: {}, wcl });
  assert.equal((await again.zone()).id, 53);
  assert.equal(queries, 1);

  // Without Warcraft Logs set up: null, so pulls fill in.
  const empty = await fsp.mkdtemp(path.join(os.tmpdir(), 'season-'));
  assert.equal(await createSeason({ storage: empty, env: {}, wcl: { configured: false } }).zone(), null);
});
