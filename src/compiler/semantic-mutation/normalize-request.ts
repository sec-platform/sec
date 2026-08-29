import { SEMANTIC_ENTITY_KINDS, type SemanticEntityKind } from '../../semantic/engineering-ir/contract/entity-types.ts';
import { SEMANTIC_PREDICATES, type SemanticFactObject, type SemanticPredicate, type SemanticValue } from '../../semantic/engineering-ir/contract/fact-types.ts';
import { SEMANTIC_MUTATION_CONTRACT_VERSION, SEMANTIC_MUTATION_EXPECTATION_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, type ExpectedFactAssertionChange, type ExpectedSemanticFact, type NormalizedSemanticMutationRequest, type SemanticFactSelector, type SemanticMutationAuthorizationContext, type SemanticMutationCondition, type SemanticMutationExpectation, type SemanticMutationOperation, type SemanticMutationRequest, type VerificationRequirement } from '../../semantic/mutation/contract/types.ts';
import {
  canonicalJson,
  cloneAndDeepFreeze,
  compareCodeUnits,
  compareVerificationRequirements,
  digestString,
  exactOwnKeys,
  factSelectorKey,
  isPlainObject,
  nonEmptyString,
  sha256,
  throwMutationDiagnostic,
  verificationRequirementKey
} from './canonical.ts';

const entityKinds = new Set<string>(SEMANTIC_ENTITY_KINDS);
const predicates = new Set<string>(SEMANTIC_PREDICATES);

function schema(message: string, details?: Record<string, unknown>): never {
  return throwMutationDiagnostic(
    'SEMANTIC-MUTATION-001',
    'request',
    message,
    details === undefined ? {} : { details }
  );
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) schema(`${label} must be a plain object`);
  return value;
}

function expectArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) schema(`${label} must be an array`);
  return value;
}

function expectString(value: unknown, label: string): string {
  if (!nonEmptyString(value)) schema(`${label} must be a trimmed non-empty string`);
  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') schema(`${label} must be boolean`);
  return value;
}

function assertKeys(
  value: Record<string, unknown>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  if (!exactOwnKeys(value, required, optional)) {
    schema(`${label} contains missing or unknown fields`, {
      actualKeys: Object.keys(value).sort(compareCodeUnits),
      required,
      optional
    });
  }
}

function assertCanonical<Value>(values: readonly Value[], keyOf: (value: Value) => string, label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const current = keyOf(values[index]!);
    const previous = index > 0 ? keyOf(values[index - 1]!) : undefined;
    if (previous !== undefined && compareCodeUnits(previous, current) >= 0) {
      schema(`${label} must be unique and in canonical order`, { index, previous, current });
    }
  }
}

