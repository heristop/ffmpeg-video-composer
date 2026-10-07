import fs from 'node:fs/promises';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import {
  invalidTemplateText,
  effectiveOrientation,
  geometryApproxNote,
  nodeGeometryWarnings,
  type GeometryWarning,
  type RenderedGeometry,
  type TemplateDescriptor,
  type TemplateDescriptorSchema,
  type ValidationError,
} from 'ffmpeg-video-composer';
import { z } from 'zod';

import { validateEffects, type EffectConfig } from '../effects/title-registry.js';
import { templateRevision } from '../effects/template-revision.js';
import type { McpConfig } from '../config.js';
import { assertDescriptorSafe } from '../compose/descriptorGuard.js';
import { runGeometryCheck } from '../compose/renderRunner.js';
import { validateTemplate } from '../compose/validation.js';
import { motionNote, motionWarnings, motionWarningsSchema } from './motionWarnings.js';
import { capabilityWarnings } from '../compose/capabilities.js';
import { featureNote, featureWarningsSchema } from './featureWarnings.js';

const inputSchema = z.object({
  template: z.record(z.string(), z.unknown()),
  render: z
    .boolean()
    .optional()
    .describe(
      'Also render the sections that hold text (twice, through FFmpeg) and measure its contrast from real ' +
        'pixels — settles text over images, grades and looks that the render-free check can only call ' +
        'unknown. Costs seconds, not milliseconds; default false.'
    ),
});

const outputSchema = z.object({
  valid: z.boolean(),
  revision: z.string(),
  capabilities: z.object({ effects: z.boolean(), backend: z.string(), geometry: z.string() }).optional(),
  sectionCount: z.number(),
  orientation: z.string().nullable(),
  requiredClips: z.array(z.string()),
  formFields: z.array(z.string()),
  // Present only when there is something to say. A clean template omits the field rather than
  // sending an empty array — the agent pays for every key it reads.
  geometry: z
    .array(z.string())
    .optional()
    .describe(
      'Text that would run off the frame or out of title-safe, collide with other text, sit under a band, ' +
        'be too small, lack contrast, or sit over footage with no box/outline/shadow — one line per finding ' +
        'saying what to change, present only when there is something to fix; check this before rendering.'
    ),
  motionWarnings: motionWarningsSchema,
  featureWarnings: featureWarningsSchema,
  // Present only on an invalid template (with isError): every finding at once, with fixes when known.
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
        code: z.string(),
        hint: z.string().optional(),
        suggestion: z.unknown().optional(),
        kind: z.enum(['format', 'judgement']).optional(),
      })
    )
    .optional()
    .describe(
      'Invalid template only: every finding. `suggestion` is a replacement value for `path` (a key name for ' +
        'unknown_key); kind "format" is safe to apply as-is, "judgement" changes creative content — ask first.'
    ),
  // Present only when `render: true` was asked for.
  render: z
    .object({ measured: z.number(), seconds: z.number(), unavailable: z.string().optional() })
    .optional()
    .describe('What the rendered check measured from pixels, or why it could not render.'),
});

type ValidateArgs = { template: Record<string, unknown>; render?: boolean };
type RenderSummary = { measured: number; seconds: number; unavailable?: string };
type RenderConfig = Pick<McpConfig, 'mediaDir' | 'outputDir' | 'renderTimeoutMs'> & EffectConfig;
type ToolError = {
  isError: true;
  content: [{ type: 'text'; text: string }];
  structuredContent?: { valid: false; errors: ValidationError[] };
};
type DescriptorResult = { ok: true; descriptor: TemplateDescriptor } | ToolError;

function errorResult(text: string): ToolError {
  return { isError: true, content: [{ type: 'text', text }] };
}

// Schema-validate the inline descriptor against the core schema.
function resolveDescriptor(args: ValidateArgs): DescriptorResult {
  const result = validateTemplate(args.template);

  if (!result.ok) {
    const text = invalidTemplateText(result);

    return result.errors
      ? { ...errorResult(text), structuredContent: { valid: false, errors: result.errors } }
      : errorResult(text);
  }

  return { ok: true, descriptor: result.descriptor };
}

// The clips compose_video will require (one per project_video section, keyed by section name).
function requiredClips(descriptor: TemplateDescriptor): string[] {
  return (descriptor.sections ?? [])
    .filter((section) => section.type === 'project_video' && typeof section.name === 'string')
    .map((section) => section.name as string);
}

// The form field names the template collects — what compose_video expects in `fields`.
function formFields(descriptor: TemplateDescriptor): string[] {
  return (descriptor.sections ?? [])
    .filter((section) => section.type === 'form')
    .flatMap((section) => section.options?.fields ?? [])
    .map((field) => field.name);
}

