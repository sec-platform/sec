import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildFactDelta } from '../../../src/compiler/ir/build-fact-delta.ts';
import { factAssertionId } from '../../../src/compiler/ir/ir-fact-store.ts';
import { digest, semanticRevisionPayload } from '../../../src/compiler/ir/ir-revision.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import type { FactAssertion, SemanticFact } from '../../../src/semantics/engineering-ir/fact-types.ts';
import type { SemanticViewSet } from '../../../src/semantics/projection/types.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import type { EngineeringIR } from '../../../src/semantics/engineering-ir/root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../src/semantics/engineering-ir/validated-types.ts';

function input(
  appId = 'delta-app',
  appName = 'Delta App',
  blockIds: readonly string[] = ['alpha/basic']
): BuildEngineeringIRInput {
  return {
    app: { id: appId, name: appName },
    resolvedBlocks: blockIds.map((id, index) => ({
      id,
      version: '0.1.0',
      kind: 'capability' as const,
      installOrder: index + 1,
      manifestPath: `registry/${id}/block.manifest.yaml`,
      registrySourceId: 'official',
      registryKind: 'official' as const,
      registryLocation: 'compiler',
      registryPath: 'registry'
    })),
    manifests: [],
    acceptanceIds: [],
    policyDeclarations: []
  };
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function resign(
  source: BuildEngineeringIRInput,
  base: EngineeringIR,
  mutate: (ir: EngineeringIR) => void
): ValidatedEngineeringIRSnapshot {
  const ir = clone(base);
  mutate(ir);
  ir.entities.sort((left, right) => left.id.localeCompare(right.id));
  ir.facts.sort((left, right) => left.id.localeCompare(right.id));
  for (const fact of ir.facts) fact.assertions.sort((left, right) => left.id.localeCompare(right.id));
  const semanticRevision = `sha256:${digest(semanticRevisionPayload(
    ir.graphId,
    ir.appId,
    ir.entities,
    ir.facts,
    ir.scenarios
  ))}`;
  ir.semanticRevision = semanticRevision;
  for (const fact of ir.facts) {
    for (const assertion of fact.assertions) assertion.validFromRevision = semanticRevision;
  }
  return validateEngineeringIR(ir, source);
}

function context(
  snapshot: ValidatedEngineeringIRSnapshot,
  transactionId: string
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function expectCodedFailure(run: () => unknown, code: string): CodedFailure {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CodedFailure);
    expect((error as CodedFailure).code).toBe(code);
    return error as CodedFailure;
  }
  throw new Error(`Expected CodedFailure ${code}`);
}

function sha256(payload: string): string {
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function assertionWithoutValidity(
  assertion: FactAssertion
): Omit<FactAssertion, 'validFromRevision' | 'validToRevision'> {
  const {
    validFromRevision: _validFromRevision,
    validToRevision: _validToRevision,
    ...canonical
  } = assertion;
  return canonical;
}

function factWithoutValidity(fact: SemanticFact): object {
  return {
    ...fact,
    assertions: fact.assertions.map(assertionWithoutValidity)
  };
}

function expectedFactSetDigest(snapshot: ValidatedEngineeringIRSnapshot): string {
  const { ir } = snapshot;
  return sha256(JSON.stringify({
    domain: 'engineering-ir-fact-set-v1',
    formatVersion: ir.formatVersion,
    graphId: ir.graphId,
    appId: ir.appId,
    facts: ir.facts.map(factWithoutValidity)
  }));
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value as Record<string, unknown>)) expectDeepFrozen(nested);
}

