import { createHash, randomBytes } from 'node:crypto';
import {
  compareCodeUnits,
  deepFreeze,
  sha256
} from '../foundation/runtime/canonical.ts';
import { SEC_SEMANTIC_OPERATION_ID_PATTERN } from './identity.ts';

export type SecOperationDigest = `sha256:${string}`;

export const SEC_OPERATION_EFFECT_KINDS = [
  'filesystem',
  'network',
  'persistent-state',
  'process',
  'provider'
] as const;

export type SecOperationEffectKind = (typeof SEC_OPERATION_EFFECT_KINDS)[number];

export const SEC_OPERATION_BUDGET_RESOURCES = [
  'duration-ms',
  'input-bytes',
  'output-bytes',
  'processes',
  'records'
] as const;

export type SecOperationBudgetResource =
  (typeof SEC_OPERATION_BUDGET_RESOURCES)[number];

export type SecOperationRequirement = Readonly<{
  readonly id: string;
  readonly contractDigest: SecOperationDigest;
  readonly effectKinds: readonly SecOperationEffectKind[];
  readonly failureKinds: readonly string[];
}>;

export type SecOperationBudget = Readonly<{
  readonly resource: SecOperationBudgetResource;
  readonly maximum: number;
}>;

export type SecSemanticOperationIdentity = Readonly<{
  readonly operation: string;
  readonly intentDigest: SecOperationDigest;
  readonly decisionDigest: SecOperationDigest;
  readonly identityDigest: SecOperationDigest;
}>;

export type SecSemanticOperationExecutionPlan = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly aggregateBudgets: readonly SecOperationBudget[];
  readonly requirements: readonly SecOperationRequirement[];
  readonly executionPlanDigest: SecOperationDigest;
}>;

export type SecSemanticOperationAttemptContext = Readonly<{
  readonly authorityGrantDigest: SecOperationDigest;
  readonly runIdDigest: SecOperationDigest | null;
  readonly resumeEpochDigest: SecOperationDigest | null;
  readonly attemptNonceDigest: SecOperationDigest;
}>;

export type SecSemanticOperationAttempt = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly executionPlanDigest: SecOperationDigest;
  readonly authorityGrantDigest: SecOperationDigest;
  readonly runIdDigest: SecOperationDigest | null;
  readonly resumeEpochDigest: SecOperationDigest | null;
  readonly attemptNonceDigest: SecOperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly attemptDigest: SecOperationDigest;
}>;

export type SecSemanticOperationPlan = Readonly<{
  readonly identity: SecSemanticOperationIdentity;
  readonly execution: SecSemanticOperationExecutionPlan;
  readonly attempt: SecSemanticOperationAttempt;
}>;

export type SecCapabilityBinding = Readonly<{
  readonly requirementId: string;
  readonly contractDigest: SecOperationDigest;
  readonly providerIdentityDigest: SecOperationDigest;
  readonly bindingDigest: SecOperationDigest;
}>;

export type SecBoundSemanticOperation = Readonly<{
  readonly plan: SecSemanticOperationPlan;
  readonly bindings: readonly SecCapabilityBinding[];
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
}>;

export const SEC_PROVIDER_PHYSICAL_DISPOSITIONS = [
  'not-started',
  'settled',
  'unknown'
] as const;

export type SecProviderPhysicalDisposition =
  (typeof SEC_PROVIDER_PHYSICAL_DISPOSITIONS)[number];

export const SEC_DOMAIN_READBACK_DISPOSITIONS = [
  'applied',
  'not-applied',
  'unknown'
] as const;

export type SecDomainReadbackDisposition =
  (typeof SEC_DOMAIN_READBACK_DISPOSITIONS)[number];

/** Physical settlement for exactly one requirement of one bound attempt. */
export type SecProviderSettlementReceipt = Readonly<{
  readonly requirementId: string;
  readonly contractDigest: SecOperationDigest;
  readonly bindingDigest: SecOperationDigest;
  readonly operationIdentityDigest: SecOperationDigest;
  readonly executionPlanDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly physicalDisposition: SecProviderPhysicalDisposition;
  readonly providerSettlementReferenceDigest: SecOperationDigest;
  readonly providerReceiptDigest: SecOperationDigest;
}>;

