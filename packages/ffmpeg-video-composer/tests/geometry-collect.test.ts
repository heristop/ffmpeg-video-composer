import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectGeometryWarnings } from '@/services/geometry';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(currentDir, '../../leclap-creative-kit/src/library/fonts');

// The test is the caller, so the test owns the filesystem access — the module under test must not
// touch disk. Mirrors what the CLI will do in Task 8b.
const loadFont = async (fontFile: string): Promise<Uint8Array | null> => {
  try {
    return readFileSync(join(fontsDir, fontFile));
  } catch {
    return null;
  }
};

function templateWith(caption: Record<string, unknown>, orientation = 'landscape'): TemplateDescriptor {
  return {
    global: { orientation },
    sections: [{ type: 'color_background', name: 'a', options: { duration: 4 }, caption }],
  } as unknown as TemplateDescriptor;
}

describe('collectGeometryWarnings', () => {
  it('returns an empty array for a clean template', async () => {
    const warnings = await collectGeometryWarnings(templateWith({ text: { en: 'Short' }, fontsize: 40 }));

    expect(warnings).toEqual([]);
  });

  it('reports a caption that crosses the title-safe margin', async () => {
    // Wide enough to cross the margin, narrow enough to stay on screen — the finding an author can
    // fix by trimming a word rather than by rethinking the section.
    const template = templateWith({
      text: { en: 'A caption a fair bit wider than the title-safe band' },
      fontsize: 48,
    });

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_overflow')).toBe(true);
  });

  it('reports a caption that runs clean off the frame as out of frame, not merely unsafe', async () => {
    const template = templateWith({
      text: { en: 'This caption is far too long to fit inside the frame at this size' },
      fontsize: 90,
    });

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.code === 'text_out_of_frame')).toBe(true);
  });

  it('never returns an error severity', async () => {
    const warnings = await collectGeometryWarnings(templateWith({ text: { en: 'x'.repeat(400) }, fontsize: 80 }));

    for (const warning of warnings) {
      expect(warning.severity).toBe('warn');
    }
  });

  it('caps the report at 20 findings', async () => {
    const sections = Array.from({ length: 60 }, (_, i) => ({
      type: 'color_background',
      name: `s${i}`,
      options: { duration: 1 },
      caption: { text: { en: 'y'.repeat(300) }, fontsize: 80 },
    }));

    const warnings = await collectGeometryWarnings({ sections } as unknown as TemplateDescriptor);

    expect(warnings.length).toBeLessThanOrEqual(20);
  });

  it('does not throw when a template has no sections', async () => {
    await expect(collectGeometryWarnings({} as TemplateDescriptor)).resolves.toEqual([]);
  });

  it('does not throw on a malformed sections value, with or without a loader', async () => {
    // The font pass runs before the box pass and used to `.filter()` straight onto whatever
    // `sections` held, so `"nope"` threw a TypeError out of an advisory checker — but only when a
    // loader was supplied, which made the same input look clean in the no-loader path.
    for (const sections of ['nope', [null], 7]) {
      const template = { sections } as unknown as TemplateDescriptor;

      await expect(collectGeometryWarnings(template)).resolves.toEqual([]);
      await expect(collectGeometryWarnings(template, loadFont)).resolves.toEqual([]);
    }
  });

  it('marks every warning approximate when no loader is supplied', async () => {
    const warnings = await collectGeometryWarnings(templateWith({ text: { en: 'z'.repeat(200) }, fontsize: 80 }));

    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(warning.approx).toBe(true);
    }
  });

  it('produces exact measurements when a loader is supplied', async () => {
    const warnings = await collectGeometryWarnings(
      templateWith({ text: { en: 'z'.repeat(200) }, fontsize: 80, font: 'rubik' }),
      loadFont
    );

    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(warning.approx).toBe(false);
    }
  });

  it('falls back to approximation when the loader cannot find the font', async () => {
    const warnings = await collectGeometryWarnings(
      templateWith({ text: { en: 'z'.repeat(200) }, fontsize: 80 }),
      async () => null
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.approx)).toBe(true);
  });

  it('loads each distinct font once even when many sections share it', async () => {
    const calls: string[] = [];
    const counting = async (file: string): Promise<Uint8Array | null> => {
      calls.push(file);

      return loadFont(file);
    };

    const sections = Array.from({ length: 5 }, (_, i) => ({
      type: 'color_background',
      name: `s${i}`,
      options: { duration: 1 },
      caption: { text: { en: 'hello' }, fontsize: 40, font: 'rubik' },
    }));

    await collectGeometryWarnings({ sections } as unknown as TemplateDescriptor, counting);

    // Five sections, one typeface: the loader must be asked once, not once per section.
    expect(calls).toHaveLength(1);
  });

  // The defect this pins: sections lay out strictly sequentially with at most one box each, so two
  // captions can never share a time window and collisionWarnings was dead code on any real
  // descriptor. A lowerThird shares its section's window with the caption, so this is the one case
  // that can actually collide — built from a descriptor, not from hand-constructed Box[] like
  // geometry-rules.test.ts does.
  it('fires a collision warning when a caption and a lowerThird overlap in the same section', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          options: { duration: 4 },
          caption: { text: { en: 'hello there' }, fontsize: 40, align: 'left', position: 'bottom' },
          lowerThird: { title: { en: 'World' }, subtitle: { en: 'subtitle line' } },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_collision')).toBe(true);
  });

  it('reports low contrast when a caption colour and its opaque box colour are both dark', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          options: { duration: 4, backgroundColor: '#ffffff' },
          caption: {
            text: { en: 'Short' },
            fontsize: 40,
            color: '#333333',
            box: true,
            boxColor: '#1a1a1a',
            boxOpacity: 1,
          },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_low_contrast')).toBe(true);
  });

  it('reports no low contrast for the default bar caption on a light section background', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          options: { duration: 4, backgroundColor: '#ffffff' },
          caption: { text: { en: 'Short' }, fontsize: 40 },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_low_contrast')).toBe(false);
  });

  it('flags a caption drawn over footage with no box, shadow or outline', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'project_video',
          name: 'clip',
          options: { duration: 4 },
          caption: { text: { en: 'Short' }, fontsize: 40, box: false },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_unreadable_over_footage')).toBe(true);
  });

  it('does not flag the same caption once it carries a shadow', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'project_video',
          name: 'clip',
          options: { duration: 4 },
          caption: { text: { en: 'Short' }, fontsize: 40, box: false, effect: { shadow: true } },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_unreadable_over_footage')).toBe(false);
  });

  it('does not flag a boxed caption over footage even without a known backdrop', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'project_video',
          name: 'clip',
          options: { duration: 4 },
          caption: { text: { en: 'Short' }, fontsize: 40, box: true, boxOpacity: 0.3 },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template);

    expect(warnings.some((w) => w.code === 'text_unreadable_over_footage')).toBe(false);
  });

  // `caption` sits on the BASE section schema, so a `form` section may carry one and still validate
  // — but TemplateDirector emits no drawtext for it, which is why collectBoxes skips it. The font
  // pass did not, so a caption that produces nothing still read and parsed a ~350KB TTF.
  it('does not load fonts for sections that render no text', async () => {
    const requested: string[] = [];
    const spy = async (fontFile: string): Promise<Uint8Array | null> => {
      requested.push(fontFile);

      return loadFont(fontFile);
    };
    const template = {
      global: { orientation: 'landscape' },
      sections: [{ type: 'form', name: 'f', options: { duration: 4 }, caption: { text: { en: 'never drawn' } } }],
    } as unknown as TemplateDescriptor;

    await collectGeometryWarnings(template, spy);

    expect(requested).toEqual([]);
  });

  it('still loads fonts for sections that do render text', async () => {
    const requested: string[] = [];
    const spy = async (fontFile: string): Promise<Uint8Array | null> => {
      requested.push(fontFile);

      return loadFont(fontFile);
    };

    await collectGeometryWarnings(templateWith({ text: { en: 'drawn' }, fontsize: 40 }), spy);

    expect(requested).toEqual(['Oswald.ttf']);
  });

  // `path` is the machine-readable field an MCP agent edits against, so it has to address the
  // descriptor the author actually holds. Expansion splices a partial's sections inline and shifts
  // every later index, so a caption authored at sections[1] was reported at sections[3] — an agent
  // acting on that edits the wrong section, or one that does not exist.
  it('reports paths against the authored descriptor, not the expanded one', async () => {
    const template = {
      global: { orientation: 'landscape' },
      partials: [
        {
          id: 'intro',
          sections: [
            { type: 'color_background', name: 'p1', options: { duration: 1 } },
            { type: 'color_background', name: 'p2', options: { duration: 1 } },
            { type: 'color_background', name: 'p3', options: { duration: 1 } },
          ],
        },
      ],
      sections: [
        { type: 'partial', ref: 'intro' },
        {
          type: 'color_background',
          name: 'main',
          options: { duration: 3 },
          caption: { text: { en: 'A caption far too wide to fit inside this frame at all' }, fontsize: 96 },
        },
      ],
    } as unknown as TemplateDescriptor;

    const warnings = await collectGeometryWarnings(template, loadFont);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].path).toBe('sections[1].caption');
  });

  it('does not reject when the loader throws', async () => {
    const throwing = async (): Promise<Uint8Array | null> => {
      throw new Error('disk on fire');
    };

    // A broken loader degrades to approximation. Validation is advisory; it must not become the
    // thing that fails.
    await expect(
      collectGeometryWarnings(templateWith({ text: { en: 'hello' }, fontsize: 40 }), throwing)
    ).resolves.toBeInstanceOf(Array);
  });
});

