// Plays a library sound effect at a cue's volume. Web Audio carries the gain, so a volume above 100% is
// heard boosted as the mix will play it; without Web Audio an <audio> element plays it capped at 100%.
// One preview at a time: starting another stops the previous one.

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | undefined;
let current: { stop: () => void } | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();

function contextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;

  if ('AudioContext' in window) return window.AudioContext;

  return (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
}

function decoded(audio: AudioContext, url: string): Promise<AudioBuffer> {
  const cached = buffers.get(url);

  if (cached) return cached;

  const loading = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`sfx preview: ${response.status} for ${url}`);

      return response.arrayBuffer();
    })
    .then((bytes) => audio.decodeAudioData(bytes));

  // A failed load is not cached, so the next press retries.
  loading.catch(() => buffers.delete(url));
  buffers.set(url, loading);

  return loading;
}

function stopCurrent(): void {
  current?.stop();
  current = undefined;
}

async function playWithElement(url: string, volume: number): Promise<void> {
  const element = new Audio(url);
  element.volume = Math.min(1, Math.max(0, volume));
  current = {
    stop: () => {
      element.pause();
    },
  };
  await element.play();
}

/** Plays `url` at gain `volume` (0..2). Rejects when the file cannot be loaded or played. */
export async function playSfxPreview(url: string, volume: number): Promise<void> {
  stopCurrent();

  const Ctor = contextCtor();

  if (!Ctor) return playWithElement(url, volume);

  context ??= new Ctor();
  const audio = context;

  if (audio.state === 'suspended') await audio.resume();

  const buffer = await decoded(audio, url);
  const source = audio.createBufferSource();
  const gain = audio.createGain();

  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(audio.destination);
  stopCurrent();
  current = {
    stop: () => {
      source.stop();
    },
  };
  source.start();
}
