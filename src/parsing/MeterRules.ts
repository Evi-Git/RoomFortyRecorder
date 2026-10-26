/**
 * [RoomFortyRecorder] Counting rules shared by the Logs page
 * (renderer/logs) and the app-side meters (PullMeters, for Trends and the
 * fallback view), so both match Warcraft Logs the same way.
 */

/**
 * Spells the combat log reports as cast that nobody presses: procs,
 * passives, pets' buffs and things picked up. They stay in Events, but
 * don't count as casts.
 */
export const NOT_CASTS = new Set([
  // Demon Hunter
  204255, // Soul Fragment
  328957, // Soul Fragment
  1223412, // Soul Fragment
  209693, // Shattered Souls
  228537, // Shattered Souls
  328951, // Shattered Souls
  // Priest
  147193, // Shadowy Apparition
  341263, // Shadowy Apparition
  // Paladin
  415388, // Reclamation
  // Hunter
  272790, // Frenzy (the pet's buff from Barbed Shot)
  260286, // Tip of the Spear
  // Death Knight
  323798, // Abomination Limb (pull)
  383312, // Abomination Limb (pull)
  383313, // Abomination Limb (pull)
  323710, // Abomination Limb (pull)
  // Rogue
  452538, // Fatebound Coin (Tails)
  // Evoker
  395495, // Scornful Haste
  395498, // Scornful Haste
  // Throw Glaive's and Reaver's Glaive's extra throws
  393035, // Throw Glaive
  337819, // Throw Glaive
  444686, // Reaver's Glaive
  // Death Knight
  434144, // Infliction of Sorrow
  // Evoker
  1265991, // Twin Flame (Living Flame's second flame)
  355941, // Dream Breath (its heal over time)
  // Priest
  64844, // Divine Hymn (each tick)
  // Warrior
  126664, // Charge (the impact)
  // Items and old effects
  324748, // Celestial Guidance
  324260, // Sinful Revelation
  336885, // Soothing Shade (standing in the shade)
  354050, // Nimble Steps
]);

/**
 * The same, by name, for procs whose spell IDs we haven't seen (every ID
 * of that name is a proc).
 */
export const NOT_CAST_NAMES = new Set([
  'Lightspire Core', // the trinket's beam of light (no on-use)
]);

/**
 * Seconds after a cast in which another "cast" of the same name by the
 * same caster but a different spell ID is part of it (Fracture's extra
 * hits, Felblade's charge, The Hunt's impact).
 */
export const SAME_CAST_WINDOW = 0.75;

/** Presses that can follow a same-named cast quickly (not part of it). */
export const ALWAYS_CASTS = new Set([
  342247, // Alter Time (going back)
]);

/** Damage from healing spells, shown as negative healing. */
export const HEALING_COSTS = new Set([
  98021, // Spirit Link (damage evening out health)
  448005, // Light of the Martyr (healing the paladin doesn't get)
  469704, // Tempered in Battle (the paladin's health it hands out)
]);

/**
 * Shields that are damage put off or sent elsewhere rather than healing:
 * Warcraft Logs counts what they take as neither healing nor damage taken.
 */
export const DEFERRED_ABSORBS = new Set([
  1309497, // Refractive Images (the mage's images take it)
  410355, // Stretch Time (taken later, as Stretch Time ticks)
]);

/** Shields Warcraft Logs doesn't count as healing. */
export const NOT_HEALING_ABSORBS = new Set([
  ...DEFERRED_ABSORBS,
  47788, // Guardian Spirit (the save from a killing blow)
  114556, // Purgatory (the death knight's own cheat death)
]);

/** Healer specs: Warcraft Logs leaves out their healing on others' pets. */
export const HEALER_SPECS = new Set([65, 105, 256, 257, 264, 270, 1468]);

/** Health moved between raiders, not damage taken (as on Warcraft Logs). */
export const NOT_TAKEN = new Set([
  98021, // Spirit Link
  469704, // Tempered in Battle
]);

/**
 * Decides whether a SPELL_CAST_SUCCESS is a press or a proc (NOT_CASTS,
 * NOT_CAST_NAMES, or a same-named "cast" right after one counted). Feed
 * every cast line in order.
 */
export class CastFilter {
  /** Last counted cast per caster and spell name: [time, spell ID]. */
  private last = new Map<string, [number, number]>();

  /** `t` in seconds. True when it isn't a press. */
  public isProc(
    caster: string | number,
    spellId: number,
    name: string,
    t: number,
  ) {
    if (NOT_CASTS.has(spellId) || NOT_CAST_NAMES.has(name)) return true;
    if (ALWAYS_CASTS.has(spellId)) return false;
    const key = `${caster}|${name}`;
    const last = this.last.get(key);
    if (last && last[1] !== spellId && t - last[0] <= SAME_CAST_WINDOW)
      return true;
    this.last.set(key, [t, spellId]);
    return false;
  }
}
