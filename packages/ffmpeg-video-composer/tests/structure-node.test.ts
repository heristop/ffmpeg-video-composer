import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeStructureFile } from '@/services/structure-node';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasFfmpeg())('analyzeStructureFile (ffmpeg)', () => {
  let dir: string;
  let clip: string;
  let still: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'structure-node-'));
    clip = path.join(dir, 'three-shots.mp4');
    still = path.join(dir, 'still.png');
    const shots = [
      'color=c=0x101820:s=320x180:d=1.5',
      'color=c=0xf0f0f0:s=320x180:d=1',
      'color=c=0x808080:s=320x180:d=1.5',
    ];
    execFileSync('ffmpeg', [
      '-v',
      'error',
      ...shots.flatMap((s) => ['-f', 'lavfi', '-i', s]),
      '-filter_complex',
      '[0][1][2]concat=n=3:v=1:a=0',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x203048:s=320x180', '-frames:v', '1', still]);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads three shots with dark, light and mid grounds', async () => {
    const structure = await analyzeStructureFile(clip);

    expect(structure.shots.map((shot) => shot.ground)).toEqual(['dark', 'light', 'mid']);
    expect(structure.shots[1].duration).toBeGreaterThan(0.7);
    expect(structure.shots[1].duration).toBeLessThan(1.3);
  });

  it('refuses a still image', async () => {
    await expect(analyzeStructureFile(still)).rejects.toThrow(/clip/);
  });
});
