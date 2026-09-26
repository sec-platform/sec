import {
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  type LinuxVerificationEnvironmentAuthority
} from '../../../../providers/linux-verification/contract.ts';

export const CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION =
  'sec-ci-verification-action-environment-v2' as const;

export const CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS = Object.freeze([
  '.bun-version',
  'bun.lock',
  'bunfig.toml',
  'package.json'
] as const);

export function createCiVerificationHostedToolchainRevision(
  authority: LinuxVerificationEnvironmentAuthority
): string {
  return `bun@${authority.trustedRuntime.bunVersion}`;
}

export function createCiVerificationHostedProviderRevision(
  authority: LinuxVerificationEnvironmentAuthority
): string {
  return `github-actions:self-hosted:ubuntu-${authority.ubuntu.version}:x64:`
    + `${authority.environmentId}:roles-control-trusted-sut-v1:`
    + `runner-${authority.archives.runner.version}:node-${authority.archives.node.version}:`
    + `python-${authority.runtime.pythonVersion}:unzip-6.00:`
    + `gh-${authority.archives.githubCli.version}:`
    + `gh-archive-sha256-${authority.archives.githubCli.digest.slice(7)}:`
    + `image-sha256-${authority.image.dockerProjectionDigest.slice(7)}:`
    + `container-init-v1:bun-${authority.trustedRuntime.bunVersion}:action-producer-v2:sandbox-v6`;
}

export const CI_VERIFICATION_HOSTED_PROVIDER_REVISION =
  createCiVerificationHostedProviderRevision(
    LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );
export const CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION =
  createCiVerificationHostedToolchainRevision(
    LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );
