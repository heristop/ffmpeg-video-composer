import { describe, expect, it } from 'vitest';
import type { Filter } from '@/core/types';
import { KineticBlockSchema, type KineticBlock } from '@/schemas/kinetic.schemas';
import { SectionLayoutSchema, type SectionLayout } from '@/schemas/layout.schemas';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { fillGraph, gradientEndpoints, sweepX, type FillEnv } from '@/editor/presets/kinetic-fill';
import { layoutToFilters, splitRects, wipeEdge, type LayoutEnv } from '@/editor/presets/layout';
import { renderFilterGraph, graphReadsInputs } from '@/editor/utils/filter-graph';
import { classifyLayoutSource } from '@/core/layout/sources';
import { engineCapabilities, hasFilter } from '@/editor/utils/filter-compat';
import { compositingContext, createExtraInputs } from '@/editor/presets/registry';
import { TemplateValidator } from '@/services/TemplateValidator';

const FRAME = { width: 1280, height: 720, fps: 30, duration: 3, seed: 7, energy: 1 };

// Renders a filter the way FilterManager would for these engine-built shapes (type=value / k=v pairs).
function render(filter: Filter): string {
  if (filter.graph) {
    return renderFilterGraph(filter.graph, render, (key) => ({ layout_0: 2, layout_1: 3, layout_2: 4 })[key]);
  }

  if (filter.values) {
    return `${filter.type}=${Object.entries(filter.values)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(':')}`;
  }

  return filter.value === undefined ? filter.type : `${filter.type}=${filter.value}`;
}

function fillEnv(overrides: Partial<FillEnv> = {}): FillEnv {
  return { width: 1280, height: 720, fps: 30, duration: 3, prefix: 'kin0_', color: (c) => c, ...overrides };
}

function block(overrides: Partial<KineticBlock>): KineticBlock {
  return KineticBlockSchema.parse({ text: { en: 'Make it shine' }, preset: 'cascade', ...overrides });
}

