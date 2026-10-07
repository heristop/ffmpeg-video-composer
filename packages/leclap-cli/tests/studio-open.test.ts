import 'reflect-metadata';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeTemplatePayload, readTemplateLinkPayload } from 'ffmpeg-video-composer';
import { KNOWN_COMMANDS, rewriteArgv, STUDIO_OPEN_VALUE_FLAGS } from '../src/args';
import { browserOpener, formatStudioLink, openInBrowser, studioLink, studioOpen } from '../src/commands/studio-open';

const BUNDLED = path.resolve(import.meta.dirname, '../../leclap-creative-kit/src/templates/web-app-promo.json');

describe('studio link', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'leclap-studio-open-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('turns a bundled template into a builder link that decodes back to it', async () => {
    const link = await studioLink(BUNDLED);

    expect(link.url.startsWith('https://leclap.dev/studio/builder#t=v1.')).toBe(true);
    expect(link.mediaToRebind).toEqual([]);

    const payload = readTemplateLinkPayload(new URL(link.url).hash) ?? '';

    expect(await decodeTemplatePayload(payload)).toEqual(JSON.parse(readFileSync(BUNDLED, 'utf8')));
  });

  it('uses the base URL override and lists local media to re-bind', async () => {
    const file = path.join(dir, 'template.json');
    writeFileSync(
      file,
      JSON.stringify({
        sections: [{ name: 'clip', type: 'video', options: { videoUrl: path.join(dir, 'take.mp4') } }],
      })
    );

    const link = await studioLink(file, { base: 'http://localhost:5173' });
    const text = formatStudioLink(link).join('\n');

    expect(link.url.startsWith('http://localhost:5173/studio/builder#t=v1.')).toBe(true);
    expect(text).toContain(link.url);
    expect(text).toContain('take.mp4');
    expect(text).toMatch(/http:\/\/localhost:5173, not https:\/\/leclap\.dev/);
  });

  it('fails clearly on unreadable, non-JSON or invalid templates', async () => {
    const notJson = path.join(dir, 'broken.json');
    const invalid = path.join(dir, 'invalid.json');
    writeFileSync(notJson, '{nope');
    writeFileSync(invalid, JSON.stringify({ sections: 'nope' }));

    await expect(studioLink(path.join(dir, 'missing.json'))).rejects.toThrow(/missing\.json/);
    await expect(studioLink(notJson)).rejects.toThrow(/not JSON/);
    await expect(studioLink(invalid)).rejects.toThrow(/invalid_template/);
  });
});

describe('browser opener', () => {
  it('uses the platform opener with the URL as one argument', () => {
    const url = 'https://leclap.dev/studio/builder#t=v1.abc';

    expect(browserOpener('darwin', url)).toEqual({ command: 'open', args: [url] });
    expect(browserOpener('linux', url)).toEqual({ command: 'xdg-open', args: [url] });
    expect(browserOpener('win32', url)).toEqual({
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url],
    });
  });

  it('starts the opener detached and reports a spawn failure instead of crashing', async () => {
    const unref = vi.fn();
    const handlers: Record<string, (error: Error) => void> = {};
    const child = {
      unref,
      once: (event: string, handler: (error: Error) => void) => {
        handlers[event] = handler;

        return child;
      },
    };
    const spawn = vi.fn(() => child);
    const opened = openInBrowser('https://x.test/studio/builder#t=v1.a', { platform: 'darwin', spawn });

    handlers.spawn(new Error('unused'));

    await expect(opened).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith('open', ['https://x.test/studio/builder#t=v1.a'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(unref).toHaveBeenCalled();

    const failing = openInBrowser('https://x.test', { platform: 'linux', spawn });
    handlers.error(new Error('ENOENT'));

    await expect(failing).resolves.toBe(false);
  });
});

describe('studio routing', () => {
  it('routes `studio <template>` to `studio open`, leaving the gate commands alone', () => {
    expect(rewriteArgv(['studio', 'launch.json'], KNOWN_COMMANDS)).toEqual(['studio', 'open', 'launch.json']);
    expect(rewriteArgv(['studio', 'launch.json', '--open'], KNOWN_COMMANDS)).toEqual([
      'studio',
      'open',
      'launch.json',
      '--open',
    ]);
    expect(rewriteArgv(['studio', 'status'], KNOWN_COMMANDS)).toEqual(['studio', 'status']);
    expect(rewriteArgv(['studio', 'pass', 'rough-cut'], KNOWN_COMMANDS)).toEqual(['studio', 'pass', 'rough-cut']);
    expect(rewriteArgv(['studio', 'open', 'x.json'], KNOWN_COMMANDS)).toEqual(['studio', 'open', 'x.json']);
    expect(rewriteArgv(['studio', '--help'], KNOWN_COMMANDS)).toEqual(['studio', '--help']);
    expect(rewriteArgv(['studio'], KNOWN_COMMANDS)).toEqual(['studio']);
  });

  it('routes to `studio open` when flags come before the template', () => {
    expect(rewriteArgv(['studio', '--open', 't.json'], KNOWN_COMMANDS)).toEqual(['studio', 'open', '--open', 't.json']);
    expect(rewriteArgv(['studio', '--base', 'http://x', 't.json'], KNOWN_COMMANDS)).toEqual([
      'studio',
      'open',
      '--base',
      'http://x',
      't.json',
    ]);
    expect(rewriteArgv(['studio', '--base=http://x', '--json', 't.json'], KNOWN_COMMANDS)).toEqual([
      'studio',
      'open',
      '--base=http://x',
      '--json',
      't.json',
    ]);
    // A flag's value named like a subcommand is still the value.
    expect(rewriteArgv(['studio', '--base', 'status', 't.json'], KNOWN_COMMANDS)).toEqual([
      'studio',
      'open',
      '--base',
      'status',
      't.json',
    ]);
  });

  it('knows every `studio open` flag that takes a value', () => {
    const args = Object.entries(studioOpen.args ?? {}) as Array<[string, { type: string }]>;
    const valueFlags = args.filter(([, def]) => def.type === 'string').map(([name]) => name);

    expect([...STUDIO_OPEN_VALUE_FLAGS].toSorted()).toEqual(valueFlags.toSorted());
  });

  it('leaves real subcommands alone after leading flags', () => {
    expect(rewriteArgv(['studio', '--help', 'status'], KNOWN_COMMANDS)).toEqual(['studio', '--help', 'status']);
    expect(rewriteArgv(['studio', '--open'], KNOWN_COMMANDS)).toEqual(['studio', '--open']);
    expect(rewriteArgv(['studio', '--', 't.json'], KNOWN_COMMANDS)).toEqual(['studio', '--', 't.json']);
  });
});
