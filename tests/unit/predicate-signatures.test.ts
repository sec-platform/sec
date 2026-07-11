import { expect, test } from 'bun:test';

import {
  PREDICATE_SIGNATURE_REGISTRY,
  assertEngineeringIRPredicateSignatures,
  assertPredicateSignatureRegistry
} from '../../platform/compiler/ir/predicate-signatures.ts';
import {
  SEMANTIC_PREDICATES,
  type SemanticEntity,
  type SemanticEntityKind,
  type SemanticFact,
  type SemanticFactObject,
  type SemanticPredicate
} from '../../platform/shared/engineering-ir-types.ts';
import { CompilerError } from '../../platform/shared/errors.ts';

const ACTIVE_PREDICATES: readonly SemanticPredicate[] = [
  'AWAITS',
  'CONTAINS',
  'DECLARES',
  'DEPENDS_ON',
  'EMITS',
  'GUARANTEES',
  'IMPLEMENTS',
  'INVOKES',
  'MUTATES',
  'OWNS',
  'PERFORMS_EFFECT',
  'PROVIDES',
  'READS',
  'REQUIRES',
  'REQUIRES_PERMISSION',
  'TRANSITIONS_TO',
  'VERIFIED_BY',
  'WRITES'
];

const RESERVED_PREDICATES: readonly SemanticPredicate[] = [
  'ASSUMES',
  'CONNECTS_TO',
  'CONSUMES',
  'CROSSES_BOUNDARY',
  'DERIVES_FROM',
  'DESERIALIZES_FROM',
  'DISPOSES',
  'ENFORCES',
  'ESCAPES',
  'FLOWS_TO',
  'FORKS_TO',
  'GENERATES',
  'HANDLES',
  'INITIALIZES',
  'JOINS',
  'LOWERS_TO',
  'ORIGINATES_FROM',
  'PERSISTS_AS',
  'PRECEDES',
  'RETRIES',
  'SANITIZES',
  'SERIALIZES_AS',
  'TRANSFORMS_TO',
  'VALIDATES',
  'VIOLATES'
];

function entity(id: string, kind: SemanticEntityKind): SemanticEntity {
  return { id, kind, label: id, attributes: [] };
}

function fact(
  id: string,
  subject: string,
  predicate: SemanticPredicate,
  object: SemanticFactObject
): SemanticFact {
  return {
    id,
    subject,
    predicate,
    object,
    authority: 'authoritative',
    confidence: 1,
    provenance: [{ kind: 'compiler', sourceId: 'predicate-signature-test' }],
    evidence: [],
    validFrom: 'test'
  };
}

function expectCompilerError(run: () => unknown, code: string): CompilerError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return error as CompilerError;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

test('predicate registry owns every SemanticPredicate as active or reserved', () => {
  expect(Object.keys(PREDICATE_SIGNATURE_REGISTRY).sort()).toEqual([...SEMANTIC_PREDICATES].sort());
  expect(SEMANTIC_PREDICATES.filter((predicate) => PREDICATE_SIGNATURE_REGISTRY[predicate].status === 'active').sort()).toEqual([...ACTIVE_PREDICATES]);
  expect(SEMANTIC_PREDICATES.filter((predicate) => PREDICATE_SIGNATURE_REGISTRY[predicate].status === 'reserved').sort()).toEqual([...RESERVED_PREDICATES]);
});

test('controlled multi-variant predicates are statically unambiguous', () => {
  expect(() => assertPredicateSignatureRegistry()).not.toThrow();
  const dependsOn = PREDICATE_SIGNATURE_REGISTRY.DEPENDS_ON;
  expect(dependsOn.status).toBe('active');
  if (dependsOn.status !== 'active') throw new Error('DEPENDS_ON must be active');
  expect(dependsOn.variants.map((variant) => variant.id)).toEqual([
    'block-depends-on-capability',
    'responsibility-depends-on-responsibility'
  ]);

  const entities = [
    entity('block:ticket', 'block'),
    entity('capability:auth', 'capability'),
    entity('responsibility:ticket:api', 'responsibility'),
    entity('responsibility:ticket:storage', 'responsibility')
  ];
  expect(() => assertEngineeringIRPredicateSignatures(entities, [
    fact('fact:block-dependency', 'block:ticket', 'DEPENDS_ON', { kind: 'entity', entityId: 'capability:auth' }),
    fact('fact:responsibility-dependency', 'responsibility:ticket:api', 'DEPENDS_ON', { kind: 'entity', entityId: 'responsibility:ticket:storage' })
  ])).not.toThrow();
});

