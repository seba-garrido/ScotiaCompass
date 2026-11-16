import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Static demo' }));
  await mkdir('artifacts', { recursive: true });
});

test('official logos render and theme persists without resetting a query draft', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Conecta tus datos.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tema claro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.scotia-wordmark').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: 'artifacts/scotia-compass-brand-light.png', animations: 'disabled' });
  await page.locator('[data-action="connect"]').last().click();
  await page.locator('#conn-name').fill('Atlas · Integración');
  await page.locator('#connect-submit').click();
  await expect(page.locator('.document-card')).toHaveCount(20);
  await page.locator('#query-filter').fill('{ "status": "ERROR" }');
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#query-filter')).toHaveValue('{ "status": "ERROR" }');
  await page.screenshot({ path: 'artifacts/scotia-compass-brand-dark.png', animations: 'disabled' });
  await page.locator('[data-action="edit"]').first().click();
  await expect(page.locator('.document-editor')).toBeVisible();
  expect(await page.locator('.document-editor').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(23, 25, 34)');
  await page.screenshot({ path: 'artifacts/scotia-compass-dark-editor.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tema oscuro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.connection-item')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/scotia-compass-brand-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Tema claro', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
});

test('first visit follows system theme until the user chooses a theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Tema claro', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
