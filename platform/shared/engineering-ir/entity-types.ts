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

export type SemanticEntityId = string;
export type SemanticEntityKind = (typeof SEMANTIC_ENTITY_KINDS)[number];
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
