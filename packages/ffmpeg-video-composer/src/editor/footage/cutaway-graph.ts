// B-roll cutaways in the section graph: each clip is cut to its window, shifted onto the main timeline
// (setpts offset), framed to the output and overlaid with an enable window and eof_action=pass, so the
// main clip keeps running underneath. Audio: `a` keeps the main track, `b` silences it for the window
// and plays the cutaway's, `mix` sums both (amix normalize=0). The cutaway sound is delayed with a
// generated silence + concat instead of adelay, which is not on the on-device allowlist.

export interface ResolvedCutaway {
  /** Input index of the cutaway clip. */
  input: number;
  at: number;
  duration: number;
  from: number;
  audio: 'a' | 'b' | 'mix';
  fit: 'cover' | 'contain';
}

export interface FootageLegs {
  nodes: string[];
  video: string;
  audio: string;
}

interface CutawayContext {
  cutaways: ResolvedCutaway[];
  scale: string;
  frameFit: 'cover' | 'contain';
  audioFormat: { sampleRate: number | string; channelLayout: string };
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** Frame a clip to the output: cover (fill + crop) or contain (whole clip + bars). */
export function frameChain(scale: string, fit: 'cover' | 'contain'): string {
  if (fit === 'contain') {
    return `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  }

  return `scale=${scale}:force_original_aspect_ratio=increase,crop=${scale},setsar=1`;
}

function window(cutaway: ResolvedCutaway): string {
  return `between(t,${cutaway.at},${round(cutaway.at + cutaway.duration)})`;
}

export function cutawayVideo(legs: FootageLegs, context: CutawayContext): FootageLegs {
  if (context.cutaways.length === 0) return legs;

  const nodes = [
    ...legs.nodes,
    `[${legs.video}]setpts=PTS-STARTPTS,${frameChain(context.scale, context.frameFit)}[fm]`,
  ];
  let base = 'fm';

  for (const [i, cutaway] of context.cutaways.entries()) {
    const clip = `trim=start=${cutaway.from}:duration=${cutaway.duration},setpts=PTS-STARTPTS+${cutaway.at}/TB`;

    nodes.push(
      `[${cutaway.input}:v]${clip},${frameChain(context.scale, cutaway.fit)}[cw${i}]`,
      `[${base}][cw${i}]overlay=0:0:enable='${window(cutaway)}':eof_action=pass[co${i}]`
    );
    base = `co${i}`;
  }

  return { ...legs, nodes, video: base };
}

// The cutaway's own sound, cut to its window and pushed to `at` with generated silence.
function cutawaySound(cutaway: ResolvedCutaway, k: number, context: CutawayContext): { nodes: string[]; pad: string } {
  const { sampleRate, channelLayout } = context.audioFormat;
  const format = `aformat=sample_rates=${sampleRate}:channel_layouts=${channelLayout}`;
  const clip = `[${cutaway.input}:a]atrim=start=${cutaway.from}:duration=${cutaway.duration},asetpts=PTS-STARTPTS,${format}[cb${k}]`;

  if (cutaway.at <= 0) return { nodes: [clip], pad: `cb${k}` };

  return {
    nodes: [
      clip,
      `anullsrc=r=${sampleRate}:cl=${channelLayout},atrim=duration=${cutaway.at},${format}[cs${k}]`,
      `[cs${k}][cb${k}]concat=n=2:v=0:a=1[cd${k}]`,
    ],
    pad: `cd${k}`,
  };
}

export function cutawayAudio(legs: FootageLegs, context: CutawayContext): FootageLegs {
  const sounding = context.cutaways.filter((cutaway) => cutaway.audio !== 'a');

  if (sounding.length === 0) return legs;

  const switched = sounding.filter((cutaway) => cutaway.audio === 'b');
  const duck =
    switched.length > 0 ? [`[${legs.audio}]volume=volume=0:enable='${switched.map(window).join('+')}'[fduck]`] : [];
  const main = switched.length > 0 ? 'fduck' : legs.audio;
  const sounds = sounding.map((cutaway, k) => cutawaySound(cutaway, k, context));
  const pads = sounds.map((sound) => `[${sound.pad}]`).join('');
  const mix = `[${main}]${pads}amix=inputs=${sounds.length + 1}:duration=first:normalize=0[fmix]`;

  return { ...legs, nodes: [...legs.nodes, ...duck, ...sounds.flatMap((sound) => sound.nodes), mix], audio: 'fmix' };
}
