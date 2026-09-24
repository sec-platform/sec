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
  const issuedAttempts = new WeakSet<object>();
  const issuedPlans = new WeakSet<object>();
  const issuedBindings = new WeakSet<object>();

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
    return deepFreeze({
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
    return deepFreeze({ plan, bindings: frozenBindings, bindingSetIdentity, boundAttemptIdentity });
  };

  const foundation = Object.freeze({
    createReference,
    issueAttemptContext,
    compileIntent,
    compilePlan,
    compileBinding,
    bind
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
