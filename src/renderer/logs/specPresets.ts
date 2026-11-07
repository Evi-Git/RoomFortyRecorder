/**
 * [RoomFortyRecorder] Logs → Analyze: starting widgets per spec (1.9.111).
 *
 * GENERATED from WoWAnalyzer (github.com/WoWAnalyzer/WoWAnalyzer, 2026-11-07):
 * each spec's graded abilities (its Abilities module: cast efficiency
 * suggestions, cooldowns, charges and recommended efficiency) and the
 * talent entry IDs from its talent tables. Only facts (spell IDs, names,
 * cooldowns) are taken. Regenerate rather than hand-edit; the guild
 * preset (shared on the server) overrides these.
 */
import type { WidgetSpec } from './analyze';

/** spec ID -> widgets. */
export const SPEC_PRESETS: Record<number, WidgetSpec[]> = {
  '250': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-50842',
      kind: 'castEfficiency',
      spell: {
        name: 'Blood Boil',
        id: 50842,
      },
      charges: 2,
      target: 0.85,
      talent: [96305],
    },
    {
      id: 'ce-49028',
      kind: 'castEfficiency',
      spell: {
        name: 'Dancing Rune Weapon',
        id: 49028,
      },
      cooldown: 90.0,
      target: 0.9,
      talent: [96269],
    },
    {
      id: 'ce-43265',
      kind: 'castEfficiency',
      spell: {
        name: 'Death and Decay',
        id: 43265,
      },
      cooldown: 15.0,
      target: 0.8,
      optional: true,
    },
  ],
  '251': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
  ],
  '252': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-1247378',
      kind: 'castEfficiency',
      spell: {
        name: 'Putrefy',
        id: 1247378,
      },
      cooldown: 30.0,
      talent: [133522],
    },
    {
      id: 'ce-1233448',
      kind: 'castEfficiency',
      spell: {
        name: 'Dark Transformation',
        id: 1233448,
      },
      cooldown: 45.0,
      talent: [96322],
    },
    {
      id: 'ce-42650',
      kind: 'castEfficiency',
      spell: {
        name: 'Army of the Dead',
        id: 42650,
      },
      cooldown: 90.0,
      talent: [96333],
    },
  ],
  '1480': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-232893',
      kind: 'castEfficiency',
      spell: {
        name: 'Felblade',
        id: 232893,
      },
      target: 0.95,
      talent: [112928, 134271],
    },
  ],
  '577': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-258860',
      kind: 'castEfficiency',
      spell: {
        name: 'Essence Break',
        id: 258860,
      },
      cooldown: 40.0,
      target: 0.95,
      talent: [112956],
    },
    {
      id: 'ce-198013',
      kind: 'castEfficiency',
      spell: {
        name: 'Eye Beam',
        id: 198013,
      },
      cooldown: 40.0,
      target: 0.95,
      talent: [112939],
    },
    {
      id: 'ce-370965',
      kind: 'castEfficiency',
      spell: {
        name: 'The Hunt',
        id: 370965,
      },
      cooldown: 90.0,
      target: 0.8,
      talent: [112830],
    },
    {
      id: 'ce-200166',
      kind: 'castEfficiency',
      spell: {
        name: 'Metamorphosis',
        id: 200166,
      },
      target: 0.8,
    },
    {
      id: 'ce-188499',
      kind: 'castEfficiency',
      spell: {
        name: 'Blade Dance',
        id: 188499,
      },
      target: 0.95,
      optional: true,
    },
    {
      id: 'ce-232893',
      kind: 'castEfficiency',
      spell: {
        name: 'Felblade',
        id: 232893,
      },
      target: 0.95,
      talent: [112928, 134271],
    },
  ],
  '581': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-258920',
      kind: 'castEfficiency',
      spell: {
        name: 'Immolation Aura',
        id: 258920,
      },
      target: 0.9,
    },
    {
      id: 'ce-263642',
      kind: 'castEfficiency',
      spell: {
        name: 'Fracture',
        id: 263642,
      },
      charges: 2,
      target: 0.9,
    },
    {
      id: 'ce-204596',
      kind: 'castEfficiency',
      spell: {
        name: 'Sigil of Flame',
        id: 204596,
      },
      target: 0.9,
      optional: true,
    },
    {
      id: 'ce-212084',
      kind: 'castEfficiency',
      spell: {
        name: 'Fel Devastation',
        id: 212084,
      },
      cooldown: 40.0,
      target: 0.8,
      talent: [112908],
    },
    {
      id: 'ce-452486',
      kind: 'castEfficiency',
      spell: {
        name: 'Fel Desolation',
        id: 452486,
      },
      cooldown: 40.0,
      target: 0.8,
      optional: true,
    },
    {
      id: 'ce-390163',
      kind: 'castEfficiency',
      spell: {
        name: 'Sigil of Spite',
        id: 390163,
      },
      target: 0.9,
      talent: [112894],
    },
    {
      id: 'ce-232893',
      kind: 'castEfficiency',
      spell: {
        name: 'Felblade',
        id: 232893,
      },
      target: 0.95,
      talent: [112928, 134271],
    },
  ],
  '102': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-205636',
      kind: 'castEfficiency',
      spell: {
        name: 'Force of Nature',
        id: 205636,
      },
      target: 0.9,
      talent: [109844],
    },
    {
      id: 'ce-202770',
      kind: 'castEfficiency',
      spell: {
        name: 'Fury of Elune',
        id: 202770,
      },
      target: 0.9,
      talent: [109859],
    },
    {
      id: 'ce-274281',
      kind: 'castEfficiency',
      spell: {
        name: 'New Moon',
        id: 274281,
      },
      cooldown: 20.0,
      charges: 3,
      target: 0.9,
      talent: [109860],
    },
    {
      id: 'ce-88747',
      kind: 'castEfficiency',
      spell: {
        name: 'Wild Mushroom',
        id: 88747,
      },
      cooldown: 30.0,
      charges: 3,
      target: 0.9,
      talent: [128232],
    },
  ],
  '103': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-102543',
      kind: 'castEfficiency',
      spell: {
        name: 'Incarnation: Avatar of Ashamane',
        id: 102543,
      },
      target: 0.9,
      talent: [103178],
    },
    {
      id: 'ce-106951',
      kind: 'castEfficiency',
      spell: {
        name: 'Berserk',
        id: 106951,
      },
      target: 0.9,
      talent: [103162],
    },
    {
      id: 'ce-391528',
      kind: 'castEfficiency',
      spell: {
        name: 'Convoke the Spirits',
        id: 391528,
      },
      target: 0.9,
      talent: [109838, 103177, 103200, 103119],
    },
    {
      id: 'ce-5217',
      kind: 'castEfficiency',
      spell: {
        name: "Tiger's Fury",
        id: 5217,
      },
      cooldown: 30.0,
      target: 0.9,
      talent: [103188],
    },
    {
      id: 'ce-274837',
      kind: 'castEfficiency',
      spell: {
        name: 'Feral Frenzy',
        id: 274837,
      },
      target: 0.9,
      talent: [103175],
    },
    {
      id: 'ce-1243807',
      kind: 'castEfficiency',
      spell: {
        name: 'Frantic Frenzy',
        id: 1243807,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [134211],
    },
    {
      id: 'ce-1244258',
      kind: 'castEfficiency',
      spell: {
        name: 'Chomp',
        id: 1244258,
      },
      cooldown: 20.0,
      target: 0.8,
      talent: [134212],
    },
  ],
  '104': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-33917',
      kind: 'castEfficiency',
      spell: {
        name: 'Mangle',
        id: 33917,
      },
      target: 0.7,
      optional: true,
    },
    {
      id: 'ce-77758',
      kind: 'castEfficiency',
      spell: {
        name: 'Thrash',
        id: 77758,
      },
      optional: true,
    },
  ],
  '105': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
    {
      id: 'ce-33891',
      kind: 'castEfficiency',
      spell: {
        name: 'Incarnation: Tree of Life',
        id: 33891,
      },
      cooldown: 180.0,
      target: 0.8,
      talent: [103120],
    },
    {
      id: 'ce-29166',
      kind: 'castEfficiency',
      spell: {
        name: 'Innervate',
        id: 29166,
      },
      cooldown: 180.0,
      target: 0.8,
      talent: [103324],
    },
    {
      id: 'ce-108291',
      kind: 'castEfficiency',
      spell: {
        name: 'Heart of the Wild',
        id: 108291,
      },
      cooldown: 300.0,
      talent: [103309],
    },
  ],
  '1473': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-404977',
      kind: 'castEfficiency',
      spell: {
        name: 'Time Skip',
        id: 404977,
      },
      target: 0.95,
      talent: [115533],
    },
    {
      id: 'ce-382266',
      kind: 'castEfficiency',
      spell: {
        name: 'Fire Breath',
        id: 382266,
      },
      target: 0.95,
      optional: true,
    },
  ],
  '1467': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-375087',
      kind: 'castEfficiency',
      spell: {
        name: 'Dragonrage',
        id: 375087,
      },
      cooldown: 120.0,
      target: 0.95,
      talent: [115643],
    },
    {
      id: 'ce-382266',
      kind: 'castEfficiency',
      spell: {
        name: 'Fire Breath',
        id: 382266,
      },
      target: 0.95,
      optional: true,
    },
  ],
  '1468': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
    {
      id: 'ce-359816',
      kind: 'castEfficiency',
      spell: {
        name: 'Dream Flight',
        id: 359816,
      },
      cooldown: 120.0,
      talent: [115573],
    },
    {
      id: 'ce-370537',
      kind: 'castEfficiency',
      spell: {
        name: 'Stasis',
        id: 370537,
      },
      cooldown: 90.0,
      talent: [133527],
    },
    {
      id: 'ce-366155',
      kind: 'castEfficiency',
      spell: {
        name: 'Reversion',
        id: 366155,
      },
      cooldown: 9.0,
      charges: 2,
      target: 0.6,
      talent: [115652],
    },
    {
      id: 'ce-382266',
      kind: 'castEfficiency',
      spell: {
        name: 'Fire Breath',
        id: 382266,
      },
      target: 0.95,
      optional: true,
    },
  ],
  '253': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-19574',
      kind: 'castEfficiency',
      spell: {
        name: 'Bestial Wrath',
        id: 19574,
      },
      target: 0.9,
      talent: [126402],
    },
    {
      id: 'ce-34026',
      kind: 'castEfficiency',
      spell: {
        name: 'Kill Command',
        id: 34026,
      },
      target: 0.85,
      talent: [126408],
    },
  ],
  '254': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-288613',
      kind: 'castEfficiency',
      spell: {
        name: 'Trueshot',
        id: 288613,
      },
      target: 0.95,
      talent: [128367],
    },
    {
      id: 'ce-19434',
      kind: 'castEfficiency',
      spell: {
        name: 'Aimed Shot',
        id: 19434,
      },
      charges: 2,
      target: 0.9,
      talent: [128404],
    },
    {
      id: 'ce-257044',
      kind: 'castEfficiency',
      spell: {
        name: 'Rapid Fire',
        id: 257044,
      },
      cooldown: 16.0,
      target: 0.9,
      talent: [128383],
    },
    {
      id: 'ce-260243',
      kind: 'castEfficiency',
      spell: {
        name: 'Volley',
        id: 260243,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [128376],
    },
  ],
  '255': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-1253859',
      kind: 'castEfficiency',
      spell: {
        name: 'Takedown',
        id: 1253859,
      },
      target: 0.85,
      talent: [135514],
    },
    {
      id: 'ce-259489',
      kind: 'castEfficiency',
      spell: {
        name: 'Kill Command',
        id: 259489,
      },
      charges: 2,
      talent: [126314],
    },
    {
      id: 'ce-259495',
      kind: 'castEfficiency',
      spell: {
        name: 'Wildfire Bomb',
        id: 259495,
      },
      target: 0.85,
      talent: [126324],
    },
  ],
  '62': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-365350',
      kind: 'castEfficiency',
      spell: {
        name: 'Arcane Surge',
        id: 365350,
      },
      cooldown: 90.0,
      target: 0.9,
      talent: [126519],
    },
    {
      id: 'ce-12051',
      kind: 'castEfficiency',
      spell: {
        name: 'Evocation',
        id: 12051,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [126524],
    },
    {
      id: 'ce-153626',
      kind: 'castEfficiency',
      spell: {
        name: 'Arcane Orb',
        id: 153626,
      },
      cooldown: 20.0,
      talent: [128689],
    },
    {
      id: 'ce-321507',
      kind: 'castEfficiency',
      spell: {
        name: 'Touch of the Magi',
        id: 321507,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [126538],
    },
  ],
  '63': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-190319',
      kind: 'castEfficiency',
      spell: {
        name: 'Combustion',
        id: 190319,
      },
      target: 0.9,
      talent: [124756],
    },
    {
      id: 'ce-2136',
      kind: 'castEfficiency',
      spell: {
        name: 'Fire Blast',
        id: 2136,
      },
      target: 0.9,
      talent: [124750],
    },
  ],
  '64': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-205021',
      kind: 'castEfficiency',
      spell: {
        name: 'Ray of Frost',
        id: 205021,
      },
      cooldown: 60.0,
      talent: [80216],
    },
    {
      id: 'ce-153595',
      kind: 'castEfficiency',
      spell: {
        name: 'Comet Storm',
        id: 153595,
      },
      target: 0.9,
      talent: [80251],
    },
    {
      id: 'ce-84714',
      kind: 'castEfficiency',
      spell: {
        name: 'Frozen Orb',
        id: 84714,
      },
      cooldown: 60.0,
      target: 0.9,
      talent: [80242],
    },
  ],
  '268': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
  ],
  '270': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
    {
      id: 'ce-116680',
      kind: 'castEfficiency',
      spell: {
        name: 'Thunder Focus Tea',
        id: 116680,
      },
      cooldown: 30.0,
      talent: [124921],
    },
    {
      id: 'ce-322118',
      kind: 'castEfficiency',
      spell: {
        name: "Invoke Yu'lon, the Jade Serpent",
        id: 322118,
      },
      talent: [124915],
    },
    {
      id: 'ce-325197',
      kind: 'castEfficiency',
      spell: {
        name: 'Invoke Chi-Ji, the Red Crane',
        id: 325197,
      },
      talent: [124914],
    },
    {
      id: 'ce-116849',
      kind: 'castEfficiency',
      spell: {
        name: 'Life Cocoon',
        id: 116849,
      },
      talent: [124875],
    },
    {
      id: 'ce-115151',
      kind: 'castEfficiency',
      spell: {
        name: 'Renewing Mist',
        id: 115151,
      },
      cooldown: 9.0,
      optional: true,
    },
    {
      id: 'ce-115294',
      kind: 'castEfficiency',
      spell: {
        name: 'Mana Tea',
        id: 115294,
      },
      talent: [124920],
    },
    {
      id: 'ce-467307',
      kind: 'castEfficiency',
      spell: {
        name: 'Rushing Wind Kick',
        id: 467307,
      },
      talent: [128221],
    },
  ],
  '269': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-1249625',
      kind: 'castEfficiency',
      spell: {
        name: 'Zenith',
        id: 1249625,
      },
      charges: 2,
      target: 0.95,
      talent: [124826],
    },
    {
      id: 'ce-123904',
      kind: 'castEfficiency',
      spell: {
        name: 'Invoke Xuen, the White Tiger',
        id: 123904,
      },
      target: 0.95,
      talent: [125062],
    },
    {
      id: 'ce-392983',
      kind: 'castEfficiency',
      spell: {
        name: 'Strike of the Windlord',
        id: 392983,
      },
      target: 0.95,
      talent: [125014],
    },
    {
      id: 'ce-1248989',
      kind: 'castEfficiency',
      spell: {
        name: 'Celestial Conduit',
        id: 1248989,
      },
      cooldown: 90.0,
      target: 0.95,
      talent: [136745],
    },
    {
      id: 'ce-113656',
      kind: 'castEfficiency',
      spell: {
        name: 'Fists of Fury',
        id: 113656,
      },
      target: 0.9,
      talent: [125026],
    },
    {
      id: 'ce-107428',
      kind: 'castEfficiency',
      spell: {
        name: 'Rising Sun Kick',
        id: 107428,
      },
      talent: [124985],
    },
    {
      id: 'ce-152175',
      kind: 'castEfficiency',
      spell: {
        name: 'Whirling Dragon Punch',
        id: 152175,
      },
      target: 0.85,
      talent: [134452],
    },
    {
      id: 'ce-322101',
      kind: 'castEfficiency',
      spell: {
        name: 'Expel Harm',
        id: 322101,
      },
      cooldown: 15.0,
      optional: true,
    },
    {
      id: 'ce-123986',
      kind: 'castEfficiency',
      spell: {
        name: 'Chi Burst',
        id: 123986,
      },
      cooldown: 30.0,
      talent: [126501],
    },
    {
      id: 'ce-1217413',
      kind: 'castEfficiency',
      spell: {
        name: 'Slicing Winds',
        id: 1217413,
      },
      cooldown: 30.0,
      target: 0.95,
      talent: [126307],
    },
    {
      id: 'ce-122470',
      kind: 'castEfficiency',
      spell: {
        name: 'Touch of Karma',
        id: 122470,
      },
      cooldown: 90.0,
      target: 0.6,
    },
  ],
  '65': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
    {
      id: 'ce-31884',
      kind: 'castEfficiency',
      spell: {
        name: 'Avenging Wrath',
        id: 31884,
      },
      cooldown: 120.0,
      talent: [102569, 102448, 102519],
    },
    {
      id: 'ce-375576',
      kind: 'castEfficiency',
      spell: {
        name: 'Divine Toll',
        id: 375576,
      },
      talent: [102465, 136496, 135564],
    },
    {
      id: 'ce-31821',
      kind: 'castEfficiency',
      spell: {
        name: 'Aura Mastery',
        id: 31821,
      },
      target: 0.6,
      talent: [102548],
    },
    {
      id: 'ce-216331',
      kind: 'castEfficiency',
      spell: {
        name: 'Avenging Crusader',
        id: 216331,
      },
      cooldown: 60.0,
      talent: [102568],
    },
    {
      id: 'ce-1241275',
      kind: 'castEfficiency',
      spell: {
        name: "Tyr's Deliverance",
        id: 1241275,
      },
      cooldown: 90.0,
      talent: [102573],
    },
    {
      id: 'ce-20473',
      kind: 'castEfficiency',
      spell: {
        name: 'Holy Shock',
        id: 20473,
      },
      target: 0.8,
      talent: [102534],
    },
    {
      id: 'ce-114165',
      kind: 'castEfficiency',
      spell: {
        name: 'Holy Prism',
        id: 114165,
      },
      cooldown: 30.0,
      talent: [133480],
    },
  ],
  '66': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-31884',
      kind: 'castEfficiency',
      spell: {
        name: 'Avenging Wrath',
        id: 31884,
      },
      cooldown: 120.0,
      target: 0.9,
      talent: [102569, 102448, 102519],
    },
    {
      id: 'ce-389539',
      kind: 'castEfficiency',
      spell: {
        name: 'Sentinel',
        id: 389539,
      },
      cooldown: 120.0,
      target: 0.9,
      talent: [102466],
    },
    {
      id: 'ce-375576',
      kind: 'castEfficiency',
      spell: {
        name: 'Divine Toll',
        id: 375576,
      },
      cooldown: 60.0,
      target: 0.9,
      talent: [102465, 136496, 135564],
    },
    {
      id: 'ce-31935',
      kind: 'castEfficiency',
      spell: {
        name: "Avenger's Shield",
        id: 31935,
      },
      target: 0.9,
      talent: [102471],
    },
    {
      id: 'ce-275779',
      kind: 'castEfficiency',
      spell: {
        name: 'Judgment',
        id: 275779,
      },
      optional: true,
    },
  ],
  '70': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-255937',
      kind: 'castEfficiency',
      spell: {
        name: 'Wake of Ashes',
        id: 255937,
      },
      cooldown: 30.0,
      target: 0.85,
      talent: [102497],
    },
    {
      id: 'ce-31884',
      kind: 'castEfficiency',
      spell: {
        name: 'Avenging Wrath',
        id: 31884,
      },
      cooldown: 60.0,
      target: 0.9,
      talent: [102569, 102448, 102519],
    },
    {
      id: 'ce-35395',
      kind: 'castEfficiency',
      spell: {
        name: 'Crusader Strike',
        id: 35395,
      },
      charges: 2,
      optional: true,
    },
    {
      id: 'ce-20271',
      kind: 'castEfficiency',
      spell: {
        name: 'Judgment',
        id: 20271,
      },
      optional: true,
    },
    {
      id: 'ce-184575',
      kind: 'castEfficiency',
      spell: {
        name: 'Blade of Justice',
        id: 184575,
      },
      target: 0.75,
      talent: [102498],
    },
  ],
  '256': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
    {
      id: 'ce-472433',
      kind: 'castEfficiency',
      spell: {
        name: 'Evangelism',
        id: 472433,
      },
      cooldown: 90.0,
      talent: [103702],
    },
    {
      id: 'ce-421453',
      kind: 'castEfficiency',
      spell: {
        name: 'Ultimate Penitence',
        id: 421453,
      },
      cooldown: 240.0,
      talent: [116182],
    },
    {
      id: 'ce-10060',
      kind: 'castEfficiency',
      spell: {
        name: 'Power Infusion',
        id: 10060,
      },
      cooldown: 120.0,
      target: 0.8,
      talent: [103834],
    },
    {
      id: 'ce-194509',
      kind: 'castEfficiency',
      spell: {
        name: 'Power Word: Radiance',
        id: 194509,
      },
      talent: [103722],
    },
  ],
  '257': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
    {
      id: 'ce-200183',
      kind: 'castEfficiency',
      spell: {
        name: 'Apotheosis',
        id: 200183,
      },
      cooldown: 120.0,
      target: 0.3,
      talent: [103748],
    },
    {
      id: 'ce-64843',
      kind: 'castEfficiency',
      spell: {
        name: 'Divine Hymn',
        id: 64843,
      },
      target: 0.3,
      talent: [103755],
    },
    {
      id: 'ce-10060',
      kind: 'castEfficiency',
      spell: {
        name: 'Power Infusion',
        id: 10060,
      },
      target: 0.8,
      talent: [103834],
    },
    {
      id: 'ce-33076',
      kind: 'castEfficiency',
      spell: {
        name: 'Prayer of Mending',
        id: 33076,
      },
      target: 0.8,
      optional: true,
    },
    {
      id: 'ce-34861',
      kind: 'castEfficiency',
      spell: {
        name: 'Holy Word: Sanctify',
        id: 34861,
      },
      target: 0.8,
      talent: [103766],
    },
    {
      id: 'ce-2050',
      kind: 'castEfficiency',
      spell: {
        name: 'Holy Word: Serenity',
        id: 2050,
      },
      target: 0.8,
      talent: [103775],
    },
    {
      id: 'ce-120517',
      kind: 'castEfficiency',
      spell: {
        name: 'Halo',
        id: 120517,
      },
      cooldown: 60.0,
      target: 0.8,
      talent: [134273],
    },
  ],
  '258': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-228260',
      kind: 'castEfficiency',
      spell: {
        name: 'Voidform',
        id: 228260,
      },
      cooldown: 120.0,
      target: 0.95,
      talent: [103674],
    },
    {
      id: 'ce-451235',
      kind: 'castEfficiency',
      spell: {
        name: 'Voidwraith',
        id: 451235,
      },
      target: 0.9,
      talent: [123841],
    },
    {
      id: 'ce-10060',
      kind: 'castEfficiency',
      spell: {
        name: 'Power Infusion',
        id: 10060,
      },
      cooldown: 120.0,
      target: 0.95,
      talent: [103834],
    },
    {
      id: 'ce-8092',
      kind: 'castEfficiency',
      spell: {
        name: 'Mind Blast',
        id: 8092,
      },
      talent: [103865],
    },
    {
      id: 'ce-263165',
      kind: 'castEfficiency',
      spell: {
        name: 'Void Torrent',
        id: 263165,
      },
      cooldown: 30.0,
      target: 0.9,
      talent: [117287],
    },
  ],
  '259': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-385627',
      kind: 'castEfficiency',
      spell: {
        name: 'Kingsbane',
        id: 385627,
      },
      cooldown: 60.0,
      target: 0.9,
      talent: [112663],
    },
  ],
  '260': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-13750',
      kind: 'castEfficiency',
      spell: {
        name: 'Adrenaline Rush',
        id: 13750,
      },
      cooldown: 180.0,
      target: 0.9,
      talent: [112545],
    },
    {
      id: 'ce-271877',
      kind: 'castEfficiency',
      spell: {
        name: 'Blade Rush',
        id: 271877,
      },
      talent: [112535],
    },
    {
      id: 'ce-51690',
      kind: 'castEfficiency',
      spell: {
        name: 'Killing Spree',
        id: 51690,
      },
      talent: [117148],
    },
  ],
  '261': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-185313',
      kind: 'castEfficiency',
      spell: {
        name: 'Shadow Dance',
        id: 185313,
      },
      cooldown: 20.0,
      target: 0.95,
      optional: true,
    },
    {
      id: 'ce-121471',
      kind: 'castEfficiency',
      spell: {
        name: 'Shadow Blades',
        id: 121471,
      },
      cooldown: 90.0,
      talent: [112614],
    },
    {
      id: 'ce-426591',
      kind: 'castEfficiency',
      spell: {
        name: "Goremaw's Bite",
        id: 426591,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [112612],
    },
    {
      id: 'ce-280719',
      kind: 'castEfficiency',
      spell: {
        name: 'Secret Technique',
        id: 280719,
      },
      target: 0.8,
    },
    {
      id: 'ce-1856',
      kind: 'castEfficiency',
      spell: {
        name: 'Vanish',
        id: 1856,
      },
      cooldown: 120.0,
      target: 0.8,
    },
    {
      id: 'ce-1264764',
      kind: 'castEfficiency',
      spell: {
        name: 'Shuriken Tornado',
        id: 1264764,
      },
      cooldown: 60.0,
      talent: [112605],
    },
  ],
  '262': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-114050',
      kind: 'castEfficiency',
      spell: {
        name: 'Ascendance',
        id: 114050,
      },
      target: 0.9,
      talent: [101860],
    },
    {
      id: 'ce-191634',
      kind: 'castEfficiency',
      spell: {
        name: 'Stormkeeper',
        id: 191634,
      },
      target: 0.9,
      talent: [101859],
    },
    {
      id: 'ce-117014',
      kind: 'castEfficiency',
      spell: {
        name: 'Elemental Blast',
        id: 117014,
      },
      target: 0.6,
      talent: [127924],
    },
  ],
  '263': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-384352',
      kind: 'castEfficiency',
      spell: {
        name: 'Doom Winds',
        id: 384352,
      },
      cooldown: 60.0,
      target: 1.0,
      talent: [101824],
    },
  ],
  '264': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'healing',
    },
  ],
  '265': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-1257052',
      kind: 'castEfficiency',
      spell: {
        name: 'Dark Harvest',
        id: 1257052,
      },
      cooldown: 60.0,
      talent: [136120],
    },
    {
      id: 'ce-205180',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Darkglare',
        id: 205180,
      },
      cooldown: 120.0,
      target: 0.9,
      talent: [91554],
    },
    {
      id: 'ce-48181',
      kind: 'castEfficiency',
      spell: {
        name: 'Haunt',
        id: 48181,
      },
      cooldown: 15.0,
      target: 0.95,
      talent: [91552],
    },
  ],
  '266': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-265187',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Demonic Tyrant',
        id: 265187,
      },
      cooldown: 60.0,
      target: 0.9,
      talent: [125850],
    },
    {
      id: 'ce-264130',
      kind: 'castEfficiency',
      spell: {
        name: 'Power Siphon',
        id: 264130,
      },
      cooldown: 30.0,
      target: 0.9,
      talent: [136731],
    },
    {
      id: 'ce-1276452',
      kind: 'castEfficiency',
      spell: {
        name: 'Grimoire: Imp Lord',
        id: 1276452,
      },
      cooldown: 120.0,
      target: 0.9,
      talent: [136726],
    },
    {
      id: 'ce-1276467',
      kind: 'castEfficiency',
      spell: {
        name: 'Grimoire: Fel Ravager',
        id: 1276467,
      },
      cooldown: 120.0,
      target: 0.9,
      talent: [136725],
    },
    {
      id: 'ce-1276672',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Doomguard',
        id: 1276672,
      },
      cooldown: 120.0,
      target: 0.9,
      talent: [125863],
    },
    {
      id: 'ce-104316',
      kind: 'castEfficiency',
      spell: {
        name: 'Call Dreadstalkers',
        id: 104316,
      },
      cooldown: 20.0,
      target: 0.9,
      talent: [125837],
    },
    {
      id: 'ce-1251778',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Vilefiend',
        id: 1251778,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [135314],
    },
    {
      id: 'ce-455476',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Charhound',
        id: 455476,
      },
      cooldown: 30.0,
      target: 0.9,
      optional: true,
    },
    {
      id: 'ce-455465',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Gloomhound',
        id: 455465,
      },
      cooldown: 30.0,
      target: 0.9,
      optional: true,
    },
    {
      id: 'ce-196277',
      kind: 'castEfficiency',
      spell: {
        name: 'Implosion',
        id: 196277,
      },
      cooldown: 15.0,
      target: 0.9,
      talent: [125836],
    },
  ],
  '267': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-1122',
      kind: 'castEfficiency',
      spell: {
        name: 'Summon Infernal',
        id: 1122,
      },
      target: 0.9,
      talent: [91502],
    },
    {
      id: 'ce-442726',
      kind: 'castEfficiency',
      spell: {
        name: 'Malevolence',
        id: 442726,
      },
      cooldown: 60.0,
      target: 0.9,
      talent: [117439],
    },
    {
      id: 'ce-196447',
      kind: 'castEfficiency',
      spell: {
        name: 'Channel Demonfire',
        id: 196447,
      },
      target: 0.95,
      talent: [128599],
    },
    {
      id: 'ce-17962',
      kind: 'castEfficiency',
      spell: {
        name: 'Conflagrate',
        id: 17962,
      },
      charges: 2,
      target: 0.95,
      talent: [91591],
    },
    {
      id: 'ce-6353',
      kind: 'castEfficiency',
      spell: {
        name: 'Soul Fire',
        id: 6353,
      },
      target: 0.9,
      talent: [134221],
    },
    {
      id: 'ce-17877',
      kind: 'castEfficiency',
      spell: {
        name: 'Shadowburn',
        id: 17877,
      },
      target: 0.9,
      talent: [91582],
    },
  ],
  '71': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-107574',
      kind: 'castEfficiency',
      spell: {
        name: 'Avatar',
        id: 107574,
      },
      cooldown: 90.0,
      target: 0.9,
      talent: [136703, 112285, 112305],
    },
    {
      id: 'ce-167105',
      kind: 'castEfficiency',
      spell: {
        name: 'Colossus Smash',
        id: 167105,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [112144],
    },
    {
      id: 'ce-436358',
      kind: 'castEfficiency',
      spell: {
        name: 'Demolish',
        id: 436358,
      },
      cooldown: 45.0,
      target: 0.9,
      talent: [117415],
    },
    {
      id: 'ce-845',
      kind: 'castEfficiency',
      spell: {
        name: 'Cleave',
        id: 845,
      },
      target: 0.6,
      talent: [112147],
    },
    {
      id: 'ce-228920',
      kind: 'castEfficiency',
      spell: {
        name: 'Ravager',
        id: 228920,
      },
      cooldown: 90.0,
      target: 0.9,
      talent: [136702, 132880],
    },
    {
      id: 'ce-376079',
      kind: 'castEfficiency',
      spell: {
        name: "Champion's Spear",
        id: 376079,
      },
      cooldown: 90.0,
      target: 0.7,
      talent: [112247],
    },
  ],
  '72': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-1719',
      kind: 'castEfficiency',
      spell: {
        name: 'Recklessness',
        id: 1719,
      },
      cooldown: 90.0,
      target: 0.95,
      talent: [112281],
    },
    {
      id: 'ce-446035',
      kind: 'castEfficiency',
      spell: {
        name: 'Bladestorm',
        id: 446035,
      },
      cooldown: 90.0,
      target: 0.95,
      talent: [112314, 112284],
    },
    {
      id: 'ce-107574',
      kind: 'castEfficiency',
      spell: {
        name: 'Avatar',
        id: 107574,
      },
      cooldown: 90.0,
      target: 0.95,
      talent: [136703, 112285, 112305],
    },
    {
      id: 'ce-376079',
      kind: 'castEfficiency',
      spell: {
        name: "Champion's Spear",
        id: 376079,
      },
      cooldown: 90.0,
      target: 0.95,
      talent: [112247],
    },
    {
      id: 'ce-385059',
      kind: 'castEfficiency',
      spell: {
        name: "Odyn's Fury",
        id: 385059,
      },
      cooldown: 45.0,
      target: 0.95,
      talent: [136735],
    },
  ],
  '73': [
    {
      id: 'active',
      kind: 'activeTime',
    },
    {
      id: 'breakdown',
      kind: 'breakdown',
      metric: 'damage',
    },
    {
      id: 'waste',
      kind: 'resourceWaste',
    },
    {
      id: 'ce-376079',
      kind: 'castEfficiency',
      spell: {
        name: "Champion's Spear",
        id: 376079,
      },
      cooldown: 90.0,
      talent: [112247],
    },
    {
      id: 'ce-107574',
      kind: 'castEfficiency',
      spell: {
        name: 'Avatar',
        id: 107574,
      },
      cooldown: 90.0,
      talent: [136703, 112285, 112305],
    },
    {
      id: 'ce-228920',
      kind: 'castEfficiency',
      spell: {
        name: 'Ravager',
        id: 228920,
      },
      cooldown: 90.0,
      talent: [136702, 132880],
    },
    {
      id: 'ce-385954',
      kind: 'castEfficiency',
      spell: {
        name: 'Shield Charge',
        id: 385954,
      },
      cooldown: 45.0,
      talent: [112173],
    },
    {
      id: 'ce-436358',
      kind: 'castEfficiency',
      spell: {
        name: 'Demolish',
        id: 436358,
      },
      cooldown: 45.0,
      talent: [117415],
    },
  ],
};

