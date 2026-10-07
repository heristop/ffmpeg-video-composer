import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeStyleFile } from 'ffmpeg-video-composer';
import { formatStyleSummary, themeSnippetPath, writeStyleGuide } from '../src/commands/style';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
}

// lavfi's colour source goes through YUV, so the decoded canvas lands within a step or two of 0x101828.
function nearCanvas(hex: string): boolean {
  const target = [0x10, 0x18, 0x28];

  return target.every((value, i) => Math.abs(Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) - value) <= 3);
}

describe('themeSnippetPath', () => {
  it('puts the theme JSON beside the style guide', () => {
    expect(themeSnippetPath('out/style-guide.md')).toBe(path.join('out', 'style-guide.theme.json'));
  });
});

describe.skipIf(!hasFfmpeg())('leclap style (ffmpeg)', () => {
  let dir: string;
  let image: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'leclap-cli-style-'));
    image = path.join(dir, 'ref.png');
    // A dark canvas with a bright orange box: bg + accent.
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x101828:s=320x180,drawbox=x=40:y=60:w=120:h=40:color=0xff7a18:t=fill',
      '-frames:v',
      '1',
      image,
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('summarises the derived theme', async () => {
    const analysis = await analyzeStyleFile(image, { ffmpeg: 'ffmpeg' });
    const text = formatStyleSummary(analysis).join('\n');

    expect(nearCanvas(analysis.styleGuide.roles.bg.hex)).toBe(true);
    expect(text).toContain('"theme"');
    expect(text).toContain('never copied');
  });

  it('writes the markdown guide and the theme snippet', async () => {
    const analysis = await analyzeStyleFile(image, { ffmpeg: 'ffmpeg' });
    const written = await writeStyleGuide(analysis, path.join(dir, 'style-guide.md'), 'Ref');
    const theme = JSON.parse(readFileSync(written.theme, 'utf8')) as { global: { theme: { colors: { bg: string } } } };

    expect(readFileSync(written.markdown, 'utf8')).toContain('# Ref');
    expect(nearCanvas(theme.global.theme.colors.bg)).toBe(true);
  });
});
