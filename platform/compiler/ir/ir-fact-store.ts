import type {
  EvidenceReference,
  FactProvenance,
  SemanticAuthority,
  SemanticEntityId,
  SemanticFact,
  SemanticFactObject,
  SemanticPredicate
} from '../../shared/engineering-ir-types.ts';
import { CompilerError } from '../../shared/errors.ts';
import { factIdentity } from './ir-identity.ts';
import { normalizeEvidence, normalizeFactObject, normalizeProvenance } from './ir-normalization.ts';
import { digest } from './ir-revision.ts';

export interface FactInput {
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  authority: SemanticAuthority;
  provenance: FactProvenance[];
  evidence?: EvidenceReference[];
  confidence?: number;
}

const AUTHORITY_STRENGTH: Record<SemanticAuthority, number> = {
  inferred: 0,
  observed: 1,
  derived: 2,
  authoritative: 3
};

function assertFactInput(input: FactInput): void {
  const confidence = input.confidence ?? 1;
  if (confidence < 0 || confidence > 1) {
    throw new CompilerError('IR-AUTHORITY-001', 'Semantic fact confidence must be between 0 and 1', {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      confidence
    });
  }
  if (input.provenance.length === 0) {
    throw new CompilerError('IR-AUTHORITY-002', 'Semantic fact must include provenance', {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object
    });
  }
}

function buildFact(input: FactInput): SemanticFact {
  assertFactInput(input);
  const normalizedObject = normalizeFactObject(input.object);
  const identity = factIdentity({ ...input, object: normalizedObject });
  return {
    id: `fact:${digest(identity).slice(0, 24)}`,
    subject: input.subject,
    predicate: input.predicate,
    object: normalizedObject,
    authority: input.authority,
    confidence: input.confidence ?? 1,
    provenance: normalizeProvenance(input.provenance),
    evidence: normalizeEvidence(input.evidence ?? []),
    validFrom: 'build'
  };
}

export function mergeFacts(existing: SemanticFact, incoming: SemanticFact): SemanticFact {
  if (factIdentity(existing) !== factIdentity(incoming)) {
    throw new CompilerError('IR-FACT-001', `Semantic fact id "${existing.id}" collides across different triples`, {
      existing: { subject: existing.subject, predicate: existing.predicate, object: existing.object },
      incoming: { subject: incoming.subject, predicate: incoming.predicate, object: incoming.object }
    });
  }

  const authorityDifference = AUTHORITY_STRENGTH[incoming.authority] - AUTHORITY_STRENGTH[existing.authority];
  const authority = authorityDifference > 0 ? incoming.authority : existing.authority;
  const confidence = authorityDifference > 0
    ? incoming.confidence
    : authorityDifference < 0
      ? existing.confidence
      : Math.max(existing.confidence, incoming.confidence);

  return {
    ...existing,
    authority,
    confidence,
    provenance: normalizeProvenance([...existing.provenance, ...incoming.provenance]),
    evidence: normalizeEvidence([...existing.evidence, ...incoming.evidence])
  };
}

export function addFact(facts: Map<string, SemanticFact>, factInput: FactInput): string {
  const fact = buildFact(factInput);
  const existing = facts.get(fact.id);
  facts.set(fact.id, existing ? mergeFacts(existing, fact) : fact);
  return fact.id;
}
