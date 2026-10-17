// Pull desk analysis against the real Mythic log in tests/logs.
// Run from the repo root: node --test guild-cloud-server/pulldesk-analyze.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePull, parseNote, splitArgs } from './pulldesk-analyze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const beloren = path.join(here, '../tests/logs/retail/beloren_boss_hp.txt');

// The analysis also works on an unfiltered slice, which is what this uses.
const slice = () => {
  const lines = fs.readFileSync(beloren, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes('  ENCOUNTER_START,'));
  const end = lines.findIndex((l) => l.includes('  ENCOUNTER_END,'));
  return lines.slice(start, end + 1).join('\n');
};

test('splitArgs keeps quoted commas and nested lists', () => {
  assert.deepEqual(splitArgs('A,"b, c",(1,2),[x]'), ['A', 'b, c', ['1', '2'], ['x']]);
});

test('Mythic wipe: deaths, killing blows and wipe cause', () => {
  const note = [
    '{time:0:38}Rubiscomonk {spell:388615}',
    'time:63;tag:Zinic;spellid:102342;',
    '{time:1:20}Livs {spell:33206}',
    '{time:0:30,p2}Zinic {spell:740}',
  ].join('\n');
  const report = analyzePull(slice(), { note, avoidable: [1241932] });

  assert.equal(report.encounterId, 3182);
  assert.equal(report.difficulty, 'Mythic');
  assert.equal(report.result, 'wipe');
  assert.equal(report.roster.length, 20);
  assert.equal(report.deaths.length, 20);

  const first = report.deaths[0];
  assert.equal(first.name, 'Psiethyr');
  assert.equal(first.killingBlow.spellName, 'Voidlight Rupture');
  assert.equal(first.killingBlow.amount, 497059);
  assert.equal(first.killingBlow.overkill, 205131);

  assert.equal(report.wipe.massDeath.spellName, 'Erupting Void Echo');
  assert.equal(report.wipe.massDeath.count, 14);

  const status = Object.fromEntries(
    report.plan.items.map((item) => [item.name + item.spellId, item.status]),
  );
  assert.equal(status.Rubiscomonk388615, 'ontime');
  assert.equal(status.Zinic102342, 'ontime');
  assert.equal(status.Livs33206, 'missed');
  assert.equal(report.plan.phaseSkipped, 1);

  assert.equal(report.avoidable.length, 20);
  assert.equal(report.spellNames[1241932], 'Voidlight Convergence');
});

test('note names are matched against the roster', () => {
  const parsed = parseNote(
    '{time:1:00}|cff00ff98Zinic|r and Livs {spell:740}\n{time:0:10}Benchguy {spell:1}',
    ['Zinic', 'Livs'],
  );
  assert.deepEqual(
    parsed.assignments.map((a) => a.name).sort(),
    ['Livs', 'Zinic'],
  );
  assert.equal(parsed.unmatched, 1);
});
