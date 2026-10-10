import { describe, it, expect } from 'vitest';
import { cameraDebugRequested, longestGap, medianGap, settingsChanges, summarizeStart } from './camera-debug';

// `?debugCamera=1` measures what happens between pressing record and the first recorded frame, on the
// visitor's own camera: the numbers that tell an encoder start-up stall from a capture renegotiation
// (or from the OS's own video effects) on hardware a headless browser can't reproduce.
describe('cameraDebugRequested', () => {
  it('is on only for debugCamera=1', () => {
    expect(cameraDebugRequested('?debugCamera=1')).toBe(true);
    expect(cameraDebugRequested('?lang=fr&debugCamera=1')).toBe(true);
    expect(cameraDebugRequested('?debugCamera=0')).toBe(false);
    expect(cameraDebugRequested('')).toBe(false);
  });
});

describe('frame gaps', () => {
  const frames = [0, 33, 66, 100, 1300, 1333, 1366];

  it('finds the longest gap between preview frames inside a window', () => {
    expect(longestGap(frames, 0, 2000)).toBe(1200);
    expect(longestGap(frames, 1300, 2000)).toBe(1200);
    expect(longestGap(frames, 1333, 2000)).toBe(33);
  });

  it('takes the median gap as the steady frame interval', () => {
    expect(medianGap(frames, 0, 100)).toBe(33);
  });

  it('is 0 without frames in the window', () => {
    expect(longestGap(frames, 5000, 6000)).toBe(0);
    expect(medianGap([], 0, 100)).toBe(0);
  });
});

describe('settingsChanges', () => {
  it('lists the capture settings that differ, to spot a renegotiated camera', () => {
    expect(
      settingsChanges(
        { width: 1280, height: 720, frameRate: 30, deviceId: 'a' },
        { width: 1920, height: 1080, frameRate: 30, deviceId: 'a' }
      )
    ).toEqual(['width 1280→1920', 'height 720→1080']);
  });

  it('is empty when the camera kept its settings', () => {
    expect(settingsChanges({ width: 1280, frameRate: 30 }, { width: 1280, frameRate: 30 })).toEqual([]);
  });
});

describe('summarizeStart', () => {
  it('reports the encoder start-up and the preview freeze around a recorder start', () => {
    const frames = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 2100, 2150];

    expect(
      summarizeStart({
        index: 1,
        kind: 'take',
        mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        size: '1280x720',
        startCall: 700,
        startEvent: 2100,
        frames,
        longTasks: [{ start: 800, duration: 120 }],
        captureCalls: 0,
        changes: [],
      })
    ).toEqual({
      '#': 1,
      kind: 'take',
      size: '1280x720',
      codec: 'avc1.42E01E,mp4a.40.2',
      'start→encoder ready (ms)': 1400,
      'preview frame (ms)': 50,
      'preview freeze (ms)': 1400,
      'long tasks (ms)': 120,
      'capture changes': 'none',
    });
  });

  it('watches the preview until the encoder is ready when that takes longer', () => {
    const frames = [0, 50, 100, 4100, 4150];
    const row = summarizeStart({
      index: 1,
      kind: 'warm-up',
      mimeType: 'video/mp4;codecs=avc1.42E01E',
      size: '1280x720',
      startCall: 100,
      startEvent: 4100,
      frames,
      longTasks: [],
      captureCalls: 0,
      changes: [],
    });

    expect(row['preview freeze (ms)']).toBe(4000);
  });

  it('flags a recorder that has not reported its start yet, and names any capture change', () => {
    const row = summarizeStart({
      index: 2,
      kind: 'warm-up',
      mimeType: undefined,
      size: '404x720',
      startCall: 0,
      startEvent: null,
      frames: [],
      longTasks: [],
      captureCalls: 1,
      changes: ['width 1280→1920'],
    });

    expect(row['start→encoder ready (ms)']).toBe('pending');
    expect(row.codec).toBe('default');
    expect(row['capture changes']).toBe('1 getUserMedia/applyConstraints call; width 1280→1920');
  });
});
