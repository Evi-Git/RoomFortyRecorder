// Pull desk analysis: turns one pull's combat log slice (already filtered by
// the app, see src/parsing/PullLogFilter.ts) into a small JSON report.
//
// Pure functions only -- no file system, no network -- so it can be tested
// against the real logs under tests/logs.

import { availabilityAt, defensiveFor } from './pulldesk-defensives.mjs';
import { rawPrep } from './consumables.mjs';

// ---- Log line parsing -------------------------------------------------------

// Splits the part after the timestamp the same way the app's LogLine does:
// commas separate values, quotes protect commas, () and [] make nested lists.
export const splitArgs = (body) => {
  const args = [];
  const stack = [];
  let value = '';
  let quoted = false;
  let wasQuoted = false;

  const push = (item) => {
    if (stack.length > 0) stack[stack.length - 1].push(item);
    else args.push(item);
  };

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (quoted) {
      if (char === '"') quoted = false;
      else value += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (char === ',') {
      if (value !== '' || wasQuoted) push(value);
      value = '';
      wasQuoted = false;
    } else if (char === '[' || char === '(') {
      stack.push([]);
    } else if (char === ']' || char === ')') {
      if (value !== '' || wasQuoted) stack[stack.length - 1]?.push(value);
      value = stack.pop() ?? [];
      wasQuoted = true; // a closed list is always a value
    } else {
      value += char;
    }
  }

  if (value !== '' || wasQuoted) push(value);
  return args;
};

// "4/30/2026 20:05:17.7771" or older "3/3 19:06:21.663", newer logs may add
// a timezone suffix like "17.777-4". Returns milliseconds on an arbitrary
// but consistent clock (only differences matter).
export const parseTimestamp = (stamp) => {
  const match =
    /^(\d+)\/(\d+)(?:\/(\d+))?\s+(\d+):(\d+):(\d+)(?:\.(\d+))?/.exec(stamp);
  if (!match) return NaN;
  const [, month, day, year, hours, mins, secs, fraction] = match;
  const base = Date.UTC(
    Number(year || 2000),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(mins),
    Number(secs),
  );
  return base + (fraction ? Number(`0.${fraction}`) * 1000 : 0);
};

export const parseLine = (raw) => {
  const line = raw.trim();
  const gap = line.indexOf('  ');
  if (gap < 0) return null;
  const args = splitArgs(line.slice(gap + 2));
  if (args.length === 0) return null;
  return { ms: parseTimestamp(line.slice(0, gap)), event: args[0], args };
};

// ---- Helpers ------------------------------------------------------------------

const normName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Avoidable hits: a hit within this many seconds of the previous one is the
// same moment (standing in it, ticking), so it gets one Watch button. At most
// AVOIDABLE_MAX_TIMES moments are kept per raider per spell.
const AVOIDABLE_MERGE_SECONDS = 5;
const AVOIDABLE_MAX_TIMES = 40;
const TANK_SPECS = new Set([250, 581, 104, 268, 66, 73]);
const HEALER_SPECS = new Set([105, 270, 65, 256, 257, 264, 1468]);

export const roleForSpec = (specId) => {
  if (TANK_SPECS.has(specId)) return 'tank';
  if (HEALER_SPECS.has(specId)) return 'healer';
  return 'dps';
};

const DIFFICULTIES = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  233: 'Mythic', // flex Mythic (Kith'ix)
};

// "Psiethyr-TwistingNether-EU" -> "Psiethyr"
// Environment damage (falling, some ground effects) has "nil" as its source.
export const shortName = (name) => {
  const short = String(name || '').split('-')[0];
  return short === 'nil' ? '' : short;
};

const isPlayerGuid = (guid) => String(guid).startsWith('Player-');
const isNpcGuid = (guid) =>
  String(guid).startsWith('Creature-') || String(guid).startsWith('Vehicle-');
const npcIdFromGuid = (guid) => Number.parseInt(String(guid).split('-')[5], 10);

// Damage events and where their spell / advanced / damage fields start.
// SWING has no spell fields, so everything shifts left by 3.
const DAMAGE_EVENTS = {
  SPELL_DAMAGE: 9,
  SPELL_PERIODIC_DAMAGE: 9,
  RANGE_DAMAGE: 9,
  SPELL_BUILDING_DAMAGE: 9,
  SWING_DAMAGE: 6,
  SWING_DAMAGE_LANDED: 6,
};

