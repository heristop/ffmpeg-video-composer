import {
  TemplateValidator,
  summarizeErrors,
  type TemplateDescriptor,
  type ValidationError,
} from 'ffmpeg-video-composer';

// `errors` carries the structured findings (path, code, and — when the validator knows the fix — hint,
// suggestion and kind) whenever the failure came from the validator itself.
export type ValidationResult =
  | { ok: true; descriptor: TemplateDescriptor }
  | { ok: false; message: string; errors?: ValidationError[] };

// Validate an untrusted, agent-supplied template object with the SAME TemplateValidator the engine's
// compile gate runs — the Zod schema plus the descriptor rules (section references, transitions,
// motion, global animations, watermark, fonts) — so validate_template can never bless a template
// that compile() would reject mid-render. The validator expands `{type:'partial'}` sections first
// and the descriptor returned here carries those REAL sections, which keeps a project_video living
// inside a partial visible to the clip-coverage checks.
// Check authored effect keys before core Zod records can strip __proto__.
function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}
const MAX_EFFECT_NODES = 20000;
const MAX_EFFECT_DEPTH = 64;
const EFFECT_BOUNDS_ERROR = 'effect_key_unsafe: effect JSON exceeds traversal bounds.';
export function unsafeEffectValue(values: unknown[]): string | undefined {
  const pending = values.map((value) => ({ value, depth: 0 }));
  let visited = 0;

  while (pending.length > 0) {
    const next = pending.pop();

    if (!next) break;

    if (++visited > MAX_EFFECT_NODES || next.depth > MAX_EFFECT_DEPTH) return EFFECT_BOUNDS_ERROR;
    const record = objectRecord(next.value);

    if (!record) continue;

    for (const key of Object.keys(record)) {
      if (key in Object.prototype || key === 'prototype') return `effect_key_unsafe: reserved effect key ${key}.`;
      pending.push({ value: record[key], depth: next.depth + 1 });
    }
  }

  return undefined;
}
type SectionGroup = { sections: unknown; depth: number };
function effectFields(section: unknown, depth: number, pending: SectionGroup[]): unknown[] {
  const record = objectRecord(section);

  if (record?.type === 'partial') pending.push({ sections: record.sections, depth: depth + 1 });

  if (record?.type !== 'effect') return [];
  const effect = objectRecord(record.effect);

  return [effect?.props, effect?.assets];
}
export function effectKeyError(raw: unknown): string | undefined {
  const template = objectRecord(raw);

  if (!template) return undefined;
  const partials = Array.isArray(template.partials) ? template.partials : [];

  if (partials.length > MAX_EFFECT_NODES) return EFFECT_BOUNDS_ERROR;
  const pending = [
    { sections: template.sections, depth: 0 },
    ...partials.map((partial) => ({ sections: objectRecord(partial)?.sections, depth: 0 })),
  ];
  const values: unknown[] = [];
  let visited = partials.length;

  while (pending.length > 0) {
    const next = pending.pop();

    if (!next) break;

    if (++visited > MAX_EFFECT_NODES || next.depth > MAX_EFFECT_DEPTH) return EFFECT_BOUNDS_ERROR;

    if (!Array.isArray(next.sections)) continue;

    for (const section of next.sections) {
      if (++visited > MAX_EFFECT_NODES) return EFFECT_BOUNDS_ERROR;
      values.push(...effectFields(section, next.depth, pending));
    }
  }

  return unsafeEffectValue(values);
}
export function validateTemplate(raw: unknown): ValidationResult {
  const keyError = effectKeyError(raw);

  if (keyError) return { ok: false, message: keyError };
  const validation = new TemplateValidator().validateTemplate(raw);

  if (!validation.success || !validation.data) {
    const errors = validation.errors ?? [];

    return { ok: false, message: summarizeErrors(errors), errors };
  }

  // The engine types `data` as `TemplateDescriptor | Section` because the same result shape also
  // serves validateSection; validateTemplate only ever yields a descriptor.
  return { ok: true, descriptor: validation.data as TemplateDescriptor };
}
