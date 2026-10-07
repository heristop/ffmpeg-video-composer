// Pull the one JSON object out of a model reply. Models are asked for bare JSON, but replies still
// arrive wrapped in ``` fences, preceded by a sentence, or followed by notes; this finds the first
// balanced top-level object (string-aware, so braces inside strings don't count) and parses it.

export type ExtractResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

const FENCE = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/;

interface ScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

// Advance the scanner by one character; returns true when the outermost object just closed.
function step(state: ScanState, char: string): boolean {
  if (state.inString) {
    const wasEscaped = state.escaped;
    state.escaped = !wasEscaped && char === '\\';

    if (!wasEscaped && char === '"') state.inString = false;

    return false;
  }

  if (char === '"') state.inString = true;

  if (char === '{') state.depth += 1;

  if (char === '}') {
    state.depth -= 1;

    return state.depth === 0;
  }

  return false;
}

// The first balanced `{…}` span in `text`, or null when none closes.
export function findJsonObject(text: string): string | null {
  const start = text.indexOf('{');

  if (start < 0) return null;

  const state: ScanState = { depth: 0, inString: false, escaped: false };

  for (let index = start; index < text.length; index += 1) {
    if (step(state, text.charAt(index))) return text.slice(start, index + 1);
  }

  return null;
}

function parseObject(candidate: string): ExtractResult {
  try {
    const value: unknown = JSON.parse(candidate);

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'The reply is JSON but not an object.' };
    }

    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : 'parse error'}` };
  }
}

export function extractJsonObject(reply: string): ExtractResult {
  const fenced = FENCE.exec(reply)?.[1];
  const source = fenced ?? reply;
  const candidate = findJsonObject(source) ?? (fenced ? findJsonObject(reply) : null);

  if (!candidate) {
    return {
      ok: false,
      error: reply.trim() === '' ? 'The reply was empty.' : 'No JSON object found in the reply (it may be truncated).',
    };
  }

  return parseObject(candidate);
}
