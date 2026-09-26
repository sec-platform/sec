import { randomBytes } from 'node:crypto';
import {
  compareCodeUnits,
  deepFreeze,
  rawSha256Hex,
  sha256
} from '../../contracts/canonical.ts';
import { SEMANTIC_OPERATION_ID_PATTERN } from './identity.ts';

import {
  canonicalOperationBudget,
  canonicalOperationEffectKinds,
  canonicalUniqueOperationStrings,
  type OperationBudget,
  type OperationEffectKind
} from './contract.ts';

export {
  isCanonicalOperationBudgetMaximum,
  OPERATION_BUDGET_RESOURCES,
  OPERATION_EFFECT_KINDS,
  PROCESS_OPERATION_BUDGET_RESOURCES
} from './contract.ts';
export type { OperationBudget, OperationBudgetResource, OperationEffectKind } from './contract.ts';

export type OperationDigest = `sha256:${string}`;

export type OperationRequirement = Readonly<{
  readonly id: string;
  readonly contractDigest: OperationDigest;
  readonly effectKinds: readonly OperationEffectKind[];
  readonly failureKinds: readonly string[];
}>;

type SemanticOperationIdentity = Readonly<{
  readonly operation: string;
  readonly intentDigest: OperationDigest;
  readonly decisionDigest: OperationDigest;
  readonly identityDigest: OperationDigest;
}>;

type SemanticOperationExecutionPlan = Readonly<{
  readonly operationIdentityDigest: OperationDigest;
  readonly aggregateBudgets: readonly OperationBudget[];
  readonly requirements: readonly OperationRequirement[];
  readonly executionPlanDigest: OperationDigest;
}>;

/** Stable OperationKey and Effect plan; physical attempts are issued separately. */
export type SemanticOperationIntent = Readonly<{
  readonly identity: SemanticOperationIdentity;
  readonly execution: SemanticOperationExecutionPlan;
}>;

export type SemanticOperationAttemptContext = Readonly<{
  readonly authorityGrantDigest: OperationDigest;
  readonly runIdDigest: OperationDigest | null;
  readonly resumeEpochDigest: OperationDigest | null;
  readonly attemptNonceDigest: OperationDigest;
}>;

type SemanticOperationAttempt = Readonly<{
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly authorityGrantDigest: OperationDigest;
  readonly runIdDigest: OperationDigest | null;
  readonly resumeEpochDigest: OperationDigest | null;
  readonly attemptNonceDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly attemptDigest: OperationDigest;
}>;

export type SemanticOperationPlan = Readonly<{
  readonly identity: SemanticOperationIdentity;
  readonly execution: SemanticOperationExecutionPlan;
  readonly attempt: SemanticOperationAttempt;
}>;

export type CapabilityBinding = Readonly<{
  readonly requirementId: string;
  readonly contractDigest: OperationDigest;
  readonly providerIdentityDigest: OperationDigest;
  readonly bindingDigest: OperationDigest;
}>;

export type BoundSemanticOperation = Readonly<{
  readonly plan: SemanticOperationPlan;
  readonly bindings: readonly CapabilityBinding[];
  readonly bindingSetIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
}>;

const PROVIDER_PHYSICAL_DISPOSITIONS = [
  'not-started',
  'settled',
  'unknown'
] as const;

export type ProviderPhysicalDisposition =
  (typeof PROVIDER_PHYSICAL_DISPOSITIONS)[number];

const DOMAIN_READBACK_DISPOSITIONS = [
  'applied',
  'not-applied',
  'unknown'
] as const;

export type DomainReadbackDisposition =
  (typeof DOMAIN_READBACK_DISPOSITIONS)[number];

/** Physical settlement for exactly one requirement of one bound attempt. */
export type ProviderSettlementReceipt = Readonly<{
  readonly requirementId: string;
  readonly contractDigest: OperationDigest;
  readonly bindingDigest: OperationDigest;
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly physicalDisposition: ProviderPhysicalDisposition;
  readonly providerSettlementReferenceDigest: OperationDigest;
  readonly providerReceiptDigest: OperationDigest;
}>;

/** Canonical exact set: one provider settlement for every requirement. */
export type ProviderSettlementSet = Readonly<{
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly bindingSetIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly settlements: readonly ProviderSettlementReceipt[];
  readonly providerReceiptDigests: readonly OperationDigest[];
  readonly providerSettlementSetDigest: OperationDigest;
}>;

type DomainReadbackReceiptBase = Readonly<{
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly bindingSetIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly readbackContractDigest: OperationDigest;
  readonly readbackReferenceDigest: OperationDigest;
  readonly currentPhysicalEpochDigest: OperationDigest;
  readonly disposition: DomainReadbackDisposition;
  readonly readbackReceiptDigest: OperationDigest;
}>;

export type NormalDomainReadbackReceipt = DomainReadbackReceiptBase & Readonly<{
  readonly recoveryMode: 'normal';
  readonly providerSettlementSetDigest: OperationDigest;
  readonly durableObservationDigest: null;
}>;

