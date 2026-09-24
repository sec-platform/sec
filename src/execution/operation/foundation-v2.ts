import { randomBytes } from 'node:crypto';
import { types as nativeTypes } from 'node:util';

import { compareCodeUnits, deepFreeze } from '../../contracts/canonical.ts';
import { isDigest, type Digest } from '../../contracts/digest.ts';
import { identityFrameHeader, type Identity } from '../../contracts/identity-profile.ts';
import {
  assertStructuredIdentityRuntime,
  type StructuredIdentityRuntime
} from '../../contracts/structured-identity.ts';
import {
  canonicalOperationBudget,
  canonicalOperationEffectKinds,
  canonicalUniqueOperationStrings,
  type OperationBudget,
  type OperationEffectKind
} from './contract.ts';
import { SEC_SEMANTIC_OPERATION_ID_PATTERN } from './identity.ts';

export type OperationIdentityReference = Readonly<{
  readonly domain: string;
  readonly schema: string;
  readonly digest: Digest;
}>;

export type OperationAttemptNonceV2 = `nonce256:${string}`;

export type OperationRequirementV2 = Readonly<{
  readonly id: string;
  readonly contract: OperationIdentityReference;
  readonly effectKinds: readonly OperationEffectKind[];
  readonly failureKinds: readonly string[];
}>;

type OperationIntentIdentityV2 = Identity<'operation', 'intent/v2'>;
type OperationExecutionIdentityV2 = Identity<'operation', 'execution-plan/v2'>;
type OperationAttemptIdentityV2 = Identity<'operation', 'attempt/v2'>;
type CapabilityBindingIdentityV2 = Identity<'operation', 'capability-binding/v2'>;
type BindingSetIdentityV2 = Identity<'operation', 'binding-set/v2'>;
type BoundAttemptIdentityV2 = Identity<'operation', 'bound-attempt/v2'>;
type ProviderSettlementIdentityV2 = Identity<'operation', 'provider-settlement/v2'>;
type ProviderSettlementSetIdentityV2 = Identity<'operation', 'provider-settlement-set/v2'>;
type DomainReadbackIdentityV2 = Identity<'operation', 'domain-readback/v2'>;
type OwnerTerminalJoinIdentityV2 = Identity<'operation', 'owner-terminal-join/v2'>;
type RecoveredRetryAdmissionIdentityV2 = Identity<'operation', 'recovered-retry-admission/v2'>;

export type ProviderPhysicalDispositionV2 = 'not-started' | 'settled' | 'unknown';
export type DomainReadbackDispositionV2 = 'applied' | 'not-applied' | 'unknown';

export type ProviderSettlementReceiptV2 = Readonly<{
  readonly requirementId: string;
  readonly contract: OperationIdentityReference;
  readonly bindingIdentity: CapabilityBindingIdentityV2;
  readonly operationIdentity: OperationIntentIdentityV2;
  readonly executionIdentity: OperationExecutionIdentityV2;
  readonly boundAttemptIdentity: BoundAttemptIdentityV2;
  readonly physicalDisposition: ProviderPhysicalDispositionV2;
  readonly providerSettlementReference: OperationIdentityReference;
  readonly identity: ProviderSettlementIdentityV2;
}>;

export type ProviderSettlementSetV2 = Readonly<{
  readonly operationIdentity: OperationIntentIdentityV2;
  readonly executionIdentity: OperationExecutionIdentityV2;
  readonly bindingSetIdentity: BindingSetIdentityV2;
  readonly boundAttemptIdentity: BoundAttemptIdentityV2;
  readonly settlements: readonly ProviderSettlementReceiptV2[];
  readonly identity: ProviderSettlementSetIdentityV2;
}>;

export type RecoveredPredecessorAttemptReferenceV2 = Readonly<{
  readonly operationIdentity: OperationIntentIdentityV2;
  readonly executionIdentity: OperationExecutionIdentityV2;
  readonly bindingSetIdentity: BindingSetIdentityV2;
  readonly boundAttemptIdentity: BoundAttemptIdentityV2;
  readonly nonce: OperationAttemptNonceV2;
  readonly authorityGrant: OperationIdentityReference;
  readonly resumeEpoch: OperationIdentityReference | null;
  readonly deadlineAtUnixMs: number;
}>;

type DomainReadbackReceiptBaseV2 = Readonly<{
  readonly operationIdentity: OperationIntentIdentityV2;
  readonly executionIdentity: OperationExecutionIdentityV2;
  readonly bindingSetIdentity: BindingSetIdentityV2;
  readonly boundAttemptIdentity: BoundAttemptIdentityV2;
  readonly readbackContract: OperationIdentityReference;
  readonly readbackReference: OperationIdentityReference;
  readonly currentPhysicalEpoch: OperationIdentityReference;
  readonly disposition: DomainReadbackDispositionV2;
  readonly identity: DomainReadbackIdentityV2;
}>;

