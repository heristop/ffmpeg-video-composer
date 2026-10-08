// The template schema as the generation prompt sees it: the engine's, minus what a one-shot generation
// should never author here.
// - Composed sounds (`sfx[].sound`: layers, envelopes, filters) are authored by MCP agents that can measure
//   them (analyze_sound); a one-shot generation can't listen, and their vocabulary would cost the prompt's
//   tight size budget. So the prompt keeps library sound ids and drops the `Sound*` definitions and every
//   property pointing at them, so a cue's "id or sound" becomes "id required".
// - `subtitles.transcribe` needs the Node transcription pass (the browser reports transcribe_unavailable),
//   and `meta.resolved` is written by resolve passes, not by hand.
// The engine schema and MCP get_template_schema keep the full vocabulary.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const SOUND_DEF = /^Sound/;
const SOUND_REF = '#/$defs/Sound';
const HOST_ONLY = new Set(['transcribe', 'resolved']);

function pointsAtSound(node: Json): boolean {
  return (
    node !== null &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeof node.$ref === 'string' &&
    node.$ref.startsWith(SOUND_REF)
  );
}

type JsonObject = { [key: string]: Json };

function isObject(node: Json | undefined): node is JsonObject {
  return node !== null && node !== undefined && typeof node === 'object' && !Array.isArray(node);
}

function requiredOf(node: Json): string[] {
  return isObject(node) && Array.isArray(node.required) ? node.required.filter((key) => typeof key === 'string') : [];
}

function isKeyChoice(branch: Json): boolean {
  return isObject(branch) && Object.keys(branch).length === 1 && Array.isArray(branch.required);
}

// A "one of these keys" rule (`oneOf: [{ required: [a] }, { required: [b] }]`, the sfx cue's id / sound)
// loses the branches whose key was stripped; the single branch left becomes a plain `required`.
function settleChoice(node: JsonObject): JsonObject {
  const { oneOf, properties } = node;

  if (!Array.isArray(oneOf) || !isObject(properties) || !oneOf.every(isKeyChoice)) return node;

  const kept = oneOf.filter((branch) => requiredOf(branch).every((key) => key in properties));

  if (kept.length !== 1) return { ...node, oneOf: kept };

  const { oneOf: _choice, ...rest } = node;

  return { ...rest, required: [...new Set([...requiredOf(node), ...requiredOf(kept[0])])] };
}

// `inProperties`: `node` is a `properties` map, whose keys are property names (not schema keywords).
function strip(node: Json, inProperties = false): Json {
  if (Array.isArray(node)) return node.map((child) => strip(child));

  if (!isObject(node)) return node;

  const out: JsonObject = {};

  for (const [key, value] of Object.entries(node)) {
    if (pointsAtSound(value)) continue;

    if (inProperties && HOST_ONLY.has(key)) continue;

    out[key] = strip(value, key === 'properties' && !inProperties);
  }

  return inProperties ? out : settleChoice(out);
}

export function promptSchema(schema: unknown): unknown {
  const stripped = strip(schema as Json) as { [key: string]: Json };
  const defs = stripped.$defs;

  if (defs === null || typeof defs !== 'object' || Array.isArray(defs)) return stripped;

  return {
    ...stripped,
    $defs: Object.fromEntries(Object.entries(defs).filter(([name]) => !SOUND_DEF.test(name))),
  };
}
