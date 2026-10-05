import type { PipelineExecutionContext } from '../../src/adapters/compilation-protocol/types.ts';
import { planSemanticMutationSourceEdit, type SemanticMutationSourceEditPlanningInput } from '../../src/adapters/mutation/plan-source-edit.ts';
import type { CiArtifactManifest } from '../../src/assurance/verification/ci-artifacts/contract/types.ts';
import type { VerificationReport } from '../../src/assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../src/assurance/verification/review/contract/types.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import { buildFactDelta } from '../../src/compiler/ir/build-fact-delta.ts';
import { planSemanticMutation } from '../../src/compiler/semantic-mutation/plan-semantic-mutation.ts';
import { preflightSemanticMutation } from '../../src/compiler/semantic-mutation/preflight-semantic-mutation.ts';
import { buildTrustedLocalSemanticMutationAuthorization, type TrustedLocalSemanticMutationAuthorizationInput, type TrustedLocalSemanticMutationPolicyDraft } from '../../src/compiler/semantic-mutation/trusted-authorization-ingress.ts';
import type { IsolatedVerificationCapability } from '../../src/execution/isolated-verification-capability.ts';
import type { FactDeltaEndpointContext } from '../../src/semantics/engineering-ir/delta-types.ts';
import type { EngineeringIR } from '../../src/semantics/engineering-ir/root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../src/semantics/engineering-ir/validated-types.ts';
import type { SemanticMutationApplyOutcome, SemanticMutationRequestRecordView } from '../../src/semantics/mutation/transaction.ts';
import type { SemanticMutationAuthorizationContext, SemanticMutationInput, SemanticMutationLoadedSourceCandidate, SemanticMutationPlan, SemanticMutationRequest } from '../../src/semantics/mutation/types.ts';
import type { SemanticViewSet } from '../../src/semantics/projection/types.ts';

// Compile-only contracts consumed by the repository tsconfig; no Bun test registration.
// compile-time boundaries keep proposal, trusted context, IR, Lock, Projection, artifacts, and reports distinct.
function semanticMutationBoundaries() {
  const proposal = {} as SemanticMutationRequest;
  const rawIR = {} as EngineeringIR;
  const endpoint = {} as FactDeltaEndpointContext;
  const authorization = {} as SemanticMutationAuthorizationContext;
  const lock = {} as LockFile;
  const views = {} as SemanticViewSet;
  const artifact = {} as CiArtifactManifest;
  const review = {} as ReviewSummary;
  const verification = {} as VerificationReport;
  const plan = {} as SemanticMutationPlan;
  const snapshot = {} as ValidatedEngineeringIRSnapshot;
  const trustedInput = {} as SemanticMutationInput;
  if (false) {
    // @ts-expect-error Raw EngineeringIR cannot replace the branded FactDelta endpoint.
    preflightSemanticMutation({ request: proposal, base: rawIR, authorization });
    // @ts-expect-error Proposal cannot replace trusted authorization.
    preflightSemanticMutation({ request: proposal, base: endpoint, authorization: proposal });
    // @ts-expect-error Lock state cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: lock });
    // @ts-expect-error Projection cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: views });
    // @ts-expect-error Artifact manifest cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: artifact });
    // @ts-expect-error Review summary cannot replace trusted preparation/base input.
    planSemanticMutation({ ...trustedInput, base: review });
    // @ts-expect-error Verification report cannot replace Verification planning context.
    planSemanticMutation({ ...trustedInput, verificationPlanning: verification });
    // @ts-expect-error A mutation plan is not a validated IR endpoint.
    buildFactDelta({ ...endpoint, snapshot: plan }, endpoint);
    // @ts-expect-error A raw snapshot-like value cannot be supplied as canonical Fact Delta.
    buildFactDelta({ ...endpoint, snapshot: rawIR }, { ...endpoint, snapshot });
  }
}
void semanticMutationBoundaries;

