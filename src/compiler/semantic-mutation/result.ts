import { SEMANTIC_MUTATION_CONTRACT_VERSION, type SemanticMutationBase, type SemanticMutationDiagnostic, type SemanticMutationPlan, type SemanticMutationResult, type SemanticMutationVerificationExecutionRef } from '../../semantics/mutation/types.ts';
import {
  canonicalDiagnostics,
  canonicalEquals,
  cloneAndDeepFreeze,
  exactOwnKeys,
  mutationDiagnostic,
  nonEmptyString,
  sha256
} from './canonical.ts';
import { assertSemanticMutationPlanInvariant } from './plan.ts';
import { semanticMutationRequiredVerificationDigest } from './verification-policy.ts';

type ReadyPlan = Extract<SemanticMutationPlan, { readonly status: 'ready' }>;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function exactEndpoint(value: SemanticMutationBase): boolean {
  return exactOwnKeys(value as unknown as Record<string, unknown>, [
    'transactionId', 'inputRevision', 'semanticRevision'
  ]);
}

export type SemanticMutationTerminalEvidence =
  | {
      readonly status: 'accepted';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBase;
      readonly accepted: SemanticMutationBase;
      readonly verification: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
    }
  | {
      readonly status: 'rejected';
      readonly transactionId?: string;
      readonly attempted?: SemanticMutationBase;
      readonly verification?: SemanticMutationVerificationExecutionRef;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    }
  | {
      readonly status: 'rolled-back';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBase;
      readonly verification: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    }
  | {
      readonly status: 'recovery-required';
      readonly transactionId: string;
      readonly attempted: SemanticMutationBase;
      readonly verification: SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
      readonly recoveryState: 'rollback-failed' | 'restore-validation-failed' | 'rebuild-failed' | 'concurrent-write';
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    };

export function semanticMutationVerificationExecutionRevision(
  value: Omit<SemanticMutationVerificationExecutionRef, 'verificationExecutionRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-verification-execution-v1', ...value });
}

function verificationDiagnostic(
  plan: ReadyPlan,
  verification: SemanticMutationVerificationExecutionRef | undefined,
  attempted: SemanticMutationBase | undefined
): SemanticMutationDiagnostic[] {
  if (!verification || !attempted) {
    return [mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      'Terminal result requires exact Verification execution evidence'
    )];
  }
  const { verificationExecutionRevision: _revision, ...withoutRevision } = verification;
  const expectedRequiredDigest = semanticMutationRequiredVerificationDigest(plan.requiredVerification);
  const valid = exactOwnKeys(verification as unknown as Record<string, unknown>, [
    'adapterId', 'adapterRevision', 'reportRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'status', 'verificationExecutionRevision'
  ]) &&
    exactEndpoint(verification.attempted) && exactEndpoint(attempted) &&
    nonEmptyString(verification.adapterId) &&
    nonEmptyString(verification.adapterRevision) &&
    nonEmptyString(verification.reportRevision) &&
    SHA256_PATTERN.test(verification.reportRevision) &&
    verification.adapterId === plan.verificationAdapterId &&
    verification.adapterRevision === plan.verificationAdapterRevision &&
    verification.planRevision === plan.planRevision &&
    canonicalEquals(verification.attempted, attempted) &&
    canonicalEquals(attempted, plan.staged) &&
    verification.stagedSourceDigest === plan.sourceChanges[0].stagedByteDigest &&
    verification.requiredVerificationDigest === expectedRequiredDigest &&
    verification.verificationExecutionRevision === semanticMutationVerificationExecutionRevision(withoutRevision);
  return valid ? [] : [mutationDiagnostic(
    'SEMANTIC-MUTATION-010',
    'impact-verification',
    'Verification execution evidence is stale, partial, or bound to the wrong plan/source endpoint'
  )];
}

function resultRevision(value: Omit<SemanticMutationResult, 'resultRevision'>): string {
  return sha256({ domain: 'semantic-mutation-result-v2', ...value });
}

