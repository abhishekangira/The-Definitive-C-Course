// E2E click-through (PLAN.md §3.5). Runs against the production build served by `vite preview`,
// so run `npm run build` first (CI does). In the cloud container Chromium lives in /opt/pw-browsers.
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const executablePath = process.env.CHROMIUM_PATH ?? localChromium;
const port = Number(process.env.E2E_PORT ?? 4173);

// The file started at workers: 1 in 178daf8, with no comment.
// fullyParallel stays false: test.describe.serial groups share one page.
// CI uses 2. On ubuntu-24.04 (nproc=4, about 16 GB; load average was not logged)
// a same-day bench had 2 workers at about 1.6 min (3 runs) and 4 workers at
// about 1.5–1.6 min (3 runs) then about 1.7–1.8 min (10 runs), so 4 was not
// clearly faster. A later 2-worker bench was slower, about 2.1–2.2 min, 10/10
// clean (run 39066202287); the check on that commit was 2.2 min with 0 flakes
// (39066183837). Of 16 suite runs at 4 workers, 14 were clean and 2 were flaky:
// toolchain-download test 2 hung to the 10 min timeout and passed on retry
// (39061303176, 39063039817). The review saw that test fail about 1/30 at 1
// worker; the cause was not found. One worker was about 2.5 min on main (149 s,
// run 39030536834) and about 3.0 min on the bench. Local default stays 3.
// No run failed with the CPU-time limit message; headroom under the 5 s
// watchdog was not measured.
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
