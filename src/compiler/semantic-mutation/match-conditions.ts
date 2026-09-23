import type { SemanticEntity } from '../../semantics/engineering-ir/entity-types.ts';
import type { FactAssertion, SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import type { SemanticFactSelector, SemanticMutationCondition, SemanticMutationDiagnostic, SemanticMutationDiagnosticStage } from '../../semantics/mutation/types.ts';
import { canonicalEquals, factSelectorKey, mutationDiagnostic, sha256 } from './canonical.ts';

function selectorMatches(fact: SemanticFact, selector: SemanticFactSelector): boolean {
  return fact.subject === selector.subject &&
    fact.predicate === selector.predicate &&
    canonicalEquals(fact.object, selector.object);
}

function factForSelector(
  snapshot: ValidatedEngineeringIRSnapshot,
  selector: SemanticFactSelector
): SemanticFact | undefined {
  return snapshot.ir.facts.find((fact) => selectorMatches(fact, selector));
}

export function semanticMutationEntityDigest(entity: SemanticEntity): string {
  return sha256({
    domain: 'semantic-mutation-entity-condition-v1',
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    attributes: entity.attributes
  });
}

export function semanticMutationAssertionDigest(assertion: FactAssertion): string {
  return sha256({
    domain: 'semantic-mutation-assertion-condition-v1',
    id: assertion.id,
    authority: assertion.authority,
    confidence: assertion.confidence,
    provenance: assertion.provenance,
    evidence: assertion.evidence,
    validFromRevision: assertion.validFromRevision,
    validToRevision: assertion.validToRevision ?? ''
  });
}

export function semanticMutationAssertionClaimDigest(assertion: FactAssertion): string {
  return sha256({
    domain: 'semantic-mutation-assertion-claim-v1',
    assertionId: assertion.id,
    confidence: assertion.confidence,
    evidence: assertion.evidence
  });
}

export function mergeSemanticMutationConditions(
  ...collections: readonly (readonly SemanticMutationCondition[])[]
): SemanticMutationCondition[] {
  const byId = new Map<string, SemanticMutationCondition>();
  for (const collection of collections) {
    for (const condition of collection) {
      const existing = byId.get(condition.conditionId);
      if (existing && !canonicalEquals(existing, condition)) {
        throw new Error(`Condition id "${condition.conditionId}" has conflicting definitions`);
      }
      byId.set(condition.conditionId, structuredClone(condition));
    }
  }
  return [...byId.values()].sort((left, right) => left.conditionId < right.conditionId ? -1 : 1);
}

function conditionMatches(
  snapshot: ValidatedEngineeringIRSnapshot,
  condition: SemanticMutationCondition
): { matches: boolean; actual?: unknown } {
  if (condition.kind === 'entity') {
    const entity = snapshot.ir.entities.find((entry) => entry.id === condition.entityId);
    if (!condition.exists) return { matches: entity === undefined, actual: entity?.id };
    if (!entity) return { matches: false };
    const matches = (condition.entityKind === undefined || condition.entityKind === entity.kind) &&
      (condition.canonicalEntityDigest === undefined ||
        condition.canonicalEntityDigest === semanticMutationEntityDigest(entity));
    return { matches, actual: { kind: entity.kind, digest: semanticMutationEntityDigest(entity) } };
  }
  const fact = factForSelector(snapshot, condition.fact);
  if (condition.kind === 'fact') return { matches: condition.exists === (fact !== undefined), actual: fact?.id };
  const assertion = fact?.assertions.find((entry) => entry.id === condition.assertionId);
  if (!condition.exists) return { matches: assertion === undefined, actual: assertion?.id };
  if (!assertion) return { matches: false };
  const digest = semanticMutationAssertionDigest(assertion);
  return {
    matches: condition.canonicalAssertionDigest === undefined || condition.canonicalAssertionDigest === digest,
    actual: { factId: fact?.id, assertionId: assertion.id, digest }
  };
}

export function matchSemanticMutationConditions(
  snapshot: ValidatedEngineeringIRSnapshot,
  conditions: readonly SemanticMutationCondition[],
  options: {
    readonly code: 'SEMANTIC-MUTATION-003' | 'SEMANTIC-MUTATION-009';
    readonly stage: Extract<SemanticMutationDiagnosticStage, 'precondition' | 'expectation'>;
  }
): SemanticMutationDiagnostic[] {
  return conditions.flatMap((condition) => {
    const result = conditionMatches(snapshot, condition);
    if (result.matches) return [];
    return [mutationDiagnostic(
      options.code,
      options.stage,
      `Semantic mutation condition "${condition.conditionId}" did not match the canonical snapshot`,
      {
        conditionId: condition.conditionId,
        details: {
          conditionKind: condition.kind,
          ...(condition.kind === 'entity'
            ? { target: condition.entityId }
            : { target: factSelectorKey(condition.fact) }),
          expectedExists: condition.exists,
          ...(result.actual === undefined ? {} : { actual: result.actual })
        }
      }
    )];
  });
}