/** Canonical exact set: one provider settlement for every requirement. */
export type SecProviderSettlementSet = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly executionPlanDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly settlements: readonly SecProviderSettlementReceipt[];
  readonly providerReceiptDigests: readonly SecOperationDigest[];
  readonly providerSettlementSetDigest: SecOperationDigest;
}>;

type SecDomainReadbackReceiptBase = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly executionPlanDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly readbackContractDigest: SecOperationDigest;
  readonly readbackReferenceDigest: SecOperationDigest;
  readonly currentPhysicalEpochDigest: SecOperationDigest;
  readonly disposition: SecDomainReadbackDisposition;
  readonly readbackReceiptDigest: SecOperationDigest;
}>;

export type SecNormalDomainReadbackReceipt = SecDomainReadbackReceiptBase & Readonly<{
  readonly recoveryMode: 'normal';
  readonly providerSettlementSetDigest: SecOperationDigest;
  readonly durableObservationDigest: null;
}>;

export type SecRecoveredDomainReadbackReceipt = SecDomainReadbackReceiptBase & Readonly<{
  readonly recoveryMode: 'recovered';
  readonly providerSettlementSetDigest: null;
  readonly durableObservationDigest: SecOperationDigest;
}>;

export type SecDomainReadbackReceipt =
  | SecNormalDomainReadbackReceipt
  | SecRecoveredDomainReadbackReceipt;

export type SecOwnerTerminalJoinReceipt = Readonly<{
  readonly recoveryMode: 'normal' | 'recovered';
  readonly operationIdentityDigest: SecOperationDigest;
  readonly executionPlanDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly providerSettlementSetDigest: SecOperationDigest | null;
  readonly readbackReceiptDigest: SecOperationDigest;
  readonly ownerTerminalContractDigest: SecOperationDigest;
  readonly ownerTerminalReferenceDigest: SecOperationDigest;
  readonly joinReceiptDigest: SecOperationDigest;
}>;

export type SecRecoveredRetryAdmission = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly previousExecutionPlanDigest: SecOperationDigest;
  readonly previousBindingSetIdentityDigest: SecOperationDigest;
  readonly previousBoundAttemptDigest: SecOperationDigest;
  readonly recoveredReadbackReceiptDigest: SecOperationDigest;
  readonly currentPhysicalEpochDigest: SecOperationDigest;
  readonly retryAdmissionDigest: SecOperationDigest;
}>;

export type SecCapabilityDiagnostic = Readonly<{
  readonly bindingDigest: SecOperationDigest;
  readonly code: string;
  readonly failureKind: string;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: SecOperationDigest;
}>;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ISSUED_BOUND_OPERATIONS = new WeakSet<object>();
const ISSUED_ATTEMPT_CONTEXTS = new WeakSet<object>();
const ISSUED_PROVIDER_SETTLEMENTS = new WeakSet<object>();
const ISSUED_PROVIDER_SETTLEMENT_SETS = new WeakSet<object>();
const ISSUED_DOMAIN_READBACKS = new WeakSet<object>();
const ISSUED_OWNER_TERMINAL_JOINS = new WeakSet<object>();
const ISSUED_RECOVERED_RETRY_ADMISSIONS = new WeakSet<object>();
const CONSUMED_RECOVERED_RETRY_ADMISSIONS = new WeakSet<object>();
const RETRY_ADMISSION_BY_RECOVERED_READBACK = new WeakMap<
  object,
  SecRecoveredRetryAdmission
>();

function requireDigest(value: string, label: string): SecOperationDigest {
  if (!DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest.`);
  }
  return value as SecOperationDigest;
}

function requireId(value: string, label: string): string {
  if (!SEC_SEMANTIC_OPERATION_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical semantic identity.`);
  }
  return value;
}

function canonicalUniqueStrings(values: readonly string[], label: string): readonly string[] {
  const canonical = [...values].sort(compareCodeUnits);
  if (canonical.some((value) => value.length === 0 || value.trim() !== value)
      || new Set(canonical).size !== canonical.length) {
    throw new Error(`${label} must contain unique non-empty canonical values.`);
  }
  return Object.freeze(canonical);
}

