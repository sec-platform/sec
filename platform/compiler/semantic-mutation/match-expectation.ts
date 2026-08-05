import type {
  FactAssertion,
  FactDelta,
  SemanticFact,
  ValidatedEngineeringIRSnapshot
} from '../../shared/engineering-ir-types.ts';
import type {
  ExpectedFactAssertionChangeV1,
  ExpectedSemanticFactV1,
  SemanticFactSelectorV1,
  SemanticMutationDiagnosticV2,
  SemanticMutationExpectationV1
} from '../../shared/semantic-mutation-types.ts';
import {
  canonicalEquals,
  compareCodeUnits,
  factSelectorKey,
  mutationDiagnostic,
  sha256
} from './canonical.ts';
import { semanticMutationAssertionClaimDigest } from './match-conditions.ts';
import type { ValidatedAddStateTransitionOperation } from './operation-registry.ts';

function selectorFromFact(fact: SemanticFact): SemanticFactSelectorV1 {
  return { subject: fact.subject, predicate: fact.predicate, object: structuredClone(fact.object) };
}

function expectedFact(fact: SemanticFact): ExpectedSemanticFactV1 {
  return {
    fact: selectorFromFact(fact),
    assertions: fact.assertions.map((assertion) => ({
      assertionId: assertion.id,
      assertionClaimDigest: semanticMutationAssertionClaimDigest(assertion)
    })).sort((left, right) => compareCodeUnits(left.assertionId, right.assertionId))
  };
}

function factById(snapshot: ValidatedEngineeringIRSnapshot, factId: string): SemanticFact {
  const fact = snapshot.ir.facts.find((entry) => entry.id === factId);
  if (!fact) throw new Error(`Canonical endpoint is missing Fact "${factId}"`);
  return fact;
}

function updateClaimDigest(
  assertionId: string,
  value: Readonly<Pick<FactAssertion, 'confidence' | 'evidence'>>
): string {
  return sha256({
    domain: 'semantic-mutation-assertion-claim-v1',
    assertionId,
    confidence: value.confidence,
    evidence: value.evidence
  });
}

export function expectationFromFactDelta(
  delta: FactDelta,
  from: ValidatedEngineeringIRSnapshot,
  to: ValidatedEngineeringIRSnapshot
): SemanticMutationExpectationV1 {
  const addedFacts = delta.added.map(expectedFact)
    .sort((left, right) => compareCodeUnits(factSelectorKey(left.fact), factSelectorKey(right.fact)));
  const removedFacts = delta.removed.map(expectedFact)
    .sort((left, right) => compareCodeUnits(factSelectorKey(left.fact), factSelectorKey(right.fact)));
  const assertionChanges: ExpectedFactAssertionChangeV1[] = [];
  for (const change of delta.changed) {
    const before = factById(from, change.factId);
    const after = factById(to, change.factId);
    for (const assertion of change.addedAssertions) {
      assertionChanges.push({
        fact: selectorFromFact(after),
        assertionId: assertion.id,
        kind: 'added',
        assertionClaimDigest: semanticMutationAssertionClaimDigest(assertion)
      });
    }
    for (const assertion of change.removedAssertions) {
      assertionChanges.push({
        fact: selectorFromFact(before),
        assertionId: assertion.id,
        kind: 'removed',
        assertionClaimDigest: semanticMutationAssertionClaimDigest(assertion)
      });
    }
    for (const update of change.updatedAssertions) {
      assertionChanges.push({
        fact: selectorFromFact(after),
        assertionId: update.assertionId,
        kind: 'updated',
        changedFields: [...update.changedFields],
        beforeAssertionClaimDigest: updateClaimDigest(update.assertionId, update.before),
        afterAssertionClaimDigest: updateClaimDigest(update.assertionId, update.after)
      });
    }
  }
  assertionChanges.sort((left, right) => compareCodeUnits(
    [factSelectorKey(left.fact), left.assertionId, left.kind].join('\u0000'),
    [factSelectorKey(right.fact), right.assertionId, right.kind].join('\u0000')
  ));
  return {
    revision: 'semantic-mutation-expectation-v1',
    matchMode: 'exact',
    addedFacts,
    removedFacts,
    assertionChanges,
    entityChanges: 'none'
  };
}

