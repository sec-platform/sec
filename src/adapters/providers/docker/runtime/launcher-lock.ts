import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import type { ExternalProviderCoordinationLeaseInput } from '../../../runtime-state/workspace-state/external-provider-coordination-lease.ts';

export const DOCKER_DESKTOP_COORDINATION_PROVIDER_ID = 'docker.desktop' as const;

/** Docker owns only the semantic projection; Runtime State owns every lease Effect. */
export function dockerDesktopCoordinationInput(input: Readonly<{
  endpointHost: string;
  providerOperation: BoundSemanticOperation;
  repositoryRoot: string;
  requirementId: string;
}>): ExternalProviderCoordinationLeaseInput {
  return Object.freeze({
    endpointIdentity: input.endpointHost,
    operation: input.providerOperation,
    providerId: DOCKER_DESKTOP_COORDINATION_PROVIDER_ID,
    requirementId: input.requirementId,
    repositoryRoot: input.repositoryRoot
  });
}
