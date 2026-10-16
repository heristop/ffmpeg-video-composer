// `leclap brand <url>`: read a website's brand — name, colours, fonts, logo — into a kit, a global.theme
// and binding prompt rules, written to a folder the builder and agents can use. HTTPS and public hosts only.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from 'citty';
import {
  brandPromptRules,
  brandTheme,
  fetchBrandKit,
  saveBrandKit,
  type BrandKit,
  type BrandTheme,
} from 'ffmpeg-video-composer';
import { wordmark } from '../theme.js';
import { fail, heading, hint, step, success } from '../ui.js';

function logoLine(kit: BrandKit, logoError?: string): string {
  if (kit.logo?.file) return kit.logo.file;

  if (logoError) return `logo: not saved (${logoError})`;

  return kit.logo ? `${kit.logo.url} (not saved)` : 'none found';
}

export function formatBrandSummary(kit: BrandKit, brand: BrandTheme, logoError?: string): string[] {
  return [
    heading(`${kit.name ?? new URL(kit.url).hostname} · ${kit.url}`),
    ...Object.entries(brand.roles).map(([name, role]) => step(`${name.padEnd(8)} ${role.hex} ${role.source}`)),
    ...(['display', 'body', 'mono'] as const).map((role) =>
      step(`${role.padEnd(8)} ${kit.fonts[role] ?? '—'} → ${brand.theme.fonts?.[role] ?? '—'}`)
    ),
    step(`logo     ${logoLine(kit, logoError)}`),
  ];
}

export const brand = defineCommand({
  meta: { name: 'brand', description: "Read a website's brand (colours, fonts, logo) into a theme" },
  args: {
    url: { type: 'positional', description: 'https:// URL of the brand’s website', required: true },
    out: { type: 'string', alias: 'o', description: 'Folder to write the kit to', default: 'brand-kit' },
    json: { type: 'boolean', description: 'Emit the kit and theme as JSON', default: false },
  },
  async run({ args }) {
    try {
      const out = path.resolve(args.out);
      const saved = await saveBrandKit(await fetchBrandKit(args.url), out);
      const theme = brandTheme(saved.kit);
      const logoPath = saved.logo ? `/assets/brand/${path.basename(saved.logo)}` : undefined;

      await writeFile(
        path.join(out, 'brand.theme.json'),
        `${JSON.stringify({ global: { theme: theme.theme } }, null, 2)}\n`
      );
      await writeFile(path.join(out, 'brand-rules.txt'), `${brandPromptRules(saved.kit, theme, logoPath)}\n`);

      process.stdout.write(
        args.json
          ? `${JSON.stringify({ kit: saved.kit, theme: theme.theme, fontRefs: theme.fontRefs }, null, 2)}\n`
          : `${wordmark()}${formatBrandSummary(saved.kit, theme, saved.logoError).join('\n')}\n`
      );
      console.error(
        success(
          `Wrote ${args.out}/ (brand-kit.json, brand.theme.json, brand-rules.txt${saved.logo ? ', the logo' : ''})`
        )
      );
      console.error(
        hint('Import brand-kit.json in the builder’s Generate with AI, or give brand-rules.txt to your agent.')
      );
    } catch (error) {
      console.error(fail(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