// proposal, raw IR, Lock, Projection, and arbitrary objects cannot replace trusted SM-2 inputs.
function semanticMutationSourceAdapterBoundaries() {
  const proposal = {} as SemanticMutationRequest;
  const source = {} as SemanticMutationLoadedSourceCandidate;
  const trusted = {} as SemanticMutationSourceEditPlanningInput;
  const trustedAuthorizationInput = {} as TrustedLocalSemanticMutationAuthorizationInput;
  const trustedLocalPolicy = {} as TrustedLocalSemanticMutationPolicyDraft;
  const authorization = {} as SemanticMutationAuthorizationContext;
  const rawIR = {} as EngineeringIR;
  const lock = {} as LockFile;
  const views = {} as SemanticViewSet;
  if (false) {
    // @ts-expect-error Proposal is not trusted loaded-source provenance.
    const candidate: SemanticMutationLoadedSourceCandidate = proposal;
    // @ts-expect-error Loaded source provenance is not a mutation proposal.
    const request: SemanticMutationRequest = source;
    // @ts-expect-error Raw IR cannot replace the branded Fact Delta endpoint.
    void planSemanticMutationSourceEdit({ ...trusted, base: rawIR });
    // @ts-expect-error Lock state cannot replace the source edit planning input.
    void planSemanticMutationSourceEdit(lock);
    // @ts-expect-error Projection state cannot replace the source edit planning input.
    void planSemanticMutationSourceEdit(views);
    // @ts-expect-error A complete authorization cannot replace the authority-free trusted-local policy draft.
    buildTrustedLocalSemanticMutationAuthorization({ ...trustedAuthorizationInput, policy: authorization });
    // @ts-expect-error A raw proposal lacks the normalized request revision required by the trusted ingress.
    buildTrustedLocalSemanticMutationAuthorization({ ...trustedAuthorizationInput, request: proposal });
    // @ts-expect-error Raw EngineeringIR cannot replace the branded Fact Delta endpoint.
    buildTrustedLocalSemanticMutationAuthorization({ ...trustedAuthorizationInput, base: rawIR });
    void candidate;
    void request;
    void trustedLocalPolicy;
  }
}
void semanticMutationSourceAdapterBoundaries;

// compile-time boundaries reject lease-free Pipeline contexts and raw journal fields in public views.
function semanticMutationApplyBoundaries() {
  const outcome = {} as SemanticMutationApplyOutcome;
  const view = {} as SemanticMutationRequestRecordView;
  type TransactionView = Extract<SemanticMutationRequestRecordView, { readonly recordKind: 'transaction' }>;
  type ActiveView = TransactionView & { readonly state: 'prepared' | 'authoring-committed' };
  if (false) {
    // @ts-expect-error Isolated Verification authority cannot be forged structurally.
    const forgedIsolationCapability: IsolatedVerificationCapability = {};
    // @ts-expect-error Every manual Pipeline execution context must carry the exact writer lease token.
    const leaseFree: PipelineExecutionContext = { transactionId: 'tx:test', source: 'api' };
    // @ts-expect-error Public request-record views never expose retained source paths.
    const pathLeak: string = view.relativePath;
    // @ts-expect-error Public request-record views never expose retained before bytes/digests.
    const beforeLeak: string = view.beforeByteDigest;
    // @ts-expect-error Apply outcomes are discriminated; a rejection has no terminal result.
    const result = outcome.result;
    const prepared = {} as ActiveView & { readonly state: 'prepared' };
    const authoringCommitted = {} as ActiveView & { readonly state: 'authoring-committed' };
    const verified = {} as TransactionView & { readonly state: 'verified' };
    const rolledBack = {} as TransactionView & { readonly state: 'rolled-back' };
    const recoveryRequired = {} as TransactionView & { readonly state: 'recovery-required' };
    // @ts-expect-error Prepared views never carry terminal completion order.
    const invalidPrepared: TransactionView = { ...prepared, terminalSequence: 1 };
    // @ts-expect-error Authoring-committed views never carry terminal results.
    const invalidAuthoringCommitted: TransactionView = { ...authoringCommitted, result: verified.result };
    // @ts-expect-error Verified views never carry recovery failure state.
    const invalidVerified: TransactionView = { ...verified, recoveryState: 'concurrent-write' };
    // @ts-expect-error Rolled-back views require a rolled-back result.
    const invalidRolledBack: TransactionView = { ...rolledBack, result: verified.result };
    // @ts-expect-error Recovery-required views never carry terminal completion order.
    const invalidRecoveryRequired: TransactionView = { ...recoveryRequired, terminalSequence: 1 };
    const { recoveryState: omittedRecoveryState, ...recoveryWithoutState } = recoveryRequired;
    // @ts-expect-error Recovery-required views require their matching recovery state.
    const invalidRecoveryWithoutState: TransactionView = recoveryWithoutState;
    void forgedIsolationCapability;
    void leaseFree;
    void pathLeak;
    void beforeLeak;
    void result;
    void invalidPrepared;
    void invalidAuthoringCommitted;
    void invalidVerified;
    void invalidRolledBack;
    void invalidRecoveryRequired;
    void invalidRecoveryWithoutState;
    void omittedRecoveryState;
  }
}
void semanticMutationApplyBoundaries;
