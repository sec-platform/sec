import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import {
  buildFactDelta,
  buildImpactPropagation
} from '../../platform/compiler/index.ts';
import {
  assertImpactPropagationRuleRegistry,
  IMPACT_PROPAGATION_RULES,
  type ImpactPropagationRule
} from '../../platform/compiler/semantic-impact/propagation-rules.ts';
import type {
  FactDeltaEndpointContext,
  SemanticAuthority,
  SemanticEntity,
  SemanticEntityKind,
  SemanticFact,
  SemanticPredicate,
  ValidatedEngineeringIRSnapshot
} from '../../platform/shared/engineering-ir-types.ts';
import { CompilerError } from '../../platform/shared/errors.ts';

const APP_ID = 'app:impact';
const GRAPH_ID = 'graph:impact';

function entity(
  id: string,
  kind: SemanticEntityKind = 'responsibility',
  label = id,
  attributes: SemanticEntity['attributes'] = []
): SemanticEntity {
  return { id, kind, label, attributes };
}

function fact(
  id: string,
  subject: string,
  predicate: SemanticPredicate,
  object: string | unknown,
  authority: SemanticAuthority = 'authoritative'
): SemanticFact {
  return {
    id,
    subject,
    predicate,
    object: typeof object === 'string'
      ? { kind: 'entity', entityId: object }
      : { kind: 'value', value: object as never },
    assertions: [{
      id: `assertion:${id}:${authority}`,
      authority,
      confidence: authority === 'inferred' ? 0.5 : 1,
      provenance: [{
        kind: authority === 'inferred' ? 'ai' : authority === 'observed' ? 'runtime' : 'contract',
        sourceId: `source:${id}:${authority}`
      }],
      evidence: [],
      validFromRevision: 'pending'
    }]
  };
}

function snapshot(
  revision: string,
  entities: readonly SemanticEntity[],
  facts: readonly SemanticFact[] = []
): ValidatedEngineeringIRSnapshot {
  const semanticRevision = `sha256:${revision.padEnd(64, revision[0] ?? '0').slice(0, 64)}`;
  const canonicalFacts = [...structuredClone(facts)]
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const candidate of canonicalFacts) {
    candidate.assertions.sort((left, right) => left.id.localeCompare(right.id));
    for (const assertion of candidate.assertions) assertion.validFromRevision = semanticRevision;
  }
  return {
    ir: {
      formatVersion: '2',
      graphId: GRAPH_ID,
      inputRevision: `sha256:input-${revision}`,
      semanticRevision,
      appId: APP_ID,
      entities: [entity(APP_ID, 'app'), ...structuredClone(entities)]
        .sort((left, right) => left.id.localeCompare(right.id)),
      facts: canonicalFacts,
      scenarios: []
    }
  } as unknown as ValidatedEngineeringIRSnapshot;
}

function context(
  value: ValidatedEngineeringIRSnapshot,
  transactionId: string
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: value.ir.inputRevision,
    semanticRevision: value.ir.semanticRevision,
    snapshot: value
  };
}

function propagate(
  before: ValidatedEngineeringIRSnapshot,
  after: ValidatedEngineeringIRSnapshot
) {
  const from = context(before, 'tx:from');
  const to = context(after, 'tx:to');
  const delta = buildFactDelta(from, to);
  return buildImpactPropagation({ delta, from, to });
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

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value as Record<string, unknown>)) expectDeepFrozen(nested);
}

