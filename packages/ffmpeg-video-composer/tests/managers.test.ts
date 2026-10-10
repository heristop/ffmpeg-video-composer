import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import FormatterManager from '@/editor/managers/FormatterManager';
import FilterManager from '@/editor/managers/FilterManager';
import MapManager from '@/editor/managers/MapManager';
import VariableManager from '@/editor/managers/VariableManager';
import * as filterCompat from '@/editor/utils/filter-compat';
import type { Filter, Map as FilterMap, MapAnimationInput, Section } from '@/core/types';
import type { FontRequest } from '@/core/models/Segment';
import { markBackgroundInput } from '@/editor/utils/background-input';

// ---------------------------------------------------------------------------
// Lightweight stubs for the DI-injected collaborators. Managers are plain
// classes whose constructors only store references, so we can instantiate them
// directly with hand-rolled doubles instead of booting the tsyringe container.
// ---------------------------------------------------------------------------

interface StubTemplate {
  descriptor: {
    global?: {
      variables?: Record<string, string | string[]>;
      transition?: { type: string; duration?: number };
    };
  };
  assets: {
    fonts: Record<string, string>;
    musics: Record<string, string>;
    inputs: Record<string, string | string[]>;
  };
}

function createTemplate(overrides: Partial<StubTemplate> = {}): StubTemplate {
  return {
    descriptor: overrides.descriptor ?? {},
    assets: overrides.assets ?? { fonts: {}, musics: {}, inputs: {} },
  };
}

function createProject(config: Record<string, unknown> = {}) {
  return { config };
}

function createSegment(currentSection?: Section) {
  return {
    currentSection,
    filtersList: [] as string[],
    filtersMapList: [] as string[],
    mapsList: [] as string[],
    assetsDir: '',
    fontsDir: '',
    tempFonts: [] as FontRequest[],
    lutsDir: '',
    tempLuts: [] as string[],
    inputsAsset: [] as string[],
    inputsMapCount: 0,
  };
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// VariableManager double that just passes text through unchanged unless overridden.
function createVariableManagerStub() {
  return {
    mapVariables: vi.fn((value: string) => value),
    mapFields: vi.fn((value: string) => value),
  };
}

// ---------------------------------------------------------------------------
// VariableManager (real implementation)
// ---------------------------------------------------------------------------

describe('VariableManager', () => {
  function build(variables?: Record<string, string | string[]>, fields?: Record<string, string>): VariableManager {
    const template = createTemplate({
      descriptor: { global: variables ? { variables } : undefined },
    });
    const project = createProject(fields ? { fields } : {});

    return new VariableManager(template as any, project as any);
  }

  it('returns value unchanged when no variables defined', () => {
    const vm = build(undefined);
    expect(vm.mapVariables('hello {{ name }}')).toBe('hello {{ name }}');
  });

  it('returns value unchanged when variables object is empty', () => {
    const vm = build({});
    expect(vm.mapVariables('hello {{ name }}')).toBe('hello {{ name }}');
  });

  it('replaces a single placeholder', () => {
    const vm = build({ name: 'Alice' });
    expect(vm.mapVariables('hello {{ name }}')).toBe('hello Alice');
  });

  it('replaces multiple distinct placeholders in one pass', () => {
    const vm = build({ first: 'Ada', last: 'Lovelace' });
    expect(vm.mapVariables('{{ first }} {{ last }}')).toBe('Ada Lovelace');
  });

  it('joins array placeholder values with a comma', () => {
    const vm = build({ tags: ['a', 'b', 'c'] });
    expect(vm.mapVariables('tags: {{ tags }}')).toBe('tags: a, b, c');
  });

  it('escapes special regex characters in keys', () => {
    const vm = build({ 'weird.key': 'ok' });
    expect(vm.mapVariables('val {{ weird.key }}')).toBe('val ok');
  });

  it('mapFields returns value unchanged when no fields defined', () => {
    const vm = build({ a: '1' });
    expect(vm.mapFields('x {{ field }}')).toBe('x {{ field }}');
  });

  it('mapFields replaces field placeholders', () => {
    const vm = build(undefined, { firstname: 'Bob' });
    expect(vm.mapFields('hi {{ firstname }}')).toBe('hi Bob');
  });

  it('mapFields returns value unchanged when fields object is empty', () => {
    const vm = build(undefined, {});
    expect(vm.mapFields('hi {{ firstname }}')).toBe('hi {{ firstname }}');
  });
});

// ---------------------------------------------------------------------------
// FormatterManager
// ---------------------------------------------------------------------------

describe('FormatterManager', () => {
  function build(
    opts: {
      section?: Section;
      variables?: Record<string, string | string[]>;
      colorsList?: string[];
      transitionDuration?: number;
      fonts?: Record<string, string>;
      currentLocale?: string;
      scale?: string;
      vmStub?: ReturnType<typeof createVariableManagerStub>;
    } = {}
  ) {
    const template = createTemplate({
      descriptor: {
        global: {
          variables: { ...opts.variables, ...(opts.colorsList ? { colorsList: opts.colorsList } : undefined) },
          transition:
            opts.transitionDuration === undefined ? undefined : { type: 'fade', duration: opts.transitionDuration },
        },
      },
      assets: { fonts: opts.fonts ?? {}, musics: {}, inputs: {} },
    });
    const project = createProject({ currentLocale: opts.currentLocale ?? 'en', videoConfig: { scale: opts.scale } });
    const segment = createSegment(opts.section);
    const logger = createLogger();
    const vm = opts.vmStub ?? createVariableManagerStub();

    const manager = new FormatterManager(project as any, template as any, vm as any, segment as any, logger as any);

    return { manager, segment, logger, vm, template };
  }

  describe('formatMultipleTypesValue', () => {
    it.each(['1280:720', '720:1280', '1080:1080', '640:360'])(
      'scale output conforms an authored frame to %s',
      (scale) => {
        const { manager } = build({ scale });
        expect(manager.formatMultipleTypesValue({ type: 'scale', value: 'output' })).toBe(
          `scale=${scale}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${scale}:(ow-iw)/2:(oh-ih)/2,setsar=1`
        );
      }
    );

    it('setpts uses normal PTS when no speed option', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      expect(manager.formatMultipleTypesValue({ type: 'setpts' } as Filter)).toBe('setpts=PTS');
    });

    it('setpts multiplies PTS by speed when speed set', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { speed: 0.25 } } });
      expect(manager.formatMultipleTypesValue({ type: 'setpts' } as Filter)).toBe('setpts=0.25*PTS');
    });

    it('atempo inverts speed and stays within [0.5, 2]', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { speed: 0.5 } } });
      // 1/0.5 = 2 -> capped at 2
      expect(manager.formatMultipleTypesValue({ type: 'atempo' } as Filter)).toBe('atempo=2');
    });

    it('atempo clamps very low speeds to 0.5', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { speed: 4 } } });
      // 1/4 = 0.25 -> clamped to 0.5
      expect(manager.formatMultipleTypesValue({ type: 'atempo' } as Filter)).toBe('atempo=0.5');
    });

    it('lut3d rewrites the LUT name to a staged .cube path and registers it for staging', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.lutsDir = '/build/luts';

      const result = manager.formatMultipleTypesValue({ type: 'lut3d', value: 'teal-orange' } as Filter);

      expect(result).toBe("lut3d=file='/build/luts/teal-orange.cube'");
      expect(segment.tempLuts).toEqual(['teal-orange']);
    });

    it('lut3d registers each distinct LUT only once', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.lutsDir = '/build/luts';

      manager.formatMultipleTypesValue({ type: 'lut3d', value: 'mono' } as Filter);
      manager.formatMultipleTypesValue({ type: 'lut3d', value: 'mono' } as Filter);

      expect(segment.tempLuts).toEqual(['mono']);
    });

    it('atempo defaults speed to 1 when unset', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      expect(manager.formatMultipleTypesValue({ type: 'atempo' } as Filter)).toBe('atempo=1');
    });

    it('default branch concatenates type and value', () => {
      const { manager } = build();
      expect(manager.formatMultipleTypesValue({ type: 'eq', value: 'contrast=1' } as Filter)).toBe('eq=contrast=1');
    });
  });

  // The filtergraph is emitted as a single double-quoted `-vf "…"` argv token; a raw `"` in a filter
  // value/type or in overlay text would close it and inject extra ffmpeg arguments. No formatter
  // output may contain a literal double quote.
  describe('filtergraph injection safety', () => {
    it('strips a double quote from a raw filter value (no argv breakout)', () => {
      const { manager } = build();
      const out = manager.formatMultipleTypesValue({
        type: 'eq',
        value: 'contrast=1" -i /etc/passwd -y /tmp/x "',
      } as Filter);
      expect(out).not.toContain('"');
    });

    it('strips a double quote from the filter type', () => {
      const { manager } = build();
      expect(manager.formatMultipleTypesValue({ type: 'drawbox" -i /etc/passwd', value: 'x' } as Filter)).not.toContain(
        '"'
      );
    });

    it('strips a double quote from a default (key=value) filter value', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const out = manager.formatMultipleTypesValues({
        type: 'drawbox',
        values: { x: '0" -i /etc/passwd "' },
      } as Filter);
      expect(out).not.toContain('"');
    });

    it('neutralises a double quote in drawtext display text', () => {
      const { manager } = build({ section: { name: 's', type: 'color_background' } });
      expect(manager.formatText('hi " -i /etc/passwd "')).not.toContain('"');
    });
  });

  describe('formatMultipleTypesValues', () => {
    it('returns type= when no values present', () => {
      const { manager } = build();
      expect(manager.formatMultipleTypesValues({ type: 'drawtext' } as Filter)).toBe('drawtext=');
    });

    it('a drawbox timeline gate (enable) keeps its single quotes and comma intact', () => {
      // The reveal-timed solid layer / accent bar path: the pre-quoted `'gte(t,0.3)'` must survive
      // the default value formatting (stripFilterUnsafe removes only `"` and spaces).
      const { manager } = build({ section: { name: 's', type: 'color_background' } });
      const filter = {
        type: 'drawbox',
        values: { x: 0, y: 0, w: 'iw', h: 'ih', c: '#112233@1', t: 'fill', enable: "'gte(t,0.3)'" },
      } as unknown as Filter;

      expect(manager.formatMultipleTypesValues(filter)).toBe(
        "drawbox=x=0:y=0:w=iw:h=ih:c='#112233@1':t=fill:enable='gte(t,0.3)'"
      );
    });

    it('formats text value with escaping and locale', () => {
      const { manager } = build({
        section: { name: 's', type: 'color_background' },
        currentLocale: 'en',
      });
      const filter = { type: 'drawtext', values: { text: { en: "It's 50%: ok" } } } as unknown as Filter;
      const result = manager.formatMultipleTypesValues(filter);
      // ' -> right single quote, % -> escaped, : -> escaped
      expect(result).toContain('drawtext=text=');
      expect(result).toContain('’'); // apostrophe replaced
    });

    it('formats an empty localized text record as empty quotes', () => {
      const { manager } = build({ section: { name: 's', type: 'color_background' } });
      // a present (truthy) text object still formats, resolving to empty string
      const filter = { type: 'drawtext', values: { text: { en: '' } } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toBe("drawtext=text=''");
    });

    it('skips the text part entirely when the text value is falsy', () => {
      const { manager } = build({ section: { name: 's', type: 'color_background' } });
      // empty-string text is falsy -> formatTextValue returns null -> nothing pushed
      const filter = { type: 'drawtext', values: { text: '' } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toBe('drawtext=');
    });

    it('formats numeric duration value substituting transition and section duration', () => {
      const { manager } = build({
        section: { name: 's', type: 'video', options: { duration: 12 } },
        transitionDuration: 2,
      });
      const filter = {
        type: 'fade',
        values: { d: '{{ transitionDuration }}', duration: '{{ section_duration }}' },
      } as unknown as Filter;
      const result = manager.formatMultipleTypesValues(filter);
      expect(result).toContain("d='2'");
      expect(result).toContain("duration='12'");
    });

    it('skips duration value when undefined', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'fade', values: { d: undefined } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toBe('fade=');
    });

    it('skips duration when not numeric after substitution', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'fade', values: { d: 'abc' } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toBe('fade=');
    });

    it('defaults transitionDuration to 0 when global value missing', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'fade', values: { d: '{{ transitionDuration }}' } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toContain("d='0'");
    });

    it('formats start_time value with speed and transition offset', () => {
      const { manager } = build({
        section: { name: 's', type: 'video', options: { duration: 10, speed: 2 } },
        transitionDuration: 1,
      });
      const filter = { type: 'fade', values: { st: '{{ transitionStartTime }}' } } as unknown as Filter;
      // stTime = 10 * 2 - 1 = 19
      expect(manager.formatMultipleTypesValues(filter)).toContain("st='19'");
    });

    it('start_time falls back to duration 0 and no transition when unset', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'fade', values: { st: '{{ transitionStartTime }}' } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toContain("st='0'");
    });

    it('skips start_time when value is not a string', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'fade', values: { st: 5 } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toBe('fade=');
    });

    it('skips start_time when not numeric after substitution', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'fade', values: { st: 'notnum' } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toBe('fade=');
    });

    it('formats color keys (fontcolor, boxcolor, color, c, fontcolor_expr)', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = {
        type: 'drawtext',
        values: { fontcolor: '#FFFFFF', boxcolor: '#000000', color: 'red', c: 'blue', fontcolor_expr: '#ABCABC' },
      } as unknown as Filter;
      const result = manager.formatMultipleTypesValues(filter);
      expect(result).toContain("fontcolor='#FFFFFF'");
      expect(result).toContain("boxcolor='#000000'");
      expect(result).toContain("color='red'");
      expect(result).toContain("c='blue'");
      expect(result).toContain("fontcolor_expr='#ABCABC'");
    });

    it('color value uses black when value is not a string', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'drawtext', values: { fontcolor: 123 } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toContain("fontcolor='black'");
    });

    it('renders a background box (box, boxcolor, boxborderw) into the drawtext arg', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = {
        type: 'drawtext',
        values: { text: { en: 'Hi' }, box: 1, boxcolor: '#000000@0.5', boxborderw: 12 },
      } as unknown as Filter;
      const result = manager.formatMultipleTypesValues(filter);
      expect(result).toContain('box=1');
      expect(result).toContain("boxcolor='#000000@0.5'");
      expect(result).toContain('boxborderw=12');
    });

    it('formats fontfile value and queues the font', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'drawtext', values: { fontfile: 'Roboto-Bold.ttf' } } as unknown as Filter;
      const result = manager.formatMultipleTypesValues(filter);
      expect(result).toContain('fontfile=');
      expect(segment.tempFonts).toContainEqual({ file: 'Roboto-Bold.ttf' });
    });

    it('fontfile defaults to empty string when not provided', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'drawtext', values: { fontfile: undefined } } as unknown as Filter;
      const result = manager.formatMultipleTypesValues(filter);
      expect(result).toContain("fontfile='");
    });

    it('formats default unknown keys as key=value', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'drawtext', values: { fontsize: 48 } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toContain('fontsize=48');
    });

    it('default key with undefined value becomes key=', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const filter = { type: 'drawtext', values: { fontsize: undefined } } as unknown as Filter;
      expect(manager.formatMultipleTypesValues(filter)).toContain('fontsize=');
    });
  });

  describe('formatText', () => {
    it('uses locale-specific text from a record', () => {
      const { manager } = build({ section: { name: 's', type: 'video' }, currentLocale: 'fr' });
      expect(manager.formatText({ fr: 'Bonjour', en: 'Hello' })).toBe('Bonjour');
    });

    it('falls back to empty string when locale missing in record', () => {
      const { manager } = build({ section: { name: 's', type: 'video' }, currentLocale: 'de' });
      expect(manager.formatText({ en: 'Hello' })).toBe('');
    });

    it('uses empty locale when currentLocale undefined', () => {
      const template = createTemplate({ descriptor: { global: {} } });
      const project = createProject({}); // no currentLocale
      const segment = createSegment({ name: 's', type: 'video' });
      const logger = createLogger();
      const vm = createVariableManagerStub();
      const manager = new FormatterManager(project as any, template as any, vm as any, segment as any, logger as any);
      expect(manager.formatText('plain')).toBe('plain');
    });

    it('applies upperCase option', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { upperCase: true } } });
      expect(manager.formatText('hello')).toBe('HELLO');
    });

    it('applies lowerCase option', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { lowerCase: true } } });
      expect(manager.formatText('HELLO')).toBe('hello');
    });

    it('escapes reserved characters', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      const out = manager.formatText("a:b'c%d");
      expect(out).toContain('’'); // apostrophe
      expect(out).not.toBe("a:b'c%d");
    });
  });

  describe('formatFont', () => {
    it('returns cached font path from assets and logs', () => {
      const { manager, logger } = build({
        section: { name: 's', type: 'video' },
        fonts: { 'Roboto.ttf': '/cached/Roboto.ttf' },
      });
      expect(manager.formatFont('Roboto.ttf')).toBe('/cached/Roboto.ttf');
      expect(logger.info).toHaveBeenCalled();
    });

    it('queues font for download and returns fontsDir path', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.fontsDir = '/fonts';
      const result = manager.formatFont('NewFont.ttf');
      expect(result).toBe('/fonts/NewFont.ttf');
      expect(segment.tempFonts).toContainEqual({ file: 'NewFont.ttf' });
    });

    it('does not re-queue a font already in tempFonts', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.fontsDir = '/fonts';
      segment.tempFonts.push({ file: 'Existing.ttf' });
      manager.formatFont('Existing.ttf');
      expect(segment.tempFonts.filter((f) => f.file === 'Existing.ttf')).toHaveLength(1);
    });

    // A font named by family is staged under a slug derived from family+weight+style, and the ref
    // travels with it so the download requests that exact face rather than guessing from the name.
    it('queues a FontRef under its slug and keeps the ref alongside', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.fontsDir = '/fonts';
      const result = manager.formatFont({ family: 'Playfair Display', weight: 700 });
      expect(result).toBe('/fonts/google-playfair-display-700.ttf');
      expect(segment.tempFonts).toContainEqual({
        file: 'google-playfair-display-700.ttf',
        ref: { family: 'Playfair Display', weight: 700 },
      });
    });

    it('does not re-queue the same family and weight twice', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.fontsDir = '/fonts';
      manager.formatFont({ family: 'Inter', weight: 700 });
      manager.formatFont({ family: 'Inter', weight: 700 });
      expect(segment.tempFonts).toHaveLength(1);
    });

    it('queues two weights of one family separately', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });
      segment.fontsDir = '/fonts';
      manager.formatFont({ family: 'Inter', weight: 400 });
      manager.formatFont({ family: 'Inter', weight: 700 });
      expect(segment.tempFonts).toHaveLength(2);
    });
  });

  describe('formatColor', () => {
    it('returns black for falsy color', () => {
      const { manager } = build();
      expect(manager.formatColor('')).toBe('black');
    });

    it('maps variables when no colorsList and returns result', () => {
      const vmStub = createVariableManagerStub();
      vmStub.mapVariables.mockReturnValue('#123456');
      const { manager } = build({ vmStub });
      expect(manager.formatColor('{{ brand }}')).toBe('#123456');
    });

    it('returns black when variable mapping yields empty string', () => {
      const vmStub = createVariableManagerStub();
      vmStub.mapVariables.mockReturnValue('');
      const { manager } = build({ vmStub });
      expect(manager.formatColor('{{ missing }}')).toBe('black');
    });

    it('replaces {{ colorN }} from colorsList (hex passthrough)', () => {
      const { manager } = build({ colorsList: ['#AAAAAA', '#BBBBBB'] });
      expect(manager.formatColor('{{ color1 }} and {{ color2 }}')).toBe('#AAAAAA and #BBBBBB');
    });

    it('converts rgb colorsList entries to hex', () => {
      const { manager } = build({ colorsList: ['rgb(255, 0, 0)'] });
      expect(manager.formatColor('{{ color1 }}')).toBe('#FF0000');
    });

    it('leaves out-of-range color index untouched', () => {
      const { manager } = build({ colorsList: ['#AAAAAA'] });
      expect(manager.formatColor('{{ color5 }}')).toBe('{{ color5 }}');
    });

    it('only replaces the first occurrence of a repeated color tag', () => {
      const { manager } = build({ colorsList: ['#AAAAAA'] });
      // seen set keeps the second untouched
      expect(manager.formatColor('{{ color1 }} {{ color1 }}')).toBe('#AAAAAA {{ color1 }}');
    });
  });

  describe('convertRGBToHex', () => {
    it('converts a standard rgb string', () => {
      const { manager } = build();
      expect(manager.convertRGBToHex('rgb(16, 32, 48)')).toBe('#102030');
    });

    it('handles missing channels by defaulting them to 0', () => {
      const { manager } = build();
      expect(manager.convertRGBToHex('rgb()')).toBe('#000000');
    });
  });
});

