import { describe, expect, it } from 'vitest';
import { newSection, type EditorSection } from '../templateEditorModel';
import { clipWidthRem, MAX_CLIP_REM, MIN_CLIP_REM, REM_PER_SECOND, secondsLabel } from './scene-strip.logic';

const color = (duration: number): EditorSection =>
  ({ ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>), duration }) as EditorSection;

describe('clipWidthRem', () => {
  it('grows with the clip length', () => {
    expect(clipWidthRem(color(8))).toBe(8 * REM_PER_SECOND);
    expect(clipWidthRem(color(12))).toBeGreaterThan(clipWidthRem(color(8)));
  });

  it('keeps short clips tappable and long ones on screen', () => {
    expect(clipWidthRem(color(1))).toBe(MIN_CLIP_REM);
    expect(clipWidthRem(color(120))).toBe(MAX_CLIP_REM);
  });

  it('gives scenes without a length a fixed card', () => {
    expect(clipWidthRem(newSection('form'))).toBe(7);
  });
});

describe('secondsLabel', () => {
  it('prints whole and half seconds without trailing zeros', () => {
    expect(secondsLabel(color(4))).toBe('4s');
    expect(secondsLabel(color(2.5))).toBe('2.5s');
    expect(secondsLabel(newSection('form'))).toBeUndefined();
  });
});