test('Fact add/remove preserves direction and object changes are remove plus add', () => {
  const before = buildValidatedEngineeringIR(input('delta-app', 'Delta App', ['alpha/basic']));
  const after = buildValidatedEngineeringIR(input('delta-app', 'Delta App', ['alpha/basic', 'beta/basic', 'gamma/basic']));
  const forward = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));
  const reverse = buildFactDelta(context(after, 'tx:after'), context(before, 'tx:before'));

  // Deep immutability and fixed semantic effects, not copied object identity,
  // are the externally observable Fact Delta obligations.
  expectDeepFrozen(forward);
  expectDeepFrozen(reverse);
  expect(forward.added).toHaveLength(2);
  expect(forward.added.map((fact) => fact.id)).toEqual(
    [...forward.added.map((fact) => fact.id)].sort((left, right) => left.localeCompare(right))
  );
  expect(forward.removed).toEqual([]);
  expect(reverse.added).toEqual([]);
  expect(reverse.removed.map((fact) => fact.id)).toEqual(forward.added.map((fact) => fact.id));

  const expectedFromFactSetDigest = expectedFactSetDigest(before);
  const expectedToFactSetDigest = expectedFactSetDigest(after);
  expect(forward.fromFactSetDigest).toBe(expectedFromFactSetDigest);
  expect(forward.toFactSetDigest).toBe(expectedToFactSetDigest);

  const expectedDeltaRevision = sha256(JSON.stringify({
    domain: 'engineering-ir-fact-delta-v1',
    contractVersion: '1',
    scope: 'fact-set',
    formatVersion: before.ir.formatVersion,
    graphId: before.ir.graphId,
    appId: before.ir.appId,
    from: { semanticRevision: before.ir.semanticRevision },
    to: { semanticRevision: after.ir.semanticRevision },
    fromFactSetDigest: expectedFromFactSetDigest,
    toFactSetDigest: expectedToFactSetDigest,
    added: forward.added.map(factWithoutValidity),
    removed: forward.removed.map(factWithoutValidity),
    changed: forward.changed.map((change) => ({
      factId: change.factId,
      addedAssertions: change.addedAssertions.map(assertionWithoutValidity),
      removedAssertions: change.removedAssertions.map(assertionWithoutValidity),
      updatedAssertions: change.updatedAssertions
    }))
  }));
  expect(forward.deltaRevision).toBe(expectedDeltaRevision);
  expect(reverse.deltaRevision).not.toBe(forward.deltaRevision);

  const twoBlocks = input('delta-app', 'Delta App', ['alpha/basic', 'beta/basic']);
  const twoBlockIR = buildEngineeringIR(twoBlocks);
  const alpha = resign(twoBlocks, twoBlockIR, (ir) => {
    ir.facts = ir.facts.filter((fact) =>
      fact.object.kind === 'entity' && fact.object.entityId === 'block:alpha/basic'
    );
  });
  const beta = resign(twoBlocks, twoBlockIR, (ir) => {
    ir.facts = ir.facts.filter((fact) =>
      fact.object.kind === 'entity' && fact.object.entityId === 'block:beta/basic'
    );
  });
  const objectChanged = buildFactDelta(context(alpha, 'tx:alpha'), context(beta, 'tx:beta'));

  expect(objectChanged.added).toHaveLength(1);
  expect(objectChanged.removed).toHaveLength(1);
  expect(objectChanged.changed).toEqual([]);
  expect(objectChanged.added[0]?.id).not.toBe(objectChanged.removed[0]?.id);
});

test('assertion deltas distinguish identity set changes from confidence and evidence updates', () => {
  const source = input();
  const before = buildValidatedEngineeringIR(source);
  const added = resign(source, before.ir, (ir) => {
    const fact = ir.facts[0]!;
    const provenance = [{ kind: 'ai' as const, sourceId: 'delta-review' }];
    fact.assertions.push({
      id: factAssertionId(fact.id, 'inferred', provenance),
      authority: 'inferred',
      confidence: 0.7,
      provenance,
      evidence: [{ kind: 'review', ref: 'review:delta' }],
      validFromRevision: ir.semanticRevision
    });
  });
  const addDelta = buildFactDelta(context(before, 'tx:before'), context(added, 'tx:added'));
  const removeDelta = buildFactDelta(context(added, 'tx:added'), context(before, 'tx:before'));

  expectDeepFrozen(addDelta);
  expectDeepFrozen(removeDelta);
  const addedAssertion = addDelta.changed[0]?.addedAssertions[0];
  expect(addedAssertion).toMatchObject({
    authority: 'inferred',
    confidence: 0.7,
    provenance: [{ kind: 'ai', sourceId: 'delta-review' }],
    evidence: [{ kind: 'review', ref: 'review:delta' }]
  });
  expect(addDelta.changed).toHaveLength(1);
  expect(addDelta.changed[0]?.addedAssertions).toHaveLength(1);
  expect(addDelta.changed[0]?.removedAssertions).toEqual([]);
  expect(removeDelta.changed[0]?.removedAssertions).toHaveLength(1);

  const identityChanged = resign(source, before.ir, (ir) => {
    const fact = ir.facts[0]!;
    const assertion = fact.assertions[0]!;
    assertion.authority = 'observed';
    assertion.provenance = [{ kind: 'runtime', sourceId: 'trace:delta' }];
    assertion.id = factAssertionId(fact.id, assertion.authority, assertion.provenance);
  });
  const identityDelta = buildFactDelta(context(before, 'tx:before'), context(identityChanged, 'tx:identity'));
  expect(identityDelta.changed[0]?.addedAssertions).toHaveLength(1);
  expect(identityDelta.changed[0]?.removedAssertions).toHaveLength(1);
  expect(identityDelta.changed[0]?.updatedAssertions).toEqual([]);
  const after = resign(source, before.ir, (ir) => {
    const assertion = ir.facts[0]!.assertions[0]!;
    assertion.confidence = 0.5;
    assertion.evidence = [{ kind: 'verification', ref: 'acceptance:delta' }];
  });
  const delta = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));
  const update = delta.changed[0]?.updatedAssertions[0];

  expect(delta.changed).toHaveLength(1);
  expectDeepFrozen(delta);
  expect(update?.changedFields).toEqual(['confidence', 'evidence']);
  expect(update?.before.confidence).toBe(1);
  expect(update?.after).toEqual({
    confidence: 0.5,
    evidence: [{ kind: 'verification', ref: 'acceptance:delta' }]
  });
});