// `descriptor` reaches this function via `compose/validation.ts`'s `validateTemplate()`, which parses
// the raw input with `TemplateDescriptorSchema` and then casts that zod-shaped result to the public
// `TemplateDescriptor` (core/types) to satisfy its own return type. So at runtime the value was never
// actually the public interface shape — it is (and always was) the zod-inferred shape. This cast just
// names that reality so it type-checks here too. It is NOT the same cast as the one in validation.ts:
// that one goes the opposite direction and exists to satisfy `ValidationResult.data`'s type; this one
// undoes it. Safe because `getGeometryWarnings`'s consumers (collectGeometryWarnings, text-boxes.ts)
// only read fields off the object — they never re-parse it — so the zod type's extra optional fields
// (e.g. `partials`) are simply absent/inert, never a problem.
type GeometryDescriptor = z.infer<typeof TemplateDescriptorSchema>;

// One line per finding: path, message, and an `approx` marker when the measurement fell back to an
// estimate — no font metrics, or text carrying a {{ var }} that only resolves at render time.
// Returns undefined — not [] — when there is nothing to
// report, so the field disappears from the payload.
//
// `nodeGeometryWarnings` measures with real glyph advances (bundled fonts, else the catalog the
// renderer fetches from), caches font bytes for the life of this long-lived process, and degrades a
// throw to no findings — geometry is advisory and must never turn a valid template into an MCP error.
export async function geometryLines(descriptor: TemplateDescriptor): Promise<string[] | undefined> {
  return formatGeometry(await nodeGeometryWarnings(descriptor as unknown as GeometryDescriptor));
}

function formatGeometry(warnings: GeometryWarning[]): string[] | undefined {
  if (warnings.length === 0) {
    return undefined;
  }

  return warnings.map((w) => `${w.path}: ${w.message}${geometryApproxNote(w)}`);
}

// The rendered check runs in compose_video's render worker, under its timeout and cancellation: the
// engine's container is process-wide, and a render that hangs or crashes must take down a worker, not
// this server. A worker that times out, dies or cannot fork is no verdict on the template, so it
// degrades to the render-free findings with the reason — never a thrown MCP error.
async function renderInWorker(
  authored: TemplateDescriptor,
  config: RenderConfig,
  signal: AbortSignal | undefined
): Promise<RenderedGeometry> {
  const job = {
    kind: 'geometry' as const,
    descriptor: authored as unknown as GeometryDescriptor,
    options: { assetsDir: config.mediaDir, workDir: config.outputDir },
  };
  const result = await runGeometryCheck(job, { timeoutMs: config.renderTimeoutMs, signal }).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (result.ok) {
    return result.geometry;
  }

  const warnings = await nodeGeometryWarnings(job.descriptor);

  return { warnings, measured: 0, unavailable: `rendered check failed: ${result.error}` };
}

// `render: true`: the static findings refined by a real render. It renders what compose_video would, so
// it passes the same sandbox first — a descriptor compose_video would refuse is not rendered here
// either — and reads assets from the media dir, as a compose does. Advisory: nothing here errors.
async function renderedGeometry(
  descriptor: TemplateDescriptor,
  authored: TemplateDescriptor,
  config: RenderConfig,
  signal: AbortSignal | undefined
): Promise<{ geometry: string[] | undefined; render: RenderSummary }> {
  const started = performance.now();
  const safety = await assertDescriptorSafe(descriptor, config.mediaDir);

  if (!safety.ok) {
    const geometry = await geometryLines(authored);

    return { geometry, render: { measured: 0, seconds: 0, unavailable: `not rendered: ${safety.message}` } };
  }

  await fs.mkdir(config.outputDir, { recursive: true });

  const rendered = await renderInWorker(authored, config, signal);
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const summary = { measured: rendered.measured, seconds };

  return {
    geometry: formatGeometry(rendered.warnings),
    render: rendered.unavailable ? { ...summary, unavailable: rendered.unavailable } : summary,
  };
}

function renderNote(render: RenderSummary | undefined): string {
  if (!render) {
    return '';
  }

  return render.unavailable
    ? ` Rendered check skipped — ${render.unavailable}.`
    : ` Rendered check measured ${render.measured} text(s) from pixels in ${render.seconds}s.`;
}

// `authored` is the descriptor exactly as the caller sent it. `descriptor` has already had its
// `{ type: "partial", ref }` sections expanded inline by `validateTemplate`, which shifts every
// later index — so a caption authored at `sections[1]` behind a three-section partial came back
// reported at `sections[3]`, a path the agent cannot act on. `geometryLines` expands for itself and
// maps findings back to authored indices, so it gets the untouched input.
// The findings have to reach the `content` block too, not only `structuredContent`. Text content is
// the baseline channel every MCP client renders; one without structured-output support showed the
// model a bare "Valid template — 3 section(s)…" for a descriptor whose captions run off the frame,
// and it went straight to compose_video — the precise failure the tool description tells it to check
// for. One line plus the findings, since the agent pays for every token it reads.
function geometryNote(geometry: string[] | undefined): string {
  if (!geometry) {
    return '';
  }

  return ` ${geometry.length} geometry finding(s):\n- ${geometry.join('\n- ')}`;
}

// Set only for `render: true`: where to render, and the call's cancellation signal.
type RenderRequest = { config: RenderConfig; signal: AbortSignal | undefined };

