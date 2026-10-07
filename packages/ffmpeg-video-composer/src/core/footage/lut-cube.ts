// `.cube` 3D LUT parsing, strength blending and serialisation — pure and deterministic, so a graded
// LUT (a preset or a user's Log conversion cube) is blended toward identity in JS and written to the
// build FS as ONE `lut3d` input: no blend/mix filter, which keeps the grade on the on-device allowlist.

export type Rgb = [number, number, number];

export interface CubeLut {
  size: number;
  domainMin: Rgb;
  domainMax: Rgb;
  /** size³ RGB triples, red varying fastest (the `.cube` order `lut3d` reads). */
  rows: Rgb[];
}

/** FFmpeg's lut3d reads grids up to 256 points per axis; a grid needs at least 2. */
export const CUBE_MIN_SIZE = 2;
export const CUBE_MAX_SIZE = 256;

export type CubeErrorCode = 'cube_missing_size' | 'cube_bad_size' | 'cube_bad_row' | 'cube_row_count' | 'cube_domain';

export class CubeParseError extends Error {
  constructor(
    readonly code: CubeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CubeParseError';
  }
}

function triple(parts: string[], line: number, what: string): Rgb {
  const values = parts.map(Number);

  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new CubeParseError('cube_bad_row', `line ${line}: ${what} needs three numbers, got "${parts.join(' ')}"`);
  }

  return values as Rgb;
}

function parseSize(parts: string[], line: number): number {
  const size = Number(parts.at(0));

  if (!Number.isInteger(size) || size < CUBE_MIN_SIZE || size > CUBE_MAX_SIZE) {
    throw new CubeParseError(
      'cube_bad_size',
      `line ${line}: LUT_3D_SIZE must be an integer ${CUBE_MIN_SIZE}..${CUBE_MAX_SIZE}, got "${parts.join(' ')}"`
    );
  }

  return size;
}

interface CubeDraft {
  size: number | null;
  domainMin: Rgb;
  domainMax: Rgb;
  rows: Rgb[];
}

// One meaningful line: a keyword (header) or a data row. Keywords that do not change the grid (TITLE,
// LUT_3D_INPUT_RANGE written by some tools alongside DOMAIN_*) are accepted and ignored.
function readLine(draft: CubeDraft, text: string, line: number): void {
  const [head, ...rest] = text.split(/\s+/);

  if (head === 'LUT_3D_SIZE') {
    draft.size = parseSize(rest, line);

    return;
  }

  if (head === 'LUT_1D_SIZE') {
    throw new CubeParseError('cube_bad_size', `line ${line}: 1D LUTs are not supported, export a 3D .cube`);
  }

  if (head === 'DOMAIN_MIN' || head === 'DOMAIN_MAX') {
    draft[head === 'DOMAIN_MIN' ? 'domainMin' : 'domainMax'] = triple(rest, line, head);

    return;
  }

  if (/^[A-Z_]+$/.test(head)) return;

  draft.rows.push(triple([head, ...rest], line, 'a data row'));
}

function checkDraft(draft: CubeDraft): CubeLut {
  if (draft.size === null) {
    throw new CubeParseError('cube_missing_size', 'no LUT_3D_SIZE line: not a 3D .cube file');
  }

  const expected = draft.size ** 3;

  if (draft.rows.length !== expected) {
    throw new CubeParseError(
      'cube_row_count',
      `LUT_3D_SIZE ${draft.size} needs ${expected} data rows, found ${draft.rows.length}`
    );
  }

  if (draft.domainMin.some((min, channel) => min >= draft.domainMax[channel])) {
    throw new CubeParseError(
      'cube_domain',
      `DOMAIN_MIN ${draft.domainMin.join(' ')} must be below DOMAIN_MAX ${draft.domainMax.join(' ')} on every channel`
    );
  }

  return { size: draft.size, domainMin: draft.domainMin, domainMax: draft.domainMax, rows: draft.rows };
}

/** Parses `.cube` text (Adobe/Resolve 3D LUT). Throws CubeParseError naming the line on malformed input. */
export function parseCube(text: string): CubeLut {
  const draft: CubeDraft = { size: null, domainMin: [0, 0, 0], domainMax: [1, 1, 1], rows: [] };

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const trimmed = raw.trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    readLine(draft, trimmed, index + 1);
  }

  return checkDraft(draft);
}

/** The identity output of grid point (ri, gi, bi) in the LUT's domain. */
export function identityAt(lut: Pick<CubeLut, 'size' | 'domainMin' | 'domainMax'>, index: number): Rgb {
  const { size, domainMin, domainMax } = lut;
  const last = size - 1;
  const steps = [index % size, Math.floor(index / size) % size, Math.floor(index / (size * size))];

  return steps.map(
    (step, channel) => domainMin[channel] + ((domainMax[channel] - domainMin[channel]) * step) / last
  ) as Rgb;
}

/** Quantised strength (3 decimals, clamped 0..1): the value the blend and the staged file name both use. */
export function quantizeStrength(strength: number | undefined): number {
  if (strength === undefined || !Number.isFinite(strength)) return 1;

  return Math.round(Math.min(1, Math.max(0, strength)) * 1000) / 1000;
}

/**
 * Blends every row toward the identity grid: out = identity + (lut − identity) · strength. Strength 1
 * returns the LUT untouched, 0 the identity; anything between is a weaker version of the same grade.
 */
export function blendTowardIdentity(lut: CubeLut, strength: number): CubeLut {
  const amount = quantizeStrength(strength);

  if (amount === 1) return lut;

  const rows = lut.rows.map((row, index) => {
    const identity = identityAt(lut, index);

    return row.map((value, channel) => identity[channel] + (value - identity[channel]) * amount) as Rgb;
  });

  return { ...lut, rows };
}

function isUnitDomain(lut: CubeLut): boolean {
  return lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
}

/** Serialises a LUT back to `.cube` text (6 decimals, DOMAIN lines only when not the unit cube). */
export function serializeCube(lut: CubeLut, title: string): string {
  const domain = isUnitDomain(lut)
    ? []
    : [`DOMAIN_MIN ${lut.domainMin.join(' ')}`, `DOMAIN_MAX ${lut.domainMax.join(' ')}`];
  const rows = lut.rows.map((row) => row.map((value) => value.toFixed(6)).join(' '));

  return `${[`# ${title}`, `LUT_3D_SIZE ${lut.size}`, ...domain, ...rows].join('\n')}\n`;
}
