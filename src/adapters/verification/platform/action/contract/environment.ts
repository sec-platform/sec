import { sha256 } from '../../../../../contracts/canonical.ts';
import { SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS } from '../../../../../contracts/repository-test-path.ts';
import { LINUX_DOCKER_CLI_PROFILE_DIGEST } from '../../../../providers/docker/contract/linux-cli-profile.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import {
  computeSecLinuxVerificationRunnerInputDigest,
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  type SecLinuxVerificationEnvironmentAuthority
} from '../../../../providers/linux-verification/contract.ts';
import { CI_HOSTED_JOB_RUNTIME_POLICY, CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST } from '../../ci/contract/hosted-job-runtime-policy.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../ci/contract/revision.ts';

export const CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION =
  'sec-ci-verification-action-environment-v2' as const;

export const CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS = SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS;

export function createCiVerificationHostedToolchainRevision(
  authority: SecLinuxVerificationEnvironmentAuthority
): string {
  return `bun@${authority.trustedRuntime.bunVersion}`;
}

export function createCiVerificationHostedProviderRevision(
  authority: SecLinuxVerificationEnvironmentAuthority
): string {
  return `github-actions:self-hosted:ubuntu-${authority.ubuntu.version}:x64:`
    + `${authority.environmentId}:roles-control-trusted-sut-v1:`
    + `runner-${authority.archives.runner.version}:node-${authority.archives.node.version}:`
    + `python-${authority.runtime.pythonVersion}:unzip-6.00:`
    + `gh-${authority.archives.githubCli.version}:`
    + `gh-archive-sha256-${authority.archives.githubCli.digest.slice(7)}:`
    + `image-sha256-${authority.image.dockerProjectionDigest.slice(7)}:`
    + `container-init-v1:bun-${authority.trustedRuntime.bunVersion}:action-producer-v2:sandbox-v7`;
}

export const CI_VERIFICATION_HOSTED_PROVIDER_REVISION =
  createCiVerificationHostedProviderRevision(
    SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );
export const CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION =
  createCiVerificationHostedToolchainRevision(
    SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );

export function createCiVerificationPerJobHostedProviderRevision(
  authority: SecLinuxVerificationEnvironmentAuthority
): string {
  const executionPolicyDigest = sha256({
    schema: 'sec-ci-verification-per-job-execution-policy-v1',
    allocation: 'github-managed-per-job',
    platform: authority.platform,
    materializationInputDigest: computeSecLinuxVerificationRunnerInputDigest(authority),
    runtimeContentDigest: authority.image.runtimeContentDigest,
    dockerProjectionDigest: authority.image.dockerProjectionDigest,
    trustedRuntime: {
      imageSchema: authority.trustedRuntime.imageSchema,
      imageDigest: authority.trustedRuntime.imageDigest,
      bunVersion: authority.trustedRuntime.bunVersion,
      bunArchiveDigest: authority.trustedRuntime.bunArchiveDigest,
      bunExecutablePath: authority.trustedRuntime.bunExecutablePath,
      bunExecutableDigest: authority.trustedRuntime.bunExecutableDigest
    },
    resourceLimits: authority.runtime.resources,
    sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    dockerCliProfileDigest: LINUX_DOCKER_CLI_PROFILE_DIGEST,
    hostedJobPolicyDigest: CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST,
    actionProducerRevision: 'sec-ci-verification-action-producer-v2',
    outerJobContainerRevision: CI_HOSTED_JOB_RUNTIME_POLICY.revision,
    outerJobContainerPolicyDigest: CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST
  });
  // One canonical digest binds all required immutable inputs without exceeding
  // the existing 512-character Action environment revision transport bound.
  return `github-actions:github-hosted:ubuntu-${authority.ubuntu.version}:x64:per-job-v1:`
    + `execution-policy-${executionPolicyDigest}:action-producer-v2:sandbox-v7:${CI_HOSTED_JOB_RUNTIME_POLICY.revision}`;
}

export const CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION =
  createCiVerificationPerJobHostedProviderRevision(
    SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );
