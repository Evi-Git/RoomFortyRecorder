export type DrawingPresetKind = 'raid-marker' | 'class' | 'utility';

export const RAID_MARKER_PRESETS = [
  { id: 'raid-star', label: 'Star', kind: 'raid-marker', color: '#f5d000' },
  { id: 'raid-circle', label: 'Circle', kind: 'raid-marker', color: '#ff8a2b' },
  {
    id: 'raid-diamond',
    label: 'Diamond',
    kind: 'raid-marker',
    color: '#ca4be2',
  },
  {
    id: 'raid-triangle',
    label: 'Triangle',
    kind: 'raid-marker',
    color: '#36dc58',
  },
  { id: 'raid-moon', label: 'Moon', kind: 'raid-marker', color: '#b7daf4' },
  { id: 'raid-square', label: 'Square', kind: 'raid-marker', color: '#249cff' },
  { id: 'raid-cross', label: 'Cross', kind: 'raid-marker', color: '#ff4e4e' },
  { id: 'raid-skull', label: 'Skull', kind: 'raid-marker', color: '#f4f4f4' },
] as const satisfies readonly {
  id: string;
  label: string;
  kind: DrawingPresetKind;
  color: string;
}[];

export const CLASS_PRESETS = [
  { id: 'class-deathknight', label: 'Death Knight', className: 'DEATHKNIGHT' },
  { id: 'class-demonhunter', label: 'Demon Hunter', className: 'DEMONHUNTER' },
  { id: 'class-druid', label: 'Druid', className: 'DRUID' },
  { id: 'class-evoker', label: 'Evoker', className: 'EVOKER' },
  { id: 'class-hunter', label: 'Hunter', className: 'HUNTER' },
  { id: 'class-mage', label: 'Mage', className: 'MAGE' },
  { id: 'class-monk', label: 'Monk', className: 'MONK' },
  { id: 'class-paladin', label: 'Paladin', className: 'PALADIN' },
  { id: 'class-priest', label: 'Priest', className: 'PRIEST' },
  { id: 'class-rogue', label: 'Rogue', className: 'ROGUE' },
  { id: 'class-shaman', label: 'Shaman', className: 'SHAMAN' },
  { id: 'class-warlock', label: 'Warlock', className: 'WARLOCK' },
  { id: 'class-warrior', label: 'Warrior', className: 'WARRIOR' },
] as const;

export const WARLOCK_GATE_PRESET = {
  id: 'warlock-gate',
  label: 'Warlock Gate',
  kind: 'utility',
  className: 'WARLOCK',
} as const;

export const DRAWING_PRESETS = [
  ...RAID_MARKER_PRESETS,
  ...CLASS_PRESETS.map((preset) => ({ ...preset, kind: 'class' as const })),
  WARLOCK_GATE_PRESET,
] as const;

export type DrawingPreset = (typeof DRAWING_PRESETS)[number];
export type DrawingPresetId = DrawingPreset['id'];

export const toggleDrawingPreset = (
  currentPresetId: DrawingPresetId | null,
  nextPresetId: DrawingPresetId,
): DrawingPresetId | null =>
  currentPresetId === nextPresetId ? null : nextPresetId;

export const reconcileDrawingPresetForToolChange = (
  armedPresetId: DrawingPresetId | null,
  previousToolType: string,
  nextToolType: string,
): DrawingPresetId | null =>
  previousToolType === nextToolType ? armedPresetId : null;

export interface PlacedDrawingPreset {
  id: string;
  presetId: DrawingPresetId;
  x: number;
  y: number;
}

export const placeDrawingPreset = (
  placements: readonly PlacedDrawingPreset[],
  presetId: DrawingPresetId | null,
  x: number,
  y: number,
): PlacedDrawingPreset[] => {
  if (!presetId) return [...placements];

  return [
    ...placements,
    {
      id: `${presetId}-${placements.length}`,
      presetId,
      x,
      y,
    },
  ];
};

export const moveDrawingPreset = (
  placements: readonly PlacedDrawingPreset[],
  id: string,
  x: number,
  y: number,
): PlacedDrawingPreset[] =>
  placements.map((placement) =>
    placement.id === id ? { ...placement, x, y } : placement,
  );