describe('collectGeometryWarnings on sections without a duration', () => {
  // The engine derives the length at render time; the model can only assume one. A caption and a
  // lowerThird sharing that window "collide" only on the assumption, so the finding must say so —
  // even though both widths were measured from real font metrics.
  function captionOverLowerThird(options: Record<string, unknown>): TemplateDescriptor {
    return {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          options,
          caption: { text: { en: 'hello there' }, fontsize: 40, align: 'left', position: 'bottom' },
          lowerThird: { title: { en: 'World' }, subtitle: { en: 'subtitle line' } },
        },
      ],
    } as unknown as TemplateDescriptor;
  }

  async function collisions(template: TemplateDescriptor) {
    return (await collectGeometryWarnings(template, loadFont)).filter((w) => w.code === 'text_collision');
  }

  it('marks a collision drawn from an assumed window as approximate', async () => {
    const found = await collisions(captionOverLowerThird({}));

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((w) => w.approx)).toBe(true);
  });

  it('keeps the same collision exact once the duration is declared', async () => {
    const found = await collisions(captionOverLowerThird({ duration: 4 }));

    expect(found.length).toBeGreaterThan(0);
    expect(found.some((w) => w.approx)).toBe(false);
  });

  it('leaves width findings unqualified, since they never read the timeline', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          caption: { text: { en: 'This caption is far too long to fit inside the frame at this size' }, fontsize: 90 },
        },
      ],
    } as unknown as TemplateDescriptor;

    const found = (await collectGeometryWarnings(template, loadFont)).filter((w) => w.code === 'text_out_of_frame');

    expect(found.length).toBeGreaterThan(0);
    expect(found.some((w) => w.approx)).toBe(false);
  });
});

