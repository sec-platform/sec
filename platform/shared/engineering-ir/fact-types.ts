import type { SemanticEntityId, SemanticPrimitive } from './entity-types.ts';

export const SEMANTIC_PREDICATES = [
  'CONTAINS',
  'DECLARES',
  'IMPLEMENTS',
  'DEPENDS_ON',
  'PROVIDES',
  'ASSUMES',
  'REQUIRES',
  'GUARANTEES',
  'CONNECTS_TO',
  'INVOKES',
  'PRECEDES',
  'AWAITS',
  'FORKS_TO',
  'JOINS',
  'RETRIES',
  'HANDLES',
  'EMITS',
  'CONSUMES',
  'FLOWS_TO',
  'DERIVES_FROM',
  'TRANSFORMS_TO',
  'VALIDATES',
  'SANITIZES',
  'SERIALIZES_AS',
  'DESERIALIZES_FROM',
  'PERSISTS_AS',
  'OWNS',
  'READS',
  'WRITES',
  'MUTATES',
  'INITIALIZES',
  'DISPOSES',
  'ESCAPES',
  'TRANSITIONS_TO',
  'PERFORMS_EFFECT',
  'REQUIRES_PERMISSION',
  'CROSSES_BOUNDARY',
  'ENFORCES',
  'VERIFIED_BY',
  'ORIGINATES_FROM',
  'LOWERS_TO',
  'GENERATES',
  'VIOLATES'
] as const;

export const SEMANTIC_AUTHORITIES = [
  'authoritative',
  'derived',
  'observed',
  'inferred'
] as const;

export const FACT_PROVENANCE_KINDS = [
  'contract',
  'compiler',
  'static-analysis',
  'runtime',
  'ai',
  'user',
  'external-provider'
] as const;

export type SemanticFactId = string;
export type FactAssertionId = string;
export type SemanticPredicate = (typeof SEMANTIC_PREDICATES)[number];
export type SemanticAuthority = (typeof SEMANTIC_AUTHORITIES)[number];
export type FactProvenanceKind = (typeof FACT_PROVENANCE_KINDS)[number];

export interface SemanticValueObject {
  [key: string]: SemanticValue;
}

export type SemanticValue = SemanticPrimitive | SemanticValue[] | SemanticValueObject;

export type SemanticFactObject =
  | { kind: 'entity'; entityId: SemanticEntityId }
  | { kind: 'value'; value: SemanticValue };

export interface FactProvenance {
  kind: FactProvenanceKind;
  sourceId: string;
  sourcePath?: string;
  revision?: string;
}

export interface EvidenceReference {
  kind: string;
  ref: string;
  digest?: string;
}

export interface FactAssertion {
  id: FactAssertionId;
  authority: SemanticAuthority;
  confidence: number;
  provenance: FactProvenance[];
  evidence: EvidenceReference[];
  validFromRevision: string;
  validToRevision?: string;
}

export interface SemanticFact {
  id: SemanticFactId;
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  assertions: FactAssertion[];
}
