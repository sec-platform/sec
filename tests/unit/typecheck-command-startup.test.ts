import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

test('typecheck command admits dependencies before loading the TypeScript execution closure', () => {
  const outcome = spawnSync(
    process.execPath,
    [path.resolve('tests/fixtures/typecheck-command-startup.ts')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024
    }
  );

  expect(outcome.status).toBe(0);
  expect(outcome.stderr).toBe('');
  expect(JSON.parse(outcome.stdout)).toEqual({
    calls: [
      'dependency:ensure',
      'dependency:readback',
      'generation:retain',
      'runner:load',
      'runner:execute:--diagnostic-only',
      'generation:retire'
    ],
    exitCode: 0
  });
});