function canonicalRequirement(
  requirement: SecOperationRequirement
): SecOperationRequirement {
  const id = requireId(requirement.id, 'Operation requirement id');
  const effectKinds = canonicalUniqueStrings(
    requirement.effectKinds,
    `Operation requirement ${id} effect kinds`
  );
  if (effectKinds.some((kind) => !SEC_OPERATION_EFFECT_KINDS.includes(
    kind as SecOperationEffectKind
  ))) {
    throw new Error(`Operation requirement ${id} contains an unsupported Effect kind.`);
  }
  return deepFreeze({
    id,
    contractDigest: requireDigest(
      requirement.contractDigest,
      `Operation requirement ${id} contract digest`
    ),
    effectKinds: effectKinds as readonly SecOperationEffectKind[],
    failureKinds: canonicalUniqueStrings(
      requirement.failureKinds,
      `Operation requirement ${id} failure kinds`
    )
  });
}

export function compileSecSemanticOperationPlan(input: Readonly<{
  readonly operation: string;
  readonly intentDigest: SecOperationDigest;
  readonly decisionDigest: SecOperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly aggregateBudgets: readonly SecOperationBudget[];
  readonly requirements: readonly SecOperationRequirement[];
  readonly attempt: SecSemanticOperationAttemptContext;
}>): SecSemanticOperationPlan {
  const operation = requireId(input.operation, 'Semantic operation');
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs < 1) {
    throw new Error('Semantic operation deadline must be an absolute safe integer.');
  }
  const aggregateBudgets = [...input.aggregateBudgets]
    .sort((left, right) => compareCodeUnits(left.resource, right.resource))
    .map(({ resource, maximum }) => {
      if (!SEC_OPERATION_BUDGET_RESOURCES.includes(resource)
          || !Number.isSafeInteger(maximum)
          || maximum < 1) {
        throw new Error('Semantic operation aggregate budget is not canonical.');
      }
      return Object.freeze({ resource, maximum });
    });
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
  if (!ISSUED_ATTEMPT_CONTEXTS.has(input.attempt)) {
    throw new Error('Semantic operation attempt context is not owner-issued.');
  }
  const identityWithoutDigest = deepFreeze({
    operation,
    intentDigest: requireDigest(input.intentDigest, 'Semantic operation intent digest'),
    decisionDigest: requireDigest(input.decisionDigest, 'Semantic operation decision digest')
  });
  const identity = deepFreeze({
    ...identityWithoutDigest,
    identityDigest: sha256(identityWithoutDigest) as SecOperationDigest
  });
  const executionWithoutDigest = deepFreeze({
    operationIdentityDigest: identity.identityDigest,
    aggregateBudgets: Object.freeze(aggregateBudgets),
    requirements: Object.freeze(requirements)
  });
  const execution = deepFreeze({
    ...executionWithoutDigest,
    executionPlanDigest: sha256(executionWithoutDigest) as SecOperationDigest
  });
  const attemptWithoutDigest = deepFreeze({
    operationIdentityDigest: identity.identityDigest,
    executionPlanDigest: execution.executionPlanDigest,
    authorityGrantDigest: input.attempt.authorityGrantDigest,
    runIdDigest: input.attempt.runIdDigest,
    resumeEpochDigest: input.attempt.resumeEpochDigest,
    attemptNonceDigest: input.attempt.attemptNonceDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
  return deepFreeze({
    identity,
    execution,
    attempt: deepFreeze({
      ...attemptWithoutDigest,
      attemptDigest: sha256(attemptWithoutDigest) as SecOperationDigest
    })
  });
}

/**
 * Issues one physical-attempt lineage capability. The nonce is generated by
 * the canonical operation owner and cannot be supplied or reconstructed by a
 * caller. Durable execution later binds this attempt to its claim generation
 * and worker identity; it never changes the stable OperationKey.
 */
export function issueSecSemanticOperationAttemptContext(input: Readonly<{
  readonly authorityGrantDigest: SecOperationDigest;
  readonly runIdDigest?: SecOperationDigest | null;
  readonly resumeEpochDigest?: SecOperationDigest | null;
}>): SecSemanticOperationAttemptContext {
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
    attemptNonceDigest: `sha256:${randomBytes(32).toString('hex')}` as SecOperationDigest
  });
  ISSUED_ATTEMPT_CONTEXTS.add(context);
  return context;
}

export function compileSecCapabilityBinding(input: Readonly<{
  readonly requirementId: string;
  readonly contractDigest: SecOperationDigest;
  readonly providerIdentityDigest: SecOperationDigest;
}>): SecCapabilityBinding {
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
    bindingDigest: sha256(withoutDigest) as SecOperationDigest
  });
}

