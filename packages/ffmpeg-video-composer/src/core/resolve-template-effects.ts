import { TemplateValidator } from '../services/TemplateValidator';
import type { EffectReference, EffectSection, TemplateDescriptor } from '../schemas/template.schemas';
import type { JsonValue } from '../schemas/effect-reference.schema';

export interface EffectRenderResult {
  path: string;
  /** Actual rendered duration in seconds; must match the authored duration within 1e-6 seconds. */
  metadata: { duration: number; [key: string]: JsonValue };
  provenance?: JsonValue;
}

export type EffectRenderer = (
  section: EffectSection,
  descriptor: TemplateDescriptor
) => EffectRenderResult | Promise<EffectRenderResult>;

export interface ResolveTemplateEffectsOptions {
  /** Called for every effect before any rendering (catalog/version/props/assets/backend checks). */
  preflight?: (section: EffectSection, descriptor: TemplateDescriptor) => void | Promise<void>;
}

export interface ResolvedEffectProvenance extends EffectRenderResult {
  effect: EffectReference;
}

export interface ResolvedTemplateEffects {
  descriptor: TemplateDescriptor;
  userVideoPaths: Record<string, string>;
  provenance: Record<string, ResolvedEffectProvenance>;
}

const VISUAL_TYPES = new Set(['video', 'project_video', 'color_background', 'image_background', 'effect']);

function validatedDescriptor(template: unknown): TemplateDescriptor {
  const validator = new TemplateValidator();
  const validation = validator.validateTemplate(template);

  if (!validation.success) throw new Error(validator.getValidationSummary(validation));

  return validation.data as TemplateDescriptor;
}

function collectEffects(descriptor: TemplateDescriptor): EffectSection[] {
  const names = new Set<string>();
  const effects: EffectSection[] = [];

  for (const section of descriptor.sections ?? []) {
    if (section.type === 'partial') {
      throw new Error('effect_partial_unresolved: nested partial sections must be expanded before resolving effects');
    }

    if (VISUAL_TYPES.has(section.type)) {
      if (names.has(section.name)) throw new Error(`duplicate_visual_section_name: "${section.name}"`);
      names.add(section.name);
    }

    if (section.type === 'effect') effects.push(section);
  }

  return effects;
}

function validateRenderResult(result: unknown, section: EffectSection): asserts result is EffectRenderResult {
  const rendered = result as Partial<EffectRenderResult> | undefined;

  if (!rendered || typeof rendered.path !== 'string' || !rendered.path.trim()) {
    throw new Error(`effect_render_invalid_path: section "${section.name}"`);
  }

  const duration = rendered.metadata?.duration;

  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    Math.abs(duration - section.options.duration) > 1e-6
  ) {
    throw new Error(`effect_render_duration_mismatch: section "${section.name}" requires ${section.options.duration}s`);
  }
}

/** Expand and validate an authoring template, then lower effects to ordinary project_video clips. */
export async function resolveTemplateEffects(
  template: unknown,
  renderer: EffectRenderer,
  options: ResolveTemplateEffectsOptions = {}
): Promise<ResolvedTemplateEffects> {
  const descriptor = validatedDescriptor(template);
  const effects = collectEffects(descriptor);
  await Promise.all(
    effects.map(async (section) => options.preflight?.(structuredClone(section), structuredClone(descriptor)))
  );
  const userVideoPaths: Record<string, string> = Object.create(null);
  const provenance: Record<string, ResolvedEffectProvenance> = Object.create(null);

  // Renderers may wrap a single native/WASM engine, so chain rendering sequentially.
  await effects.reduce(async (previous, section) => {
    await previous;
    const result = await renderer(structuredClone(section), structuredClone(descriptor));
    validateRenderResult(result, section);
    userVideoPaths[section.name] = result.path;
    provenance[section.name] = { ...result, effect: section.effect };
  }, Promise.resolve());

  const resolvedSections = (descriptor.sections ?? []).map((section) => {
    if (section.type !== 'effect') return section;
    const { effect: _effect, ...clipSection } = section;

    return { ...clipSection, type: 'project_video' as const };
  });

  return { descriptor: { ...descriptor, sections: resolvedSections }, userVideoPaths, provenance };
}
