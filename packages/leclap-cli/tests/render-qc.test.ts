import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QcReport } from 'ffmpeg-video-composer';
import { failedChecks, formatQcTable, reportQc } from '../src/render-qc';
import { assertOutputIsNotInput, finalizeOutput } from '../src/render-manifest';
import { buildProjectConfig } from '../src/render-args';

const report: QcReport = {
  verified: false,
  content: true,
  findings: [
    { check: 'duration', status: 'fail', value: 3.8, expected: 4, reason: '0.2s off', kind: 'format' },
    {
      check: 'color_tags',
      status: 'warn',
      value: 'bt709/unknown/bt709',
      expected: 'bt709',
      reason: 'x',
      kind: 'format',
    },
    { check: 'black_frames', status: 'pass', value: 0, expected: '<= 0.1', reason: '0% black', kind: 'judgement' },
  ],
};

// Strip ANSI colour so assertions read the plain table.
const ANSI = new RegExp(`${String.fromCodePoint(27)}\\[[\\d;]*m`, 'g');

function plain(text: string): string {
  return text.replace(ANSI, '');
}

describe('leclap render --qc', () => {
  it('maps --qc to the full check and --cache to an absolute cache dir', () => {
    const config = buildProjectConfig('/work', { qc: true, cache: '.cache/sections' });

    expect(config.qc).toEqual({ content: true });
    expect(config.cacheDir).toBe(path.resolve('/work', '.cache/sections'));
    expect(buildProjectConfig('/work', {}).qc).toBeUndefined();
  });

  it('prints a compact verdict and one row per finding', () => {
    const table = plain(formatQcTable(report)).split('\n');

    expect(table[0]).toBe('QC ✗ not verified  1 failed');
    expect(table[1]).toMatch(/^ {2}✗ duration +format +3\.8 +expected 4 {2}0\.2s off$/);
    expect(table[2]).toContain('! color_tags');
    expect(table[3]).toContain('✓ black_frames  judgement');
  });

  it('exits non-zero only on a failing finding', () => {
    expect(failedChecks(report)).toEqual(['duration']);
    expect(reportQc(report, true)).toBe(true);
    expect(reportQc({ ...report, findings: report.findings.slice(1) }, true)).toBe(false);
    expect(reportQc(undefined, true)).toBe(false);
  });
});

describe('--output placement', () => {
  it('refuses an output that is one of the inputs', () => {
    expect(() => assertOutputIsNotInput('/work/clip.mp4', ['/work/template.json', '/work/clip.mp4'])).toThrow(
      /--output \/work\/clip\.mp4 is also an input/
    );
    expect(() => assertOutputIsNotInput('/work/out.mp4', ['/work/clip.mp4'])).not.toThrow();
    expect(() => assertOutputIsNotInput(undefined, ['/work/clip.mp4'])).not.toThrow();
  });

  it('copies through a temp file and leaves no partial behind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-output-'));
    const result = path.join(dir, 'build', 'output.mp4');
    fs.mkdirSync(path.dirname(result));
    fs.writeFileSync(result, 'video');

    const target = path.join(dir, 'out', 'final.mp4');

    expect(await finalizeOutput(result, target)).toBe(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('video');
    expect(fs.readdirSync(path.dirname(target))).toEqual(['final.mp4']);
    // Same file: nothing to copy.
    expect(await finalizeOutput(result, result)).toBe(result);
    await expect(finalizeOutput(path.join(dir, 'missing.mp4'), path.join(dir, 'out', 'b.mp4'))).rejects.toThrow();
    expect(fs.readdirSync(path.dirname(target))).toEqual(['final.mp4']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
