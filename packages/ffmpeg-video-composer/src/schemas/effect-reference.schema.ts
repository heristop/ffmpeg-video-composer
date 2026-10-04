import { z } from 'zod';

/** JSON-only data keeps effect references portable across Node, browser and native runtimes. */
export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const EffectReferenceSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/)
      .describe('Safe effect identifier, optionally namespaced with slash-separated identifiers.'),
    version: z.string().regex(EXACT_SEMVER).describe('Exact semantic version; ranges and tags are forbidden.'),
    props: z.record(z.string(), JsonValueSchema).describe('JSON object of renderer-specific effect properties.'),
    assets: z.record(z.string(), z.string()).describe('Named asset paths or URLs consumed by the effect renderer.'),
  })
  .strict()
  .describe('Platform-neutral, versioned reference to an effect renderer.');

export type EffectReference = z.infer<typeof EffectReferenceSchema>;
