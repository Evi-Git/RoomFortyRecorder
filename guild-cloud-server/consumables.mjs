// [RoomFortyRecorder] Consumables, raid buffs and gear checks per pull.
//
// The combat log's COMBATANT_INFO lines (one per raider at the pull, with
// advanced combat logging) carry each raider's gear (enchants, gems, weapon
// oil) and every aura they had at the pull, with who cast it. The analyzer
// keeps those raw (`report.prepRaw`); `buildPrep` names them, using
// Wowhead's tooltip for an aura's name and text (cached on the server),
// and summaries roll them up per raider and for the raid.

// Raid buffs everyone should have, by the spell IDs WoW uses for them.
export const RAID_BUFFS = [
  { key: 'int', name: 'Arcane Intellect', ids: [1459] },
  { key: 'stamina', name: 'Power Word: Fortitude', ids: [21562] },
  { key: 'ap', name: 'Battle Shout', ids: [6673] },
  { key: 'vers', name: 'Mark of the Wild', ids: [1126] },
  { key: 'skyfury', name: 'Skyfury', ids: [462854] },
  // One ID per class it lands on.
  {
    key: 'bronze',
    name: 'Blessing of the Bronze',
    ids: [
      381732, 381741, 381746, 381748, 381749, 381750, 381751, 381752, 381753,
      381754, 381756, 381757, 381758,
    ],
  },
];

// Gear slots (COMBATANT_INFO order) that take an enchant in Midnight.
export const ENCHANT_SLOTS = [
  { index: 0, slot: 'Head' },
  { index: 2, slot: 'Shoulders' },
  { index: 4, slot: 'Chest' },
  { index: 6, slot: 'Legs' },
  { index: 7, slot: 'Boots' },
  { index: 10, slot: 'Ring' },
  { index: 11, slot: 'Ring' },
  { index: 15, slot: 'Weapon' },
];
// Slots that can hold a gem. The log lists gems, not sockets, so an empty
// socket and no socket look the same: shown as "no gem".
export const GEM_SLOTS = [
  { index: 0, slot: 'Head' },
  { index: 1, slot: 'Neck' },
  { index: 8, slot: 'Wrist' },
  { index: 5, slot: 'Belt' },
  { index: 10, slot: 'Ring' },
  { index: 11, slot: 'Ring' },
];
const MAIN_HAND = 15;

const num = (value) => Number.parseInt(value, 10) || 0;

/**
 * Raw prep data from one COMBATANT_INFO line's parsed args (analyzer).
 * Gear items: [itemId, ilvl, [perm, temp, onUse], [bonusIds], [gemId, ilvl, ...]].
 * Auras: flat [sourceGuid, spellId, stacks, ...].
 */
export const rawPrep = (args) => {
  const gear = Array.isArray(args[28]) ? args[28] : [];
  const auraList = Array.isArray(args[29]) ? args[29] : [];
  const auras = [];
  for (let i = 0; i + 1 < auraList.length; i += 3) {
    const spellId = num(auraList[i + 1]);
    if (spellId) auras.push([String(auraList[i]), spellId]);
  }
  const item = (index) =>
    Array.isArray(gear[index]) && num(gear[index][0]) ? gear[index] : null;
  const enchants = ENCHANT_SLOTS.map(({ index, slot }) => {
    const it = item(index);
    if (!it) return { slot, ok: null }; // nothing equipped there
    return { slot, ok: Array.isArray(it[2]) && num(it[2][0]) > 0 };
  });
  const gems = GEM_SLOTS.map(({ index, slot }) => {
    const it = item(index);
    const list = it && Array.isArray(it[4]) ? it[4] : [];
    let count = 0;
    for (let i = 0; i < list.length; i += 2) if (num(list[i])) count += 1;
    return { slot, count, equipped: Boolean(it) };
  });
  const weapon = item(MAIN_HAND);
  const weaponOil = weapon
    ? Array.isArray(weapon[2]) && num(weapon[2][1]) > 0
    : null;
  return { auras, enchants, gems, weaponOil };
};

/** What an aura is, from its Wowhead name and tooltip text. */
export const classifyAura = (info, combatPotionNames = new Set()) => {
  if (!info) return null;
  const name = String(info.name || '');
  const text = String(info.text || '');
  const lower = name.toLowerCase();
  if (combatPotionNames.has(lower.replace(/[^a-z0-9]/g, ''))) return 'potion';
  if (/^vantus rune/i.test(name)) return 'vantus';
  // Augment runes: "Augment Rune." in the tooltip, or a name like
  // "Ethereal Augmentation" / "Void-Touched" (the rune's buff).
  if (/augment rune/i.test(text) || /augment rune|augmentation$/i.test(name))
    return 'augment';
  if (/well fed/i.test(name) || /well fed/i.test(text)) return 'food';
  if (
    /^(flask|phial)\b/i.test(name) ||
    /lasts 1 hour and through death/i.test(text)
  )
    return 'flask';
  return null;
};

const normName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Named prep data for a report.
 * @param {object} report  an analyzed report with `prepRaw` and players
 * @param {(id:number) => {name,text}|null} infoOf  tooltip lookup (cached)
 * @param {string[]} combatPotions  combat potion names
 */
