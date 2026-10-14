// Text forms of the path graphic's commands (path-geometry.ts): an authored SVG `d` (M/L/H/V/C/Q/Z,
// absolute or relative) parsed to canonical commands, and the compact encoding a `trace:` URL carries
// (path-raster.ts). Both are pure and deterministic.

import type { PathCommand } from './path-geometry';

const SVG_TOKEN = /\s*,?\s*(?:([MmLlHhVvCcQqZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))/y;
const SVG_ARITY: Partial<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };
/** A moveto's extra pairs are linetos. */
const AFTER_MOVE: Partial<Record<string, string>> = { M: 'L', m: 'l' };
const ARITY: Partial<Record<string, number>> = { M: 2, L: 2, C: 6, Q: 4, E: 6, W: 6, Z: 0 };

type Token = string | number;

function tokens(d: string): Token[] | null {
  const out: Token[] = [];
  SVG_TOKEN.lastIndex = 0;

  while (SVG_TOKEN.lastIndex < d.length && !/^[\s,]*$/.test(d.slice(SVG_TOKEN.lastIndex))) {
    const match = SVG_TOKEN.exec(d);

    if (!match) return null;

    const [, command, value] = match;

    out.push(command || Number(value));
  }

  return out;
}

interface SvgState {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

// The pair at args[i], moved by the origin of a relative command.
function pair(args: number[], i: number, origin: [number, number]): [number, number] {
  return [args[i] + origin[0], args[i + 1] + origin[1]];
}

function absolute(kind: string, args: number[], s: SvgState): PathCommand {
  const origin: [number, number] = kind === kind.toLowerCase() ? [s.x, s.y] : [0, 0];
  const [ox, oy] = origin;
  const table: Record<string, () => PathCommand> = {
    M: () => ['M', ...pair(args, 0, origin)],
    L: () => ['L', ...pair(args, 0, origin)],
    H: () => ['L', args[0] + ox, s.y],
    V: () => ['L', s.x, args[0] + oy],
    C: () => ['C', ...pair(args, 0, origin), ...pair(args, 2, origin), ...pair(args, 4, origin)],
    Q: () => ['Q', ...pair(args, 0, origin), ...pair(args, 2, origin)],
  };
  const command = table[kind.toUpperCase()]();
  const end = command.slice(-2) as [number, number];

  [s.x, s.y] = end;

  if (kind.toUpperCase() === 'M') [s.sx, s.sy] = end;

  return command;
}

interface Cursor {
  list: Token[];
  i: number;
  kind: string;
  state: SvgState;
}

// The next command (a letter, or an implicit repeat of the last one); null when the path is malformed.
function nextCommand(c: Cursor): PathCommand | null {
  const token = c.list[c.i];

  if (typeof token === 'string') {
    c.kind = token;
    c.i++;
  }

  if (c.kind.toUpperCase() === 'Z') {
    [c.state.x, c.state.y] = [c.state.sx, c.state.sy];
    c.kind = '';

    return ['Z'];
  }

  const arity = SVG_ARITY[c.kind.toUpperCase()];
  const args = arity === undefined ? [] : c.list.slice(c.i, c.i + arity);

  if (arity === undefined || args.length < arity || args.some((a) => typeof a !== 'number')) return null;

  c.i += arity;

  const command = absolute(c.kind, args as number[], c.state);

  c.kind = AFTER_MOVE[c.kind] ?? c.kind;

  return command;
}

/** An SVG path of M/L/H/V/C/Q/Z (absolute or relative) as commands; null when anything else is in it. */
export function parseSvgPath(d: string): PathCommand[] | null {
  const list = tokens(d);
  const first = list?.[0];

  if (!list || typeof first !== 'string' || first.toUpperCase() !== 'M') return null;

  const cursor: Cursor = { list, i: 0, kind: '', state: { x: 0, y: 0, sx: 0, sy: 0 } };
  const out: PathCommand[] = [];

  while (cursor.i < list.length) {
    const command = nextCommand(cursor);

    if (!command) return null;

    out.push(command);
  }

  return out;
}

// ── compact encoding (trace: URLs) ─────────────────────────────────────────────

function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Commands as text without spaces, commas or braces, e.g. "M10_20L30_40Z". */
export function encodeCommands(commands: readonly PathCommand[]): string {
  return commands.map(([kind, ...args]) => `${kind}${args.map(num).join('_')}`).join('');
}

function decodePart(part: string): PathCommand | null {
  const kind = part[0];
  const arity = ARITY[kind];
  const args = part.length > 1 ? part.slice(1).split('_').map(Number) : [];

  if (arity === undefined || args.length !== arity || args.some((v) => !Number.isFinite(v))) return null;

  return [kind, ...args] as PathCommand;
}

export function decodeCommands(text: string): PathCommand[] | null {
  const parts = text.match(/[A-Z][^A-Z]*/g);

  if (!parts || parts.join('') !== text) return null;

  const out = parts.map(decodePart);

  return out.every((command): command is PathCommand => command !== null) ? out : null;
}
