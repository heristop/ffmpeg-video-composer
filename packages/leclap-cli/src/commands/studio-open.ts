import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { defineCommand } from 'citty';
import { createBuilderLink, TemplateLinkError, type BuilderLink } from 'ffmpeg-video-composer';
import { fail, hint, step, success } from '../ui.js';

// `leclap studio <template> [--open] [--base <url>]`: a link that opens the template in the web builder.
// The template rides compressed in the URL fragment (#t=…), which browsers never send to a server, so
// handing it to a person uploads nothing. `--open` starts the platform's opener; no browser dependency.

function linkFailure(error: unknown): Error {
  if (!(error instanceof TemplateLinkError)) return error instanceof Error ? error : new Error(String(error));

  const issues = error.issues.slice(0, 10).map((issue) => `\n  ${issue}`);

  return new Error(`${error.code}: ${error.message}${issues.join('')}`);
}

/** The builder link for the template at `file`; throws a readable error for a missing, non-JSON or invalid file. */
export async function studioLink(file: string, options: { base?: string } = {}): Promise<BuilderLink> {
  const text = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    throw new Error(`cannot read ${file}: ${error.code ?? error.message}`);
  });
  let template: unknown;

  try {
    template = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not JSON`);
  }

  try {
    return await createBuilderLink(template, { baseUrl: options.base });
  } catch (error) {
    throw linkFailure(error);
  }
}

/** The link, then what the author should know: media to re-bind and size or effect warnings. */
export function formatStudioLink(link: BuilderLink): string[] {
  const lines = [link.url, ''];

  lines.push(success(`Open it in a browser to edit the template (${String(link.length)} characters).`));
  lines.push(hint('The template is in the #fragment, which the browser never sends to a server.'));

  for (const warning of link.warnings) lines.push(step(warning));

  return lines;
}

export interface Opener {
  command: string;
  args: string[];
}

/** The platform's "open this URL" command; the URL is one argv entry, never parsed by a shell. */
export function browserOpener(platform: NodeJS.Platform, url: string): Opener {
  if (platform === 'darwin') return { command: 'open', args: [url] };

  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };

  return { command: 'xdg-open', args: [url] };
}

interface SpawnedChild {
  unref: () => void;
  once: (event: 'spawn' | 'error', handler: (error: Error) => void) => unknown;
}

type Spawn = (command: string, args: string[], options: { detached: true; stdio: 'ignore' }) => SpawnedChild;

/** Starts the browser on `url`, detached; resolves false (never throws) when the opener cannot start. */
export function openInBrowser(
  url: string,
  options: { platform?: NodeJS.Platform; spawn?: Spawn } = {}
): Promise<boolean> {
  const { command, args } = browserOpener(options.platform ?? process.platform, url);
  const spawn = options.spawn ?? nodeSpawn;

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
      child.once('error', () => {
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

async function runStudioOpen(args: { template: string; open?: boolean; base?: string; json?: boolean }) {
  const link = await studioLink(args.template, { base: args.base });

  console.log(args.json ? JSON.stringify(link) : formatStudioLink(link).join('\n'));

  if (!args.open) return;

  if (!(await openInBrowser(link.url))) {
    console.error(fail('Could not start a browser here; copy the link above into one.'));
  }
}

export const studioOpen = defineCommand({
  meta: { name: 'open', description: 'Print a link that opens a template in the web builder (nothing is uploaded)' },
  args: {
    template: { type: 'positional', description: 'Path to a template JSON file', required: true },
    open: { type: 'boolean', description: 'Open the link in the default browser', default: false },
    base: { type: 'string', description: 'Builder base URL (default https://leclap.dev; e.g. http://localhost:5173)' },
    json: { type: 'boolean', description: 'Print { url, length, mediaToRebind, warnings } as JSON', default: false },
  },
  async run({ args }) {
    try {
      await runStudioOpen(args);
    } catch (error) {
      console.error(fail((error as Error).message));
      process.exit(1);
    }
  },
});
