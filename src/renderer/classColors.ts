import type { WoWCharacterClassType } from 'main/constants';

/**
 * [RoomFortyRecorder] Class colours for the app, lifted where Blizzard's
 * own colour is hard to read on walnut (Death Knight, Demon Hunter, Shaman,
 * Warlock, Evoker; Mage and Warrior to match). Same hue as Blizzard's; each
 * is at least 4.5:1 on a selected row (`panel-line`). `main/constants`
 * keeps Blizzard's exact values (upstream); the renderer reads these, via
 * `getWoWClassColor` in rendererutils.
 */
export const READABLE_CLASS_COLOR: Record<WoWCharacterClassType, string> = {
  DEATHKNIGHT: '#F0626C',
  DEMONHUNTER: '#C77DEB',
  DRUID: '#FF7C0A',
  HUNTER: '#AAD372',
  MAGE: '#5CC8F0',
  MONK: '#00FF98',
  PALADIN: '#F48CBA',
  PRIEST: '#FFFFFF',
  ROGUE: '#FFF468',
  SHAMAN: '#3E9BFF',
  WARLOCK: '#9A9BF2',
  WARRIOR: '#D6A774',
  EVOKER: '#4DB39B',
  UNKNOWN: 'grey',
};
