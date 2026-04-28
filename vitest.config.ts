import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: true,
    globalSetup: ['tests/setup/runtime-deps.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['platform/**/*.ts'],
      exclude: ['platform/cli/**', 'tests/**']
    }
  }
});
