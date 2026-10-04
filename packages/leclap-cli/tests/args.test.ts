import { describe, it, expect } from 'vitest';
import { rewriteArgv, KNOWN_COMMANDS } from '../src/args';

describe('rewriteArgv', () => {
  it('prepends "render" for a bare template path', () => {
    expect(rewriteArgv(['my-template.json'], KNOWN_COMMANDS)).toEqual(['render', 'my-template.json']);
  });

  it('prepends "render" for any non-command, non-flag first token', () => {
    expect(rewriteArgv(['typo'], KNOWN_COMMANDS)).toEqual(['render', 'typo']);
  });

  it('leaves known subcommands untouched', () => {
    expect(rewriteArgv(['render', 'x.json'], KNOWN_COMMANDS)).toEqual(['render', 'x.json']);
    expect(rewriteArgv(['init', 'foo'], KNOWN_COMMANDS)).toEqual(['init', 'foo']);
    expect(rewriteArgv(['diagnose'], KNOWN_COMMANDS)).toEqual(['diagnose']);
    expect(rewriteArgv(['validate', 'x.json'], KNOWN_COMMANDS)).toEqual(['validate', 'x.json']);
    expect(rewriteArgv(['samples', 'list'], KNOWN_COMMANDS)).toEqual(['samples', 'list']);
  });

  it('leaves flags and empty argv untouched', () => {
    expect(rewriteArgv(['--help'], KNOWN_COMMANDS)).toEqual(['--help']);
    expect(rewriteArgv(['-v'], KNOWN_COMMANDS)).toEqual(['-v']);
    expect(rewriteArgv([], KNOWN_COMMANDS)).toEqual([]);
  });
});
