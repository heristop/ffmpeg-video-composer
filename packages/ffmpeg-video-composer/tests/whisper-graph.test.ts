import { describe, expect, it } from 'vitest';
import { whisperFilterGraph, whisperLanguage } from '@/services/transcribe-node/whisper-run';

// The `language` reaches FFmpeg's filtergraph from template JSON and MCP input, so it must never be able to
// add filter options (`:destination=…`) or chain filters (`,`, `;`, `[…]`).

/** Graph-level separators FFmpeg would act on: those not preceded by a backslash. */
const unescaped = (graph: string, chars: string): string[] =>
  [...graph.matchAll(new RegExp(`(?<!\\\\)[${chars}]`, 'g'))].map((match) => match[0]);

describe('whisperLanguage', () => {
  it('keeps the primary subtag of a BCP-47 tag', () => {
    expect(whisperLanguage('en')).toBe('en');
    expect(whisperLanguage('fr-FR')).toBe('fr');
    expect(whisperLanguage('pt_BR')).toBe('pt');
    expect(whisperLanguage('YUE')).toBe('yue');
  });

  it('falls back to auto-detection for anything that is not a language code', () => {
    expect(whisperLanguage(undefined)).toBe('auto');
    expect(whisperLanguage('en:destination=/tmp/pwn')).toBe('auto');
    expect(whisperLanguage('en,amovie=/etc/passwd')).toBe('auto');
    expect(whisperLanguage("e'n")).toBe('auto');
    expect(whisperLanguage('english')).toBe('auto');
  });
});

describe('whisperFilterGraph', () => {
  it('builds one whisper filter whose options are the four it sets', () => {
    const graph = whisperFilterGraph({ model: '/cache/ggml-base.bin', language: 'fr-FR', destination: '/tmp/w.jsonl' });

    expect(graph).toBe('whisper=model=/cache/ggml-base.bin:language=fr:queue=10:destination=/tmp/w.jsonl:format=json');
  });

  it('cannot be extended through the language', () => {
    const graph = whisperFilterGraph({
      model: '/cache/ggml-base.bin',
      language: 'en:destination=/tmp/pwn,amovie=/etc/passwd',
      destination: '/tmp/w.jsonl',
    });

    expect(graph).toContain(':language=auto:');
    expect(graph).not.toContain('pwn');
    expect(unescaped(graph, ',;\\[\\]')).toEqual([]);
  });

  it('keeps separators in paths inert at both the option and the graph level', () => {
    const graph = whisperFilterGraph({
      model: "C:\\models\\a,b;c[d]e'f.bin",
      language: 'en',
      destination: '/tmp/out:1.jsonl',
    });

    expect(unescaped(graph, ',;\\[\\]')).toEqual([]);
    // Option level: ":" → "\:"; graph level: "\" → "\\". FFmpeg unescapes it back to "/tmp/out:1.jsonl".
    expect(graph).toContain(':destination=/tmp/out\\\\:1.jsonl:');
    // Only the four option separators the builder writes remain active at the option level.
    expect(graph.split(/(?<!\\):/)).toHaveLength(5);
  });
});
