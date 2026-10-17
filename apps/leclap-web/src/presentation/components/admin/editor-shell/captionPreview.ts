// Pure preview layout for the caption sugar. Mirrors the engine's captionToFilters
// (packages/ffmpeg-video-composer/src/editor/presets/captions.ts): the style presets (bar/subtle/
// bold), the position/align anchor expressions and the box override matrix. The caption constants
// are ABSOLUTE engine px (fontsize 46, offsets 60/110, margin 80, border 18), so they scale by the
// preview/engine height factor — proportionally larger on the 720-high landscape frame than on the
// 1280-high portrait one, exactly like the render.
import type { EditorCaption, Orientation } from '../templateEditorModel';
import { previewScale, type SugarAnchorX, type SugarAnchorY, type SugarTextLine } from './sugarPreviewGeometry';
import { previewFontFamily } from './preview-font-family';

// Engine constants from captions.ts.
const ALIGN_MARGIN = 80;
const TOP_OFFSET = 60;
const BOTTOM_OFFSET = 60;
const LOWER_THIRD_OFFSET = 110;
const DEFAULT_BOX_COLOR = '#000000';
const DEFAULT_BOX_OPACITY = 0.8;
const DEFAULT_BOX_BORDER = 18;

type StylePreset = {
  fontFile: string;
  fontFamily: string;
  fontsize: number;
  color: string;
  box?: { color: string; opacity: number; borderPx: number };
};

// STYLE_VALUES from captions.ts, with the fontfile's CSS family resolved up front.
const STYLE_PRESETS: Record<string, StylePreset> = {
  bar: {
    fontFile: 'Oswald.ttf',
    fontFamily: 'Oswald',
    fontsize: 46,
    color: '#f5f5f0',
    box: { color: '#141416', opacity: 0.8, borderPx: 18 },
  },
  subtle: { fontFile: 'Rubik.ttf', fontFamily: 'Rubik', fontsize: 44, color: '#ffffff' },
  bold: { fontFile: 'BebasNeue.ttf', fontFamily: 'Bebas Neue', fontsize: 72, color: '#ffffff' },
};

// POSITION_Y from captions.ts, as anchors instead of drawtext expressions.
const POSITION_ANCHORS: Record<string, SugarAnchorY> = {
  top: { edge: 'top', px: TOP_OFFSET },
  center: { edge: 'center' },
  bottom: { edge: 'bottom', px: BOTTOM_OFFSET },
  'lower-third': { edge: 'bottom', px: LOWER_THIRD_OFFSET },
};

// The engine's resolveBox: preset box unless the caption toggles it, with explicit colour/opacity
// overrides (or a boxless preset) rebuilding the colour@opacity token from the defaults.
function captionBox(caption: EditorCaption, preset: StylePreset, f: number): SugarTextLine['box'] {
  const boxOn = caption.box ?? Boolean(preset.box);

  if (!boxOn) return undefined;

  const hasOverride = caption.boxColor !== undefined || caption.boxOpacity !== undefined;
  const paddingPx = (preset.box?.borderPx ?? DEFAULT_BOX_BORDER) * f;

  if (hasOverride || !preset.box) {
    return {
      color: caption.boxColor ?? DEFAULT_BOX_COLOR,
      opacity: caption.boxOpacity ?? DEFAULT_BOX_OPACITY,
      paddingPx,
    };
  }

  return { color: preset.box.color, opacity: preset.box.opacity, paddingPx };
}

/**
 * Lays out a caption as one positioned preview line, or null when absent/blank (matching the
 * engine's hasText guard).
 */
export function captionPreview(
  caption: EditorCaption | undefined,
  previewH: number,
  orientation: Orientation
): SugarTextLine | null {
  if (!caption || caption.text.trim() === '') return null;

  const f = previewScale(previewH, orientation);
  const preset = STYLE_PRESETS[caption.style ?? 'bar'];
  const anchor = POSITION_ANCHORS[caption.position ?? 'lower-third'];
  const { x, y } = captionCoordinates(caption, anchor, f);
  const box = captionBox(caption, preset, f);

  return {
    key: 'caption',
    text: caption.text,
    x,
    y,
    fontPx: (caption.fontsize ?? preset.fontsize) * f,
    fontFamily: previewFontFamily(caption.font, preset.fontFamily),
    color: caption.color ?? preset.color,
    ...(box ? { box } : {}),
    // The engine applies the caption effect to the drawtext (captions.ts applyTextEffect).
    ...(caption.effect ? { effect: caption.effect } : {}),
  };
}

function captionCoordinates(
  caption: EditorCaption,
  anchor: SugarAnchorY,
  scale: number
): { x: SugarAnchorX; y: SugarAnchorY } {
  const align = caption.align ?? 'center';
  const x: SugarAnchorX = align === 'center' ? { side: 'center' } : { side: align, px: ALIGN_MARGIN * scale };
  const y: SugarAnchorY = anchor.edge === 'center' ? anchor : { edge: anchor.edge, px: anchor.px * scale };

  return { x, y };
}
