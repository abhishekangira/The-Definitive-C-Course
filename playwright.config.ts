// E2E click-through (PLAN.md §3.5). Runs against the production build served by `vite preview`,
// so run `npm run build` first (CI does). In the cloud container Chromium lives in /opt/pw-browsers.
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const executablePath = process.env.CHROMIUM_PATH ?? localChromium;
const port = Number(process.env.E2E_PORT ?? 4173);

// CI uses 4 workers. The file started at workers: 1 in 178daf8, with no comment.
// fullyParallel stays false: test.describe.serial groups share one page.
// On an idle 4-vCPU ubuntu-24.04 runner, 4 workers was the fastest setup that
// stayed green (13/13 runs, 0 flakes, about 1.5–1.8 min vs about 3.0 min at
// 1 worker; issue #45). 2 workers was about as fast but hit the existing
// animation still-load flake. A heavy/light split was no faster than 2 workers.
// The run watchdog is wall-clock (5 s) and did not fire. Outside CI the
// machine is often shared, so stay at 1 worker.
export default defineConfig({
  testDir: 'e2e',
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: process.env.CI ? 4 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
