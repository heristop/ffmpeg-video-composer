import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { listEffectDefinitions } from '../src/effects/effect-catalog.js';
import { parseCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';

export const EFFECT_DOCS_MARKER = '<!-- generated-effect-contracts -->';

const cell = (value: unknown): string =>
  String(value)
    .replaceAll('|', String.raw`\|`)
    .replaceAll('\n', ' ');

const propDescriptions = new Map(
  Object.entries({
    headline: 'Primary headline copy.',
    headlineY: 'Top of the headline container in output pixels.',
    logoDelayFrames: 'Scene-local frame when the logo spring entrance starts.',
    entranceDurationFrames: 'Entrance window in frames at 30 fps.',
    springDamping: 'Spring damping; larger values reduce oscillation.',
    brand: 'Brand name displayed in the composition.',
    eyebrow: 'Short opening label above the headline.',
    subheadline: 'Supporting opening copy.',
    cta: 'Final invitation copy.',
    displayUrl: 'Display text only; no URL fetch.',
    features: 'Exactly three feature labels; each trimmed and non-empty.',
    accent: 'Accent color or named palette, according to the choices below.',
    backgroundColor: 'Canvas background as six-digit hex.',
    textColor: 'Foreground text as six-digit hex.',
    showcaseStartFrame: 'Scene-local frame when the product showcase begins.',
    ctaStartFrame: 'Scene-local frame when the closing invitation begins.',
    cameraZoom: 'Camera zoom multiplier during the showcase.',
    cameraTiltDegrees: 'Camera tilt angle in degrees.',
    kicker: 'Short editorial label; an empty string is allowed.',
    mode: 'Typography choreography mode.',
    staggerFrames: 'Frame delay between consecutive word entrances.',
    travelPx: 'Word travel distance in output pixels.',
    highlightWord: 'Zero-based highlighted item index; clamped to the last rendered item.',
  })
);

type PropNode = z.core.JSONSchema.JSONSchema;

function propConstraints(node: PropNode): string {
  const constraints: string[] = [];

  if (node.enum) constraints.push(`one of ${JSON.stringify(node.enum)}`);
  const bounds = {
    minimum: '≥',
    maximum: '≤',
    minLength: 'length ≥',
    maxLength: 'length ≤',
    minItems: 'items ≥',
    maxItems: 'items ≤',
  };

  for (const [key, label] of Object.entries(bounds)) {
    const value = node[key];

    if (typeof value === 'number') constraints.push(`${label} ${value}`);
  }

  if (node.pattern) constraints.push(`pattern ${node.pattern}`);

  if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    if (node.items.minLength !== undefined) constraints.push(`item length ≥ ${node.items.minLength}`);

    if (node.items.maxLength !== undefined) constraints.push(`item length ≤ ${node.items.maxLength}`);
  }

  return constraints.join('; ') || '—';
}

export function effectContractMarkdown(catalog: unknown): string {
  const definitions = listEffectDefinitions(parseCustomEffectCatalog(catalog));
  const builtinIds = new Set(listEffectDefinitions().map((definition) => definition.id));

  return (
    definitions
      .map((definition) => {
        const schema = z.toJSONSchema(definition.props, { io: 'input' });
        const required = new Set(schema.required ?? []);
        const rows = Object.entries(schema.properties ?? {}).map(([name, node]) => {
          if (typeof node === 'boolean') throw new Error(`Unexpected boolean prop schema: ${name}`);

          return `| \`${name}\` | ${cell(node.type)} | ${required.has(name) ? 'yes' : 'no'} | ${cell(propConstraints(node))} | ${cell(node.default === undefined ? '—' : JSON.stringify(node.default))} | ${cell(node.description ?? propDescriptions.get(name) ?? '—')} |`;
        });
        const requiredAssets = new Set(z.toJSONSchema(definition.assets, { io: 'input' }).required ?? []);
        const policies = new Map(Object.entries(definition.assetVideoPolicies));
        const assets = Object.entries(definition.assetExtensions).map(
          ([name, extensions]) =>
            `| \`${name}\` | ${requiredAssets.has(name) ? 'yes' : 'no'} | ${extensions.join(', ')} | ${policies.get(name)?.minVideoDurationSeconds ?? '—'} |`
        );

        return [
          `## ${definition.id}@${definition.version}`,
          builtinIds.has(definition.id)
            ? 'Built-in MCP contract. The operator must still supply a trusted Remotion entry registering the composition.'
            : 'Example operator catalog contract. Enable the example catalog as well as the trusted Remotion entry; this effect is not registered by default.',
          `Composition: \`${definition.compositionId}\`. ${definition.description ?? ''}`.trim(),
          '### Props',
          '| Prop | Type | Required on input | Bounds / choices | Default | Description |',
          '| --- | --- | --- | --- | --- | --- |',
          ...rows,
          'Defaults apply to omitted props. Unknown props and assets are rejected.',
          '### Assets',
          assets.length > 0
            ? '| Slot | Required | Extensions | Minimum video seconds |\n| --- | --- | --- | --- |\n' +
              assets.join('\n')
            : 'Asset-free: set `assets` to `{}`.',
          '### Cross-field and runtime rules',
          definition.timing,
          definition.assetRestrictions,
          `Output: ${definition.output.width}×${definition.output.height}, ${definition.output.fps} fps, ${definition.output.durationInFrames} frames (${definition.output.durationSeconds} seconds), opaque H.264.`,
        ]
          .join('\n\n')
          .replace(/\n\n(?=\|)/g, '\n');
      })
      .join('\n\n') + '\n'
  );
}

export function effectDocumentation(current: string, catalog: unknown): string {
  if (!current.includes(EFFECT_DOCS_MARKER)) throw new Error('Missing effect documentation marker.');
  const source = current.split(EFFECT_DOCS_MARKER)[0] + EFFECT_DOCS_MARKER + '\n\n' + effectContractMarkdown(catalog);

  return execFileSync('pnpm', ['exec', 'vp', 'fmt', '--stdin-filepath', 'docs/effects-configuration.md'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    input: source,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
