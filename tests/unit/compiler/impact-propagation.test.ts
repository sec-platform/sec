import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { buildEngineeringIR } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { digest, semanticRevisionPayload } from '../../../src/compiler/ir/ir-revision.ts';
import { deriveScenarioDefinitions } from '../../../src/compiler/ir/scenario-facts.ts';
import { validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';

import { buildFactDelta } from '../../../src/compiler/ir/build-fact-delta.ts';
import { buildImpactPropagation } from '../../../src/compiler/semantic-impact/build-impact-propagation.ts';
import {
  assertImpactPropagationRuleRegistry,
  IMPACT_PROPAGATION_RULES
} from '../../../src/compiler/semantic-impact/propagation-rules.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import type { SemanticEntity, SemanticEntityKind } from '../../../src/semantics/engineering-ir/entity-types.ts';
import type { SemanticAuthority, SemanticFact, SemanticPredicate } from '../../../src/semantics/engineering-ir/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../src/semantics/engineering-ir/validated-types.ts';

const APP_ID = 'app:impact';
const input = { app: { id: 'impact', name: 'Impact' }, resolvedBlocks: [], manifests: [],
  acceptanceIds: [], policyDeclarations: [] };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

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
  const factObject: SemanticFact['object'] = typeof object === 'string' && predicate !== 'GUARANTEES'
    ? { kind: 'entity', entityId: object } : { kind: 'value', value: object as never };
  const objectKey = factObject.kind === 'entity' ? `entity:${factObject.entityId}` : `value:${JSON.stringify(factObject.value)}`;
  // Fixture wire preimage is encoded independently; expected path IDs below are fixed literals.
  const factId = `fact:${hash(`${subject}\0${predicate}\0${objectKey}`).slice(0, 24)}`;
  const provenance = [{ kind: authority === 'inferred' ? 'ai' as const : authority === 'observed' ? 'runtime' as const : 'contract' as const,
    sourceId: `source:${id}:${authority}` }];
  return {
    id: factId,
    subject,
    predicate,
    object: factObject,
    assertions: [{
      id: `assertion:${hash([factId, authority, JSON.stringify(provenance)].join('\0')).slice(0, 24)}`,
      authority,
      confidence: authority === 'inferred' ? 0.5 : 1,
      provenance,
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
  const source = { ...input, app: { ...input.app, name: revision } };
  const ir = buildEngineeringIR(source);
  ir.entities = [entity(APP_ID, 'app', 'Impact'), ...structuredClone(entities)]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  ir.facts = [...structuredClone(facts)].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  ir.scenarios = deriveScenarioDefinitions(ir.entities, ir.facts);
  ir.semanticRevision = `sha256:${digest(semanticRevisionPayload(ir.graphId, ir.appId, ir.entities, ir.facts, ir.scenarios))}`;
  for (const candidate of ir.facts) for (const assertion of candidate.assertions) assertion.validFromRevision = ir.semanticRevision;
  return validateEngineeringIR(ir, source);
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

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value as Record<string, unknown>)) expectDeepFrozen(nested);
}

test('empty canonical change is immutable, deterministic, and deeply frozen', () => {
  const value = snapshot('a', [entity('entity:impact:A', 'entity')]);
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

test('entity merge-join covers add, remove, update, and empty Fact Delta', () => {
  const before = snapshot('b', [
    entity('entity:impact:removed', 'entity'),
    entity('entity:impact:updated', 'entity', 'Before', [{ key: 'rank', value: 1 }])
  ]);
  const after = snapshot('c', [
    entity('entity:impact:added', 'entity'),
    entity('entity:impact:updated', 'entity', 'After', [{ key: 'rank', value: 2 }])
  ]);
  const result = propagate(before, after);

  expect(result.seeds.map((seed) => [seed.basis, seed.kind, seed.anchorEntityId])).toEqual([
    ['from', 'entity-removed', 'entity:impact:removed'],
    ['from', 'entity-updated', 'entity:impact:updated'],
    ['to', 'entity-added', 'entity:impact:added'],
    ['to', 'entity-updated', 'entity:impact:updated']
  ]);
  expect(result.seeds.filter((seed) => seed.kind === 'entity-updated')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ changedFields: ['label', 'attributes'] })
    ])
  );
  expect(result.deltaRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test('Fact seeds preserve endpoint basis and traverse only definite endpoint graphs', () => {
  const entities = [entity('responsibility:impact:A'), entity('responsibility:impact:B'), entity('responsibility:impact:C'), entity('responsibility:impact:D')];
  const before = snapshot('e', entities, [
    fact('fact:C-depends-B', 'responsibility:impact:C', 'DEPENDS_ON', 'responsibility:impact:B')
  ]);
  const after = snapshot('f', entities, [
    fact('fact:B-depends-A', 'responsibility:impact:B', 'DEPENDS_ON', 'responsibility:impact:A'),
    fact('fact:D-depends-B', 'responsibility:impact:D', 'DEPENDS_ON', 'responsibility:impact:B')
  ]);
  const result = propagate(before, after);

  expect(result.seeds.map((seed) => [seed.basis, seed.kind, seed.anchorEntityId])).toEqual(
    expect.arrayContaining([
      ['from', 'fact-removed', 'responsibility:impact:C'],
      ['to', 'fact-added', 'responsibility:impact:B'],
      ['to', 'fact-added', 'responsibility:impact:D']
    ])
  );
  expect(result.seeds).toHaveLength(3);
  expect(result.direct).toEqual([]);
  expect(result.transitive).toEqual([]);

  const endpointEntities = [
    entity('responsibility:impact:A', 'responsibility', 'Before'),
    entity('responsibility:impact:C'),
    entity('responsibility:impact:D'),
    entity('responsibility:impact:E'),
    entity('responsibility:impact:F')
  ];
  const stableEndpointFacts = [
    fact('fact:E-depends-C', 'responsibility:impact:E', 'DEPENDS_ON', 'responsibility:impact:C'),
    fact('fact:F-depends-D', 'responsibility:impact:F', 'DEPENDS_ON', 'responsibility:impact:D')
  ];
  const entityBefore = snapshot('g', endpointEntities, [
    fact('fact:C-depends-A', 'responsibility:impact:C', 'DEPENDS_ON', 'responsibility:impact:A'),
    ...stableEndpointFacts
  ]);
  const entityAfter = snapshot('h', endpointEntities.map((value) =>
    value.id === 'responsibility:impact:A' ? { ...value, label: 'After' } : value
  ), [
    fact('fact:D-depends-A', 'responsibility:impact:D', 'DEPENDS_ON', 'responsibility:impact:A'),
    ...stableEndpointFacts
  ]);
  const endpointResult = propagate(entityBefore, entityAfter);
  expect(endpointResult.direct.map((entry) => [entry.basis, entry.entityId, entry.canonicalPath[0]?.factId]))
    .toEqual([
      ['from', 'responsibility:impact:E', 'fact:36276231b01c5ee36f6aae7f'],
      ['to', 'responsibility:impact:F', 'fact:00f26a379b73b892c5f91551']
    ]);
});

test('assertion-only changes remain local while non-definite Fact roots become unknown', () => {
  const entities = [entity('responsibility:impact:A'), entity('responsibility:impact:B'), entity('responsibility:impact:C')];
  const baseFact = fact('fact:B-depends-A', 'responsibility:impact:B', 'DEPENDS_ON', 'responsibility:impact:A');
  const dependent = fact('fact:C-depends-B', 'responsibility:impact:C', 'DEPENDS_ON', 'responsibility:impact:B');
  const before = snapshot('i', entities, [baseFact, dependent]);
  const updated = structuredClone(baseFact);
  updated.assertions[0]!.confidence = 0.75;
  updated.assertions[0]!.evidence = [{ kind: 'review', ref: 'review:impact' }];
  const after = snapshot('j', entities, [updated, dependent]);
  const result = propagate(before, after);

  expect(result.seeds.map((seed) => [seed.basis, seed.kind, seed.anchorEntityId])).toEqual([
    ['from', 'assertion-updated', 'responsibility:impact:B'],
    ['to', 'assertion-updated', 'responsibility:impact:B']
  ]);
  expect(result.direct).toEqual([]);
  expect(result.transitive).toEqual([]);

  const inferred = snapshot('k', entities, [fact(
    'fact:B-depends-A',
    'responsibility:impact:B',
    'DEPENDS_ON',
    'responsibility:impact:A',
    'inferred'
  )]);
  const inferredResult = propagate(snapshot('l', entities), inferred);
  expect(inferredResult.direct).toEqual([]);
  expect(inferredResult.uncertainties).toEqual([
    expect.objectContaining({
      basis: 'to',
      reasonCode: 'non-definite-authority',
      boundaryEntityId: 'responsibility:impact:B',
      factId: 'fact:83e4da92860c9a323319bc2b'
    })
  ]);
});

test('propagation registry covers every predicate with canonical executable edges', () => {
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
});

test('deterministic closure handles diamond, cycle, shortest witness, causes, and disconnected nodes', () => {
  const entities = ['responsibility:impact:A', 'responsibility:impact:B', 'responsibility:impact:C', 'responsibility:impact:D', 'responsibility:impact:X', 'responsibility:impact:Y'].map((id) =>
    entity(id, 'responsibility', id === 'responsibility:impact:A' ? 'Before' : id)
  );
  const graph = [
    fact('fact:A-depends-D', 'responsibility:impact:A', 'DEPENDS_ON', 'responsibility:impact:D'),
    fact('fact:B-depends-A', 'responsibility:impact:B', 'DEPENDS_ON', 'responsibility:impact:A'),
    fact('fact:C-depends-A', 'responsibility:impact:C', 'DEPENDS_ON', 'responsibility:impact:A'),
    fact('fact:D-depends-B', 'responsibility:impact:D', 'DEPENDS_ON', 'responsibility:impact:B'),
    fact('fact:D-depends-C', 'responsibility:impact:D', 'DEPENDS_ON', 'responsibility:impact:C'),
    fact('fact:Y-depends-X', 'responsibility:impact:Y', 'DEPENDS_ON', 'responsibility:impact:X')
  ];
  const before = snapshot('m', entities, graph);
  const after = snapshot('n', entities.map((value) =>
    value.id === 'responsibility:impact:A' ? { ...value, label: 'After' } : value
  ), graph);
  const result = propagate(before, after);

  for (const basis of ['from', 'to'] as const) {
    expect(result.direct.filter((entry) => entry.basis === basis).map((entry) => entry.entityId))
      .toEqual(['responsibility:impact:B', 'responsibility:impact:C']);
    const transitive = result.transitive.filter((entry) => entry.basis === basis);
    expect(transitive.map((entry) => entry.entityId)).toEqual(['responsibility:impact:D']);
    // Both routes have length two; the canonical C route has the smaller first Fact ID.
    expect(transitive[0]?.canonicalPath.map((step) => step.factId)).toEqual([
      'fact:5296792c120f4b48b5d9f91e',
      'fact:5a7c00164d0e5d3093479f7c'
    ]);
    expect(result.direct.some((entry) => entry.entityId === 'responsibility:impact:A')).toBe(false);
    expect(result.transitive.some((entry) => ['responsibility:impact:A', 'responsibility:impact:X', 'responsibility:impact:Y'].includes(entry.entityId))).toBe(false);
  }

  const twoSeedsBefore = snapshot('o', [
    entity('responsibility:impact:A', 'responsibility', 'Before A'),
    entity('responsibility:impact:C', 'responsibility', 'Before C'),
    entity('responsibility:impact:D')
  ], [
    fact('fact:D-depends-A', 'responsibility:impact:D', 'DEPENDS_ON', 'responsibility:impact:A'),
    fact('fact:D-depends-C', 'responsibility:impact:D', 'DEPENDS_ON', 'responsibility:impact:C')
  ]);
  const twoSeedsAfter = snapshot('p', [
    entity('responsibility:impact:A', 'responsibility', 'After A'),
    entity('responsibility:impact:C', 'responsibility', 'After C'),
    entity('responsibility:impact:D')
  ], twoSeedsBefore.ir.facts);
  const twoSeeds = propagate(twoSeedsBefore, twoSeedsAfter);
  expect(twoSeeds.direct.find((entry) => entry.basis === 'from')?.seedIds).toHaveLength(2);
});

test('unknown frontiers cover both adjacency directions, value stops, self-edge dedupe, and no dynamic output', () => {
  const before = snapshot('q', [
    entity('operation:impact:A', 'operation', 'Before'),
    entity('operation:impact:B', 'operation'),
    entity('state:impact:S', 'state')
  ], [
    fact('fact:A-invokes-A', 'operation:impact:A', 'INVOKES', 'operation:impact:A'),
    fact('fact:A-invokes-B', 'operation:impact:A', 'INVOKES', 'operation:impact:B'),
    fact('fact:B-invokes-A', 'operation:impact:B', 'INVOKES', 'operation:impact:A'),
    fact('fact:S-guarantees', 'state:impact:S', 'GUARANTEES', 'ready')
  ]);
  const after = snapshot('r', before.ir.entities
    .filter((value) => value.id !== APP_ID)
    .map((value) => ['operation:impact:A', 'state:impact:S'].includes(value.id) ? { ...value, label: 'After' } : value), before.ir.facts);
  const result = propagate(before, after);

  for (const basis of ['from', 'to'] as const) {
    const basisUnknown = result.uncertainties.filter((entry) => entry.basis === basis);
    expect(basisUnknown.filter((entry) => entry.factId === 'fact:8b4112b0455a80140d61e64e')).toHaveLength(1);
    expect(basisUnknown).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'fact:faec540f48e6b23cd39feb6c', reasonCode: 'unregistered-active-predicate' }),
      expect.objectContaining({ factId: 'fact:0e3982ba3444ac1ff58b1111', reasonCode: 'unregistered-active-predicate' }),
      expect.objectContaining({ factId: 'fact:a66116225934fe2dcd8ab28d', reasonCode: 'value-object-boundary' })
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
    entity('scenario:impact:mapped', 'scenario', 'Before mapped'),
    entity('scenario:impact:missing', 'scenario', 'Before missing'),
    entity('operation:impact:entry', 'operation')
  ];
  const mappings = [
    fact('fact:artifact-acceptance', 'artifact:one', 'VERIFIED_BY', 'acceptance:one'),
    fact('fact:artifact-selector', 'artifact:one', 'VERIFIED_BY', { selector: '  Test:Exact  ' }),
    fact('fact:policy-mapping', 'policy:semantic', 'VERIFIED_BY', 'policy:verification'),
    fact('fact:scenario-acceptance', 'scenario:impact:mapped', 'VERIFIED_BY', 'acceptance:one'),
    fact('fact:mapped-entry', 'scenario:impact:mapped', 'INVOKES', 'operation:impact:entry'),
    fact('fact:missing-entry', 'scenario:impact:missing', 'INVOKES', 'operation:impact:entry')
  ];
  const before = snapshot('s', entities, mappings);
  const after = snapshot('t', entities.map((value) =>
    ['acceptance:one', 'artifact:one', 'policy:semantic', 'scenario:impact:mapped', 'scenario:impact:missing'].includes(value.id)
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
      boundaryEntityId: 'scenario:impact:missing'
    })
  ]));

  const inferredMapping = fact(
    'fact:scenario-verification-inferred',
    'scenario:impact:missing',
    'VERIFIED_BY',
    'acceptance:one',
    'inferred'
  );
  const inferredResult = propagate(
    snapshot('verification-inferred-from', entities, mappings),
    snapshot('verification-inferred-to', entities, [...mappings, inferredMapping])
  );
  expect(inferredResult.verification).toEqual([]);
  expect(inferredResult.uncertainties).toContainEqual(expect.objectContaining({
    basis: 'to',
    reasonCode: 'non-definite-authority',
    boundaryEntityId: 'scenario:impact:missing',
    factId: 'fact:22111aad6a1b1fd5e80017ec'
  }));

  const updatedMapping = structuredClone(mappings[3]!);
  updatedMapping.assertions[0]!.confidence = 0.75;
  const assertionOnlyResult = propagate(
    snapshot('verification-assertion-from', entities, mappings),
    snapshot('verification-assertion-to', entities, [
      ...mappings.slice(0, 3),
      updatedMapping,
      ...mappings.slice(4)
    ])
  );
  expect(assertionOnlyResult.verification).toContainEqual(expect.objectContaining({
    kind: 'acceptance',
    acceptanceEntityId: 'acceptance:one'
  }));
});