/** spec ID -> WoWAnalyzer's guide sections (shown as a hint), and patch. */
export const SPEC_GUIDE: Record<
  number,
  { sections: string[]; patch: string | null }
> = {
  '250': {
    sections: ['Core Skills', 'Death Strike', 'Cooldowns'],
    patch: '12.0.1',
  },
  '251': {
    sections: ['Resource Use', 'Proc Usage', 'Cooldowns'],
    patch: '12.0.7',
  },
  '252': {
    sections: [],
    patch: '12.0.7',
  },
  '1480': {
    sections: ['Disclaimer', 'Core', 'Procs', 'Defensives', 'Cooldowns'],
    patch: '12.0.0',
  },
  '577': {
    sections: ['Core', 'Cooldowns', 'Defensives'],
    patch: '12.1.0',
  },
  '581': {
    sections: [
      'Core',
      'Defensive Cooldowns and Mitigation',
      'Rotation',
      'Cooldowns',
    ],
    patch: '12.0.7',
  },
  '102': {
    sections: ['Core', 'Rotation', 'DoTs', 'Eclipse', 'Cooldowns'],
    patch: '12.0.1',
  },
  '103': {
    sections: [
      'Resource Use',
      'Core Rotation',
      'Advanced Rotation',
      'Cooldowns',
    ],
    patch: '12.1.0',
  },
  '104': {
    sections: [
      'Rage',
      'Rotation',
      'Offensive Cooldowns',
      'Major Defensives',
      'Ironfur',
    ],
    patch: '12.0.1',
  },
  '105': {
    sections: [
      'Always Be Casting',
      'Core Spells and Buffs',
      'Healing Cooldowns',
    ],
    patch: '12.1.0',
  },
  '1473': {
    sections: ['Cooldowns', 'Preface', 'Core Rotation', 'Defensives'],
    patch: '12.1.0',
  },
  '1467': {
    sections: [
      'Cooldowns',
      'Core Rotation (Experimental)',
      'Damage Efficiency',
      'Core',
      'Dragonrage',
      'Preface',
      'Defensives',
      'Disintegrate',
    ],
    patch: '12.1.0',
  },
  '1468': {
    sections: ['Core Spells and Buffs', 'Healing cooldowns'],
    patch: '12.1.0',
  },
  '253': {
    sections: ['Resource Use'],
    patch: '12.0.7',
  },
  '254': {
    sections: [],
    patch: '11.0.5',
  },
  '255': {
    sections: [
      'Resource Use',
      'Tip of the Spear',
      'Rotation',
      'Active Time',
      'Cooldowns',
      'Defensives',
      'Preface',
      'Action Priority List',
      'Hero Talents',
    ],
    patch: '12.0.7',
  },
  '62': {
    sections: [
      'Preface & Disclaimers',
      'Core',
      'Burn Phase',
      'Rotational Abilities',
      'Cooldowns',
    ],
    patch: '12.1.5',
  },
  '63': {
    sections: [
      'Preface & Disclaimers',
      'Core',
      'Heating Up & Hot Streak',
      'Buffs & Procs',
      'Cooldowns',
      'Talents',
    ],
    patch: '12.0.7',
  },
  '64': {
    sections: ['Core', 'Procs', 'Cooldowns'],
    patch: '12.0.7',
  },
  '268': {
    sections: [
      'Core Skills',
      'Stagger Management',
      'Rotation & Cooldowns',
      'Master of Harmony',
    ],
    patch: '12.1.0',
  },
  '270': {
    sections: [
      'Core Spells and Buffs',
      'Healing Cooldowns',
      'Core Rotation',
      'Mana',
      'Other cooldowns, buffs, and procs',
      'Defensives',
    ],
    patch: '12.1',
  },
  '269': {
    sections: [
      'Preface & Disclaimers',
      'Core Spells and Buffs',
      'Major cooldowns',
      'Other cooldowns, buffs and procs',
      'Core Rotation',
    ],
    patch: '12.1.0',
  },
  '65': {
    sections: [
      'Always Be Casting',
      'Beacons',
      'Healing cooldowns',
      'Core',
      'Core Rotation',
      'Defensives',
      'Infusion of Light',
    ],
    patch: '12.0',
  },
  '66': {
    sections: [
      'Core Skills',
      'Rotation',
      'Resource Use',
      'Defensive Cooldowns',
      'Active Mitigation',
    ],
    patch: '12.0.7',
  },
  '70': {
    sections: ['Core', 'Cooldowns'],
    patch: '12.1',
  },
  '256': {
    sections: ['Short cooldowns', 'DoTs', 'Defensives'],
    patch: '12.0.1',
  },
  '257': {
    sections: ['Holy Words', 'Core Spells', 'Healing Cooldowns', 'Defensives'],
    patch: '12.0.1',
  },
  '258': {
    sections: [
      'Core',
      'Insanity',
      'DoTs',
      'Active Time',
      'Cooldowns',
      'Core Spells',
      'Short Cooldowns',
      'Major Cooldowns',
      'Proc Usage',
      'Action Priority List',
      'Active Time Graph',
      'Defensives',
      'Shadowform',
    ],
    patch: '12.1',
  },
  '259': {
    sections: ['Resource Use', 'Core Rotation', 'Cooldowns'],
    patch: '12.0.0',
  },
  '260': {
    sections: ['Core Skills', 'Resource Use', 'Core rotation', 'Cooldowns'],
    patch: '12.0.7',
  },
  '261': {
    sections: ['Resource Use', 'Core Rotation', 'Cooldowns'],
    patch: '12.1.0',
  },
  '262': {
    sections: [],
    patch: '12.1.0',
  },
  '263': {
    sections: [
      'Preface & Disclaimers',
      'Hero Talent',
      'Always Be Casting',
      'Resources',
      'Core',
      'Defensive and utility',
      'Core Spells and Buffs',
      'Healing Cooldowns',
      'Advanced HoT and Buff tracking',
      'Defensives',
    ],
    patch: '12.1.0',
  },
  '264': {
    sections: [
      'Always Be Casting',
      'Core Spells and Buffs',
      'Healing Cooldowns',
      'Advanced HoT and Buff tracking',
      'Defensives',
    ],
    patch: '12.1.5',
  },
  '265': {
    sections: [
      'Always Be Casting',
      'Dot Uptimes',
      'Unstable Affliction',
      'Cooldown Usage',
      'Dark Harvest',
      'Shard Instability',
      'Defensives',
      'Healthstone Tracker',
      'Resource Usage',
      'Resource Use',
    ],
    patch: '12.1.5',
  },
  '266': {
    sections: [
      'Core',
      'Cooldowns',
      'Cooldown Usage',
      'Demonic Tyrant',
      'Defensives',
      'Healthstone Tracker',
      'Resource Use',
    ],
    patch: '12.1.0',
  },
  '267': {
    sections: [
      'Core',
      'DoT Uptime',
      'Cooldown Usage',
      'Rotation',
      'Backdraft Usage',
      'Havoc Usage',
      'Defensives',
      'Healthstone Tracker',
      'Resource Usage',
      'Preparation',
      'Resource Use',
    ],
    patch: '12.1.0',
  },
  '71': {
    sections: [
      'Preface & Disclaimers',
      'Always Be Casting',
      'Cooldowns',
      'Rotation',
    ],
    patch: '12.1',
  },
  '72': {
    sections: [
      'Preface & Disclaimers',
      'Always Be Casting',
      'Cooldowns',
      'Rotation',
    ],
    patch: '12.1',
  },
  '73': {
    sections: [],
    patch: '12.0.7',
  },
};
