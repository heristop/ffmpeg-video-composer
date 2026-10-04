import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { terminateEffectProcess } from '../src/effects/effect-processes.js';

it.skipIf(process.platform === 'win32')(
  'cleans a real detached startup-stalled browser before worker exit',
  async () => {
    const worker = childProcess.fork(
      fileURLToPath(new URL('./fixtures/effect-process-worker.ts', import.meta.url)),
      [],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }
    );
    let browserPid: number | undefined;
    try {
      const ready = new Promise<number>((resolve, reject) => {
        worker.on('error', reject);
        worker.on('message', (message: { ready?: number }) => {
          if (message.ready) resolve(message.ready);
        });
        worker.on('exit', () => {
          if (!browserPid) reject(new Error('Worker exited before launching browser'));
        });
      });
      browserPid = await ready;
      expect(process.kill(browserPid, 0)).toBe(true);
      const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
      worker.kill('SIGTERM');
      await exited;
      await vi.waitFor(() => expect(() => process.kill(browserPid!, 0)).toThrow(), { timeout: 2000 });
    } finally {
      worker.kill('SIGKILL');
      if (browserPid) terminateEffectProcess({ pid: browserPid, detached: true }, 'SIGKILL');
    }
  }
);

it('uses Windows tree termination for an owned process', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const taskkill = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.alloc(0));
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    terminateEffectProcess({ pid: 424243, detached: true }, 'SIGKILL');
    expect(taskkill).toHaveBeenCalledWith('taskkill', ['/PID', '424243', '/T', '/F'], {
      stdio: 'ignore',
      timeout: 2000,
    });
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
    taskkill.mockRestore();
  }
});
