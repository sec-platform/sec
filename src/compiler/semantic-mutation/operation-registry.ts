import type { FactAssertion, FactProvenance, SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import type { AddStateTransitionOperation, SemanticMutationAuthorizationContext, SemanticMutationDiagnostic, VerificationRequirement } from '../../semantics/mutation/types.ts';
import { contractOperationId, contractStateId } from '../ir/ir-identity.ts';
import { canonicalEquals, compareCodeUnits, mutationDiagnostic } from './canonical.ts';

export const ADD_STATE_TRANSITION_MINIMUM_VERIFICATION = Object.freeze([
  Object.freeze({ kind: 'pass', passId: 'verify' })
]) as readonly VerificationRequirement[];


export interface ValidatedAddStateTransitionOperation {
  readonly operation: AddStateTransitionOperation;
  readonly stateEntityId: string;
  readonly operationEntityId: string;
  readonly responsibilityEntityId: string;
  readonly contractProvenance: readonly [FactProvenance];
  readonly mutatesExistsInBase: boolean;
}

function authoritativeAssertions(fact: SemanticFact | undefined): FactAssertion[] {
  return fact?.assertions.filter((assertion) => assertion.authority === 'authoritative') ?? [];
}

function provenanceKey(provenance: readonly FactProvenance[]): string {
  return JSON.stringify(provenance);
}

function targetContractAssertions(
  fact: SemanticFact | undefined,
  contractId: string
): FactAssertion[] {
  return authoritativeAssertions(fact).filter((assertion) =>
    assertion.provenance.length === 1 &&
    assertion.provenance[0]?.kind === 'contract' &&
    assertion.provenance[0]?.sourceId === `semantic-contract:${contractId}` &&
    typeof assertion.provenance[0]?.sourcePath === 'string'
  );
}

function entityFact(
  facts: readonly SemanticFact[],
  subject: string,
  predicate: SemanticFact['predicate'],
  objectEntityId: string
): SemanticFact | undefined {
  return facts.find((fact) => fact.subject === subject && fact.predicate === predicate &&
    fact.object.kind === 'entity' && fact.object.entityId === objectEntityId);
}

function valueFact(
  facts: readonly SemanticFact[],
  subject: string,
  predicate: SemanticFact['predicate'],
  value: unknown
): SemanticFact | undefined {
  return facts.find((fact) => fact.subject === subject && fact.predicate === predicate &&
    fact.object.kind === 'value' && canonicalEquals(fact.object.value, value));
}

function diagnostic(
  operationId: string,
  code: 'SEMANTIC-MUTATION-004' | 'SEMANTIC-MUTATION-006',
  message: string,
  details: Record<string, unknown>
): SemanticMutationDiagnostic {
  return mutationDiagnostic(code, code === 'SEMANTIC-MUTATION-004' ? 'source-resolution' : 'transform', message, {
    operationId,
    details
  });
}

export function validateSemanticMutationOperations(
  snapshot: ValidatedEngineeringIRSnapshot,
  operations: readonly AddStateTransitionOperation[],
  authorization: SemanticMutationAuthorizationContext
): { readonly operations: readonly ValidatedAddStateTransitionOperation[]; readonly diagnostics: readonly SemanticMutationDiagnostic[] } {
  const diagnostics: SemanticMutationDiagnostic[] = [];
  const validated: ValidatedAddStateTransitionOperation[] = [];
  const tupleOwner = new Map<string, string>();
  const transitionPairOwner = new Map<string, { operationId: string; by: string }>();
  const facts = snapshot.ir.facts;

  for (const operation of operations) {
    const stateEntityId = contractStateId(operation.contract.namespace, operation.stateId);
    const operationEntityId = contractOperationId(operation.contract.namespace, operation.by);
    const tupleKey = [operation.contract.namespace, operation.contract.contractId, operation.stateId, operation.from, operation.to, operation.by].join('\u0000');
    const pairKey = [operation.contract.namespace, operation.contract.contractId, operation.stateId, operation.from, operation.to].join('\u0000');
    const existingTuple = tupleOwner.get(tupleKey);
    const existingPair = transitionPairOwner.get(pairKey);
    if (existingTuple || (existingPair && existingPair.by !== operation.by)) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-006', 'Semantic mutation operations contain a duplicate or conflicting transition tuple', {
        conflictingOperationId: existingTuple ?? existingPair?.operationId ?? '',
        stateEntityId,
        from: operation.from,
        to: operation.to,
        by: operation.by
      }));
      continue;
    }
    tupleOwner.set(tupleKey, operation.operationId);
    transitionPairOwner.set(pairKey, { operationId: operation.operationId, by: operation.by });

    if (!authorization.allowedOperationKinds.includes(operation.kind) ||
      !authorization.allowedTargetEntityIds.includes(stateEntityId)) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-004', 'Operation kind or canonical target is outside trusted authorization', {
        kind: operation.kind,
        stateEntityId
      }));
      continue;
    }
    const state = snapshot.ir.entities.find((entity) => entity.id === stateEntityId);
    const by = snapshot.ir.entities.find((entity) => entity.id === operationEntityId);
    const values = state?.attributes.find((attribute) => attribute.key === 'values')?.value;
    if (!state || state.kind !== 'state' || !by || by.kind !== 'operation' ||
      !Array.isArray(values) || !values.includes(operation.from) || !values.includes(operation.to) ||
      operation.from === operation.to) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-004', 'Transition target, values, or operation do not match the canonical base graph', {
        stateEntityId,
        operationEntityId,
        from: operation.from,
        to: operation.to
      }));
      continue;
    }
    const existingTransition = valueFact(facts, stateEntityId, 'TRANSITIONS_TO', {
      by: operationEntityId,
      from: operation.from,
      to: operation.to
    });
    if (existingTransition) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-006', 'Requested transition already exists in the canonical base graph', {
        stateEntityId,
        transitionFactId: existingTransition.id
      }));
      continue;
    }
    const ownerFacts = facts.filter((fact) => fact.predicate === 'OWNS' &&
      fact.object.kind === 'entity' && fact.object.entityId === stateEntityId);
    const ownerProofs = ownerFacts.flatMap((fact) => targetContractAssertions(fact, operation.contract.contractId)
      .map((assertion) => ({ fact, assertion })));
    if (ownerProofs.length !== 1) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-004', 'Target state must have one authoritative loaded-contract owner', {
        stateEntityId,
        ownerCount: ownerProofs.length
      }));
      continue;
    }
    const owner = ownerProofs[0]!;
    const implementsFact = entityFact(facts, owner.fact.subject, 'IMPLEMENTS', operationEntityId);
    const implementsProofs = targetContractAssertions(implementsFact, operation.contract.contractId);
    const guaranteeFrom = targetContractAssertions(valueFact(facts, stateEntityId, 'GUARANTEES', operation.from), operation.contract.contractId);
    const guaranteeTo = targetContractAssertions(valueFact(facts, stateEntityId, 'GUARANTEES', operation.to), operation.contract.contractId);
    const contractProofKeys = [owner.assertion, ...implementsProofs, ...guaranteeFrom, ...guaranteeTo]
      .map((assertion) => provenanceKey(assertion.provenance));
    if (implementsProofs.length !== 1 || guaranteeFrom.length !== 1 || guaranteeTo.length !== 1 ||
      new Set(contractProofKeys).size !== 1) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-004', 'State owner, operation responsibility, values, and loaded-contract provenance must agree exactly', {
        stateEntityId,
        operationEntityId,
        responsibilityEntityId: owner.fact.subject
      }));
      continue;
    }
    const mutatesFact = entityFact(facts, operationEntityId, 'MUTATES', stateEntityId);
    if (mutatesFact && targetContractAssertions(mutatesFact, operation.contract.contractId).length !== 1) {
      diagnostics.push(diagnostic(operation.operationId, 'SEMANTIC-MUTATION-004', 'Existing MUTATES relation is not authoritative for the target loaded contract', {
        stateEntityId,
        operationEntityId,
        mutatesFactId: mutatesFact.id
      }));
      continue;
    }
    validated.push({
      operation,
      stateEntityId,
      operationEntityId,
      responsibilityEntityId: owner.fact.subject,
      contractProvenance: structuredClone(owner.assertion.provenance) as [FactProvenance],
      mutatesExistsInBase: mutatesFact !== undefined
    });
  }

  return {
    operations: validated.sort((left, right) => compareCodeUnits(left.operation.operationId, right.operation.operationId)),
    diagnostics
  };
}
