// E2E click-through (PLAN.md §3.5). Runs against the production build served by `vite preview`,
// so run `npm run build` first (CI does). In the cloud container Chromium lives in /opt/pw-browsers.
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const executablePath = process.env.CHROMIUM_PATH ?? localChromium;
const port = Number(process.env.E2E_PORT ?? 4173);

// Default stays 1 while issue #45 measures other setups via E2E_WORKERS (CI bench).
// fullyParallel stays false: several files share one page inside test.describe.serial.
function workerCount(): number {
  const raw = process.env.E2E_WORKERS;
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new Error(`E2E_WORKERS must be an integer from 1 to 8, got ${JSON.stringify(raw)}`);
  return n;
}
const workers = workerCount();
if (process.env.E2E_WORKERS) console.log(`playwright workers=${workers} (from E2E_WORKERS)`);

export default defineConfig({
  testDir: 'e2e',
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers,
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