const DECIMAL = /^-?\d+\.\d+$/;

// Returns a normalised damage hit, or null if the line isn't damage.
// Advanced combat log fields follow the spell fields. Their count changes
// between expansions (17 in Dragonflight, 19 in Midnight), so the damage
// amount is found relative to the position fields: posX, posY, mapId,
// facing, level, then the amount.
const readDamage = (entry) => {
  const spellOffset = DAMAGE_EVENTS[entry.event];
  if (spellOffset === undefined) return null;
  const { args } = entry;
  const hasSpell = spellOffset === 9;
  const advanced = hasSpell ? 12 : 9;
  let posX = -1;
  for (let i = advanced + 4; i < args.length - 2; i += 1) {
    if (DECIMAL.test(args[i]) && DECIMAL.test(args[i + 1])) {
      posX = i;
      break;
    }
  }
  const amountAt = posX > 0 ? posX + 5 : advanced + 17;

  return {
    sourceGuid: args[1],
    sourceName: args[2],
    destGuid: args[5],
    destName: args[6],
    spellId: hasSpell ? Number.parseInt(args[9], 10) : 1,
    spellName: hasSpell ? args[10] : 'Melee',
    infoGuid: args[advanced],
    currentHp: Number.parseInt(args[advanced + 2], 10),
    maxHp: Number.parseInt(args[advanced + 3], 10),
    amount: Number.parseInt(args[amountAt], 10) || 0,
    overkill: Number.parseInt(args[amountAt + 2], 10),
  };
};

export const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

// ---- Note parsing -------------------------------------------------------------

