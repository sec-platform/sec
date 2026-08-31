import { createHash } from 'node:crypto';
import {
  compareCodeUnits,
  deepFreeze,
  sha256
} from '../foundation/runtime/canonical.ts';

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
  readonly aggregateBudgets: readonly SecOperationBudget[];
  readonly requirements: readonly SecOperationRequirement[];
  readonly identityDigest: SecOperationDigest;
}>;

export type SecSemanticOperationAttempt = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly attemptDigest: SecOperationDigest;
}>;

export type SecSemanticOperationPlan = Readonly<{
  readonly identity: SecSemanticOperationIdentity;
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

export const SEC_OPERATION_TERMINAL_CLASSES = [
  'completed',
  'failed',
  'not-run',
  'unsupported',
  'invalidated',
  'cancelled',
  'timed-out',
  'cleanup-failed',
  'process-settlement-failed',
  'started-without-terminal'
] as const;

export type SecOperationTerminalClass =
  (typeof SEC_OPERATION_TERMINAL_CLASSES)[number];

/**
 * Ephemeral proof that one bound provider attempt reached a physical
 * settlement.  It deliberately excludes domain outcome/readback semantics:
 * the provider cannot declare the business result of its own Effect.
 */
export type SecProviderSettlementReceipt = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly providerTerminalClass: SecOperationTerminalClass;
  readonly effectSettlementDigest: SecOperationDigest;
  readonly providerReceiptDigest: SecOperationDigest;
}>;

/**
 * Ephemeral proof issued by a domain parser after consuming an exact provider
 * settlement and an independently observed readback.  It cannot be forged by
 * cloning either input receipt and it cannot upgrade a provider failure to a
 * completed domain outcome.
 */
export type SecDomainOutcomeReceipt = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly providerReceiptDigest: SecOperationDigest;
  readonly terminalClass: SecOperationTerminalClass;
  readonly effectReadbackDigest: SecOperationDigest;
  readonly domainReceiptDigest: SecOperationDigest;
  readonly outcomeReceiptDigest: SecOperationDigest;
}>;

/**
 * Ephemeral, owner-issued bridge from one exact Effect attempt to a domain
 * terminal projection.  The opaque domain receipt remains owned by the
 * executing domain; this envelope only binds its digest to the semantic
 * operation, capability set, physical settlement and exact readback.
 *
 * This value deliberately has no parser or serialized compatibility surface.
 * A structural clone is not authority and is rejected by the issuer check.
 */
export type SecOperationSettlementEnvelope = Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly effectSettlementDigest: SecOperationDigest;
  readonly effectReadbackDigest: SecOperationDigest;
  readonly terminalClass: SecOperationTerminalClass;
  readonly domainReceiptDigest: SecOperationDigest;
  readonly settlementDigest: SecOperationDigest;
}>;

export type SecCapabilityDiagnostic = Readonly<{
  readonly bindingDigest: SecOperationDigest;
  readonly code: string;
  readonly failureKind: string;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: SecOperationDigest;
}>;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const ISSUED_BOUND_OPERATIONS = new WeakSet<object>();
const ISSUED_PROVIDER_SETTLEMENTS = new WeakSet<object>();
const ISSUED_DOMAIN_OUTCOMES = new WeakSet<object>();
const ISSUED_SETTLEMENT_ENVELOPES = new WeakSet<object>();

