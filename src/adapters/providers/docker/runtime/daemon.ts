import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import {
  ExternalProviderCoordinationLeaseError,
  withUserExternalProviderCoordinationLease
} from '../../../runtime-state/workspace-state/external-provider-coordination-lease.ts';
import { DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';
import { dockerDesktopCoordinationInput } from './launcher-lock.ts';

export async function withDockerDesktopLauncherLock<T>(
  input: Readonly<{
    endpointHost: string;
    operation: BoundSemanticOperation;
    repositoryRoot: string;
    requirementId: string;
  }>,
  operation: () => Promise<T>
): Promise<T | null> {
  try {
    return await withUserExternalProviderCoordinationLease({
      coordination: dockerDesktopCoordinationInput({
        endpointHost: input.endpointHost,
        providerOperation: input.operation,
        requirementId: input.requirementId,
        repositoryRoot: input.repositoryRoot
      }),
      operation: async () => await operation()
    });
  } catch (error) {
    if (error instanceof DockerDaemonAvailabilityFailure) throw error;
    if (error instanceof ExternalProviderCoordinationLeaseError) {
      const reason = error.reason === 'deadline-exhausted'
        ? 'deadline-exhausted'
        : error.reason === 'path-unavailable'
          ? 'desktop-launcher-path-unavailable'
          : error.reason === 'settlement-unknown'
            ? 'desktop-launcher-settlement-unknown'
            : 'desktop-environment-unavailable';
      throw new DockerDaemonAvailabilityFailure({
        endpointHost: input.endpointHost,
        reason,
        phase: error.reason === 'settlement-unknown'
          ? 'process-settlement'
          : 'admission',
        providerEvidence: error.message
      });
    }
    throw new DockerDaemonAvailabilityFailure({
      endpointHost: input.endpointHost,
      reason: 'desktop-environment-unavailable',
      phase: 'admission',
      providerEvidence: error instanceof Error ? error.message : String(error)
    });
  }
}