export const buildPrep = (report, infoOf, combatPotions = []) => {
  const raw = report.prepRaw;
  if (!raw || !raw.players?.length) return null;
  const potionNames = new Set(combatPotions.map(normName));
  const nameOfGuid = new Map([
    ...Object.entries(raw.sourceNames || {}),
    ...raw.players.map((p) => [p.guid, p.name]),
  ]);
  const duration = Number(report.duration) || 0;
  const possible = 1 + Math.floor(duration / 300);
  const usedInCombat = new Map(
    (report.defensives?.players || []).map((p) => [
      p.name,
      p.combatPotions || 0,
    ]),
  );
  // Imported pulls: potion casts counted from Warcraft Logs.
  Object.entries(report.combatPotionsUsed || {}).forEach(([name, n]) =>
    usedInCombat.set(name, n),
  );

  const players = raw.players.map((p) => {
    const found = {
      food: null,
      flask: null,
      augment: null,
      vantus: null,
      potion: null,
    };
    p.auras.forEach(([, spellId]) => {
      const info = infoOf(spellId);
      const kind =
        classifyAura(info, potionNames) ||
        (potionNames.has(normName(report.spellNames?.[spellId]))
          ? 'potion'
          : null);
      if (kind && !found[kind])
        found[kind] =
          info?.name || report.spellNames?.[spellId] || `Spell ${spellId}`;
    });
    const prepot = Boolean(found.potion);
    const potsUsed = (prepot ? 1 : 0) + (usedInCombat.get(p.name) || 0);
    return {
      name: p.name,
      specId: p.specId,
      food: found.food,
      flask: found.flask,
      augment: found.augment,
      vantus: found.vantus,
      weaponOil: p.weaponOil,
      prepot,
      potsUsed: Math.min(potsUsed, possible),
      potsPossible: possible,
      enchants: p.enchants,
      gems: p.gems,
      enchantsMissing: p.enchants.filter((e) => e.ok === false).length,
      gemsMissing: p.gems.filter((g) => g.equipped && g.count === 0).length,
    };
  });

  const raidBuffs = RAID_BUFFS.map((buff) => {
    const providers = new Set();
    let have = 0;
    raw.players.forEach((p) => {
      const hit = p.auras.find(([, id]) => buff.ids.includes(id));
      if (hit) {
        have += 1;
        const from = nameOfGuid.get(hit[0]);
        if (from) providers.add(from);
      }
    });
    return {
      key: buff.key,
      name: buff.name,
      have,
      of: raw.players.length,
      providers: [...providers],
    };
  });

  return { players, raidBuffs };
};

// What everyone should have, in the order the views show it.
export const CHECKS = [
  'food',
  'flask',
  'augment',
  'weaponOil',
  'vantus',
  'prepot',
];

const mostCommon = (values) => {
  const counts = new Map();
  values
    .filter(Boolean)
    .forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/**
 * Per raider and raid-wide rates over several pulls (Night summary,
 * Progression). Pulls without prep data (older ones) are skipped.
 */
export const consumablesOf = (pulls) => {
  const withPrep = pulls.filter((p) => p.report?.prep?.players?.length);
  if (!withPrep.length) return null;
  const raiders = new Map();
  const total = { pulls: 0, potsUsed: 0, potsPossible: 0 };
  CHECKS.forEach((k) => {
    total[k] = 0;
  });

  withPrep.forEach(({ report }) => {
    report.prep.players.forEach((p) => {
      if (!raiders.has(p.name)) {
        raiders.set(p.name, {
          name: p.name,
          specId: p.specId,
          pulls: 0,
          potsUsed: 0,
          potsPossible: 0,
          names: { food: [], flask: [], augment: [], vantus: [] },
          ...Object.fromEntries(CHECKS.map((k) => [k, 0])),
          enchants: p.enchants,
          gems: p.gems,
        });
      }
      const r = raiders.get(p.name);
      r.pulls += 1;
      total.pulls += 1;
      CHECKS.forEach((k) => {
        const has =
          k === 'prepot'
            ? p.prepot
            : k === 'weaponOil'
              ? p.weaponOil === true
              : Boolean(p[k]);
        if (has) {
          r[k] += 1;
          total[k] += 1;
        }
      });
      ['food', 'flask', 'augment', 'vantus'].forEach((k) =>
        r.names[k].push(p[k]),
      );
      r.potsUsed += p.potsUsed;
      r.potsPossible += p.potsPossible;
      total.potsUsed += p.potsUsed;
      total.potsPossible += p.potsPossible;
      // Gear from their latest pull here.
      r.enchants = p.enchants;
      r.gems = p.gems;
    });
  });

  return {
    pulls: withPrep.length,
    skipped: pulls.length - withPrep.length,
    total,
    raiders: [...raiders.values()]
      .map((r) => ({
        ...r,
        names: Object.fromEntries(
          Object.entries(r.names).map(([k, v]) => [k, mostCommon(v)]),
        ),
        enchantsMissing: (r.enchants || []).filter((e) => e.ok === false)
          .length,
        gemsMissing: (r.gems || []).filter((g) => g.equipped && g.count === 0)
          .length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};
