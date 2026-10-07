// Authored order: an effect built from the picture (glass) filters what the effects before it drew, and the
// ones after it draw over it, the way the engine composites the section's fx layers.
import { describe, expect, it } from 'vitest';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { newSection, type EditorSection } from '../../templateEditorModel';
import { preparePainter } from './prepare';
import { stackOf } from './stack';
import type { FxPainter } from './painter';

const paint = (): Pick<FxPainter, 'paint'> => ({ paint: () => undefined });
const surface = (): Pick<FxPainter, 'surface'> => ({ surface: () => null });

describe('stackOf', () => {
  it('puts a surface between the canvas runs authored before and after it', () => {
    expect(stackOf([paint(), paint(), surface(), paint()])).toEqual([
      { kind: 'canvas', members: [0, 1] },
      { kind: 'surface', member: 2 },
      { kind: 'canvas', members: [3] },
    ]);
  });

  it('keeps a surface authored first at the bottom and always ends with a canvas', () => {
    expect(stackOf([surface(), surface()])).toEqual([
      { kind: 'surface', member: 0 },
      { kind: 'surface', member: 1 },
      { kind: 'canvas', members: [] },
    ]);
    expect(stackOf([])).toEqual([{ kind: 'canvas', members: [] }]);
  });

  it('draws a painter with both parts above its own surface', () => {
    expect(stackOf([{ ...paint(), ...surface() }])).toEqual([
      { kind: 'surface', member: 0 },
      { kind: 'canvas', members: [0] },
    ]);
  });

  it('frosts a sheen authored before the glass and keeps the leak authored after it on top', () => {
    const env = {
      orientation: 'landscape' as const,
      section: newSection('color') as EditorSection,
      sectionIndex: 0,
      sectionSeconds: 6,
      reduced: false,
    };
    const graphics = [
      { type: 'fx', effect: 'sheen' },
      { type: 'fx', effect: 'glass' },
      { type: 'fx', effect: 'leak' },
    ] as Graphic[];
    const painters = graphics.flatMap((g, i) => preparePainter(g, i, env) ?? []);

    expect(stackOf(painters)).toEqual([
      { kind: 'canvas', members: [0] },
      { kind: 'surface', member: 1 },
      { kind: 'canvas', members: [2] },
    ]);
  });
});
