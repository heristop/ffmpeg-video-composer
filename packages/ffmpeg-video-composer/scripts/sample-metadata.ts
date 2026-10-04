import { PROMO_EFFECT_ID, PROMO_EFFECT_VERSION } from '../../leclap-mcp/src/effects/promo-registry';
import { TITLE_EFFECT_ID, TITLE_EFFECT_VERSION } from '../../leclap-mcp/src/effects/title-definition';
import { sampleFontAssets } from './sample-font-assets';
import { findFont } from '../src/core/fonts';
import type { Section, TemplateDescriptor } from '../src/schemas/template.schemas';
import type {
  SampleAsset,
  SampleEffect,
  SampleFormField,
  SampleProjectVideo,
  SampleRequirements,
  SampleVariable,
} from '../src/samples/types';

const builtInEffects = new Set([
  `${TITLE_EFFECT_ID}@${TITLE_EFFECT_VERSION}`,
  `${PROMO_EFFECT_ID}@${PROMO_EFFECT_VERSION}`,
]);
const runtimeVariables = new Set(['transitionDuration', 'transitionStartTime']);
type Content = Pick<TemplateDescriptor, 'global' | 'sections'>;

function walk(
  node: unknown,
  visit: (value: string, path: string, key: string, parent: Record<string, unknown>) => void,
  path = ''
): void {
  if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) walk(value, visit, `${path}[${index}]`);

    return;
  }

  if (node === null || typeof node !== 'object') return;
  const parent = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(parent)) {
    const location = path ? `${path}.${key}` : key;

    if (typeof value === 'string') {
      visit(value, location, key, parent);
      continue;
    }
    walk(value, visit, location);
  }
}

function tokens(value: string): Array<{ token: string; name: string }> {
  return Array.from(value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}|(?<!\{)\{([A-Za-z_][\w.-]*)\}(?!\})/g), (match) => ({
    token: match[0],
    name: (match[1] || match[2]).trim(),
  }));
}

function projectVideos(sections: Section[]): SampleProjectVideo[] {
  return sections
    .filter((section) => section.type === 'project_video')
    .map((section) => {
      const options = section.options ?? {};

      return {
        name: section.name,
        duration: options.duration,
        title: section.title,
        description: section.description,
        captureMode: options.captureMode,
        allowedCaptureModes: options.allowedCaptureModes,
        framingGuide: options.framingGuide,
        forceAspectRatio: options.forceAspectRatio,
        forceOriginalAspectRatio: options.forceOriginalAspectRatio,
        speed: options.speed,
        muteSection: options.muteSection,
      };
    });
}

function formFields(content: Content): SampleFormField[] {
  return (content.sections ?? []).flatMap((section) => {
    if (section.type !== 'form') return [];

    return (section.options?.fields ?? []).map((field) => ({
      section: section.name,
      ...field,
      default: content.global?.variables?.[field.name],
    }));
  });
}

function effects(sections: Section[]): SampleEffect[] {
  const result: SampleEffect[] = [];

  for (const section of sections) {
    if (section.type !== 'effect') continue;
    const { id, version } = section.effect;
    const existing = result.find((effect) => effect.id === id && effect.version === version);

    if (existing) {
      existing.sections.push(section.name);
      continue;
    }
    result.push({ id, version, sections: [section.name], customCatalog: !builtInEffects.has(`${id}@${version}`) });
  }

  return result;
}

function variableSource(name: string, fields: Set<string>): SampleVariable['source'] {
  if (fields.has(name)) return 'form';

  if (runtimeVariables.has(name) || /^color\d+$/.test(name)) return 'runtime';

  return 'placeholder';
}

function variables(content: Content, fields: SampleFormField[]): SampleVariable[] {
  const names = new Set(fields.map(({ name }) => name));
  const result = new Map<string, SampleVariable>(
    Object.entries(content.global?.variables ?? {}).map(([name, value]) => [
      name,
      { name, default: value, placeholders: [], source: names.has(name) ? 'form' : 'global' },
    ])
  );
  walk(content, (value) => {
    for (const { name, token } of tokens(value)) {
      const variable = result.get(name) ?? { name, placeholders: [], source: variableSource(name, names) };

      if (!variable.placeholders.includes(token)) variable.placeholders.push(token);
      result.set(name, variable);
    }
  });

  return [...result.values()];
}

