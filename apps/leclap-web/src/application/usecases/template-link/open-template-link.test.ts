import { describe, expect, it } from 'vitest';
import {
  encodeTemplatePayload,
  mediaToRebind,
  TEMPLATE_LINK_LIMITS,
} from 'ffmpeg-video-composer/src/core/template-link/index.ts';
import webAppPromo from '@leclap/creative-kit/templates/web-app-promo.json';
import { importTemplateLink, stripUnreadableMedia } from './open-template-link';

// Built from parts: the lint rule against script URLs is right everywhere but in a test of refusing them.
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

const noUploads = { hasUpload: async () => false };

async function hashFor(template: unknown): Promise<string> {
  return `#t=${await encodeTemplatePayload(template)}`;
}

const withMedia = {
  meta: { name: 'Hand-off' },
  global: {
    orientation: 'portrait',
    music: { name: 'Mine', url: '/Users/me/music/track.mp3' },
    watermark: { url: 'media://logo-here' },
  },
  sections: [
    { name: 'intro', type: 'color_background', options: { duration: 2, backgroundColor: '#101820' } },
    { name: 'take', type: 'video', options: { videoUrl: '/Users/me/clips/take-1.mp4', duration: 4 } },
    {
      name: 'outro',
      type: 'color_background',
      options: { duration: 2, backgroundColor: '#000000' },
      inputs: [
        { name: 'logo', type: 'image', url: 'file:///Users/me/logo.png' },
        { name: 'mark', type: 'image', url: '/assets/pictures/mark.png' },
      ],
    },
  ],
};

describe('importTemplateLink', () => {
  it('does nothing without a #t= fragment', async () => {
    expect(await importTemplateLink('', noUploads)).toEqual({ kind: 'none' });
    expect(await importTemplateLink('#projects', noUploads)).toEqual({ kind: 'none' });
  });

  it('opens a bundled template as a new, unsaved user draft', async () => {
    const result = await importTemplateLink(await hashFor(webAppPromo), noUploads);

    expect(result.kind).toBe('opened');

    if (result.kind !== 'opened') return;

    expect(result.template.name).toBe('Web App Promo');
    expect(result.template.source).toBe('user');
    expect(result.template.descriptor).toEqual(webAppPromo);
    expect(result.template.id).toMatch(/\S/);
    expect(result.rebind).toEqual([]);

    const again = await importTemplateLink(await hashFor(webAppPromo), noUploads);

    expect(again.kind === 'opened' && again.template.id).not.toBe(result.template.id);
  });

  it('turns media only the author can read into empty slots and lists them', async () => {
    const result = await importTemplateLink(await hashFor(withMedia), noUploads);

    if (result.kind !== 'opened') throw new Error(`expected opened, got ${result.kind}`);

    const { descriptor } = result.template;

    expect(descriptor.global?.music).toBeUndefined();
    expect(descriptor.global?.watermark).toBeUndefined();
    expect(descriptor.sections?.[1]).toMatchObject({ name: 'take', options: { duration: 4 } });
    expect(descriptor.sections?.[1]).not.toHaveProperty('options.videoUrl');
    expect(descriptor.sections?.[2]).toHaveProperty('inputs', [
      { name: 'mark', type: 'image', url: '/assets/pictures/mark.png' },
    ]);
    expect(result.template.orientation).toBe('portrait');
    expect(result.rebind).toEqual([
      { file: 'track.mp3', section: null, reason: 'local_path' },
      { file: 'logo-here', section: null, reason: 'device_upload' },
      { file: 'take-1.mp4', section: 'take', reason: 'local_path' },
      { file: 'logo.png', section: 'outro', reason: 'local_path' },
    ]);
  });

  it('keeps media:// uploads this browser already holds', async () => {
    const result = await importTemplateLink(await hashFor(withMedia), {
      hasUpload: async (key) => key === 'logo-here',
    });

    if (result.kind !== 'opened') throw new Error(`expected opened, got ${result.kind}`);

    expect(result.template.descriptor.global?.watermark).toEqual({ url: 'media://logo-here' });
    expect(result.rebind.map((item) => item.file)).not.toContain('logo-here');
  });

  it('reports a corrupt, oversized or invalid link instead of throwing', async () => {
    const corrupt = await importTemplateLink('#t=v1.AAAAAAAA', noUploads);
    const truncated = await importTemplateLink((await hashFor(webAppPromo)).slice(0, 200), noUploads);
    const oversized = await importTemplateLink(
      `#t=v1.${'A'.repeat(TEMPLATE_LINK_LIMITS.maxPayloadLength + 1)}`,
      noUploads
    );
    const invalid = await importTemplateLink(await hashFor({ sections: [{ name: 'x', type: 'nope' }] }), noUploads);
    const future = await importTemplateLink('#t=v7.abc', noUploads);

    expect(corrupt).toMatchObject({ kind: 'failed', code: 'corrupt' });
    expect(truncated).toMatchObject({ kind: 'failed', code: 'corrupt' });
    expect(oversized).toMatchObject({ kind: 'failed', code: 'too_large' });
    expect(invalid).toMatchObject({ kind: 'failed', code: 'invalid_template' });
    expect(invalid.kind === 'failed' && invalid.details.length > 0).toBe(true);
    expect(future).toMatchObject({ kind: 'failed', code: 'unsupported_version' });
  });

  it('drops media under a scheme the builder does not load, listing it like unreadable media', async () => {
    const template = {
      meta: { name: 'Scheme' },
      sections: [{ name: 'take', type: 'video', options: { videoUrl: SCRIPT_URL, duration: 4 } }],
    };
    const result = await importTemplateLink(await hashFor(template), noUploads);

    expect(result.kind).toBe('opened');

    if (result.kind !== 'opened') return;

    expect(JSON.stringify(result.template.descriptor)).not.toContain(SCRIPT_URL);
    expect(result.rebind).toEqual([{ file: SCRIPT_URL, section: 'take', reason: 'unsupported_scheme' }]);
  });

  it('refuses a template the builder cannot edit, saying why', async () => {
    const effect = {
      sections: [
        {
          name: 'title',
          type: 'effect',
          effect: { id: 'leclap.title-reveal', version: '1.0.0', props: {}, assets: {} },
          options: { duration: 3 },
        },
      ],
    };
    const result = await importTemplateLink(await hashFor(effect), noUploads);

    expect(result).toMatchObject({ kind: 'failed', code: 'invalid_template' });
    expect(result.kind === 'failed' && result.details.join(' ')).toMatch(/Effect sections/);
  });
});