export function buildSemanticMutationResult(
  plan: SemanticMutationPlan,
  evidence?: SemanticMutationTerminalEvidence
): SemanticMutationResult {
  assertSemanticMutationPlanInvariant(plan);
  if (plan.status === 'rejected') {
    if (evidence !== undefined && evidence.status !== 'rejected') {
      throw new Error('Rejected plans can only produce a rejected terminal result');
    }
    if (plan.rejectedAt === 'request') {
      throw new Error('Minimal request rejection has no canonical base/planRevision and cannot form a v2 terminal result');
    }
    const diagnostics = canonicalDiagnostics(plan.diagnostics);
    if (diagnostics.length === 0) throw new Error('Rejected terminal result requires diagnostics');
    const withoutRevision = {
      contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
      requestId: plan.requestId,
      requestRevision: plan.requestRevision,
      planRevision: plan.planRevision,
      base: plan.base,
      status: 'rejected' as const,
      ...('actualDelta' in plan ? { actualDelta: plan.actualDelta } : {}),
      ...('impact' in plan ? { impact: plan.impact } : {}),
      sourceChanges: [...plan.sourceChanges],
      diagnostics
    };
    return cloneAndDeepFreeze({ ...withoutRevision, resultRevision: resultRevision(withoutRevision) } as SemanticMutationResult);
  }
  if (!evidence) throw new Error('Ready plans require terminal evidence');
  const diagnostics = canonicalDiagnostics(evidence.status === 'accepted' ? [] : evidence.diagnostics);
  if (evidence.status === 'rejected') {
    if (diagnostics.length === 0) throw new Error('Rejected terminal result requires non-empty diagnostics');
    const attemptedIsBound = evidence.attempted === undefined || (
      exactEndpoint(evidence.attempted) &&
      canonicalEquals(evidence.attempted, plan.staged)
    );
    const attemptedDiagnostics = attemptedIsBound ? [] : [mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      'Rejected terminal attempted endpoint does not bind the ready plan'
    )];
    const verificationDiagnostics = evidence.verification === undefined
      ? []
      : verificationDiagnostic(plan, evidence.verification, evidence.attempted);
    const rejected = {
      contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
      requestId: plan.requestId,
      requestRevision: plan.requestRevision,
      planRevision: plan.planRevision,
      base: plan.base,
      status: 'rejected' as const,
      ...(evidence.transactionId === undefined ? {} : { transactionId: evidence.transactionId }),
      ...(evidence.attempted === undefined || !attemptedIsBound ? {} : { attempted: evidence.attempted }),
      actualDelta: plan.actualDelta,
      impact: plan.impact,
      sourceChanges: [...plan.sourceChanges],
      ...(evidence.verification === undefined || verificationDiagnostics.length > 0
        ? {}
        : { verification: evidence.verification }),
      diagnostics: canonicalDiagnostics([...diagnostics, ...attemptedDiagnostics, ...verificationDiagnostics])
    };
    return cloneAndDeepFreeze({ ...rejected, resultRevision: resultRevision(rejected) } as SemanticMutationResult);
  }
  const bindingDiagnostics = verificationDiagnostic(plan, evidence.verification, evidence.attempted);
  const executionDiagnostics = [...bindingDiagnostics];
  if ((evidence.verification as SemanticMutationVerificationExecutionRef).status !== 'passed') {
    executionDiagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      `${evidence.status} result requires passed Verification`
    ));
  }
  if (executionDiagnostics.length > 0) {
    const rejected = {
      contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
      requestId: plan.requestId,
      requestRevision: plan.requestRevision,
      planRevision: plan.planRevision,
      base: plan.base,
      status: 'rejected' as const,
      transactionId: evidence.transactionId,
      actualDelta: plan.actualDelta,
      impact: plan.impact,
      sourceChanges: [...plan.sourceChanges],
      ...(bindingDiagnostics.length === 0
        ? { attempted: evidence.attempted, verification: evidence.verification }
        : {}),
      diagnostics: canonicalDiagnostics([...diagnostics, ...executionDiagnostics])
    };
    return cloneAndDeepFreeze({ ...rejected, resultRevision: resultRevision(rejected) } as SemanticMutationResult);
  }
  if (evidence.status !== 'accepted' && diagnostics.length === 0) {
    throw new Error(`${evidence.status} terminal result requires non-empty diagnostics`);
  }
  if (evidence.status === 'recovery-required' &&
    !diagnostics.some((diagnostic) => diagnostic.code === 'SEMANTIC-MUTATION-012')) {
    throw new Error('recovery-required terminal result requires SEMANTIC-MUTATION-012');
  }
  if (evidence.status === 'accepted' && (
    !exactEndpoint(evidence.accepted) ||
    !exactEndpoint(evidence.attempted) ||
    evidence.accepted.inputRevision !== evidence.attempted.inputRevision ||
    evidence.accepted.semanticRevision !== evidence.attempted.semanticRevision
  )) {
    throw new Error('Accepted endpoint must exactly preserve the attempted input/semantic revisions');
  }
  const common = {
    contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
    requestId: plan.requestId,
    requestRevision: plan.requestRevision,
    planRevision: plan.planRevision,
    base: plan.base,
    transactionId: evidence.transactionId,
    attempted: evidence.attempted,
    actualDelta: plan.actualDelta,
    impact: plan.impact,
    sourceChanges: [...plan.sourceChanges] as [typeof plan.sourceChanges[0]],
    verification: evidence.verification
  };
  const withoutRevision = evidence.status === 'accepted'
    ? { ...common, status: 'accepted' as const, accepted: evidence.accepted, diagnostics: [] as [] }
    : evidence.status === 'rolled-back'
      ? { ...common, status: 'rolled-back' as const, diagnostics }
      : { ...common, status: 'recovery-required' as const, recoveryState: evidence.recoveryState, diagnostics };
  return cloneAndDeepFreeze({ ...withoutRevision, resultRevision: resultRevision(withoutRevision as Omit<SemanticMutationResult, 'resultRevision'>) } as SemanticMutationResult);
}