// Parses cooldown assignments out of a pasted raid note. Two shapes:
//   NSRT (wowutils "Copy all"):  time:90;ph:1;tag:Name;spellid:31821;...
//     Only the tag: field names who is assigned. Other fields such as
//     glowunit: and text: often name other raiders and are ignored.
//   MRT:  {time:1:30}Name {spell:31821}
//     Roster names anywhere on the line are assigned.
// Names are matched against the pull's roster ignoring case, so realm
// suffixes and colour codes don't matter. Lines timed in a later phase
// ("ph:2", "{time:0:30,p2}") are counted but not checked yet. Text-only
// reminders (no spell) and the free-text sections are ignored.
export const parseNote = (noteText, rosterNames) => {
  const result = {
    assignments: [],
    phaseSkipped: 0,
    unmatched: 0,
    missingNames: [],
    encounterId: null,
  };
  if (!noteText) return result;

  const byLower = new Map(rosterNames.map((name) => [name.toLowerCase(), name]));
  const roster = rosterNames
    .map((name) => ({ name, lower: name.toLowerCase() }))
    .sort((a, b) => b.lower.length - a.lower.length);
  const missing = new Set();

  const cleaned = String(noteText)
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '');

  const header = /EncounterID:(\d+)/i.exec(cleaned);
  if (header) result.encounterId = Number(header[1]);

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let seconds = null;
    let phase = 1;

    const mrt = /\{time:(\d+)(?::(\d+))?(?:,\s*p(\d+))?[^}]*\}/i.exec(line);
    const nsrt = /(?:^|;)\s*time:(\d+(?:\.\d+)?)\s*;/i.exec(line);
    const nsrtPhase = /(?:^|;)\s*ph(?:ase)?:(\d+)\s*;/i.exec(line);

    if (nsrt) {
      seconds = Number(nsrt[1]);
      if (nsrtPhase) phase = Number(nsrtPhase[1]);
    } else if (mrt) {
      seconds = mrt[2] !== undefined
        ? Number(mrt[1]) * 60 + Number(mrt[2])
        : Number(mrt[1]);
      if (mrt[3]) phase = Number(mrt[3]);
    }
    if (seconds === null || !Number.isFinite(seconds)) continue;

    const spellIds = nsrt
      ? [...line.matchAll(/(?:^|;)\s*spellid:(\d+)/gi)].map((m) => Number(m[1]))
      : [...line.matchAll(/\{spell:(\d+)\}/gi)].map((m) => Number(m[1]));
    if (spellIds.length === 0) continue; // text reminder, nothing to check

    if (phase !== 1) {
      result.phaseSkipped += 1;
      continue;
    }

    const names = [];
    if (nsrt) {
      const tag = /(?:^|;)\s*tag:([^;]*)/i.exec(line);
      for (const word of (tag?.[1] || '').split(/\s+/).filter(Boolean)) {
        const name = byLower.get(word.toLowerCase());
        if (name) {
          if (!names.includes(name)) names.push(name);
        } else {
          missing.add(word);
        }
      }
    } else {
      // MRT: roster names as whole words anywhere outside the {...} tokens.
      const lowerLine = line.replace(/\{[^}]*\}/g, ' ').toLowerCase();
      for (const { name, lower } of roster) {
        const pattern = new RegExp(
          `(^|[^\\p{L}])${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
          'u',
        );
        if (pattern.test(lowerLine) && !names.includes(name)) names.push(name);
      }
    }

    if (names.length === 0) {
      result.unmatched += 1;
      continue;
    }

    // NSRT has one spell per line for everyone tagged. MRT lines with
    // several names and spells pair them up in order.
    names.forEach((name, index) => {
      result.assignments.push({
        t: seconds,
        name,
        spellId: spellIds[Math.min(index, spellIds.length - 1)],
      });
    });
  }

  result.assignments.sort((a, b) => a.t - b.t);
  result.missingNames = [...missing].sort();
  return result;
};

// ---- The analysis ---------------------------------------------------------------

const HIT_HISTORY = 8;
// Holy priest "death" auras: Spirit of Redemption and Restitution.
const PRIEST_DEATH_AURAS = new Set([27827, 211319]);

/**
 * @param {string} logText  filtered log slice, ENCOUNTER_START..ENCOUNTER_END
 * @param {{
 *   note?: string,
 *   avoidable?: (number | { id: number, name?: string | null })[],
 *   combatPotions?: string[],
 * }} options
 */
export const analyzePull = (logText, options = {}) => {
  // Avoidable spells by ID, and by name: a boss ability often hits with
  // other spell IDs than the one the journal lists (Venom Roar is cast as
  // 1302884 but hits as 1302914 and 1302917), so the name catches them all.
  const avoidable = new Set(
    (options.avoidable || []).map((a) => Number(typeof a === 'object' ? a?.id : a)).filter(Boolean),
  );
  const avoidableNames = new Set(
    (options.avoidable || [])
      .map((a) => (typeof a === 'object' && a?.name ? normName(a.name) : ''))
      .filter(Boolean),
  );
  const isAvoidable = (spellId, spellName) =>
    avoidable.has(spellId) || (avoidableNames.size > 0 && avoidableNames.has(normName(spellName)));
  // Combat potions by spell name: every crafted rank and cauldron version
  // of a potion casts the same spell.
  const combatPotions = new Set((options.combatPotions || []).map(normName).filter(Boolean));
  // Damage players took from enemies, per spell: for "hits as" IDs and totals.
  const damageTaken = new Map();

  let start = null;
  let end = null;
  const players = new Map(); // guid -> { name, specId }
  const recentHits = new Map(); // guid -> last hits
  const deaths = [];
  const deadAt = new Map(); // name -> first death time
  const casts = new Map(); // name -> [{ t, spellId, spellName }]
  // Defensives, raid cooldowns and health consumables, in cast order.
  const defensiveUses = []; // { t, name, entry, target }
  const spellNames = new Map();
  const npcMaxHp = new Map(); // npcId -> max hp
  const npcHp = new Map(); // npcId -> { t, current, max }
  const hpSamples = []; // [t, npcId, pct]
  const avoidableHits = new Map(); // name -> { hits, damage, bySpell }
  // Gear and auras at the pull, per raider (consumables.mjs).
  const prep = new Map(); // guid -> rawPrep

  const seconds = (entry) => (entry.ms - start.ms) / 1000;

  const notePlayer = (guid, name) => {
    if (!isPlayerGuid(guid) || !name || name === 'nil') return;
    const existing = players.get(guid);
    if (existing) existing.name ??= shortName(name);
    else players.set(guid, { name: shortName(name), specId: 0 });
  };

  for (const raw of String(logText).split('\n')) {
    if (!raw.trim()) continue;
    let entry;
    try {
      entry = parseLine(raw);
    } catch {
      continue; // one malformed line shouldn't sink the report
    }
    if (!entry || !Number.isFinite(entry.ms)) continue;
    const { event, args } = entry;

    if (event === 'ENCOUNTER_START') {
      if (start) continue; // only the first one
      start = {
        ms: entry.ms,
        encounterId: Number(args[1]),
        encounterName: args[2],
        difficultyId: Number(args[3]),
        groupSize: Number(args[4]),
      };
      continue;
    }
    if (!start) continue;

    if (event === 'ENCOUNTER_END') {
      end = {
        ms: entry.ms,
        success: args[5] === '1',
        fightMs: Number(args[6]),
      };
      break;
    }

    const t = seconds(entry);

    if (event === 'COMBATANT_INFO') {
      const guid = args[1];
      const specId = Number.parseInt(args[25], 10);
      const existing = players.get(guid);
      if (existing) existing.specId = specId;
      else players.set(guid, { name: null, specId });
      try {
        if (!prep.has(guid)) prep.set(guid, rawPrep(args));
      } catch {
        // An unexpected COMBATANT_INFO shape: no prep data for them.
      }
      continue;
    }

    notePlayer(args[1], args[2]);
    notePlayer(args[5], args[6]);
    // Aura names (a pre-pot's buff fading names the potion).
    if (event.startsWith('SPELL_AURA_') && args[9] && args[10]) {
      const auraId = Number(args[9]);
      if (auraId && !spellNames.has(auraId)) spellNames.set(auraId, args[10]);
    }

    const hit = readDamage(entry);
    if (hit) {
      spellNames.set(hit.spellId, hit.spellName);

      if (isPlayerGuid(hit.destGuid)) {
        const list = recentHits.get(hit.destGuid) || [];
        list.push({
          t,
          spellId: hit.spellId,
          spellName: hit.spellName,
          source: shortName(hit.sourceName),
          amount: hit.amount,
          overkill: Number.isFinite(hit.overkill) ? hit.overkill : -1,
        });
        if (list.length > HIT_HISTORY) list.shift();
        recentHits.set(hit.destGuid, list);

        if (!isPlayerGuid(hit.sourceGuid)) {
          const taken = damageTaken.get(hit.spellId) || { spellId: hit.spellId, spellName: hit.spellName, hits: 0, damage: 0 };
          taken.hits += 1;
          taken.damage += hit.amount;
          damageTaken.set(hit.spellId, taken);
        }

        if (isAvoidable(hit.spellId, hit.spellName) && !isPlayerGuid(hit.sourceGuid)) {
          const name = shortName(hit.destName);
          const stats = avoidableHits.get(name) || { hits: 0, damage: 0, bySpell: {}, spells: {} };
          stats.hits += 1;
          stats.damage += hit.amount;
          stats.bySpell[hit.spellId] = (stats.bySpell[hit.spellId] || 0) + 1;
          const spell = stats.spells[hit.spellId] || { hits: 0, damage: 0, times: [] };
          spell.hits += 1;
          spell.damage += hit.amount;
          // When each hit landed, for the Watch buttons. A tick within
          // AVOIDABLE_MERGE_SECONDS of the previous one is the same mistake.
          const last = spell.times[spell.times.length - 1];
          if (last && t - (last.end ?? last.t) <= AVOIDABLE_MERGE_SECONDS) {
            last.hits += 1;
            last.damage += hit.amount;
            last.end = Math.round(t * 10) / 10;
          } else if (spell.times.length < AVOIDABLE_MAX_TIMES) {
            spell.times.push({ t: Math.round(t * 10) / 10, hits: 1, damage: hit.amount });
          }
          stats.spells[hit.spellId] = spell;
          avoidableHits.set(name, stats);
        }
      } else if (
        isNpcGuid(hit.destGuid) &&
        hit.infoGuid === hit.destGuid &&
        Number.isFinite(hit.maxHp) &&
        hit.maxHp > 0
      ) {
        const npcId = npcIdFromGuid(hit.destGuid);
        npcMaxHp.set(npcId, Math.max(npcMaxHp.get(npcId) || 0, hit.maxHp));
        npcHp.set(npcId, { t, current: hit.currentHp, max: hit.maxHp });
        const last = hpSamples.findLast?.((sample) => sample[1] === npcId);
        if (!last || t - last[0] >= 5) {
          hpSamples.push([t, npcId, Math.round((100 * hit.currentHp) / hit.maxHp)]);
        }
      }
      continue;
    }

    if (event === 'SPELL_INSTAKILL' && isPlayerGuid(args[5])) {
      const list = recentHits.get(args[5]) || [];
      list.push({
        t,
        spellId: Number(args[9]),
        spellName: args[10],
        source: shortName(args[2]),
        amount: 0,
        overkill: 0,
        instakill: true,
      });
      recentHits.set(args[5], list.slice(-HIT_HISTORY));
      continue;
    }

    if (event === 'SPELL_CAST_SUCCESS' && isPlayerGuid(args[1])) {
      const name = shortName(args[2]);
      const spellId = Number(args[9]);
      spellNames.set(spellId, args[10]);
      const list = casts.get(name) || [];
      list.push({ t, spellId });
      casts.set(name, list);
      const entry =
        defensiveFor(args[10]) ||
        (combatPotions.has(normName(args[10]))
          ? { name: args[10], kind: 'combatPotion', cd: 300, baseline: [] }
          : null);
      if (entry) {
        // Channels (Tranquility, Divine Hymn) log a cast per tick: keep the
        // first of a burst.
        const repeat = defensiveUses.some(
          (use) => use.name === name && use.entry.name === entry.name && t - use.t < 10,
        );
        if (!repeat) {
          const target = isPlayerGuid(args[5]) ? shortName(args[6]) : '';
          defensiveUses.push({ t, name, entry, target: target === name ? '' : target });
        }
      }
      continue;
    }

    const priestDeath =
      event === 'SPELL_AURA_APPLIED' &&
      isPlayerGuid(args[5]) &&
      PRIEST_DEATH_AURAS.has(Number(args[9]));

    if ((event === 'UNIT_DIED' && isPlayerGuid(args[5])) || priestDeath) {
      const guid = args[5];
      const name = shortName(args[6]);
      // Feign death and similar set the last field to 1.
      if (event === 'UNIT_DIED' && args[9] === '1') continue;
      if (deadAt.has(name) && t - deadAt.get(name) < 15) continue;

      const hits = recentHits.get(guid) || [];
      const killing =
        [...hits].reverse().find((h) => h.instakill || h.overkill > 0) ||
        hits[hits.length - 1] ||
        null;

      deaths.push({
        t,
        guid,
        name,
        killingBlow: killing
          ? {
              spellId: killing.spellId,
              spellName: killing.spellName,
              source: killing.source,
              amount: killing.amount,
              overkill: killing.overkill,
            }
          : null,
        lastHits: hits.filter((h) => t - h.t <= 10).slice(-5),
      });
      if (!deadAt.has(name)) deadAt.set(name, t);
      recentHits.delete(guid);
    }
  }

  if (!start) throw new Error('No ENCOUNTER_START in log');

  const duration = end
    ? (end.fightMs > 0 ? end.fightMs / 1000 : (end.ms - start.ms) / 1000)
    : hpSamples.at(-1)?.[0] || 0;

  // The boss is the NPC with the highest max HP (same rule as the app).
  let bossNpcId = null;
  for (const [npcId, max] of npcMaxHp) {
    if (bossNpcId === null || max > npcMaxHp.get(bossNpcId)) bossNpcId = npcId;
  }
  const bossHp = bossNpcId !== null ? npcHp.get(bossNpcId) : null;
  let bossPercent = bossHp ? Math.round((100 * bossHp.current) / bossHp.max) : null;
  if (end?.success) bossPercent = 0;
  const bossHpCurve = hpSamples
    .filter((sample) => sample[1] === bossNpcId)
    .map(([time, , pct]) => [Math.round(time), pct]);

  // Roster with roles.
  const roster = [...players.entries()]
    .filter(([, info]) => info.name)
    .map(([guid, info]) => ({
      guid,
      name: info.name,
      specId: info.specId || 0,
      role: roleForSpec(info.specId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const roleOf = new Map(roster.map((player) => [player.name, player.role]));
  const inPull = new Set(
    roster.filter((player) => player.specId > 0).map((player) => player.name),
  );

  deaths.forEach((death) => {
    death.role = roleOf.get(death.name) || 'dps';
    delete death.guid;
  });

  // Defensives: per raider, plus the raid cooldowns timeline, and for each
  // death what that raider still had available.
  const usesBy = new Map();
  defensiveUses.forEach((use) => {
    usesBy.set(use.name, [...(usesBy.get(use.name) || []), use]);
  });
  const warlockInRaid = roster.some((player) => [265, 266, 267].includes(player.specId));
  const firstDeathAt = new Map();
  deaths.forEach((death) => {
    if (!firstDeathAt.has(death.name)) firstDeathAt.set(death.name, death.t);
    const player = roster.find((p) => p.name === death.name);
    death.available = player
      ? availabilityAt(player, usesBy.get(death.name) || [], death.t, warlockInRaid)
      : [];
  });
  const round1 = (value) => Math.round(value * 10) / 10;
  const defensives = {
    players: roster
      .filter((player) => inPull.size === 0 || inPull.has(player.name))
      .map((player) => {
        const uses = (usesBy.get(player.name) || []).map((use) => ({
          t: round1(use.t),
          ability: use.entry.name,
          kind: use.entry.kind,
          target: use.target || undefined,
        }));
        const count = (kinds) => uses.filter((use) => kinds.includes(use.kind)).length;
        return {
          name: player.name,
          role: player.role,
          specId: player.specId,
          diedAt: firstDeathAt.has(player.name) ? round1(firstDeathAt.get(player.name)) : null,
          personal: count(['personal', 'immunity']),
          external: count(['external']),
          raid: count(['raid']),
          potions: count(['potion']),
          healthstones: count(['healthstone']),
          combatPotions: count(['combatPotion']),
          uses,
        };
      }),
    raid: defensiveUses
      .filter((use) => use.entry.kind === 'raid')
      .map((use) => ({ t: round1(use.t), name: use.name, ability: use.entry.name })),
    warlockInRaid,
  };

  // Wipe cause.
  let wipe = null;
  if (end && !end.success) {
    const firstDeath = deaths[0] || null;
    const firstKey = deaths.find((d) => d.role === 'tank' || d.role === 'healer') || null;
    let cascade = null;
    for (let i = 0; i + 2 < deaths.length; i += 1) {
      if (deaths[i + 2].t - deaths[i].t <= 10) {
        cascade = { t: deaths[i].t, names: deaths.slice(i, i + 3).map((d) => d.name) };
        break;
      }
    }

    // A raid-wide mechanic: 5+ deaths within 2 s to the same ability.
    let massDeath = null;
    for (let i = 0; i < deaths.length && !massDeath; i += 1) {
      const spell = deaths[i].killingBlow?.spellName;
      const group = deaths.filter(
        (d) => d.t >= deaths[i].t && d.t - deaths[i].t <= 2 && d.killingBlow?.spellName === spell,
      );
      if (spell && group.length >= 5) {
        massDeath = { t: deaths[i].t, spellName: spell, spellId: deaths[i].killingBlow?.spellId ?? null, count: group.length };
      }
    }

    const parts = [];
    if (deaths.length === 0) {
      parts.push(duration < 20 ? 'Reset or early wipe, no deaths.' : 'Wipe with no player deaths.');
    } else {
      const describe = (death) =>
        `${death.name}${death.role !== 'dps' ? ` (${death.role})` : ''} to ${
          death.killingBlow?.spellName || 'unknown'
        } at ${formatTime(death.t)}`;
      if (massDeath) {
        parts.push(
          `${massDeath.spellName} killed ${massDeath.count} at ${formatTime(massDeath.t)}.`,
        );
      }
      parts.push(`First death: ${describe(firstDeath)}.`);
      if (firstKey && firstKey !== firstDeath && (!massDeath || firstKey.t < massDeath.t)) {
        parts.push(`First tank or healer death: ${describe(firstKey)}.`);
      }
      if (cascade && !massDeath) parts.push(`3 deaths inside 10 s from ${formatTime(cascade.t)}.`);
    }

    wipe = {
      text: parts.join(' '),
      firstDeathAt: firstDeath?.t ?? null,
      firstKeyDeathAt: firstKey?.t ?? null,
      cascadeAt: cascade?.t ?? null,
      massDeath,
    };
  }

  // Plan check.
  const note = parseNote(options.note || '', roster.map((player) => player.name));
  const planItems = note.assignments
    .filter((item) => item.t <= duration && (inPull.size === 0 || inPull.has(item.name)))
    .map((item) => {
      const spellName = spellNames.get(item.spellId) || null;
      const diedAt = deadAt.get(item.name);
      if (diedAt !== undefined && diedAt < item.t) {
        return { ...item, spellName, status: 'dead', delta: null };
      }
      const playerCasts = (casts.get(item.name) || []).filter(
        (cast) => cast.spellId === item.spellId,
      );
      let best = null;
      for (const cast of playerCasts) {
        const delta = cast.t - item.t;
        if (delta < -25 || delta > 25) continue;
        if (!best || Math.abs(delta) < Math.abs(best)) best = delta;
      }
      // For a miss, the closest cast of that spell anywhere in the pull (or
      // none), so the report can say "cast 48s late" or "never cast".
      let nearest = null;
      if (best === null) {
        for (const cast of playerCasts) {
          const delta = cast.t - item.t;
          if (nearest === null || Math.abs(delta) < Math.abs(nearest)) nearest = delta;
        }
      }
      let status = 'missed';
      if (best !== null) {
        if (best < -5) status = 'early';
        else if (best > 5) status = 'late';
        else status = 'ontime';
      }
      return {
        ...item,
        spellName: spellName || spellNames.get(item.spellId) || null,
        status,
        delta: best === null ? null : Math.round(best * 10) / 10,
        nearest: nearest === null ? null : Math.round(nearest * 10) / 10,
      };
    });

  const planSummary = { ontime: 0, late: 0, early: 0, missed: 0, dead: 0 };
  planItems.forEach((item) => {
    planSummary[item.status] += 1;
  });

  const avoidableList = [...avoidableHits.entries()]
    .map(([name, { spells, ...stats }]) => ({
      name,
      ...stats,
      spells: Object.entries(spells)
        .map(([spellId, spell]) => ({
          spellId: Number(spellId),
          spellName: spellNames.get(Number(spellId)) || null,
          ...spell,
        }))
        .sort((a, b) => b.hits - a.hits),
    }))
    .sort((a, b) => b.hits - a.hits);

  return {
    v: 2,
    encounterId: start.encounterId,
    encounterName: start.encounterName,
    difficultyId: start.difficultyId,
    difficulty: DIFFICULTIES[start.difficultyId] || String(start.difficultyId),
    groupSize: start.groupSize,
    result: end?.success ? 'kill' : 'wipe',
    complete: Boolean(end),
    duration: Math.round(duration * 10) / 10,
    bossPercent,
    bossHpCurve,
    roster,
    deaths: deaths.map((death) => ({
      ...death,
      t: Math.round(death.t * 10) / 10,
      lastHits: death.lastHits.map((h) => ({ ...h, t: Math.round(h.t * 10) / 10 })),
    })),
    wipe,
    plan: {
      parsed: note.assignments.length,
      phaseSkipped: note.phaseSkipped,
      unmatched: note.unmatched,
      // Tagged names that weren't in this pull (benched, or a typo).
      missingNames: note.missingNames,
      noteEncounterId: note.encounterId,
      items: planItems,
      summary: planSummary,
    },
    avoidable: avoidableList,
    // Enemy damage on players by spell, biggest first.
    damageTaken: [...damageTaken.values()]
      .sort((a, b) => b.damage - a.damage)
      .slice(0, 200),
    defensives,
    spellNames: Object.fromEntries(
      [...avoidable].map((id) => [id, spellNames.get(id) || null]),
    ),
    // Raw gear and auras at the pull; named by consumables.buildPrep.
    prepRaw: {
      players: [...prep.entries()]
        .map(([guid, p]) => ({ guid, name: players.get(guid)?.name || null, specId: players.get(guid)?.specId || 0, ...p }))
        .filter((p) => p.name && (inPull.size === 0 || inPull.has(p.name))),
      auraNames: Object.fromEntries(
        [...new Set([...prep.values()].flatMap((p) => p.auras.map(([, id]) => id)))]
          .filter((id) => spellNames.has(id))
          .map((id) => [id, spellNames.get(id)]),
      ),
    },
  };
};
