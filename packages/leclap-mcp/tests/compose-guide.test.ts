import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { registerComposeGuide } from '../src/prompts/composeGuide.js';

type Handler = (args: Record<string, unknown>) => unknown;

function captureHandler(): Handler {
  let captured: Handler | undefined;
  const fakeServer = {
    registerPrompt: (_name: string, _meta: unknown, cb: Handler) => {
      captured = cb;
    },
  };

  registerComposeGuide(fakeServer as never);

  if (!captured) {
    throw new Error('handler was not registered');
  }

  return captured;
}

describe('compose-video prompt', () => {
  it('passes the supplied direction into the authoring and preview workflow', () => {
    const result = captureHandler()({ creativeDirection: '  Quiet editorial. Long readable holds.  ' }) as {
      messages: { content: { text: string } }[];
    };
    const text = result.messages[0].content.text;
    expect(text).toContain('Quiet editorial. Long readable holds.');
    expect(text).toContain('meta.creativeDirection');
    expect(text).toContain('get_effect_schema');
    expect(text).toContain('render_preview');
  });

  it('primes the schema-first authoring loop', () => {
    const result = captureHandler()({ goal: 'a launch card', orientation: 'landscape' }) as {
      messages: { content: { text: string } }[];
    };
    const text = result.messages[0].content.text;

    expect(text).toContain('get_template_schema');
    expect(text).toContain('validate_template');
    expect(text).toContain('compose_video');
    expect(text).toContain('render_frames after validate to look at the result');
    expect(text).toContain('check safe zones');
    expect(text).toContain('get_timeline');
    expect(text).toContain('report_catalog_gap');
    expect(text).toContain('global.fields');
    expect(text).toContain('get_resolved_template');
  });

  it('points to render_remotion_clip for an animated intro fed via userVideoPaths', () => {
    const result = captureHandler()({ goal: 'a launch card', orientation: 'landscape' }) as {
      messages: { content: { text: string } }[];
    };
    const text = result.messages[0].content.text;

    expect(text).toContain('render_remotion_clip');
    expect(text).toContain('project_video');
    expect(text).toContain('userVideoPaths');
  });

  it('primes the motion pacing rules checked by validate_template', () => {
    const result = captureHandler()({ goal: 'a launch film' }) as { messages: { content: { text: string } }[] };
    const text = result.messages[0].content.text;

    expect(text).toContain('One primary transition plus 1–2 accents');
    expect(text).toContain('The transition is the exit');
    expect(text).toContain("Don't start at 0");
    expect(text).toContain('at least 3× the fastest');
    expect(text).toContain('motionWarnings');
  });
});
