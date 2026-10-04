import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export interface OwnedEffectProcess {
  pid: number;
  detached: boolean;
}

/** Terminate only a process/tree launched by this job, never a browser found by name. */
export function terminateEffectProcess(owned: OwnedEffectProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') {
      childProcess.execFileSync('taskkill', ['/PID', String(owned.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 2000,
      });

      return;
    }
    process.kill(owned.detached ? -owned.pid : owned.pid, signal);
  } catch {
    // An already-exited process is normal. Cleanup remains best effort at the OS boundary.
  }
}

/**
 * Installed only in the isolated effect worker, before loading Remotion. Remotion launches
 * detached Chrome before its own startup cleanup handlers exist. Capture ownership at spawn,
 * synchronously, so even cancellation during the DevTools handshake can clean that group.
 */
export function ownEffectProcesses(report: (owned: OwnedEffectProcess) => void): () => void {
  const original = childProcess.spawn;
  const owned = new Map<number, OwnedEffectProcess>();
  let stopping = false;
  childProcess.spawn = ((...args: unknown[]) => {
    const child = Reflect.apply(original, childProcess, args) as childProcess.ChildProcess;
    const options = (Array.isArray(args[1]) ? args[2] : args[1]) as { detached?: boolean } | undefined;

    if (child.pid && (options?.detached || process.platform === 'win32')) {
      const processInfo = { pid: child.pid, detached: Boolean(options?.detached) };
      owned.set(child.pid, processInfo);
      report(processInfo);

      if (stopping) terminateEffectProcess(processInfo, 'SIGKILL');
    }

    return child;
  }) as typeof original;
  syncBuiltinESMExports();

  return () => {
    stopping = true;

    for (const processInfo of owned.values()) terminateEffectProcess(processInfo, 'SIGKILL');
  };
}
