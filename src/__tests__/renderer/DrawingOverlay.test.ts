/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AppState } from '../../main/types';
import { Language } from '../../localisation/phrases';
import {
  CLASS_PRESETS,
  DRAWING_PRESETS,
  moveDrawingPreset,
  placeDrawingPreset,
  RAID_MARKER_PRESETS,
  reconcileDrawingPresetForToolChange,
  toggleDrawingPreset,
  WARLOCK_GATE_PRESET,
} from '../../renderer/components/DrawingOverlay/drawingPresets';

jest.mock('@excalidraw/excalidraw/index.css', () => ({}), { virtual: true });
jest.mock(
  'localisation/phrases',
  () => ({
    Language: {
      CHINESE_SIMPLIFIED: '简体中文',
      ENGLISH: 'English',
      GERMAN: 'German',
      KOREAN: '한국어',
    },
  }),
  { virtual: true },
);
jest.mock(
  '../../renderer/components/DrawingOverlay/DrawingOverlay.css',
  () => ({}),
);
jest.mock('../../renderer/images', () => ({
  classImages: {
    DEATHKNIGHT: 'deathknight.png',
    DEMONHUNTER: 'demonhunter.png',
    DRUID: 'druid.png',
    EVOKER: 'evoker.png',
    HUNTER: 'hunter.png',
    MAGE: 'mage.png',
    MONK: 'monk.png',
    PALADIN: 'paladin.png',
    PRIEST: 'priest.png',
    ROGUE: 'rogue.png',
    SHAMAN: 'shaman.png',
    WARLOCK: 'warlock.png',
    WARRIOR: 'warrior.png',
  },
  specImages: {
    0: 'spec0.png',
    63: 'spec63.png',
  },
}));
jest.mock('@excalidraw/excalidraw', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    Excalidraw: ({
      onChange,
      renderTopRightUI,
    }: {
      onChange: (
        elements: readonly never[],
        appState: { activeTool: { type: string } },
      ) => void;
      renderTopRightUI?: () => React.ReactNode;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'excalidraw' },
        renderTopRightUI?.(),
        React.createElement('button', {
          'aria-label': 'Laser pointer',
          onClick: () => onChange([], { activeTool: { type: 'laser' } }),
        }),
        React.createElement('button', {
          'aria-label': 'Rectangle',
          onClick: () => onChange([], { activeTool: { type: 'rectangle' } }),
        }),
        React.createElement('canvas', { 'data-testid': 'drawing-canvas' }),
      ),
  };
});

import { DrawingOverlay } from '../../renderer/components/DrawingOverlay/DrawingOverlay';

const appState = {
  language: Language.ENGLISH,
} as AppState;

describe('drawing preset catalog', () => {
  it('contains the standard raid markers and every checked-in class icon', () => {
    expect(RAID_MARKER_PRESETS.map(({ label }) => label)).toEqual([
      'Star',
      'Circle',
      'Diamond',
      'Triangle',
      'Moon',
      'Square',
      'Cross',
      'Skull',
    ]);
    expect(CLASS_PRESETS.map(({ className }) => className)).toEqual([
      'DEATHKNIGHT',
      'DEMONHUNTER',
      'DRUID',
      'EVOKER',
      'HUNTER',
      'MAGE',
      'MONK',
      'PALADIN',
      'PRIEST',
      'ROGUE',
      'SHAMAN',
      'WARLOCK',
      'WARRIOR',
    ]);
    expect(WARLOCK_GATE_PRESET.label).toBe('Warlock Gate');
  });

  it('arms and disarms presets, then places only the armed preset', () => {
    const position = { x: 42, y: 73 };

    expect(toggleDrawingPreset(null, 'raid-star')).toBe('raid-star');
    expect(toggleDrawingPreset('raid-star', 'raid-star')).toBeNull();
    expect(placeDrawingPreset([], null, position.x, position.y)).toEqual([]);
    const placed = placeDrawingPreset([], 'raid-star', position.x, position.y);
    expect(placed).toEqual([
      {
        id: 'raid-star-0',
        presetId: 'raid-star',
        ...position,
      },
    ]);
    expect(moveDrawingPreset(placed, 'raid-star-0', 10, 20)).toEqual([
      {
        id: 'raid-star-0',
        presetId: 'raid-star',
        x: 10,
        y: 20,
      },
    ]);
  });

  it.each(['laser', 'rectangle'])(
    'keeps a preset armed after selecting the %s tool',
    (activeToolType) => {
      expect(
        reconcileDrawingPresetForToolChange(null, 'freedraw', activeToolType),
      ).toBeNull();

      const armedPresetId = toggleDrawingPreset(null, 'raid-star');
      const unchangedPresetId = reconcileDrawingPresetForToolChange(
        armedPresetId,
        activeToolType,
        activeToolType,
      );

      expect(unchangedPresetId).toBe('raid-star');
      expect(placeDrawingPreset([], unchangedPresetId, 25, 40)).toEqual([
        {
          id: 'raid-star-0',
          presetId: 'raid-star',
          x: 25,
          y: 40,
        },
      ]);
      expect(
        reconcileDrawingPresetForToolChange(
          armedPresetId,
          activeToolType,
          'freedraw',
        ),
      ).toBeNull();
    },
  );
});

