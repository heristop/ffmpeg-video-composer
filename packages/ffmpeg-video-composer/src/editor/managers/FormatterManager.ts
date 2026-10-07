import { inject, injectable } from 'tsyringe';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import type Template from '../../core/models/Template';
import type Segment from '../../core/models/Segment';
import type { FontRequest } from '../../core/models/Segment';
import type Project from '../../core/models/Project';
import DefaultConfig from '../../core/default.config';
import type { Filter, FilterValues } from '@/core/types';
import type VariableManager from './VariableManager';
import { isFontRef, fontRefSlug, type FontInput } from '@/core/fonts';
import { escapeDrawtextText } from '@/core/drawtext-text';
import { lutFileStem } from '../presets/lut-spec';

// The whole filtergraph is emitted as one double-quoted `-vf "…"` argv token, and parseCommand
// toggles its quote state on any inner `"`. So a literal `"` (or a NUL) in a filter type/value would
// close the token and let extra ffmpeg arguments be injected. Neither is ever valid filter syntax,
// so strip them from every value interpolated into a filter. (Display text neutralises `"` to a
// curly quote in escapeDrawtextText instead, so authored captions can still contain quote marks.)
function stripFilterUnsafe(value: string): string {
  return value.replaceAll('"', '').replaceAll(String.fromCodePoint(0), '');
}

// Extended filter values allowing runtime keys not captured in the core type.
type ExtendedFilterValues = FilterValues & Record<string, string | number | undefined>;

@injectable()
class FormatterManager {
  constructor(
    @inject('project') private readonly project: Project,
    @inject('template') private readonly template: Template,
    @inject('VariableManager') private readonly variableManager: VariableManager,
    @inject('segment') public segment: Segment,

    @inject('logger') private readonly logger: AbstractLogger
  ) {}

  formatMultipleTypesValue = (filter: Filter): string => {
    let result = '';

    switch (filter.type) {
      case 'setpts':
        result = this.formatVideoSpeed();
        break;

      case 'atempo': {
        // For audio, we need to use inverse of speed to stay in sync
        const speed = this.segment.currentSection?.options?.speed ?? 1;
        const audioSpeed = 1 / speed;

        // Limits for audio compatibility (0.5 to 2.0)
        const safeAudioSpeed = Math.max(0.5, Math.min(2.0, audioSpeed));
        result = `atempo=${safeAudioSpeed}`;
        break;
      }

      case 'scale':
        result = this.formatScale(filter.value);
        break;

      case 'lut3d':
        result = this.formatLut3d(String(filter.value ?? ''));
        break;

      default:
        result = `${stripFilterUnsafe(filter.type)}=${stripFilterUnsafe(String(filter.value ?? ''))}`;
    }

    return result;
  };

  private formatVideoSpeed(): string {
    // Speed < 1 accelerates video; the descriptor speed is a PTS multiplier.
    const speed = this.segment.currentSection?.options?.speed;

    return speed ? `setpts=${speed}*PTS` : 'setpts=PTS';
  }