it.each(['direct', 'inline', 'registry', 'variable'])(
  'checks effect overlays after %s expansion with authored paths',
  async (kind) => {
    const effect = {
      type: 'effect',
      name: 'promo',
      options: { duration: 10 },
      effect: { id: 'leclap.web-app-promo', version: '1.0.0', props: {}, assets: {} },
      filters: [{ type: 'drawtext', values: { text: { en: 'OFF SCREEN' }, fontsize: 120, x: 1400, y: 800 } }],
    };
    let raw: unknown = { global: { orientation: 'landscape' }, sections: [effect] };
    let origin = 'sections[0]';
    if (kind === 'inline') {
      raw = { global: { orientation: 'landscape' }, sections: [{ type: 'partial', sections: [effect] }] };
      origin = 'sections[0].sections[0]';
    }
    if (kind === 'registry' || kind === 'variable') {
      raw = {
        global: { orientation: 'landscape' },
        sections: [{ type: 'partial', ref: 'promo', variables: { kind: 'effect' } }],
        partials: [{ id: 'promo', sections: [{ ...effect, type: kind === 'variable' ? '{{kind}}' : 'effect' }] }],
      };
      origin = 'partials[0].sections[0]';
    }
    const before = structuredClone(raw);
    const warnings = await collectGeometryWarnings(raw as TemplateDescriptor);
    expect(warnings.some((warning) => warning.code === 'text_out_of_frame' && warning.path.startsWith(origin))).toBe(
      true
    );
    expect(warnings.some((warning) => warning.code === 'text_unreadable_over_footage')).toBe(true);
    expect(raw).toEqual(before);
  }
);
