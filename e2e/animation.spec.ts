// The lesson 1 animation player (src/components/Explainer.tsx, issue #3). Open-source Chromium cannot play H.264, so the
// committed MP4 is transcoded once to a small WebM in the OS temp directory (never committed) and served where the
// player looks for it. The tests that need a pause-at-step prompt run against the real <Explainer> on a throwaway Vite
// page (e2e/fixtures/explainer), because no shipped lesson has a prompt yet.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import { answerQuiz, availableModules, completeInteraction, completeChoice, expectAccessible, ROOT, topLevel } from './lib';

const ID = 'a01-press-run';
const DIR = path.join(ROOT, 'public', 'animations', ID);
const steps = JSON.parse(readFileSync(path.join(DIR, 'steps.json'), 'utf8')) as {
  duration: number; title: string; transcript: string; captions: string; stills: Record<string, string>;
  steps: { key: string; label: string; time: number; end: number }[];
};
const first = steps.steps[0];
const last = steps.steps[steps.steps.length - 1];

/** MP4 -> small WebM (VP9, 480 px wide, 10 fps, no audio: the animation has none), cached by the MP4's size and mtime. */
function webmFixture(): string {
  const mp4 = path.join(DIR, `${ID}.mp4`);
  const st = statSync(mp4);
  const dir = path.join(os.tmpdir(), 'tdcc-e2e-animation');
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${ID}-${st.size}-${Math.floor(st.mtimeMs)}.webm`);
  if (!existsSync(out)) {
    const tmp = `${out}.${process.pid}.tmp.webm`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', 'scale=480:-2,fps=10', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '45',
      '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', tmp]);
    renameSync(tmp, out);
  }
  return out;
}

/** Serve the WebM where the player looks for it, with Range support (seeking needs it), and hide H.264 from the page so the WebM source is always chosen. */
async function useWebm(page: Page, file: string) {
  const body = readFileSync(file);
  await page.addInitScript(() => {
    const can = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type: string) { return /mp4|avc1/i.test(type) ? '' : can.call(this, type); };
  });
  await page.route(`**/animations/${ID}/${ID}.webm`, route => {
    const m = /bytes=(\d*)-(\d*)/.exec(route.request().headers()['range'] ?? '');
    const headers = { 'content-type': 'video/webm', 'accept-ranges': 'bytes' };
    if (!m) return route.fulfill({ status: 200, headers: { ...headers, 'content-length': String(body.length) }, body });
    const start = Number(m[1] || 0);
    const end = Math.min(Number(m[2] || body.length - 1), body.length - 1);
    return route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': String(end - start + 1) }, body: body.subarray(start, end + 1) });
  });
}

const video = (page: Page) => page.locator('video');
const time = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);
const paused = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.paused);
const chip = (page: Page, label: string) => page.getByRole('list', { name: 'Jump to a step' }).getByRole('button', { name: label, exact: true });
const seekTo = (page: Page, t: number) => video(page).evaluate((v: HTMLVideoElement, t) => { v.currentTime = t; }, t);

let fixtureServer: ViteDevServer;
let fixtureUrl: string;
let webm: string;

test.beforeAll(async () => {
  webm = webmFixture();
  fixtureServer = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    root: path.join(ROOT, 'e2e', 'fixtures', 'explainer'),
    publicDir: path.join(ROOT, 'public'),
    cacheDir: path.join(os.tmpdir(), 'tdcc-e2e-vite-cache'),
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1', hmr: false, fs: { strict: false } },
  });
  await fixtureServer.listen();
  fixtureUrl = `http://127.0.0.1:${(fixtureServer.httpServer!.address() as AddressInfo).port}/`;
});
test.afterAll(async () => { await fixtureServer?.close(); });

async function openFixture(page: Page, query = '?pauses=0', { video: hasVideo = true } = {}) {
  await useWebm(page, webm);
  await page.goto(`${fixtureUrl}${query}`);
  await expect(page.getByRole('figure', { name: `Animation: ${steps.title}` })).toBeVisible();
  if (hasVideo) await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
}

