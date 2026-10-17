import { Flavour, Metadata, RaidInstanceType, SpellTimeline } from 'main/types';
import Combatant from '../main/Combatant';
import { getLocalePhrase, Language } from '../localisation/translations';
import { instanceDifficulty, raidInstances } from '../main/constants';

import { VideoCategory } from '../types/VideoCategory';
import Activity from './Activity';
import { Phrase } from 'localisation/phrases';
import { app } from 'electron';
import LogLine from 'parsing/LogLine';

/**
 * Class representing a raid encounter.
 */
export default class RaidEncounter extends Activity {
  private _difficultyID: number;

  private _encounterID: number;

  private _encounterName: string;

  /**
   * A simple encounter can be tracked purely by the boss HP.
   */
  protected simpleEncounterProgress = true;

  /**
   * If the boss isn't the highest HP unit in the encounter, then set this.
   */
  protected bossUnitId = -1;

  /**
   * Most encounters the boss is the highest HP unit, so track that as the
   * criteria for progress updates.
   */
  private encounterMaxHp = -1;

  /**
   * The actual progress of the encounter as a percent. Usually this is just
   * boss HP but it can be more complex for some encounters.
   */
  private encounterProgressPercent = 100;

  /**
   * Exists for handling the big shield at the start of the Gallywix encounter,
   * as there are no damage SPELL_DAMAGE events for a while due to the absorb.
   */
  private static minRetailBossHp = 100 * 10 ** 6;

  /**
   * [RoomFortyRecorder] Spell timeline: boss/enemy casts and the recording
   * player's casts, for the timeline under the video player.
   */
  private static readonly maxTimelineCasts = 8000;

  private timeline: SpellTimeline = {
    v: 1,
    sources: [],
    spells: {},
    casts: [],
  };

  private timelineSourceIndex = new Map<string, number>();

  // NPC with the highest max HP seen this pull: almost always the boss.
  private timelineBossNpcId = -1;

  private timelineBossMaxHp = -1;

  public constructor(
    startDate: Date,
    encounterID: number,
    encounterName: string,
    difficultyID: number,
    flavour: Flavour,
  ) {
    super(startDate, VideoCategory.Raids, flavour);
    this._difficultyID = difficultyID;
    this._encounterID = encounterID;
    this._encounterName = encounterName;
    this.overrun = 3; // Even for wipes it's nice to have some overrun.
  }

  get difficultyID() {
    return this._difficultyID;
  }

  get encounterID() {
    return this._encounterID;
  }

  get encounterName() {
    return this._encounterName;
  }

  /** [RoomFortyRecorder] Current progress, used by the pull desk. */
  get bossPercent() {
    return this.encounterProgressPercent;
  }

  get zoneID(): number {
    if (!this.encounterID) {
      console.warn("[RaidEncounter] EncounterID not set, can't get zone ID");
    }

    let zoneID = 0;

    raidInstances.every((raid) => {
      if (raid.encounters[this.encounterID]) {
        zoneID = raid.zoneId;
        return false;
      }

      return true;
    });

    return zoneID;
  }

  get raid(): RaidInstanceType {
    const raids = raidInstances.filter((raid) =>
      Object.prototype.hasOwnProperty.call(raid.encounters, this.encounterID),
    );

    const raid = raids.pop();

    if (!raid) {
      console.warn("Encounter not found in known raids, can't get raid name");

      const unknownRaid: RaidInstanceType = {
        zoneId: 0,
        name: 'Unknown Raid',
        shortName: 'Unknown Raid',
        encounters: {},
      };

      return unknownRaid;
    }

    return raid;
  }

  get resultInfo() {
    if (this.result === undefined) {
      throw new Error('[RaidEncounter] Tried to get result info but no result');
    }

    const language = this.cfg.get<string>('language') as Language;

    if (this.result) {
      return getLocalePhrase(language, Phrase.Kill);
    }

    return getLocalePhrase(language, Phrase.Wipe);
  }