function factObject(value: unknown, label: string): SemanticFactObject {
  const record = expectRecord(value, label);
  if (record.kind === 'entity') {
    assertKeys(record, label, ['kind', 'entityId']);
    return { kind: 'entity', entityId: expectString(record.entityId, `${label}.entityId`) };
  }
  if (record.kind === 'value') {
    assertKeys(record, label, ['kind', 'value']);
    try {
      return { kind: 'value', value: canonicalJson(record.value) as SemanticValue };
    } catch (error) {
      schema(`${label}.value must be canonical JSON`, {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return schema(`${label}.kind must be entity or value`);
}

function selector(value: unknown, label: string): SemanticFactSelector {
  const record = expectRecord(value, label);
  assertKeys(record, label, ['subject', 'predicate', 'object']);
  const predicate = expectString(record.predicate, `${label}.predicate`);
  if (!predicates.has(predicate)) schema(`${label}.predicate is outside the total predicate registry`);
  return {
    subject: expectString(record.subject, `${label}.subject`),
    predicate: predicate as SemanticPredicate,
    object: factObject(record.object, `${label}.object`)
  };
}

function condition(value: unknown, label: string): SemanticMutationCondition {
  const record = expectRecord(value, label);
  const conditionId = expectString(record.conditionId, `${label}.conditionId`);
  if (record.kind === 'entity') {
    assertKeys(record, label, ['conditionId', 'kind', 'entityId', 'exists'], ['entityKind', 'canonicalEntityDigest']);
    const exists = expectBoolean(record.exists, `${label}.exists`);
    if (!exists && (record.entityKind !== undefined || record.canonicalEntityDigest !== undefined)) {
      schema(`${label} cannot include kind or digest when exists is false`);
    }
    if (record.entityKind !== undefined && !entityKinds.has(String(record.entityKind))) {
      schema(`${label}.entityKind is outside the total entity-kind registry`);
    }
    if (record.canonicalEntityDigest !== undefined && !digestString(record.canonicalEntityDigest)) {
      schema(`${label}.canonicalEntityDigest must be sha256 lowercase hex`);
    }
    return {
      conditionId,
      kind: 'entity',
      entityId: expectString(record.entityId, `${label}.entityId`),
      exists,
      ...(record.entityKind === undefined ? {} : { entityKind: record.entityKind as SemanticEntityKind }),
      ...(record.canonicalEntityDigest === undefined ? {} : { canonicalEntityDigest: record.canonicalEntityDigest })
    };
  }
  if (record.kind === 'fact') {
    assertKeys(record, label, ['conditionId', 'kind', 'fact', 'exists']);
    return { conditionId, kind: 'fact', fact: selector(record.fact, `${label}.fact`), exists: expectBoolean(record.exists, `${label}.exists`) };
  }
  if (record.kind === 'assertion') {
    assertKeys(record, label, ['conditionId', 'kind', 'fact', 'assertionId', 'exists'], ['canonicalAssertionDigest']);
    const exists = expectBoolean(record.exists, `${label}.exists`);
    if (!exists && record.canonicalAssertionDigest !== undefined) {
      schema(`${label} cannot include assertion digest when exists is false`);
    }
    if (record.canonicalAssertionDigest !== undefined && !digestString(record.canonicalAssertionDigest)) {
      schema(`${label}.canonicalAssertionDigest must be sha256 lowercase hex`);
    }
    return {
      conditionId,
      kind: 'assertion',
      fact: selector(record.fact, `${label}.fact`),
      assertionId: expectString(record.assertionId, `${label}.assertionId`),
      exists,
      ...(record.canonicalAssertionDigest === undefined ? {} : { canonicalAssertionDigest: record.canonicalAssertionDigest })
    };
  }
  return schema(`${label}.kind must be entity, fact, or assertion`);
}

function conditions(value: unknown, label: string): SemanticMutationCondition[] {
  const result = expectArray(value, label).map((entry, index) => condition(entry, `${label}[${index}]`));
  assertCanonical(result, (entry) => entry.conditionId, label);
  return result;
}

function operation(value: unknown, label: string): SemanticMutationOperation {
  const record = expectRecord(value, label);
  assertKeys(record, label, ['operationId', 'kind', 'contract', 'stateId', 'from', 'to', 'by']);
  if (record.kind !== 'add-state-transition') schema(`${label}.kind is not registered`);
  const contract = expectRecord(record.contract, `${label}.contract`);
  assertKeys(contract, `${label}.contract`, ['namespace', 'contractId']);
  return {
    operationId: expectString(record.operationId, `${label}.operationId`),
    kind: 'add-state-transition',
    contract: {
      namespace: expectString(contract.namespace, `${label}.contract.namespace`),
      contractId: expectString(contract.contractId, `${label}.contract.contractId`)
    },
    stateId: expectString(record.stateId, `${label}.stateId`),
    from: expectString(record.from, `${label}.from`),
    to: expectString(record.to, `${label}.to`),
    by: expectString(record.by, `${label}.by`)
  };
}

function operations(value: unknown): SemanticMutationOperation[] {
  const result = expectArray(value, 'request.operations').map((entry, index) => operation(entry, `request.operations[${index}]`));
  if (result.length === 0) schema('request.operations must contain at least one operation');
  assertCanonical(result, (entry) => entry.operationId, 'request.operations');
  return result;
}

function expectedFact(value: unknown, label: string): ExpectedSemanticFact {
  const record = expectRecord(value, label);
  assertKeys(record, label, ['fact', 'assertions']);
  const assertions = expectArray(record.assertions, `${label}.assertions`).map((entry, index) => {
    const assertion = expectRecord(entry, `${label}.assertions[${index}]`);
    assertKeys(assertion, `${label}.assertions[${index}]`, ['assertionId', 'assertionClaimDigest']);
    if (!digestString(assertion.assertionClaimDigest)) schema(`${label}.assertions[${index}].assertionClaimDigest must be sha256 lowercase hex`);
    return {
      assertionId: expectString(assertion.assertionId, `${label}.assertions[${index}].assertionId`),
      assertionClaimDigest: assertion.assertionClaimDigest
    };
  });
  assertCanonical(assertions, (entry) => entry.assertionId, `${label}.assertions`);
  return { fact: selector(record.fact, `${label}.fact`), assertions };
}

function expectedFacts(value: unknown, label: string): ExpectedSemanticFact[] {
  const result = expectArray(value, label).map((entry, index) => expectedFact(entry, `${label}[${index}]`));
  assertCanonical(result, (entry) => factSelectorKey(entry.fact), label);
  return result;
}

function assertionChange(value: unknown, label: string): ExpectedFactAssertionChange {
  const record = expectRecord(value, label);
  if (record.kind === 'added' || record.kind === 'removed') {
    assertKeys(record, label, ['fact', 'assertionId', 'kind', 'assertionClaimDigest']);
    if (!digestString(record.assertionClaimDigest)) schema(`${label}.assertionClaimDigest must be sha256 lowercase hex`);
    return {
      fact: selector(record.fact, `${label}.fact`),
      assertionId: expectString(record.assertionId, `${label}.assertionId`),
      kind: record.kind,
      assertionClaimDigest: record.assertionClaimDigest
    };
  }
  if (record.kind === 'updated') {
    assertKeys(record, label, ['fact', 'assertionId', 'kind', 'changedFields', 'beforeAssertionClaimDigest', 'afterAssertionClaimDigest']);
    const changedFields = expectArray(record.changedFields, `${label}.changedFields`);
    if (JSON.stringify(changedFields) !== '["confidence"]' &&
      JSON.stringify(changedFields) !== '["evidence"]' &&
      JSON.stringify(changedFields) !== '["confidence","evidence"]') {
      schema(`${label}.changedFields must be non-empty and canonical`);
    }
    if (!digestString(record.beforeAssertionClaimDigest) || !digestString(record.afterAssertionClaimDigest)) {
      schema(`${label} before/after assertion claim digests must be sha256 lowercase hex`);
    }
    return {
      fact: selector(record.fact, `${label}.fact`),
      assertionId: expectString(record.assertionId, `${label}.assertionId`),
      kind: 'updated',
      changedFields: [...changedFields] as ('confidence' | 'evidence')[],
      beforeAssertionClaimDigest: record.beforeAssertionClaimDigest,
      afterAssertionClaimDigest: record.afterAssertionClaimDigest
    };
  }
  return schema(`${label}.kind must be added, removed, or updated`);
}

function expectation(value: unknown): SemanticMutationExpectation {
  const record = expectRecord(value, 'request.expectation');
  assertKeys(record, 'request.expectation', ['revision', 'matchMode', 'addedFacts', 'removedFacts', 'assertionChanges', 'entityChanges']);
  if (record.revision !== SEMANTIC_MUTATION_EXPECTATION_REVISION || record.matchMode !== 'exact' || record.entityChanges !== 'none') {
    schema('request.expectation revision, matchMode, and entityChanges are frozen');
  }
  const addedFacts = expectedFacts(record.addedFacts, 'request.expectation.addedFacts');
  const removedFacts = expectedFacts(record.removedFacts, 'request.expectation.removedFacts');
  const overlap = new Set(addedFacts.map((entry) => factSelectorKey(entry.fact)));
  if (removedFacts.some((entry) => overlap.has(factSelectorKey(entry.fact)))) schema('Expectation fact cannot be both added and removed');
  const assertionChanges = expectArray(record.assertionChanges, 'request.expectation.assertionChanges')
    .map((entry, index) => assertionChange(entry, `request.expectation.assertionChanges[${index}]`));
  assertCanonical(assertionChanges, (entry) => [factSelectorKey(entry.fact), entry.assertionId, entry.kind].join('\u0000'), 'request.expectation.assertionChanges');
  return {
    revision: SEMANTIC_MUTATION_EXPECTATION_REVISION,
    matchMode: 'exact',
    addedFacts,
    removedFacts,
    assertionChanges,
    entityChanges: 'none'
  };
}

function verificationRequirement(value: unknown, label: string): VerificationRequirement {
  const record = expectRecord(value, label);
  if (record.kind === 'acceptance') {
    assertKeys(record, label, ['kind', 'acceptanceEntityId']);
    return { kind: 'acceptance', acceptanceEntityId: expectString(record.acceptanceEntityId, `${label}.acceptanceEntityId`) };
  }
  if (record.kind === 'selector') {
    assertKeys(record, label, ['kind', 'selector']);
    const target = expectString(record.selector, `${label}.selector`);
    if (target.startsWith('!') || target.startsWith('-')) schema(`${label}.selector cannot be negative`);
    return { kind: 'selector', selector: target };
  }
  if (record.kind === 'pass') {
    assertKeys(record, label, ['kind', 'passId']);
    return { kind: 'pass', passId: expectString(record.passId, `${label}.passId`) };
  }
  return schema(`${label}.kind must be acceptance, selector, or pass`);
}

function verificationRequirements(value: unknown, label: string): VerificationRequirement[] {
  const result = expectArray(value, label).map((entry, index) => verificationRequirement(entry, `${label}[${index}]`));
  assertCanonical(result, verificationRequirementKey, label);
  return result;
}

function base(value: unknown, label: string) {
  const record = expectRecord(value, label);
  assertKeys(record, label, ['transactionId', 'inputRevision', 'semanticRevision']);
  return {
    transactionId: expectString(record.transactionId, `${label}.transactionId`),
    inputRevision: expectString(record.inputRevision, `${label}.inputRevision`),
    semanticRevision: expectString(record.semanticRevision, `${label}.semanticRevision`)
  };
}

export function normalizeSemanticMutationRequest(input: unknown): NormalizedSemanticMutationRequest {
  const record = expectRecord(input, 'request');
  assertKeys(record, 'request', ['contractVersion', 'requestId', 'graphId', 'appId', 'base', 'preconditions', 'operations', 'expectation', 'postconditions', 'additionalVerification']);
  if (record.contractVersion !== SEMANTIC_MUTATION_CONTRACT_VERSION) schema('request.contractVersion must equal "2"');
  const normalized: SemanticMutationRequest = {
    contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
    requestId: expectString(record.requestId, 'request.requestId'),
    graphId: expectString(record.graphId, 'request.graphId'),
    appId: expectString(record.appId, 'request.appId'),
    base: base(record.base, 'request.base'),
    preconditions: conditions(record.preconditions, 'request.preconditions'),
    operations: operations(record.operations),
    expectation: expectation(record.expectation),
    postconditions: conditions(record.postconditions, 'request.postconditions'),
    additionalVerification: verificationRequirements(record.additionalVerification, 'request.additionalVerification')
  };
  const requestRevision = sha256({
    domain: 'semantic-mutation-request-v2',
    ...normalized,
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    expectationRevision: SEMANTIC_MUTATION_EXPECTATION_REVISION
  });
  return cloneAndDeepFreeze({ ...normalized, requestRevision });
}

export function normalizeSemanticMutationAuthorization(
  input: unknown
): SemanticMutationAuthorizationContext {
  const record = expectRecord(input, 'authorization');
  assertKeys(record, 'authorization', [
    'authorizationRevision',
    'allowedOperationKinds',
    'allowedTargetEntityIds',
    'allowedSourceOwnerIds',
    'allowedPathPrefixes',
    'requiredPreconditions',
    'requiredPostconditions',
    'minimumVerification'
  ], ['taskId', 'envelopeRevision']);
  const stringArray = (value: unknown, label: string): string[] => {
    const result = expectArray(value, label).map((entry, index) => expectString(entry, `${label}[${index}]`));
    assertCanonical(result, (entry) => entry, label);
    return result;
  };
  const allowedOperationKinds = stringArray(record.allowedOperationKinds, 'authorization.allowedOperationKinds');
  if (allowedOperationKinds.some((kind) => kind !== 'add-state-transition')) schema('authorization.allowedOperationKinds contains an unregistered kind');
  const normalized: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'> = {
    ...(record.taskId === undefined ? {} : { taskId: expectString(record.taskId, 'authorization.taskId') }),
    ...(record.envelopeRevision === undefined ? {} : { envelopeRevision: expectString(record.envelopeRevision, 'authorization.envelopeRevision') }),
    allowedOperationKinds: allowedOperationKinds as SemanticMutationOperation['kind'][],
    allowedTargetEntityIds: stringArray(record.allowedTargetEntityIds, 'authorization.allowedTargetEntityIds'),
    allowedSourceOwnerIds: stringArray(record.allowedSourceOwnerIds, 'authorization.allowedSourceOwnerIds'),
    allowedPathPrefixes: stringArray(record.allowedPathPrefixes, 'authorization.allowedPathPrefixes'),
    requiredPreconditions: conditions(record.requiredPreconditions, 'authorization.requiredPreconditions'),
    requiredPostconditions: conditions(record.requiredPostconditions, 'authorization.requiredPostconditions'),
    minimumVerification: verificationRequirements(record.minimumVerification, 'authorization.minimumVerification')
  };
  const authorizationRevision = sha256({
    domain: 'semantic-mutation-authorization-v2',
    taskId: normalized.taskId ?? '',
    envelopeRevision: normalized.envelopeRevision ?? '',
    allowedOperationKinds: normalized.allowedOperationKinds,
    allowedTargetEntityIds: normalized.allowedTargetEntityIds,
    allowedSourceOwnerIds: normalized.allowedSourceOwnerIds,
    allowedPathPrefixes: normalized.allowedPathPrefixes,
    requiredPreconditions: normalized.requiredPreconditions,
    requiredPostconditions: normalized.requiredPostconditions,
    minimumVerification: normalized.minimumVerification
  });
  if (record.authorizationRevision !== authorizationRevision) schema('authorization.authorizationRevision does not match canonical trusted content');
  return cloneAndDeepFreeze({ ...normalized, authorizationRevision });
}

export function semanticMutationAuthorizationRevision(
  input: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'>
): string {
  return sha256({
    domain: 'semantic-mutation-authorization-v2',
    taskId: input.taskId ?? '',
    envelopeRevision: input.envelopeRevision ?? '',
    allowedOperationKinds: input.allowedOperationKinds,
    allowedTargetEntityIds: input.allowedTargetEntityIds,
    allowedSourceOwnerIds: input.allowedSourceOwnerIds,
    allowedPathPrefixes: input.allowedPathPrefixes,
    requiredPreconditions: input.requiredPreconditions,
    requiredPostconditions: input.requiredPostconditions,
    minimumVerification: input.minimumVerification
  });
}

export { compareVerificationRequirements };
