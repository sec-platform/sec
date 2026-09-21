import type { SemanticEntityKind } from './entity-types.ts';
import type { SemanticPredicate } from './fact-types.ts';

export type PredicateValueSchema =
  | { readonly kind: 'string' }
  | {
    readonly kind: 'number';
    readonly integer?: boolean;
    readonly minimum?: number;
  }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'null' }
  | {
    readonly kind: 'entity-reference';
    readonly entityKinds: readonly SemanticEntityKind[];
  }
  | {
    readonly kind: 'object';
    readonly fields: Readonly<Record<string, PredicateValueSchema>>;
    readonly additionalFields: false;
  };

export interface EntityObjectPredicateSignature {
  readonly kind: 'entity';
  readonly entityKinds: readonly SemanticEntityKind[];
}

export interface ValueObjectPredicateSignature {
  readonly kind: 'value';
  readonly schemaId: string;
  readonly schema: PredicateValueSchema;
}

export interface PredicateSignatureVariant {
  readonly id: string;
  readonly subjectKinds: readonly SemanticEntityKind[];
  readonly object: EntityObjectPredicateSignature | ValueObjectPredicateSignature;
}

export interface ActivePredicateSignature {
  readonly status: 'active';
  readonly variants: readonly PredicateSignatureVariant[];
}

export interface ReservedPredicateSignature {
  readonly status: 'reserved';
  readonly reason: string;
}

export type PredicateSignature = ActivePredicateSignature | ReservedPredicateSignature;

export type PredicateSignatureRegistry = Readonly<Record<SemanticPredicate, PredicateSignature>>;
