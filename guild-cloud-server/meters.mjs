// [RoomFortyRecorder] Meters from a pull's combat log: damage done, healing
// (with overheal and absorbs) and damage taken, per raider and per ability,
// with 5-second buckets for the "over time" charts. Fed line by line by the
// analyzer (pulldesk-analyze.mjs); pets and guardians count toward their
// owner, from the log's owner field (advanced logging) or SPELL_SUMMON.

const DECIMAL = /^-?\d+\.\d+$/;
const PLAYER = /^Player-/;
const NO_OWNER = '0000000000000000';
export const BUCKET_SECONDS = 5;
const MAX_ABILITIES = 30;

const DAMAGE = new Set(['SPELL_DAMAGE', 'SPELL_PERIODIC_DAMAGE', 'RANGE_DAMAGE', 'SWING_DAMAGE', 'DAMAGE_SPLIT']);
const HEAL = new Set(['SPELL_HEAL', 'SPELL_PERIODIC_HEAL']);

const int = (value) => Number.parseInt(value, 10) || 0;
// Unit flags: 0x10 = friendly reaction.
const isFriendly = (flags) => (Number.parseInt(flags, 16) & 0x10) !== 0;

/**
 * Where the amounts start: after the advanced block, found by its two map
 * coordinates (posX, posY are the only decimals there), else the fixed
 * position. `advanced` = index of the advanced block's first field.
 */
const amountIndex = (args, advanced) => {
  for (let i = advanced + 4; i < args.length - 2; i += 1) {
    if (DECIMAL.test(args[i]) && DECIMAL.test(args[i + 1])) return i + 5;
  }
  return advanced + 17;
};