test('shared verification targets retain every ordered reason without cross-kind collisions', () => {
  const artifacts = Array.from({ length: 32 }, (_, index) =>
    entity(`artifact:${String(index).padStart(3, '0')}`, 'artifact'));
  const targetId = 'acceptance:shared';
  const entities = [entity(targetId, 'acceptance'), ...artifacts];
  const mappings = artifacts.flatMap((source) => [
    fact(`fact:${source.id}:acceptance`, source.id, 'VERIFIED_BY', targetId),
    fact(`fact:${source.id}:selector`, source.id, 'VERIFIED_BY', { selector: targetId })
  ]);
  const before = snapshot('fan-in-from', entities, mappings);
  const changed = entities.map((value) => value.kind === 'artifact' ? { ...value, label: `changed:${value.id}` } : value);
  const after = snapshot('fan-in-to', changed, mappings);
  const inputBytes = JSON.stringify({ before, after });
  const result = propagate(before, after);
  expect(result.verification.map((value) => value.kind)).toEqual(['acceptance', 'selector']);
  for (const recommendation of result.verification) {
    expect(recommendation.reasons).toHaveLength(artifacts.length * 2);
    expect(recommendation.reasons.map((reason) => [reason.basis, reason.sourceEntityId])).toEqual(
      ['from', 'to'].flatMap((basis) => artifacts.map((source) => [basis, source.id]))
    );
    expect(new Set(recommendation.reasons.map((reason) => JSON.stringify(reason))).size)
      .toBe(artifacts.length * 2);
    expect(recommendation.reasons.every((reason) => reason.sourceSeedIds.length === 1)).toBe(true);
  }
  expect(JSON.stringify(propagate(
    snapshot('fan-in-from', [...entities].reverse(), [...mappings].reverse()),
    snapshot('fan-in-to', [...changed].reverse(), [...mappings].reverse())
  ))).toBe(JSON.stringify(result));
  expect(JSON.stringify({ before, after })).toBe(inputBytes);
  expectDeepFrozen(result);
});
