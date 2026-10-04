import childProcess from 'node:child_process';
import { ownEffectProcesses } from '../../src/effects/effect-processes.js';
const cleanup = ownEffectProcesses((ownedProcess) => process.send?.({ ownedProcess }));
process.on('exit', cleanup);
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('disconnect', () => {
  cleanup();
  process.exit(0);
});
const browser = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  detached: true,
  stdio: 'ignore',
});
process.send?.({ ready: browser.pid });
