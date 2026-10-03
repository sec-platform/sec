import { sha256 } from '../../../../../contracts/canonical.ts';
import { LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST } from '../../../../providers/docker/contract/linux-hosted-bootstrap-profile.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../../providers/linux-verification/contract.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from './revision.ts';

/** Required candidate/untrusted outer boundary; never live qualification. */
export const CI_HOSTED_JOB_RUNTIME_POLICY = Object.freeze({
  schema: 'sec-hosted-job-runtime-policy-v1' as const,
  revision: 'outer-job-container-v1' as const,
  appliesTo: 'candidate-and-untrusted-execution' as const,
  trustedHost: 'authenticated-orchestration-api-and-reviewed-source-materialization-only' as const,
  linuxBootstrapPolicyDigest: LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST,
  sutMountPolicy: 'owned-enforced-apparmor-profile-for-exact-inner-unit-root' as const,
  innerObservation: 'kernel-exec-stop-and-owned-pid-namespace-init-final-wait' as const,
  image: SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.imageDigest,
  bun: SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutableDigest,
  source: 'exact-authenticated-trusted-checkout-read-only-copy-to-private-workspace' as const,
  candidate: 'existing-inner-retained-archive-sandbox-v7' as const,
  credentials: 'trusted-commands-only-no-actions-files-or-oidc-request-credentials' as const,
  rootFilesystem: 'read-only' as const,
  init: true as const,
  restart: 'no' as const,
  noNewPrivileges: true as const,
  capDrop: Object.freeze(['ALL'] as const),
  sutCapAdd: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outerSutContainerCapabilities,
  resourceLimits: SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.runtime.resources,
  outputBytesPerStream: 8 * 1024 * 1024,
  foreignOrBusyCleanup: 'preserve-and-report-unknown' as const,
  removal: 'exact-retained-id-after-owned-process-and-container-stop-settlement' as const,
  unknownEffect: 'retain-original-operation-and-exact-readback-no-name-only-delete' as const,
  terminal: 'execution-output-container-engine-bootstrap-profile-and-provider-scope-settled' as const
});
export const CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST = sha256(CI_HOSTED_JOB_RUNTIME_POLICY);
