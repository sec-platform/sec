import { expect, test } from 'bun:test';

import { assertDockerCommandOperationAvailable } from './container-engine-session.ts';
import { assertQualifiedLinuxDockerCli, qualifyLinuxDockerCli, type QualifiedLinuxDockerCli } from './linux-cli-qualification.ts';
import { openAuthenticatedLinuxDockerCommandProvider } from './linux-command-provider.ts';

test('copied CLI claims cannot remove the Linux rejection before physical transport', () => {
  let calls = 0;
  const forged = { identityDigest: `sha256:${'a'.repeat(64)}`, assertCurrent() { calls += 1; } } as unknown as QualifiedLinuxDockerCli;
  expect(() => assertQualifiedLinuxDockerCli(forged)).toThrow('not owner-issued');
  expect(() => assertDockerCommandOperationAvailable('linux', 'container-create', forged)).toThrow('not owner-issued');
  expect(calls).toBe(0);
});

test('fresh-job CLI rejects caller origin data before retaining tool or filesystem resources', async () => {
  let calls = 0;
  const origin = { assertCurrent() { calls += 1; } } as never;
  await expect(openAuthenticatedLinuxDockerCommandProvider({ origin, generation: {} as never,
    workingDirectory: '/must-not-be-opened', deadlineAtUnixMs: Date.now() + 10_000 })).rejects.toThrow();
  await expect(qualifyLinuxDockerCli({ origin, toolchain: {} as never,
    runtimeState: {} as never, endpoint: {} as never, workingDirectory: {} as never,
    deadlineAtUnixMs: Date.now() + 10_000 })).rejects.toThrow();
  expect(calls).toBe(0);
});
