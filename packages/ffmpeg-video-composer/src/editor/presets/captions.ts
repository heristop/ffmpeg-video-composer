import type { Filter } from '@/core/types';
import { resolvePlatform } from '@/core/platforms';
import type { Caption } from '../../schemas/section.schemas';
import {
  CAPTION_ALIGN_MARGIN,
  CAPTION_ANCHOR_Y,
  CAPTION_DEFAULT_ALIGN,
  CAPTION_DEFAULT_BOX_BORDER,
  CAPTION_DEFAULT_BOX_COLOR,
  CAPTION_DEFAULT_BOX_OPACITY,
  CAPTION_DEFAULT_POSITION,
  captionStyleValues,
  platformCaptionOffset,
  type CaptionStyleValues,
} from './caption-layout';
import { applyReveal, applyTextEffect, hasText, resolveFontFile } from './text';
import { wrappedCaptionFilters } from './caption-wrap';
import type { SugarContext } from './sugar-context';

// ---------------------------------------------------------------------------
// captionToFilters
// ---------------------------------------------------------------------------

// Vertical placement expressions, built from the shared anchors in caption-layout.ts so the geometry
// validator resolves the same numbers this stringifies. `center` centres the drawn box, which is why
// it subtracts `text_h` rather than sitting at `h/2`.
const POSITION_Y: Record<string, string> = {
  top: String(CAPTION_ANCHOR_Y.top.offset),
  center: '(h-text_h)/2',
  bottom: `(h-text_h)-${CAPTION_ANCHOR_Y.bottom.offset}`,
  'lower-third': `(h-text_h)-${CAPTION_ANCHOR_Y['lower-third'].offset}`,
};

// Horizontal alignment expressions; `center` is the classic centred drawtext expression.
const ALIGN_X: Record<string, string> = {
  left: String(CAPTION_ALIGN_MARGIN),
  center: '(w-text_w)/2',
  right: `w-text_w-${CAPTION_ALIGN_MARGIN}`,
};

// `Object.hasOwn`, not `TABLE[key] ?? fallback` — the same guard `captionStyleValues` and
// `captionAnchorY` already carry in caption-layout.ts. These two tables are plain objects, so they
// inherit truthy `toString`/`constructor`/`__proto__`: `??` never reaches the fallback and hands
// back a Function, which then stringifies into the drawtext `x`/`y` expression. The schema's
// z.enum makes that unreachable for a validated descriptor, but compile() also accepts one straight
// from a caller, and only one of the four lookups was guarded.
function expressionFor(table: Record<string, string>, key: string | undefined, fallback: string): string {
  const name = key ?? fallback;

  return Object.hasOwn(table, name) ? table[name] : table[fallback];
}

// Resolve the box drawtext values, layering caption overrides over the preset. Returns the empty
// object when the box is off (preset default unless the caption explicitly toggles it). An explicit
// boxColor/boxOpacity override (or a preset with no box) builds a fresh `#rrggbb@opacity` token;
// otherwise the preset token is reused.
function resolveBox(caption: Caption, preset: CaptionStyleValues): Record<string, unknown> {
  const boxOn = caption.box ?? Boolean(preset.box);

  if (!boxOn) return {};

  const hasOverride = caption.boxColor !== undefined || caption.boxOpacity !== undefined;
  const boxcolor =
    hasOverride || preset.boxcolor === undefined
      ? `${caption.boxColor ?? CAPTION_DEFAULT_BOX_COLOR}@${caption.boxOpacity ?? CAPTION_DEFAULT_BOX_OPACITY}`
      : preset.boxcolor;

  return { box: 1, boxcolor, boxborderw: preset.boxborderw ?? CAPTION_DEFAULT_BOX_BORDER };
}

// The default caption sits `lower-third`, 110px off the bottom — inside TikTok's caption block on a
// portrait frame. With a delivery platform and no authored `position`, it is lifted clear of the
// platform's bottom UI instead. An authored position is left exactly where the author put it, and so
// is every caption of a template without `global.platform` (its filtergraph is unchanged).
function captionY(caption: Caption, ctx: Pick<SugarContext, 'scale' | 'platform'> | undefined): string {
  const bottom = caption.position === undefined ? resolvePlatform(ctx?.platform)?.safe.bottom : undefined;
  const height = Number(ctx?.scale.split(':').at(1));

  if (bottom === undefined || !Number.isFinite(height)) {
    return expressionFor(POSITION_Y, caption.position, CAPTION_DEFAULT_POSITION);
  }

  return `(h-text_h)-${platformCaptionOffset(height, bottom)}`;
}

/**
 * Translates a Caption descriptor into a single styled drawtext Filter.
 * Returns [] when undefined or when the text has no non-blank translation.
 *
 * The chosen `style` preset provides base look values; the optional
 * align/font/fontsize/color/box/boxColor/boxOpacity fields override them so a
 * caption can match a bespoke look while staying structured sugar.
 *
 * The Translation `text` is emitted untouched onto `values.text` — FormatterManager
 * resolves the active locale, substitutes {{ variables }}, and escapes the string
 * downstream (the same text path every drawtext filter goes through).
 *
 * `ctx` (output scale + `global.platform`) only matters to the default position: see captionY. With
 * `wrap` / `fit`, the caption is wrapped to the frame instead, one drawtext per line (caption-wrap.ts),
 * which needs the motion context's text resolution; it falls back to the single line when it can't
 * measure the font.
 */
export function captionToFilters(
  caption?: Caption,
  ctx?: Pick<SugarContext, 'scale' | 'platform'> & Partial<Pick<SugarContext, 'motion'>>
): Filter[] {
  if (!caption || !hasText(caption.text)) {
    return [];
  }

  const y = captionY(caption, ctx);
  const x = expressionFor(ALIGN_X, caption.align, CAPTION_DEFAULT_ALIGN);
  const preset = captionStyleValues(caption.style);

  const values: Record<string, unknown> = {
    text: { ...caption.text },
    x,
    y,
    fontfile: resolveFontFile(caption.font, preset.fontfile),
    fontsize: caption.fontsize ?? preset.fontsize,
    fontcolor: caption.color ?? preset.fontcolor,
    ...resolveBox(caption, preset),
  };

  if (caption.wrap !== undefined || caption.fit !== undefined) {
    const { text: _text, y: _y, ...shared } = values;
    const wrapped = wrappedCaptionFilters(caption, ctx, { values: shared, x, size: values.fontsize as number });

    if (wrapped) return wrapped;
  }

  applyTextEffect(values, caption.effect);

  // An optional reveal overrides x/y with kinetic expressions and adds the alpha fade-in.
  applyReveal(values, caption.reveal, { x, y });

  return [
    {
      type: 'drawtext',
      values,
    },
  ];
}