  get difficulty() {
    const isRecognisedDifficulty = Object.prototype.hasOwnProperty.call(
      instanceDifficulty,
      this.difficultyID,
    );

    if (!isRecognisedDifficulty) {
      throw new Error(
        `[RaidEncounters] Unknown difficulty ID: ${this.difficultyID}`,
      );
    }

    return instanceDifficulty[this.difficultyID];
  }

  getMetadata(): Metadata {
    const rawCombatants = Array.from(this.combatantMap.values()).map(
      (combatant: Combatant) => combatant.getRaw(),
    );

    return {
      category: VideoCategory.Raids,
      zoneID: this.zoneID,
      zoneName: this.raid.shortName,
      flavour: this.flavour,
      encounterID: this.encounterID,
      encounterName: this.encounterName,
      difficultyID: this.difficultyID,
      difficulty: this.difficulty.difficulty,
      duration: this.duration,
      result: this.result,
      player: this.player.getRaw(),
      deaths: this.deaths,
      overrun: this.overrun,
      combatants: rawCombatants,
      start: this.startDate.getTime(),
      uniqueHash: this.getUniqueHash(),
      bossPercent: this.encounterProgressPercent,
      appVersion: app.getVersion(),
      timeline: this.buildTimeline(),
    };
  }

  getFileName(): string {
    let fileName = `${this.encounterName} [${this.difficulty.difficulty}] (${this.resultInfo})`;

    if (this.raid.name !== 'Unknown Raid') {
      fileName = `${this.raid.name}, ${fileName}`;
    }

    try {
      if (this.player.name !== undefined) {
        fileName = `${this.player.name} - ${fileName}`;
      }
    } catch {
      console.warn('[RaidEncounter] Failed to get player combatant');
    }

    return fileName;
  }

  /**
   * Get the NPC ID from a GUID. GUID looks like:
   *  "Creature-0-4244-2913-38715-240387-000073A7B0"
   * The stable encounter ID is the 5th hypen seperated element.
   */
  protected getNpcIdFromGuid(guid: string): number {
    return parseInt(guid.split('-')[5], 10);
  }

  public onSpellDamage(spellDamageEvent: LogLine): void {
    this.trackTimelineBoss(spellDamageEvent);

    if (!this.simpleEncounterProgress) {
      return;
    }

    const unitMaxHp = parseInt(spellDamageEvent.arg(15), 10);
    const unitCurrentHp = parseInt(spellDamageEvent.arg(14), 10);

    if (this.bossUnitId > 0) {
      const guid = spellDamageEvent.arg(5);
      const unitId = this.getNpcIdFromGuid(guid);

      if (unitId === this.bossUnitId) {
        this.encounterProgressPercent = Math.round(
          (100 * unitCurrentHp) / unitMaxHp,
        );
      }

      return;
    }

    // We don't know the boss unit name so fall back to assuming the
    // unit with the highest max HP is the boss, which is true for 90%
    // of encounters.
    if (
      this.flavour === Flavour.Retail &&
      unitMaxHp < RaidEncounter.minRetailBossHp
    ) {
      // Assume that if the HP is less than 100 million then it's not a boss.
      // That avoids us marking bosses as 0% when they haven't been touched
      // yet, i.e. short pulls on Gallywix before the shield is broken and we are
      // yet to see SPELL_DAMAGE events (and instead get SPELL_ABSORBED). Only do
      return;
    }

    if (unitMaxHp < this.encounterMaxHp) {
      // This unit has less max HP than the highest HP unit.
      return;
    }

    this.encounterMaxHp = unitMaxHp;
    this.encounterProgressPercent = Math.round(
      (100 * unitCurrentHp) / unitMaxHp,
    );
  }

  protected setEncounterPercent(percent: number): void {
    if (this.simpleEncounterProgress) {
      throw new Error('Bad programmer, only call this on complex encounters.');
    }

    const updated = Math.round(percent);

    if (updated < this.encounterProgressPercent) {
      // Some encounters like Coiled Altar heal, don't backtrack the progress.
      this.encounterProgressPercent = updated;
    }
  }

