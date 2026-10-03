import { expect, test } from 'bun:test';

import { sha256 } from '../../../../contracts/canonical.ts';
import { assertDockerCommandProviderCapability } from '../runtime/command-provider.ts';
import { assertDockerCommandOperationAvailable, LINUX_DOCKER_OPERATIONS } from '../runtime/container-engine-session.ts';
import type { DockerCommandProviderCapability } from './command-provider.ts';
import { LINUX_DOCKER_CLI_PROFILE, LINUX_DOCKER_CLI_PROFILE_DIGEST } from './linux-cli-profile.ts';
import { LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST } from './linux-static-toolchain.ts';

test('fresh-job CLI policy binds the complete static supply and default plugin search domain', () => {
  expect(LINUX_DOCKER_CLI_PROFILE.staticToolchainDigest).toBe(LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST);
  expect(LINUX_DOCKER_CLI_PROFILE.pluginSearch.systemDirectories).toEqual([
    '/usr/local/lib/docker/cli-plugins',
    '/usr/local/libexec/docker/cli-plugins',
    '/usr/lib/docker/cli-plugins',
    '/usr/libexec/docker/cli-plugins'
  ]);
  expect(LINUX_DOCKER_CLI_PROFILE.pluginSearch.extraDirectoryOrder)
    .toEqual(['pinned-static-generation', 'private-deny-candidates']);
  expect(LINUX_DOCKER_CLI_PROFILE.pluginSearch.denyCandidate)
    .toEqual({ bytes: 0, mode: 0o400, links: 1 });
  expect(LINUX_DOCKER_CLI_PROFILE_DIGEST).toBe(sha256(LINUX_DOCKER_CLI_PROFILE));
});

test('CLI policy data and its digest cannot mint a Docker capability or enable generic Linux', () => {
  expect(LINUX_DOCKER_CLI_PROFILE.authority).toBe('policy-only');
  expect(() => assertDockerCommandProviderCapability(
    { ...LINUX_DOCKER_CLI_PROFILE, providerIdentityDigest: LINUX_DOCKER_CLI_PROFILE_DIGEST } as unknown as DockerCommandProviderCapability
  )).toThrow('not owner-issued');
  expect(LINUX_DOCKER_OPERATIONS).toEqual([]);
  expect(() => assertDockerCommandOperationAvailable('linux', 'container-create'))
    .toThrow('linux-cli-plugin-closure-unavailable');
  expect(() => assertDockerCommandOperationAvailable('linux', 'buildx-build'))
    .toThrow('linux-buildx-closure-unavailable');
});
