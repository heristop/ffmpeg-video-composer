import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let directory: string;
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'probe-cancellation-')));
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

it.skipIf(process.platform === 'win32').each(['discovery', 'media'] as const)(
  'kills an active ffprobe during %s on cancellation',
  async (stage) => {
    const pidFile = path.join(directory, 'pid');
    const source = `#!${process.execPath}
const fs = require('node:fs');
if (${JSON.stringify(stage)} === 'media' && process.argv.includes('-version')) process.exit(0);
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`;
    await fs.writeFile(path.join(directory, 'ffprobe'), source, { mode: 0o755 });
    vi.stubEnv('PATH', `${directory}${path.delimiter}${process.env.PATH}`);
    const { probeMedia } = await import('../src/tools/probeMedia.js');
    const controller = new AbortController();
    const pending = probeMedia('/unused.mp4', 1, undefined, controller.signal).then(
      () => null,
      (error: Error) => error
    );
    let pid: number | undefined;
    try {
      await vi.waitFor(async () => {
        pid = Number(await fs.readFile(pidFile, 'utf8'));
      });
      controller.abort();
      await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 250 });
      expect(await pending).toMatchObject({ name: 'AbortError' });
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await pending;
    }
  }
);