function sha256(payload: string): string {
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

test('empty canonical change is immutable, deterministic, and deeply frozen', () => {
  const value = snapshot('a', [entity('entity:A')]);
  const from = context(value, 'tx:first-from');
  const to = context(value, 'tx:first-to');
  const delta = buildFactDelta(from, to);
  const beforeJson = JSON.stringify({ delta, from, to });
  const first = buildImpactPropagation({ delta, from, to });
  const second = buildImpactPropagation({ delta, from, to });

  expect(first).toMatchObject({
    contractVersion: '1',
    scope: 'fact-delta+validated-graph',
    seeds: [],
    direct: [],
    transitive: [],
    uncertainties: [],
    verification: []
  });
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(JSON.stringify({ delta, from, to })).toBe(beforeJson);
  expectDeepFrozen(first);
});

test('entity merge-join covers add, remove, update, empty Fact Delta, and kind collisions', () => {
  const before = snapshot('b', [
    entity('entity:removed'),
    entity('entity:updated', 'entity', 'Before', [{ key: 'rank', value: 1 }])
  ]);
  const after = snapshot('c', [
    entity('entity:added'),
    entity('entity:updated', 'entity', 'After', [{ key: 'rank', value: 2 }])
  ]);
  const result = propagate(before, after);

  expect(result.seeds.map((seed) => [seed.basis, seed.kind, seed.anchorEntityId])).toEqual([
    ['from', 'entity-removed', 'entity:removed'],
    ['from', 'entity-updated', 'entity:updated'],
    ['to', 'entity-added', 'entity:added'],
    ['to', 'entity-updated', 'entity:updated']
  ]);
  expect(result.seeds.filter((seed) => seed.kind === 'entity-updated')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ changedFields: ['label', 'attributes'] })
    ])
  );
  expect(result.deltaRevision).toMatch(/^sha256:[0-9a-f]{64}$/);

  const kindChanged = snapshot('d', [entity('entity:updated', 'state')]);
  expectCompilerError(() => propagate(after, kindChanged), 'IMPACT-004');
});

test('Fact seeds preserve endpoint basis and traverse only definite endpoint graphs', () => {
  const entities = [entity('A'), entity('B'), entity('C'), entity('D')];
  const before = snapshot('e', entities, [
    fact('fact:C-depends-B', 'C', 'DEPENDS_ON', 'B')
  ]);
  const after = snapshot('f', entities, [
    fact('fact:B-depends-A', 'B', 'DEPENDS_ON', 'A'),
    fact('fact:D-depends-B', 'D', 'DEPENDS_ON', 'B')
  ]);
  const result = propagate(before, after);

  expect(result.seeds.map((seed) => [seed.basis, seed.kind, seed.anchorEntityId])).toEqual(
    expect.arrayContaining([
      ['from', 'fact-removed', 'C'],
      ['to', 'fact-added', 'B'],
      ['to', 'fact-added', 'D']
    ])
  );
  expect(result.seeds).toHaveLength(3);
  expect(result.direct).toEqual([]);
  expect(result.transitive).toEqual([]);

  const endpointEntities = [
    entity('A', 'entity', 'Before'),
    entity('C'),
    entity('D'),
    entity('E'),
    entity('F')
  ];
  const stableEndpointFacts = [
    fact('fact:E-depends-C', 'E', 'DEPENDS_ON', 'C'),
    fact('fact:F-depends-D', 'F', 'DEPENDS_ON', 'D')
  ];
  const entityBefore = snapshot('g', endpointEntities, [
    fact('fact:C-depends-A', 'C', 'DEPENDS_ON', 'A'),
    ...stableEndpointFacts
  ]);
  const entityAfter = snapshot('h', endpointEntities.map((value) =>
    value.id === 'A' ? { ...value, label: 'After' } : value
  ), [
    fact('fact:D-depends-A', 'D', 'DEPENDS_ON', 'A'),
    ...stableEndpointFacts
  ]);
  const endpointResult = propagate(entityBefore, entityAfter);
  expect(endpointResult.direct.map((entry) => [entry.basis, entry.entityId, entry.canonicalPath[0]?.factId]))
    .toEqual([
      ['from', 'E', 'fact:E-depends-C'],
      ['to', 'F', 'fact:F-depends-D']
    ]);
});

