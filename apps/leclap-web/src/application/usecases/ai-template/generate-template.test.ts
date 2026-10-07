import { describe, expect, it, vi } from 'vitest';
import type { GenerateRequest, TemplateModelProvider } from './model-provider';
import {
  checkReply,
  generateTemplate,
  GenerationFailedError,
  repairMessage,
  type GenerationPhase,
} from './generate-template';
import { summarizeDescriptor } from './descriptor-summary';

const VALID_TEMPLATE = {
  meta: { name: 'Launch', description: 'A short launch.' },
  global: { orientation: 'portrait', transition: { type: 'fade', duration: 0.3 } },
  sections: [
    {
      name: 'intro',
      type: 'color_background',
      look: 'vivid',
      options: { backgroundColor: '#000000', duration: 2 },
      filters: [
        {
          type: 'drawtext',
          values: {
            text: { en: 'HELLO' },
            fontfile: 'Oswald.ttf',
            fontsize: 64,
            fontcolor: '#ffffff',
            x: '(w-text_w)/2',
            y: 500,
          },
          reveal: { type: 'rise', delay: 0, duration: 0.3 },
        },
      ],
    },
    { name: 'clip', type: 'project_video', options: { duration: 4 } },
    { name: 'outro', type: 'color_background', options: { backgroundColor: '#000000', duration: 1.5 } },
  ],
};

function fakeProvider(replies: string[]): TemplateModelProvider & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];

  return {
    id: 'fake',
    label: 'Fake',
    defaultModel: 'fake-1',
    models: ['fake-1'],
    looksLikeKey: () => true,
    keyPlaceholder: '',
    keyUrl: '',
    calls,
    generate: (request) => {
      calls.push(structuredClone({ ...request, signal: undefined, onProgress: undefined }));
      request.onProgress?.(10);

      return Promise.resolve(replies[calls.length - 1] ?? '');
    },
  };
}

const base = {
  model: 'fake-1',
  apiKey: 'k',
  system: 'SYSTEM',
  prompt: 'a launch video',
  hints: { orientation: 'portrait' as const },
};

describe('checkReply', () => {
  it('accepts a valid template wrapped in fences', () => {
    expect(checkReply(`\`\`\`json\n${JSON.stringify(VALID_TEMPLATE)}\n\`\`\``).ok).toBe(true);
  });

  it('rejects non-JSON and builder-unsupported sections', () => {
    const notJson = checkReply('I cannot do that');
    const effect = checkReply(
      JSON.stringify({
        sections: [{ name: 'fx', type: 'effect', options: { duration: 2 }, effect: { id: 'x', version: '1.0.0' } }],
      })
    );

    expect(notJson.ok ? [] : notJson.issues.map((issue) => issue.code)).toEqual(['invalid_json']);
    expect(effect.ok ? [] : effect.issues.map((issue) => issue.code)).toContain('builder_unsupported_section');
  });
});

describe('generateTemplate', () => {
  it('returns the descriptor on the first valid reply', async () => {
    const provider = fakeProvider([JSON.stringify(VALID_TEMPLATE)]);
    const result = await generateTemplate({ ...base, provider });

    expect(result.rounds).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.descriptor.sections).toHaveLength(3);
    expect(provider.calls[0].messages).toEqual([
      { role: 'user', content: expect.stringContaining('Brief: a launch video') },
    ]);
  });

  it('repairs an invalid reply by sending the validation issues back', async () => {
    const invalid = JSON.stringify({ ...VALID_TEMPLATE, sections: [{ name: 'bad', type: 'not-a-type' }] });
    const provider = fakeProvider([invalid, JSON.stringify(VALID_TEMPLATE)]);
    const phases: GenerationPhase['kind'][] = [];
    const result = await generateTemplate({ ...base, provider, onPhase: (phase) => phases.push(phase.kind) });

    expect(result.rounds).toBe(2);
    expect(result.warnings[0]).toMatch(/1 repair round/);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].system).toBe('SYSTEM');
    expect(provider.calls[1].messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(provider.calls[1].messages[1].content).toBe(invalid);
    expect(provider.calls[1].messages[2].content).toContain('sections.0');
    expect(phases).toContain('repairing');
    expect(phases.at(-1)).toBe('validating');
  });

  it('gives up after the repair budget with the remaining issues', async () => {
    const provider = fakeProvider(['nope', 'nope', 'nope', 'nope', 'nope']);
    const run = generateTemplate({ ...base, provider, maxRepairs: 2 });

    await expect(run).rejects.toBeInstanceOf(GenerationFailedError);
    await expect(run).rejects.toMatchObject({ rounds: 3 });
    expect(provider.calls).toHaveLength(3);
  });

  it('warns when the model ignores the orientation hint', async () => {
    const landscape = { ...VALID_TEMPLATE, global: { orientation: 'landscape' } };
    const result = await generateTemplate({ ...base, provider: fakeProvider([JSON.stringify(landscape)]) });

    expect(result.warnings[0]).toMatch(/portrait/);
  });

  it('propagates provider errors (e.g. abort) without retrying', async () => {
    const generate = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const provider = { ...fakeProvider([]), generate };

    await expect(generateTemplate({ ...base, provider })).rejects.toThrow('aborted');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('repairMessage', () => {
  it('includes path, code, message and hint/suggestion fields', () => {
    const text = repairMessage([
      {
        path: 'sections.0.look',
        code: 'invalid_value',
        message: 'Unknown look',
        hint: 'Use a catalog look',
        suggestion: 'cinematic',
      },
    ]);

    expect(text).toContain('sections.0.look [invalid_value]: Unknown look (hint: Use a catalog look cinematic)');
  });
});

describe('summarizeDescriptor', () => {
  it('counts scenes, duration and effects', () => {
    const summary = summarizeDescriptor(VALID_TEMPLATE as never);

    expect(summary).toMatchObject({
      name: 'Launch',
      scenes: 3,
      footageScenes: 1,
      durationSeconds: 7.5,
      orientation: 'portrait',
    });
    expect(summary.effects).toEqual(['transition: fade', 'look: vivid', 'reveal: rise']);
  });
});