export type NormalDomainReadbackReceiptV2 = DomainReadbackReceiptBaseV2 & Readonly<{
  readonly recoveryMode: 'normal';
  readonly providerSettlementSetIdentity: ProviderSettlementSetIdentityV2;
  readonly durableObservation: null;
  readonly predecessor: null;
}>;

export type RecoveredDomainReadbackReceiptV2 = DomainReadbackReceiptBaseV2 & Readonly<{
  readonly recoveryMode: 'recovered';
  readonly providerSettlementSetIdentity: null;
  readonly durableObservation: OperationIdentityReference;
  readonly predecessor: RecoveredPredecessorAttemptReferenceV2;
}>;

export type DomainReadbackReceiptV2 =
  | NormalDomainReadbackReceiptV2
  | RecoveredDomainReadbackReceiptV2;

export type OwnerTerminalJoinReceiptV2 = Readonly<{
  readonly recoveryMode: 'normal' | 'recovered';
  readonly operationIdentity: OperationIntentIdentityV2;
  readonly executionIdentity: OperationExecutionIdentityV2;
  readonly bindingSetIdentity: BindingSetIdentityV2;
  readonly boundAttemptIdentity: BoundAttemptIdentityV2;
  readonly providerSettlementSetIdentity: ProviderSettlementSetIdentityV2 | null;
  readonly readbackIdentity: DomainReadbackIdentityV2;
  readonly ownerTerminalContract: OperationIdentityReference;
  readonly ownerTerminalReference: OperationIdentityReference;
  readonly identity: OwnerTerminalJoinIdentityV2;
}>;

export type RecoveredRetryAdmissionV2 = Readonly<{
  readonly operationIdentity: OperationIntentIdentityV2;
  readonly previousExecutionIdentity: OperationExecutionIdentityV2;
  readonly previousBindingSetIdentity: BindingSetIdentityV2;
  readonly previousBoundAttemptIdentity: BoundAttemptIdentityV2;
  readonly previousNonce: OperationAttemptNonceV2;
  readonly previousDeadlineAtUnixMs: number;
  readonly recoveryBoundAttemptIdentity: BoundAttemptIdentityV2;
  readonly recoveryAuthorityGrant: OperationIdentityReference;
  readonly recoveryResumeEpoch: OperationIdentityReference;
  readonly recoveredReadbackIdentity: DomainReadbackIdentityV2;
  readonly currentPhysicalEpoch: OperationIdentityReference;
  readonly identity: RecoveredRetryAdmissionIdentityV2;
}>;

export type SemanticOperationIntentV2 = Readonly<{
  readonly operation: string;
  readonly intent: OperationIdentityReference;
  readonly decision: OperationIdentityReference;
  readonly identity: OperationIntentIdentityV2;
  readonly execution: Readonly<{
    readonly operationIdentity: OperationIntentIdentityV2;
    readonly aggregateBudgets: readonly OperationBudget[];
    readonly requirements: readonly OperationRequirementV2[];
    readonly identity: OperationExecutionIdentityV2;
  }>;
}>;

export type SemanticOperationAttemptContextV2 = Readonly<{
  readonly authorityGrant: OperationIdentityReference;
  readonly run: OperationIdentityReference | null;
  readonly resumeEpoch: OperationIdentityReference | null;
  readonly nonce: OperationAttemptNonceV2;
}>;

export type SemanticOperationPlanV2 = SemanticOperationIntentV2 & Readonly<{
  readonly attempt: Readonly<{
    readonly operationIdentity: OperationIntentIdentityV2;
    readonly executionIdentity: OperationExecutionIdentityV2;
    readonly authorityGrant: OperationIdentityReference;
    readonly run: OperationIdentityReference | null;
    readonly resumeEpoch: OperationIdentityReference | null;
    readonly nonce: OperationAttemptNonceV2;
    readonly deadlineAtUnixMs: number;
    readonly identity: OperationAttemptIdentityV2;
  }>;
}>;

export type CapabilityBindingV2 = Readonly<{
  readonly requirementId: string;
  readonly contract: OperationIdentityReference;
  readonly provider: OperationIdentityReference;
  readonly identity: CapabilityBindingIdentityV2;
}>;

export type BoundSemanticOperationV2 = Readonly<{
  readonly plan: SemanticOperationPlanV2;
  readonly bindings: readonly CapabilityBindingV2[];
  readonly bindingSetIdentity: BindingSetIdentityV2;
  readonly boundAttemptIdentity: BoundAttemptIdentityV2;
}>;

