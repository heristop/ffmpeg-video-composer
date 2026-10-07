import { defineConfig, devices } from '@playwright/test';

// E2E config for the in-browser FFmpeg WASM template-compilation checks.
// Reuses a running dev server (default :5174); override with E2E_BASE_URL to point at another port.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
// A preinstalled Chromium (e.g. in a sandbox without `playwright install`) via E2E_CHROMIUM_PATH.
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 20 * 60 * 1000,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
