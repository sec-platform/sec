import { expect, test } from 'bun:test';

import type { RetainedNoFollowProvenDirectoryGeneration } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertDockerCommandOperationAvailable } from './container-engine-session.ts';
import {
  assertRetainedLinuxDockerStaticToolchain,
  retainLinuxDockerStaticToolchain,
  type RetainedLinuxDockerStaticToolchain
} from './linux-static-toolchain.ts';

test('serialized static-tool observations cannot mint physical Docker authority', async () => {
  let assertions = 0;
  const forged = {
    identityDigest: `sha256:${'a'.repeat(64)}`,
    toolchainDigest: `sha256:${'b'.repeat(64)}`,
    assertCurrent: async () => { assertions += 1; },
    close: () => {}
  } as RetainedLinuxDockerStaticToolchain;
  await expect(assertRetainedLinuxDockerStaticToolchain(forged)).rejects.toThrow('not owner-issued');
  expect(assertions).toBe(0);
});

test('static-tool admission rejects caller-shaped generations before scanning paths or tools', async () => {
  let assertions = 0;
  const forged = {
    root: { path: '/must-not-be-read' },
    assertCurrent: () => { assertions += 1; },
    assertAuthorityCurrent: async () => { assertions += 1; }
  } as unknown as RetainedNoFollowProvenDirectoryGeneration;
  await expect(retainLinuxDockerStaticToolchain({
    generation: forged, deadlineAtUnixMs: Date.now() + 10_000
  })).rejects.toThrow();
  expect(assertions).toBe(0);
});

test('static-tool supply does not enable the unqualified Linux Engine operation guard', () => {
  expect(() => assertDockerCommandOperationAvailable('linux', 'buildx-bake'))
    .toThrow('linux-buildx-closure-unavailable');
  expect(() => assertDockerCommandOperationAvailable('linux', 'container-create'))
    .toThrow('linux-cli-plugin-closure-unavailable');
});