test.describe('animation player', () => {
  test('playback starts with the keyboard and runs to the end', async ({ page }) => {
    await openFixture(page);
    expect(await paused(page)).toBe(true);
    await video(page).focus();
    await page.keyboard.press('Space');
    await expect.poll(() => time(page)).toBeGreaterThan(0.3);
    expect(await paused(page)).toBe(false);
    await seekTo(page, steps.duration - 1.5);
    await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.ended), { timeout: 20_000 }).toBe(true);
    expect(await time(page)).toBeGreaterThan(steps.duration - 0.5);
  });

  test('step chips seek to the step time and highlight the current step', async ({ page }) => {
    await openFixture(page);
    for (const s of steps.steps) {
      await chip(page, s.label).click();
      await expect.poll(() => time(page), { message: `after the "${s.label}" chip` }).toBeGreaterThanOrEqual(s.time);
      expect(await time(page)).toBeLessThan(s.time + 3);
      await expect(chip(page, s.label)).toHaveClass(/active/);
    }
    // In the exit fade between a step's `end` and the next step's `time` the chip stays on the step that just played.
    await video(page).evaluate((v: HTMLVideoElement) => v.pause());
    await seekTo(page, first.end + 0.2);
    await expect(chip(page, first.label)).toHaveClass(/active/);
    await expect(chip(page, steps.steps[1].label)).not.toHaveClass(/active/);
    await chip(page, last.label).focus();
  });

  test('captions are on by default and the transcript is available', async ({ page }) => {
    await openFixture(page);
    const vtt = readFileSync(path.join(DIR, steps.captions), 'utf8');
    const firstCue = vtt.split(/\n\n/)[1].split('\n').slice(1).join(' ').trim();
    await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.textTracks[0]?.mode)).toBe('showing');
    expect(await video(page).evaluate((v: HTMLVideoElement) => v.textTracks[0].kind)).toBe('captions');
    await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.textTracks[0].cues?.length ?? 0)).toBeGreaterThan(0);
    expect(await video(page).evaluate((v: HTMLVideoElement) => (v.textTracks[0].cues![0] as VTTCue).text)).toBe(firstCue);
    await expect(page.getByText(/captions on/)).toBeVisible();

    const details = page.locator('details', { has: page.getByText('Transcript', { exact: true }) });
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    const transcript = readFileSync(path.join(DIR, steps.transcript), 'utf8').replace(/\s+/g, ' ').trim();
    await expect(details.locator('p')).toBeVisible();
    expect(((await details.locator('p').textContent()) ?? '').replace(/\s+/g, ' ').trim()).toBe(transcript);
  });

  test('keyboard: space plays and pauses, arrows seek, chips and the stills toggle work with Enter and Space', async ({ page }) => {
    await openFixture(page);
    const v = video(page);
    await v.focus();
    await page.keyboard.press('Space');
    await expect.poll(() => paused(page)).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(() => paused(page)).toBe(true);
    await seekTo(page, 10);
    await expect.poll(() => time(page)).toBe(10);
    await v.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => time(page)).toBeGreaterThan(10); // the step size is the browser's own, so only the direction is asserted
    const afterRight = await time(page);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => time(page)).toBeLessThan(afterRight);

    const target = steps.steps[2];
    await chip(page, target.label).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => time(page)).toBeGreaterThanOrEqual(target.time);
    expect(await time(page)).toBeLessThan(target.time + 3);

    const toggle = page.getByRole('checkbox', { name: /step-by-step stills/ });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(v).toHaveCount(0);
  });

  test('reduced motion shows the step stills instead of the video', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFixture(page, '?pauses=0', { video: false });
    const figure = page.getByRole('figure', { name: `Animation: ${steps.title}` });
    await expect(figure).toBeVisible();
    await expect(video(page)).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /step-by-step stills/ })).toBeChecked();
    for (const [i, s] of steps.steps.entries()) {
      const img = figure.getByRole('img', { name: s.label, exact: true });
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute('src', new RegExp(`${steps.stills[s.key].replace('.', '\\.')}$`));
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth), `still "${s.key}" loads`).toBeGreaterThan(0);
      await expect(figure.getByText(`Step ${i + 1} of ${steps.steps.length}: ${s.label}`)).toBeVisible();
      if (i < steps.steps.length - 1) await figure.getByRole('button', { name: /Next/ }).click();
    }
    await expect(figure.getByRole('button', { name: /Next/ })).toBeDisabled();
    await page.getByRole('checkbox', { name: /step-by-step stills/ }).uncheck();
    await expect(video(page)).toHaveCount(1);
  });

  test('a pause-at-step prompt pauses the video and unlocks on answer', async ({ page }) => {
    await openFixture(page, '');
    const step = steps.steps[1];
    const dialog = page.getByRole('dialog', { name: 'Predict before continuing' });
    await expect(dialog).toHaveCount(0);
    await seekTo(page, step.end - 1);
    await video(page).evaluate((v: HTMLVideoElement) => void v.play());
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    expect(await paused(page)).toBe(true);
    expect(Math.abs((await time(page)) - step.end)).toBeLessThan(0.5);
    // It stays paused, with Continue not offered, until the learner answers.
    await page.waitForTimeout(1000);
    expect(await paused(page)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Continue' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'The editor', exact: true }).click(); // a wrong answer still unlocks
    await expect(dialog.getByText(/It's “clang”/)).toBeVisible();
    for (const b of await dialog.getByRole('button', { name: /^(The editor|clang|The browser tab)$/ }).all()) await expect(b).toBeDisabled();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => time(page)).toBeGreaterThan(step.end + 0.3);
    expect(await paused(page)).toBe(false);

    // Answered once: playing through the step again does not pause.
    await seekTo(page, step.end - 0.5);
    await expect.poll(() => time(page)).toBeGreaterThan(step.end + 0.8);
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('lesson 1', () => {
  test('the question after the animation stays locked until it is answered', async ({ page }) => {
    const mod = availableModules()[0];
    await useWebm(page, webm);
    await page.goto(`#/m/${mod.id}/retrieval`);
    await answerQuiz(page, mod, 'retrieval');
    await page.getByRole('button', { name: 'Finish warm-up' }).click();
    await expect(page.getByText('Warm-up done: the lessons are open.')).toBeVisible();
    await page.goto(`#/m/${mod.id}/${mod.lessons[0].stem}`);
    const figure = page.getByRole('figure', { name: /^Animation: / });
    const cardWithAnimation = page.locator('section[data-card]').filter({ has: figure });
    // Complete every card before the animation's, the way a learner does.
    for (let i = 0; i < 20 && (await cardWithAnimation.count()) === 0; i++) {
      const card = page.locator(`section[data-card="${i}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('[data-loading="true"]')).toHaveCount(0);
      for (const box of await topLevel(card).all()) await completeInteraction(page, mod, box);
      await expect(page.locator(`section[data-card="${i + 1}"]`)).toBeVisible();
    }
    await expect(cardWithAnimation).toBeVisible();
    const k = Number(await cardWithAnimation.getAttribute('data-card'));
    const next = page.locator(`section[data-card="${k + 1}"]`);
    await expect(next).toHaveCount(0);

    // Watching the whole animation does not unlock it.
    await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await seekTo(page, steps.duration - 1.5);
    await video(page).evaluate((v: HTMLVideoElement) => void v.play());
    await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.ended), { timeout: 20_000 }).toBe(true);
    await expect(next).toHaveCount(0);

    await expectAccessible(page, 'lesson 1 animation card');
    const box: Locator = topLevel(cardWithAnimation).first();
    await completeChoice(box);
    await expect(next).toBeVisible();
  });
});
