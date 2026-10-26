/**
 * [RoomFortyRecorder] Defensive cooldowns, raid cooldowns and health
 * consumables, for the Logs page's Deaths tab: what a raider pressed before
 * dying and what was still ready. A copy of the Dashboard's table in
 * guild-cloud-server/pulldesk-defensives.mjs (a test keeps the two the
 * same); abilities match by name, cooldowns are base values.
 */

export type DefensiveKind =
  | 'personal'
  | 'immunity'
  | 'external'
  | 'raid'
  | 'potion'
  | 'healthstone';

export type DefensiveEntry = {
  name: string;
  kind: DefensiveKind;
  cd: number;
  /** Classes or spec IDs that have it without a talent. */
  baseline: (string | number)[];
};

const CLASS_BY_SPEC: Record<number, string> = {
  250: 'Death Knight',
  251: 'Death Knight',
  252: 'Death Knight',
  577: 'Demon Hunter',
  581: 'Demon Hunter',
  1480: 'Demon Hunter',
  102: 'Druid',
  103: 'Druid',
  104: 'Druid',
  105: 'Druid',
  1467: 'Evoker',
  1468: 'Evoker',
  1473: 'Evoker',
  253: 'Hunter',
  254: 'Hunter',
  255: 'Hunter',
  62: 'Mage',
  63: 'Mage',
  64: 'Mage',
  268: 'Monk',
  269: 'Monk',
  270: 'Monk',
  65: 'Paladin',
  66: 'Paladin',
  70: 'Paladin',
  256: 'Priest',
  257: 'Priest',
  258: 'Priest',
  259: 'Rogue',
  260: 'Rogue',
  261: 'Rogue',
  262: 'Shaman',
  263: 'Shaman',
  264: 'Shaman',
  265: 'Warlock',
  266: 'Warlock',
  267: 'Warlock',
  71: 'Warrior',
  72: 'Warrior',
  73: 'Warrior',
};

// name: [kind, base cooldown in seconds, baseline for (classes or spec IDs)]
export const TABLE: Record<
  string,
  [DefensiveKind, number, (string | number)[]?]
> = {
  // Death Knight
  'Icebound Fortitude': ['personal', 180, ['Death Knight']],
  'Anti-Magic Shell': ['personal', 60, ['Death Knight']],
  'Anti-Magic Zone': ['raid', 120],
  'Death Pact': ['personal', 120],
  Lichborne: ['personal', 120],
  'Vampiric Blood': ['personal', 90, [250]],
  'Dancing Rune Weapon': ['personal', 120, [250]],
  // Demon Hunter
  Blur: ['personal', 60, [577, 1480]],
  Netherwalk: ['immunity', 180],
  Darkness: ['raid', 300],
  'Fiery Brand': ['personal', 60, [581]],
  Metamorphosis: ['personal', 180, [581]],
  // Druid
  Barkskin: ['personal', 60, ['Druid']],
  'Survival Instincts': ['personal', 180, [103, 104]],
  'Frenzied Regeneration': ['personal', 36],
  Renewal: ['personal', 90],
  Ironbark: ['external', 90, [105]],
  Tranquility: ['raid', 180, [105]],
  // Evoker
  'Obsidian Scales': ['personal', 90, ['Evoker']],
  'Renewing Blaze': ['personal', 90],
  Zephyr: ['raid', 120],
  Rewind: ['raid', 240],
  'Time Dilation': ['external', 60],
  // Hunter
  'Aspect of the Turtle': ['immunity', 180, ['Hunter']],
  Exhilaration: ['personal', 120, ['Hunter']],
  'Survival of the Fittest': ['personal', 180],
  'Roar of Sacrifice': ['external', 60],
  // Mage
  'Ice Block': ['immunity', 240, ['Mage']],
  'Ice Cold': ['personal', 240],
  'Alter Time': ['personal', 60],
  'Mirror Image': ['personal', 120],
  'Greater Invisibility': ['personal', 120],
  'Mass Barrier': ['raid', 180],
  // Monk
  'Fortifying Brew': ['personal', 360, ['Monk']],
  'Diffuse Magic': ['personal', 90],
  'Dampen Harm': ['personal', 120],
  'Touch of Karma': ['personal', 90, [269]],
  'Life Cocoon': ['external', 120, [270]],
  Revival: ['raid', 180],
  Restoral: ['raid', 180],
  'Celestial Brew': ['personal', 60],
  'Invoke Niuzao, the Black Ox': ['personal', 180],
  // Paladin
  'Divine Shield': ['immunity', 300, ['Paladin']],
  'Divine Protection': ['personal', 60, [65, 70]],
  'Shield of Vengeance': ['personal', 90],
  'Lay on Hands': ['external', 600, ['Paladin']],
  'Blessing of Protection': ['external', 300, ['Paladin']],
  'Blessing of Sacrifice': ['external', 120],
  'Blessing of Spellwarding': ['external', 300],
  'Aura Mastery': ['raid', 180, [65]],
  'Ardent Defender': ['personal', 120, [66]],
  'Guardian of Ancient Kings': ['personal', 300, [66]],
  // Priest
  'Desperate Prayer': ['personal', 90, ['Priest']],
  Dispersion: ['personal', 120, [258]],
  'Vampiric Embrace': ['raid', 120],
  'Pain Suppression': ['external', 180, [256]],
  'Guardian Spirit': ['external', 180, [257]],
  'Power Word: Barrier': ['raid', 180],
  'Divine Hymn': ['raid', 180],
  // Rogue
  'Cloak of Shadows': ['immunity', 120, ['Rogue']],
  Evasion: ['personal', 120, ['Rogue']],
  'Crimson Vial': ['personal', 30, ['Rogue']],
  // Shaman
  'Astral Shift': ['personal', 120, ['Shaman']],
  'Spirit Link Totem': ['raid', 180],
  'Stone Bulwark Totem': ['personal', 180],
  'Earth Elemental': ['personal', 300],
  'Healing Tide Totem': ['raid', 180],
  // Warlock
  'Unending Resolve': ['personal', 180, ['Warlock']],
  'Dark Pact': ['personal', 60],
  // Warrior
  'Die by the Sword': ['personal', 120, [71]],
  'Enraged Regeneration': ['personal', 120, [72]],
  'Shield Wall': ['personal', 180, [73]],
  'Last Stand': ['personal', 180, [73]],
  'Rallying Cry': ['raid', 180],
  'Spell Reflection': ['personal', 25],
  // Consumables (cooldowns handled specially below)
  Healthstone: ['healthstone', 60],
  'Demonic Healthstone': ['healthstone', 60],
};