describe('kinetic fill (mask lowering)', () => {
  const filled = block({ fill: { gradient: { from: '#FF0000', to: '#0000FF' }, sweep: { delay: 1 } } });

  it('lowers to one sub-graph: base, white mask, gradient + shimmer, alphamerge, overlay', () => {
    const filters = kineticToFilters(filled, { ...FRAME, text: 'Make it shine', fill: fillEnv() });

    expect(filters).toHaveLength(1);

    const text = render(filters[0]);
    const chains = text.split(';');

    expect(chains[0]).toMatch(/^null\[kin0_b\]$/);
    expect(chains[1]).toMatch(/^color=c=black:s=1280x720:r=30:d=3,format=gray,drawtext=/);
    expect(chains[1]).toContain("lutyuv=y='clip((val-16)*255/219,0,255)'[kin0_m]");
    expect(chains[2]).toMatch(/^gradients=s=1280x720:c0=#FF0000:c1=#0000FF:nb_colors=2:x0=\d+:y0=\d+:x1=\d+:y1=\d+/);
    expect(text).toContain('[kin0_f][kin0_m]alphamerge[kin0_t]');
    expect(text.endsWith('[kin0_b][kin0_t]overlay=0:0')).toBe(true);
    expect(graphReadsInputs(filters[0].graph ?? [])).toBe(false);
  });

  it('keeps per-unit timing: every mask unit carries the visible unit expressions, in white', () => {
    const visible = kineticToFilters(filled, { ...FRAME, text: 'Make it shine' });
    const masked = kineticToFilters(filled, { ...FRAME, text: 'Make it shine', fill: fillEnv() })[0];
    const maskUnits = (masked.graph?.[1].filters ?? []).filter((f) => f.type === 'drawtext');

    expect(maskUnits).toHaveLength(visible.length);

    for (const [i, unit] of maskUnits.entries()) {
      const { fontcolor, ...rest } = unit.values as Record<string, unknown>;
      const { fontcolor: _color, ...expected } = visible[i].values as Record<string, unknown>;

      expect(fontcolor).toBe('white');
      expect(rest).toEqual(expected);
    }
  });

  it('is deterministic', () => {
    const a = render(kineticToFilters(filled, { ...FRAME, text: 'Make it shine', fill: fillEnv() })[0]);
    const b = render(kineticToFilters(filled, { ...FRAME, text: 'Make it shine', fill: fillEnv() })[0]);

    expect(a).toBe(b);
  });

  it('draws effects as an invisible face under the fill, texture through an extra input', () => {
    const textured = block({ fill: { texture: 'gold.jpg' }, effect: { shadow: true } });
    const graph = kineticToFilters(textured, {
      ...FRAME,
      text: 'Gold',
      fill: fillEnv({ texture: () => 'input:kinetic0_texture' }),
    })[0].graph;
    const base = graph?.[0].filters ?? [];

    expect(base.every((f) => f.type === 'drawtext' && String(f.values?.fontcolor).endsWith('@0'))).toBe(true);
    expect(base[0].values).toHaveProperty('shadowcolor');
    expect(graph?.[2].inputs).toEqual(['input:kinetic0_texture']);
    expect(graphReadsInputs(graph ?? [])).toBe(true);
  });

  it('stays solid without a fill environment (the build has no alphamerge)', () => {
    const filters = kineticToFilters(filled, { ...FRAME, text: 'Make it shine' });

    expect(filters.every((f) => !f.graph)).toBe(true);
  });

  it('sweeps a soft band with a smoothstep, repeating when `every` is set', () => {
    expect(sweepX({ duration: 1, delay: 2 }, 0, 40, 1280)).toBe(
      'if(lt(t,2),-40,-40+1320*clip((t-2)/1,0,1)*clip((t-2)/1,0,1)*(3-2*clip((t-2)/1,0,1)))'
    );
    expect(sweepX({ every: 3 }, 0.5, 40, 1280)).toContain('mod(t-0.5,3)');
  });

  it('spans the gradient over the block box, inside the frame', () => {
    expect(gradientEndpoints(90, { x: 100, y: 200, w: 400, h: 100 }, fillEnv())).toBe('x0=100:y0=250:x1=500:y1=250');
    expect(gradientEndpoints(180, { x: -50, y: -10, w: 100, h: 2000 }, fillEnv())).toBe('x0=0:y0=0:x1=0:y1=719');
  });

  it('fillGraph without a gradient or texture fills with the block colour', () => {
    const parts = { base: [], mask: [], box: { x: 0, y: 0, w: 10, h: 10 }, landed: 1, solid: '#ABCDEF' };

    expect(render(fillGraph({ sweep: {} }, parts, fillEnv()))).toContain('color=c=#ABCDEF:s=1280x720');
  });
});

describe('capability gating', () => {
  it('advertises masks on full builds and on the device allowlist (alphamerge)', () => {
    expect(hasFilter(engineCapabilities({}), 'alphamerge')).toBe(true);
    expect(hasFilter(engineCapabilities({ codecConfig: { videoCodec: 'libopenh264' } } as never), 'alphamerge')).toBe(
      true
    );
    expect(hasFilter({ ...engineCapabilities({}), deviceFilters: new Set(['overlay']) }, 'alphamerge')).toBe(false);
  });

  it('a compositing context registers extra inputs once per key and sanitises colours', () => {
    const extras = createExtraInputs();
    const ctx = compositingContext({
      config: {},
      features: null,
      extras,
      formatColor: (c) => c,
      warn: () => undefined,
    });

    expect(ctx.input('a', { url: 'x.png', still: true })).toBe('input:a');
    expect(ctx.input('a', { url: 'y.png', still: true })).toBe('input:a');
    expect(extras.size).toBe(1);
    expect(ctx.color('#fff:x=1,evil')).toBe('#fffx1evil');
  });
});

describe('section layouts', () => {
  const sections = [
    { name: 'intro', type: 'color_background', options: { backgroundColor: '#112233' } },
    { name: 'photo', type: 'image_background', options: { pictureUrl: 'bg.jpg' } },
    { name: 'clip', type: 'project_video' },
    { name: 'form', type: 'form' },
  ];

  function env(): LayoutEnv {
    return {
      width: 1280,
      height: 720,
      fps: 30,
      duration: 4,
      self: 'intro',
      sections,
      input: (key) => `input:${key}`,
      color: (c) => c,
    };
  }

  it('resolves pane sources by the section conventions', () => {
    expect(classifyLayoutSource('intro', sections, 'other')).toEqual({ kind: 'color', color: '#112233' });
    expect(classifyLayoutSource('photo', sections, 'x')).toEqual({ kind: 'media', url: 'bg.jpg', still: true });
    expect(classifyLayoutSource('clip', sections, 'x')).toEqual({ kind: 'clip', section: 'clip' });
    expect(classifyLayoutSource('intro', sections, 'intro')).toEqual({ kind: 'self' });
    expect(classifyLayoutSource('#FF0000', sections, 'x')).toEqual({ kind: 'color', color: '#FF0000' });
    expect(classifyLayoutSource('https://a/b.mp4', sections, 'x')).toEqual({
      kind: 'media',
      url: 'https://a/b.mp4',
      still: false,
    });
    expect(classifyLayoutSource('form', sections, 'x')).toBeNull();
    expect(classifyLayoutSource('nothing', sections, 'x')).toBeNull();
  });

  it('splits panes with ratio and gap into even rectangles', () => {
    const layout = SectionLayoutSchema.parse({ type: 'split', sources: ['a.png', 'b.png'], ratio: 0.3, gap: 10 });

    expect(splitRects(layout as never, 1280, 720)).toEqual([
      { x: 0, y: 0, w: 382, h: 720 },
      { x: 392, y: 0, w: 888, h: 720 },
    ]);
  });

  it('lowers a split to cover-fitted panes overlaid on the section frame (static, no masks)', () => {
    const layout: SectionLayout = {
      type: 'split',
      sources: ['intro', 'photo', 'clip'],
      direction: 'vertical',
      divider: { color: '#FFFFFF' },
    };
    const text = render(layoutToFilters(layout, env())[0]);

    expect(text).toMatch(/^split=2\[lay_c\]\[lay_self0\];/);
    expect(text).toContain('[lay_self0]scale=1280:240:force_original_aspect_ratio=increase,crop=1280:240,setsar=1');
    expect(text).toContain('[3:v]scale=1280:240');
    expect(text).toContain('[lay_o1][lay_p2]overlay=0:480,drawbox=');
    expect(text).not.toContain('alphamerge');
  });

  it('lowers a before/after wipe to pad + per-frame crop + overlay, deterministic', () => {
    const layout: SectionLayout = {
      type: 'before-after',
      before: 'photo',
      after: 'clip',
      wipe: { at: 1, duration: 1, direction: 'left', ease: 'linear' },
    };
    const text = render(layoutToFilters(layout, env())[0]);
    const edge = wipeEdge(layout.wipe, 1280);

    expect(edge).toBe('2*floor(1280*(1-(0+1*(if(lt(t,1),0,if(lt(t,2),(t-1)/1,1)))))/2)');
    expect(text).toContain('pad=w=2560:h=720:x=0:y=0[lay_p1]');
    expect(text).toContain(`crop=w=1280:h=720:x='${edge}':y=0[lay_a]`);
    expect(text).toContain(`overlay=x='${edge}':y=0`);
    expect(render(layoutToFilters(layout, env())[0])).toBe(text);
  });

  it('validates sources, section types and wipe timing', () => {
    const result = new TemplateValidator().validateTemplate({
      sections: [
        { name: 'intro', type: 'color_background', options: { duration: 2 } },
        {
          name: 'cmp',
          type: 'color_background',
          options: { duration: 2 },
          layout: { type: 'before-after', before: 'intro', after: 'intr', wipe: { at: 3 } },
        },
        { name: 'ask', type: 'form', layout: { type: 'split', sources: ['intro', '#000000'] } },
      ],
    });
    const codes = (result.errors ?? []).map((e) => `${e.code}@${e.path}`);

    expect(codes).toContain('unknown_layout_source@sections[1].layout.after');
    expect(codes).toContain('layout_wipe_out_of_range@sections[1].layout.wipe.at');
    expect(codes).toContain('layout_unsupported_section@sections[2].layout');
  });
});