export type RecoveredDomainReadbackReceipt = DomainReadbackReceiptBase & Readonly<{
  readonly recoveryMode: 'recovered';
  readonly providerSettlementSetDigest: null;
  readonly durableObservationDigest: OperationDigest;
  readonly predecessorExecutionPlanDigest: OperationDigest;
  readonly predecessorBindingSetIdentityDigest: OperationDigest;
  readonly predecessorBoundAttemptDigest: OperationDigest;
  readonly predecessorAttemptNonceDigest: OperationDigest;
  readonly predecessorAuthorityGrantDigest: OperationDigest;
  readonly predecessorResumeEpochDigest: OperationDigest | null;
  readonly predecessorDeadlineAtUnixMs: number;
}>;

/**
 * Observation-only predecessor coordinates retained by Runtime State.  They
 * deliberately exclude every live operation object: a restarted process must
 * obtain a new recovery operation from current authority before a domain owner
 * can turn these coordinates into a readback receipt.
 */
export type RecoveredPredecessorAttemptReference = Readonly<{
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly bindingSetIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly attemptNonceDigest: OperationDigest;
  readonly authorityGrantDigest: OperationDigest;
  readonly resumeEpochDigest: OperationDigest | null;
  readonly deadlineAtUnixMs: number;
}>;

export type DomainReadbackReceipt =
  | NormalDomainReadbackReceipt
  | RecoveredDomainReadbackReceipt;

export type OwnerTerminalJoinReceipt = Readonly<{
  readonly recoveryMode: 'normal' | 'recovered';
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly bindingSetIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly providerSettlementSetDigest: OperationDigest | null;
  readonly readbackReceiptDigest: OperationDigest;
  readonly ownerTerminalContractDigest: OperationDigest;
  readonly ownerTerminalReferenceDigest: OperationDigest;
  readonly joinReceiptDigest: OperationDigest;
}>;

export type RecoveredRetryAdmission = Readonly<{
  readonly operationIdentityDigest: OperationDigest;
  readonly previousExecutionPlanDigest: OperationDigest;
  readonly previousBindingSetIdentityDigest: OperationDigest;
  readonly previousBoundAttemptDigest: OperationDigest;
  readonly previousAttemptNonceDigest: OperationDigest;
  readonly previousDeadlineAtUnixMs: number;
  readonly recoveryBoundAttemptDigest: OperationDigest;
  readonly recoveryAuthorityGrantDigest: OperationDigest;
  readonly recoveryResumeEpochDigest: OperationDigest;
  readonly recoveredReadbackReceiptDigest: OperationDigest;
  readonly currentPhysicalEpochDigest: OperationDigest;
  readonly retryAdmissionDigest: OperationDigest;
}>;

export type CapabilityDiagnostic = Readonly<{
  readonly bindingDigest: OperationDigest;
  readonly code: string;
  readonly failureKind: string;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: OperationDigest;
}>;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMPILED_OPERATION_PLANS = new WeakSet<object>();
const COMPILED_ATTEMPT_CONTEXTS = new WeakSet<object>();
const ISSUED_RECOVERED_READBACK_RECEIPTS = new WeakSet<object>();
const ISSUED_RECOVERED_RETRY_ADMISSIONS = new WeakSet<object>();
const CONSUMED_RECOVERED_READBACK_RECEIPTS = new WeakSet<object>();
const CONSUMED_RECOVERED_RETRY_ADMISSIONS = new WeakSet<object>();

function requireDigest(value: string, label: string): OperationDigest {
  if (!DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest.`);
  }
  return value as OperationDigest;
}

function requireId(value: string, label: string): string {
  if (!SEMANTIC_OPERATION_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical semantic identity.`);
  }
  return value;
}

function canonicalRequirement(
  requirement: OperationRequirement
): OperationRequirement {
  const id = requireId(requirement.id, 'Operation requirement id');
  const effectKinds = canonicalOperationEffectKinds(
    requirement.effectKinds,
    `Operation requirement ${id} effect kinds`
  );
  return deepFreeze({
    id,
    contractDigest: requireDigest(
      requirement.contractDigest,
      `Operation requirement ${id} contract digest`
    ),
    effectKinds: effectKinds as readonly OperationEffectKind[],
    failureKinds: canonicalUniqueOperationStrings(
      requirement.failureKinds,
      `Operation requirement ${id} failure kinds`
    )
  });
}

