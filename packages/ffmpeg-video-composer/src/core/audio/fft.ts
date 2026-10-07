// A small iterative radix-2 FFT for the beat analyzer: the magnitude spectrum of one real frame. Twiddles
// and the bit-reversal table are computed once per size. Pure and deterministic.

export interface Fft {
  readonly size: number;
  /** Writes the `size / 2 + 1` magnitudes of `frame` (length `size`) into `out`. */
  magnitudes(frame: Float64Array, out: Float64Array): void;
}

function bitReversal(size: number): Uint32Array {
  const bits = Math.log2(size);
  const table = new Uint32Array(size);

  for (let index = 0; index < size; index++) {
    let reversed = 0;

    for (let bit = 0; bit < bits; bit++) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);

    table[index] = reversed;
  }

  return table;
}

function butterflies(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void {
  const size = re.length;

  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2;
    const step = size / span;

    for (let start = 0; start < size; start += span) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const wr = cos[k * step];
        const wi = -sin[k * step];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;

        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** An FFT of `size` points (a power of two). */
export function createFft(size: number): Fft {
  if (!Number.isInteger(Math.log2(size))) throw new Error(`FFT size must be a power of two, got ${size}`);

  const order = bitReversal(size);
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  const re = new Float64Array(size);
  const im = new Float64Array(size);

  for (let k = 0; k < size / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / size);
    sin[k] = Math.sin((2 * Math.PI * k) / size);
  }

  return {
    size,
    magnitudes(frame, out) {
      for (let index = 0; index < size; index++) {
        re[order[index]] = frame[index];
        im[order[index]] = 0;
      }

      butterflies(re, im, cos, sin);

      for (let bin = 0; bin <= size / 2; bin++) out[bin] = Math.hypot(re[bin], im[bin]);
    },
  };
}
