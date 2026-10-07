// `leclap style <image|clip>`: derive a theme and a style guide from a reference's palette, texture and
// pacing. Prints a summary and the `global.theme` snippet; `--out` writes the Markdown style guide plus a
// `.theme.json` beside it; `--json` emits the whole analysis. Subjects and logos are never copied.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import { analyzeStyleFile, styleGuideMarkdown, STYLE_SCOPE_NOTE, type StyleAnalysis } from 'ffmpeg-video-composer';
import { wordmark } from '../theme.js';
import { fail, heading, hint, step, success } from '../ui.js';

/** The theme JSON written next to a style guide: `style-guide.md` → `style-guide.theme.json`. */
export function themeSnippetPath(out: string): string {
  const parsed = path.parse(out);

  return path.join(parsed.dir, `${parsed.name}.theme.json`);
}

export function themeSnippet(analysis: StyleAnalysis): string {
  return `${JSON.stringify({ global: { theme: analysis.theme } }, null, 2)}\n`;
}

function swatch(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);

  return pc.isColorSupported ? `\u001B[48;2;${r};${g};${b}m    \u001B[0m` : '';
}

/** Pure: the terminal summary of an analysis (roles, contrast, rhythm, theme snippet). */
export function formatStyleSummary(analysis: StyleAnalysis): string[] {
  const guide = analysis.styleGuide;
  const roles = Object.entries(guide.roles).map(([name, role]) =>
    step(`${swatch(role.hex)} ${name.padEnd(8)} ${role.hex} ${pc.dim(role.source)}`)
  );
  const fgBg = guide.contrast.find((c) => c.pair === 'fg/bg');
  const rhythm = guide.pacing
    ? [
        step(
          `pacing: ${guide.pacing.avgShot} s shots, ${guide.pacing.cutsPerMinute} cuts/min, energy ${guide.motion?.energy}`
        ),
      ]
    : [];

  return [
    heading(`Style from ${guide.source.kind} (${guide.source.frames} frames, confidence ${analysis.confidence})`),
    ...roles,
    step(`contrast fg/bg ${fgBg?.ratio}:1${fgBg?.aa ? ' (AA)' : ''}`),
    step(`texture: ${guide.texture.look === 'grain' ? `grain ≈ ${guide.texture.grain}` : 'clean'}`),
    ...rhythm,
    ...(guide.genre ? [step(`genre: ${guide.genre}`)] : []),
    '',
    themeSnippet(analysis).trimEnd(),
    hint(STYLE_SCOPE_NOTE),
  ];
}

/** Writes the Markdown style guide to `out` and the theme JSON beside it; returns both paths. */
export async function writeStyleGuide(
  analysis: StyleAnalysis,
  out: string,
  title: string
): Promise<{ markdown: string; theme: string }> {
  const theme = themeSnippetPath(out);
  await writeFile(out, styleGuideMarkdown(analysis, title));
  await writeFile(theme, themeSnippet(analysis));

  return { markdown: out, theme };
}

export const style = defineCommand({
  meta: { name: 'style', description: 'Derive a theme and style guide from a reference image or clip' },
  args: {
    reference: { type: 'positional', description: 'Reference image or clip', required: true },
    json: { type: 'boolean', description: 'Emit the full analysis as JSON', default: false },
    out: { type: 'string', alias: 'o', description: 'Write a Markdown style guide (and <name>.theme.json beside it)' },
    seed: { type: 'string', description: 'Palette seed (default fixed): same reference + seed = same theme' },
  },
  async run({ args }) {
    try {
      const reference = path.resolve(args.reference);

      if (!existsSync(reference)) throw new Error(`Reference not found: ${args.reference}`);

      const seed = args.seed === undefined ? undefined : Number(args.seed);
      const analysis = await analyzeStyleFile(reference, Number.isFinite(seed) ? { seed } : {});

      process.stdout.write(
        args.json
          ? `${JSON.stringify(analysis, null, 2)}\n`
          : `${wordmark()}${formatStyleSummary(analysis).join('\n')}\n`
      );

      if (args.out) {
        const written = await writeStyleGuide(analysis, args.out, `Style guide: ${path.basename(reference)}`);
        console.error(success(`Wrote ${written.markdown} and ${written.theme}`));
      }
    } catch (error) {
      console.error(fail(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