test('validFrom rebinding and entity-only changes do not create Fact churn', () => {
  const before = buildValidatedEngineeringIR(input('delta-app', 'Before Label'));
  const beforeJson = JSON.stringify(before);
  const noop = buildFactDelta(context(before, 'tx:before'), context(before, 'tx:before'));

  expect(Object.keys(noop)).toEqual([
    'contractVersion',
    'scope',
    'formatVersion',
    'graphId',
    'appId',
    'from',
    'to',
    'fromFactSetDigest',
    'toFactSetDigest',
    'added',
    'removed',
    'changed',
    'deltaRevision'
  ]);
  expect(Object.keys(noop.from)).toEqual(['transactionId', 'inputRevision', 'semanticRevision']);
  expect(noop.contractVersion).toBe('1');
  expect(noop.scope).toBe('fact-set');
  expect(noop).toMatchObject({ graphId: before.ir.graphId, appId: before.ir.appId, added: [], removed: [], changed: [] });
  expect(noop.fromFactSetDigest).toBe(noop.toFactSetDigest);
  expect(Object.isFrozen(noop)).toBe(true);
  // The exact schema above contains only scalar fields, the two scalar-only
  // endpoints, and the three empty change arrays in this no-change result.
  for (const value of Object.values(noop)) {
    if (value !== null && typeof value === 'object') expect(Object.isFrozen(value)).toBe(true);
  }
  expect(JSON.stringify(before)).toBe(beforeJson);
  expect(noop.fromFactSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(noop.deltaRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.stringify(buildFactDelta(context(before, 'tx:before'), context(before, 'tx:before')))).toBe(JSON.stringify(noop));

  if (false) {
    const raw = buildEngineeringIR(input());
    const lock = {} as LockFile;
    const views = {} as SemanticViewSet;
    // @ts-expect-error Raw EngineeringIR cannot cross the validated Fact Delta boundary.
    buildFactDelta({ ...context(before, 'tx:before'), snapshot: raw }, context(before, 'tx:before'));
    // @ts-expect-error Lock state cannot cross the validated Fact Delta boundary.
    buildFactDelta({ ...context(before, 'tx:before'), snapshot: lock }, context(before, 'tx:before'));
    // @ts-expect-error Projection state cannot cross the validated Fact Delta boundary.
    buildFactDelta({ ...context(before, 'tx:before'), snapshot: views }, context(before, 'tx:before'));
  }

  const after = buildValidatedEngineeringIR(input('delta-app', 'After Label'));
  const delta = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));

  expect(before.ir.semanticRevision).not.toBe(after.ir.semanticRevision);
  expect(delta.fromFactSetDigest).toBe(delta.toFactSetDigest);
  expect(delta.added).toEqual([]);
  expect(delta.removed).toEqual([]);
  expect(delta.changed).toEqual([]);
});

test('endpoint and lineage failures use stable diagnostics', () => {
  const source = input();
  const before = buildValidatedEngineeringIR(source);
  const otherApp = buildValidatedEngineeringIR(input('other-app'));
  expectCodedFailure(
    () => buildFactDelta(
      { ...context(before, 'tx:before'), semanticRevision: 'sha256:stale' },
      context(before, 'tx:after')
    ),
    'FACT-DELTA-001'
  );
  expectCodedFailure(
    () => buildFactDelta(context(before, 'tx:before'), context(otherApp, 'tx:after')),
    'FACT-DELTA-002'
  );
});
