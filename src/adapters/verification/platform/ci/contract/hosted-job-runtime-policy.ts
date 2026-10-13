import { sha256 } from '../../../../../contracts/canonical.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY, SEC_LINUX_VERIFICATION_NATIVE_PROFILE_DIGEST } from '../../../../providers/linux-verification/contract.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from './revision.ts';

/** Required outer boundary. It is not a live observation or authorization. */
export const CI_HOSTED_JOB_RUNTIME_POLICY = Object.freeze({
  schema: 'sec-hosted-job-runtime-policy-v1' as const,
  revision: 'outer-job-container-v1' as const,
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
  terminal: 'execution-output-container-and-provider-scope-settled' as const
});
export const CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST = sha256(CI_HOSTED_JOB_RUNTIME_POLICY);

/** Native execution is a new physical interpretation. The legacy policy above
 * remains an exact historical decoder input, never an execution fallback. */
export const CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY = Object.freeze({
  schema: 'sec-hosted-job-native-runtime-policy-v1' as const,
  revision: 'native-transient-verification-unit-v1' as const,
  nativeProfileDigest: SEC_LINUX_VERIFICATION_NATIVE_PROFILE_DIGEST,
  source: 'exact-authenticated-trusted-source-private-read-only-snapshot' as const,
  candidate: 'existing-inner-retained-archive-sandbox-v7' as const,
  credentials: 'authenticated-origin-retained-in-host-control-parent' as const,
  command: 'fixed-trusted-hosted-sut-native-unit-entry' as const,
  outputBytesPerStream: 8 * 1024 * 1024,
  terminal: 'inner-supervisor-and-original-native-unit-all-domain-settlement' as const,
  unknownEffect: 'retain-original-operation-and-exact-readback-no-name-only-delete' as const
});
export const CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY_DIGEST = sha256(CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY);
