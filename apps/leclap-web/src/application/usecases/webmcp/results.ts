// Result builders for the browser-agent tools, in the MCP CallToolResult shape. Text content is the
// channel every agent reads, so a success carries a terse summary line plus the structured payload as
// JSON; an error is `isError` with JSON text `{ code, message, hint?, errors? }`, the same wording family
// as @leclap/mcp (`revision_conflict: …`).
import type { ValidationError } from 'ffmpeg-video-composer/src/services/validation/types.ts';
import type { ToolErrorCode, ToolResult } from './types';

/** Largest tool output, in UTF-8 bytes. */
export const MAX_OUTPUT_BYTES = 200 * 1024;

export interface ErrorExtras {
  hint?: string;
  errors?: ValidationError[];
  retryAfterMs?: number;
  [key: string]: unknown;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A success: `summary` first (when given), then the payload as JSON. */
export function ok(structured: Record<string, unknown>, summary?: string): ToolResult {
  const json = JSON.stringify(structured);

  return {
    content: [{ type: 'text', text: summary ? `${summary}\n${json}` : json }],
    structuredContent: structured,
  };
}

export function fail(code: ToolErrorCode, message: string, extras: ErrorExtras = {}): ToolResult {
  const payload = { code, message, ...extras };

  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
}

export function revisionConflict(): ToolResult {
  return fail('revision_conflict', 'revision_conflict: template changed; call get_template for the current revision.', {
    hint: 'Read the template again, re-apply your change to it, and pass its revision as expectedRevision.',
  });
}

/** The text of a result's first text part ('' when it has none). */
export function textOf(result: ToolResult): string {
  const part = result.content.find((candidate) => candidate.type === 'text');

  return part?.type === 'text' ? part.text : '';
}

/** The error code of a result, when it is one. */
export function errorCode(result: ToolResult): ToolErrorCode | undefined {
  if (!result.isError) return undefined;

  const code = result.structuredContent?.code;

  return typeof code === 'string' ? (code as ToolErrorCode) : undefined;
}

/**
 * Replaces an oversized result with a `too_large` error that says how to ask for less. Only text counts:
 * images (render_frames) are bounded per frame by the tool that captures them.
 */
export function capOutput(result: ToolResult, hint: string): ToolResult {
  const size = result.content.reduce((total, part) => total + (part.type === 'text' ? byteLength(part.text) : 0), 0);

  if (size <= MAX_OUTPUT_BYTES) return result;

  return fail('too_large', `The result is ${String(Math.ceil(size / 1024))} KB; the limit is 200 KB.`, { hint });
}
