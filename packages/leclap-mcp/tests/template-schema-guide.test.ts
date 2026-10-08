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
});