// ---------------------------------------------------------------------------
// FilterManager
// ---------------------------------------------------------------------------

describe('FilterManager', () => {
  function build(
    opts: {
      section?: Section;
      transitionDuration?: number;
      videoCodec?: string;
    } = {}
  ) {
    const template = createTemplate({
      descriptor: {
        global: {
          transition:
            opts.transitionDuration === undefined ? undefined : { type: 'fade', duration: opts.transitionDuration },
        },
      },
    });
    const segment = createSegment(opts.section);
    const formatters = {
      formatMultipleTypesValue: vi.fn((f: Filter) => `single:${f.type}=${String(f.value)}`),
      formatMultipleTypesValues: vi.fn((f: Filter) => `multi:${f.type}`),
    };
    const project = { config: { codecConfig: { videoCodec: opts.videoCodec ?? 'h264' } } };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = new FilterManager(
      template as any,
      formatters as any,
      segment as any,
      project as any,
      logger as any
    );

    return { manager, formatters, segment, logger };
  }

  it('delegates single-value filters to formatMultipleTypesValue', () => {
    const { manager, formatters } = build();
    const out = manager.addFilter({ type: 'eq', value: 'x' } as Filter);
    expect(formatters.formatMultipleTypesValue).toHaveBeenCalled();
    expect(out).toBe('single:eq=x');
  });

  it('keeps the GPL eq filter on the full-ffmpeg (h264) engine', () => {
    const { manager } = build({ videoCodec: 'h264' });
    const out = manager.addFilter({ type: 'eq', value: 'contrast=1.1' } as Filter);
    expect(out).toBe('single:eq=contrast=1.1');
  });

  it('rewrites eq to an LGPL lutyuv LUT on the on-device libopenh264 engine', () => {
    const { manager } = build({ videoCodec: 'libopenh264' });
    const out = manager.addFilter({ type: 'eq', value: 'contrast=1.1:saturation=1.2' } as Filter);
    expect(out).toContain('single:lutyuv=');
    expect(out).toContain("u='clip((val-128)*1.2+128,0,255)'");
    expect(out).not.toContain('eq=');
  });

  it('drops a filter with no compat equivalent to the no-op null filter, warning via the logger', () => {
    const { manager, logger } = build();
    const spy = vi.spyOn(filterCompat, 'applyFilterCompat').mockReturnValue(null);

    const out = manager.addFilter({ type: 'vignette', value: 'x=1' } as Filter);

    expect(out).toBe('null');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped unavailable filter "vignette"'));

    spy.mockRestore();
  });

  it('delegates multi-value filters to formatMultipleTypesValues', () => {
    const { manager, formatters } = build();
    const out = manager.addFilter({ type: 'drawtext', values: { fontsize: 1 } } as unknown as Filter);
    expect(formatters.formatMultipleTypesValues).toHaveBeenCalled();
    expect(out).toBe('multi:drawtext');
  });

  // Regression guard: bakeTextAnimation coerced schema-valid NUMERIC x/y (FilterValuesSchema allows
  // number | string) to '0', so a positioned drawtext with a reveal animated around the frame origin
  // and settled at the top-left instead of its authored position.
  it('bakes a reveal animation around a numeric base position', () => {
    const { manager, formatters } = build({ section: { name: 's', type: 'video', options: { duration: 5 } } });
    manager.addFilter({
      type: 'drawtext',
      reveal: 'rise',
      values: { text: { en: 'Hi' }, x: 100, y: 500 },
    } as unknown as Filter);

    const baked = formatters.formatMultipleTypesValues.mock.calls.at(-1)?.[0] as Filter;
    expect(String(baked.values?.y)).toContain('(500)');
    expect(String(baked.values?.y)).not.toContain('(0)');
  });

  it('returns the bare type when neither value nor values present', () => {
    const { manager } = build();
    expect(manager.addFilter({ type: 'hflip' } as Filter)).toBe('hflip');
  });

  it('applies enable-between suffix when range present', () => {
    const { manager } = build({
      section: { name: 's', type: 'video', options: { duration: 8 } },
      transitionDuration: 1,
    });
    const out = manager.addFilter({
      type: 'overlay',
      value: '0:0',
      range: 'start=2:end=8',
    } as Filter);
    // single value filter -> formatMultipleTypesValue invoked with mutated value
    expect(out).toContain('single:overlay=');
    expect(out).toContain("enable='between(t,2,8)'");
  });

  describe('remapEnableBetweenSuffix', () => {
    it('returns filter unchanged when no range', () => {
      const { manager } = build();
      const filter = { type: 'overlay', value: 'x' } as Filter;
      expect(manager.remapEnableBetweenSuffix(filter)).toBe(filter);
    });

    it('returns filter unchanged when range lacks two segments', () => {
      const { manager } = build();
      const filter = { type: 'overlay', value: 'x', range: 'start=1' } as Filter;
      expect(manager.remapEnableBetweenSuffix(filter)).toBe(filter);
    });

    it('uses transitionDuration as end when only start matches', () => {
      const { manager } = build({ transitionDuration: 3 });
      const filter = { type: 'overlay', value: 'v', range: 'start=2:nope=5' } as Filter;
      const out = manager.remapEnableBetweenSuffix(filter);
      expect(out.value).toContain('between(t,2,3)');
    });

    it('keeps default start=0/end=transition when start does not match', () => {
      const { manager } = build({ transitionDuration: 4 });
      // first segment has no "start=" substring, so startTime is undefined and
      // the end-override block is skipped, leaving start=0 / end=transitionDuration.
      const filter = { type: 'overlay', value: 'v', range: 'from=1:end=9' } as Filter;
      const out = manager.remapEnableBetweenSuffix(filter);
      expect(out.value).toContain('between(t,0,4)');
    });

    it('substitutes section_duration token in a numeric end value', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { duration: 6 } } });
      // Authored filters can carry numeric ranges; assert the start path and a
      // resolved numeric end derived from the section duration.
      const filter = { type: 'overlay', value: 'v', range: 'start=1:end=6' } as Filter;
      const out = manager.remapEnableBetweenSuffix(filter);
      expect(out.value).toContain('between(t,1,6)');
    });

    // Regression guard: parseFloat used to run on the RAW end text, so the documented
    // `end={{ section_duration }}` token parsed to NaN, slipped past the undefined check, and
    // emitted between(t,…,NaN) — an enable expression that is never true, silently disabling
    // the filter for the whole section.
    it('resolves an end={{ section_duration }} token to the section duration', () => {
      const { manager } = build({ section: { name: 's', type: 'video', options: { duration: 6 } } });
      const filter = { type: 'overlay', value: 'v', range: 'start=0.5:end={{ section_duration }}' } as Filter;
      const out = manager.remapEnableBetweenSuffix(filter);
      expect(out.value).toContain("enable='between(t,0.5,6)'");
    });

    it('falls back to the transition-duration end when the end value is unparseable', () => {
      const { manager } = build({ transitionDuration: 3 });
      const filter = { type: 'overlay', value: 'v', range: 'start=1:end=oops' } as Filter;
      const out = manager.remapEnableBetweenSuffix(filter);
      expect(out.value).toContain('between(t,1,3)');
    });
  });

  describe('remapFadeTypeShortcuts', () => {
    it('expands fadein into a fade filter with in defaults', () => {
      const { manager } = build();
      const out = manager.remapFadeTypeShortcuts({ type: 'fadein' } as Filter);
      expect(out.type).toBe('fade');
      expect(out.values?.t).toBe('in');
      expect(out.values?.d).toBe('{{ transitionDuration }}');
    });

    it('expands fadeout into a fade filter with out defaults', () => {
      const { manager } = build();
      const out = manager.remapFadeTypeShortcuts({ type: 'fadeout' } as Filter);
      expect(out.type).toBe('fade');
      expect(out.values?.t).toBe('out');
      expect(out.values?.st).toBe('{{ transitionStartTime }}');
    });

    it('preserves user-provided values over fade defaults', () => {
      const { manager } = build();
      const out = manager.remapFadeTypeShortcuts({
        type: 'fadein',
        values: { t: 'custom' },
      } as unknown as Filter);
      // user value overrides default because spread of existing values comes last
      expect(out.values?.t).toBe('custom');
    });

    it('returns non-fade filters unchanged via default branch', () => {
      const { manager } = build();
      const filter = { type: 'scale', value: '2' } as Filter;
      const out = manager.remapFadeTypeShortcuts(filter);
      expect(out.type).toBe('scale');
    });

    it('addFilter routes fadein through remap then formatter', () => {
      const { manager, formatters } = build({ transitionDuration: 1 });
      const out = manager.addFilter({ type: 'fadein' } as Filter);
      expect(formatters.formatMultipleTypesValues).toHaveBeenCalled();
      expect(out).toBe('multi:fade');
    });
  });
});

