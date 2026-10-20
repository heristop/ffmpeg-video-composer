// @vitest-environment node
// The shared preview player, driven against a stand-in Audio: one track sounds at a time, and pressing
// the sounding track again stops it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  preload = '';
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  private readonly handlers = new Map<string, Array<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, handler: () => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  fire(type: string) {
    for (const handler of this.handlers.get(type) ?? []) handler();
  }

  play() {
    this.paused = false;

    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

const load = () => import('./music-preview');

afterEach(async () => {
  (await load()).stopPreview();
});

const a = { id: 'a', url: '/musics/a.mp3', durationSec: 120 };
const b = { id: 'b', url: '/musics/b.mp3', durationSec: 90 };

describe('music preview', () => {
  it('starts a track in the loading state with its catalog duration', async () => {
    const { togglePreview, previewSnapshot } = await load();

    togglePreview(a);

    expect(previewSnapshot()).toMatchObject({ trackId: 'a', status: 'loading', duration: 120 });
  });

  it('plays one track at a time through one element', async () => {
    const { togglePreview, previewSnapshot } = await load();

    togglePreview(a);
    togglePreview(b);

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe('/musics/b.mp3');
    expect(previewSnapshot().trackId).toBe('b');
  });

  it('stops when the sounding track is pressed again', async () => {
    const { togglePreview, previewSnapshot } = await load();

    togglePreview(a);
    FakeAudio.instances[0].fire('playing');
    expect(previewSnapshot().status).toBe('playing');

    togglePreview(a);

    expect(previewSnapshot()).toMatchObject({ trackId: null, status: 'idle' });
    expect(FakeAudio.instances[0].paused).toBe(true);
  });

  it('reports a load failure on the track that failed', async () => {
    const { togglePreview, previewSnapshot } = await load();

    togglePreview(a);
    FakeAudio.instances[0].fire('error');

    expect(previewSnapshot()).toMatchObject({ trackId: 'a', status: 'error' });
  });

  it('prefers the loaded length over the catalog one', async () => {
    const { trackDuration } = await load();

    expect(trackDuration(null, 90)).toBe(90);
    expect(trackDuration({ trackId: 'a', status: 'playing', currentTime: 0, duration: 91.5 }, 90)).toBe(91.5);
    expect(trackDuration({ trackId: 'a', status: 'loading', currentTime: 0, duration: 0 })).toBe(0);
  });

  it('formats track times as m:ss', async () => {
    const { formatTrackTime } = await load();

    expect(formatTrackTime(0)).toBe('0:00');
    expect(formatTrackTime(7.9)).toBe('0:07');
    expect(formatTrackTime(172)).toBe('2:52');
  });
});
