import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildDescriptor, newSection, type EditorState, type EditorSection } from '../templateEditorModel';
import { exportDescriptorJson, exportFilename, importDescriptorJson } from './templateIO';

function state(over: Partial<EditorState> = {}): EditorState {
  const video = { ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), duration: 6 };

  return {
    id: 'user-42',
    name: 'My Template',
    description: 'A demo',
    orientation: 'portrait',
    sections: [newSection('form'), video, newSection('color')],
    globalVariables: [{ name: 'brand', value: 'LeClap' }],
    audio: { sourceVolume: 1, musicVolume: 0.5, ducking: false },
    defaultTransition: { type: 'cut', duration: 0.5 },
    globalAnimations: [],
    globalOverlays: [],
    ...over,
  };
}

describe('exportFilename', () => {
  it('slugifies the template name', () => {
    expect(exportFilename(state({ name: 'Holiday Promo 2024!' }))).toBe('holiday-promo-2024.json');
  });

  it('falls back to template.json when the name is blank', () => {
    expect(exportFilename(state({ name: '   ' }))).toBe('template.json');
  });
});

describe('import/export round-trip', () => {
  it('exports the built descriptor as pretty JSON', () => {
    const json = exportDescriptorJson(state());
    expect(json).toContain('\n  '); // pretty-printed
    expect(JSON.parse(json)).toEqual(buildDescriptor(state()));
  });

  it('re-imports an exported descriptor into an equivalent editor state', () => {
    const original = state();
    const json = exportDescriptorJson(original);

    const result = importDescriptorJson(json, original);
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    // The descriptor the re-imported state builds must equal the original descriptor — a clean
    // round-trip through buildDescriptor -> JSON -> safeParse -> toEditorState -> buildDescriptor.
    expect(buildDescriptor(result.state)).toEqual(buildDescriptor(original));
    // The id carries over from the current state; name/description ride inside the descriptor meta.
    expect(result.state.id).toBe(original.id);
    expect(result.state.name).toBe(original.name);
    expect(result.state.orientation).toBe('portrait');
  });

  it('exports the template identity as descriptor meta', () => {
    const exported = JSON.parse(exportDescriptorJson(state())) as { meta?: { name?: string; description?: string } };

    expect(exported.meta).toEqual({ name: 'My Template', description: 'A demo' });
  });

  it('prefers the imported descriptor meta over the current editor identity', () => {
    const foreign = exportDescriptorJson(state({ name: 'Someone Else Promo', description: 'Their blurb' }));

    const result = importDescriptorJson(foreign, state());
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.state.name).toBe('Someone Else Promo');
    expect(result.state.description).toBe('Their blurb');
    // The import still lands as an edit of the SAME template.
    expect(result.state.id).toBe('user-42');
  });

  it('keeps the current identity when the imported JSON has no meta (legacy descriptor)', () => {
    const legacy = JSON.stringify({ global: { orientation: 'portrait' }, sections: [] });

    const result = importDescriptorJson(legacy, state());
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.state.name).toBe('My Template');
    expect(result.state.description).toBe('A demo');
  });

  it('imports a square descriptor as square (not the current orientation)', () => {
    const square = exportDescriptorJson(state({ orientation: 'square' }));

    const result = importDescriptorJson(square, state({ orientation: 'portrait' }));
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.state.orientation).toBe('square');
  });

  it('imports a landscape descriptor as landscape (not the current orientation)', () => {
    const landscape = exportDescriptorJson(state({ orientation: 'landscape' }));

    const result = importDescriptorJson(landscape, state({ orientation: 'portrait' }));
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.state.orientation).toBe('landscape');
  });

  it('keeps the current orientation when the imported descriptor omits it', () => {
    const noOrientation = JSON.stringify({ sections: [] });

    const result = importDescriptorJson(noOrientation, state({ orientation: 'square' }));
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.state.orientation).toBe('square');
  });

  it('reports readable zod errors for an invalid descriptor', () => {
    const result = importDescriptorJson(JSON.stringify({ sections: [{ type: 'not_a_real_type' }] }), state());
    expect(result.ok).toBe(false);

    if (result.ok) return;

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((line) => line.includes(':'))).toBe(true);
  });

  it('reports a parse error for malformed JSON', () => {
    const result = importDescriptorJson('{ not json', state());
    expect(result.ok).toBe(false);

    if (result.ok) return;

    expect(result.errors[0]).toContain('Invalid JSON');
  });
});

describe('importDescriptorJson effect sections', () => {
  it('refuses a template with an effect section instead of turning it into a video slot', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../../../../../../examples/llm-remotion-title/template.json', import.meta.url)),
      'utf8'
    );

    const result = importDescriptorJson(text, state());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(' ')).toMatch(/effect/i);
  });
});
