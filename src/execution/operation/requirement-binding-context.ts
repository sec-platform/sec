import {
  compareCodeUnits,
  deepFreeze,
  sha256
} from '../../contracts/canonical.ts';
import {
  assertSemanticOperationProjection,
  isCanonicalOperationBudgetMaximum,
  type BoundSemanticOperation,
  type OperationBudgetResource,
  type OperationDigest
} from './semantic.ts';

/**
 * The operation foundation is the only issuer of this context.  A domain
 * owner still owns its Effect grant, and a physical worker still owns its
 * retained resources and settlement.  This context only proves that one
 * physical requirement admission is bound to one exact semantic attempt.
 */
export const OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE =
  'semantic-operation-foundation' as const;

declare const SEC_OPERATION_REQUIREMENT_BINDING_CONTEXT: unique symbol;

/**
 * Process-local, single-consumer capability. Consumers must call
 * consumeOperationRequirementBindingContext; its object shape is not an
 * authority surface and cannot be reconstructed from serialized bytes.
 */
export type OperationRequirementBindingContext = Readonly<{
  readonly [SEC_OPERATION_REQUIREMENT_BINDING_CONTEXT]: true;
}>;

export type OperationRequirementBindingProjection = Readonly<{
  readonly issuerRole: typeof OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE;
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly requirementId: string;
  readonly requirementContractDigest: OperationDigest;
  readonly providerIdentityDigest: OperationDigest;
  readonly providerBindingDigest: OperationDigest;
  readonly absoluteDeadlineAtUnixMs: number;
  readonly resourceCeilings: readonly OperationResourceCeiling[];
  readonly resourceCeilingIdentityDigest: OperationDigest;
  readonly contextDigest: OperationDigest;
}>;

export type OperationResourceCeiling = Readonly<{
  readonly resource: OperationBudgetResource;
  readonly maximum: number;
}>;

const ISSUED_REQUIREMENT_BINDING_CONTEXTS = new WeakSet<object>();
const CONSUMED_REQUIREMENT_BINDING_CONTEXTS = new WeakSet<object>();
const PROJECTION_BY_CONTEXT = new WeakMap<
  object,
  OperationRequirementBindingProjection
>();
const CONTEXT_BY_OPERATION_REQUIREMENT = new WeakMap<
  object,
  Map<string, OperationRequirementBindingContext>
>();

function canonicalResourceCeilings(
  operation: BoundSemanticOperation,
  suppliedCeilings: readonly OperationResourceCeiling[]
): readonly OperationResourceCeiling[] {
  if (suppliedCeilings.length === 0) {
    throw new Error('Operation requirement binding needs at least one resource ceiling.');
  }
  const ceilings = [...suppliedCeilings]
    .sort((left, right) => compareCodeUnits(left.resource, right.resource))
    .map((ceiling) => {
      const keys = Object.keys(ceiling).sort(compareCodeUnits);
      if (keys.length !== 2 || keys[0] !== 'maximum' || keys[1] !== 'resource') {
        throw new Error('Operation requirement resource ceiling is not canonical.');
      }
      const { resource, maximum } = ceiling;
      if (!isCanonicalOperationBudgetMaximum(resource, maximum)) {
        throw new Error('Operation requirement resource ceiling is not canonical.');
      }
      const parent = operation.plan.execution.aggregateBudgets.find(
        ({ resource: candidate }) => candidate === resource
      );
      if (parent === undefined || maximum > parent.maximum) {
        throw new Error(
          `Operation requirement resource ceiling ${resource} is not narrowed from its operation.`
        );
      }
      return Object.freeze({
        resource: resource as OperationBudgetResource,
        maximum
      });
    });
  if (new Set(ceilings.map(({ resource }) => resource)).size !== ceilings.length) {
    throw new Error('Operation requirement resource ceilings must be unique by resource.');
  }
  return Object.freeze(ceilings);
}

