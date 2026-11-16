import { test, expect } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, BSON } from 'mongodb';
import { createApp } from '../../server/app.mjs';

test('live UI connects by URI and performs BSON-safe CRUD against isolated MongoDB', async ({ page }) => {
  const mongod = await MongoMemoryServer.create();
  const mongo = await new MongoClient(mongod.getUri()).connect();
  const col = mongo.db('workspace').collection('EventLog');
  await col.insertOne({ marker: 'integration', amount: BSON.Long.fromString('9007199254740993'), at: new Date('2026-11-13T00:00:00Z') });
  const { app, close } = createApp({ allowedOrigin: 'http://127.0.0.1:4319', audit: () => {} });
  const server = await new Promise(resolve => { const server = app.listen(4319, '127.0.0.1', () => resolve(server)); });
  try {
    await page.goto('http://127.0.0.1:4319');
    await expect(page.getByRole('heading', { name: 'Conecta tus datos.' })).toBeVisible();
    await expect(page.locator('.connection-item')).toHaveCount(0);
    await page.locator('[data-action="connect"]').last().click();
    await page.locator('#conn-name').fill('MongoDB aislado');
    await page.locator('#conn-uri').fill('URI inválida');
    await page.locator('#connect-submit').click();
    await expect(page.locator('#modal-error')).toContainText('URI');
    await expect(page.locator('.connection-item')).toHaveCount(0);
    await page.locator('#conn-uri').fill(mongod.getUri());
    await page.locator('#conn-database').fill('workspace');
    await page.locator('#connect-submit').click();
    await expect(page.locator('.document-card')).toHaveCount(1);
    await expect(page.locator('#mode-label')).toHaveText('Conexiones reales');
    await expect(page.locator('.document-body')).toContainText('9007199254740993');
    await page.locator('[data-action="disconnect-profile"]').click();
    await expect(page.locator('.connection-item')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.profile-status')).toHaveText('Desconectada');
    await page.locator('[data-action="reconnect-profile"]').click();
    await expect(page.locator('.document-card')).toHaveCount(1);
    await page.locator('[data-action="edit"]').click();
    const original = JSON.parse(await page.locator('#document-editor').inputValue());
    original.changed = true;
    await page.locator('#document-editor').fill(JSON.stringify(original, null, 2));
    await page.locator('#write-submit').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await col.findOne({ marker: 'integration' })).changed).toBe(true);
    expect((await col.findOne({ marker: 'integration' })).amount.toString()).toBe('9007199254740993');
    await page.locator('[data-action="insert"]').click();
    await page.locator('#document-editor').fill('{ "marker": "new-live" }');
    await page.locator('#write-submit').click();
    await expect(page.locator('.document-card')).toHaveCount(2);
    const card = page.locator('.document-card').filter({ hasText: 'new-live' });
    await card.locator('[data-action="delete"]').click();
    await page.locator('#delete-submit').click();
    await expect(page.locator('.document-card')).toHaveCount(1);
    expect(await col.countDocuments()).toBe(1);
    await page.getByRole('tab', { name: 'Índices' }).click();
    await expect(page.locator('.secondary-panel')).toContainText('{"_id":1}');
  } finally {
    await new Promise(resolve => server.close(resolve)); await close(); await mongo.close(); await mongod.stop();
  }
});