/** Talent -> the baseline ability it replaces. */
const REPLACES: Record<string, string> = {
  'Ice Cold': 'Ice Block',
};

// Health potions share one cooldown; any "... Health(ing) Potion".
const POTION_COOLDOWN = 300;
const POTION: DefensiveEntry = {
  name: 'Health Potion',
  kind: 'potion',
  cd: POTION_COOLDOWN,
  baseline: [],
};
const isHealthPotion = (name: string) =>
  /\b(health|healing) potion\b/i.test(name);

const normalize = (name: string) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const BY_KEY = new Map<string, DefensiveEntry>(
  Object.entries(TABLE).map(([name, [kind, cd, baseline]]) => [
    normalize(name),
    { name, kind, cd, baseline: baseline ?? [] },
  ]),
);

/** The table entry for a cast spell's name, or null. */
export const defensiveFor = (spellName: string): DefensiveEntry | null => {
  if (!spellName) return null;
  if (isHealthPotion(spellName)) return POTION;
  return BY_KEY.get(normalize(spellName)) ?? null;
};

export type DefensiveUse = { t: number; entry: DefensiveEntry };

export type Availability = {
  ability: string;
  kind: DefensiveKind;
  status: 'ready' | 'cooldown';
  readyIn: number;
  lastUsed: number | null;
  usedCount: number;
};

const hasBaseline = (entry: DefensiveEntry, specId: number) => {
  const cls = CLASS_BY_SPEC[specId];
  return entry.baseline.some((who) => who === specId || who === cls);
};

/**
 * What a raider could have pressed at `atTime`: their spec's baseline
 * defensives, anything they cast this pull, a health potion, and a
 * healthstone with a warlock in the raid. Raid cooldowns are left out.
 */
export const availabilityAt = (
  specId: number,
  uses: DefensiveUse[],
  atTime: number,
  warlockInRaid: boolean,
): Availability[] => {
  const healthstone = BY_KEY.get(normalize('Healthstone')) as DefensiveEntry;
  const candidates = new Map<string, DefensiveEntry>();
  const add = (entry: DefensiveEntry) => {
    if (entry.kind === 'raid') return;
    candidates.set(entry.name, entry);
  };
  BY_KEY.forEach((entry) => {
    if (entry.kind !== 'healthstone' && hasBaseline(entry, specId)) add(entry);
  });
  uses.forEach((use) =>
    add(use.entry.kind === 'healthstone' ? healthstone : use.entry),
  );
  add(POTION);
  if (warlockInRaid) add(healthstone);
  Object.entries(REPLACES).forEach(([talent, replaced]) => {
    if (candidates.has(talent)) candidates.delete(replaced);
  });

  const result: Availability[] = [];
  candidates.forEach((entry) => {
    const before = uses.filter(
      (use) =>
        use.t <= atTime &&
        (use.entry.name === entry.name ||
          (entry.kind === 'healthstone' && use.entry.kind === 'healthstone')),
    );
    const last = before[before.length - 1];
    let status: Availability['status'] = 'ready';
    let readyIn = 0;
    if (last && atTime - last.t < entry.cd) {
      status = 'cooldown';
      readyIn = Math.round(entry.cd - (atTime - last.t));
    }
    result.push({
      ability: entry.name,
      kind: entry.kind,
      status,
      readyIn,
      lastUsed: last ? Math.round(last.t * 10) / 10 : null,
      usedCount: before.length,
    });
  });
  const order: Record<string, number> = {
    immunity: 0,
    personal: 1,
    external: 2,
    healthstone: 3,
    potion: 4,
  };
  return result.sort(
    (a, b) =>
      (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) ||
      (order[a.kind] ?? 9) - (order[b.kind] ?? 9) ||
      a.ability.localeCompare(b.ability),
  );
};