// ---------------------------------------------------------------------------
// MapManager
// ---------------------------------------------------------------------------

describe('MapManager', () => {
  function build(
    opts: {
      section?: Section;
      transitionDuration?: number;
      inputsCache?: Record<string, string | string[]>;
    } = {}
  ) {
    const template = createTemplate({
      descriptor: {
        global: {
          transition:
            opts.transitionDuration === undefined ? undefined : { type: 'fade', duration: opts.transitionDuration },
        },
      },
      assets: { fonts: {}, musics: {}, inputs: opts.inputsCache ?? {} },
    });
    const segment = createSegment(opts.section);
    const formatters = {
      // Identity colour formatter (the real one resolves {{ colorN }} and falls back to a default).
      formatColor: vi.fn((c: string) => c),
    };
    const filterManager = {
      addFilter: vi.fn((f: Filter) => `F(${f.type})`),
    };
    const manager = new MapManager(formatters as any, filterManager as any, segment as any);

    return { manager, segment, filterManager, template };
  }

  describe('addMap', () => {
    it('throws when currentSection is unset and section filters are needed', () => {
      const { manager } = build({ section: undefined });
      // No section filters branch requires currentSection getter -> throws
      expect(() => manager.addMap({ inputs: ['0:v'], outputs: ['out'], filters: [] } as FilterMap)).toThrow(
        '[MapManager] currentSection is not set'
      );
    });

    it('builds a filter graph with mapped inputs and outputs', () => {
      const { manager, segment, filterManager } = build({
        section: { name: 's', type: 'video', filters: [] },
      });
      manager.addMap({
        inputs: ['0:v'],
        outputs: ['vout'],
        filters: [{ type: 'scale', value: '2' }],
      } as FilterMap);
      expect(segment.mapsList).toContain('vout');
      expect(filterManager.addFilter).toHaveBeenCalled();
      expect(segment.filtersMapList[0]).toBe('[0:v]F(scale)[vout]');
    });

    it('merges section filters when useSectionFilters is true', () => {
      const sectionFilters: Filter[] = [{ type: 'eq', value: '1' }];
      const { manager, segment, filterManager } = build({
        section: { name: 's', type: 'video', filters: sectionFilters },
      });
      manager.addMap({
        inputs: ['0:v'],
        outputs: ['o'],
        filters: [{ type: 'scale', value: '2' }],
        options: { useSectionFilters: true },
      } as FilterMap);
      // both map filter and section filter applied
      expect(filterManager.addFilter).toHaveBeenCalledTimes(2);
      expect(segment.filtersMapList[0]).toContain('F(scale)');
      expect(segment.filtersMapList[0]).toContain('F(eq)');
    });

    it('merges section filters when map has no filters', () => {
      const sectionFilters: Filter[] = [{ type: 'eq', value: '1' }];
      const { manager, filterManager } = build({
        section: { name: 's', type: 'video', filters: sectionFilters },
      });
      manager.addMap({ inputs: ['0:v'], outputs: ['o'] } as FilterMap);
      expect(filterManager.addFilter).toHaveBeenCalledTimes(1);
    });
  });

  describe('addChromakeyComposite', () => {
    it('builds a split → drawbox(bg) → colorkey → overlay graph from the given video index, no new input', () => {
      const { manager, segment } = build({
        section: { name: 's', type: 'video', options: { backgroundColor: '#222222' } },
      });

      manager.addChromakeyComposite({ color: '#00FF00', similarity: 0.2, blend: 0.05 }, 1, '1280:720');

      expect(segment.mapsList).toEqual(['ck_out']);
      const graph = segment.filtersMapList[0];
      // keys the clip at [1:v] (NOT [0:v] — the blank-audio input), paints the section bg, overlays back
      expect(graph).toContain(
        '[1:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,split[ck_a][ck_b]'
      );
      expect(graph).toContain('drawbox=x=0:y=0:w=iw:h=ih:color=#222222@1:t=fill[ck_bg]');
      expect(graph).toContain('colorkey=#00FF00:0.2:0.05,format=rgba[ck_keyed]');
      expect(graph).toContain('[ck_bg][ck_keyed]overlay=0:0[ck_out]');
    });

    it('falls back to default similarity/blend and a black background', () => {
      const { manager, segment } = build({ section: { name: 's', type: 'video' } });

      manager.addChromakeyComposite({ color: '#0000FF' }, 0);

      const graph = segment.filtersMapList[0];
      expect(graph).toContain('[0:v]split[ck_a][ck_b]'); // no scale chain when videoScale omitted
      expect(graph).toContain('color=black@1:t=fill');
      expect(graph).toContain('colorkey=#0000FF:0.3:0.1,format=rgba');
    });
  });

  describe('getVideoInputIncrement', () => {
    it('returns 0 for project_video', () => {
      const { manager } = build({ section: { name: 's', type: 'project_video' } });
      expect(manager.getVideoInputIncrement()).toBe(0);
    });

    // A muted project_video prepends a blank-audio input, so the recorded clip is input 1.
    it('returns 1 for a muted project_video', () => {
      const { manager } = build({ section: { name: 's', type: 'project_video', options: { muteSection: true } } });
      expect(manager.getVideoInputIncrement()).toBe(1);
    });

    it('returns 0 for a fresh video section (no reuse)', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      expect(manager.getVideoInputIncrement()).toBe(0);
    });

    it('returns 0 for reused video section that is explicitly not muted', () => {
      const { manager } = build({
        section: { name: 's', type: 'video', options: { useVideoSection: 'main', muteSection: false } },
      });
      expect(manager.getVideoInputIncrement()).toBe(0);
    });

    it('returns 1 for a reused, muted video section', () => {
      const { manager } = build({
        section: { name: 's', type: 'video', options: { useVideoSection: 'main', muteSection: true } },
      });
      expect(manager.getVideoInputIncrement()).toBe(1);
    });

    it('returns 1 for other section types (default)', () => {
      const { manager } = build({ section: { name: 's', type: 'color_background' } });
      expect(manager.getVideoInputIncrement()).toBe(1);
    });
  });

  describe('mapInputsVariables', () => {
    it('returns the value unchanged when there are no section inputs', () => {
      const { manager } = build({ section: { name: 's', type: 'video' } });
      expect(manager.mapInputsVariables('@video')).toBe('@video');
    });

    it('replaces @video with the video input increment', () => {
      const section = {
        name: 's',
        type: 'video',
        inputs: { 0: { name: 'logo', type: 'image', options: {} } },
      } as unknown as Section;
      const { manager } = build({ section });
      // @video resolves to 0:v (video increment for fresh video section)
      expect(manager.mapInputsVariables('@video')).toBe('0:v');
    });

    it('replaces an animation input reference with its overlay pad label', () => {
      const section = {
        name: 's',
        type: 'video',
        inputs: { 0: { name: 'spark', type: 'animation', options: {} } },
      } as unknown as Section;
      const { manager } = build({ section });
      // single-input animation: @spark resolves to the overlay output pad named after the input
      expect(manager.mapInputsVariables('@spark')).toBe('spark');
    });

    it('replaces a non-animation input reference with its stream index', () => {
      const section = {
        name: 's',
        type: 'color_background', // increment = 1
        inputs: { 0: { name: 'logo', type: 'image', options: {} } },
      } as unknown as Section;
      const { manager } = build({ section });
      // increment(1) + 1 + position(0) = 2 -> 2:v
      expect(manager.mapInputsVariables('@logo')).toBe('2:v');
    });

    it('indexes a non-animation input after a preceding animation input by position', () => {
      const section = {
        name: 's',
        type: 'color_background', // increment = 1
        inputs: {
          0: { name: 'spark', type: 'animation', options: {} },
          1: { name: 'logo', type: 'image', options: {} },
        },
      } as unknown as Section;
      const { manager } = build({ section });
      // each input is one `-i`; logo at position 1 -> increment(1) + 1 + 1 = 3 -> 3:v
      expect(manager.mapInputsVariables('@logo')).toBe('3:v');
      // the animation still resolves to its overlay pad
      expect(manager.mapInputsVariables('@spark')).toBe('spark');
    });

    // Regression guard: the substitution regex was unescaped and unanchored, so the earlier
    // input 'logo' matched the front of '@logo2' ('@logo2' → '1:v' + leftover '2' = '2:v2'-style
    // corruption), and a name containing regex metachars ('fx(' ) threw SyntaxError at compile.
    it('does not let an input name rewrite a longer name it prefixes', () => {
      const section = {
        name: 's',
        type: 'color_background', // increment = 1
        inputs: {
          0: { name: 'logo', type: 'image', options: {} },
          1: { name: 'logo2', type: 'image', options: {} },
        },
      } as unknown as Section;
      const { manager } = build({ section });
      // logo at position 0 -> 2:v; logo2 at position 1 -> 3:v — never '2:v2'
      expect(manager.mapInputsVariables('@logo')).toBe('2:v');
      expect(manager.mapInputsVariables('@logo2')).toBe('3:v');
      expect(manager.mapInputsVariables('[@logo][@logo2]overlay')).toBe('[2:v][3:v]overlay');
    });

    it('resolves an input named after its section to the input, not the section background', () => {
      // The background picture is injected as the first input under the section's own name; an
      // authored input with that same name must still resolve to its own stream.
      const section = {
        name: 'badge',
        type: 'image_background', // increment = 1: the picture is stream 1
        inputs: [
          markBackgroundInput({ name: 'badge', url: 'pictures/bg.png' }),
          { name: 'badge', type: 'image', options: {} },
        ],
      } as unknown as Section;
      const { manager } = build({ section });
      expect(manager.mapInputsVariables('@badge')).toBe('2:v');
    });

    it('numbers inputs after an injected background from the stream that follows it', () => {
      const section = {
        name: 'hero',
        type: 'image_background', // increment = 1: the picture is stream 1, the logo stream 2
        inputs: [markBackgroundInput({ name: 'hero', url: 'pictures/bg.png' }), { name: 'logo', options: {} }],
      } as unknown as Section;
      const { manager } = build({ section });
      expect(manager.mapInputsVariables('@logo')).toBe('2:v');
    });

    it('treats regex metacharacters in an input name as literal text', () => {
      const section = {
        name: 's',
        type: 'color_background', // increment = 1
        inputs: { 0: { name: 'fx(1)', type: 'image', options: {} } },
      } as unknown as Section;
      const { manager } = build({ section });
      expect(manager.mapInputsVariables('@fx(1)')).toBe('2:v');
    });
  });

  describe('addAnimationOverlay', () => {
    function animationSection(): Section {
      return { name: 's', type: 'video', filters: [], options: { duration: 10 } } as Section;
    }
    function makeAnimInput(overrides: Partial<MapAnimationInput['options']> = {}): MapAnimationInput {
      return {
        url: '',
        name: 'anim',
        type: 'animation',
        extension: 'png',
        options: { fps: 25, position: '0:0', scale: '100:100', persistent: false, loop: false, ...overrides },
        filters: [],
      };
    }

    it('overlays without throwing when the input omits filters (optional in the schema)', () => {
      const { manager, segment } = build({ section: animationSection() });
      const noFilters = { ...makeAnimInput(), filters: undefined } as unknown as MapAnimationInput;

      expect(() => manager.addAnimationOverlay(noFilters, 2)).not.toThrow();
      expect(segment.mapsList).toContain('anim');
    });

    it('scales the animation leg before the overlay and names the pad after the input', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput(), 2);
      expect(segment.inputsMapCount).toBe(1);
      // a pre-overlay scale chain for the animation leg, then the overlay map
      expect(segment.filtersMapList).toHaveLength(2);
      expect(segment.filtersMapList[0]).toBe('[2:v]scale=100:100,setsar=1[anim_src]');
      // the overlay map composites the main video leg with the scaled animation pad
      const overlay = segment.filtersMapList.at(-1) ?? '';
      expect(overlay).toContain('[0:v]');
      expect(overlay).toContain('[anim_src]');
      expect(segment.mapsList).toContain('anim');
    });

    it('normalizes the main video leg to the output scale before the overlay (cover, not stretch)', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput(), 2, '1280:720');
      // the raw video leg is COVER-scaled (fill + crop, aspect-preserving) on its own chain so a clip
      // whose ratio differs from the output isn't stretched, before the overlay composites onto it
      expect(segment.filtersMapList).toContain(
        '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[anim_norm]'
      );
      // the overlay composites the normalized base + the scaled animation, not the raw streams
      const overlay = segment.filtersMapList.at(-1) ?? '';
      expect(overlay).toContain('[anim_norm]');
      expect(overlay).toContain('[anim_src]');
    });

    it('letterboxes the main video leg when the section keeps the original aspect ratio', () => {
      const { manager, segment } = build({
        section: {
          name: 's',
          type: 'project_video',
          filters: [],
          options: { duration: 10, forceOriginalAspectRatio: true },
        } as unknown as Section,
      });
      manager.addAnimationOverlay(makeAnimInput(), 2, '1080:1080');
      // an overlay must not turn a letterboxed screen recording into a cropped cover frame
      expect(segment.filtersMapList).toContain(
        '[0:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[anim_norm]'
      );
    });

    it('bakes the section filters into the background so the animation overlays ON TOP (not blurred)', () => {
      const { manager, segment } = build({
        section: {
          name: 's',
          type: 'video',
          filters: [{ type: 'boxblur', value: '5' }],
          options: { duration: 10 },
        } as Section,
      });
      manager.addAnimationOverlay(makeAnimInput(), 2, '1280:720');
      // a background map applies the section's blur to the normalized video, and the overlay map
      // composites the animation onto that background pad — so the animation is never blurred.
      const background = segment.filtersMapList.find((c) => c.includes('[anim_bg]'));
      expect(background).toContain('[anim_norm]');
      expect(background).toContain('F(boxblur)');
      const overlay = segment.filtersMapList.at(-1) ?? '';
      expect(overlay).toContain('[anim_bg]');
      expect(overlay).toContain('[anim_src]');
      expect(overlay).toContain('F(overlay)');
    });

    it('uses eof_action=repeat when persistent and eof_action=pass otherwise', () => {
      const persistent = build({ section: animationSection() });
      persistent.manager.addAnimationOverlay(makeAnimInput({ persistent: true }), 2);
      expect(persistent.filterManager.addFilter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'overlay', value: '0:0:eof_action=repeat' })
      );

      const transient = build({ section: animationSection() });
      transient.manager.addAnimationOverlay(makeAnimInput({ persistent: false }), 2);
      expect(transient.filterManager.addFilter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'overlay', value: '0:0:eof_action=pass' })
      );
    });

    it('chains a later animation off the previous overlay output', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({}), 2);
      manager.addAnimationOverlay({ ...makeAnimInput({}), name: 'anim2' }, 3);
      // the second overlay map bases off the first overlay's output pad, not the main video
      const overlay2 = segment.filtersMapList.at(-1) ?? '';
      expect(overlay2).toContain('[anim]');
      expect(overlay2).toContain('[anim2_src]');
      expect(segment.mapsList).toContain('anim2');
    });

    it('scales the animation leg to the input scale (pre-overlay), not via a post-overlay filter', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ scale: '640:360' }), 2);
      expect(segment.filtersMapList).toContain('[2:v]scale=640:360,setsar=1[anim_src]');
    });

    const overlayFilterValue = (filterManager: { addFilter: ReturnType<typeof vi.fn> }): string => {
      const calls = filterManager.addFilter.mock.calls.map((c) => c[0] as Filter);
      const call = calls.find((f) => f.type === 'overlay');

      return call ? (call.value as string) : '';
    };

    it('motion=slide-left emits a named-form overlay with an x time-expression', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ position: '40:200', motion: 'slide-left' }), 2);
      expect(overlayFilterValue(filterManager)).toBe(
        "x='(40)+(1-(if(lt(t,0.3),0,if(lt(t,0.9),(t-0.3)/0.6,1))))*60':y='200':eof_action=pass"
      );
    });

    it('motion=fade adds an alpha fade-in to the overlay leg, keeping the static position', () => {
      const { manager, segment, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ position: '40:200', motion: 'fade' }), 2);
      const legChain = segment.filtersMapList.find((c) => c.includes('[anim_src]')) ?? '';
      expect(legChain).toContain('format=rgba');
      expect(legChain).toContain('fade=t=in:st=0.3:d=0.6:alpha=1');
      expect(overlayFilterValue(filterManager)).toBe('40:200:eof_action=pass');
    });

    it('uses the raw animation stream when no scale is set (no pre-scale chain)', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ scale: undefined }), 2);
      expect(segment.filtersMapList.some((chain) => chain.includes('[anim_src]'))).toBe(false);
      const overlay = segment.filtersMapList.at(-1) ?? '';
      expect(overlay).toContain('[2:v]');
    });

    it('fades the animation leg via colorchannelmixer when opacity < 1 (no scale)', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ scale: undefined, opacity: 0.5 }), 2);
      // an opacity chain on the animation leg feeds the overlay
      expect(segment.filtersMapList[0]).toBe('[2:v]format=rgba,colorchannelmixer=aa=0.5[anim_src]');
      const overlay = segment.filtersMapList.at(-1) ?? '';
      expect(overlay).toContain('[anim_src]');
    });

    it('appends the opacity fade after the scale on a single animation-leg chain', () => {
      const { manager, segment } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ scale: '640:360', opacity: 0.4 }), 2);
      expect(segment.filtersMapList[0]).toBe(
        '[2:v]scale=640:360,setsar=1,format=rgba,colorchannelmixer=aa=0.4[anim_src]'
      );
    });

    it('does not fade the animation leg when opacity is 1 or unset', () => {
      const opaque = build({ section: animationSection() });
      opaque.manager.addAnimationOverlay(makeAnimInput({ scale: undefined, opacity: 1 }), 2);
      expect(opaque.segment.filtersMapList.some((chain) => chain.includes('colorchannelmixer'))).toBe(false);

      const unset = build({ section: animationSection() });
      unset.manager.addAnimationOverlay(makeAnimInput({ scale: undefined }), 2);
      expect(unset.segment.filtersMapList.some((chain) => chain.includes('colorchannelmixer'))).toBe(false);
    });

    // Still-image inputs are held with `-loop 1` (no -itsoffset/-t source flags like animations), so
    // their start/duration lower to the overlay filter's timeline `enable` option instead.
    function makeImageInput(overrides: Partial<MapAnimationInput['options']> = {}): MapAnimationInput {
      return { ...makeAnimInput(overrides), name: 'logo', type: 'image' };
    }

    it('gates an image overlay with a between() timeline when start and duration are set', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeImageInput({ start: 2, duration: 3 }), 2);
      expect(overlayFilterValue(filterManager)).toBe("0:0:eof_action=pass:enable='between(t,2,5)'");
    });

    it('gates an image overlay from its start to the section end when only start is set', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeImageInput({ start: 1.5 }), 2);
      expect(overlayFilterValue(filterManager)).toBe("0:0:eof_action=pass:enable='gte(t,1.5)'");
    });

    it('gates an image overlay from the section start when only duration is set', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeImageInput({ duration: 4 }), 2);
      expect(overlayFilterValue(filterManager)).toBe("0:0:eof_action=pass:enable='between(t,0,4)'");
    });

    it('trims float noise in the between() end bound (start + duration)', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeImageInput({ start: 0.1, duration: 0.2 }), 2);
      expect(overlayFilterValue(filterManager)).toBe("0:0:eof_action=pass:enable='between(t,0.1,0.3)'");
    });

    it('appends the timeline gate after the named-form motion expressions', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeImageInput({ position: '40:200', motion: 'fade', start: 2 }), 2);
      expect(overlayFilterValue(filterManager)).toBe("40:200:eof_action=pass:enable='gte(t,2)'");
    });

    it('does not gate an untimed image overlay (spans the whole section)', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeImageInput(), 2);
      expect(overlayFilterValue(filterManager)).toBe('0:0:eof_action=pass');
    });

    it('does not gate animation inputs — their start/duration lower to -itsoffset/-t source flags', () => {
      const { manager, filterManager } = build({ section: animationSection() });
      manager.addAnimationOverlay(makeAnimInput({ start: 2, duration: 3 }), 2);
      expect(overlayFilterValue(filterManager)).toBe('0:0:eof_action=pass');
    });
  });

  describe('addGradientOverlay', () => {
    function bgSection(): Section {
      return { name: 's', type: 'color_background', filters: [], options: { duration: 3 } } as Section;
    }

    it('emits a single overlay map compositing the gradient over the main stream', () => {
      const { manager, segment } = build({ section: bgSection() });
      manager.addGradientOverlay({ gradient: { from: '#000', to: '#fff' } }, 2, 'gradient_layer_0');
      expect(segment.inputsMapCount).toBe(1);
      // color_background increment is 1 -> main stream [1:v], gradient input [2:v]
      expect(segment.filtersMapList[0]).toContain('[1:v]');
      expect(segment.filtersMapList[0]).toContain('[2:v]');
      expect(segment.mapsList).toContain('gradient_layer_0');
    });

    it('overlays at the layer x/y position', () => {
      const { manager, filterManager } = build({ section: bgSection() });
      manager.addGradientOverlay({ gradient: { from: '#000', to: '#fff' }, x: 10, y: 20 }, 2, 'gradient_layer_0');
      expect(filterManager.addFilter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'overlay', value: '10:20' })
      );
    });

    it('overlays at the resolved pixel position when the caller passes one', () => {
      // SegmentBuilder resolves `iw*0.25`-style layer expressions to pixels (overlay has no iw/ih
      // variables) and passes the concrete position; the raw layer x/y must be ignored then.
      const { manager, filterManager } = build({ section: bgSection() });
      manager.addGradientOverlay(
        { gradient: { from: '#000', to: '#fff' }, x: 'iw*0.25', y: 'ih*0.25' },
        2,
        'gradient_layer_0',
        '320:180'
      );
      expect(filterManager.addFilter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'overlay', value: '320:180' })
      );
    });

    it('fades the gradient leg via colorchannelmixer when opacity < 1', () => {
      const { manager, segment } = build({ section: bgSection() });
      manager.addGradientOverlay({ gradient: { from: '#000', to: '#fff' }, opacity: 0.5 }, 2, 'gradient_layer_0');
      // opacity chain prepended to the graph, overlay references the faded pad
      expect(segment.filtersMapList[0]).toContain('colorchannelmixer=aa=0.5');
      expect(segment.filtersMapList.some((g) => g.includes('[gradient_layer_0_op]'))).toBe(true);
    });

    it('does not add an opacity chain when opacity is 1 (default)', () => {
      const { manager, segment } = build({ section: bgSection() });
      manager.addGradientOverlay({ gradient: { from: '#000', to: '#fff' } }, 2, 'gradient_layer_0');
      expect(segment.filtersMapList.some((g) => g.includes('colorchannelmixer'))).toBe(false);
    });

    it('a fade reveal adds an alpha fade-in on the gradient leg (format=rgba first)', () => {
      const { manager, segment, filterManager } = build({ section: bgSection() });
      manager.addGradientOverlay(
        { gradient: { from: '#000', to: '#fff' }, reveal: 'fade' },
        2,
        'gradient_layer_0',
        '0:0'
      );
      const leg = segment.filtersMapList.find((g) => g.startsWith('[2:v]'));
      expect(leg).toBe('[2:v]format=rgba,fade=t=in:st=0.3:d=0.6:alpha=1[gradient_layer_0_op]');
      // the overlay keeps the static position (fade does not move the layer).
      expect(filterManager.addFilter).toHaveBeenCalledWith(expect.objectContaining({ type: 'overlay', value: '0:0' }));
    });

    it('a rise reveal emits overlay x/y time expressions easing to the base position', () => {
      const { manager, filterManager } = build({ section: bgSection() });
      manager.addGradientOverlay(
        { gradient: { from: '#000', to: '#fff' }, reveal: { type: 'rise', delay: 0.5, duration: 1 } },
        2,
        'gradient_layer_0',
        '320:180'
      );
      const overlay = (filterManager.addFilter.mock.calls as Array<[Filter]>).find(([f]) => f.type === 'overlay')?.[0];
      expect(overlay?.value).toBe("x='320':y='(180)+(1-(if(lt(t,0.5),0,if(lt(t,1.5),(t-0.5)/1,1))))*60'");
    });

    it('combines a reveal fade with an opacity chain on one leg', () => {
      const { manager, segment } = build({ section: bgSection() });
      manager.addGradientOverlay(
        { gradient: { from: '#000', to: '#fff' }, opacity: 0.5, reveal: 'fade' },
        2,
        'gradient_layer_0'
      );
      const leg = segment.filtersMapList.find((g) => g.startsWith('[2:v]'));
      expect(leg).toBe('[2:v]format=rgba,colorchannelmixer=aa=0.5,fade=t=in:st=0.3:d=0.6:alpha=1[gradient_layer_0_op]');
    });

    it('a none reveal keeps the output byte-identical to no reveal', () => {
      const { manager, segment, filterManager } = build({ section: bgSection() });
      manager.addGradientOverlay({ gradient: { from: '#000', to: '#fff' }, reveal: 'none' }, 2, 'gradient_layer_0');
      expect(segment.filtersMapList.some((g) => g.includes('fade'))).toBe(false);
      expect(filterManager.addFilter).toHaveBeenCalledWith(expect.objectContaining({ type: 'overlay', value: '0:0' }));
    });
  });
});
