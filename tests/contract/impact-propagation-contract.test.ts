import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import {
  buildFactDelta,
  buildImpactPropagation,
  type EngineeringIRIndex
} from '../../platform/compiler/index.ts';
import type { CiArtifactManifest } from '../../platform/shared/ci-artifact-types.ts';
import type {
  EngineeringIR,
  FactDeltaEndpointContext,
  SemanticFact,
  ValidatedEngineeringIRSnapshot
} from '../../platform/shared/engineering-ir-types.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import type { ReviewSummary } from '../../platform/shared/review-types.ts';
import {
  IMPACT_CONTRACT_VERSION,
  IMPACT_PROPAGATION_RULE_REVISION,
  IMPACT_SCOPE
} from '../../platform/shared/semantic-impact-types.ts';
import type { SemanticViewSet } from '../../platform/shared/semantic-view-types.ts';
import type { SemanticImpactPropagation as FacadeSemanticImpactPropagation } from '../../platform/shared/types.ts';
import type { VerificationReport } from '../../platform/shared/verification-types.ts';

const FROM_SEMANTIC_REVISION = `sha256:${'1'.repeat(64)}`;
const TO_SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;

function sha256(payload: string): string {
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function dependencyFact(validFromRevision: string): SemanticFact {
  return {
    id: 'fact:B-depends-A',
    subject: 'responsibility:B',
    predicate: 'DEPENDS_ON',
    object: { kind: 'entity', entityId: 'responsibility:A' },
    assertions: [{
      id: 'assertion:B-depends-A',
      authority: 'authoritative',
      confidence: 1,
      provenance: [{ kind: 'contract', sourceId: 'contract:impact-vector' }],
      evidence: [],
      validFromRevision
    }]
  };
}

function vectorSnapshot(
  semanticRevision: string,
  inputRevision: string,
  label: string
): ValidatedEngineeringIRSnapshot {
  return {
    ir: {
      formatVersion: '2',
      graphId: 'graph:impact-contract',
      inputRevision,
      semanticRevision,
      appId: 'app:impact-contract',
      entities: [
        { id: 'app:impact-contract', kind: 'app', label: 'Impact Contract', attributes: [] },
        { id: 'responsibility:A', kind: 'responsibility', label, attributes: [] },
        { id: 'responsibility:B', kind: 'responsibility', label: 'B', attributes: [] }
      ],
      facts: [dependencyFact(semanticRevision)],
      scenarios: []
    }
  } as unknown as ValidatedEngineeringIRSnapshot;
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
  const before = vectorSnapshot(
    FROM_SEMANTIC_REVISION,
    `sha256:input-from-${inputSuffix}`,
    'Before A'
  );
  const after = vectorSnapshot(
    TO_SEMANTIC_REVISION,
    `sha256:input-to-${inputSuffix}`,
    'After A'
  );
  const from = endpoint(before, fromTransaction);
  const to = endpoint(after, toTransaction);
  const delta = buildFactDelta(from, to);
  return { before, after, from, to, delta, result: buildImpactPropagation({ delta, from, to }) };
}

test('public Semantic Impact schema, constants, facade, and exclusions stay frozen', () => {
  const { before, from, to, delta, result } = vector();
  const facadeValue: FacadeSemanticImpactPropagation = result;

  expect(IMPACT_CONTRACT_VERSION).toBe('1');
  expect(IMPACT_SCOPE).toBe('fact-delta+validated-graph');
  expect(IMPACT_PROPAGATION_RULE_REVISION).toBe('impact-propagation-rules-v1');
  expect(Object.keys(facadeValue)).toEqual([
    'contractVersion',
    'scope',
    'formatVersion',
    'graphId',
    'appId',
    'deltaRevision',
    'fromSemanticRevision',
    'toSemanticRevision',
    'fromFactSetDigest',
    'toFactSetDigest',
    'propagationRuleRevision',
    'seeds',
    'direct',
    'transitive',
    'uncertainties',
    'verification',
    'impactRevision'
  ]);
  expect(result.impactRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.stringify(buildImpactPropagation({ delta, from, to }))).toBe(JSON.stringify(result));

  const raw: EngineeringIR = before.ir;
  const callerIndex = {} as EngineeringIRIndex;
  const lock = {} as LockFile;
  const views = {} as SemanticViewSet;
  const review = {} as ReviewSummary;
  const artifact = {} as CiArtifactManifest;
  const verification = {} as VerificationReport;
  const expectation = {} as { readonly expectedFactIds: readonly string[] };
  if (false) {
    // @ts-expect-error Raw EngineeringIR cannot cross the validated Impact boundary.
    buildImpactPropagation({ delta, from: { ...from, snapshot: raw }, to });
    // @ts-expect-error Caller-provided indexes are not part of the public Impact input.
    buildImpactPropagation({ delta, from, to, fromIndex: callerIndex });
    // @ts-expect-error Lock state cannot replace canonical Fact Delta.
    buildImpactPropagation({ delta: lock, from, to });
    // @ts-expect-error Projection state cannot replace canonical Fact Delta.
    buildImpactPropagation({ delta: views, from, to });
    // @ts-expect-error ReviewSummary cannot replace canonical Fact Delta.
    buildImpactPropagation({ delta: review, from, to });
    // @ts-expect-error Artifact manifests cannot replace canonical Fact Delta.
    buildImpactPropagation({ delta: artifact, from, to });
    // @ts-expect-error Expected mutation delta cannot replace actual canonical Fact Delta.
    buildImpactPropagation({ delta: expectation, from, to });
    // @ts-expect-error Verification reports cannot replace canonical Fact Delta.
    buildImpactPropagation({ delta: verification, from, to });
  }
});

test('independent vector freezes seeds, reachability, path evidence, and impactRevision', () => {
  const { delta, result } = vector();
  const fromSeedId = sha256(JSON.stringify({
    domain: 'engineering-ir-impact-seed-v1',
    kind: 'entity-updated',
    basis: 'from',
    entityId: 'responsibility:A'
  }));
  const toSeedId = sha256(JSON.stringify({
    domain: 'engineering-ir-impact-seed-v1',
    kind: 'entity-updated',
    basis: 'to',
    entityId: 'responsibility:A'
  }));
  const expectedSeeds = [
    {
      id: fromSeedId,
      kind: 'entity-updated',
      basis: 'from',
      entityId: 'responsibility:A',
      anchorEntityId: 'responsibility:A',
      changedFields: ['label']
    },
    {
      id: toSeedId,
      kind: 'entity-updated',
      basis: 'to',
      entityId: 'responsibility:A',
      anchorEntityId: 'responsibility:A',
      changedFields: ['label']
    }
  ] as const;
  const pathStep = {
    factId: 'fact:B-depends-A',
    predicate: 'DEPENDS_ON',
    ruleVariantId: 'impact.depends-on.object-to-subject.v1',
    direction: 'object-to-subject',
    fromEntityId: 'responsibility:A',
    toEntityId: 'responsibility:B'
  } as const;
  const expectedDirect = [
    {
      basis: 'from',
      entityId: 'responsibility:B',
      level: 'direct',
      distance: 1,
      seedIds: [fromSeedId],
      canonicalPath: [pathStep]
    },
    {
      basis: 'to',
      entityId: 'responsibility:B',
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

  const expectedRevision = sha256(JSON.stringify({
    domain: 'engineering-ir-impact-propagation-v1',
    contractVersion: '1',
    scope: 'fact-delta+validated-graph',
    formatVersion: '2',
    graphId: 'graph:impact-contract',
    appId: 'app:impact-contract',
    deltaRevision: delta.deltaRevision,
    from: {
      semanticRevision: FROM_SEMANTIC_REVISION,
      factSetDigest: delta.fromFactSetDigest
    },
    to: {
      semanticRevision: TO_SEMANTIC_REVISION,
      factSetDigest: delta.toFactSetDigest
    },
    propagationRuleRevision: 'impact-propagation-rules-v1',
    seeds: expectedSeeds,
    direct: expectedDirect,
    transitive: [],
    uncertainties: [],
    verification: []
  }));
  expect(result.impactRevision).toBe(expectedRevision);
});

test('transaction and input audit fields stay excluded from impactRevision', () => {
  const original = vector('tx:original-from', 'tx:original-to', 'original').result;
  const alternate = vector('tx:alternate-from', 'tx:alternate-to', 'alternate').result;

  expect(alternate.fromSemanticRevision).toBe(original.fromSemanticRevision);
  expect(alternate.toSemanticRevision).toBe(original.toSemanticRevision);
  expect(alternate.deltaRevision).toBe(original.deltaRevision);
  expect(alternate.impactRevision).toBe(original.impactRevision);
});
