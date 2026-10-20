// Google Drive sync (src/progress/drive.ts). Google is a stub: the sign-in script and the Drive v3 API are served
// from memory with context.route, so no request reaches Google and no account is needed.
// The panel exists only in a build made with VITE_GOOGLE_CLIENT_ID (CI's build has it from the GOOGLE_CLIENT_ID
// repository variable). Without one, these tests skip: run `VITE_GOOGLE_CLIENT_ID=x.apps.googleusercontent.com npm run build` first.
import { readdirSync, readFileSync } from 'node:fs';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, progressJson } from './lib';

const configured = readdirSync('dist/assets').some(f => f.endsWith('.js') && readFileSync(`dist/assets/${f}`, 'utf8').includes('.apps.googleusercontent.com'));

/** An in-memory app-data folder shared by every context of one test. */
class FakeDrive {
  files = new Map<string, string>();
  calls: string[] = [];
  private next = 1;

  async wire(context: BrowserContext) {
    // Google Identity Services: hand out a token with the Drive scope at once.
    await context.route('https://accounts.google.com/**', r => r.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { oauth2: {
        initTokenClient: c => ({ requestAccessToken: () => setTimeout(() => c.callback({ access_token: 'tok', expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.appdata' }), 20) }),
        revoke: () => {},
      } } };`,
    }));
    await context.route('https://www.googleapis.com/**', async r => {
      const req = r.request();
      const url = new URL(req.url());
      const method = req.method();
      if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      this.calls.push(`${method} ${url.pathname}`);
      const headers = { 'access-control-allow-origin': '*' };
      const id = /\/files\/([^/]+)$/.exec(url.pathname)?.[1];
      if (method === 'GET' && url.pathname === '/drive/v3/files') return r.fulfill({ headers, json: { files: [...this.files.keys()].map(f => ({ id: f })) } });
      if (method === 'POST' && url.pathname === '/drive/v3/files') {
        const created = `f${this.next++}`;
        this.files.set(created, '');
        return r.fulfill({ headers, json: { id: created } });
      }
      if (id && method === 'GET') return r.fulfill({ headers, status: this.files.has(id) ? 200 : 404, body: this.files.get(id) ?? '' });
      if (id && method === 'PATCH') { this.files.set(id, req.postData() ?? ''); return r.fulfill({ headers, json: { id } }); }
      return r.fulfill({ status: 500 });
    });
  }

  lessons(): string[] {
    const [text] = [...this.files.values()];
    return Object.keys((JSON.parse(text) as { lessons: object }).lessons).sort();
  }
}

async function open(browser: Browser, drive: FakeDrive, colorScheme: 'light' | 'dark' = 'light'): Promise<Page> {
  const context = await browser.newContext({ colorScheme });
  await drive.wire(context);
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  page.on('dialog', d => void d.accept());
  await page.goto('#/settings');
  return page;
}

async function connect(page: Page) {
  const panel = page.getByRole('group', { name: 'Google Drive' });
  await panel.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(panel.getByText(/saves to Google Drive automatically\. Last sync: today/)).toBeVisible();
}

/** A merge-import of a file with one finished lesson: a change this tab makes, like finishing the lesson. */
async function finishLesson(page: Page, lesson: string) {
  const seed = (await progressJson(page)).seed as string;
  const file = { version: 1, seed, createdAt: new Date().toISOString(), lessons: { [lesson]: { completedAt: new Date().toISOString() } } };
  await page.locator('input[type=file]').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole('button', { name: 'Merge with my progress' }).click();
}

test.describe('Google Drive sync', () => {
  test.skip(!configured, 'this build has no VITE_GOOGLE_CLIENT_ID, so the Drive panel is not in it');
  test.setTimeout(60_000);

  test('connect, autosave, retrieve in another browser, and a reset that reaches it', async ({ browser }) => {
    const drive = new FakeDrive();
    const a = await open(browser, drive);
    await expectAccessible(a, 'settings with Drive sync off (light)');
    await connect(a);
    expect(drive.calls).toEqual(['GET /drive/v3/files', 'POST /drive/v3/files', 'PATCH /upload/drive/v3/files/f1']);

    await finishLesson(a, 'm01-l1');
    await expect.poll(() => drive.lessons(), { timeout: 15_000 }).toEqual(['m01-l1']);

    const b = await open(browser, drive, 'dark');
    await connect(b);
    expect(Object.keys((await progressJson(b)).lessons)).toEqual(['m01-l1']);
    expect((await progressJson(b)).seed).toBe((await progressJson(a)).seed);
    await expectAccessible(b, 'settings with Drive sync on (dark)');

    await b.getByRole('button', { name: 'Reset all progress' }).click();
    await expect.poll(() => drive.lessons(), { timeout: 15_000 }).toEqual([]);
    // A still holds the lesson; its next sync adopts the reset instead of merging the lesson back.
    await a.reload();
    await expect.poll(async () => Object.keys((await progressJson(a)).lessons), { timeout: 15_000 }).toEqual([]);
    expect(drive.lessons()).toEqual([]);
  });

  test('a change uploads from the tab that made it, not from every open tab', async ({ browser }) => {
    const drive = new FakeDrive();
    const a = await open(browser, drive);
    await connect(a);
    const second = await a.context().newPage();
    await second.goto('#/settings');
    await expect(second.getByText(/Last sync: today/)).toBeVisible();
    // Let the second tab's start-up pull finish before counting.
    await expect.poll(() => drive.calls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
    await second.waitForTimeout(500);
    drive.calls = [];

    await finishLesson(a, 'm01-l1');
    await expect.poll(() => drive.lessons(), { timeout: 15_000 }).toEqual(['m01-l1']);
    // AUTOSAVE_DELAY_MS is 4 s: wait past a second tab's timer too, then count downloads.
    await a.waitForTimeout(6000);
    expect(drive.calls.filter(c => c.startsWith('GET /drive/v3/files/'))).toHaveLength(1);
  });
});
