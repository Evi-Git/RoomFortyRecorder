/**
 * [RoomFortyRecorder] Pull desk: decides which combat log lines from a raid
 * pull are sent to the guild server for the pull report.
 *
 * A full Mythic pull logs roughly 10-15 MB a minute, mostly heals, auras and
 * raid damage to the boss. The report only needs:
 *   - the encounter start/end and who was in the pull,
 *   - every damage hit on a player (death recaps, avoidable damage),
 *   - player deaths,
 *   - player casts (did they press their assigned cooldown),
 *   - enemy casts (boss ability timing),
 *   - a sample of damage to enemies, one per enemy per second (boss HP).
 *
 * The filter works on raw lines so it adds almost nothing to the app's
 * per-line cost, and has no Electron dependencies so it can be tested.
 */

const ALWAYS = new Set(['ENCOUNTER_START', 'ENCOUNTER_END', 'COMBATANT_INFO']);

// Damage on players: everything. Skips the *_SUPPORT duplicates that
// Augmentation evokers generate.
const PLAYER_DAMAGE = new Set([
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE',
  'SPELL_INSTAKILL',
  'ENVIRONMENTAL_DAMAGE',
]);

// Damage on enemies, sampled for HP. SWING_DAMAGE_LANDED (not SWING_DAMAGE)
// is the swing event whose advanced fields describe the target.
const ENEMY_DAMAGE = new Set([
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE_LANDED',
]);

// Holy priest "death" auras (Spirit of Redemption, Restitution).
const PRIEST_DEATH_AURAS = new Set(['27827', '211319']);

const ENEMY_SAMPLE_MS = 1000;

/**
 * Splits off the first `count` comma-separated fields after the timestamp,
 * honouring quotes. Enough for the GUIDs and spell ID we filter on; the rest
 * of the line is never parsed here.
 */
export const leadingFields = (line: string, count: number): string[] => {
  const start = line.indexOf('  ');
  if (start < 0) return [];

  const fields: string[] = [];
  let value = '';
  let quoted = false;

  for (let i = start + 2; i < line.length && fields.length < count; i++) {
    const char = line[i];

    if (quoted) {
      if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  if (fields.length < count && value) fields.push(value);
  return fields;
};

/**
 * Milliseconds from a combat log timestamp, for sampling only. Only the
 * time of day matters here.
 */
const timeOfDayMs = (line: string): number => {
  const match = /\s(\d+):(\d+):(\d+)(?:\.(\d+))?/.exec(line.slice(0, 40));
  if (!match) return 0;
  const [, h, m, s, fraction] = match;
  const ms = fraction ? Number(`0.${fraction}`) * 1000 : 0;
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
};

export default class PullLogFilter {
  private lastEnemySample = new Map<string, number>();

  /** Returns true if this raw combat log line belongs in the pull upload. */
  public keep(line: string): boolean {
    const [event, srcGuid = '', , , , destGuid = '', , , , spellId = ''] =
      leadingFields(line, 10);

    if (!event) return false;
    if (ALWAYS.has(event)) return true;

    const destIsPlayer = destGuid.startsWith('Player-');

    if (event === 'UNIT_DIED') return destIsPlayer;

    if (event === 'SPELL_CAST_SUCCESS' || event === 'SPELL_CAST_START') {
      if (srcGuid.startsWith('Player-')) return event === 'SPELL_CAST_SUCCESS';
      return srcGuid.startsWith('Creature-') || srcGuid.startsWith('Vehicle-');
    }

    if (event === 'SPELL_AURA_APPLIED') {
      return destIsPlayer && PRIEST_DEATH_AURAS.has(spellId);
    }

    if (destIsPlayer && PLAYER_DAMAGE.has(event)) return true;

    if (
      ENEMY_DAMAGE.has(event) &&
      (destGuid.startsWith('Creature-') || destGuid.startsWith('Vehicle-'))
    ) {
      const now = timeOfDayMs(line);
      const last = this.lastEnemySample.get(destGuid);
      // Also resample if the clock went backwards (midnight).
      if (last !== undefined && now >= last && now - last < ENEMY_SAMPLE_MS) {
        return false;
      }
      this.lastEnemySample.set(destGuid, now);
      return true;
    }

    return false;
  }
}
