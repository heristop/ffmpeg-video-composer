// Pure conversion: a text-sugar block (titleCard / lowerThird / caption) → regular draggable
// TextOverlays, for the "Detach into text elements" action. The sugar kinds are structural in the
// engine (align/position enums, fixed scale-derived geometry); detaching trades that automatic
// layout for full direct manipulation. Each rendered line is laid out with the SAME preview modules
// the canvas uses, at the overlay system's reference height (overlayGeometry.refVideoHeight), so a
// detached line previews where the sugar block drew it.
//
// Known fidelity trade-offs (surfaced to the author by the detach hint):
// - The lowerThird band and the accent bars are drawbox decorations with no TextOverlay equivalent;
//   they are dropped. The badge pill and caption bar survive as the overlay's background box.
// - drawtext x is `(w-text_w)*fx`, so a left/right-aligned line's fraction needs the text width; it
//   is estimated from the glyph count (condensed faces ≈ 0.5em per glyph).
import { staggered } from 'ffmpeg-video-composer/src/editor/presets/text.ts';
import { FONTS, DEFAULT_FONT_ID } from '@leclap/creative-kit/fonts';
import type { EditorCaption, LowerThird, Orientation, TextOverlay, TitleCard } from '../templateEditorModel';
import { refVideoHeight } from '../overlayGeometry';
import { ENGINE_FRAME, type SugarTextLine } from './sugarPreviewGeometry';
import { titleCardPreview } from './titleCardPreview';
import { lowerThirdPreview } from './lowerThirdPreview';
import { captionPreview } from './captionPreview';
import type { SugarKind } from './sectionElements';

type AnySugar = EditorCaption | TitleCard | LowerThird | undefined;

// Average advance width per glyph, as a fraction of the font size. The sugar faces (Anton, Oswald,
// Bebas) are condensed, so 0.5em is a serviceable estimate for centring a left/right-anchored line.
const GLYPH_WIDTH_EM = 0.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Font id for a CSS family coming out of the preview modules (they emit registry families only).
function fontIdFromFamily(family: string): string {
  return FONTS.find((font) => font.cssFamily === family)?.id ?? DEFAULT_FONT_ID;
}

// The line's horizontal CENTRE as a [0,1] fraction of the reference frame width.
function xFraction(line: SugarTextLine, refW: number): number {
  if (line.x.side === 'center') return 0.5;

  const estWidth = line.text.length * line.fontPx * GLYPH_WIDTH_EM;

  if (line.x.side === 'left') return clamp01((line.x.px + estWidth / 2) / refW);

  return clamp01((refW - line.x.px - estWidth / 2) / refW);
}

// The line's vertical CENTRE as a [0,1] fraction of the reference frame height. drawtext y anchors
// the glyph-box top (or bottom offset), so the centre sits half a line below/above it.
function yFraction(line: SugarTextLine, refH: number): number {
  if (line.y.edge === 'center') return 0.5;

  if (line.y.edge === 'top') return clamp01((line.y.px + line.fontPx / 2) / refH);

  return clamp01((refH - line.y.px - line.fontPx / 2) / refH);
}

// One preview line → one regular text overlay, carrying the sugar's reveal when set and the line's
// own text effect (per-line, so the effect-free badge stays effect-free).
function overlayFromLine(line: SugarTextLine, refW: number, refH: number, reveal: TextOverlay['reveal']): TextOverlay {
  return {
    text: line.text,
    x: xFraction(line, refW),
    y: yFraction(line, refH),
    fontsize: Math.round(line.fontPx),
    fontcolor: line.color,
    font: fontIdFromFamily(line.fontFamily),
    box: Boolean(line.box),
    boxcolor: line.box?.color ?? '#000000',
    boxOpacity: line.box?.opacity ?? 0.5,
    ...(reveal ? { reveal } : {}),
    ...(line.effect ? { effect: line.effect } : {}),
  };
}

// The preview lines a sugar block draws at the reference height, in draw order.
function previewLines(kind: SugarKind, sugar: AnySugar, refH: number, orientation: Orientation): SugarTextLine[] {
  if (kind === 'caption') {
    const line = captionPreview(sugar as EditorCaption | undefined, refH, orientation);

    return line ? [line] : [];
  }

  if (kind === 'titleCard') {
    return titleCardPreview(sugar as TitleCard | undefined, refH, orientation)?.lines ?? [];
  }

  return lowerThirdPreview(sugar as LowerThird | undefined, refH, orientation)?.lines ?? [];
}

/**
 * Converts a sugar block into regular text overlays positioned/styled like its rendered lines.
 * Returns [] when the sugar is absent or textless. The caller replaces the sugar field with the
 * returned overlays (appended to the section's overlay list).
 */
export function sugarToOverlays(kind: SugarKind, sugar: AnySugar, orientation: Orientation): TextOverlay[] {
  if (!sugar) return [];

  const refH = refVideoHeight(orientation);
  const engine = ENGINE_FRAME[orientation];
  const refW = (refH * engine.w) / engine.h;
  const reveal = (sugar as { reveal?: TextOverlay['reveal'] }).reveal;

  return previewLines(kind, sugar, refH, orientation).map((line, index) => {
    const entrance = kind === 'titleCard' ? staggered(reveal ?? 'rise', index, (sugar as TitleCard).stagger) : reveal;

    return overlayFromLine(line, refW, refH, entrance);
  });
}
