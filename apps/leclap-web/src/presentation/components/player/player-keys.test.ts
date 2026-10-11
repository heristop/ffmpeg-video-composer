import { describe, expect, it, vi } from 'vitest';
import { runPlayerAction, type PlayerHandlers } from './player-keys';

const handlers = (): PlayerHandlers & Record<string, ReturnType<typeof vi.fn>> => ({
  toggle: vi.fn(),
  seekTo: vi.fn(),
  volumeBy: vi.fn(),
  mute: vi.fn(),
  fullscreen: vi.fn(),
  captions: vi.fn(),
  rate: vi.fn(),
  pip: vi.fn(),
});

const clock = { current: 58, duration: 60 };

describe('runPlayerAction', () => {
  it('seeks relative to the playhead, clamped to the film', () => {
    const player = handlers();

    runPlayerAction({ type: 'seekBy', seconds: 5 }, player, clock);
    runPlayerAction({ type: 'seekBy', seconds: -100 }, player, clock);

    expect(player.seekTo).toHaveBeenNthCalledWith(1, 60);
    expect(player.seekTo).toHaveBeenNthCalledWith(2, 0);
  });

  it('jumps to a fraction of the film', () => {
    const player = handlers();

    runPlayerAction({ type: 'seekTo', fraction: 0.5 }, player, clock);

    expect(player.seekTo).toHaveBeenCalledWith(30);
  });

  it('routes play, mute, fullscreen, captions, volume and speed to the player', () => {
    const player = handlers();

    runPlayerAction({ type: 'toggle' }, player, clock);
    runPlayerAction({ type: 'mute' }, player, clock);
    runPlayerAction({ type: 'fullscreen' }, player, clock);
    runPlayerAction({ type: 'captions' }, player, clock);
    runPlayerAction({ type: 'volumeBy', delta: 0.1 }, player, clock);
    runPlayerAction({ type: 'rate', direction: -1 }, player, clock);

    expect(player.toggle).toHaveBeenCalledOnce();
    expect(player.mute).toHaveBeenCalledOnce();
    expect(player.fullscreen).toHaveBeenCalledOnce();
    expect(player.captions).toHaveBeenCalledOnce();
    expect(player.volumeBy).toHaveBeenCalledWith(0.1);
    expect(player.rate).toHaveBeenCalledWith(-1);
  });

  it('routes p to picture-in-picture', () => {
    const player = handlers();

    runPlayerAction({ type: 'pip' }, player, clock);

    expect(player.pip).toHaveBeenCalledOnce();
  });

  it('does nothing for captions on a video without them', () => {
    const player = { ...handlers(), captions: undefined };

    expect(() => {
      runPlayerAction({ type: 'captions' }, player, clock);
    }).not.toThrow();
  });
});
