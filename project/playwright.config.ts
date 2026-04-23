import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests/runtime/acceptance',
  reporter: 'line',
  use: {
    baseURL,
    trace: 'off'
  },
  webServer: {
    command: 'next dev --hostname 127.0.0.1 --port 3001',
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
