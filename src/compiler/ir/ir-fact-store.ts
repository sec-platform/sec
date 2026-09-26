import { compareCodeUnits } from '../../contracts/canonical.ts';
import type { SemanticEntityId } from '../../semantics/engineering-ir/entity-types.ts';
import type { EvidenceReference, FactAssertion, FactProvenance, SemanticAuthority, SemanticFact, SemanticFactObject, SemanticPredicate } from '../../semantics/engineering-ir/fact-types.ts';
import { CompilerError } from '../errors.ts';
import { factIdentity } from './ir-identity.ts';
import { normalizeEvidence, normalizeFactObject, normalizeProvenance } from './ir-normalization.ts';
import { rawSha256Hex } from './ir-revision.ts';

export interface FactInput {
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  authority: SemanticAuthority;
  provenance: FactProvenance[];
  evidence?: EvidenceReference[];
  confidence?: number;
}

function assertFactInput(input: FactInput): void {
  const confidence = input.confidence ?? 1;
  if (confidence < 0 || confidence > 1) {
    throw new CompilerError('IR-AUTHORITY-001', 'Semantic fact assertion confidence must be between 0 and 1', {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      confidence
    });
  }
  if (input.provenance.length === 0) {
    throw new CompilerError('IR-AUTHORITY-002', 'Semantic fact assertion must include provenance', {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object
    });
  }
}

export function factAssertionId(
  factId: string,
  authority: SemanticAuthority,
  provenance: readonly FactProvenance[]
): string {
  const identity = [factId, authority, JSON.stringify(provenance)].join('\u0000');
  return `assertion:${rawSha256Hex(identity).slice(0, 24)}`;
}

function buildAssertion(factId: string, input: FactInput): FactAssertion {
  const provenance = normalizeProvenance(input.provenance);
  return {
    id: factAssertionId(factId, input.authority, provenance),
    authority: input.authority,
    confidence: input.confidence ?? 1,
    provenance,
    evidence: normalizeEvidence(input.evidence ?? []),
    validFromRevision: 'build'
  };
}

function buildFact(input: FactInput): SemanticFact {
  assertFactInput(input);
  const normalizedObject = normalizeFactObject(input.object);
  const identity = factIdentity({ ...input, object: normalizedObject });
  const id = `fact:${rawSha256Hex(identity).slice(0, 24)}`;
  return {
    id,
    subject: input.subject,
    predicate: input.predicate,
    object: normalizedObject,
    assertions: [buildAssertion(id, input)]
  };
}

function mergeAssertion(existing: FactAssertion, incoming: FactAssertion): FactAssertion {
  if (
    existing.id !== incoming.id ||
    existing.authority !== incoming.authority ||
    JSON.stringify(existing.provenance) !== JSON.stringify(incoming.provenance)
  ) {
    throw new CompilerError('IR-AUTHORITY-003', `Fact assertion id "${existing.id}" collides across different assertion identities`);
  }
  if (existing.confidence !== incoming.confidence) {
    throw new CompilerError('IR-AUTHORITY-003', `Fact assertion "${existing.id}" has conflicting confidence`, {
      existingConfidence: existing.confidence,
      incomingConfidence: incoming.confidence
    });
  }

  return {
    ...existing,
    evidence: normalizeEvidence([...existing.evidence, ...incoming.evidence])
  };
}

function appendFactAssertions(existing: SemanticFact, incoming: SemanticFact): SemanticFact {
  if (factIdentity(existing) !== factIdentity(incoming)) {
    throw new CompilerError('IR-FACT-001', `Semantic fact id "${existing.id}" collides across different triples`, {
      existing: { subject: existing.subject, predicate: existing.predicate, object: existing.object },
      incoming: { subject: incoming.subject, predicate: incoming.predicate, object: incoming.object }
    });
  }

  const assertions = new Map(existing.assertions.map((assertion) => [assertion.id, assertion]));
  for (const assertion of incoming.assertions) {
    const current = assertions.get(assertion.id);
    assertions.set(assertion.id, current ? mergeAssertion(current, assertion) : assertion);
  }

  return {
    ...existing,
    assertions: [...assertions.values()].sort((left, right) => compareCodeUnits(left.id, right.id))
  };
}

export function addFact(facts: Map<string, SemanticFact>, factInput: FactInput): string {
  const fact = buildFact(factInput);
  const existing = facts.get(fact.id);
  facts.set(fact.id, existing ? appendFactAssertions(existing, fact) : fact);
  return fact.id;
}