test('entity-object signatures accept legal kinds and reject illegal kinds deterministically', () => {
  const entities = [
    entity('app:ticket', 'app'),
    entity('block:ticket', 'block'),
    entity('operation:ticket:create', 'operation')
  ];
  expect(() => assertEngineeringIRPredicateSignatures(entities, [
    fact('fact:contains-block', 'app:ticket', 'CONTAINS', { kind: 'entity', entityId: 'block:ticket' })
  ])).not.toThrow();

  const invalidA = fact('fact:a', 'app:ticket', 'CONTAINS', { kind: 'entity', entityId: 'operation:ticket:create' });
  const invalidZ = fact('fact:z', 'app:ticket', 'CONTAINS', { kind: 'entity', entityId: 'operation:ticket:create' });
  const first = expectCompilerError(
    () => assertEngineeringIRPredicateSignatures(entities, [invalidZ, invalidA]),
    'IR-PREDICATE-004'
  );
  const second = expectCompilerError(
    () => assertEngineeringIRPredicateSignatures(entities, [invalidA, invalidZ]),
    'IR-PREDICATE-004'
  );

  expect(first.message).toBe('Fact "fact:a" predicate "CONTAINS" rejects entity object "operation:ticket:create"');
  expect(second.message).toBe(first.message);
  expect(first.details).toEqual({
    factId: 'fact:a',
    predicate: 'CONTAINS',
    subject: 'app:ticket',
    object: { kind: 'entity', entityId: 'operation:ticket:create' },
    actualSubjectKind: 'app',
    actualEntityObjectKind: 'operation',
    expectedEntityObjectKinds: ['block']
  });
});

test('value-object signatures enforce exact schema and embedded entity-reference kind', () => {
  const entities = [
    entity('state:ticket:status', 'state'),
    entity('operation:ticket:close', 'operation'),
    entity('policy:ticket:close', 'policy')
  ];
  expect(() => assertEngineeringIRPredicateSignatures(entities, [
    fact('fact:guarantee', 'state:ticket:status', 'GUARANTEES', { kind: 'value', value: 'closed' }),
    fact('fact:transition', 'state:ticket:status', 'TRANSITIONS_TO', {
      kind: 'value',
      value: { from: 'open', to: 'closed', by: 'operation:ticket:close' }
    })
  ])).not.toThrow();

  const wrongReferenceKind = expectCompilerError(
    () => assertEngineeringIRPredicateSignatures(entities, [
      fact('fact:transition', 'state:ticket:status', 'TRANSITIONS_TO', {
        kind: 'value',
        value: { from: 'open', to: 'closed', by: 'policy:ticket:close' }
      })
    ]),
    'IR-PREDICATE-005'
  );
  expect(wrongReferenceKind.details).toEqual({
    factId: 'fact:transition',
    predicate: 'TRANSITIONS_TO',
    subject: 'state:ticket:status',
    object: {
      kind: 'value',
      value: { from: 'open', to: 'closed', by: 'policy:ticket:close' }
    },
    actualSubjectKind: 'state',
    schemaFailures: [{
      schemaId: 'state-transition-v1',
      failure: '$.by references entity kind "policy"; expected operation'
    }]
  });

  const extraField = expectCompilerError(
    () => assertEngineeringIRPredicateSignatures(entities, [
      fact('fact:transition', 'state:ticket:status', 'TRANSITIONS_TO', {
        kind: 'value',
        value: { from: 'open', to: 'closed', by: 'operation:ticket:close', opaque: true }
      })
    ]),
    'IR-PREDICATE-005'
  );
  expect((extraField.details as { schemaFailures: unknown }).schemaFailures).toEqual([{
    schemaId: 'state-transition-v1',
    failure: '$.opaque is not allowed'
  }]);
});

test('reserved predicates hard fail with stable fact context', () => {
  const reserved = expectCompilerError(
    () => assertEngineeringIRPredicateSignatures([
      entity('operation:ticket:first', 'operation'),
      entity('operation:ticket:second', 'operation')
    ], [
      fact('fact:reserved', 'operation:ticket:first', 'PRECEDES', { kind: 'entity', entityId: 'operation:ticket:second' })
    ]),
    'IR-PREDICATE-001'
  );

  expect(reserved.message).toBe('Fact "fact:reserved" uses reserved predicate "PRECEDES"');
  expect(reserved.details).toEqual({
    factId: 'fact:reserved',
    predicate: 'PRECEDES',
    subject: 'operation:ticket:first',
    object: { kind: 'entity', entityId: 'operation:ticket:second' },
    reason: 'Reserved for Scenario canonical Fact variants owned by the Scenario integration task.'
  });
});