export function issueOperationRequirementBindingContext(input: Readonly<{
  readonly operation: BoundSemanticOperation;
  readonly requirementId: string;
  readonly resourceCeilings: readonly OperationResourceCeiling[];
  /** Optional fixed child deadline; omission preserves the operation attempt deadline. */
  readonly absoluteDeadlineAtUnixMs?: number;
}>): OperationRequirementBindingContext {
  assertSemanticOperationProjection(input.operation);
  const requirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === input.requirementId
  );
  const providerBinding = input.operation.bindings.find(
    ({ requirementId }) => requirementId === input.requirementId
  );
  if (requirement === undefined || providerBinding === undefined
      || providerBinding.contractDigest !== requirement.contractDigest) {
    throw new Error('Operation requirement binding is not present in the exact operation.');
  }
  const resourceCeilings = canonicalResourceCeilings(
    input.operation,
    input.resourceCeilings
  );
  const absoluteDeadlineAtUnixMs = input.absoluteDeadlineAtUnixMs
    ?? input.operation.plan.attempt.deadlineAtUnixMs;
  if (!Number.isSafeInteger(absoluteDeadlineAtUnixMs)
      || absoluteDeadlineAtUnixMs <= Date.now()
      || absoluteDeadlineAtUnixMs > input.operation.plan.attempt.deadlineAtUnixMs) {
    throw new Error('Operation requirement absolute deadline is not narrowed from its attempt.');
  }
  const resourceCeilingIdentityDigest = sha256({
    domain: 'sec.operation.requirement-resource-ceiling',
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    executionPlanDigest: input.operation.plan.execution.executionPlanDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    requirementId: requirement.id,
    providerBindingDigest: providerBinding.bindingDigest,
    absoluteDeadlineAtUnixMs,
    resourceCeilings
  }) as OperationDigest;
  const withoutContextDigest = deepFreeze({
    issuerRole: OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    executionPlanDigest: input.operation.plan.execution.executionPlanDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    requirementId: requirement.id,
    requirementContractDigest: requirement.contractDigest,
    providerIdentityDigest: providerBinding.providerIdentityDigest,
    providerBindingDigest: providerBinding.bindingDigest,
    absoluteDeadlineAtUnixMs,
    resourceCeilings,
    resourceCeilingIdentityDigest
  });
  const projection = deepFreeze({
    ...withoutContextDigest,
    contextDigest: sha256({
      domain: 'sec.operation.requirement-binding-context',
      binding: withoutContextDigest
    }) as OperationDigest
  });
  const operationContexts = CONTEXT_BY_OPERATION_REQUIREMENT.get(input.operation)
    ?? new Map<string, OperationRequirementBindingContext>();
  const existing = operationContexts.get(requirement.id);
  if (existing !== undefined) {
    const existingProjection = PROJECTION_BY_CONTEXT.get(existing);
    if (existingProjection?.contextDigest !== projection.contextDigest) {
      throw new Error(
        'Operation requirement already has a different issued resource-ceiling context.'
      );
    }
    return existing;
  }
  const context = Object.freeze({}) as unknown as OperationRequirementBindingContext;
  ISSUED_REQUIREMENT_BINDING_CONTEXTS.add(context);
  PROJECTION_BY_CONTEXT.set(context, projection);
  operationContexts.set(requirement.id, context);
  CONTEXT_BY_OPERATION_REQUIREMENT.set(input.operation, operationContexts);
  return context;
}

/**
 * The bound physical worker consumes this verifier boundary exactly once.
 * The returned projection is admission input only; possession of its bytes
 * does not recreate the opaque context or authorize another resource ledger.
 */
export function consumeOperationRequirementBindingContext(
  context: OperationRequirementBindingContext
): OperationRequirementBindingProjection {
  if (context === null || typeof context !== 'object'
      || !ISSUED_REQUIREMENT_BINDING_CONTEXTS.has(context)) {
    throw new Error(
      'Physical requirement admission requires an operation-foundation-issued binding context.'
    );
  }
  const projection = PROJECTION_BY_CONTEXT.get(context);
  if (projection === undefined) {
    throw new Error('Operation requirement binding context has no issuer projection.');
  }
  if (CONSUMED_REQUIREMENT_BINDING_CONTEXTS.has(context)) {
    throw new Error('Operation requirement binding context has already been consumed.');
  }
  CONSUMED_REQUIREMENT_BINDING_CONTEXTS.add(context);
  return projection;
}