function urlKind(value: string, path: string, parent: Record<string, unknown>): SampleAsset['kind'] {
  if (path.includes('.music.')) return 'music';

  if (path.includes('.watermark.') || parent.type === 'image' || /\.(?:png|jpe?g)$/i.test(value)) return 'image';

  return 'animation';
}

function assetKind(
  value: string,
  path: string,
  key: string,
  parent: Record<string, unknown>
): SampleAsset['kind'] | undefined {
  if (path.includes('.effect.assets.')) return 'effect-asset';

  if (key === 'font' && findFont(value)) return undefined;

  if (key === 'fontfile' || key === 'font') return 'font';

  if (key === 'videoUrl') return 'video';

  if (['pictureUrl', 'backgroundUrl', 'logoUrl'].includes(key)) return 'image';

  if (key === 'url') return urlKind(value, path, parent);

  if (
    path.startsWith('global.variables.') &&
    /\.(?:ttf|otf|mp4|webm|mp3|wav|png|jpe?g|webp|apng|gif|cube)$/i.test(value)
  ) {
    return /\.(?:ttf|otf)$/i.test(value) ? 'font' : 'asset';
  }

  return undefined;
}

function assets(content: Content): SampleAsset[] {
  const result: SampleAsset[] = [];
  walk(content, (reference, path, key, parent) => {
    const matches = tokens(reference);
    const defaultValue =
      matches.length === 1 && matches[0].token === reference ? content.global?.variables?.[matches[0].name] : undefined;
    const resolved = typeof defaultValue === 'string' ? defaultValue : reference;
    const kind = assetKind(resolved, path, key, parent);
    // Inline generated panels/data URLs are self-contained, not external media requirements.
    if (!kind || resolved.startsWith('panel:') || resolved.startsWith('data:')) return;
    result.push({ kind, reference, path, default: defaultValue });
  });
  const global = content.global;

  if (global?.musicEnabled !== false && global?.music && !global.music.url) {
    result.push({ kind: 'music', reference: global.music.name, path: 'global.music.name' });
  }

  return result;
}

function setup(requirements: Omit<SampleRequirements, 'setup'>): string[] {
  const result = [
    'Supply project_video clips by section name (userVideoPaths), customize form fields (fields) and global.variables, then validate the descriptor before rendering.',
  ];

  if (requirements.assets.length > 0) {
    result.push(
      'Preview media is not included. Supply or replace the listed authored asset references; relative references remain unchanged and must resolve in your configured assets/media directory.'
    );
  }

  if (requirements.assets.some((asset) => asset.source === 'preset')) {
    result.push(
      'Font assets marked source=preset are effective engine-resolved filenames from text presets and authored font overrides. Supply these font files; family-based font references also include their family, weight and style for resolution.'
    );
  }

  if (requirements.effects.length === 0) {
    result.push(
      'Render with an available FFmpeg backend: Node/system FFmpeg, browser/WASM, or the on-device engine. Provide the fonts and media used by the descriptor.'
    );

    return result;
  }
  result.push(
    'Registered effects require the trusted Node/Chromium Remotion worker. Enable MCP with --allow-remotion and configure --remotion-entry for the registered compositions; direct CLI effect rendering is not supported.'
  );
  const custom = requirements.effects.filter((effect) => effect.customCatalog);

  if (custom.length > 0) {
    result.push(
      `Register ${custom.map(({ id, version }) => `${id}@${version}`).join(', ')} in an operator-owned --effect-catalog. The showcase example uses examples/llm-remotion-title/effect-catalog.json with its matching Remotion entry; these repository files are not bundled.`
    );
  }
  result.push(
    'Provide effect assets under the configured --media-dir. Browser/native hosts must resolve effect sections to rendered clips before FFmpeg composition.'
  );

  return result;
}

/** Derive input requirements from validated, expanded sections without modifying the export descriptor. */
export function sampleRequirements(template: TemplateDescriptor): SampleRequirements {
  const content = { global: template.global, sections: template.sections };
  const fields = formFields(content);
  const requirements = {
    projectVideos: projectVideos(template.sections ?? []),
    formFields: fields,
    variables: variables(content, fields),
    assets: [...assets(content), ...sampleFontAssets(template)],
    effects: effects(template.sections ?? []),
  };

  return { ...requirements, setup: setup(requirements) };
}