test('assertion-only changes remain local while non-definite Fact roots become unknown', () => {
  const entities = [entity('A'), entity('B'), entity('C')];
  const baseFact = fact('fact:B-depends-A', 'B', 'DEPENDS_ON', 'A');
  const dependent = fact('fact:C-depends-B', 'C', 'DEPENDS_ON', 'B');
  const before = snapshot('i', entities, [baseFact, dependent]);
  const updated = structuredClone(baseFact);
  updated.assertions[0]!.confidence = 0.75;
  updated.assertions[0]!.evidence = [{ kind: 'review', ref: 'review:impact' }];
  const after = snapshot('j', entities, [updated, dependent]);
  const result = propagate(before, after);

  expect(result.seeds.map((seed) => [seed.basis, seed.kind, seed.anchorEntityId])).toEqual([
    ['from', 'assertion-updated', 'B'],
    ['to', 'assertion-updated', 'B']
  ]);
  expect(result.direct).toEqual([]);
  expect(result.transitive).toEqual([]);

  const inferred = snapshot('k', entities, [fact(
    'fact:B-depends-A-inferred',
    'B',
    'DEPENDS_ON',
    'A',
    'inferred'
  )]);
  const inferredResult = propagate(snapshot('l', entities), inferred);
  expect(inferredResult.direct).toEqual([]);
  expect(inferredResult.uncertainties).toEqual([
    expect.objectContaining({
      basis: 'to',
      reasonCode: 'non-definite-authority',
      boundaryEntityId: 'B',
      factId: 'fact:B-depends-A-inferred'
    })
  ]);
});

test('frozen rule registry pins total status, exact directions, and stable variant IDs', () => {
  expect(() => assertImpactPropagationRuleRegistry()).not.toThrow();
  expect(IMPACT_PROPAGATION_RULES).toMatchObject({
    DEPENDS_ON: {
      action: 'edge',
      direction: 'object-to-subject',
      ruleVariantId: 'impact.depends-on.object-to-subject.v1'
    },
    REQUIRES: {
      action: 'edge',
      direction: 'object-to-subject',
      ruleVariantId: 'impact.requires.object-to-subject.v1'
    },
    IMPLEMENTS: {
      action: 'edge',
      direction: 'object-to-subject',
      ruleVariantId: 'impact.implements.object-to-subject.v1'
    },
    LOWERS_TO: {
      action: 'edge',
      direction: 'subject-to-object',
      ruleVariantId: 'impact.lowers-to.subject-to-object.v1'
    }
  });
  expect(Object.isFrozen(IMPACT_PROPAGATION_RULES)).toBe(true);
  expect(Object.values(IMPACT_PROPAGATION_RULES).every(Object.isFrozen)).toBe(true);

  const wrongDirection = structuredClone(IMPACT_PROPAGATION_RULES) as Record<
    SemanticPredicate,
    ImpactPropagationRule
  >;
  wrongDirection.DEPENDS_ON = {
    ...wrongDirection.DEPENDS_ON as Extract<ImpactPropagationRule, { action: 'edge' }>,
    direction: 'subject-to-object'
  };
  expectCompilerError(() => assertImpactPropagationRuleRegistry(wrongDirection), 'IMPACT-003');

  const duplicateVariant = structuredClone(IMPACT_PROPAGATION_RULES) as Record<
    SemanticPredicate,
    ImpactPropagationRule
  >;
  duplicateVariant.REQUIRES = {
    ...duplicateVariant.REQUIRES as Extract<ImpactPropagationRule, { action: 'edge' }>,
    ruleVariantId: 'impact.depends-on.object-to-subject.v1'
  };
  expectCompilerError(() => assertImpactPropagationRuleRegistry(duplicateVariant), 'IMPACT-003');

  for (const [predicate, action] of [
    ['GUARANTEES', 'unknown'],
    ['VERIFIED_BY', 'unknown'],
    ['INVOKES', 'value-stop']
  ] as const) {
    const actionDrift = structuredClone(IMPACT_PROPAGATION_RULES) as Record<
      SemanticPredicate,
      ImpactPropagationRule
    >;
    actionDrift[predicate] = { action };
    expectCompilerError(() => assertImpactPropagationRuleRegistry(actionDrift), 'IMPACT-003');
  }
});

