// font_missing_glyphs / emoji_unsupported: text drawn with a bundled font that has no glyph for some of
// its characters. FFmpeg's drawtext exits 0 and draws an empty box (or nothing) for each of them, so the
// render "succeeds" with broken copy. Only bundled fonts are checked: their coverage ships with the
// engine (font-coverage.generated.ts); a font named by family or a system/raw .ttf can't be known here.
// Emoji are composited as bundled colour images by default (editor/emoji), so they only fail
// validation when the template opts into `global.emoji: "error"`.
import { findFontByFile } from '@/core/fonts';
import { fontCovers, fontsCovering, isCoverageKnown, isEmoji, isInvisible } from '@/core/font-coverage';
import { typographicText } from '@/core/drawtext-text';
import { DEFAULT_CHARSET } from '@/core/kinetic/extras';
import { emojiMode } from '@/core/emoji-assets';
import { kineticFontFile } from '@/core/kinetic/resolve';
import type { TemplateDescriptor } from '../schemas/template.schemas';
import { canvasFor, isRenderableSection, lowerTemplate, type LoweredSection } from './geometry/text-boxes';
import { subtitleSources } from './glyph-coverage-subtitles';

/** Structurally a ValidationError, plus an optional remedy. */
export interface GlyphFinding {
  path: string;
  message: string;
  code: string;
  hint?: string;
}

interface CaseOptions {
  upperCase?: boolean;
  lowerCase?: boolean;
}

// One drawn string: where it is authored, the font file it draws with and the copy (a Translation or
// a plain string).
interface TextSource {
  path: string;
  label: string;
  font: unknown;
  text: unknown;
  options?: CaseOptions;
}

type Variables = Record<string, unknown> | undefined;

const MAX_LISTED = 10;
const COUNTER_GLYPHS = '0123456789.';

// The drawtext layers the renderer's own lowerings emit (captions, title cards, lower thirds, authored
// drawtext filters, global overlays). Lowering is the geometry channel's job; a descriptor it can't
// lower is reported there, not here.
function loweredSafely(template: TemplateDescriptor): LoweredSection[] {
  try {
    return lowerTemplate(template, canvasFor(template.global?.orientation));
  } catch {
    return [];
  }
}

// A layer path names the sugar field; the copy itself sits at `.text` (`.values.text` for a filter).
function textPath(path: string): string {
  if (/\.filters\[\d+\]$/.test(path)) return `${path}.values.text`;

  return /(\.caption|^global\.overlays\[\d+\])$/.test(path) ? `${path}.text` : path;
}

function drawLayerSources(template: TemplateDescriptor): TextSource[] {
  return loweredSafely(template).flatMap(({ section, layers }) =>
    layers
      .filter((layer) => layer.kind === 'text')
      .map((layer) => ({
        path: textPath(layer.path),
        label: layer.label,
        font: layer.values.fontfile,
        text: layer.values.text,
        options: section.options,
      }))
  );
}

interface LooseKinetic {
  text?: unknown;
  preset?: string;
  font?: string;
  charset?: string;
  counter?: { prefix?: string; suffix?: string };
}

// A kinetic block draws its text (in the section's case) — or, as a counter, numerals between a prefix
// and a suffix — and the scramble preset also flashes decoys from its charset.
function kineticBlockSources(block: LooseKinetic, owner: Omit<TextSource, 'font' | 'text'>): TextSource[] {
  const { path, label, options } = owner;
  const font = kineticFontFile(block.font);
  const counter = block.counter ?? {};
  const sources: TextSource[] =
    block.preset === 'counter'
      ? [
          { path: `${path}.counter.prefix`, label, font, text: counter.prefix },
          { path: `${path}.counter.suffix`, label, font, text: counter.suffix },
          { path: `${path}.counter`, label, font, text: COUNTER_GLYPHS },
        ]
      : [{ path: `${path}.text`, label, font, text: block.text, options }];

  if (block.preset === 'scramble') {
    sources.push({ path: `${path}.charset`, label, font, text: block.charset ?? DEFAULT_CHARSET });
  }

  return sources;
}

function kineticSources(template: TemplateDescriptor): TextSource[] {
  return (template.sections ?? []).flatMap((section, index) => {
    const blocks = isRenderableSection(section) ? ((section as { kinetic?: LooseKinetic[] }).kinetic ?? []) : [];

    return blocks.flatMap((block, at) =>
      kineticBlockSources(block, {
        path: `sections[${index}].kinetic[${at}]`,
        label: `Section "${section.name}" kinetic ${at}`,
        options: section.options,
      })
    );
  });
}

// Every locale's copy, addressed by its own path.
function localeTexts(text: unknown, path: string): Array<{ path: string; text: string }> {
  if (typeof text === 'string') return [{ path, text }];

  if (typeof text !== 'object' || text === null) return [];

  return Object.entries(text)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([locale, value]) => ({ path: `${path}.${locale}`, text: value }));
}

