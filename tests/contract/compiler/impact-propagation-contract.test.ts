import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { buildEngineeringIR } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';

import { sha256 } from '../../../src/contracts/canonical.ts';

import { buildFactDelta } from '../../../src/compiler/ir/build-fact-delta.ts';
import { buildImpactPropagation } from '../../../src/compiler/semantic-impact/build-impact-propagation.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import type { SemanticFact } from '../../../src/semantics/engineering-ir/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../src/semantics/engineering-ir/validated-types.ts';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const FACT_ID = `fact:${hash('responsibility:impact:B\0DEPENDS_ON\0entity:responsibility:impact:A').slice(0, 24)}`;
const PROVENANCE = [{ kind: 'contract' as const, sourceId: 'contract:impact-vector' }];

function vectorSnapshot(inputName: string, label: string): ValidatedEngineeringIRSnapshot {
  const input = { app: { id: 'impact-contract', name: inputName },
    resolvedBlocks: [], manifests: [], acceptanceIds: [], policyDeclarations: [] };
  const ir = buildEngineeringIR(input);
  // Cached IR admission binds the input digest separately from semantic material.
  // Keep the semantic label fixed while varying the source/audit coordinate.
  ir.entities = [
    { id: 'app:impact-contract', kind: 'app', label: 'Impact Contract', attributes: [] },
    { id: 'responsibility:impact:A', kind: 'responsibility', label, attributes: [] },
    { id: 'responsibility:impact:B', kind: 'responsibility', label: 'B', attributes: [] }
  ];
  const fact: SemanticFact = {
    id: FACT_ID, subject: 'responsibility:impact:B', predicate: 'DEPENDS_ON',
    object: { kind: 'entity', entityId: 'responsibility:impact:A' },
    assertions: [{
      id: `assertion:${hash([FACT_ID, 'authoritative', JSON.stringify(PROVENANCE)].join('\0')).slice(0, 24)}`,
      authority: 'authoritative', confidence: 1, provenance: PROVENANCE,
      evidence: [], validFromRevision: 'pending'
    }]
  };
  ir.facts = [fact];
  // Independent wire preimage, not the production revision-payload helper.
  ir.semanticRevision = `sha256:${hash(JSON.stringify({
    formatVersion: '2', graphId: 'engineering-ir:impact-contract', appId: 'app:impact-contract',
    entities: ir.entities,
    facts: [{ ...fact, assertions: fact.assertions.map(({ validFromRevision: _revision, ...claim }) => claim) }],
    scenarios: []
  }))}`;
  fact.assertions[0]!.validFromRevision = ir.semanticRevision;
  return validateEngineeringIR(ir, input);
}

function endpoint(
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

function vector(
  fromTransaction = 'tx:from',
  toTransaction = 'tx:to',
  inputSuffix = 'original'
) {
  const before = vectorSnapshot(`input-from-${inputSuffix}`, 'Before A');
  const after = vectorSnapshot(`input-to-${inputSuffix}`, 'After A');
  const from = endpoint(before, fromTransaction);
  const to = endpoint(after, toTransaction);
  const delta = buildFactDelta(from, to);
  return { before, after, from, to, delta, result: buildImpactPropagation({ delta, from, to }) };
}

test('independent impact vector binds propagation evidence while excluding audit coordinates', () => {
  const { before, after, delta, result } = vector();
  const fromSeedId = sha256({
    domain: 'engineering-ir-impact-seed-v1',
    kind: 'entity-updated',
    basis: 'from',
    entityId: 'responsibility:impact:A'
  });
  const toSeedId = sha256({
    domain: 'engineering-ir-impact-seed-v1',
    kind: 'entity-updated',
    basis: 'to',
    entityId: 'responsibility:impact:A'
  });
  const expectedSeeds = [
    {
      id: fromSeedId,
      kind: 'entity-updated',
      basis: 'from',
      entityId: 'responsibility:impact:A',
      anchorEntityId: 'responsibility:impact:A',
      changedFields: ['label']
    },
    {
      id: toSeedId,
      kind: 'entity-updated',
      basis: 'to',
      entityId: 'responsibility:impact:A',
      anchorEntityId: 'responsibility:impact:A',
      changedFields: ['label']
    }
  ] as const;
  const pathStep = {
    factId: FACT_ID,
    predicate: 'DEPENDS_ON',
    ruleVariantId: 'impact.depends-on.object-to-subject.v1',
    direction: 'object-to-subject',
    fromEntityId: 'responsibility:impact:A',
    toEntityId: 'responsibility:impact:B'
  } as const;
  const expectedDirect = [
    {
      basis: 'from',
      entityId: 'responsibility:impact:B',
      level: 'direct',
      distance: 1,
      seedIds: [fromSeedId],
      canonicalPath: [pathStep]
    },
    {
      basis: 'to',
      entityId: 'responsibility:impact:B',
      level: 'direct',
      distance: 1,
      seedIds: [toSeedId],
      canonicalPath: [pathStep]
    }
  ] as const;

  expect(result.seeds).toEqual(expectedSeeds);
  expect(result.direct).toEqual(expectedDirect);
  expect(result.transitive).toEqual([]);
  expect(result.uncertainties).toEqual([]);
  expect(result.verification).toEqual([]);

  const expectedRevision = sha256({
    domain: 'engineering-ir-impact-propagation-v1',
    contractVersion: '1',
    scope: 'fact-delta+validated-graph',
    formatVersion: '2',
    graphId: 'engineering-ir:impact-contract',
    appId: 'app:impact-contract',
    deltaRevision: delta.deltaRevision,
    from: {
      semanticRevision: before.ir.semanticRevision,
      factSetDigest: delta.fromFactSetDigest
    },
    to: {
      semanticRevision: after.ir.semanticRevision,
      factSetDigest: delta.toFactSetDigest
    },
    propagationRuleRevision: 'impact-propagation-rules-v1',
    seeds: expectedSeeds,
    direct: expectedDirect,
    transitive: [],
    uncertainties: [],
    verification: []
  });
  expect(result.impactRevision).toBe(expectedRevision);
  const alternateVector = vector('tx:alternate-from', 'tx:alternate-to', 'alternate');
  expect(alternateVector.before.ir.inputRevision).not.toBe(before.ir.inputRevision);
  expect(alternateVector.after.ir.inputRevision).not.toBe(after.ir.inputRevision);
  const alternate = alternateVector.result;

  expect(alternate.fromSemanticRevision).toBe(result.fromSemanticRevision);
  expect(alternate.toSemanticRevision).toBe(result.toSemanticRevision);
  expect(alternate.deltaRevision).toBe(result.deltaRevision);
  expect(alternate.impactRevision).toBe(result.impactRevision);
});