export function semanticMutationResultRevision(
  value: Omit<SemanticMutationResult, 'resultRevision'>
): string {
  return resultRevision(value);
}

export function assertSemanticMutationResultInvariant(
  result: SemanticMutationResult,
  plan: SemanticMutationPlan
): void {
  assertSemanticMutationPlanInvariant(plan);
  const runtimeStatus = (result as unknown as Record<string, unknown>).status;
  if (runtimeStatus !== 'accepted' && runtimeStatus !== 'rejected' &&
    runtimeStatus !== 'rolled-back' && runtimeStatus !== 'recovery-required') {
    throw new Error('Semantic mutation result status is not a frozen terminal status');
  }
  if (plan.status === 'rejected' && plan.rejectedAt === 'request') {
    throw new Error('Minimal request rejection cannot own a v2 terminal result');
  }
  const commonKeys = [
    'contractVersion', 'requestId', 'requestRevision', 'planRevision', 'base',
    'resultRevision', 'status', 'sourceChanges', 'diagnostics'
  ];
  const resultRecord = result as unknown as Record<string, unknown>;
  const exactKeys = (required: readonly string[], optional: readonly string[] = []): boolean =>
    exactOwnKeys(resultRecord, [...commonKeys, ...required], optional);
  const { resultRevision: revision, ...withoutRevision } = result;
  if (result.contractVersion !== SEMANTIC_MUTATION_CONTRACT_VERSION ||
    !exactEndpoint(result.base) ||
    result.requestId !== plan.requestId || result.requestRevision !== plan.requestRevision ||
    result.planRevision !== plan.planRevision || !canonicalEquals(result.base, plan.base) ||
    !canonicalEquals(result.diagnostics, canonicalDiagnostics(result.diagnostics)) ||
    revision !== resultRevision(withoutRevision as Omit<SemanticMutationResult, 'resultRevision'>)) {
    throw new Error('Semantic mutation resultRevision does not match canonical result content');
  }
  if (result.status === 'rejected') {
    const resultHasActualDelta = Object.hasOwn(result, 'actualDelta');
    const resultHasImpact = Object.hasOwn(result, 'impact');
    const planHasActualDelta = Object.hasOwn(plan, 'actualDelta');
    const planHasImpact = Object.hasOwn(plan, 'impact');
    const attemptedIsBound = result.attempted === undefined || (
      exactEndpoint(result.attempted) && 'staged' in plan &&
      canonicalEquals(result.attempted, plan.staged)
    );
    const verificationIsBound = result.verification === undefined || (
      plan.status === 'ready' && result.attempted !== undefined &&
      verificationDiagnostic(plan, result.verification, result.attempted).length === 0
    );
    if (!exactKeys([], ['transactionId', 'attempted', 'actualDelta', 'impact', 'verification']) ||
      result.diagnostics.length === 0 ||
      resultHasActualDelta !== planHasActualDelta || resultHasImpact !== planHasImpact ||
      !attemptedIsBound || !verificationIsBound ||
      !canonicalEquals(result.sourceChanges, plan.sourceChanges)) {
      throw new Error('Rejected semantic mutation result violates terminal evidence boundaries');
    }
    if (planHasActualDelta && 'actualDelta' in plan &&
      !canonicalEquals(result.actualDelta, plan.actualDelta)) {
      throw new Error('Rejected result Fact Delta does not match its canonical plan');
    }
    if (planHasImpact && 'impact' in plan &&
      !canonicalEquals(result.impact, plan.impact)) {
      throw new Error('Rejected result Impact does not match its canonical plan');
    }
    return;
  }
  if (plan.status !== 'ready' || !exactKeys(
    result.status === 'recovery-required'
      ? ['transactionId', 'attempted', 'actualDelta', 'impact', 'sourceChanges', 'verification', 'recoveryState']
      : result.status === 'accepted'
        ? ['transactionId', 'attempted', 'accepted', 'actualDelta', 'impact', 'sourceChanges', 'verification']
        : ['transactionId', 'attempted', 'actualDelta', 'impact', 'sourceChanges', 'verification']
  ) ||
    result.sourceChanges.length !== 1 ||
    !exactEndpoint(result.attempted) ||
    !canonicalEquals(result.sourceChanges, plan.sourceChanges) ||
    !canonicalEquals(result.actualDelta, plan.actualDelta) ||
    !canonicalEquals(result.impact, plan.impact) ||
    verificationDiagnostic(plan, result.verification, result.attempted).length > 0) {
    throw new Error(`${result.status} semantic mutation result does not exactly bind the ready plan`);
  }
  if (result.status === 'accepted') {
    if (!exactEndpoint(result.accepted) || result.diagnostics.length !== 0 ||
      result.verification.status !== 'passed' ||
      result.accepted.inputRevision !== result.attempted.inputRevision ||
      result.accepted.semanticRevision !== result.attempted.semanticRevision) {
      throw new Error('Accepted semantic mutation result violates terminal invariants');
    }
    return;
  }
  if (result.diagnostics.length === 0) {
    throw new Error(`${result.status} semantic mutation result requires non-empty diagnostics`);
  }
  if (result.status === 'recovery-required' &&
    !result.diagnostics.some((diagnostic) => diagnostic.code === 'SEMANTIC-MUTATION-012')) {
    throw new Error('recovery-required semantic mutation result requires SEMANTIC-MUTATION-012');
  }
  if ((result.status === 'rolled-back' || result.status === 'recovery-required') &&
    (result.verification as SemanticMutationVerificationExecutionRef).status !== 'passed') {
    throw new Error(`${result.status} semantic mutation result requires passed Verification`);
  }
}