export function bindSecSemanticOperation(
  plan: SecSemanticOperationPlan,
  suppliedBindings: readonly SecCapabilityBinding[]
): SecBoundSemanticOperation {
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
    const canonical = compileSecCapabilityBinding(binding);
    if (canonical.bindingDigest !== binding.bindingDigest) {
      throw new Error(`Semantic operation requirement ${requirement.id} binding is noncanonical.`);
    }
  }
  const frozenBindings = Object.freeze(bindings);
  const bindingSetIdentityDigest = sha256({
    operationIdentityDigest: plan.identity.identityDigest,
    executionPlanDigest: plan.execution.executionPlanDigest,
    bindings: frozenBindings.map(({ bindingDigest }) => bindingDigest)
  }) as SecOperationDigest;
  const bound = deepFreeze({
    plan,
    bindings: frozenBindings,
    bindingSetIdentityDigest,
    boundAttemptDigest: sha256({
      attemptDigest: plan.attempt.attemptDigest,
      bindingSetIdentityDigest
    }) as SecOperationDigest
  });
  ISSUED_BOUND_OPERATIONS.add(bound);
  return bound;
}

/**
 * Machine admission for lower capability owners. Structural copies of an
 * operation plan or binding set cannot authorize an Effect.
 */
export function assertSecBoundSemanticOperation(
  operation: SecBoundSemanticOperation
): void {
  if (!ISSUED_BOUND_OPERATIONS.has(operation)) {
    throw new Error('Effect capability requires an owner-issued bound semantic operation.');
  }
}

export function issueSecProviderSettlementReceipt(
  operation: SecBoundSemanticOperation,
  input: Readonly<{
    readonly requirementId: string;
    readonly physicalDisposition: SecProviderPhysicalDisposition;
    readonly providerSettlementReferenceDigest: SecOperationDigest;
  }>
): SecProviderSettlementReceipt {
  if (!ISSUED_BOUND_OPERATIONS.has(operation)) {
    throw new Error('Provider settlement requires an owner-issued bound semantic operation.');
  }
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
  if (!SEC_PROVIDER_PHYSICAL_DISPOSITIONS.includes(input.physicalDisposition)) {
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
    }) as SecOperationDigest
  });
  ISSUED_PROVIDER_SETTLEMENTS.add(receipt);
  return receipt;
}

export function assertSecProviderSettlementReceipt(
  value: unknown
): asserts value is SecProviderSettlementReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_PROVIDER_SETTLEMENTS.has(value)) {
    throw new Error('Provider settlement receipt is not provider-issued.');
  }
}

export function compileSecProviderSettlementSet(
  operation: SecBoundSemanticOperation,
  suppliedSettlements: readonly SecProviderSettlementReceipt[]
): SecProviderSettlementSet {
  if (!ISSUED_BOUND_OPERATIONS.has(operation)) {
    throw new Error('Provider settlement set requires an owner-issued bound semantic operation.');
  }
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
    assertSecProviderSettlementReceipt(settlement);
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
    }) as SecOperationDigest
  });
  ISSUED_PROVIDER_SETTLEMENT_SETS.add(settlementSet);
  return settlementSet;
}

export function assertSecProviderSettlementSet(
  value: unknown
): asserts value is SecProviderSettlementSet {
  if (value === null || typeof value !== 'object'
      || !ISSUED_PROVIDER_SETTLEMENT_SETS.has(value)) {
    throw new Error('Provider settlement set is not owner-issued.');
  }
}

function requireBoundReadbackOperation(operation: SecBoundSemanticOperation): void {
  if (!ISSUED_BOUND_OPERATIONS.has(operation)) {
    throw new Error('Domain readback requires an owner-issued bound semantic operation.');
  }
}

function canonicalReadbackDisposition(value: string): SecDomainReadbackDisposition {
  if (!SEC_DOMAIN_READBACK_DISPOSITIONS.includes(value as SecDomainReadbackDisposition)) {
    throw new Error('Domain readback disposition is not canonical.');
  }
  return value as SecDomainReadbackDisposition;
}

function issueDomainReadbackReceipt(input: Readonly<{
  readonly operation: SecBoundSemanticOperation;
  readonly recoveryMode: 'normal' | 'recovered';
  readonly providerSettlementSetDigest: SecOperationDigest | null;
  readonly durableObservationDigest: SecOperationDigest | null;
  readonly readbackContractDigest: SecOperationDigest;
  readonly readbackReferenceDigest: SecOperationDigest;
  readonly currentPhysicalEpochDigest: SecOperationDigest;
  readonly disposition: SecDomainReadbackDisposition;
}>): SecDomainReadbackReceipt {
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
    }) as SecOperationDigest
  }) as SecDomainReadbackReceipt;
  ISSUED_DOMAIN_READBACKS.add(receipt);
  return receipt;
}

