// E2E click-through (PLAN.md §3.5). Runs against the production build served by `vite preview`,
// so run `npm run build` first (CI does). Chromium: CHROMIUM_PATH, else /opt/pw-browsers when it exists, else Playwright's
// own (in the `npm run setup` image, PLAYWRIGHT_BROWSERS_PATH=/ms-playwright; e2e/AGENTS.md).
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const executablePath = process.env.CHROMIUM_PATH ?? localChromium;
const port = Number(process.env.E2E_PORT ?? 4173);

// fullyParallel stays false: test.describe.serial groups share one page.
// CI uses 2 workers and local runs 3; the benchmarks behind both numbers are in
// docs/adr/0002-e2e-workers.md. Bench again before changing them.
export default defineConfig({
  testDir: 'e2e',
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
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
