import { useState } from 'react';

export interface BrowserSupportCheck {
  id: 'camera' | 'engine' | 'fileHandling';
  labelKey: `browser:checks.${'camera' | 'engine' | 'fileHandling'}.name`;
  ok: boolean;
}

// Capabilities the in-browser record → compile flow needs: a camera to record the intro, the
// WASM + cross-origin-isolated threading stack ffmpeg.wasm runs on, and the File API for the clip.
// Evaluated once on mount (client-only globals) so the onboarding can gate "Create my intro" on a
// browser that can actually finish the flow, instead of failing mid-way.
// `navigator.mediaDevices` is typed non-nullish but is undefined in insecure contexts.
const supportsCamera = (): boolean => {
  const devices = navigator.mediaDevices as MediaDevices | undefined;

  if (!devices) {
    return false;
  }

  return 'getUserMedia' in devices;
};

const evaluateSupport = (): BrowserSupportCheck[] => [
  { id: 'camera', labelKey: 'browser:checks.camera.name', ok: supportsCamera() },
  {
    id: 'engine',
    labelKey: 'browser:checks.engine.name',
    ok: typeof WebAssembly === 'object' && typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated,
  },
  {
    id: 'fileHandling',
    labelKey: 'browser:checks.fileHandling.name',
    ok: typeof File !== 'undefined' && typeof FileReader !== 'undefined',
  },
];

export const useBrowserSupport = () => {
  const [checks] = useState<BrowserSupportCheck[] | null>(() =>
    typeof navigator === 'undefined' ? null : evaluateSupport()
  );

  return {
    checks,
    checking: checks === null,
    ready: checks?.every((check) => check.ok) ?? false,
  };
};
