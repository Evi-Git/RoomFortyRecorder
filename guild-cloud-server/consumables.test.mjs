import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePull } from './pulldesk-analyze.mjs';
import { buildPrep, classifyAura, consumablesOf } from './consumables.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = () => {
  const lines = fs
    .readFileSync(
      path.join(here, '../tests/logs/retail/beloren_boss_hp.txt'),
      'utf8',
    )
    .split('\n');
  const s = lines.findIndex((l) => l.includes('  ENCOUNTER_START,'));
  const e = lines.findIndex((l, i) => i > s && l.includes('  ENCOUNTER_END,'));
  return lines.slice(s, e + 1).join('\n');
};

// What Wowhead's tooltips say for these (checked by hand).
const TOOLTIPS = {
  1233724: {
    name: 'Hearty Well Fed',
    text: 'If you spend at least 10 seconds eating, you will become Well Fed and gain 98 Stamina for 1 hour.',
  },
  1235111: {
    name: 'Flask of the Shattered Sun',
    text: 'Increases your Critical Strike by 105 for 1 hour. Lasts 1 hour and through death.',
  },
  1276669: {
    name: "Vantus Rune: Belo'ren, Child of Al'ar",
    text: 'Increases Versatility by 259.',
  },
  1264426: {
    name: 'Void-Touched',
    text: 'Increases Primary Stat by 25 for 1 hour. Augment Rune.',
  },
  1269410: {
    name: 'Might of the Sunwell Offensive',
    text: 'Increasing your damage and healing done.',
  },
};

test('classifies auras from their name and tooltip', () => {
  assert.equal(classifyAura(TOOLTIPS[1233724]), 'food');
  assert.equal(classifyAura(TOOLTIPS[1235111]), 'flask');
  assert.equal(classifyAura(TOOLTIPS[1276669]), 'vantus');
  assert.equal(classifyAura(TOOLTIPS[1264426]), 'augment');
  assert.equal(
    classifyAura({ name: 'Ethereal Augmentation', text: '' }),
    'augment',
  );
  assert.equal(classifyAura({ name: 'Well Fed', text: '' }), 'food');
  assert.equal(classifyAura(TOOLTIPS[1269410]), null);
  assert.equal(
    classifyAura(
      { name: "Light's Potential", text: '' },
      new Set(['lightspotential']),
    ),
    'potion',
  );
});

test('a pull: raid buffs with providers, consumables and gear per raider', () => {
  const report = analyzePull(log(), { combatPotions: ["Light's Potential"] });
  assert.equal(report.prepRaw.players.length, 20);
  const infoOf = (id) =>
    TOOLTIPS[id] ||
    (report.prepRaw.auraNames[id]
      ? { name: report.prepRaw.auraNames[id], text: '' }
      : null);
  const prep = buildPrep(report, infoOf, ["Light's Potential"]);
  const int = prep.raidBuffs.find((b) => b.key === 'int');
  assert.equal(int.have, 20);
  assert.ok(int.providers.length >= 1);
  const odonkey = prep.players.find((p) => p.name === 'Odonkey');
  assert.equal(odonkey.food, 'Hearty Well Fed');
  assert.equal(odonkey.vantus, "Vantus Rune: Belo'ren, Child of Al'ar");
  assert.equal(odonkey.augment, 'Ethereal Augmentation');
  assert.equal(odonkey.weaponOil, true);
  assert.deepEqual(
    odonkey.enchants.map((e) => e.ok),
    [true, true, true, true, true, true, true, true],
  );
  assert.equal(odonkey.gems.find((g) => g.slot === 'Neck').count, 1);
  assert.equal(odonkey.potsPossible, 1 + Math.floor(report.duration / 300));
  // Most of the raid ate.
  assert.ok(prep.players.filter((p) => p.food).length >= 15);
  assert.ok(prep.players.filter((p) => p.flask).length >= 8);

  // Rolled up over two pulls.
  const sum = consumablesOf([
    { report: { prep } },
    { report: { prep } },
    { report: {} },
  ]);
  assert.equal(sum.pulls, 2);
  assert.equal(sum.skipped, 1);
  const r = sum.raiders.find((x) => x.name === 'Odonkey');
  assert.equal(r.pulls, 2);
  assert.equal(r.food, 2);
  assert.equal(r.names.food, 'Hearty Well Fed');
  assert.equal(sum.total.pulls, 40);
});