function expectedOperationSelectors(
  operations: readonly ValidatedAddStateTransitionOperation[]
): Map<string, ValidatedAddStateTransitionOperation> {
  const expected = new Map<string, ValidatedAddStateTransitionOperation>();
  for (const operation of operations) {
    const transition: SemanticFactSelectorV1 = {
      subject: operation.stateEntityId,
      predicate: 'TRANSITIONS_TO',
      object: {
        kind: 'value',
        value: {
          by: operation.operationEntityId,
          from: operation.operation.from,
          to: operation.operation.to
        }
      }
    };
    expected.set(factSelectorKey(transition), operation);
    if (!operation.mutatesExistsInBase) {
      const mutates: SemanticFactSelectorV1 = {
        subject: operation.operationEntityId,
        predicate: 'MUTATES',
        object: { kind: 'entity', entityId: operation.stateEntityId }
      };
      expected.set(factSelectorKey(mutates), operation);
    }
  }
  return expected;
}

function assertionMatchesContract(
  fact: SemanticFact,
  operation: ValidatedAddStateTransitionOperation
): boolean {
  const assertion = fact.assertions[0];
  return fact.assertions.length === 1 &&
    assertion?.authority === 'authoritative' &&
    assertion.confidence === 1 &&
    assertion.evidence.length === 0 &&
    canonicalEquals(assertion.provenance, operation.contractProvenance);
}

export function matchSemanticMutationExpectation(
  base: ValidatedEngineeringIRSnapshot,
  staged: ValidatedEngineeringIRSnapshot,
  delta: FactDelta,
  expectation: SemanticMutationExpectationV1,
  operations: readonly ValidatedAddStateTransitionOperation[]
): SemanticMutationDiagnosticV2[] {
  const diagnostics: SemanticMutationDiagnosticV2[] = [];
  if (!canonicalEquals(base.ir.entities, staged.ir.entities)) {
    diagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-009',
      'expectation',
      'Semantic mutation v1 forbids Entity drift',
      { details: { baseEntityCount: base.ir.entities.length, stagedEntityCount: staged.ir.entities.length } }
    ));
  }
  const actualExpectation = expectationFromFactDelta(delta, base, staged);
  if (!canonicalEquals(actualExpectation, expectation)) {
    diagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-009',
      'expectation',
      'Actual Fact Delta does not exactly match the caller expectation',
      {
        details: {
          expected: expectation,
          actual: actualExpectation
        }
      }
    ));
  }
  const allowed = expectedOperationSelectors(operations);
  const actualKeys = delta.added.map((fact) => factSelectorKey(selectorFromFact(fact)));
  const expectedKeys = [...allowed.keys()].sort(compareCodeUnits);
  if (delta.removed.length > 0 || delta.changed.length > 0 ||
    JSON.stringify([...actualKeys].sort(compareCodeUnits)) !== JSON.stringify(expectedKeys)) {
    diagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-009',
      'expectation',
      'Actual Fact Delta exceeds or misses the operation registry semantic-effect allowlist',
      {
        details: {
          expectedAddedFactSelectors: expectedKeys,
          actualAddedFactSelectors: [...actualKeys].sort(compareCodeUnits),
          removedFactIds: delta.removed.map((fact) => fact.id),
          changedFactIds: delta.changed.map((change) => change.factId)
        }
      }
    ));
  }
  for (const fact of delta.added) {
    const key = factSelectorKey(selectorFromFact(fact));
    const operation = allowed.get(key);
    if (operation && !assertionMatchesContract(fact, operation)) {
      diagnostics.push(mutationDiagnostic(
        'SEMANTIC-MUTATION-009',
        'expectation',
        'Added operation effect must have one exact authoritative target-contract assertion',
        { operationId: operation.operation.operationId, details: { factId: fact.id } }
      ));
    }
  }
  return diagnostics;
}
