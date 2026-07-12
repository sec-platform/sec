import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import {
  buildEngineeringIR,
  buildFactDelta,
  buildValidatedEngineeringIR,
  type BuildEngineeringIRInput
} from '../../platform/compiler/index.ts';
import type {
  EngineeringIR,
  FactAssertion,
  FactDeltaEndpointContext,
  SemanticFact,
  ValidatedEngineeringIRSnapshot
} from '../../platform/shared/engineering-ir-types.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import type { SemanticViewSet } from '../../platform/shared/semantic-view-types.ts';

function source(): BuildEngineeringIRInput {
  return {
    app: { id: 'delta-contract', name: 'Delta Contract' },
    resolvedBlocks: [],
    manifests: [],
    slotTasks: [],
    acceptanceIds: [],
    policyDeclarations: []
  };
}

function sourceWithBlock(): BuildEngineeringIRInput {
  return {
    ...source(),
    resolvedBlocks: [{
      id: 'alpha/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'registry/alpha/basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry'
    }]
  };
}

function endpoint(snapshot: ValidatedEngineeringIRSnapshot): FactDeltaEndpointContext {
  return {
    transactionId: 'tx:delta-contract',
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function forgedSnapshot(ir: EngineeringIR): ValidatedEngineeringIRSnapshot {
  return { ir } as unknown as ValidatedEngineeringIRSnapshot;
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

function expectCompilerError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

test('public Fact Delta v1 schema and deterministic digest contract stay frozen', () => {
  const snapshot = buildValidatedEngineeringIR(source());
  const delta = buildFactDelta(endpoint(snapshot), endpoint(snapshot));

  expect(Object.keys(delta)).toEqual([
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
  expect(Object.keys(delta.from)).toEqual(['transactionId', 'inputRevision', 'semanticRevision']);
  expect(delta.contractVersion).toBe('1');
  expect(delta.scope).toBe('fact-set');
  expect(delta.fromFactSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(delta.toFactSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(delta.deltaRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.stringify(buildFactDelta(endpoint(snapshot), endpoint(snapshot)))).toBe(JSON.stringify(delta));

  const raw = buildEngineeringIR(source());
  const lock = {} as LockFile;
  const views = {} as SemanticViewSet;
  if (false) {
    // @ts-expect-error Raw EngineeringIR cannot cross the validated Fact Delta boundary.
    buildFactDelta({ ...endpoint(snapshot), snapshot: raw }, endpoint(snapshot));
    // @ts-expect-error Lock state cannot cross the validated Fact Delta boundary.
    buildFactDelta({ ...endpoint(snapshot), snapshot: lock }, endpoint(snapshot));
    // @ts-expect-error Projection state cannot cross the validated Fact Delta boundary.
    buildFactDelta({ ...endpoint(snapshot), snapshot: views }, endpoint(snapshot));
  }
});

test('canonical digest vectors freeze domains, direction, inclusions, and exclusions', () => {
  const before = buildValidatedEngineeringIR(source());
  const after = buildValidatedEngineeringIR(sourceWithBlock());
  const delta = buildFactDelta(endpoint(before), endpoint(after));

  const expectedFromFactSetDigest = expectedFactSetDigest(before);
  const expectedToFactSetDigest = expectedFactSetDigest(after);
  expect(delta.fromFactSetDigest).toBe(expectedFromFactSetDigest);
  expect(delta.toFactSetDigest).toBe(expectedToFactSetDigest);

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
    added: delta.added.map(factWithoutValidity),
    removed: delta.removed.map(factWithoutValidity),
    changed: delta.changed.map((change) => ({
      factId: change.factId,
      addedAssertions: change.addedAssertions.map(assertionWithoutValidity),
      removedAssertions: change.removedAssertions.map(assertionWithoutValidity),
      updatedAssertions: change.updatedAssertions
    }))
  }));
  expect(delta.deltaRevision).toBe(expectedDeltaRevision);
  expect(buildFactDelta(endpoint(after), endpoint(before)).deltaRevision).not.toBe(delta.deltaRevision);

  const alteredAuditIR = structuredClone(after.ir);
  alteredAuditIR.inputRevision = 'sha256:alternate-non-semantic-input';
  const alteredAudit = forgedSnapshot(alteredAuditIR);
  const originalNoop = buildFactDelta(endpoint(after), endpoint(after));
  const alteredNoop = buildFactDelta(
    {
      ...endpoint(alteredAudit),
      transactionId: 'tx:alternate-before'
    },
    {
      ...endpoint(alteredAudit),
      transactionId: 'tx:alternate-after'
    }
  );
  expect(alteredNoop.deltaRevision).toBe(originalNoop.deltaRevision);

  const reboundValidityIR = structuredClone(after.ir);
  for (const fact of reboundValidityIR.facts) {
    for (const assertion of fact.assertions) assertion.validFromRevision = 'sha256:rebound-endpoint';
  }
  const reboundValidity = forgedSnapshot(reboundValidityIR);
  const validityDelta = buildFactDelta(endpoint(after), endpoint(reboundValidity));
  expect(validityDelta.fromFactSetDigest).toBe(validityDelta.toFactSetDigest);
});

test('stable collision diagnostics remain distinct from ordinary set changes', () => {
  const sourceInput = sourceWithBlock();
  const snapshot = buildValidatedEngineeringIR(sourceInput);

  const revisionCollisionIR = structuredClone(snapshot.ir);
  revisionCollisionIR.entities[0]!.label = 'Forged collision';
  const revisionCollision = forgedSnapshot(revisionCollisionIR);
  expectCompilerError(
    () => buildFactDelta(endpoint(snapshot), endpoint(revisionCollision)),
    'FACT-DELTA-003'
  );

  const factCollisionIR = structuredClone(snapshot.ir);
  factCollisionIR.semanticRevision = 'sha256:forged-fact-collision';
  factCollisionIR.facts[0]!.object = { kind: 'entity', entityId: factCollisionIR.appId };
  const factCollision = forgedSnapshot(factCollisionIR);
  expectCompilerError(
    () => buildFactDelta(endpoint(snapshot), endpoint(factCollision)),
    'FACT-DELTA-004'
  );

  const assertionCollisionIR = structuredClone(snapshot.ir);
  assertionCollisionIR.semanticRevision = 'sha256:forged-assertion-collision';
  assertionCollisionIR.facts[0]!.assertions[0]!.authority = 'observed';
  const assertionCollision = forgedSnapshot(assertionCollisionIR);
  expectCompilerError(
    () => buildFactDelta(endpoint(snapshot), endpoint(assertionCollision)),
    'FACT-DELTA-005'
  );
});
