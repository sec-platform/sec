import { defineConfig } from '@playwright/test';

const port = parseInt(process.env.TEST_PORT ?? '3001', 10);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/runtime/acceptance',
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `next dev --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