test('deterministic closure handles diamond, cycle, shortest witness, causes, and disconnected nodes', () => {
  const entities = ['A', 'B', 'C', 'D', 'X', 'Y'].map((id) =>
    entity(id, 'responsibility', id === 'A' ? 'Before' : id)
  );
  const graph = [
    fact('fact:A-depends-D', 'A', 'DEPENDS_ON', 'D'),
    fact('fact:B-depends-A', 'B', 'DEPENDS_ON', 'A'),
    fact('fact:C-depends-A', 'C', 'DEPENDS_ON', 'A'),
    fact('fact:D-depends-B', 'D', 'DEPENDS_ON', 'B'),
    fact('fact:D-depends-C', 'D', 'DEPENDS_ON', 'C'),
    fact('fact:Y-depends-X', 'Y', 'DEPENDS_ON', 'X')
  ];
  const before = snapshot('m', entities, graph);
  const after = snapshot('n', entities.map((value) =>
    value.id === 'A' ? { ...value, label: 'After' } : value
  ), graph);
  const result = propagate(before, after);

  for (const basis of ['from', 'to'] as const) {
    expect(result.direct.filter((entry) => entry.basis === basis).map((entry) => entry.entityId))
      .toEqual(['B', 'C']);
    const transitive = result.transitive.filter((entry) => entry.basis === basis);
    expect(transitive.map((entry) => entry.entityId)).toEqual(['D']);
    expect(transitive[0]?.canonicalPath.map((step) => step.factId)).toEqual([
      'fact:B-depends-A',
      'fact:D-depends-B'
    ]);
    expect(result.direct.some((entry) => entry.entityId === 'A')).toBe(false);
    expect(result.transitive.some((entry) => ['A', 'X', 'Y'].includes(entry.entityId))).toBe(false);
  }

  const twoSeedsBefore = snapshot('o', [
    entity('A', 'entity', 'Before A'),
    entity('C', 'entity', 'Before C'),
    entity('D')
  ], [
    fact('fact:D-depends-A', 'D', 'DEPENDS_ON', 'A'),
    fact('fact:D-depends-C', 'D', 'DEPENDS_ON', 'C')
  ]);
  const twoSeedsAfter = snapshot('p', [
    entity('A', 'entity', 'After A'),
    entity('C', 'entity', 'After C'),
    entity('D')
  ], twoSeedsBefore.ir.facts);
  const twoSeeds = propagate(twoSeedsBefore, twoSeedsAfter);
  expect(twoSeeds.direct.find((entry) => entry.basis === 'from')?.seedIds).toHaveLength(2);
});

test('unknown frontiers cover both adjacency directions, value stops, self-edge dedupe, and no dynamic output', () => {
  const before = snapshot('q', [
    entity('A', 'operation', 'Before'),
    entity('B', 'operation'),
    entity('S', 'state')
  ], [
    fact('fact:A-invokes-A', 'A', 'INVOKES', 'A'),
    fact('fact:A-invokes-B', 'A', 'INVOKES', 'B'),
    fact('fact:B-invokes-A', 'B', 'INVOKES', 'A'),
    fact('fact:A-guarantees', 'A', 'GUARANTEES', 'ready')
  ]);
  const after = snapshot('r', before.ir.entities
    .filter((value) => value.id !== APP_ID)
    .map((value) => value.id === 'A' ? { ...value, label: 'After' } : value), before.ir.facts);
  const result = propagate(before, after);

  for (const basis of ['from', 'to'] as const) {
    const basisUnknown = result.uncertainties.filter((entry) => entry.basis === basis);
    expect(basisUnknown.filter((entry) => entry.factId === 'fact:A-invokes-A')).toHaveLength(1);
    expect(basisUnknown).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'fact:A-invokes-B', reasonCode: 'unregistered-active-predicate' }),
      expect.objectContaining({ factId: 'fact:B-invokes-A', reasonCode: 'unregistered-active-predicate' }),
      expect.objectContaining({ factId: 'fact:A-guarantees', reasonCode: 'value-object-boundary' })
    ]));
  }
  expect(result.uncertainties.every((entry) => entry.classification === 'unknown')).toBe(true);
});