export type OperationFoundationV2 = Readonly<{
  createReference(input: OperationIdentityReference): OperationIdentityReference;
  assertIntent(value: unknown): asserts value is SemanticOperationIntentV2;
  assertPlan(value: unknown): asserts value is SemanticOperationPlanV2;
  issueAttemptContext(input: Readonly<{
    authorityGrant: OperationIdentityReference;
    run?: OperationIdentityReference | null;
    resumeEpoch?: OperationIdentityReference | null;
  }>): SemanticOperationAttemptContextV2;
  compileIntent(input: Readonly<{
    operation: string;
    intent: OperationIdentityReference;
    decision: OperationIdentityReference;
    aggregateBudgets: readonly OperationBudget[];
    requirements: readonly OperationRequirementV2[];
  }>): SemanticOperationIntentV2;
  compilePlan(input: Readonly<{
    operation: string;
    intent: OperationIdentityReference;
    decision: OperationIdentityReference;
    deadlineAtUnixMs: number;
    aggregateBudgets: readonly OperationBudget[];
    requirements: readonly OperationRequirementV2[];
    attempt: SemanticOperationAttemptContextV2;
  }>): SemanticOperationPlanV2;
  compileBinding(input: Readonly<{
    requirementId: string;
    contract: OperationIdentityReference;
    provider: OperationIdentityReference;
  }>): CapabilityBindingV2;
  bind(plan: SemanticOperationPlanV2, bindings: readonly CapabilityBindingV2[]): BoundSemanticOperationV2;
  issueProviderSettlement(operation: BoundSemanticOperationV2, input: Readonly<{
    requirementId: string;
    physicalDisposition: ProviderPhysicalDispositionV2;
    providerSettlementReference: OperationIdentityReference;
  }>): ProviderSettlementReceiptV2;
  compileProviderSettlementSet(
    operation: BoundSemanticOperationV2,
    settlements: readonly ProviderSettlementReceiptV2[]
  ): ProviderSettlementSetV2;
  issueNormalReadback(operation: BoundSemanticOperationV2, settlementSet: ProviderSettlementSetV2, input: Readonly<{
    readbackContract: OperationIdentityReference;
    readbackReference: OperationIdentityReference;
    currentPhysicalEpoch: OperationIdentityReference;
    disposition: DomainReadbackDispositionV2;
  }>): NormalDomainReadbackReceiptV2;
  issueRecoveredReadback(operation: BoundSemanticOperationV2, input: Readonly<{
    predecessor: RecoveredPredecessorAttemptReferenceV2;
    durableObservation: OperationIdentityReference;
    readbackContract: OperationIdentityReference;
    readbackReference: OperationIdentityReference;
    currentPhysicalEpoch: OperationIdentityReference;
    disposition: DomainReadbackDispositionV2;
  }>): RecoveredDomainReadbackReceiptV2;
  issueNormalTerminalJoin(operation: BoundSemanticOperationV2, settlementSet: ProviderSettlementSetV2, readback: NormalDomainReadbackReceiptV2, input: Readonly<{
    ownerTerminalContract: OperationIdentityReference;
    ownerTerminalReference: OperationIdentityReference;
  }>): OwnerTerminalJoinReceiptV2;
  issueRecoveredTerminalJoin(operation: BoundSemanticOperationV2, readback: RecoveredDomainReadbackReceiptV2, input: Readonly<{
    ownerTerminalContract: OperationIdentityReference;
    ownerTerminalReference: OperationIdentityReference;
  }>): OwnerTerminalJoinReceiptV2;
  issueRecoveredRetryAdmission(
    operation: BoundSemanticOperationV2,
    readback: RecoveredDomainReadbackReceiptV2
  ): RecoveredRetryAdmissionV2;
  consumeRecoveredRetryAdmission(
    admission: RecoveredRetryAdmissionV2,
    successor: BoundSemanticOperationV2,
    currentPhysicalEpoch: OperationIdentityReference
  ): void;
}>;

const REFERENCE_KEYS = ['digest', 'domain', 'schema'] as const;
const NONCE_PATTERN = /^nonce256:[0-9a-f]{64}$/u;
const ISSUED_FOUNDATIONS = new WeakSet<object>();

