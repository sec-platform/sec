import { acquirePhysicalMutationLease } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import type { PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';

export function dockerDesktopLauncherLeaseName(endpointHost: string): string {
  const endpointDigest = sha256({
    schema: 'sec-docker-desktop-launcher-lock-v1',
    endpointHost
  }).slice('sha256:'.length);
  return `sec-docker-desktop-launcher-${endpointDigest}.lease.json`;
}

/**
 * Serializes one launcher operation beneath the exact directory identity
 * issued by the physical owner. This function never discovers or invents a
 * path; production supplies the current token's retained Known Folder.
 */
export async function withDockerDesktopLauncherLockAtOwnerIssuedDirectory<T>(input: Readonly<{
  deadlineAtUnixMs: number;
  endpointHost: string;
  operation: () => Promise<T>;
  parent: PhysicalDirectoryIdentity;
}>): Promise<T | null> {
  const remaining = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || remaining < 1) {
    throw new DockerDaemonAvailabilityFailure({
      endpointHost: input.endpointHost,
      reason: 'deadline-exhausted'
    });
  }
  const lease = acquirePhysicalMutationLease(
    input.parent,
    dockerDesktopLauncherLeaseName(input.endpointHost),
    { ttlMs: remaining }
  );
  if (lease === null) return null;
  try {
    return await input.operation();
  } finally {
    try {
      lease.release();
    } catch {
      throw new DockerDaemonAvailabilityFailure({
        endpointHost: input.endpointHost,
        reason: 'desktop-launcher-settlement-unknown'
      });
    }
  }
}
