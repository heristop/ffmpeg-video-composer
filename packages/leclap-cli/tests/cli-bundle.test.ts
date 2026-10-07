import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../dist/index.js');

interface CliResult {
  code: number;
  output: string;
  stdout: string;
}

// Run the BUILT dist/index.js as a real subprocess (resolves even on non-zero exit so the test
// asserts on output). Catches a bundle that drifted from source — e.g. a class method the core's
// dist never emitted — which mocked unit tests can't see. Requires `pnpm build` first.
function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: here, timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;

        if (error === null) {
          resolve({ code: 0, output, stdout });

          return;
        }

        resolve({ code: typeof error.code === 'number' ? error.code : 1, output, stdout });
      }
    );
  });
}

describe('CLI bundle (dist/index.js)', () => {
  it('renders a template end-to-end via the `render` subcommand', async () => {
    const fixture = path.join(here, 'fixtures/cli-smoke.json');
    const { code, output } = await runCli(['render', fixture]);

    expect(output).not.toMatch(/is not a function/);
    expect(output).not.toMatch(/"level":\d+/); // engine JSON logs are silenced
    expect(output).toContain('Rendered');
    expect(code).toBe(0);
  }, 90_000);

  // An unknown filter type is schema-valid (filter types reach FFmpeg verbatim), so the failure happens
  // while the engine renders the segment — the case that used to come back as a bare
  // "Compilation failed to produce output".
  it('reports why the engine failed in the --json error', async () => {
    const fixture = path.join(here, 'fixtures/unknown-filter.json');
    const { code, stdout } = await runCli(['render', fixture, '--json']);
    const result = JSON.parse(stdout) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^FFmpeg command failed/);
    expect(result.error).toContain('definitelynotafilter');
    expect(code).toBe(1);
  }, 90_000);

  // P0 exit criterion through the shipped CLI: render with a manifest, verify the file against it, then
  // re-render the recorded template and match every digest (template, assets, graph, output).
  it('renders with --manifest and verifies it, including a byte-identical re-render', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-verify-'));
    const video = path.join(work, 'out.mp4');
    const fixture = path.join(here, 'fixtures/cli-deterministic.json');
    const rendered = await runCli([
      'render',
      fixture,
      '--output',
      video,
      '--manifest',
      '--build',
      path.join(work, 'build'),
    ]);

    expect(rendered.code).toBe(0);
    expect(fs.existsSync(`${video}.manifest.json`)).toBe(true);

    const verified = await runCli([
      'verify',
      `${video}.manifest.json`,
      '--rerender',
      '--json',
      '--build',
      path.join(work, 'again'),
    ]);
    const result = JSON.parse(verified.stdout) as { ok: boolean; checks: Array<{ check: string; ok: boolean }> };

    expect(result.checks.map((check) => check.check)).toEqual(['output', 'template', 'assets', 'graph', 'output']);
    expect(result.ok).toBe(true);
    expect(verified.code).toBe(0);

    fs.appendFileSync(video, 'tampered');
    const tampered = await runCli(['verify', `${video}.manifest.json`, '--json']);

    expect(JSON.parse(tampered.stdout)).toMatchObject({ ok: false });
    expect(tampered.code).toBe(1);
  }, 180_000);

  it('checks the output with --qc and reuses sections with --cache', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-qc-'));
    const fixture = path.join(here, 'fixtures/cli-deterministic.json');
    const args = ['render', fixture, '--qc', '--json', '--cache', path.join(work, 'cache')];
    const first = await runCli([...args, '--build', path.join(work, 'build')]);
    const result = JSON.parse(first.stdout) as {
      ok: boolean;
      qc: { verified: boolean; findings: Array<{ check: string; status: string }> };
    };

    expect(first.code).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.qc.verified).toBe(true);
    expect(result.qc.findings.map((finding) => finding.check)).toContain('black_frames');
    expect(fs.readdirSync(path.join(work, 'cache')).length).toBeGreaterThan(0);

    const clip = path.join(work, 'build', 'output.mp4');
    const clobber = await runCli(['render', fixture, '--json', '--video', `intro=${clip}`, '--output', clip]);

    expect(clobber.code).toBe(1);
    expect(JSON.parse(clobber.stdout)).toMatchObject({ ok: false, error: expect.stringMatching(/is also an input/) });
  }, 180_000);
});
