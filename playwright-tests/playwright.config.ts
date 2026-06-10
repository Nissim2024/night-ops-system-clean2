import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3002',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'he-IL',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
});
