// Peak normalisation: the loudest sample of any channel is scaled to the target level (the library's
// -3 dBFS), so a composed sound sits at the same level as a bundled one before the cue's `volume`. Pure.

export function peakOf(channels: readonly Float64Array[]): number {
  let peak = 0;

  for (const channel of channels) {
    for (const value of channel) peak = Math.max(peak, Math.abs(value));
  }

  return peak;
}

/** Scales `channels` in place so their peak is `dbfs`; returns the peak before (0 leaves silence as is). */
export function normalizePeak(channels: readonly Float64Array[], dbfs: number): number {
  const peak = peakOf(channels);

  if (peak === 0) return 0;

  const gain = 10 ** (dbfs / 20) / peak;

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) channel[i] *= gain;
  }

  return peak;
}
