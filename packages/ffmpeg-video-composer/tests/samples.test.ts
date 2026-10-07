import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listSamples, getSample, SAMPLE_CATEGORIES, SAMPLE_BACKENDS } from '../src/samples';
import { TemplateValidator } from '../src/services/TemplateValidator';
import { sampleRequirements } from '../scripts/sample-metadata';
import type { TemplateDescriptor } from '../src/schemas/template.schemas';

const root = new URL('../../../', import.meta.url);
const readJson = async (relative: string) => JSON.parse(await readFile(new URL(relative, root), 'utf8'));

describe('packaged sample catalog', () => {
  it('matches every canonical entry and preserves its authored descriptor', async () => {
    const catalog = await readJson('examples/showcase/catalog.json');
    expect(listSamples().map(({ id }) => id)).toEqual(catalog.samples.map(({ id }: { id: string }) => id));
    expect(listSamples()).toHaveLength(47);
    for (const sample of catalog.samples) {
      const detail = getSample(sample.id);
      const authored = await readJson(sample.source);
      expect(detail).toMatchObject(sample);
      if (sample.section) {
        expect(detail.template.sections).toEqual(
          authored.sections.filter((s: { name: string }) => s.name === sample.section)
        );
        expect(detail.template.global?.transition).toEqual({ type: 'cut' });
      }
      if (!sample.section) {
        expect(detail.template.sections).toEqual(authored.sections);
        expect(detail.template.global).toEqual(authored.global);
      }
      expect(detail.template.meta).toEqual(authored.meta);
      expect(detail.creativeDirection).toEqual(authored.meta?.creativeDirection);
      for (const partial of detail.template.partials ?? []) {
        const inline = authored.partials?.find((p: { id: string }) => p.id === partial.id);
        expect(partial).toEqual(
          inline ?? {
            id: partial.id,
            ...(await readJson(`packages/leclap-creative-kit/src/partials/${partial.id}.json`)),
          }
        );
      }
      expect(new TemplateValidator().validateTemplate(detail.template).success, sample.id).toBe(true);
      expect(detail.showcasePath).toBe(`/showcase?sample=${sample.id}`);
      expect(detail.preview.video).toBe(`/videos/showcase/${sample.id}.mp4`);
      expect(listSamples().find(({ id }) => id === sample.id)).not.toHaveProperty('template');
    }
  });

  it('filters categories, backends and case-insensitive search together', () => {
    expect(SAMPLE_CATEGORIES).toContain('evidence');
    expect(SAMPLE_BACKENDS).toEqual(['native', 'remotion']);
    expect(listSamples({ backend: 'native' })).toHaveLength(37);
    expect(listSamples({ backend: 'remotion' })).toHaveLength(10);
    expect(listSamples({ category: 'evidence' }).map(({ id }) => id)).toEqual([
      'pr-evidence',
      'before-after',
      'house-evidence',
    ]);
    expect(listSamples({ category: 'typography', backend: 'native' }).map(({ id }) => id)).toEqual([
      'type-impact',
      'native-timing',
      'kinetic-type',
      'spring-kinetics',
      'camera-and-graphics',
    ]);
    expect(listSamples({ category: 'effects' }).map(({ id }) => id)).toEqual([
      'effects-tour',
      'fx-pack',
      'word-captions',
      'formats',
      'kinetic-fills',
      'split-layouts',
      'rtl-type',
      'emoji-type',
      'beat-grid',
      'theme-roles',
      'footage-edit',
      'sound-design',
    ]);
    expect(listSamples({ category: 'effects', backend: 'remotion' })).toEqual([]);
    expect(listSamples({ query: 'WoRd StAgGeR' }).map(({ id }) => id)).toEqual(['editorial-word-stagger']);
    expect(listSamples({ category: 'evidence', query: 'BEFORE' }).map(({ id }) => id)).toEqual([
      'before-after',
      'house-evidence',
    ]);
    expect(listSamples({ query: 'no matching phrase' })).toEqual([]);
  });

  it('rejects invalid filters and unknown or prototype property IDs', () => {
    for (const id of ['missing', '__proto__', 'constructor', 'toString']) {
      expect(() => getSample(id)).toThrow(/Unknown sample/);
    }
    expect(() => listSamples({ category: 'bad' as never })).toThrow(/category/);
    expect(() => listSamples({ backend: 'bad' as never })).toThrow(/backend/);
    expect(() => listSamples({ query: 123 as never })).toThrow(/query/);
  });

  it('returns independent nested descriptor and metadata copies', () => {
    const before = getSample('web-app-promo');
    const changed = getSample('web-app-promo');
    changed.template.sections = [];
    changed.requirements.formFields[0].label.en = 'changed';
    changed.preview.video = 'changed';
    const listing = listSamples();
    listing[0].requirements.setup.push('changed');
    expect(getSample('web-app-promo')).toEqual(before);
    expect(listSamples()[0].requirements.setup).not.toContain('changed');
  });

  it('discloses actual clips, capture hints, fields, defaults and referenced assets', () => {
    const app = getSample('web-app-promo');
    expect(app.requirements.projectVideos).toEqual([
      expect.objectContaining({
        name: 'video_1',
        duration: 6.4,
        captureMode: 'screen',
        allowedCaptureModes: ['screen', 'upload'],
      }),
    ]);
    expect(app.requirements.formFields.map(({ name }) => name)).toEqual([
      'form_1_app',
      'form_1_promise',
      'form_1_feature',
      'form_1_cta',
    ]);
    expect(app.requirements.variables).toContainEqual(
      expect.objectContaining({ name: 'form_1_app', placeholders: ['{{ form_1_app }}'] })
    );
    expect(app.requirements.assets).toContainEqual(
      expect.objectContaining({ reference: 'lofi-study.mp3', kind: 'music' })
    );
    expect(getSample('house-evidence').requirements.projectVideos.map(({ name }) => name)).toEqual([
      'intro',
      'beforecard',
      'beforeclip',
      'aftercard',
      'afterclip',
      'outro',
    ]);
    expect(getSample('before-after').requirements.variables).toContainEqual(
      expect.objectContaining({ name: 'change', default: 'Describe the change', placeholders: ['{{ change }}'] })
    );
    // Its glow is a procedural fx now: the bumper clip of its partial is the asset it references.
    expect(getSample('present-yourself').requirements.assets).toContainEqual(
      expect.objectContaining({ kind: 'video', path: 'sections[3].options.videoUrl' })
    );
    expect(getSample('present-yourself').requirements.assets).not.toContainEqual(
      expect.objectContaining({ reference: '/assets/animations/glow_border.apng' })
    );
    expect(getSample('drink-and-code').requirements.assets).toContainEqual(
      expect.objectContaining({ reference: '{{ videoOutro }}', default: 'videos/outro.mp4' })
    );
  });

  it('identifies effect versions and custom operator catalog setup without resolving effects', () => {
    const registered = getSample('web-app-effect');
    expect(registered.backend).toBe('remotion');
    expect(registered.requirements.effects).toEqual([
      { id: 'leclap.web-app-promo', version: '1.0.0', sections: ['promo'], customCatalog: false },
    ]);
    expect(registered.requirements.assets).toContainEqual(
      expect.objectContaining({ kind: 'effect-asset', reference: 'media/screenshot.png' })
    );
    const custom = getSample('product-reveal');
    expect(custom.requirements.effects).toEqual([
      { id: 'studio.product-reveal', version: '1.0.0', sections: ['product'], customCatalog: true },
    ]);
    expect(custom.requirements.setup.join(' ')).toMatch(/--effect-catalog/);
    expect(custom.requirements.setup.join(' ')).toMatch(/--allow-remotion/);
  });

  it.each(['pr-evidence', 'before-after'])('discloses effective title card and lower third fonts for %s', (id) => {
    const presetFonts = getSample(id).requirements.assets.filter((asset) => asset.source === 'preset');
    expect([...new Set(presetFonts.map(({ reference }) => reference))].sort()).toEqual(['Anton.ttf', 'Oswald.ttf']);
    expect(presetFonts.some(({ path }) => path.includes('.titleCard.'))).toBe(true);
    expect(presetFonts.some(({ path }) => path.includes('.lowerThird.'))).toBe(true);
  });

  it('uses real preset defaults and overrides while preserving descriptors and placeholders', () => {
    const template: TemplateDescriptor = {
      global: { overlays: [{ text: { en: '{{ brand }}' } }, { text: { en: 'Override' }, font: 'archivo-black' }] },
      sections: [
        {
          name: 'card',
          type: 'color_background',
          titleCard: {
            kicker: { en: '{{ project }}' },
            headline: { en: '{{ headline }}' },
            subtitle: { en: ' ' },
            kickerStyle: { font: 'playfair' },
            headlineStyle: { font: { family: 'Inter', weight: 700, style: 'italic' } },
            subtitleStyle: { font: 'pacifico' },
          },
        },
        { name: 'default-caption', type: 'project_video', caption: { text: { en: '{{ caption }}' } } },
        { name: 'subtle-caption', type: 'project_video', caption: { text: { en: 'Subtle' }, style: 'subtle' } },
        {
          name: 'override-caption',
          type: 'project_video',
          caption: { text: { en: 'Override' }, style: 'subtle', font: 'bebas' },
        },
        { name: 'empty-caption', type: 'project_video', caption: { text: { en: ' ' }, font: 'lobster' } },
        {
          name: 'default-lower-third',
          type: 'project_video',
          lowerThird: { title: { en: '{{ title }}' }, subtitle: { en: 'Subtitle' }, badge: { en: 'Badge' } },
        },
      ],
    };
    const original = structuredClone(template);
    const requirements = sampleRequirements(template);
    const presetFonts = requirements.assets.filter((asset) => asset.source === 'preset');
    expect([...new Set(presetFonts.map(({ reference }) => reference))].sort()).toEqual([
      'Anton.ttf',
      'ArchivoBlack.ttf',
      'BebasNeue.ttf',
      'Oswald.ttf',
      'PlayfairDisplay.ttf',
      'Rubik.ttf',
      'google-inter-700-italic.ttf',
    ]);
    expect(presetFonts.find(({ reference }) => reference === 'google-inter-700-italic.ttf')?.font).toEqual({
      family: 'Inter',
      weight: 700,
      style: 'italic',
    });
    expect(requirements.variables).toContainEqual(
      expect.objectContaining({ name: 'headline', placeholders: ['{{ headline }}'] })
    );
    expect(requirements.variables).toContainEqual(
      expect.objectContaining({ name: 'brand', placeholders: ['{{ brand }}'] })
    );
    expect(template).toEqual(original);
  });

  it('classifies an exact-placeholder image default without rewriting the authored watermark', () => {
    expect(
      getSample('drink-and-code').requirements.assets.find(({ reference }) => reference === '{{ watermark }}')
    ).toMatchObject({
      kind: 'image',
      reference: '{{ watermark }}',
      default: 'pictures/logo.png',
    });
  });

  it('lists effective font files without treating preset font IDs as external assets', () => {
    const requirements = sampleRequirements({
      global: { overlays: [{ text: { en: 'Brand' }, font: 'archivo-black' }] },
      sections: [
        {
          name: 'card',
          type: 'color_background',
          titleCard: { headline: { en: 'Title' }, headlineStyle: { font: 'bebas' } },
          caption: { text: { en: 'Caption' }, font: 'oswald' },
          filters: [{ type: 'drawtext', values: { text: { en: 'Raw text' }, fontfile: 'Custom.ttf' } }],
        },
      ],
    });
    expect(
      requirements.assets
        .filter(({ kind }) => kind === 'font')
        .map(({ reference }) => reference)
        .sort()
    ).toEqual(['ArchivoBlack.ttf', 'BebasNeue.ttf', 'Custom.ttf', 'Oswald.ttf']);
  });

  it('keeps committed generated data fresh against canonical sources', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('pnpm', ['--filter', 'ffmpeg-video-composer', 'generate:samples', '--check'], {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
  });
});