  /**
   * [RoomFortyRecorder] Record a cast for the spell timeline. Called by the
   * log handler for SPELL_CAST_START (0) and SPELL_CAST_SUCCESS (1), before
   * any encounter-specific handling.
   */
  public recordTimelineCast(line: LogLine, kind: 0 | 1) {
    if (this.timeline.casts.length >= RaidEncounter.maxTimelineCasts) return;

    const srcGUID = String(line.arg(1) || '');
    const srcFlags = parseInt(line.arg(3), 16);
    const isPlayer = Boolean(this.playerGUID) && srcGUID === this.playerGUID;
    const isNpc =
      srcGUID.startsWith('Creature-') || srcGUID.startsWith('Vehicle-');
    // COMBATLOG_OBJECT_REACTION_HOSTILE
    const isHostile = Number.isFinite(srcFlags) && (srcFlags & 0x40) !== 0;

    if (!isPlayer && !(isNpc && isHostile)) return;

    // Player cast starts are noise next to the successes; keep successes only.
    if (isPlayer && kind === 0) return;

    const spellId = parseInt(line.arg(9), 10);
    if (!Number.isFinite(spellId) || spellId <= 0) return;

    const seconds =
      (RaidEncounter.preciseTime(line) - this.startDate.getTime()) / 1000;
    if (seconds < 0) return;

    let sourceKey = 'player';
    let npcId: number | undefined;

    if (!isPlayer) {
      npcId = this.getNpcIdFromGuid(srcGUID);
      sourceKey = `npc-${npcId}`;
    }

    let sourceIndex = this.timelineSourceIndex.get(sourceKey);

    if (sourceIndex === undefined) {
      sourceIndex = this.timeline.sources.length;
      this.timelineSourceIndex.set(sourceKey, sourceIndex);
      this.timeline.sources.push({
        name: String(line.arg(2) || 'Unknown').split('-')[0],
        kind: isPlayer ? 'player' : 'enemy',
        npcId,
      });
    }

    this.timeline.spells[String(spellId)] ??= String(line.arg(10) || spellId);
    this.timeline.casts.push([
      Math.round(seconds * 10),
      spellId,
      sourceIndex,
      kind,
    ]);
  }

  private trackTimelineBoss(line: LogLine) {
    const guid = String(line.arg(5) || '');
    if (!guid.startsWith('Creature-') && !guid.startsWith('Vehicle-')) return;
    const maxHp = parseInt(line.arg(15), 10);

    if (Number.isFinite(maxHp) && maxHp > this.timelineBossMaxHp) {
      this.timelineBossMaxHp = maxHp;
      this.timelineBossNpcId = this.getNpcIdFromGuid(guid);
    }
  }

  private buildTimeline(): SpellTimeline | undefined {
    if (this.timeline.casts.length === 0) return undefined;
    const bossNpcId =
      this.bossUnitId > 0 ? this.bossUnitId : this.timelineBossNpcId;

    return {
      ...this.timeline,
      sources: this.timeline.sources.map((source) =>
        source.kind === 'enemy' && source.npcId === bossNpcId
          ? { ...source, kind: 'boss' }
          : source,
      ),
    };
  }

  /**
   * LogLine.date() drops milliseconds; the timeline wants them. Timestamps
   * look like "7/27/2024 21:39:13.0951", newer ones may end in a timezone
   * offset like "13.095-4".
   */
  private static preciseTime(line: LogLine) {
    const base = line.date().getTime();
    const fraction = /:\d{2}\.(\d+)/.exec(line.timestamp);
    return fraction ? base + parseFloat(`0.${fraction[1]}`) * 1000 : base;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  public onSpellCastStart(line: LogLine) {}

  public onSpellCastSuccess(line: LogLine) {}

  public onUnitDied(line: LogLine) {}

  public onSpellAuraApplied(line: LogLine) {}

  public onSpellAuraRemoved(line: LogLine) {}
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