function requireOperationId(value: string, label: string): string {
  if (!SEC_SEMANTIC_OPERATION_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical semantic identity.`);
  }
  return value;
}

function exactOwnDataRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || nativeTypes.isProxy(value)) {
    throw new TypeError(`${label} must be one ordinary data object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError(`${label} must be one ordinary data object.`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${label} contains missing or unknown fields.`);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError(`${label} fields must be enumerable own data.`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

export function parseOperationIdentityReference(
  value: unknown,
  label = 'Operation identity reference'
): OperationIdentityReference {
  const record = exactOwnDataRecord(value, REFERENCE_KEYS, label);
  if (typeof record.domain !== 'string' || typeof record.schema !== 'string') {
    throw new TypeError(`${label} domain and schema must be strings.`);
  }
  // Reuse the canonical namespace grammar without creating a second parser.
  identityFrameHeader(record.domain, record.schema);
  const digest = record.digest;
  if (!isDigest(digest, 'sha256') && !isDigest(digest, 'blake3')) {
    throw new TypeError(`${label} digest is not a supported canonical digest.`);
  }
  return Object.freeze({ domain: record.domain, schema: record.schema, digest });
}

function sameReference(left: OperationIdentityReference, right: OperationIdentityReference): boolean {
  return left.domain === right.domain && left.schema === right.schema && left.digest === right.digest;
}

function sameIdentity(
  left: Identity<string, string>,
  right: Identity<string, string>
): boolean {
  return left.profile === right.profile
    && left.domain === right.domain
    && left.schema === right.schema
    && left.digest === right.digest;
}

function canonicalPhysicalDisposition(value: ProviderPhysicalDispositionV2): ProviderPhysicalDispositionV2 {
  if (value !== 'not-started' && value !== 'settled' && value !== 'unknown') {
    throw new Error('Provider physical disposition is not canonical.');
  }
  return value;
}

function canonicalReadbackDisposition(value: DomainReadbackDispositionV2): DomainReadbackDispositionV2 {
  if (value !== 'applied' && value !== 'not-applied' && value !== 'unknown') {
    throw new Error('Domain readback disposition is not canonical.');
  }
  return value;
}

function issueNonce(): OperationAttemptNonceV2 {
  return `nonce256:${randomBytes(32).toString('hex')}`;
}

function canonicalRequirement(requirement: OperationRequirementV2): OperationRequirementV2 {
  const id = requireOperationId(requirement.id, 'Operation requirement id');
  return deepFreeze({
    id,
    contract: parseOperationIdentityReference(requirement.contract, `Operation requirement ${id} contract`),
    effectKinds: canonicalOperationEffectKinds(
      requirement.effectKinds,
      `Operation requirement ${id} effect kinds`
    ),
    failureKinds: canonicalUniqueOperationStrings(
      requirement.failureKinds,
      `Operation requirement ${id} failure kinds`
    )
  });
}

export function createOperationFoundationV2(
  identities: StructuredIdentityRuntime
): OperationFoundationV2 {
  assertStructuredIdentityRuntime(identities);
  const issuedIntents = new WeakSet<object>();
  const issuedAttempts = new WeakSet<object>();
  const issuedPlans = new WeakSet<object>();
  const issuedBindings = new WeakSet<object>();
  const issuedBoundOperations = new WeakSet<object>();
  const issuedSettlements = new WeakSet<object>();
  const issuedSettlementSets = new WeakSet<object>();
  const issuedRecoveredReadbacks = new WeakSet<object>();
  const consumedRecoveredReadbacks = new WeakSet<object>();
  const issuedRetryAdmissions = new WeakSet<object>();
  const consumedRetryAdmissions = new WeakSet<object>();

  const createReference = (input: OperationIdentityReference): OperationIdentityReference => (
    parseOperationIdentityReference(input)
  );

  const issueAttemptContext: OperationFoundationV2['issueAttemptContext'] = (input) => {
    const context = deepFreeze({
      authorityGrant: createReference(input.authorityGrant),
      run: input.run === undefined || input.run === null ? null : createReference(input.run),
      resumeEpoch: input.resumeEpoch === undefined || input.resumeEpoch === null
        ? null
        : createReference(input.resumeEpoch),
      nonce: issueNonce()
    });
    issuedAttempts.add(context);
    return context;
  };

  const compileIntent: OperationFoundationV2['compileIntent'] = (input) => {
    const operation = requireOperationId(input.operation, 'Semantic operation');
    const aggregateBudgets = [...input.aggregateBudgets]
      .sort((left, right) => compareCodeUnits(left.resource, right.resource))
      .map(canonicalOperationBudget);
    if (new Set(aggregateBudgets.map(({ resource }) => resource)).size !== aggregateBudgets.length) {
      throw new Error('Semantic operation aggregate budgets must be unique by resource.');
    }
    const requirements = [...input.requirements]
      .map(canonicalRequirement)
      .sort((left, right) => compareCodeUnits(left.id, right.id));
    if (requirements.length === 0 || new Set(requirements.map(({ id }) => id)).size !== requirements.length) {
      throw new Error('Semantic operation must have unique capability requirements.');
    }
    const intent = createReference(input.intent);
    const decision = createReference(input.decision);
    const identity = identities.structuredIdentity('operation', 'intent/v2', {
      operation,
      intent,
      decision
    });
    const frozenRequirements = Object.freeze(requirements);
    const frozenBudgets = Object.freeze(aggregateBudgets);
    const executionIdentity = identities.structuredIdentity('operation', 'execution-plan/v2', {
      operationIdentity: identity,
      aggregateBudgets: frozenBudgets,
      requirements: frozenRequirements
    });
    const compiled = deepFreeze({
      operation,
      intent,
      decision,
      identity,
      execution: {
        operationIdentity: identity,
        aggregateBudgets: frozenBudgets,
        requirements: frozenRequirements,
        identity: executionIdentity
      }
    });
    issuedIntents.add(compiled);
    return compiled;
  };

  const assertIntent: OperationFoundationV2['assertIntent'] = (value) => {
    if (value === null || typeof value !== 'object' || !issuedIntents.has(value)) {
      throw new Error('Semantic operation v2 intent is not foundation-issued.');
    }
  };

  const assertPlan: OperationFoundationV2['assertPlan'] = (value) => {
    if (value === null || typeof value !== 'object' || !issuedPlans.has(value)) {
      throw new Error('Semantic operation v2 plan is not foundation-issued.');
    }
  };

  const compilePlan: OperationFoundationV2['compilePlan'] = (input) => {
    if (!issuedAttempts.has(input.attempt)) {
      throw new Error('Semantic operation v2 attempt context is not foundation-issued.');
    }
    if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs < 1) {
      throw new Error('Semantic operation deadline must be an absolute safe integer.');
    }
    const intent = compileIntent(input);
    const attemptIdentity = identities.structuredIdentity('operation', 'attempt/v2', {
      operationIdentity: intent.identity,
      executionIdentity: intent.execution.identity,
      authorityGrant: input.attempt.authorityGrant,
      run: input.attempt.run,
      resumeEpoch: input.attempt.resumeEpoch,
      nonce: input.attempt.nonce,
      deadlineAtUnixMs: input.deadlineAtUnixMs
    });
    const plan = deepFreeze({
      ...intent,
      attempt: {
        operationIdentity: intent.identity,
        executionIdentity: intent.execution.identity,
        authorityGrant: input.attempt.authorityGrant,
        run: input.attempt.run,
        resumeEpoch: input.attempt.resumeEpoch,
        nonce: input.attempt.nonce,
        deadlineAtUnixMs: input.deadlineAtUnixMs,
        identity: attemptIdentity
      }
    });
    issuedPlans.add(plan);
    return plan;
  };

  const compileBinding: OperationFoundationV2['compileBinding'] = (input) => {
    const requirementId = requireOperationId(input.requirementId, 'Capability binding requirement id');
    const contract = createReference(input.contract);
    const provider = createReference(input.provider);
    const identity = identities.structuredIdentity('operation', 'capability-binding/v2', {
      requirementId,
      contract,
      provider
    });
    const binding = deepFreeze({ requirementId, contract, provider, identity });
    issuedBindings.add(binding);
    return binding;
  };

  const bind: OperationFoundationV2['bind'] = (plan, suppliedBindings) => {
    if (!issuedPlans.has(plan)) {
      throw new Error('Semantic operation v2 plan is not foundation-issued.');
    }
    const bindings = [...suppliedBindings].sort((left, right) => (
      compareCodeUnits(left.requirementId, right.requirementId)
    ));
    if (bindings.length !== plan.execution.requirements.length
        || new Set(bindings.map(({ requirementId }) => requirementId)).size !== bindings.length) {
      throw new Error('Semantic operation v2 bindings require exactly one binding per requirement.');
    }
    for (const [index, requirement] of plan.execution.requirements.entries()) {
      const binding = bindings[index];
      if (binding === undefined || !issuedBindings.has(binding)
          || binding.requirementId !== requirement.id
          || !sameReference(binding.contract, requirement.contract)) {
        throw new Error(`Semantic operation v2 binding for ${requirement.id} is invalid.`);
      }
    }
    const frozenBindings = Object.freeze(bindings);
    const bindingSetIdentity = identities.structuredIdentity('operation', 'binding-set/v2', {
      operationIdentity: plan.identity,
      executionIdentity: plan.execution.identity,
      bindings: frozenBindings.map(({ identity }) => identity)
    });
    const boundAttemptIdentity = identities.structuredIdentity('operation', 'bound-attempt/v2', {
      attemptIdentity: plan.attempt.identity,
      bindingSetIdentity
    });
    const bound = deepFreeze({ plan, bindings: frozenBindings, bindingSetIdentity, boundAttemptIdentity });
    issuedBoundOperations.add(bound);
    return bound;
  };

  const requireBound = (operation: BoundSemanticOperationV2): void => {
    if (!issuedBoundOperations.has(operation)) {
      throw new Error('Semantic operation v2 bound attempt is not foundation-issued.');
    }
  };

  const issueProviderSettlement: OperationFoundationV2['issueProviderSettlement'] = (operation, input) => {
    requireBound(operation);
    const requirementId = requireOperationId(input.requirementId, 'Provider settlement requirement id');
    const requirement = operation.plan.execution.requirements.find(({ id }) => id === requirementId);
    const binding = operation.bindings.find(({ requirementId: candidate }) => candidate === requirementId);
    if (requirement === undefined || binding === undefined
        || !sameReference(requirement.contract, binding.contract)) {
      throw new Error('Provider settlement does not bind an exact operation requirement.');
    }
    const providerSettlementReference = createReference(input.providerSettlementReference);
    const physicalDisposition = canonicalPhysicalDisposition(input.physicalDisposition);
    const identity = identities.structuredIdentity('operation', 'provider-settlement/v2', {
      requirementId,
      contract: requirement.contract,
      bindingIdentity: binding.identity,
      operationIdentity: operation.plan.identity,
      executionIdentity: operation.plan.execution.identity,
      boundAttemptIdentity: operation.boundAttemptIdentity,
      physicalDisposition,
      providerSettlementReference
    });
    const settlement = deepFreeze({
      requirementId, contract: requirement.contract, bindingIdentity: binding.identity,
      operationIdentity: operation.plan.identity, executionIdentity: operation.plan.execution.identity,
      boundAttemptIdentity: operation.boundAttemptIdentity, physicalDisposition,
      providerSettlementReference, identity
    });
    issuedSettlements.add(settlement);
    return settlement;
  };

  const compileProviderSettlementSet: OperationFoundationV2['compileProviderSettlementSet'] = (
    operation, suppliedSettlements
  ) => {
    requireBound(operation);
    const settlements = [...suppliedSettlements].sort((left, right) =>
      compareCodeUnits(left.requirementId, right.requirementId));
    if (settlements.length !== operation.plan.execution.requirements.length
        || new Set(settlements.map(({ requirementId }) => requirementId)).size !== settlements.length) {
      throw new Error('Provider settlement set v2 requires exactly one receipt per requirement.');
    }
    for (const [index, requirement] of operation.plan.execution.requirements.entries()) {
      const settlement = settlements[index];
      const binding = operation.bindings[index];
      if (settlement === undefined || binding === undefined || !issuedSettlements.has(settlement)
          || settlement.requirementId !== requirement.id
          || !sameReference(settlement.contract, requirement.contract)
          || !sameIdentity(settlement.bindingIdentity, binding.identity)
          || !sameIdentity(settlement.operationIdentity, operation.plan.identity)
          || !sameIdentity(settlement.executionIdentity, operation.plan.execution.identity)
          || !sameIdentity(settlement.boundAttemptIdentity, operation.boundAttemptIdentity)) {
        throw new Error(`Provider settlement v2 for ${requirement.id} does not bind the exact attempt.`);
      }
    }
    const frozenSettlements = Object.freeze(settlements);
    const identity = identities.structuredIdentity('operation', 'provider-settlement-set/v2', {
      operationIdentity: operation.plan.identity,
      executionIdentity: operation.plan.execution.identity,
      bindingSetIdentity: operation.bindingSetIdentity,
      boundAttemptIdentity: operation.boundAttemptIdentity,
      settlements: frozenSettlements.map(({ identity: settlementIdentity }) => settlementIdentity)
    });
    const set = deepFreeze({
      operationIdentity: operation.plan.identity, executionIdentity: operation.plan.execution.identity,
      bindingSetIdentity: operation.bindingSetIdentity, boundAttemptIdentity: operation.boundAttemptIdentity,
      settlements: frozenSettlements, identity
    });
    issuedSettlementSets.add(set);
    return set;
  };

  const readbackBase = (operation: BoundSemanticOperationV2, input: {
    readbackContract: OperationIdentityReference;
    readbackReference: OperationIdentityReference;
    currentPhysicalEpoch: OperationIdentityReference;
    disposition: DomainReadbackDispositionV2;
  }) => ({
    operationIdentity: operation.plan.identity,
    executionIdentity: operation.plan.execution.identity,
    bindingSetIdentity: operation.bindingSetIdentity,
    boundAttemptIdentity: operation.boundAttemptIdentity,
    readbackContract: createReference(input.readbackContract),
    readbackReference: createReference(input.readbackReference),
    currentPhysicalEpoch: createReference(input.currentPhysicalEpoch),
    disposition: canonicalReadbackDisposition(input.disposition)
  });

  const issueNormalReadback: OperationFoundationV2['issueNormalReadback'] = (operation, settlementSet, input) => {
    requireBound(operation);
    if (!issuedSettlementSets.has(settlementSet)
        || !sameIdentity(settlementSet.operationIdentity, operation.plan.identity)
        || !sameIdentity(settlementSet.executionIdentity, operation.plan.execution.identity)
        || !sameIdentity(settlementSet.bindingSetIdentity, operation.bindingSetIdentity)
        || !sameIdentity(settlementSet.boundAttemptIdentity, operation.boundAttemptIdentity)) {
      throw new Error('Normal domain readback v2 does not bind the exact provider settlement set.');
    }
    const base = readbackBase(operation, input);
    const payload = deepFreeze({ recoveryMode: 'normal' as const, ...base,
      providerSettlementSetIdentity: settlementSet.identity, durableObservation: null, predecessor: null });
    const identity = identities.structuredIdentity('operation', 'domain-readback/v2', payload);
    return deepFreeze({ ...payload, identity });
  };

  const issueRecoveredReadback: OperationFoundationV2['issueRecoveredReadback'] = (operation, input) => {
    requireBound(operation);
    const predecessor = input.predecessor;
    if (!sameIdentity(predecessor.operationIdentity, operation.plan.identity)
        || !sameIdentity(predecessor.executionIdentity, operation.plan.execution.identity)
        || !sameIdentity(predecessor.bindingSetIdentity, operation.bindingSetIdentity)
        || sameIdentity(predecessor.boundAttemptIdentity, operation.boundAttemptIdentity)
        || operation.plan.attempt.resumeEpoch === null
        || !isOperationAttemptNonceV2(predecessor.nonce)
        || !Number.isSafeInteger(predecessor.deadlineAtUnixMs) || predecessor.deadlineAtUnixMs < 1) {
      throw new Error('Recovered domain readback v2 does not bind one predecessor and recovery authority.');
    }
    const canonicalPredecessor = deepFreeze({
      operationIdentity: predecessor.operationIdentity, executionIdentity: predecessor.executionIdentity,
      bindingSetIdentity: predecessor.bindingSetIdentity, boundAttemptIdentity: predecessor.boundAttemptIdentity,
      nonce: predecessor.nonce, authorityGrant: createReference(predecessor.authorityGrant),
      resumeEpoch: predecessor.resumeEpoch === null ? null : createReference(predecessor.resumeEpoch),
      deadlineAtUnixMs: predecessor.deadlineAtUnixMs
    });
    const base = readbackBase(operation, input);
    const payload = deepFreeze({ recoveryMode: 'recovered' as const, ...base,
      providerSettlementSetIdentity: null, durableObservation: createReference(input.durableObservation),
      predecessor: canonicalPredecessor });
    const identity = identities.structuredIdentity('operation', 'domain-readback/v2', payload);
    const readback = deepFreeze({ ...payload, identity });
    issuedRecoveredReadbacks.add(readback);
    return readback;
  };

  const requireReadbackFor = (operation: BoundSemanticOperationV2, readback: DomainReadbackReceiptV2): void => {
    requireBound(operation);
    if (!sameIdentity(readback.operationIdentity, operation.plan.identity)
        || !sameIdentity(readback.executionIdentity, operation.plan.execution.identity)
        || !sameIdentity(readback.bindingSetIdentity, operation.bindingSetIdentity)
        || !sameIdentity(readback.boundAttemptIdentity, operation.boundAttemptIdentity)) {
      throw new Error('Domain readback v2 does not bind the exact operation attempt.');
    }
  };

  const terminalJoin = (operation: BoundSemanticOperationV2, readback: DomainReadbackReceiptV2, input: {
    ownerTerminalContract: OperationIdentityReference;
    ownerTerminalReference: OperationIdentityReference;
  }): OwnerTerminalJoinReceiptV2 => {
    const payload = deepFreeze({
      recoveryMode: readback.recoveryMode, operationIdentity: operation.plan.identity,
      executionIdentity: operation.plan.execution.identity, bindingSetIdentity: operation.bindingSetIdentity,
      boundAttemptIdentity: operation.boundAttemptIdentity,
      providerSettlementSetIdentity: readback.providerSettlementSetIdentity, readbackIdentity: readback.identity,
      ownerTerminalContract: createReference(input.ownerTerminalContract),
      ownerTerminalReference: createReference(input.ownerTerminalReference)
    });
    const identity = identities.structuredIdentity('operation', 'owner-terminal-join/v2', payload);
    return deepFreeze({ ...payload, identity });
  };

  const issueNormalTerminalJoin: OperationFoundationV2['issueNormalTerminalJoin'] = (operation, settlementSet, readback, input) => {
    requireReadbackFor(operation, readback);
    if (!issuedSettlementSets.has(settlementSet)
        || !sameIdentity(readback.providerSettlementSetIdentity, settlementSet.identity)) {
      throw new Error('Normal owner terminal join v2 requires its exact provider settlement set.');
    }
    return terminalJoin(operation, readback, input);
  };

  const issueRecoveredTerminalJoin: OperationFoundationV2['issueRecoveredTerminalJoin'] = (operation, readback, input) => {
    requireReadbackFor(operation, readback);
    if (!issuedRecoveredReadbacks.has(readback) || consumedRecoveredReadbacks.has(readback)) {
      throw new Error('Recovered owner terminal join v2 requires one unconsumed recovered readback.');
    }
    consumedRecoveredReadbacks.add(readback);
    return terminalJoin(operation, readback, input);
  };

  const issueRecoveredRetryAdmission: OperationFoundationV2['issueRecoveredRetryAdmission'] = (operation, readback) => {
    requireReadbackFor(operation, readback);
    if (!issuedRecoveredReadbacks.has(readback) || consumedRecoveredReadbacks.has(readback)
        || readback.disposition !== 'not-applied' || operation.plan.attempt.resumeEpoch === null) {
      throw new Error('Recovered retry admission v2 requires a conclusive unconsumed not-applied readback.');
    }
    const payload = deepFreeze({
      operationIdentity: readback.operationIdentity,
      previousExecutionIdentity: readback.predecessor.executionIdentity,
      previousBindingSetIdentity: readback.predecessor.bindingSetIdentity,
      previousBoundAttemptIdentity: readback.predecessor.boundAttemptIdentity,
      previousNonce: readback.predecessor.nonce,
      previousDeadlineAtUnixMs: readback.predecessor.deadlineAtUnixMs,
      recoveryBoundAttemptIdentity: readback.boundAttemptIdentity,
      recoveryAuthorityGrant: operation.plan.attempt.authorityGrant,
      recoveryResumeEpoch: operation.plan.attempt.resumeEpoch,
      recoveredReadbackIdentity: readback.identity,
      currentPhysicalEpoch: readback.currentPhysicalEpoch
    });
    const identity = identities.structuredIdentity('operation', 'recovered-retry-admission/v2', payload);
    const admission = deepFreeze({ ...payload, identity });
    consumedRecoveredReadbacks.add(readback);
    issuedRetryAdmissions.add(admission);
    return admission;
  };

  const consumeRecoveredRetryAdmission: OperationFoundationV2['consumeRecoveredRetryAdmission'] = (
    admission, successor, currentPhysicalEpoch
  ) => {
    requireBound(successor);
    if (!issuedRetryAdmissions.has(admission)) {
      throw new Error('Recovered retry admission v2 is not foundation-issued.');
    }
    if (consumedRetryAdmissions.has(admission)) {
      throw new Error('Recovered retry admission v2 was already consumed.');
    }
    if (!sameIdentity(successor.plan.identity, admission.operationIdentity)
        || !sameIdentity(successor.plan.execution.identity, admission.previousExecutionIdentity)
        || !sameIdentity(successor.bindingSetIdentity, admission.previousBindingSetIdentity)
        || sameIdentity(successor.boundAttemptIdentity, admission.previousBoundAttemptIdentity)
        || sameIdentity(successor.boundAttemptIdentity, admission.recoveryBoundAttemptIdentity)
        || !sameReference(successor.plan.attempt.authorityGrant, admission.recoveryAuthorityGrant)
        || successor.plan.attempt.resumeEpoch === null
        || !sameReference(successor.plan.attempt.resumeEpoch, admission.recoveryResumeEpoch)
        || !sameReference(createReference(currentPhysicalEpoch), admission.currentPhysicalEpoch)
        || successor.plan.attempt.deadlineAtUnixMs > admission.previousDeadlineAtUnixMs
        || successor.plan.attempt.deadlineAtUnixMs <= Date.now()) {
      throw new Error('Recovered retry admission v2 does not authorize this successor attempt.');
    }
    consumedRetryAdmissions.add(admission);
  };

  const foundation = Object.freeze({
    createReference,
    assertIntent,
    assertPlan,
    issueAttemptContext,
    compileIntent,
    compilePlan,
    compileBinding,
    bind,
    issueProviderSettlement,
    compileProviderSettlementSet,
    issueNormalReadback,
    issueRecoveredReadback,
    issueNormalTerminalJoin,
    issueRecoveredTerminalJoin,
    issueRecoveredRetryAdmission,
    consumeRecoveredRetryAdmission
  });
  ISSUED_FOUNDATIONS.add(foundation);
  return foundation;
}

export function assertOperationFoundationV2(value: unknown): asserts value is OperationFoundationV2 {
  if (value === null || typeof value !== 'object' || !ISSUED_FOUNDATIONS.has(value)) {
    throw new TypeError('Operation foundation v2 must be owner-issued.');
  }
}

export function isOperationAttemptNonceV2(value: unknown): value is OperationAttemptNonceV2 {
  return typeof value === 'string' && NONCE_PATTERN.test(value);
}
