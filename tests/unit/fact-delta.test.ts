import { expect, test } from 'bun:test';

import { CompilerError } from '../../src/compiler/errors.ts';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { buildFactDelta } from '../../src/compiler/ir/build-fact-delta.ts';
import { factAssertionId } from '../../src/compiler/ir/ir-fact-store.ts';
import { rawSha256Hex, semanticRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import type { FactDeltaEndpointContext } from '../../src/semantics/engineering-ir/delta-types.ts';
import type { EngineeringIR } from '../../src/semantics/engineering-ir/root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../src/semantics/engineering-ir/validated-types.ts';

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
  mutate: (ir: EngineeringIR) => void
): ValidatedEngineeringIRSnapshot {
  const ir = clone(buildEngineeringIR(source));
  mutate(ir);
  ir.entities.sort((left, right) => left.id.localeCompare(right.id));
  ir.facts.sort((left, right) => left.id.localeCompare(right.id));
  for (const fact of ir.facts) fact.assertions.sort((left, right) => left.id.localeCompare(right.id));
  const semanticRevision = `sha256:${rawSha256Hex(semanticRevisionPayload(
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

test('empty Fact Delta is deterministic, transaction-independent, and deeply frozen', () => {
  const snapshot = buildValidatedEngineeringIR(input());
  const beforeJson = JSON.stringify(snapshot);
  const first = buildFactDelta(context(snapshot, 'tx:before-1'), context(snapshot, 'tx:after-1'));
  const second = buildFactDelta(context(snapshot, 'tx:before-2'), context(snapshot, 'tx:after-2'));

  expect(first).toMatchObject({
    contractVersion: '1',
    scope: 'fact-set',
    graphId: snapshot.ir.graphId,
    appId: snapshot.ir.appId,
    added: [],
    removed: [],
    changed: []
  });
  expect(first.fromFactSetDigest).toBe(first.toFactSetDigest);
  expect(first.deltaRevision).toBe(second.deltaRevision);
  expect(JSON.stringify(snapshot)).toBe(beforeJson);
  expectDeepFrozen(first);
});

test('Fact add/remove preserves direction and object changes are remove plus add', () => {
  const before = buildValidatedEngineeringIR(input('delta-app', 'Delta App', ['alpha/basic']));
  const after = buildValidatedEngineeringIR(input('delta-app', 'Delta App', ['alpha/basic', 'beta/basic']));
  const forward = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));
  const reverse = buildFactDelta(context(after, 'tx:after'), context(before, 'tx:before'));

  expect(forward.added.length).toBeGreaterThan(0);
  expect(forward.removed).toEqual([]);
  expect(reverse.added).toEqual([]);
  expect(reverse.removed.map((fact) => fact.id)).toEqual(forward.added.map((fact) => fact.id));

  const twoBlocks = input('delta-app', 'Delta App', ['alpha/basic', 'beta/basic']);
  const alpha = resign(twoBlocks, (ir) => {
    ir.facts = ir.facts.filter((fact) =>
      fact.object.kind === 'entity' && fact.object.entityId === 'block:alpha/basic'
    );
  });
  const beta = resign(twoBlocks, (ir) => {
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

test('Assertion add/remove and authority/provenance identity changes use set changes', () => {
  const source = input();
  const before = buildValidatedEngineeringIR(source);
  const added = resign(source, (ir) => {
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

  expect(addDelta.changed).toHaveLength(1);
  expect(addDelta.changed[0]?.addedAssertions).toHaveLength(1);
  expect(addDelta.changed[0]?.removedAssertions).toEqual([]);
  expect(removeDelta.changed[0]?.removedAssertions).toHaveLength(1);

  const identityChanged = resign(source, (ir) => {
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
});

test('confidence and evidence changes are explicit identity-preserving updates', () => {
  const source = input();
  const before = buildValidatedEngineeringIR(source);
  const after = resign(source, (ir) => {
    const assertion = ir.facts[0]!.assertions[0]!;
    assertion.confidence = 0.5;
    assertion.evidence = [{ kind: 'verification', ref: 'acceptance:delta' }];
  });
  const delta = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));
  const update = delta.changed[0]?.updatedAssertions[0];

  expect(delta.changed).toHaveLength(1);
  expect(update?.changedFields).toEqual(['confidence', 'evidence']);
  expect(update?.before.confidence).toBe(1);
  expect(update?.after).toEqual({
    confidence: 0.5,
    evidence: [{ kind: 'verification', ref: 'acceptance:delta' }]
  });
});

test('validFrom rebinding and entity-only changes do not create Fact churn', () => {
  const before = buildValidatedEngineeringIR(input('delta-app', 'Before Label'));
  const after = buildValidatedEngineeringIR(input('delta-app', 'After Label'));
  const delta = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));

  expect(before.ir.semanticRevision).not.toBe(after.ir.semanticRevision);
  expect(delta.fromFactSetDigest).toBe(delta.toFactSetDigest);
  expect(delta.added).toEqual([]);
  expect(delta.removed).toEqual([]);
  expect(delta.changed).toEqual([]);
});

test('canonicalized declaration order produces byte-stable Fact Delta', () => {
  const forward = buildValidatedEngineeringIR(input('delta-app', 'Delta App', ['alpha/basic', 'beta/basic']));
  const reversedSource = input('delta-app', 'Delta App', ['beta/basic', 'alpha/basic']);
  reversedSource.resolvedBlocks.forEach((block, index) => { block.installOrder = reversedSource.resolvedBlocks.length - index; });
  const reversed = buildValidatedEngineeringIR(reversedSource);
  const first = buildFactDelta(context(forward, 'tx:stable'), context(reversed, 'tx:stable'));
  const second = buildFactDelta(context(forward, 'tx:stable'), context(reversed, 'tx:stable'));

  expect(first.added).toEqual([]);
  expect(first.removed).toEqual([]);
  expect(first.changed).toEqual([]);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

test('endpoint, lineage, and unsupported validity failures use stable diagnostics', () => {
  const before = buildValidatedEngineeringIR(input());
  const otherApp = buildValidatedEngineeringIR(input('other-app'));
  expectCompilerError(
    () => buildFactDelta(
      { ...context(before, 'tx:before'), semanticRevision: 'sha256:stale' },
      context(before, 'tx:after')
    ),
    'FACT-DELTA-001'
  );
  expectCompilerError(
    () => buildFactDelta(context(before, 'tx:before'), context(otherApp, 'tx:after')),
    'FACT-DELTA-002'
  );

  const source = input();
  const closed = resign(source, (ir) => {
    ir.facts[0]!.assertions[0]!.validToRevision = 'sha256:closed';
  });
  expectCompilerError(
    () => buildFactDelta(context(before, 'tx:before'), context(closed, 'tx:closed')),
    'FACT-DELTA-006'
  );
});

test('fact and assertion collections remain canonically ordered', () => {
  const before = buildValidatedEngineeringIR(input('delta-app', 'Delta App', ['alpha/basic']));
  const after = buildValidatedEngineeringIR(input(
    'delta-app',
    'Delta App',
    ['alpha/basic', 'beta/basic', 'gamma/basic']
  ));
  const delta = buildFactDelta(context(before, 'tx:before'), context(after, 'tx:after'));
  expect(delta.added.map((fact) => fact.id)).toEqual(
    [...delta.added.map((fact) => fact.id)].sort((left, right) => left.localeCompare(right))
  );
});
