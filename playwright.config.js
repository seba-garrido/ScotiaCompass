import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4327', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', viewport: { width: 1600, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node server/index.mjs', url: 'http://127.0.0.1:4327', reuseExistingServer: false, timeout: 30000, env: { PORT: '4327', HOST: '127.0.0.1', APP_ORIGIN: 'http://127.0.0.1:4327', APP_ACCESS_TOKEN: '', SCOTIA_DATA_DIR: './artifacts/ui-server-data' } }
});