export function compileSemanticOperationIntent(input: Readonly<{
  readonly operation: string;
  readonly intentDigest: OperationDigest;
  readonly decisionDigest: OperationDigest;
  readonly aggregateBudgets: readonly OperationBudget[];
  readonly requirements: readonly OperationRequirement[];
}>): SemanticOperationIntent {
  const operation = requireId(input.operation, 'Semantic operation');
  const aggregateBudgets = [...input.aggregateBudgets]
    .sort((left, right) => compareCodeUnits(left.resource, right.resource))
    .map(canonicalOperationBudget);
  if (new Set(aggregateBudgets.map(({ resource }) => resource)).size
      !== aggregateBudgets.length) {
    throw new Error('Semantic operation aggregate budgets must be unique by resource.');
  }
  const requirements = [...input.requirements]
    .map(canonicalRequirement)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  if (requirements.length === 0
      || new Set(requirements.map(({ id }) => id)).size !== requirements.length) {
    throw new Error('Semantic operation must have unique capability requirements.');
  }
  const identityWithoutDigest = deepFreeze({
    operation,
    intentDigest: requireDigest(input.intentDigest, 'Semantic operation intent digest'),
    decisionDigest: requireDigest(input.decisionDigest, 'Semantic operation decision digest')
  });
  const identity = deepFreeze({
    ...identityWithoutDigest,
    identityDigest: sha256(identityWithoutDigest) as OperationDigest
  });
  const executionWithoutDigest = deepFreeze({
    operationIdentityDigest: identity.identityDigest,
    aggregateBudgets: Object.freeze(aggregateBudgets),
    requirements: Object.freeze(requirements)
  });
  const execution = deepFreeze({
    ...executionWithoutDigest,
    executionPlanDigest: sha256(executionWithoutDigest) as OperationDigest
  });
  return deepFreeze({ identity, execution });
}

