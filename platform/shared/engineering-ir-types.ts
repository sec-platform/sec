export const ENGINEERING_IR_FORMAT_VERSION = '1' as const;

export const SEMANTIC_ENTITY_KINDS = [
  'app',
  'block',
  'capability',
  'port',
  'slot',
  'entity',
  'field',
  'responsibility',
  'operation',
  'scenario',
  'state',
  'event',
  'policy',
  'permission',
  'effect',
  'boundary',
  'generator',
  'artifact',
  'acceptance'
] as const;

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

export type SemanticEntityId = string;
export type SemanticFactId = string;
export type SemanticEntityKind = (typeof SEMANTIC_ENTITY_KINDS)[number];
export type SemanticPredicate = (typeof SEMANTIC_PREDICATES)[number];
export type SemanticAuthority = (typeof SEMANTIC_AUTHORITIES)[number];
export type FactProvenanceKind = (typeof FACT_PROVENANCE_KINDS)[number];
export type SemanticPrimitive = string | number | boolean | null;
export type SemanticAttributeValue = SemanticPrimitive | string[];

export interface SemanticAttribute {
  key: string;
  value: SemanticAttributeValue;
}

export interface SemanticEntity {
  id: SemanticEntityId;
  kind: SemanticEntityKind;
  label: string;
  attributes: SemanticAttribute[];
}

export type SemanticFactObject =
  | { kind: 'entity'; entityId: SemanticEntityId }
  | { kind: 'value'; value: SemanticPrimitive };

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

export interface SemanticFact {
  id: SemanticFactId;
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  authority: SemanticAuthority;
  confidence: number;
  provenance: FactProvenance[];
  evidence: EvidenceReference[];
  validFrom: string;
  validTo?: string;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  entryEntityId: SemanticEntityId;
  factIds: SemanticFactId[];
}

export interface EngineeringIR {
  formatVersion: typeof ENGINEERING_IR_FORMAT_VERSION;
  graphId: string;
  revision: string;
  appId: SemanticEntityId;
  entities: SemanticEntity[];
  facts: SemanticFact[];
  scenarios: ScenarioDefinition[];
}
