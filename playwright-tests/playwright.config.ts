import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3001',
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: 'he-IL',
    screenshot: 'on',
    video: 'on',
  },
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
});
