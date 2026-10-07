// Renders a style analysis as text: a Markdown style guide (the CLI's `--out`, the MCP tool's text
// content) and a compact block of binding rules for an LLM system prompt.

import type { StyleAnalysis } from './types';

export const STYLE_SCOPE_NOTE =
  'Derived from the reference’s palette, texture and pacing only. Subjects, logos, text and framing are never copied.';

function percent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

function paletteTable(analysis: StyleAnalysis): string[] {
  const rows = analysis.styleGuide.palette.map(
    (entry) =>
      `| \`${entry.hex}\` | ${entry.roles.length > 0 ? entry.roles.join(', ') : '—'} | ${percent(entry.share)} |`
  );

  return ['| Colour | Roles | Area |', '| --- | --- | --- |', ...rows];
}

function rolesTable(analysis: StyleAnalysis): string[] {
  const rows = Object.entries(analysis.styleGuide.roles).map(
    ([name, role]) => `| \`$color.${name}\` | \`${role.hex}\` | ${role.source} |`
  );

  return ['| Token | Colour | Source |', '| --- | --- | --- |', ...rows];
}

function wcagLabel(aa: boolean, aaLarge: boolean): string {
  if (aa) return 'AA';

  return aaLarge ? 'AA large' : 'fail';
}

function contrastTable(analysis: StyleAnalysis): string[] {
  const rows = analysis.styleGuide.contrast.map((c) => `| ${c.pair} | ${c.ratio}:1 | ${wcagLabel(c.aa, c.aaLarge)} |`);

  return ['| Pair | Ratio | WCAG |', '| --- | --- | --- |', ...rows];
}

function rhythmLines(analysis: StyleAnalysis): string[] {
  const { pacing, motion, texture, genre } = analysis.styleGuide;
  const lines = [
    `- Texture: ${texture.look === 'grain' ? `grain (global.grade.grain ≈ ${texture.grain})` : 'clean, no grain'} (noise ${texture.noise})`,
  ];

  if (pacing) {
    lines.push(
      `- Pacing: average shot ${pacing.avgShot} s, ${pacing.cutsPerMinute} cuts per minute (${pacing.cuts} cuts)`
    );
  }

  if (motion) lines.push(`- Motion energy: ${motion.energy} (0 still, 1 constant motion)`);

  if (genre) lines.push(`- Suggested genre: ${genre}`);

  return lines;
}

function bullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

/** A Markdown style guide with the theme JSON snippet at the end. */
export function styleGuideMarkdown(analysis: StyleAnalysis, title = 'Style guide'): string {
  const guide = analysis.styleGuide;

  return [
    `# ${title}`,
    '',
    `> ${STYLE_SCOPE_NOTE}`,
    '',
    `Source: ${guide.source.kind}, ${guide.source.frames} frame${guide.source.frames === 1 ? '' : 's'}. Confidence ${analysis.confidence}.`,
    '',
    '## Palette',
    '',
    ...paletteTable(analysis),
    '',
    '## Theme roles',
    '',
    ...rolesTable(analysis),
    '',
    '## Contrast',
    '',
    ...contrastTable(analysis),
    '',
    '## Texture and rhythm',
    '',
    ...rhythmLines(analysis),
    '',
    '## Keep',
    '',
    ...bullets(guide.rules.keep),
    '',
    '## Avoid',
    '',
    ...bullets(guide.rules.avoid),
    '',
    '## Suggestions',
    '',
    ...bullets(guide.suggestions),
    '',
    '## Theme',
    '',
    '```json',
    JSON.stringify({ global: { theme: analysis.theme } }, null, 2),
    '```',
    '',
  ].join('\n');
}

/** Binding visual rules for a generation prompt: the theme to set plus keep / avoid lists. */
export function styleGuidePromptRules(analysis: StyleAnalysis): string {
  const { rules, genre, texture } = analysis.styleGuide;

  return [
    `Set global.theme to exactly: ${JSON.stringify(analysis.theme)}`,
    'Use $color.<role> tokens for every colour instead of literal hex values.',
    ...(texture.look === 'grain' ? [`Set global.grade.grain to ${texture.grain}.`] : []),
    ...(genre ? [`Direct it as the "${genre}" genre.`] : []),
    'Keep:',
    ...bullets(rules.keep),
    'Avoid:',
    ...bullets(rules.avoid),
  ].join('\n');
}
