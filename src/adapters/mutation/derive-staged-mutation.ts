import path from 'node:path';
import { isProxy } from 'node:util/types';
import type { SemanticMutationVerificationCapabilityPlan } from '../../assurance/verification/contract/types.ts';
import { mutationDiagnostic, semanticMutationByteDigest } from '../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest, semanticMutationStagedTransactionId } from '../../compiler/semantic-mutation/identity.ts';
import { normalizeSemanticMutationRequest } from '../../compiler/semantic-mutation/normalize-request.ts';
import {
  planSemanticMutation,
  planSemanticMutationWithVerificationPlanningProducer
} from '../../compiler/semantic-mutation/plan.ts';
import { preflightSemanticMutation } from '../../compiler/semantic-mutation/preflight.ts';
import { buildSemanticMutationVerificationPlanningContext } from '../../compiler/semantic-mutation/verification-policy.ts';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationTransactionInput } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationPlan, SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan, VerificationRequirement } from '../../semantics/mutation/types.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION } from '../../semantics/mutation/types.ts';
import {
  assertSameNoFollowDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { buildWorkspaceSemanticBundle } from '../workspace/semantic-bundle.ts';
import {
  planSemanticMutationSourceEdit,
  renderSemanticMutationSourceEdit
} from './plan-source-edit.ts';
import { readSemanticMutationSource } from './source-path-boundary.ts';
import { prepareSemanticMutationStagingWorkspace } from './staging-workspace.ts';
import {
  createSemanticMutationPathProofDirectory,
  createSemanticMutationTransactionDirectory
} from './transaction-directories.ts';
import {
  semanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
export { semanticMutationStagingCopyOptions } from './staging-workspace.ts';

export interface SemanticMutationPlanningCapabilityAdapter {
  readonly adapterId: string;
  readonly adapterRevision: string;
  capabilityPlan(
    staged: FactDeltaEndpointContext,
    requirements: readonly VerificationRequirement[],
    stagingWorkspaceRoot: string
  ): Promise<SemanticMutationVerificationCapabilityPlan>;
}

export interface DerivedSemanticMutationTransaction {
  readonly plan: SemanticMutationPlan;
  readonly transactionRoot?: string;
  readonly stagingWorkspaceRoot?: string;
  readonly editPlan?: SemanticMutationSourceEditPlan;
  readonly rollbackManifest?: SemanticMutationRollbackManifest;
  readonly originalBytes?: Uint8Array;
  readonly stagedBytes?: Uint8Array;
  readonly staged?: FactDeltaEndpointContext;
  readonly verificationCapabilityPlan?: SemanticMutationVerificationCapabilityPlan;
}

function endpointFromBundle(
  transactionId: string,
  snapshot: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>['snapshot']
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function safeStagedRebuildErrorCode(error: unknown): string {
  if (error === null || typeof error !== 'object' || isProxy(error)) return 'UNKNOWN';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)
    ? code
    : 'UNKNOWN';
}

/**
 * Public mutation diagnostics must never copy native error messages: Node and
 * Bun routinely include absolute workspace and transaction paths in them.
 */
export function semanticMutationStagedRebuildDiagnostic(
  error: unknown
): ReturnType<typeof mutationDiagnostic> {
  return mutationDiagnostic(
    'SEMANTIC-MUTATION-008',
    'staged-rebuild',
    'Isolated staged semantic rebuild failed',
    { details: { errorCode: safeStagedRebuildErrorCode(error) } }
  );
}

export async function deriveStagedSemanticMutation(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput,
  verificationAdapter: SemanticMutationPlanningCapabilityAdapter,
  commitFence: SemanticMutationCommitFence
): Promise<DerivedSemanticMutationTransaction> {
  const currentBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
  const currentBase = endpointFromBundle(input.base.transactionId, currentBundle.snapshot);
  const preflight = preflightSemanticMutation({
    request: input.request,
    base: currentBase,
    authorization: input.authorization
  });
  if (preflight.rejectedAt === 'request') return { plan: preflight };
  if (preflight.status === 'rejected') {
    return {
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation: {
          status: 'rejected',
          preflightRevision: preflight.preflightRevision,
          rejectedAt: preflight.rejectedAt as 'source-resolution',
          diagnostics: preflight.diagnostics
        }
      })
    };
  }

  const normalized = normalizeSemanticMutationRequest(input.request);
  const requestIdentityDigest = semanticMutationRequestIdentityDigest({
    graphId: normalized.graphId,
    appId: normalized.appId,
    requestId: normalized.requestId
  });
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
  const transactionIdentity = await createSemanticMutationTransactionDirectory(
    workspaceRoot, transactionRoot, commitFence
  );
  const stagingFence = async (): Promise<void> => {
    await commitFence();
    assertSameNoFollowDirectoryIdentity(transactionIdentity, 'Mutation staging transaction');
  };
  const pathProofDirectory = (await createSemanticMutationPathProofDirectory(
    transactionIdentity, stagingFence
  )).path;
  const sourcePlanning = await planSemanticMutationSourceEdit({
    request: input.request,
    base: currentBase,
    authorization: input.authorization,
    preflight,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    sourceCandidates: currentBundle.semanticContractSources,
    workspaceRoot,
    transactionDirectory: pathProofDirectory
  });
  if (sourcePlanning.status === 'rejected') {
    return {
      transactionRoot,
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation: sourcePlanning
      })
    };
  }

  await stagingFence();
  const editPlan = sourcePlanning.plan;
  const rollbackManifest = sourcePlanning.rollbackManifest;
  const originalBytes = new Uint8Array((await readSemanticMutationSource(
    workspaceRoot,
    transactionRoot,
    editPlan.relativePath
  )).bytes);
  if (semanticMutationByteDigest(originalBytes) !== editPlan.beforeByteDigest) {
    const preparation = {
      status: 'rejected' as const,
      preflightRevision: preflight.preflightRevision,
      rejectedAt: 'cas' as const,
      diagnostics: [mutationDiagnostic(
        'SEMANTIC-MUTATION-007',
        'cas',
        'Source bytes changed after deterministic edit planning',
        { relativePath: editPlan.relativePath }
      )]
    };
    return {
      transactionRoot,
      editPlan,
      rollbackManifest,
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation
      })
    };
  }
  const stagedBytes = renderSemanticMutationSourceEdit(editPlan, originalBytes);
  const stagingWorkspaceRoot = path.join(transactionRoot, 'workspace');
  await stagingFence();
  try {
    await prepareSemanticMutationStagingWorkspace({
      workspaceRoot,
      transactionRoot,
      plan: editPlan,
      manifest: rollbackManifest,
      originalBytes,
      stagedBytes,
      commitFence: stagingFence
    });
    await stagingFence();
    const stagedBundle = await buildWorkspaceSemanticBundle(stagingWorkspaceRoot);
    await stagingFence();
    const stagedTransactionId = semanticMutationStagedTransactionId({
      requestRevision: normalized.requestRevision,
      authorizationRevision: preflight.authorizationRevision,
      base: preflight.base,
      sourceEditPlanRevision: editPlan.editPlanRevision
    });
    const staged = endpointFromBundle(stagedTransactionId, stagedBundle.snapshot);
    let verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan | undefined;
    const plan = await planSemanticMutationWithVerificationPlanningProducer({
      request: input.request,
      base: currentBase,
      authorization: input.authorization,
      preparation: {
        status: 'prepared',
        preflightRevision: preflight.preflightRevision,
        sourceChanges: [{
          ownerId: editPlan.ownerId,
          adapterId: editPlan.adapterId,
          adapterRevision: editPlan.adapterRevision,
          relativePath: editPlan.relativePath,
          beforeByteDigest: editPlan.beforeByteDigest,
          stagedByteDigest: editPlan.stagedByteDigest,
          invalidationFromStage: 'resolve'
        }],
        staged,
        rollbackManifestDigest: rollbackManifest.rollbackManifestDigest
      }
    }, {
      async produce({ impact, requirements }) {
        verificationCapabilityPlan = await verificationAdapter.capabilityPlan(
          staged,
          requirements,
          stagingWorkspaceRoot
        );
        const capabilities = verificationCapabilityPlan.capabilities;
        return buildSemanticMutationVerificationPlanningContext({
          adapterId: verificationAdapter.adapterId,
          adapterRevision: verificationAdapter.adapterRevision,
          impactRevision: impact.impactRevision,
          uncertaintyStatus: capabilities.every((entry) => entry.status === 'runnable' && entry.isolated)
            ? 'covered'
            : 'blocked',
          capabilities
        }, requirements);
      }
    });
    return {
      plan,
      transactionRoot,
      stagingWorkspaceRoot,
      editPlan,
      rollbackManifest,
      originalBytes,
      stagedBytes,
      staged,
      ...(verificationCapabilityPlan ? { verificationCapabilityPlan } : {})
    };
  } catch (error) {
    const preparation = {
      status: 'rejected' as const,
      preflightRevision: preflight.preflightRevision,
      rejectedAt: 'staged-rebuild' as const,
      diagnostics: [semanticMutationStagedRebuildDiagnostic(error)]
    };
    return {
      transactionRoot,
      stagingWorkspaceRoot,
      editPlan,
      rollbackManifest,
      originalBytes,
      stagedBytes,
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation
      })
    };
  }
}
