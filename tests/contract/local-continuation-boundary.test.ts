import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

test('continuation exposes one managed development entrypoint and retires manual resume alias', () => {
  expect(packageJson.scripts?.['dev:continue'])
    .toBe('bun scripts/codex/local-continuation.ts continue');
  expect(packageJson.scripts?.['work:resume']).toBeUndefined();
});