export function issueSecNormalDomainReadbackReceipt(
  operation: SecBoundSemanticOperation,
  providerSettlementSet: SecProviderSettlementSet,
  input: Readonly<{
    readonly readbackContractDigest: SecOperationDigest;
    readonly readbackReferenceDigest: SecOperationDigest;
    readonly currentPhysicalEpochDigest: SecOperationDigest;
    readonly disposition: SecDomainReadbackDisposition;
  }>
): SecNormalDomainReadbackReceipt {
  requireBoundReadbackOperation(operation);
  assertSecProviderSettlementSet(providerSettlementSet);
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
  }) as SecNormalDomainReadbackReceipt;
}

export function issueSecRecoveredDomainReadbackReceipt(
  operation: SecBoundSemanticOperation,
  input: Readonly<{
    readonly durableObservationDigest: SecOperationDigest;
    readonly readbackContractDigest: SecOperationDigest;
    readonly readbackReferenceDigest: SecOperationDigest;
    readonly currentPhysicalEpochDigest: SecOperationDigest;
    readonly disposition: SecDomainReadbackDisposition;
  }>
): SecRecoveredDomainReadbackReceipt {
  requireBoundReadbackOperation(operation);
  return issueDomainReadbackReceipt({
    operation,
    recoveryMode: 'recovered',
    providerSettlementSetDigest: null,
    durableObservationDigest: requireDigest(
      input.durableObservationDigest,
      'Recovered domain durable observation digest'
    ),
    readbackContractDigest: input.readbackContractDigest,
    readbackReferenceDigest: input.readbackReferenceDigest,
    currentPhysicalEpochDigest: input.currentPhysicalEpochDigest,
    disposition: input.disposition
  }) as SecRecoveredDomainReadbackReceipt;
}

export function assertSecDomainReadbackReceipt(
  value: unknown
): asserts value is SecDomainReadbackReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_DOMAIN_READBACKS.has(value)) {
    throw new Error('Domain readback receipt is not domain-issued.');
  }
}

function assertReadbackBindsOperation(
  operation: SecBoundSemanticOperation,
  readback: SecDomainReadbackReceipt
): void {
  assertSecDomainReadbackReceipt(readback);
  if (readback.operationIdentityDigest !== operation.plan.identity.identityDigest
      || readback.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || readback.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || readback.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new Error('Domain readback does not bind the exact operation attempt.');
  }
}

function issueOwnerTerminalJoinReceipt(input: Readonly<{
  readonly operation: SecBoundSemanticOperation;
  readonly readback: SecDomainReadbackReceipt;
  readonly ownerTerminalContractDigest: SecOperationDigest;
  readonly ownerTerminalReferenceDigest: SecOperationDigest;
}>): SecOwnerTerminalJoinReceipt {
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
    }) as SecOperationDigest
  });
  ISSUED_OWNER_TERMINAL_JOINS.add(receipt);
  return receipt;
}

export function issueSecNormalOwnerTerminalJoinReceipt(
  operation: SecBoundSemanticOperation,
  providerSettlementSet: SecProviderSettlementSet,
  readback: SecNormalDomainReadbackReceipt,
  input: Readonly<{
    readonly ownerTerminalContractDigest: SecOperationDigest;
    readonly ownerTerminalReferenceDigest: SecOperationDigest;
  }>
): SecOwnerTerminalJoinReceipt {
  requireBoundReadbackOperation(operation);
  assertSecProviderSettlementSet(providerSettlementSet);
  assertReadbackBindsOperation(operation, readback);
  if (readback.recoveryMode !== 'normal'
      || readback.providerSettlementSetDigest
        !== providerSettlementSet.providerSettlementSetDigest) {
    throw new Error('Normal owner terminal join requires its exact provider settlement set.');
  }
  return issueOwnerTerminalJoinReceipt({ operation, readback, ...input });
}

