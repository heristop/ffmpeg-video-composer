// SubRip (.srt) parsing, pure TS. Tolerates the variants real files carry: a UTF-8 BOM, CRLF or CR
// line ends, a missing or non-numeric index line, "." instead of "," before the milliseconds, a
// missing hours field, one to three millisecond digits, cue settings after the end time, a WEBVTT
// header and NOTE blocks, and inline markup (<i>, <font …>, {\an8}). Text lines are joined with a
// space: captions are re-wrapped to the frame anyway.

export interface SrtCue {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

export interface SrtError {
  /** 1-based line of the offending block. */
  line: number;
  message: string;
}

export interface SrtParse {
  cues: SrtCue[];
  errors: SrtError[];
}

const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?`;
const TIMING = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);

function seconds(parts: Array<string | undefined>): number {
  const [hours, minutes, secs, millis] = parts;
  const fraction = millis === undefined ? 0 : Number(millis.padEnd(3, '0')) / 1000;

  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + fraction;
}

/** Cue text without markup, on one line. */
export function srtText(lines: readonly string[]): string {
  return lines
    .join(' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Block {
  line: number;
  lines: string[];
}

function blocks(source: string): Block[] {
  const lines = source.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: Block[] = [];
  let current: Block | null = null;

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      current = null;

      continue;
    }

    if (!current) {
      current = { line: index + 1, lines: [] };
      out.push(current);
    }

    current.lines.push(line);
  }

  return out;
}

function isHeader(block: Block): boolean {
  const first = block.lines[0].trim();

  return first.startsWith('WEBVTT') || first.startsWith('NOTE') || first === 'STYLE' || first === 'REGION';
}

function parseBlock(block: Block): SrtCue | SrtError | null {
  if (isHeader(block)) return null;

  const timingIndex = block.lines.findIndex((line) => TIMING.test(line));

  if (timingIndex < 0 || timingIndex > 1) {
    return {
      line: block.line,
      message: 'no "start --> end" timing line (expected e.g. 00:00:01,000 --> 00:00:02,500)',
    };
  }

  const match = TIMING.exec(block.lines[timingIndex]) as RegExpExecArray;
  const start = seconds(match.slice(1, 5));
  const end = seconds(match.slice(5, 9));
  const text = srtText(block.lines.slice(timingIndex + 1));

  if (end <= start) return { line: block.line, message: `cue ends (${end}s) before it starts (${start}s)` };

  return text ? { start, end, text } : null;
}

/** Every cue of an SRT (or WebVTT) document, plus a finding per block that could not be read. */
export function parseSrt(source: string): SrtParse {
  const cues: SrtCue[] = [];
  const errors: SrtError[] = [];

  for (const block of blocks(source)) {
    const parsed = parseBlock(block);

    if (parsed === null) continue;

    if ('message' in parsed) {
      errors.push(parsed);

      continue;
    }

    cues.push(parsed);
  }

  if (cues.length === 0 && errors.length === 0) errors.push({ line: 1, message: 'no cues found' });

  return { cues: cues.sort((a, b) => a.start - b.start), errors };
}