// The descriptor's own variables resolve before drawing; anything still unresolved is runtime input
// and is skipped.
function resolvedText(text: string, variables: Variables, options: CaseOptions | undefined): string {
  const substituted = text.replace(/\{\{ (.+?) \}\}/g, (placeholder: string, key: string) => {
    const value = variables && Object.hasOwn(variables, key) ? variables[key] : undefined;
    const resolved = Array.isArray(value) ? value.join(', ') : value;

    return typeof resolved === 'string' || typeof resolved === 'number' ? String(resolved) : placeholder;
  });
  const drawn = typographicText(substituted.replace(/\{\{.*?\}\}/g, ''));
  const upper = options?.upperCase ? drawn.toUpperCase() : drawn;

  return options?.lowerCase ? upper.toLowerCase() : upper;
}

function missingChars(file: string, text: string): string[] {
  const missing = new Set<string>();

  for (const char of text) {
    if (!isInvisible(char) && !fontCovers(file, char.codePointAt(0) as number)) missing.add(char);
  }

  return [...missing];
}

function listed(chars: string[]): string {
  const shown = chars
    .slice(0, MAX_LISTED)
    .map((char) => JSON.stringify(char))
    .join(', ');

  return chars.length > MAX_LISTED ? `${shown} and ${chars.length - MAX_LISTED} more` : shown;
}

const NO_BUNDLED_FONT = 'No bundled font covers them (none has CJK, Arabic, Devanagari, Thai…).';

// Kinetic blocks lay out with bundled advance tables, so only text sugar can switch to a family font.
function glyphHint(chars: string[], path: string): string {
  const fonts = fontsCovering(chars);

  if (fonts.length > 0) {
    return `Use a bundled font that covers them: ${fonts.map((font) => `"${font.id}"`).join(', ')}.`;
  }

  if (path.includes('.kinetic[')) {
    return `${NO_BUNDLED_FONT} Kinetic blocks need a bundled font; draw this copy as a caption or title card with a font named by family instead.`;
  }

  if (path.includes('.subtitles.')) {
    return `${NO_BUNDLED_FONT} Subtitles are laid out with a bundled font; draw this copy as a caption with a font named by family instead.`;
  }

  return `${NO_BUNDLED_FONT} Name a font by family that does, e.g. { "family": "Noto Sans JP" } (resolved on Node and on device; the browser refuses family fonts).`;
}

const EMOJI_HINT =
  'global.emoji is "error": remove the emoji, or drop that setting so they render as bundled colour images (or set it to "strip").';

function findingsFor(
  source: TextSource,
  file: string,
  entry: { path: string; text: string },
  emojiFails: boolean
): GlyphFinding[] {
  const missing = missingChars(file, entry.text);
  const emoji = emojiFails ? missing.filter(isEmoji) : [];
  const glyphs = missing.filter((char) => !isEmoji(char));
  const findings: GlyphFinding[] = [];
  const fontName = findFontByFile(file)?.label ?? file;

  if (glyphs.length > 0) {
    findings.push({
      path: entry.path,
      message: `${source.label}: font "${fontName}" has no glyph for ${listed(glyphs)} — FFmpeg would draw empty boxes`,
      code: 'font_missing_glyphs',
      hint: glyphHint(glyphs, entry.path),
    });
  }

  if (emoji.length > 0) {
    findings.push({
      path: entry.path,
      message: `${source.label}: emoji ${listed(emoji)} cannot be drawn by drawtext (font "${fontName}")`,
      code: 'emoji_unsupported',
      hint: EMOJI_HINT,
    });
  }

  return findings;
}

/** One drawn string, per locale, as drawtext receives it (variables resolved, section case applied). */
export interface DrawnText {
  path: string;
  label: string;
  font: unknown;
  text: string;
}

function onceEach<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const id = key(item);
    const fresh = !seen.has(id);

    seen.add(id);

    return fresh;
  });
}

/** Every string the template draws, per locale. A global overlay is lowered once per section; kept once. */
export function drawnTexts(template: TemplateDescriptor): DrawnText[] {
  const variables = template.global?.variables as Variables;
  const sources = [...drawLayerSources(template), ...kineticSources(template), ...subtitleSources(template.sections)];
  const texts = sources.flatMap((source) =>
    localeTexts(source.text, source.path).map((entry) => ({
      path: entry.path,
      label: source.label,
      font: source.font,
      text: resolvedText(entry.text, variables, source.options),
    }))
  );

  return onceEach(texts, (drawn) => `${drawn.path}|${drawn.text}`);
}

/** Characters a bundled font can't draw, per drawn text and locale. */
export function validateGlyphCoverage(template: TemplateDescriptor): GlyphFinding[] {
  const emojiFails = emojiMode(template.global) === 'error';
  const findings = drawnTexts(template).flatMap((drawn) => {
    const file = typeof drawn.font === 'string' && isCoverageKnown(drawn.font) ? drawn.font : null;

    return file ? findingsFor(drawn, file, drawn, emojiFails) : [];
  });

  return onceEach(findings, (finding) => `${finding.code}|${finding.path}|${finding.message}`);
}