function requireDigest(value: string, label: string): SecOperationDigest {
  if (!DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest.`);
  }
  return value as SecOperationDigest;
}

function requireId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
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
  const identityWithoutDigest = deepFreeze({
    operation,
    intentDigest: requireDigest(input.intentDigest, 'Semantic operation intent digest'),
    decisionDigest: requireDigest(input.decisionDigest, 'Semantic operation decision digest'),
    aggregateBudgets: Object.freeze(aggregateBudgets),
    requirements: Object.freeze(requirements)
  });
  const identity = deepFreeze({
    ...identityWithoutDigest,
    identityDigest: sha256(identityWithoutDigest) as SecOperationDigest
  });
  const attemptWithoutDigest = deepFreeze({
    operationIdentityDigest: identity.identityDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
  return deepFreeze({
    identity,
    attempt: deepFreeze({
      ...attemptWithoutDigest,
      attemptDigest: sha256(attemptWithoutDigest) as SecOperationDigest
    })
  });
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
  if (bindings.length !== plan.identity.requirements.length
      || new Set(bindings.map(({ requirementId }) => requirementId)).size !== bindings.length) {
    throw new Error('Semantic operation requires exactly one binding per requirement.');
  }
  for (const requirement of plan.identity.requirements) {
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

function canonicalTerminalClass(value: string): SecOperationTerminalClass {
  if (!SEC_OPERATION_TERMINAL_CLASSES.includes(value as SecOperationTerminalClass)) {
    throw new Error('Operation settlement terminal class is not canonical.');
  }
  return value as SecOperationTerminalClass;
}

function observationDigest(domain: string, observation: unknown): SecOperationDigest {
  return sha256({ domain, observation }) as SecOperationDigest;
}

export function issueSecProviderSettlementReceipt(
  operation: SecBoundSemanticOperation,
  input: Readonly<{
    readonly terminalClass: SecOperationTerminalClass;
    readonly providerSettlement: unknown;
  }>
): SecProviderSettlementReceipt {
  if (!ISSUED_BOUND_OPERATIONS.has(operation)) {
    throw new Error('Provider settlement requires an owner-issued bound semantic operation.');
  }
  const providerTerminalClass = canonicalTerminalClass(input.terminalClass);
  const effectSettlementDigest = observationDigest(
    'sec.operation.provider-settlement',
    input.providerSettlement
  );
  const withoutDigest = deepFreeze({
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    bindingSetIdentityDigest: operation.bindingSetIdentityDigest,
    providerTerminalClass,
    effectSettlementDigest
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

export function issueSecDomainOutcomeReceipt(
  providerSettlement: SecProviderSettlementReceipt,
  input: Readonly<{
    readonly terminalClass: SecOperationTerminalClass;
    readonly effectReadback: unknown;
    readonly domainOutcome: unknown;
  }>
): SecDomainOutcomeReceipt {
  assertSecProviderSettlementReceipt(providerSettlement);
  const terminalClass = canonicalTerminalClass(input.terminalClass);
  if (providerSettlement.providerTerminalClass !== 'completed'
      && terminalClass === 'completed') {
    throw new Error('Domain outcome cannot upgrade a non-completed provider settlement.');
  }
  const effectReadbackDigest = observationDigest(
    'sec.operation.effect-readback',
    input.effectReadback
  );
  const domainReceiptDigest = observationDigest(
    'sec.operation.domain-outcome',
    input.domainOutcome
  );
  if (effectReadbackDigest === providerSettlement.effectSettlementDigest
      || domainReceiptDigest === providerSettlement.effectSettlementDigest
      || domainReceiptDigest === effectReadbackDigest) {
    throw new Error('Provider settlement, Effect readback and domain outcome must be independent.');
  }
  const withoutDigest = deepFreeze({
    operationIdentityDigest: providerSettlement.operationIdentityDigest,
    boundAttemptDigest: providerSettlement.boundAttemptDigest,
    bindingSetIdentityDigest: providerSettlement.bindingSetIdentityDigest,
    providerReceiptDigest: providerSettlement.providerReceiptDigest,
    terminalClass,
    effectReadbackDigest,
    domainReceiptDigest
  });
  const receipt = deepFreeze({
    ...withoutDigest,
    outcomeReceiptDigest: sha256({
      domain: 'sec.operation.domain-outcome-receipt',
      receipt: withoutDigest
    }) as SecOperationDigest
  });
  ISSUED_DOMAIN_OUTCOMES.add(receipt);
  return receipt;
}

export function assertSecDomainOutcomeReceipt(
  value: unknown
): asserts value is SecDomainOutcomeReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_DOMAIN_OUTCOMES.has(value)) {
    throw new Error('Domain outcome receipt is not domain-issued.');
  }
}

function settlementWithoutDigest(input: Readonly<{
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly bindingSetIdentityDigest: SecOperationDigest;
  readonly effectSettlementDigest: SecOperationDigest;
  readonly effectReadbackDigest: SecOperationDigest;
  readonly terminalClass: SecOperationTerminalClass;
  readonly domainReceiptDigest: SecOperationDigest;
}>): Omit<SecOperationSettlementEnvelope, 'settlementDigest'> {
  const effectSettlementDigest = requireDigest(
    input.effectSettlementDigest,
    'Operation Effect settlement digest'
  );
  const effectReadbackDigest = requireDigest(
    input.effectReadbackDigest,
    'Operation Effect readback digest'
  );
  if (effectSettlementDigest === effectReadbackDigest) {
    throw new Error('Operation Effect settlement and readback must be independently observed.');
  }
  return deepFreeze({
    operationIdentityDigest: requireDigest(
      input.operationIdentityDigest,
      'Operation settlement identity digest'
    ),
    boundAttemptDigest: requireDigest(
      input.boundAttemptDigest,
      'Operation settlement bound attempt digest'
    ),
    bindingSetIdentityDigest: requireDigest(
      input.bindingSetIdentityDigest,
      'Operation settlement binding-set digest'
    ),
    effectSettlementDigest,
    effectReadbackDigest,
    terminalClass: canonicalTerminalClass(input.terminalClass),
    domainReceiptDigest: requireDigest(
      input.domainReceiptDigest,
      'Operation settlement domain receipt digest'
    )
  });
}

export function issueSecOperationSettlementEnvelope(
  operation: SecBoundSemanticOperation,
  providerSettlement: SecProviderSettlementReceipt,
  domainOutcome: SecDomainOutcomeReceipt
): SecOperationSettlementEnvelope {
  if (!ISSUED_BOUND_OPERATIONS.has(operation)) {
    throw new Error('Operation settlement requires an owner-issued bound semantic operation.');
  }
  assertSecProviderSettlementReceipt(providerSettlement);
  assertSecDomainOutcomeReceipt(domainOutcome);
  if (providerSettlement.operationIdentityDigest !== operation.plan.identity.identityDigest
      || providerSettlement.boundAttemptDigest !== operation.boundAttemptDigest
      || providerSettlement.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || domainOutcome.operationIdentityDigest !== operation.plan.identity.identityDigest
      || domainOutcome.boundAttemptDigest !== operation.boundAttemptDigest
      || domainOutcome.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || domainOutcome.providerReceiptDigest !== providerSettlement.providerReceiptDigest) {
    throw new Error('Operation settlement receipts do not bind the exact operation attempt.');
  }
  const withoutDigest = settlementWithoutDigest({
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    bindingSetIdentityDigest: operation.bindingSetIdentityDigest,
    effectSettlementDigest: providerSettlement.effectSettlementDigest,
    effectReadbackDigest: domainOutcome.effectReadbackDigest,
    terminalClass: domainOutcome.terminalClass,
    domainReceiptDigest: domainOutcome.domainReceiptDigest
  });
  const envelope = deepFreeze({
    ...withoutDigest,
    settlementDigest: sha256(withoutDigest) as SecOperationDigest
  });
  ISSUED_SETTLEMENT_ENVELOPES.add(envelope);
  return envelope;
}

export function assertSecOperationSettlementEnvelope(
  value: unknown
): asserts value is SecOperationSettlementEnvelope {
  if (value === null || typeof value !== 'object'
      || !ISSUED_SETTLEMENT_ENVELOPES.has(value)) {
    throw new Error('Operation settlement envelope is not owner-issued.');
  }
  const envelope = value as SecOperationSettlementEnvelope;
  const withoutDigest = settlementWithoutDigest(envelope);
  if (requireDigest(envelope.settlementDigest, 'Operation settlement digest')
      !== sha256(withoutDigest)) {
    throw new Error('Operation settlement envelope digest mismatch.');
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