test('verification recommendations retain exact selectors and classify missing/non-runnable mappings', () => {
  const entities = [
    entity('acceptance:one', 'acceptance', 'Before acceptance'),
    entity('artifact:one', 'artifact', 'Before artifact'),
    entity('policy:semantic', 'policy', 'Before policy'),
    entity('policy:verification', 'policy'),
    entity('scenario:mapped', 'scenario', 'Before mapped'),
    entity('scenario:missing', 'scenario', 'Before missing')
  ];
  const mappings = [
    fact('fact:artifact-acceptance', 'artifact:one', 'VERIFIED_BY', 'acceptance:one'),
    fact('fact:artifact-selector', 'artifact:one', 'VERIFIED_BY', { selector: '  Test:Exact  ' }),
    fact('fact:policy-mapping', 'policy:semantic', 'VERIFIED_BY', 'policy:verification'),
    fact('fact:scenario-acceptance', 'scenario:mapped', 'VERIFIED_BY', 'acceptance:one')
  ];
  const before = snapshot('s', entities, mappings);
  const after = snapshot('t', entities.map((value) =>
    ['acceptance:one', 'artifact:one', 'policy:semantic', 'scenario:mapped', 'scenario:missing'].includes(value.id)
      ? { ...value, label: `After ${value.id}` }
      : value
  ), mappings);
  const result = propagate(before, after);

  expect(result.verification).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'acceptance', acceptanceEntityId: 'acceptance:one' }),
    expect.objectContaining({ kind: 'selector', selector: '  Test:Exact  ' })
  ]));
  const acceptance = result.verification.find((entry) => entry.kind === 'acceptance');
  expect(acceptance?.reasons.length).toBeGreaterThan(2);
  expect(result.uncertainties).toEqual(expect.arrayContaining([
    expect.objectContaining({
      reasonCode: 'verification-mapping-non-runnable',
      boundaryEntityId: 'policy:semantic'
    }),
    expect.objectContaining({
      reasonCode: 'verification-mapping-missing',
      boundaryEntityId: 'scenario:missing'
    })
  ]));

  const inferredInvocation = fact(
    'fact:scenario-invokes-inferred',
    'scenario:mapped',
    'INVOKES',
    'acceptance:one',
    'inferred'
  );
  const inferredResult = propagate(
    snapshot('verification-inferred-from', entities, mappings),
    snapshot('verification-inferred-to', entities, [...mappings, inferredInvocation])
  );
  expect(inferredResult.verification).toEqual([]);
  expect(inferredResult.uncertainties).toContainEqual(expect.objectContaining({
    basis: 'to',
    reasonCode: 'non-definite-authority',
    boundaryEntityId: 'scenario:mapped',
    factId: 'fact:scenario-invokes-inferred'
  }));

  const updatedMapping = structuredClone(mappings[3]!);
  updatedMapping.assertions[0]!.confidence = 0.75;
  const assertionOnlyResult = propagate(
    snapshot('verification-assertion-from', entities, mappings),
    snapshot('verification-assertion-to', entities, [
      ...mappings.slice(0, 3),
      updatedMapping
    ])
  );
  expect(assertionOnlyResult.verification).toContainEqual(expect.objectContaining({
    kind: 'acceptance',
    acceptanceEntityId: 'acceptance:one'
  }));

  const invalidMapping = fact('fact:invalid-mapping', 'scenario:mapped', 'VERIFIED_BY', 'artifact:one');
  expectCompilerError(
    () => propagate(
      snapshot('u', entities, [invalidMapping]),
      snapshot('v', entities.map((value) =>
        value.id === 'scenario:mapped' ? { ...value, label: 'Changed' } : value
      ), [invalidMapping])
    ),
    'IMPACT-005'
  );
});

test('diagnostic precedence separates endpoint, Fact Delta, and canonical payload failures', () => {
  const before = snapshot('w', [entity('A')]);
  const after = snapshot('x', [entity('A', 'responsibility', 'Changed')]);
  const from = context(before, 'tx:from');
  const to = context(after, 'tx:to');
  const delta = buildFactDelta(from, to);

  expectCompilerError(
    () => buildImpactPropagation({
      delta: { ...delta, from: { ...delta.from, transactionId: 'tx:wrong' } },
      from,
      to
    }),
    'IMPACT-001'
  );

  const staleFrom = { ...from, semanticRevision: 'sha256:stale' };
  expectCompilerError(
    () => buildImpactPropagation({
      delta: { ...delta, from: { ...delta.from, semanticRevision: staleFrom.semanticRevision } },
      from: staleFrom,
      to
    }),
    'FACT-DELTA-001'
  );

  expectCompilerError(
    () => buildImpactPropagation({
      delta: { ...delta, deltaRevision: sha256('tampered') },
      from,
      to
    }),
    'IMPACT-002'
  );
});
