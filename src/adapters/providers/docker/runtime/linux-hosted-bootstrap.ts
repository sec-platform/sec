import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import type { AuthenticatedGitHubJobOrigin } from '../../github-api/hosted-job-origin.ts';
import {
  applyHostedBootstrapProcess, assertHostedBootstrapProcessCurrent,
  observeHostedBootstrapProcess, prepareHostedBootstrapProcess,
  retireHostedBootstrapProcess, type HostedBootstrapProcess
} from './linux-hosted-bootstrap-process.ts';

/** Opaque, process-local ownership. A source policy or JSON cannot recreate it. */
export type AuthenticatedLinuxHostedBootstrap = HostedBootstrapProcess;

export function prepareAuthenticatedLinuxHostedBootstrap(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  deadlineAtUnixMs: number;
  sandboxRoots: readonly string[];
}>): AuthenticatedLinuxHostedBootstrap {
  return prepareHostedBootstrapProcess(input);
}

/** Non-authoritative readback, including ownership after expiry/cancellation. */
export function observeAuthenticatedLinuxHostedBootstrap(handle: AuthenticatedLinuxHostedBootstrap) {
  const observed = observeHostedBootstrapProcess(handle);
  return Object.freeze({ ...observed, daemonConfigDigest: observed.physical?.config.digest ?? null,
    profileObservation: observed.physical === null ? null : Object.freeze({
      inputDigest: observed.inputProfileDigest,
      kernelEnforcement: observed.physical.profileState,
      // The kernel observation is not represented as a source-byte digest.
      observer: 'retained-root-helper-securityfs' as const
    }) });
}

/** Must finish before retaining an Engine socket, or creating any SEC container. */
export async function applyAuthenticatedLinuxHostedBootstrap(handle: AuthenticatedLinuxHostedBootstrap,
  input: Readonly<{ operation: BoundSemanticOperation; requirementId: string }>): Promise<void> {
  await applyHostedBootstrapProcess(handle, input);
}

export async function assertAuthenticatedLinuxHostedBootstrapCurrent(handle: AuthenticatedLinuxHostedBootstrap): Promise<void> {
  await assertHostedBootstrapProcessCurrent(handle);
}

/**
 * Consumer first settles its exact containers and Engine. The owner independently
 * rereads every current container's profile, refusing to unload a profile still
 * referenced by any container. No caller-provided settled boolean is accepted.
 * Daemon configuration/cache remains owned by the disposable VM lifetime.
 */
export async function retireAuthenticatedLinuxHostedBootstrap(handle: AuthenticatedLinuxHostedBootstrap): Promise<void> {
  await retireHostedBootstrapProcess(handle);
}
