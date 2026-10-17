import { describe, expect, it } from 'vitest';

import { registerGetTemplateSchema } from '../src/tools/getTemplateSchema.js';

type Handler = () => { content: { type: string; text: string }[] };

function guideText(): string {
  let handler: Handler | undefined;

  registerGetTemplateSchema({
    registerTool: (_name: string, _meta: unknown, cb: Handler) => {
      handler = cb;
    },
  } as never);

  if (!handler) throw new Error('get_template_schema was not registered');

  return handler().content[0].text;
}

describe('get_template_schema guide', () => {
  it('documents HTML layers and where to find their subset', () => {
    const text = guideText();

    expect(text).toContain('type: "html"');
    expect(text).toContain('html_unavailable');
    expect(text).toContain('get_motion_catalog html');
    expect(text).toContain('"html"');
  });

  it('documents the shape graphic, its icon path, its draw-on and its advisory', () => {
    const text = guideText();

    expect(text).toContain('`shape` fills a preset');
    expect(text).toContain('viewBox');
    expect(text).toContain('stroke.draw');
    expect(text).toContain('shape_unavailable');
    expect(text).toContain('shape_too_large');
  });

  it('tells agents raw filters are allow-listed and how an operator opts in', () => {
    const text = guideText();

    expect(text).toContain('filter_not_allowed');
    expect(text).toContain('--allow-raw-filters');
  });

  it('teaches per-element motion in HTML layers', () => {
    const text = guideText();

    expect(text).toContain('data-motion');
    expect(text).toContain('html_motion_too_long');
    expect(text).toContain('staggeredList');
  });
});
