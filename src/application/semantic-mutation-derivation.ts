import type { SemanticMutationVerificationCapabilityPlan } from '../assurance/verification/contract/types.ts';
import type { SemanticCompilation } from '../compiler/semantic-compiler.ts';
import { mutationDiagnostic, semanticMutationByteDigest } from '../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest, semanticMutationStagedTransactionId } from '../compiler/semantic-mutation/identity.ts';
import { normalizeSemanticMutationRequest } from '../compiler/semantic-mutation/normalize-request.ts';
import { planSemanticMutation, planSemanticMutationWithVerificationPlanningProducer } from '../compiler/semantic-mutation/plan-semantic-mutation.ts';
import { preflightSemanticMutation } from '../compiler/semantic-mutation/preflight-semantic-mutation.ts';
import { buildSemanticMutationVerificationPlanningContext } from '../compiler/semantic-mutation/verification-policy.ts';
import type { FactDeltaEndpointContext } from '../semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationTransactionInput } from '../semantics/mutation/transaction.ts';
import type { SemanticMutationLoadedSourceCandidate, SemanticMutationPlan, SemanticMutationPreflight, SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan, SemanticMutationSourceEditPlanningResult, VerificationRequirement } from '../semantics/mutation/types.ts';

export interface SemanticMutationPlanningCapability {
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

type Awaitable<T> = T | PromiseLike<T>;

export interface SemanticMutationDerivationBundle {
  readonly snapshot: SemanticCompilation['snapshot'];
  readonly semanticContractSources: readonly SemanticMutationLoadedSourceCandidate[];
}

/** Physical scope values are returned by the existing host owner. Application
 * cannot construct directory identities, grant a fence, or retire residues. */
export interface SemanticMutationDerivationScope {
  readonly transactionRoot: string;
  readonly stagingWorkspaceRoot: string;
}

export interface SemanticMutationDerivationOperations<Scope extends SemanticMutationDerivationScope> {
  readCurrentBundle(): Awaitable<SemanticMutationDerivationBundle>;
  prepareScope(requestIdentityDigest: string): Awaitable<Scope>;
  assertScope(scope: Scope): Awaitable<void>;
  planSourceEdit(scope: Scope, input: Readonly<{
    request: SemanticMutationTransactionInput['request'];
    base: FactDeltaEndpointContext;
    authorization: SemanticMutationTransactionInput['authorization'];
    preflight: SemanticMutationPreflight;
    sourceCandidates: readonly SemanticMutationLoadedSourceCandidate[];
  }>): Awaitable<SemanticMutationSourceEditPlanningResult>;
  readOriginalBytes(scope: Scope, relativePath: string): Awaitable<Uint8Array>;
  renderSourceEdit(plan: SemanticMutationSourceEditPlan, originalBytes: Uint8Array): Uint8Array;
  prepareWorkspace(scope: Scope, input: Readonly<{
    plan: SemanticMutationSourceEditPlan;
    manifest: SemanticMutationRollbackManifest;
    originalBytes: Uint8Array;
    stagedBytes: Uint8Array;
  }>): Awaitable<void>;
  readStagedBundle(scope: Scope): Awaitable<SemanticMutationDerivationBundle>;
  stagedRebuildDiagnostic(error: unknown): ReturnType<typeof mutationDiagnostic>;
}

function endpointFromBundle(
  transactionId: string,
  snapshot: SemanticCompilation['snapshot']
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

/** Derive one staged mutation, preserving the existing preflight, source CAS,
 * isolated rebuild and verification-planning order. Rejected results retain
 * any created scope for the original recovery owner; this flow neither cleans
 * partial effects nor retries a provider. The host retains every live fence. */
export async function deriveSemanticMutation<Scope extends SemanticMutationDerivationScope>(
  input: SemanticMutationTransactionInput,
  verificationAdapter: SemanticMutationPlanningCapability,
  operations: SemanticMutationDerivationOperations<Scope>
): Promise<DerivedSemanticMutationTransaction> {
  const { readCurrentBundle, prepareScope, assertScope, planSourceEdit,
    readOriginalBytes, renderSourceEdit, prepareWorkspace, readStagedBundle,
    stagedRebuildDiagnostic } = operations;
  const { adapterId, adapterRevision, capabilityPlan } = verificationAdapter;
  if ([readCurrentBundle, prepareScope, assertScope, planSourceEdit,
    readOriginalBytes, renderSourceEdit, prepareWorkspace, readStagedBundle,
    stagedRebuildDiagnostic, capabilityPlan].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Semantic Mutation derivation operations must be callable');
  }
  function invoke<Args extends unknown[], Result>(
    operation: (...args: Args) => Result, ...args: Args
  ): Result {
    return Reflect.apply(operation, operations, args) as Result;
  }
  // Capture selected method identities before suspension, retaining receivers.
  const currentBundle = await invoke(readCurrentBundle);
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
  const scope = await invoke(prepareScope, requestIdentityDigest);
  const { transactionRoot, stagingWorkspaceRoot } = scope;
  const sourcePlanning = await invoke(planSourceEdit, scope, {
    request: input.request,
    base: currentBase,
    authorization: input.authorization,
    preflight,
    sourceCandidates: currentBundle.semanticContractSources
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

  await invoke(assertScope, scope);
  const editPlan = sourcePlanning.plan;
  const rollbackManifest = sourcePlanning.rollbackManifest;
  const originalBytes = new Uint8Array(await invoke(readOriginalBytes, scope, editPlan.relativePath));
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
  const stagedBytes = invoke(renderSourceEdit, editPlan, originalBytes);
  await invoke(assertScope, scope);
  try {
    await invoke(prepareWorkspace, scope, {
      plan: editPlan,
      manifest: rollbackManifest,
      originalBytes,
      stagedBytes
    });
    await invoke(assertScope, scope);
    const stagedBundle = await invoke(readStagedBundle, scope);
    await invoke(assertScope, scope);
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
        verificationCapabilityPlan = await Reflect.apply(capabilityPlan, verificationAdapter, [staged, requirements, stagingWorkspaceRoot]) as SemanticMutationVerificationCapabilityPlan;
        const capabilities = verificationCapabilityPlan.capabilities;
        return buildSemanticMutationVerificationPlanningContext({
          adapterId,
          adapterRevision,
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
      diagnostics: [invoke(stagedRebuildDiagnostic, error)]
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
