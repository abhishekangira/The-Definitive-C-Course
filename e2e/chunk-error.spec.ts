// A page chunk that fails to load (offline, or stale after a deploy) must show a retry message, not "Page not found".
import { test, expect } from '@playwright/test';
import { availableModules, courseTitle } from './lib';

const mod = availableModules()[0];

test('a failed page chunk shows a retry alert, and Retry recovers once the chunk loads', async ({ page }) => {
  let blocked = true;
  await page.route(/ModulePage-.*\.js/, route => (blocked ? route.abort('failed') : route.continue()));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: courseTitle() })).toBeVisible();
  // Client-side navigation (hash change), so the lazy route import runs and is aborted.
  await page.evaluate(id => { location.hash = `#/m/${id}`; }, mod.id);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('This page could not be loaded');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);

  blocked = false;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { level: 1, name: mod.meta.title })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