describe('stripUnreadableMedia', () => {
  it('leaves the input untouched and removes only the listed fields', () => {
    const before = structuredClone(withMedia);
    const stripped = stripUnreadableMedia(withMedia, [
      { pointer: '/sections/1/options/videoUrl', value: '/Users/me/clips/take-1.mp4', reason: 'local_path' },
    ]) as typeof withMedia;

    expect(withMedia).toEqual(before);
    expect(stripped.sections[1].options).toEqual({ duration: 4 });
    expect(stripped.global.music).toEqual(withMedia.global.music);
  });

  it('drops a whole input without touching the field of the input after it', () => {
    const section = {
      name: 's',
      type: 'video',
      inputs: [
        {
          name: 'a',
          filters: [{ type: 'drawtext', values: { fontfile: '/Users/me/A.ttf' } }],
          url: '/Users/me/a.png',
        },
        {
          name: 'b',
          filters: [{ type: 'drawtext', values: { fontfile: '/fonts/Bundled.ttf' } }],
          url: '/assets/b.png',
        },
      ],
    };
    const template = { sections: [section] };
    const stripped = stripUnreadableMedia(template, mediaToRebind(template)) as typeof template;

    expect(stripped.sections[0].inputs).toEqual([section.inputs[1]]);
  });

  it('drops a field of an input and that input when both are listed, whatever their order', () => {
    const template = {
      sections: [
        {
          name: 's',
          inputs: [
            { name: 'a', url: '/Users/me/a.png', values: { fontfile: '/Users/me/A.ttf' } },
            { name: 'b', url: '/assets/b.png', values: { fontfile: '/Users/me/B.ttf' } },
          ],
        },
      ],
    };
    const refs = mediaToRebind(template);
    const stripped = stripUnreadableMedia(template, refs);

    expect(stripUnreadableMedia(template, refs.toReversed())).toEqual(stripped);
    expect(stripped).toEqual({ sections: [{ name: 's', inputs: [{ name: 'b', url: '/assets/b.png', values: {} }] }] });
  });
});
