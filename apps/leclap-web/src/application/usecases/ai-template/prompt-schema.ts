// The template schema as the generation prompt sees it. Composed sounds (`sfx[].sound`: layers, envelopes,
// filters) are authored by MCP agents that can measure them (analyze_sound); a one-shot generation can't
// listen, and their vocabulary would cost the prompt's tight size budget. So the prompt keeps library sound
// ids and drops the `Sound*` definitions and every property pointing at them. The engine schema and MCP
// get_template_schema keep the full vocabulary.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const SOUND_DEF = /^Sound/;
const SOUND_REF = '#/$defs/Sound';

function pointsAtSound(node: Json): boolean {
  return (
    node !== null &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeof node.$ref === 'string' &&
    node.$ref.startsWith(SOUND_REF)
  );
}

function strip(node: Json): Json {
  if (Array.isArray(node)) return node.map(strip);

  if (node === null || typeof node !== 'object') return node;

  const out: { [key: string]: Json } = {};

  for (const [key, value] of Object.entries(node)) {
    if (pointsAtSound(value)) continue;

    out[key] = strip(value);
  }

  return out;
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
