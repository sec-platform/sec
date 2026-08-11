import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

test('VerificationSession physical closeout CLI crash and replay partitions', () => {
  const unitFile = path.resolve(import.meta.dir, '../unit/verification-session-runtime.test.ts');
  const result = spawnSync(process.execPath, [
    'test',
    '--test-name-pattern',
    '^(trusted remote default ref synchronization|public Session closeout CLI|V9 integration reruns)',
    unitFile
  ], {
    cwd: path.resolve(import.meta.dir, '../..'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 900_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      SEC_VERIFICATION_SESSION_CLOSEOUT_CLI_E2E: '1'
    }
  });
  expect(
    result.status,
    `physical closeout CLI partition failed:\n${String(result.stdout).slice(-8_000)}\n${String(result.stderr).slice(-8_000)}`
  ).toBe(0);
}, 900_000);