describe('drawing preset palette', () => {
  beforeAll(() => {
    window.PointerEvent = MouseEvent as typeof PointerEvent;
  });

  it('exposes every preset as a named, focusable selection control', () => {
    render(
      React.createElement(DrawingOverlay, {
        appState,
        isDrawingEnabled: true,
        onDrawingChange: jest.fn(),
        raiders: [{ _name: 'Jaina', _specID: 63 }],
      }),
    );

    const expectedLabels = DRAWING_PRESETS.map(({ label }) => label);
    const presetButtons = expectedLabels.map((label) =>
      screen.getByRole('button', { name: label }),
    );

    expect(presetButtons).toHaveLength(22);
    presetButtons.forEach((button) => {
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.tabIndex).toBe(0);
    });

    const star = screen.getByRole('button', { name: 'Star' });
    star.focus();
    fireEvent.click(star, { detail: 0 });

    expect(document.activeElement).toBe(star);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.title).toBe('Star (armed)');

    fireEvent.click(star, { detail: 0 });
    expect(star.getAttribute('aria-pressed')).toBe('false');
  });

  it('places the armed preset on the canvas while preserving drawing callbacks', () => {
    const onDrawingChange = jest.fn();
    const { container } = render(
      React.createElement(DrawingOverlay, {
        appState,
        isDrawingEnabled: true,
        onDrawingChange,
        raiders: [{ _name: 'Jaina', _specID: 63 }],
      }),
    );
    const overlayContent = container.querySelector(
      '.drawing-overlay-content',
    ) as HTMLDivElement;
    jest.spyOn(overlayContent, 'getBoundingClientRect').mockReturnValue({
      bottom: 500,
      height: 500,
      left: 0,
      right: 1000,
      toJSON: () => ({}),
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Laser pointer' }));
    const gate = screen.getByRole('button', { name: 'Warlock Gate' });
    fireEvent.click(gate, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Laser pointer' }));
    expect(gate.getAttribute('aria-pressed')).toBe('true');

    fireEvent.pointerDown(screen.getByTestId('drawing-canvas'), {
      clientX: 750,
      clientY: 125,
    });

    const placement = container.querySelector(
      '.drawing-placement.is-gate',
    ) as HTMLDivElement;
    expect(placement).not.toBeNull();
    expect(placement.style.left).toBe('75%');
    expect(placement.style.top).toBe('25%');
    expect(placement.textContent).toContain('Warlock Gate');
    expect(onDrawingChange).toHaveBeenCalledTimes(2);

    fireEvent.pointerDown(placement, { clientX: 750, clientY: 125 });
    fireEvent.pointerMove(placement, { clientX: 500, clientY: 250 });
    fireEvent.pointerUp(placement, { clientX: 500, clientY: 250 });
    expect(placement.style.left).toBe('50%');
    expect(placement.style.top).toBe('50%');

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    expect(gate.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Raiders' }));
    expect(
      screen.getByRole('complementary', { name: 'Raid roster' }).textContent,
    ).toContain('Jaina');
    expect(
      document.querySelector('.drawing-roster-spec')?.getAttribute('src'),
    ).toBe('spec63.png');
  });
});
