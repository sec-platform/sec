import type { SemanticMutationVerificationCapabilityPlan } from '../../../assurance/verification/contract/types.ts';
import type { FactDeltaEndpointContext } from '../../../semantics/engineering-ir/delta-types.ts';
import type { VerificationRequirement } from '../../../semantics/mutation/types.ts';
import type { WorkspaceWriteLeaseToken } from '../../filesystem/write-lease.ts';
import {
  probeIsolatedRuntimeCapability
} from './isolated/child.ts';
import {
  planSemanticMutationVerificationCapabilities
} from './verification.ts';

interface SemanticMutationIsolationCapabilityProbeRequest {
  readonly stagingWorkspaceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type SemanticMutationIsolationCapabilityProbeFactory = (
  request: SemanticMutationIsolationCapabilityProbeRequest
) => unknown | Promise<unknown>;

export const DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE:
  SemanticMutationIsolationCapabilityProbeFactory = async request => {
    const runtime = await probeIsolatedRuntimeCapability(
      request.stagingWorkspaceRoot
    );
    return runtime.status === 'available'
      ? runtime
      : Object.freeze({ status: 'unavailable' as const });
  };

export interface SemanticMutationVerificationPlanningAdapter {
  readonly adapterId: string;
  readonly adapterRevision: string;
  capabilityPlan(
    staged: FactDeltaEndpointContext,
    requirements: readonly VerificationRequirement[],
    stagingWorkspaceRoot: string
  ): Promise<SemanticMutationVerificationCapabilityPlan>;
}

export function createSemanticMutationVerificationPlanningAdapter(input: Readonly<{
  adapterId: string;
  adapterRevision: string;
  workspaceRoot: string;
  workspaceWriteLease: WorkspaceWriteLeaseToken;
  isolationCapabilityProbe?: SemanticMutationIsolationCapabilityProbeFactory;
}>): SemanticMutationVerificationPlanningAdapter {
  const probe = input.isolationCapabilityProbe ??
    DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE;
  return Object.freeze({
    adapterId: input.adapterId,
    adapterRevision: input.adapterRevision,
    capabilityPlan(
      staged: FactDeltaEndpointContext,
      requirements: readonly VerificationRequirement[],
      stagingWorkspaceRoot: string
    ) {
      return planSemanticMutationVerificationCapabilities({
        snapshot: staged.snapshot,
        requirements,
        isolationCapabilityProbe: () => probe({
          stagingWorkspaceRoot,
          workspaceRoot: input.workspaceRoot,
          workspaceWriteLease: input.workspaceWriteLease
        })
      });
    }
  });
}