export function issueSecRecoveredOwnerTerminalJoinReceipt(
  operation: SecBoundSemanticOperation,
  readback: SecRecoveredDomainReadbackReceipt,
  input: Readonly<{
    readonly ownerTerminalContractDigest: SecOperationDigest;
    readonly ownerTerminalReferenceDigest: SecOperationDigest;
  }>
): SecOwnerTerminalJoinReceipt {
  requireBoundReadbackOperation(operation);
  assertReadbackBindsOperation(operation, readback);
  if (readback.recoveryMode !== 'recovered') {
    throw new Error('Recovered owner terminal join requires a recovered readback.');
  }
  return issueOwnerTerminalJoinReceipt({ operation, readback, ...input });
}

export function assertSecOwnerTerminalJoinReceipt(
  value: unknown
): asserts value is SecOwnerTerminalJoinReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_OWNER_TERMINAL_JOINS.has(value)) {
    throw new Error('Owner terminal join receipt is not owner-issued.');
  }
}

export function issueSecRecoveredRetryAdmission(
  readback: SecRecoveredDomainReadbackReceipt
): SecRecoveredRetryAdmission {
  assertSecDomainReadbackReceipt(readback);
  if (readback.recoveryMode !== 'recovered'
      || readback.disposition !== 'not-applied') {
    throw new Error('Retry admission requires a conclusive recovered not-applied readback.');
  }
  if (RETRY_ADMISSION_BY_RECOVERED_READBACK.has(readback)) {
    throw new Error('Recovered readback has already issued its retry admission.');
  }
  const withoutDigest = deepFreeze({
    operationIdentityDigest: readback.operationIdentityDigest,
    previousExecutionPlanDigest: readback.executionPlanDigest,
    previousBindingSetIdentityDigest: readback.bindingSetIdentityDigest,
    previousBoundAttemptDigest: readback.boundAttemptDigest,
    recoveredReadbackReceiptDigest: readback.readbackReceiptDigest,
    currentPhysicalEpochDigest: readback.currentPhysicalEpochDigest
  });
  const admission = deepFreeze({
    ...withoutDigest,
    retryAdmissionDigest: sha256({
      domain: 'sec.operation.recovered-retry-admission',
      admission: withoutDigest
    }) as SecOperationDigest
  });
  ISSUED_RECOVERED_RETRY_ADMISSIONS.add(admission);
  RETRY_ADMISSION_BY_RECOVERED_READBACK.set(readback, admission);
  return admission;
}

export function consumeSecRecoveredRetryAdmission(
  admission: SecRecoveredRetryAdmission,
  successor: SecBoundSemanticOperation
): void {
  if (!ISSUED_RECOVERED_RETRY_ADMISSIONS.has(admission)) {
    throw new Error('Recovered retry admission is not owner-issued.');
  }
  if (CONSUMED_RECOVERED_RETRY_ADMISSIONS.has(admission)) {
    throw new Error('Recovered retry admission has already been consumed.');
  }
  if (!ISSUED_BOUND_OPERATIONS.has(successor)
      || successor.plan.identity.identityDigest !== admission.operationIdentityDigest
      || successor.boundAttemptDigest === admission.previousBoundAttemptDigest) {
    throw new Error('Recovered retry admission does not authorize this successor attempt.');
  }
  CONSUMED_RECOVERED_RETRY_ADMISSIONS.add(admission);
}

export function assertSecRecoveredRetryAdmission(
  value: unknown
): asserts value is SecRecoveredRetryAdmission {
  if (value === null || typeof value !== 'object'
      || !ISSUED_RECOVERED_RETRY_ADMISSIONS.has(value)) {
    throw new Error('Recovered retry admission is not owner-issued.');
  }
}

export function projectSecCapabilityDiagnostic(input: Readonly<{
  readonly bindingDigest: SecOperationDigest;
  readonly code: string;
  readonly failureKind: string;
  readonly rawEvidence: string | Uint8Array;
}>): SecCapabilityDiagnostic {
  const evidence = typeof input.rawEvidence === 'string'
    ? new TextEncoder().encode(input.rawEvidence)
    : input.rawEvidence;
  return deepFreeze({
    bindingDigest: requireDigest(input.bindingDigest, 'Capability diagnostic binding digest'),
    code: requireId(input.code, 'Capability diagnostic code'),
    failureKind: requireId(input.failureKind, 'Capability diagnostic failure kind'),
    evidenceByteLength: evidence.byteLength,
    evidenceDigest: (
      `sha256:${createHash('sha256').update(evidence).digest('hex')}`
    ) as SecOperationDigest
  });
}