async function findings(
  descriptor: TemplateDescriptor,
  authored: TemplateDescriptor,
  request: RenderRequest | null
): Promise<{ geometry: string[] | undefined; render?: RenderSummary }> {
  if (!request) {
    return { geometry: await geometryLines(authored) };
  }

  return renderedGeometry(descriptor, authored, request.config, request.signal);
}

const EFFECT_GEOMETRY_NOTE = 'Remotion text fit and contrast are not measured; inspect render_preview.';
async function effectFindings(
  descriptor: TemplateDescriptor,
  authored: TemplateDescriptor,
  request: RenderRequest | null
) {
  // Core expands partials and measures FFmpeg layers on generated effect footage. Its rendered
  // check excludes effects from pixel targets while refining ordinary sections normally.
  const result = await findings(descriptor, authored, request);

  return {
    geometry: [...(result.geometry ?? []), EFFECT_GEOMETRY_NOTE],
    render: effectRenderSummary(result.render, request),
  };
}
function effectRenderSummary(render: RenderSummary | undefined, request: RenderRequest | null) {
  if (!request) return render;

  return {
    measured: render?.measured ?? 0,
    seconds: render?.seconds ?? 0,
    unavailable: [render?.unavailable, EFFECT_GEOMETRY_NOTE].filter(Boolean).join(' '),
  };
}
function effectCapabilities(hasEffects: boolean, config: RenderConfig) {
  if (!hasEffects) return {};

  return {
    capabilities: {
      effects: Boolean(config.allowRemotion && config.remotionEntry),
      backend: 'Remotion/Chromium (trusted local Node source)',
      geometry: EFFECT_GEOMETRY_NOTE,
    },
  };
}
async function summary(
  descriptor: TemplateDescriptor,
  authored: TemplateDescriptor,
  request: RenderRequest | null,
  config: RenderConfig
) {
  const sectionCount = descriptor.sections?.length ?? 0;
  // The authored orientation, else the one global.platform implies.
  const orientation = effectiveOrientation(descriptor.global) ?? null;
  const clips = requiredClips(descriptor);
  const fields = formFields(descriptor);
  const hasEffects = (descriptor.sections ?? []).some((section) => section.type === 'effect');
  const { geometry, render } = hasEffects
    ? await effectFindings(descriptor, authored, request)
    : await findings(descriptor, authored, request);
  const motion = motionWarnings(authored);
  const features = await capabilityWarnings(authored);
  const needs = [
    clips.length > 0 ? `clips: ${clips.join(', ')}` : 'no clips',
    fields.length > 0 ? `fields: ${fields.join(', ')}` : 'no fields',
  ].join('; ');

  return {
    content: [
      {
        type: 'text' as const,
        text: `Valid template — ${sectionCount} section(s), ${orientation ?? 'default'} orientation. Requires ${needs}.${renderNote(render)}${geometryNote(geometry)}${motionNote(motion)}${featureNote(features)}`,
      },
    ],
    structuredContent: {
      valid: true,
      revision: templateRevision(authored as Record<string, unknown>),
      ...effectCapabilities(hasEffects, config),
      sectionCount,
      orientation,
      requiredClips: clips,
      formFields: fields,
      geometry,
      motionWarnings: motion,
      featureWarnings: features,
      render,
    },
  };
}

async function handleValidate(args: ValidateArgs, config: RenderConfig, ctx?: ServerContext) {
  const resolved = resolveDescriptor(args);

  if ('isError' in resolved) {
    return resolved;
  }

  try {
    await validateEffects(args.template, config, ctx?.mcpReq.signal);
  } catch (error) {
    return errorResult(`Effect validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const request = args.render === true ? { config, signal: ctx?.mcpReq.signal } : null;

  return summary(resolved.descriptor, args.template, request, config);
}

export function registerValidateTemplate(server: McpServer, config: RenderConfig): void {
  server.registerTool(
    'validate_template',
    {
      title: 'Validate Template',
      description:
        'Dry-run an inline `template` descriptor against the core schema WITHOUT rendering — returns ' +
        'instantly unless `render: true`. Get back whether it is valid plus what compose_video will require: the ' +
        'project_video clip sections and the form fields. Use this to iterate on a descriptor in ' +
        'milliseconds before the slower compose_video render. Also catches, render-free, text that ' +
        'runs off the frame or out of title-safe, collides with other text, sits under a band, is too ' +
        'small, lacks contrast, or sits over footage with no box/outline/shadow — see the `geometry` field — and ' +
        'flags motion pacing (monotonous eases, front-loaded beats, dead air, flat tempo) and stock motion ' +
        '(untuned or repeated effects, library sample animations) in `motionWarnings`; ' +
        'section `assert` entries that fail are errors; `featureWarnings` lists what the local FFmpeg cannot ' +
        'render (feature_unavailable, see get_capabilities). ' +
        'Pass `render: true` to also render the text-bearing sections and measure contrast from real pixels ' +
        '(seconds; settles text over images, grades and looks).',
      inputSchema,
      outputSchema,
    },
    // Optional context, as on compose_video: cancelling the call kills the render worker.
    (args: ValidateArgs, ctx?: ServerContext) => handleValidate(args, config, ctx)
  );
}
