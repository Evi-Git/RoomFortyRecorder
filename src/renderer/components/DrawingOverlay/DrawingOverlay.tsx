import React from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/dist/types/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import './DrawingOverlay.css';
import { AppState, RawCombatant } from 'main/types';
import { Language } from 'localisation/phrases';
import { WoWClassColor, specializationById } from '../../../main/constants';
import { classImages, specImages } from '../../images';
import {
  CLASS_PRESETS,
  DRAWING_PRESETS,
  DrawingPreset,
  DrawingPresetId,
  moveDrawingPreset,
  PlacedDrawingPreset,
  placeDrawingPreset,
  RAID_MARKER_PRESETS,
  reconcileDrawingPresetForToolChange,
  toggleDrawingPreset,
} from './drawingPresets';

interface DrawingOverlayProps {
  isDrawingEnabled: boolean;
  onDrawingChange: (elements: readonly ExcalidrawElement[]) => void;
  appState: AppState;
  raiders?: readonly RawCombatant[];
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

type NamedCombatant = RawCombatant & { _name: string };

const uniqueRaiders = (raiders: readonly RawCombatant[]): NamedCombatant[] =>
  Array.from(
    new Map(
      raiders
        .filter((raider): raider is NamedCombatant => Boolean(raider._name))
        .map((raider) => [raider._GUID || raider._name, raider]),
    ).values(),
  ).sort((left, right) => left._name.localeCompare(right._name));

const RaidMarkerIcon = ({
  id,
  color,
}: {
  id: DrawingPresetId;
  color: string;
}) => {
  const shape = (() => {
    switch (id) {
      case 'raid-star':
        return (
          <polygon points="16,2 19.5,11 29,11 21.5,16.5 24,26 16,20.5 8,26 10.5,16.5 3,11 12.5,11" />
        );
      case 'raid-circle':
        return <circle cx="16" cy="16" r="11" />;
      case 'raid-diamond':
        return <polygon points="16,2 29,16 16,30 3,16" />;
      case 'raid-triangle':
        return <polygon points="16,3 29,28 3,28" />;
      case 'raid-moon':
        return <path d="M24 5a12 12 0 1 0 3 21A12 12 0 0 1 24 5Z" />;
      case 'raid-square':
        return <rect x="5" y="5" width="22" height="22" rx="1" />;
      case 'raid-cross':
        return <path d="m8 5 8 8 8-8 3 3-8 8 8 8-3 3-8-8-8 8-3-3 8-8-8-8Z" />;
      case 'raid-skull':
        return (
          <>
            <path d="M16 4C10 4 6 8.2 6 14c0 3.5 1.8 6.2 4.7 7.7V26h3v-2h4.6v2h3v-4.3C24.2 20.2 26 17.5 26 14 26 8.2 22 4 16 4Z" />
            <circle cx="12" cy="14" r="2" fill="var(--drawing-overlay-bg)" />
            <circle cx="20" cy="14" r="2" fill="var(--drawing-overlay-bg)" />
            <path d="M13 19h6v2h-6Z" fill="var(--drawing-overlay-bg)" />
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <svg
      aria-hidden="true"
      className="drawing-preset-icon"
      viewBox="0 0 32 32"
      style={{ color }}
    >
      {shape}
    </svg>
  );
};

const PresetIcon = ({ preset }: { preset: DrawingPreset }) => {
  if (preset.kind === 'raid-marker') {
    return <RaidMarkerIcon id={preset.id} color={preset.color} />;
  }

  return (
    <img
      aria-hidden="true"
      className="drawing-preset-icon"
      draggable={false}
      src={classImages[preset.className]}
    />
  );
};

const DrawingPresetPanel = ({
  armedPresetId,
  onSelect,
}: {
  armedPresetId: DrawingPresetId | null;
  onSelect: (presetId: DrawingPresetId) => void;
}) => {
  const renderButton = (preset: DrawingPreset) => {
    const isArmed = armedPresetId === preset.id;
    const isUtility = preset.kind === 'utility';

    return (
      <button
        aria-label={preset.label}
        aria-pressed={isArmed}
        className={`drawing-preset ${isArmed ? 'is-armed' : ''} ${isUtility ? 'is-utility' : ''}`}
        key={preset.id}
        title={`${preset.label}${isArmed ? ' (armed)' : ''}`}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(preset.id);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PresetIcon preset={preset} />
        {isUtility && <span>Warlock Gate</span>}
      </button>
    );
  };

  return (
    <aside
      aria-label="Drawing presets"
      className="drawing-overlay-palette"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="drawing-palette-heading">Markers</div>
      <div className="drawing-preset-grid">
        {RAID_MARKER_PRESETS.map(renderButton)}
      </div>
      <div className="drawing-palette-heading">Classes</div>
      <div className="drawing-preset-grid">
        {CLASS_PRESETS.map((preset) =>
          renderButton({ ...preset, kind: 'class' }),
        )}
      </div>
      <div className="drawing-palette-gate">Preset</div>
      {renderButton(DRAWING_PRESETS[DRAWING_PRESETS.length - 1])}
    </aside>
  );
};

const RaidRoster = ({ raiders }: { raiders: readonly RawCombatant[] }) => {
  const members = uniqueRaiders(raiders);

  return (
    <aside
      aria-label="Raid roster"
      className="drawing-overlay-palette drawing-roster-panel"
    >
      <div className="drawing-palette-heading drawing-roster-heading">
        <span>Raiders</span>
        <span>{members.length}</span>
      </div>
      {members.length > 0 ? (
        <div className="drawing-roster-list">
          {members.map((member) => {
            const specialization = member._specID
              ? specializationById[member._specID]
              : undefined;
            const className = specialization?.class || 'UNKNOWN';
            const classColor = WoWClassColor[className];
            const specIcon =
              specImages[member._specID as keyof typeof specImages] ||
              specImages[0];

            return (
              <div
                className="drawing-roster-member"
                key={member._GUID || member._name}
                style={{ borderLeftColor: classColor }}
                title={
                  specialization
                    ? `${specialization.label} — ${specialization.name}`
                    : 'Unknown specialization'
                }
              >
                <img
                  alt=""
                  className="drawing-roster-spec"
                  src={specIcon}
                  style={{ borderColor: classColor }}
                />
                <span style={{ color: classColor }}>{member._name}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="drawing-roster-empty">No raid roster found</div>
      )}
    </aside>
  );
};

const DrawingToolsMenu = ({
  armedPresetId,
  onSelect,
  raiders,
}: {
  armedPresetId: DrawingPresetId | null;
  onSelect: (presetId: DrawingPresetId) => void;
  raiders: readonly RawCombatant[];
}) => {
  const [openPanel, setOpenPanel] = React.useState<
    'presets' | 'raiders' | null
  >('presets');
  const raiderCount = uniqueRaiders(raiders).length;

  const togglePanel = (panel: 'presets' | 'raiders') => {
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  return (
    <div
      aria-label="Annotation tools"
      className="drawing-tools-menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="drawing-tools-buttons">
        <button
          aria-expanded={openPanel === 'presets'}
          className={`drawing-tools-button ${openPanel === 'presets' ? 'is-open' : ''}`}
          type="button"
          onClick={() => togglePanel('presets')}
        >
          Presets
        </button>
        <button
          aria-expanded={openPanel === 'raiders'}
          aria-label="Raiders"
          className={`drawing-tools-button ${openPanel === 'raiders' ? 'is-open' : ''}`}
          type="button"
          onClick={() => togglePanel('raiders')}
        >
          Raiders <span className="drawing-tools-count">{raiderCount}</span>
        </button>
      </div>
      {openPanel === 'presets' && (
        <DrawingPresetPanel armedPresetId={armedPresetId} onSelect={onSelect} />
      )}
      {openPanel === 'raiders' && <RaidRoster raiders={raiders} />}
    </div>
  );
};

type PlacementDrag = {
  id: string;
  pointerId: number;
};

export const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  isDrawingEnabled,
  onDrawingChange,
  appState,
  raiders = [],
}) => {
  const [armedPresetId, setArmedPresetId] =
    React.useState<DrawingPresetId | null>(null);
  const [placements, setPlacements] = React.useState<PlacedDrawingPreset[]>([]);
  const activeToolType = React.useRef<string>('freedraw');
  const contentRef = React.useRef<HTMLDivElement>(null);
  const placementDrag = React.useRef<PlacementDrag | null>(null);

  if (!isDrawingEnabled) return null;

  const placeArmedPreset = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!armedPresetId) return;

    const target = event.target;
    if (!(target instanceof Element) || !target.closest('canvas')) return;

    event.preventDefault();
    event.stopPropagation();

    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const x = clampPercent(
      ((event.clientX - bounds.left) / bounds.width) * 100,
    );
    const y = clampPercent(
      ((event.clientY - bounds.top) / bounds.height) * 100,
    );

    setPlacements((previous) =>
      placeDrawingPreset(previous, armedPresetId, x, y),
    );
  };

  const movePlacement = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = placementDrag.current;
    const bounds = contentRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    if (!bounds.width || !bounds.height) return;

    const x = clampPercent(
      ((event.clientX - bounds.left) / bounds.width) * 100,
    );
    const y = clampPercent(
      ((event.clientY - bounds.top) / bounds.height) * 100,
    );
    setPlacements((previous) => moveDrawingPreset(previous, drag.id, x, y));
  };

  const startPlacementDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    id: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    placementDrag.current = { id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const endPlacementDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (placementDrag.current?.pointerId !== event.pointerId) return;
    placementDrag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const renderPlacement = (placement: PlacedDrawingPreset) => {
    const preset = DRAWING_PRESETS.find(({ id }) => id === placement.presetId);
    if (!preset) return null;

    return (
      <div
        aria-label={preset.label}
        className={`drawing-placement ${preset.kind === 'utility' ? 'is-gate' : ''}`}
        key={placement.id}
        role="button"
        style={{ left: `${placement.x}%`, top: `${placement.y}%` }}
        tabIndex={0}
        onPointerDown={(event) => startPlacementDrag(event, placement.id)}
        onPointerMove={movePlacement}
        onPointerUp={endPlacementDrag}
        onPointerCancel={endPlacementDrag}
      >
        <PresetIcon preset={preset} />
        {preset.kind === 'utility' && <span>{preset.label}</span>}
      </div>
    );
  };

  const langCodeMap = {
    [Language.ENGLISH]: 'en',
    [Language.KOREAN]: 'ko-KR',
    [Language.GERMAN]: 'de-DE',
    [Language.CHINESE_SIMPLIFIED]: 'zh-CN',
  };

  const langCode = langCodeMap[appState.language];

  return (
    <div
      className="drawing-overlay h-full w-full"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setArmedPresetId(null);
        event.stopPropagation();
      }}
    >
      <div
        ref={contentRef}
        className="drawing-overlay-content"
        onPointerDownCapture={placeArmedPreset}
      >
        <Excalidraw
          theme="dark"
          gridModeEnabled={false}
          viewModeEnabled={false}
          zenModeEnabled={false}
          name="Drawing Overlay"
          key={langCode}
          onChange={(elements, nextAppState) => {
            const nextToolType = nextAppState.activeTool.type;
            const previousToolType = activeToolType.current;
            activeToolType.current = nextToolType;
            setArmedPresetId((previous) =>
              reconcileDrawingPresetForToolChange(
                previous,
                previousToolType,
                nextToolType,
              ),
            );
            onDrawingChange(elements);
          }}
          renderTopRightUI={() => (
            <DrawingToolsMenu
              armedPresetId={armedPresetId}
              onSelect={(presetId) =>
                setArmedPresetId((previous) =>
                  toggleDrawingPreset(previous, presetId),
                )
              }
              raiders={raiders}
            />
          )}
          langCode={langCode}
          initialData={{
            appState: {
              viewBackgroundColor: 'transparent',
              activeTool: {
                type: 'freedraw',
                lastActiveTool: null,
                locked: true,
                customType: null,
              },
            },
          }}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: false,
              saveAsImage: false,
            },
            tools: {
              image: false,
            },
          }}
        />
        <div className="drawing-placements">
          {placements.map(renderPlacement)}
        </div>
      </div>
    </div>
  );
};
