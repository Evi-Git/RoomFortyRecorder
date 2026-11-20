/**
 * [RoomFortyRecorder] Each spec's main resource, as the combat log numbers
 * power types (see POWER_NAMES in store.ts). Analyze's "Resource lost at the
 * cap" uses it when the widget doesn't name a resource, so a Shadow Priest
 * sees Insanity and not the Mana they happen to waste more of.
 *
 * Hand-written (specPresets.ts is generated). It names what the log records
 * as gains: passive Mana and Energy regen is never logged, so Arcane is
 * Arcane Charges, Windwalker is Chi and Preservation is Essence; healers
 * otherwise Mana. Enhancement's Maelstrom Weapon is a buff in retail, so
 * its entry usually finds no gains and Analyze falls back to the most wasted.
 */
export const PRIMARY_POWER: Record<number, number> = {
  // Death Knight: Blood, Frost, Unholy (Runic Power)
  250: 6,
  251: 6,
  252: 6,
  // Demon Hunter: Havoc, Vengeance, Devourer (Fury)
  577: 17,
  581: 17,
  1480: 17,
  // Druid: Balance (Astral Power), Feral (Energy), Guardian (Rage), Restoration (Mana)
  102: 8,
  103: 3,
  104: 1,
  105: 0,
  // Evoker: Devastation (Essence), Preservation (Essence), Augmentation (Essence)
  1467: 19,
  1468: 19,
  1473: 19,
  // Hunter: Beast Mastery, Marksmanship, Survival (Focus)
  253: 2,
  254: 2,
  255: 2,
  // Mage: Arcane (Arcane Charges), Fire, Frost (Mana)
  62: 16,
  63: 0,
  64: 0,
  // Monk: Brewmaster (Energy), Windwalker (Chi), Mistweaver (Mana)
  268: 3,
  269: 12,
  270: 0,
  // Paladin: Holy, Protection, Retribution (Holy Power)
  65: 9,
  66: 9,
  70: 9,
  // Priest: Discipline, Holy (Mana), Shadow (Insanity)
  256: 0,
  257: 0,
  258: 13,
  // Rogue: Assassination, Outlaw, Subtlety (Energy)
  259: 3,
  260: 3,
  261: 3,
  // Shaman: Elemental, Enhancement (Maelstrom), Restoration (Mana)
  262: 11,
  263: 11,
  264: 0,
  // Warlock: Affliction, Demonology, Destruction (Soul Shards)
  265: 7,
  266: 7,
  267: 7,
  // Warrior: Arms, Fury, Protection (Rage)
  71: 1,
  72: 1,
  73: 1,
};