export function compileSemanticOperationPlan(input: Readonly<{
  readonly operation: string;
  readonly intentDigest: OperationDigest;
  readonly decisionDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly aggregateBudgets: readonly OperationBudget[];
  readonly requirements: readonly OperationRequirement[];
  readonly attempt: SemanticOperationAttemptContext;
}>): SemanticOperationPlan {
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs < 1) {
    throw new Error('Semantic operation deadline must be an absolute safe integer.');
  }
  if (!COMPILED_ATTEMPT_CONTEXTS.has(input.attempt)) {
    throw new Error('Semantic operation attempt context is not foundation-compiled.');
  }
  const { identity, execution } = compileSemanticOperationIntent(input);
  const attemptWithoutDigest = deepFreeze({
    operationIdentityDigest: identity.identityDigest,
    executionPlanDigest: execution.executionPlanDigest,
    authorityGrantDigest: input.attempt.authorityGrantDigest,
    runIdDigest: input.attempt.runIdDigest,
    resumeEpochDigest: input.attempt.resumeEpochDigest,
    attemptNonceDigest: input.attempt.attemptNonceDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
  const plan = deepFreeze({
    identity,
    execution,
    attempt: deepFreeze({
      ...attemptWithoutDigest,
      attemptDigest: sha256(attemptWithoutDigest) as OperationDigest
    })
  });
  COMPILED_OPERATION_PLANS.add(plan);
  return plan;
}

/**
 * Compiles a process-local attempt lineage projection. The nonce prevents
 * accidental attempt reuse, but the caller-supplied grant digest is not
 * Effect authority.
 */
export function issueSemanticOperationAttemptContext(input: Readonly<{
  readonly authorityGrantDigest: OperationDigest;
  readonly runIdDigest?: OperationDigest | null;
  readonly resumeEpochDigest?: OperationDigest | null;
}>): SemanticOperationAttemptContext {
  const context = deepFreeze({
    authorityGrantDigest: requireDigest(
      input.authorityGrantDigest,
      'Semantic operation authority grant digest'
    ),
    runIdDigest: input.runIdDigest === undefined || input.runIdDigest === null
      ? null
      : requireDigest(input.runIdDigest, 'Semantic operation run identity digest'),
    resumeEpochDigest: input.resumeEpochDigest === undefined || input.resumeEpochDigest === null
      ? null
      : requireDigest(input.resumeEpochDigest, 'Semantic operation resume epoch digest'),
    attemptNonceDigest: `sha256:${randomBytes(32).toString('hex')}` as OperationDigest
  });
  COMPILED_ATTEMPT_CONTEXTS.add(context);
  return context;
}

export function compileCapabilityBinding(input: Readonly<{
  readonly requirementId: string;
  readonly contractDigest: OperationDigest;
  readonly providerIdentityDigest: OperationDigest;
}>): CapabilityBinding {
  const withoutDigest = deepFreeze({
    requirementId: requireId(input.requirementId, 'Capability binding requirement id'),
    contractDigest: requireDigest(input.contractDigest, 'Capability binding contract digest'),
    providerIdentityDigest: requireDigest(
      input.providerIdentityDigest,
      'Capability binding provider identity digest'
    )
  });
  return deepFreeze({
    ...withoutDigest,
    bindingDigest: sha256(withoutDigest) as OperationDigest
  });
}

export function bindSemanticOperation(
  plan: SemanticOperationPlan,
  suppliedBindings: readonly CapabilityBinding[]
): BoundSemanticOperation {
  assertSemanticOperationPlan(plan);
  const bindings = [...suppliedBindings]
    .sort((left, right) => compareCodeUnits(left.requirementId, right.requirementId));
  if (bindings.length !== plan.execution.requirements.length
      || new Set(bindings.map(({ requirementId }) => requirementId)).size !== bindings.length) {
    throw new Error('Semantic operation requires exactly one binding per requirement.');
  }
  for (const requirement of plan.execution.requirements) {
    const binding = bindings.find(({ requirementId }) => requirementId === requirement.id);
    if (binding === undefined || binding.contractDigest !== requirement.contractDigest) {
      throw new Error(`Semantic operation requirement ${requirement.id} is not exactly bound.`);
    }
    const canonical = compileCapabilityBinding(binding);
    if (canonical.bindingDigest !== binding.bindingDigest) {
      throw new Error(`Semantic operation requirement ${requirement.id} binding is noncanonical.`);
    }
  }
  const frozenBindings = Object.freeze(bindings);
  const bindingSetIdentityDigest = sha256({
    operationIdentityDigest: plan.identity.identityDigest,
    executionPlanDigest: plan.execution.executionPlanDigest,
    bindings: frozenBindings.map(({ bindingDigest }) => bindingDigest)
  }) as OperationDigest;
  const bound = deepFreeze({
    plan,
    bindings: frozenBindings,
    bindingSetIdentityDigest,
    boundAttemptDigest: sha256({
      attemptDigest: plan.attempt.attemptDigest,
      bindingSetIdentityDigest
    }) as OperationDigest
  });
  return bound;
}

/** Structural plan bytes do not prove that the operation foundation compiled them. */
export function assertSemanticOperationPlan(
  plan: SemanticOperationPlan
): void {
  if (!COMPILED_OPERATION_PLANS.has(plan)) {
    throw new Error('Semantic operation binding requires a foundation-compiled operation plan.');
  }
}

/**
 * Validates the canonical bytes of a foundation-compiled correlation and
 * budget projection.  Passing this check never grants an Effect: the domain
 * owner must still require its own opaque provider/physical capability.
 */
export function assertSemanticOperationProjection(
  operation: BoundSemanticOperation
): void {
  assertSemanticOperationPlan(operation.plan);
  const rebound = bindSemanticOperation(operation.plan, operation.bindings);
  if (rebound.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || rebound.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new Error('Semantic operation projection is not canonical.');
  }
}

export function issueProviderSettlementReceipt(
  operation: BoundSemanticOperation,
  input: Readonly<{
    readonly requirementId: string;
    readonly physicalDisposition: ProviderPhysicalDisposition;
    readonly providerSettlementReferenceDigest: OperationDigest;
  }>
): ProviderSettlementReceipt {
  assertSemanticOperationProjection(operation);
  const requirementId = requireId(input.requirementId, 'Provider settlement requirement id');
  const requirement = operation.plan.execution.requirements.find(
    ({ id }) => id === requirementId
  );
  const binding = operation.bindings.find(
    ({ requirementId: candidate }) => candidate === requirementId
  );
  if (requirement === undefined || binding === undefined
      || binding.contractDigest !== requirement.contractDigest) {
    throw new Error('Provider settlement does not bind an exact operation requirement.');
  }
  if (!PROVIDER_PHYSICAL_DISPOSITIONS.includes(input.physicalDisposition)) {
    throw new Error('Provider physical disposition is not canonical.');
  }
  const withoutDigest = deepFreeze({
    requirementId,
    contractDigest: requirement.contractDigest,
    bindingDigest: binding.bindingDigest,
    operationIdentityDigest: operation.plan.identity.identityDigest,
    executionPlanDigest: operation.plan.execution.executionPlanDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    physicalDisposition: input.physicalDisposition,
    providerSettlementReferenceDigest: requireDigest(
      input.providerSettlementReferenceDigest,
      'Provider settlement reference digest'
    )
  });
  const receipt = deepFreeze({
    ...withoutDigest,
    providerReceiptDigest: sha256({
      domain: 'sec.operation.provider-settlement-receipt',
      receipt: withoutDigest
    }) as OperationDigest
  });
  return receipt;
}

export function assertProviderSettlementReceipt(
  value: unknown
): asserts value is ProviderSettlementReceipt {
  if (value === null || typeof value !== 'object') {
    throw new Error('Provider settlement projection is invalid.');
  }
  const receipt = value as ProviderSettlementReceipt;
  const { providerReceiptDigest, ...withoutDigest } = receipt;
  if (!DIGEST_PATTERN.test(providerReceiptDigest)
      || sha256({ domain: 'sec.operation.provider-settlement-receipt', receipt: withoutDigest })
        !== providerReceiptDigest) {
    throw new Error('Provider settlement projection digest is invalid.');
  }
}

export function compileProviderSettlementSet(
  operation: BoundSemanticOperation,
  suppliedSettlements: readonly ProviderSettlementReceipt[]
): ProviderSettlementSet {
  assertSemanticOperationProjection(operation);
  const settlements = [...suppliedSettlements].sort((left, right) => (
    compareCodeUnits(left.requirementId, right.requirementId)
  ));
  if (settlements.length !== operation.plan.execution.requirements.length
      || new Set(settlements.map(({ requirementId }) => requirementId)).size
        !== settlements.length) {
    throw new Error('Provider settlement set requires exactly one receipt per requirement.');
  }
  for (const [index, requirement] of operation.plan.execution.requirements.entries()) {
    const settlement = settlements[index];
    assertProviderSettlementReceipt(settlement);
    const binding = operation.bindings[index];
    if (settlement.requirementId !== requirement.id
        || binding?.requirementId !== requirement.id
        || settlement.contractDigest !== requirement.contractDigest
        || settlement.bindingDigest !== binding.bindingDigest
        || settlement.operationIdentityDigest !== operation.plan.identity.identityDigest
        || settlement.executionPlanDigest !== operation.plan.execution.executionPlanDigest
        || settlement.boundAttemptDigest !== operation.boundAttemptDigest) {
      throw new Error(
        `Provider settlement for ${requirement.id} does not bind the exact requirement attempt.`
      );
    }
  }
  const frozenSettlements = Object.freeze(settlements);
  const providerReceiptDigests = Object.freeze(
    settlements.map(({ providerReceiptDigest }) => providerReceiptDigest)
  );
  const withoutDigest = deepFreeze({
    operationIdentityDigest: operation.plan.identity.identityDigest,
    executionPlanDigest: operation.plan.execution.executionPlanDigest,
    bindingSetIdentityDigest: operation.bindingSetIdentityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    settlements: frozenSettlements,
    providerReceiptDigests
  });
  const settlementSet = deepFreeze({
    ...withoutDigest,
    providerSettlementSetDigest: sha256({
      domain: 'sec.operation.provider-settlement-set',
      settlementSet: withoutDigest
    }) as OperationDigest
  });
  return settlementSet;
}

export function assertProviderSettlementSet(
  value: unknown
): asserts value is ProviderSettlementSet {
  if (value === null || typeof value !== 'object') {
    throw new Error('Provider settlement projection set is invalid.');
  }
  const settlementSet = value as ProviderSettlementSet;
  for (const settlement of settlementSet.settlements ?? []) {
    assertProviderSettlementReceipt(settlement);
  }
  const { providerSettlementSetDigest, ...withoutDigest } = settlementSet;
  if (!DIGEST_PATTERN.test(providerSettlementSetDigest)
      || sha256({ domain: 'sec.operation.provider-settlement-set', settlementSet: withoutDigest })
        !== providerSettlementSetDigest) {
    throw new Error('Provider settlement projection set digest is invalid.');
  }
}

function requireBoundReadbackOperation(operation: BoundSemanticOperation): void {
  assertSemanticOperationProjection(operation);
}

function canonicalReadbackDisposition(value: string): DomainReadbackDisposition {
  if (!DOMAIN_READBACK_DISPOSITIONS.includes(value as DomainReadbackDisposition)) {
    throw new Error('Domain readback disposition is not canonical.');
  }
  return value as DomainReadbackDisposition;
}

function issueDomainReadbackReceipt(input: Readonly<{
  readonly operation: BoundSemanticOperation;
  readonly recoveryMode: 'normal' | 'recovered';
  readonly providerSettlementSetDigest: OperationDigest | null;
  readonly durableObservationDigest: OperationDigest | null;
  readonly readbackContractDigest: OperationDigest;
  readonly readbackReferenceDigest: OperationDigest;
  readonly currentPhysicalEpochDigest: OperationDigest;
  readonly disposition: DomainReadbackDisposition;
}>): DomainReadbackReceipt {
  const withoutDigest = deepFreeze({
    recoveryMode: input.recoveryMode,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    executionPlanDigest: input.operation.plan.execution.executionPlanDigest,
    bindingSetIdentityDigest: input.operation.bindingSetIdentityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    providerSettlementSetDigest: input.providerSettlementSetDigest,
    durableObservationDigest: input.durableObservationDigest,
    readbackContractDigest: requireDigest(
      input.readbackContractDigest,
      'Domain readback contract digest'
    ),
    readbackReferenceDigest: requireDigest(
      input.readbackReferenceDigest,
      'Domain readback reference digest'
    ),
    currentPhysicalEpochDigest: requireDigest(
      input.currentPhysicalEpochDigest,
      'Domain readback physical epoch digest'
    ),
    disposition: canonicalReadbackDisposition(input.disposition)
  });
  const receipt = deepFreeze({
    ...withoutDigest,
    readbackReceiptDigest: sha256({
      domain: 'sec.operation.domain-readback-receipt',
      readback: withoutDigest
    }) as OperationDigest
  }) as DomainReadbackReceipt;
  return receipt;
}

export function issueNormalDomainReadbackReceipt(
  operation: BoundSemanticOperation,
  providerSettlementSet: ProviderSettlementSet,
  input: Readonly<{
    readonly readbackContractDigest: OperationDigest;
    readonly readbackReferenceDigest: OperationDigest;
    readonly currentPhysicalEpochDigest: OperationDigest;
    readonly disposition: DomainReadbackDisposition;
  }>
): NormalDomainReadbackReceipt {
  requireBoundReadbackOperation(operation);
  assertProviderSettlementSet(providerSettlementSet);
  if (providerSettlementSet.operationIdentityDigest !== operation.plan.identity.identityDigest
      || providerSettlementSet.executionPlanDigest
        !== operation.plan.execution.executionPlanDigest
      || providerSettlementSet.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || providerSettlementSet.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new Error('Normal domain readback does not bind the exact provider settlement set.');
  }
  return issueDomainReadbackReceipt({
    operation,
    recoveryMode: 'normal',
    providerSettlementSetDigest: providerSettlementSet.providerSettlementSetDigest,
    durableObservationDigest: null,
    ...input
  }) as NormalDomainReadbackReceipt;
}

export function issueRecoveredDomainReadbackReceipt(
  recoveryOperation: BoundSemanticOperation,
  input: Readonly<{
    readonly predecessor: RecoveredPredecessorAttemptReference;
    readonly durableObservationDigest: OperationDigest;
    readonly readbackContractDigest: OperationDigest;
    readonly readbackReferenceDigest: OperationDigest;
    readonly currentPhysicalEpochDigest: OperationDigest;
    readonly disposition: DomainReadbackDisposition;
  }>
): RecoveredDomainReadbackReceipt {
  requireBoundReadbackOperation(recoveryOperation);
  const predecessor = input.predecessor;
  if (predecessor.operationIdentityDigest !== recoveryOperation.plan.identity.identityDigest
      || predecessor.executionPlanDigest !== recoveryOperation.plan.execution.executionPlanDigest
      || predecessor.bindingSetIdentityDigest !== recoveryOperation.bindingSetIdentityDigest
      || predecessor.boundAttemptDigest === recoveryOperation.boundAttemptDigest
      || recoveryOperation.plan.attempt.resumeEpochDigest === null) {
    throw new Error('Recovered domain readback does not bind one predecessor and current recovery authority.');
  }
  if (!Number.isSafeInteger(predecessor.deadlineAtUnixMs) || predecessor.deadlineAtUnixMs < 1) {
    throw new Error('Recovered domain predecessor deadline is invalid.');
  }
  const withoutDigest = deepFreeze({
    recoveryMode: 'recovered' as const,
    operationIdentityDigest: recoveryOperation.plan.identity.identityDigest,
    executionPlanDigest: recoveryOperation.plan.execution.executionPlanDigest,
    bindingSetIdentityDigest: recoveryOperation.bindingSetIdentityDigest,
    boundAttemptDigest: recoveryOperation.boundAttemptDigest,
    providerSettlementSetDigest: null,
    durableObservationDigest: requireDigest(
      input.durableObservationDigest, 'Recovered domain durable observation digest'),
    predecessorExecutionPlanDigest: requireDigest(
      predecessor.executionPlanDigest, 'Recovered predecessor execution plan digest'),
    predecessorBindingSetIdentityDigest: requireDigest(
      predecessor.bindingSetIdentityDigest, 'Recovered predecessor binding set digest'),
    predecessorBoundAttemptDigest: requireDigest(
      predecessor.boundAttemptDigest, 'Recovered predecessor bound attempt digest'),
    predecessorAttemptNonceDigest: requireDigest(
      predecessor.attemptNonceDigest, 'Recovered predecessor attempt nonce digest'),
    predecessorAuthorityGrantDigest: requireDigest(
      predecessor.authorityGrantDigest, 'Recovered predecessor authority grant digest'),
    predecessorResumeEpochDigest: predecessor.resumeEpochDigest === null
      ? null
      : requireDigest(predecessor.resumeEpochDigest, 'Recovered predecessor resume epoch digest'),
    predecessorDeadlineAtUnixMs: predecessor.deadlineAtUnixMs,
    readbackContractDigest: requireDigest(input.readbackContractDigest, 'Domain readback contract digest'),
    readbackReferenceDigest: requireDigest(input.readbackReferenceDigest, 'Domain readback reference digest'),
    currentPhysicalEpochDigest: requireDigest(
      input.currentPhysicalEpochDigest, 'Domain readback physical epoch digest'),
    disposition: canonicalReadbackDisposition(input.disposition)
  });
  const receipt = deepFreeze({
    ...withoutDigest,
    readbackReceiptDigest: sha256({
      domain: 'sec.operation.domain-readback-receipt',
      readback: withoutDigest
    }) as OperationDigest
  });
  ISSUED_RECOVERED_READBACK_RECEIPTS.add(receipt);
  return receipt;
}

export function assertDomainReadbackReceipt(
  value: unknown
): asserts value is DomainReadbackReceipt {
  if (value === null || typeof value !== 'object') {
    throw new Error('Domain readback projection is invalid.');
  }
  const readback = value as DomainReadbackReceipt;
  const { readbackReceiptDigest, ...withoutDigest } = readback;
  if (!DIGEST_PATTERN.test(readbackReceiptDigest)
      || sha256({ domain: 'sec.operation.domain-readback-receipt', readback: withoutDigest })
        !== readbackReceiptDigest) {
    throw new Error('Domain readback projection digest is invalid.');
  }
}

function assertReadbackBindsOperation(
  operation: BoundSemanticOperation,
  readback: DomainReadbackReceipt
): void {
  assertDomainReadbackReceipt(readback);
  if (readback.operationIdentityDigest !== operation.plan.identity.identityDigest
      || readback.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || readback.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || readback.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new Error('Domain readback does not bind the exact operation attempt.');
  }
}

function issueOwnerTerminalJoinReceipt(input: Readonly<{
  readonly operation: BoundSemanticOperation;
  readonly readback: DomainReadbackReceipt;
  readonly ownerTerminalContractDigest: OperationDigest;
  readonly ownerTerminalReferenceDigest: OperationDigest;
}>): OwnerTerminalJoinReceipt {
  const withoutDigest = deepFreeze({
    recoveryMode: input.readback.recoveryMode,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    executionPlanDigest: input.operation.plan.execution.executionPlanDigest,
    bindingSetIdentityDigest: input.operation.bindingSetIdentityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    providerSettlementSetDigest: input.readback.providerSettlementSetDigest,
    readbackReceiptDigest: input.readback.readbackReceiptDigest,
    ownerTerminalContractDigest: requireDigest(
      input.ownerTerminalContractDigest,
      'Owner terminal contract digest'
    ),
    ownerTerminalReferenceDigest: requireDigest(
      input.ownerTerminalReferenceDigest,
      'Owner terminal reference digest'
    )
  });
  const receipt = deepFreeze({
    ...withoutDigest,
    joinReceiptDigest: sha256({
      domain: 'sec.operation.owner-terminal-join',
      join: withoutDigest
    }) as OperationDigest
  });
  return receipt;
}

export function issueNormalOwnerTerminalJoinReceipt(
  operation: BoundSemanticOperation,
  providerSettlementSet: ProviderSettlementSet,
  readback: NormalDomainReadbackReceipt,
  input: Readonly<{
    readonly ownerTerminalContractDigest: OperationDigest;
    readonly ownerTerminalReferenceDigest: OperationDigest;
  }>
): OwnerTerminalJoinReceipt {
  requireBoundReadbackOperation(operation);
  assertProviderSettlementSet(providerSettlementSet);
  assertReadbackBindsOperation(operation, readback);
  if (readback.recoveryMode !== 'normal'
      || readback.providerSettlementSetDigest
        !== providerSettlementSet.providerSettlementSetDigest) {
    throw new Error('Normal owner terminal join requires its exact provider settlement set.');
  }
  return issueOwnerTerminalJoinReceipt({ operation, readback, ...input });
}

export function issueRecoveredOwnerTerminalJoinReceipt(
  operation: BoundSemanticOperation,
  readback: RecoveredDomainReadbackReceipt,
  input: Readonly<{
    readonly ownerTerminalContractDigest: OperationDigest;
    readonly ownerTerminalReferenceDigest: OperationDigest;
  }>
): OwnerTerminalJoinReceipt {
  requireBoundReadbackOperation(operation);
  assertReadbackBindsOperation(operation, readback);
  if (readback.recoveryMode !== 'recovered'
      || !ISSUED_RECOVERED_READBACK_RECEIPTS.has(readback)) {
    throw new Error('Recovered owner terminal join requires a recovered readback.');
  }
  if (CONSUMED_RECOVERED_READBACK_RECEIPTS.has(readback)) {
    throw new Error('Recovered domain readback was already consumed by a terminal or retry policy.');
  }
  CONSUMED_RECOVERED_READBACK_RECEIPTS.add(readback);
  return issueOwnerTerminalJoinReceipt({ operation, readback, ...input });
}

export function assertOwnerTerminalJoinReceipt(
  value: unknown
): asserts value is OwnerTerminalJoinReceipt {
  if (value === null || typeof value !== 'object') {
    throw new Error('Owner terminal join projection is invalid.');
  }
  const join = value as OwnerTerminalJoinReceipt;
  const { joinReceiptDigest, ...withoutDigest } = join;
  if (!DIGEST_PATTERN.test(joinReceiptDigest)
      || sha256({ domain: 'sec.operation.owner-terminal-join', join: withoutDigest })
        !== joinReceiptDigest) {
    throw new Error('Owner terminal join projection digest is invalid.');
  }
}

export function issueRecoveredRetryAdmission(
  recoveryOperation: BoundSemanticOperation,
  readback: RecoveredDomainReadbackReceipt
): RecoveredRetryAdmission {
  assertSemanticOperationProjection(recoveryOperation);
  assertDomainReadbackReceipt(readback);
  if (readback.recoveryMode !== 'recovered'
      || !ISSUED_RECOVERED_READBACK_RECEIPTS.has(readback)
      || readback.disposition !== 'not-applied'
      || readback.operationIdentityDigest !== recoveryOperation.plan.identity.identityDigest
      || readback.executionPlanDigest !== recoveryOperation.plan.execution.executionPlanDigest
      || readback.bindingSetIdentityDigest !== recoveryOperation.bindingSetIdentityDigest
      || readback.boundAttemptDigest !== recoveryOperation.boundAttemptDigest
      || recoveryOperation.plan.attempt.resumeEpochDigest === null) {
    throw new Error('Retry admission requires a conclusive recovered not-applied readback.');
  }
  if (CONSUMED_RECOVERED_READBACK_RECEIPTS.has(readback)) {
    throw new Error('Recovered domain readback was already consumed by a terminal or retry policy.');
  }
  const withoutDigest = deepFreeze({
    operationIdentityDigest: readback.operationIdentityDigest,
    previousExecutionPlanDigest: readback.predecessorExecutionPlanDigest,
    previousBindingSetIdentityDigest: readback.predecessorBindingSetIdentityDigest,
    previousBoundAttemptDigest: readback.predecessorBoundAttemptDigest,
    previousAttemptNonceDigest: readback.predecessorAttemptNonceDigest,
    previousDeadlineAtUnixMs: readback.predecessorDeadlineAtUnixMs,
    recoveryBoundAttemptDigest: readback.boundAttemptDigest,
    recoveryAuthorityGrantDigest: recoveryOperation.plan.attempt.authorityGrantDigest,
    recoveryResumeEpochDigest: recoveryOperation.plan.attempt.resumeEpochDigest,
    recoveredReadbackReceiptDigest: readback.readbackReceiptDigest,
    currentPhysicalEpochDigest: readback.currentPhysicalEpochDigest
  });
  const admission = deepFreeze({
    ...withoutDigest,
    retryAdmissionDigest: sha256({
      domain: 'sec.operation.recovered-retry-admission',
      admission: withoutDigest
    }) as OperationDigest
  });
  CONSUMED_RECOVERED_READBACK_RECEIPTS.add(readback);
  ISSUED_RECOVERED_RETRY_ADMISSIONS.add(admission);
  return admission;
}

export function consumeRecoveredRetryAdmission(
  admission: RecoveredRetryAdmission,
  successor: BoundSemanticOperation,
  currentPhysicalEpochDigest: OperationDigest
): void {
  assertRecoveredRetryAdmissionForSuccessor(
    admission,
    successor,
    currentPhysicalEpochDigest
  );
  if (CONSUMED_RECOVERED_RETRY_ADMISSIONS.has(admission)) {
    throw new Error('Recovered retry admission was already consumed.');
  }
  CONSUMED_RECOVERED_RETRY_ADMISSIONS.add(admission);
}

/** Validates a successor before its durable start claim without consuming it. */
export function assertRecoveredRetryAdmissionForSuccessor(
  admission: RecoveredRetryAdmission,
  successor: BoundSemanticOperation,
  currentPhysicalEpochDigest: OperationDigest
): void {
  assertRecoveredRetryAdmission(admission);
  assertSemanticOperationProjection(successor);
  if (successor.plan.identity.identityDigest !== admission.operationIdentityDigest
      || successor.plan.execution.executionPlanDigest !== admission.previousExecutionPlanDigest
      || successor.bindingSetIdentityDigest !== admission.previousBindingSetIdentityDigest
      || successor.boundAttemptDigest === admission.previousBoundAttemptDigest
      || successor.boundAttemptDigest === admission.recoveryBoundAttemptDigest
      || successor.plan.attempt.authorityGrantDigest !== admission.recoveryAuthorityGrantDigest
      || successor.plan.attempt.resumeEpochDigest !== admission.recoveryResumeEpochDigest
      || requireDigest(currentPhysicalEpochDigest, 'Recovered retry current physical epoch digest')
        !== admission.currentPhysicalEpochDigest
      || successor.plan.attempt.deadlineAtUnixMs > admission.previousDeadlineAtUnixMs
      || successor.plan.attempt.deadlineAtUnixMs <= Date.now()) {
    throw new Error('Recovered retry admission does not authorize this successor attempt.');
  }
  if (CONSUMED_RECOVERED_RETRY_ADMISSIONS.has(admission)) {
    throw new Error('Recovered retry admission was already consumed.');
  }
}

export function assertRecoveredRetryAdmission(
  value: unknown
): asserts value is RecoveredRetryAdmission {
  if (value === null || typeof value !== 'object'
      || !ISSUED_RECOVERED_RETRY_ADMISSIONS.has(value)) {
    throw new Error('Recovered retry projection is invalid.');
  }
  const admission = value as RecoveredRetryAdmission;
  const { retryAdmissionDigest, ...withoutDigest } = admission;
  if (!DIGEST_PATTERN.test(retryAdmissionDigest)
      || sha256({ domain: 'sec.operation.recovered-retry-admission', admission: withoutDigest })
        !== retryAdmissionDigest) {
    throw new Error('Recovered retry projection digest is invalid.');
  }
}

export function projectCapabilityDiagnostic(input: Readonly<{
  readonly bindingDigest: OperationDigest;
  readonly code: string;
  readonly failureKind: string;
  readonly rawEvidence: string | Uint8Array;
}>): CapabilityDiagnostic {
  const evidence = typeof input.rawEvidence === 'string'
    ? new TextEncoder().encode(input.rawEvidence)
    : input.rawEvidence;
  return deepFreeze({
    bindingDigest: requireDigest(input.bindingDigest, 'Capability diagnostic binding digest'),
    code: requireId(input.code, 'Capability diagnostic code'),
    failureKind: requireId(input.failureKind, 'Capability diagnostic failure kind'),
    evidenceByteLength: evidence.byteLength,
    evidenceDigest: (
      `sha256:${rawSha256Hex(evidence)}`
    ) as OperationDigest
  });
}