  private formatScale(value: Filter['value']): string {
    if (value !== 'output') return `scale=${stripFilterUnsafe(String(value ?? ''))}`;

    // Finish a hand-framed scene at the actual project dimensions, preserving its aspect.
    const scale = stripFilterUnsafe(this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE);

    return `scale=${scale}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${scale}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  }

  // A LUT look carries a LUT spec as its value (e.g. "teal-orange", "teal-orange@0.6", "url:…@1", see
  // presets/lut-spec.ts). Register it for staging (same role as tempFonts) and rewrite it to a lut3d
  // reading the staged `.cube` from the build FS; a bare preset name keeps its historical file name.
  private formatLut3d(name: string): string {
    const spec = stripFilterUnsafe(name);

    if (!this.segment.tempLuts.includes(spec)) {
      this.segment.tempLuts.push(spec);
    }

    return `lut3d=file='${this.segment.lutsDir}/${lutFileStem(spec)}.cube'`;
  }

  private formatTextValue(key: string, values: ExtendedFilterValues): string | null {
    const textValue = values.text;

    if (textValue) {
      return `${key}='${this.formatText(textValue)}'`;
    }

    return null;
  }

  private formatDurationValue(key: string, values: ExtendedFilterValues, duration: number | undefined): string | null {
    const rawValue = values[key];

    if (rawValue === undefined) {
      return null;
    }

    const transitionDuration = this.template.descriptor.global?.transition?.duration?.toString() ?? '0';
    let durationStr = rawValue.toString().replace('{{ transitionDuration }}', transitionDuration);

    if (duration !== undefined) {
      durationStr = durationStr.replace('{{ section_duration }}', duration.toString());
    }

    if (!isNaN(Number(durationStr))) {
      return `${key}='${durationStr}'`;
    }

    return null;
  }

  private formatStartTimeValue(
    key: string,
    values: ExtendedFilterValues,
    duration: number | undefined,
    speed: number | undefined
  ): string | null {
    const rawValue = values[key];

    if (typeof rawValue !== 'string') {
      return null;
    }

    let stTime = duration ?? 0;

    if (speed !== undefined) {
      stTime *= speed;
    }

    stTime = parseFloat(stTime.toString()) - (this.template.descriptor.global?.transition?.duration ?? 0);
    const startTimeStr = rawValue.replace('{{ transitionStartTime }}', stTime.toString());

    if (!isNaN(Number(startTimeStr))) {
      return `${key}='${startTimeStr}'`;
    }

    return null;
  }

  private resolveColorFromValues(key: string, values: ExtendedFilterValues): string {
    const colorValue = values[key];

    return typeof colorValue === 'string' ? colorValue : '';
  }

  private formatColorValue(key: string, values: ExtendedFilterValues): string {
    return `${stripFilterUnsafe(key)}='${stripFilterUnsafe(this.formatColor(this.resolveColorFromValues(key, values)))}'`;
  }

  private formatFontValue(values: ExtendedFilterValues): string {
    return `fontfile='${stripFilterUnsafe(this.formatFont(values.fontfile ?? ''))}'`;
  }

  private formatDefaultValue(key: string, values: ExtendedFilterValues): string {
    const val = values[key];
    const stringVal = val === undefined ? '' : String(val);

    return `${stripFilterUnsafe(key)}=${stripFilterUnsafe(stringVal)}`;
  }

  formatMultipleTypesValues = (filter: Filter): string => {
    const filterValues = filter.values as ExtendedFilterValues | undefined;

    if (!filterValues) {
      return `${stripFilterUnsafe(filter.type)}=`;
    }

    const duration = this.segment.currentSection?.options?.duration;
    const speed = this.segment.currentSection?.options?.speed;
    const parts: string[] = [];

    for (const key of Object.keys(filterValues)) {
      this.appendFormattedValue(key, filterValues, duration, speed, parts);
    }

    return `${stripFilterUnsafe(filter.type)}=${parts.join(':')}`;
  };

  private pushIfPresent(parts: string[], formatted: string | null): void {
    if (formatted !== null) {
      parts.push(formatted);
    }
  }

  // drawtext/drawbox keys whose value is a colour token (`#rrggbb[@alpha]` or `{{ colorN }}`) and must
  // go through formatColor — fontcolor/boxcolor plus the shadow/outline colours.
  private static readonly COLOR_KEYS = new Set([
    'boxcolor',
    'fontcolor',
    'fontcolor_expr',
    'shadowcolor',
    'bordercolor',
    'color',
    'c',
  ]);

  private appendFormattedValue(
    key: string,
    filterValues: ExtendedFilterValues,
    duration: number | undefined,
    speed: number | undefined,
    parts: string[]
  ): void {
    if (FormatterManager.COLOR_KEYS.has(key)) {
      parts.push(this.formatColorValue(key, filterValues));

      return;
    }

    switch (key) {
      case 'text':
        this.pushIfPresent(parts, this.formatTextValue(key, filterValues));
        break;

      // Engine-generated drawtext text that carries `%{…}` expansions (kinetic counters): emitted as
      // authored by the lowering, which escapes its literal parts itself. Never reachable from JSON.
      case 'textExpr':
        parts.push(`text='${stripFilterUnsafe(String(filterValues.textExpr))}'`);
        break;

      case 'duration':
      case 'd':
        this.pushIfPresent(parts, this.formatDurationValue(key, filterValues, duration));
        break;

      case 'start_time':
      case 'st':
        this.pushIfPresent(parts, this.formatStartTimeValue(key, filterValues, duration, speed));
        break;

      case 'fontfile':
        parts.push(this.formatFontValue(filterValues));
        break;

      default:
        parts.push(this.formatDefaultValue(key, filterValues));
    }
  }

  /**
   * Applies text formatting for video overlay
   */
  formatText(text: string | Record<string, string | undefined>): string {
    // Use i18n
    const currentLocale = this.project.config.currentLocale ?? '';
    const rawText = typeof text === 'string' ? text : (text[currentLocale] ?? '');

    // Replace variables
    let result = this.variableManager.mapVariables(rawText);

    // Replace form fields
    result = this.variableManager.mapFields(result);

    // Upper case
    if (this.segment.currentSection?.options?.upperCase) {
      result = result.toUpperCase();
    }

    // Lower case
    if (this.segment.currentSection?.options?.lowerCase) {
      result = result.toLowerCase();
    }

    // Escape for the quoted `text='…'` value: `:` `%` `\` survive FFmpeg's parsers, and quotes become
    // typographic so authored text can't close the value or the `-vf "…"` argv token (see
    // core/drawtext-text.ts).
    return escapeDrawtextText(result);
  }

  /**
   * Resolves font file path
   */
  formatFont(font: FontInput): string {
    // A font named by family is staged under a slug derived from family+weight+style; the ref is
    // carried alongside so the download requests that exact face instead of guessing from the name.
    const request: FontRequest = isFontRef(font) ? { file: fontRefSlug(font), ref: font } : { file: font };
    const cached = this.template.assets.fonts[request.file];

    if (cached) {
      this.logger.info(`[${this.segment.currentSection?.name}][Font] loaded from cache font ${cached}`);

      return cached;
    }

    if (!this.segment.tempFonts.some(({ file }) => file === request.file)) {
      this.segment.tempFonts.push(request);
      this.logger.info(`[${this.segment.currentSection?.name}][Font] Added font to queue download ${request.file}`);
    }

    return `${this.segment.fontsDir}/${request.file}`;
  }

  /**
   * Replace color variables and handle both HEX and RGB formats
   */
  formatColor = (color: string): string => {
    // Handle undefined or null color values with a default
    if (!color) {
      return 'black';
    }

    if (!this.template.descriptor.global?.variables?.colorsList) {
      return this.variableManager.mapVariables(color) || 'black';
    }

    const colorsList = this.template.descriptor.global.variables.colorsList;

    // Resolve every `{{ colorN }}` tag in a single pass instead of scanning the whole
    // string once per color. `seen` preserves the original "replace first occurrence
    // only" semantics, and RGB->HEX is computed lazily for tags actually present.
    const seen = new Set<string>();

    return color.replace(/\{\{ color(\d+) \}\}/g, (match, indexStr) => {
      const index = Number(indexStr) - 1;

      if (index < 0 || index >= colorsList.length || seen.has(match)) {
        return match;
      }

      seen.add(match);
      const colorValue = colorsList[index];

      return colorValue.startsWith('rgb') ? this.convertRGBToHex(colorValue) : colorValue;
    });
  };

  /**
   * Convert RGB to HEX format
   */
  convertRGBToHex = (rgb: string): string => {
    const rgbArray = (rgb.match(/\d+/g) ?? []).map(Number);

    return `#${((1 << 24) + ((rgbArray[0] ?? 0) << 16) + ((rgbArray[1] ?? 0) << 8) + (rgbArray[2] ?? 0)).toString(16).slice(1).toUpperCase()}`;
  };
}

export default FormatterManager;