export const createMeters = () => {
  const owners = new Map(); // pet/guardian guid -> owner player guid
  const names = new Map(); // player guid -> name (short)
  const casts = new Map(); // `${guid}:${spellId}` -> count
  const done = new Map(); // guid -> stats
  const healed = new Map();
  const taken = new Map();

  const shortName = (name) => String(name || '').split('-')[0];

  const ownerOf = (guid, ownerGuid) => {
    if (PLAYER.test(guid)) return guid;
    if (ownerGuid && ownerGuid !== NO_OWNER && PLAYER.test(ownerGuid)) {
      owners.set(guid, ownerGuid);
      return ownerGuid;
    }
    return owners.get(guid) || null;
  };

  const statsFor = (map, guid) => {
    if (!map.has(guid)) map.set(guid, { total: 0, overheal: 0, absorbs: 0, abilities: new Map(), series: [] });
    return map.get(guid);
  };

  const add = (stats, t, spellId, spellName, amount, extra = {}) => {
    stats.total += amount;
    const ability = stats.abilities.get(spellId) || { spellId, name: spellName, total: 0, hits: 0, crits: 0, overheal: 0 };
    ability.total += amount;
    ability.hits += 1;
    if (extra.crit) ability.crits += 1;
    ability.overheal += extra.overheal || 0;
    stats.abilities.set(spellId, ability);
    const bucket = Math.max(0, Math.floor(t / BUCKET_SECONDS));
    while (stats.series.length <= bucket) stats.series.push(0);
    stats.series[bucket] += amount;
  };

  /** One parsed log line (pulldesk-analyze parseLine), `t` seconds into the pull. */
  const feed = (entry, t) => {
    const { event, args } = entry;
    if (PLAYER.test(args[1]) && args[2] && args[2] !== 'nil') names.set(args[1], shortName(args[2]));
    if (PLAYER.test(args[5]) && args[6] && args[6] !== 'nil') names.set(args[5], shortName(args[6]));

    if (event === 'SPELL_SUMMON' && PLAYER.test(args[1])) {
      owners.set(args[5], args[1]);
      return;
    }
    if (event === 'SPELL_CAST_SUCCESS') {
      const who = ownerOf(args[1], null);
      if (who) {
        const key = `${who}:${int(args[9])}`;
        casts.set(key, (casts.get(key) || 0) + 1);
      }
      return;
    }

    if (DAMAGE.has(event)) {
      const hasSpell = event !== 'SWING_DAMAGE';
      const advanced = hasSpell ? 12 : 9;
      const at = amountIndex(args, advanced);
      const amount = int(args[at]);
      const absorbed = int(args[at + 6]);
      const crit = args[at + 7] === '1';
      const spellId = hasSpell ? int(args[9]) : 1;
      const spellName = hasSpell ? args[10] : 'Melee';
      // Damage done: by a raider (or their pet) to anything not friendly.
      const by = ownerOf(args[1], args[advanced + 1]);
      if (by && !isFriendly(args[7])) add(statsFor(done, by), t, spellId, spellName, amount + absorbed, { crit });
      // Damage taken: by a raider, from anything that isn't a raider.
      if (PLAYER.test(args[5]) && !PLAYER.test(args[1]) && !owners.has(args[1])) {
        add(statsFor(taken, args[5]), t, spellId, spellName, amount + absorbed, { crit });
      }
      return;
    }

    if (HEAL.has(event)) {
      const at = amountIndex(args, 12);
      const amount = int(args[at]);
      const overheal = int(args[at + 2]);
      const crit = args[at + 4] === '1';
      const by = ownerOf(args[1], args[13]);
      // Healing on friendly units only (not healing an enemy).
      if (by && isFriendly(args[7])) {
        const stats = statsFor(healed, by);
        add(stats, t, int(args[9]), args[10], Math.max(0, amount - overheal), { crit, overheal });
        stats.overheal += overheal;
      }
      return;
    }

    if (event === 'SPELL_ABSORBED') {
      // attacker(4) target(4) [attack spell id, name, school] absorber(4)
      // absorb spell id, name, school, amount, ...
      const withSpell = /^0x/i.test(args[11] || '') && /^\d+$/.test(args[9] || '');
      const at = withSpell ? 12 : 9;
      const by = ownerOf(args[at], null);
      if (!by) return;
      const amount = int(args[at + 7]);
      const stats = statsFor(healed, by);
      add(stats, t, int(args[at + 4]), args[at + 5], amount);
      stats.absorbs += amount;
    }
  };

  const listOf = (map, duration, withCasts) =>
    [...map.entries()]
      .filter(([guid, s]) => names.has(guid) && s.total > 0)
      .map(([guid, s]) => ({
        name: names.get(guid),
        total: s.total,
        perSecond: duration > 0 ? Math.round(s.total / duration) : 0,
        overheal: s.overheal || undefined,
        absorbs: s.absorbs || undefined,
        abilities: [...s.abilities.values()]
          .sort((a, b) => b.total - a.total)
          .slice(0, MAX_ABILITIES)
          .map((a) => ({
            ...a,
            casts: withCasts ? casts.get(`${guid}:${a.spellId}`) || 0 : undefined,
            overheal: a.overheal || undefined,
          })),
        series: s.series,
      }))
      .sort((a, b) => b.total - a.total);

  /** The meters for the report; `inPull` limits it to the pull's raiders. */
  const finish = (duration, inPull) => {
    const keep = (rows) => (inPull && inPull.size ? rows.filter((r) => inPull.has(r.name)) : rows);
    const buckets = Math.max(1, Math.ceil(duration / BUCKET_SECONDS));
    const pad = (rows) =>
      rows.map((r) => ({ ...r, series: Array.from({ length: buckets }, (_, i) => r.series[i] || 0) }));
    return {
      bucketSeconds: BUCKET_SECONDS,
      damage: pad(keep(listOf(done, duration, true))),
      healing: pad(keep(listOf(healed, duration, true))),
      taken: pad(keep(listOf(taken, duration, false))),
    };
  };

  return { feed, finish };
};
