import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  compileSourceProgramAuditOperation,
  compileSourceProgramAuditOperationInput,
  compileSourceProgramAuditSourceProgramProjection,
  encodeSourceProgramAuditOperationInput,
  encodeSourceProgramAuditOperationResult,
  parseSourceProgramAuditOperationInput,
  parseSourceProgramAuditOperationResult,
  type CompileSourceProgramAuditOperationInput
} from '../../src/adapters/repository/repository-audit/source-program-audit-operation.ts';
import type { SourceProgramModel } from '../../src/adapters/repository/source-program-model/contract.ts';
import { compileSourceProgramFindingDelta } from '../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import { captureRepositoryAnalysisPolicy } from '../../src/adapters/repository/source-program-model/repository-analysis-policy.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';

const digest = (value: unknown): `sha256:${string}` => sha256(value) as `sha256:${string}`;

/** Synthetic data for the pure projection boundary, not a compiler-issued receipt. */
function model(): SourceProgramModel {
  const span = { start: 0, end: 4, startLine: 0, endLine: 0, startColumn: 0, endColumn: 4 };
  return {
    sourceRevision: digest('source'), modelDigest: digest('model'), providers: [],
    files: [{ path: 'src/domain.ts', contentDigest: rawSha256('work()'), moduleId: 'domain',
      surface: 'production', semanticKind: 'executable', semanticObservationClass: 'observed' }],
    declarations: [], references: [], returnProvenances: [], literals: [], entrypoints: [],
    entrypointClosures: [], packages: [], dependencies: [], candidates: [], unknowns: [],
    capabilities: [{ observationId: digest('call'), path: 'src/domain.ts', moduleId: 'domain',
      surface: 'production', capability: 'filesystem', operation: 'readFile', subject: null,
      transport: 'native-runtime', moduleSpecifier: 'node:fs/promises', providerCapability: null,
      providerModuleId: null, owningDeclarationObservationId: null, observationClass: 'observed', span }]
  };
}

function input(full = false): CompileSourceProgramAuditOperationInput {
  const source = model();
  const sourceRevision = source.sourceRevision;
  const modelDigest = source.modelDigest;
  const testCompilationDigest = digest('tests');
  const supersessionReceiptDigest = digest('supersession');
  const receiptDigest = digest('compilation');
  const baselineDigest = sha256([]);
  const baselineEvidenceDigest = digest('baseline-evidence');
  const sourceFileIdentities = source.files.map(({ path, contentDigest }) => ({ path, contentDigest }));
  const before = { sourceRevision: digest('before'), modelDigest: digest('before-model'), compilationReceiptDigest: digest('before-receipt') };
  const after = { sourceRevision, modelDigest, compilationReceiptDigest: receiptDigest };
  type FindingSnapshot = Parameters<typeof compileSourceProgramFindingDelta>[0];
  const findingSnapshot = (revision: string, digestValue: string): FindingSnapshot => ({
    analysisPolicy: captureRepositoryAnalysisPolicy([]),
    sourceRevision: revision,
    moduleMembershipDigest: digest('membership'),
    workspaceSnapshot: { files: sourceFileIdentities },
    projectGeneration: {
      compilerRevision: digest('compiler'), providerRevision: digest('provider'),
      compilerConfigDigest: digest('config'), dependencyGenerationDigest: digest('dependency'),
      environmentDigest: digest('environment'), projectConfigDigest: null
    },
    model: { ...source, sourceRevision: revision, modelDigest: digestValue }
  }) as unknown as FindingSnapshot;
  const findingDelta = compileSourceProgramFindingDelta(
    findingSnapshot(before.sourceRevision, before.modelDigest),
    findingSnapshot(sourceRevision, modelDigest)
  );
  const cost = { productionUnits: 0, testUnits: 0, owners: 0, unresolvedObservations: 0, unobservedTestRisk: 0 };
  return {
    sourceProgram: compileSourceProgramAuditSourceProgramProjection(source, sourceFileIdentities, false),
    sourceFileIdentities,
    moduleArchitecture: {
      ownerEdges: [], strongComponents: [], fileStrongComponents: [], reciprocalPairs: [], feedbackCuts: [],
      aggregateFacadePaths: [], unresolvedAggregateSurfacePaths: [], nodeResponsibilities: [], violations: []
    },
    sourceProgramCompilation: { subjectDigest: digest('subject'), snapshotDigest: digest('snapshot'), moduleGraphDigest: digest('graph'), receiptDigest },
    declarationTopology: { compilationReceiptDigest: receiptDigest, sourceRevision, modelDigest,
      declarations: [], edges: [], strongComponents: [], unknowns: [], topologyDigest: digest('topology') },
    cache: 'miss', invalidatedTypeScriptPaths: [],
    implementationDominance: { sourceRevision, sourceProgramModelDigest: modelDigest, units: [], findings: [], compilationDigest: digest('dominance') },
    reconciliation: { status: 'resolved', before, after, changes: [], findingDelta, frontiers: [], providerEvidence: [], unresolvedReasons: [], projectionDigest: digest('reconciliation') },
    architectureEvolution: { status: 'no-change', direction: 'neutral',
      before: { ...before, architectureDigest: digest('before-architecture') },
      after: { ...after, architectureDigest: digest('architecture') },
      reconciliationProjectionDigest: digest('reconciliation'), changes: [], changedPaths: [], consumerPaths: [],
      retirementPaths: [], graphDelta: {}, blockers: [], referenceDigest: digest('evolution') },
    testValue: { sourceRevision, baselineTestPaths: [], baselineDigest, baselineEvidenceDigest, compilationDigest: testCompilationDigest,
      candidateRegistrationCensus: { count: 0, digest: digest('census'), paths: [] }, recordsWithUnknownSemantics: 0, semanticClasses: {} },
    testDisposition: { sourceRevision, baselineTestPaths: [], baselineDigest, baselineEvidenceDigest, dispositions: [], findings: [],
      observationCompilationDigest: testCompilationDigest, supersessionReceiptDigest: null, projectionDigest: digest('disposition') },
    blockingCandidates: [], blockingTestFindings: [], unknownDispositionClusters: [],
    topology: { packages: 0, dependencyScopes: {}, entrypointKinds: {}, entrypointRoles: {}, entrypointHandlerModules: {}, entrypointObservationClasses: {},
      capabilityKinds: {}, capabilityTransports: {}, capabilityAuthorityClasses: { 'repository-provider': 0, 'runtime-built-in-api': 0, 'external-package-api': 0, 'unresolved-transport': 0 },
      providerModules: {}, candidateCodes: {}, unknownCodes: {}, directProcessTransportPaths: 0 },
    supersession: { status: 'equivalent', baseline: { ...before, testCompilationDigest: digest('before-tests'), intentEvidenceDigest: digest('before-intent') },
      current: { sourceRevision, modelDigest, testCompilationDigest, intentEvidenceDigest: digest('intent') },
      lifecycleCost: { baseline: cost, current: cost }, replacements: [], findings: [], receiptDigest: supersessionReceiptDigest },
    testRetirement: { baselineSourceRevision: before.sourceRevision, currentSourceRevision: sourceRevision,
      baselineActionKey: digest('before-action'), currentActionKey: digest('action'), baselineTestPathsDigest: baselineDigest,
      baselineRegistrationCensusDigest: digest('before-census'), currentRegistrationCensusDigest: digest('census'),
      currentTestCompilationDigest: testCompilationDigest, supersessionReceiptDigest, proofs: [], receiptDigest: digest('retirement') },
    reduction: { mode: 'none' }, options: {
      blockingDetails: false, blockingDetailsDomain: 'priority', blockingDetailsPage: 0, full, enforce: true,
      includeCandidates: false, queryProjection: null, outputPath: null
    }
  };
}

test('actual source projection joins mechanism findings to the exact file identities', () => {
  const value = input().sourceProgram;
  assert.equal(value.mechanismReview?.counts['module-initialization-effect'], 1);
  assert.equal(value.mechanismReview?.sourceRevision, value.sourceRevision);
  assert.equal(value.mechanismReview?.findings[0]!.sites[0]!.contentDigest, model().files[0]!.contentDigest);
});

test('compact and full audit output share the review digest without altering admission', () => {
  const full = compileSourceProgramAuditOperationInput(input(true));
  const compact = compileSourceProgramAuditOperationInput(input(false));
  const fullReview = full.projection.mechanisms as Record<string, unknown>;
  const compactReview = compact.projection.mechanisms as Record<string, unknown>;
  assert.equal(fullReview.reviewDigest, compactReview.reviewDigest);
  assert.ok(Array.isArray(fullReview.findings));
  assert.equal(Object.hasOwn(compactReview, 'findings'), false);
  assert.deepEqual(full.blockingReasons, []);
  assert.deepEqual(compact.blockingReasons, []);
  assert.equal(compileSourceProgramAuditOperation(full).exitCode, 0);
  assert.equal(compileSourceProgramAuditOperation(compact).exitCode, 0);
});

for (const full of [false, true]) {
  test(`${full ? 'full' : 'compact'} mechanism diagnostics survive the existing bounded wire round trip`, () => {
    const request = compileSourceProgramAuditOperationInput(input(full));
    const bytes = encodeSourceProgramAuditOperationInput(request);
    const parsed = parseSourceProgramAuditOperationInput(bytes, bytes.byteLength);
    const result = compileSourceProgramAuditOperation(parsed);
    const output = encodeSourceProgramAuditOperationResult(result);
    assert.deepEqual(parseSourceProgramAuditOperationResult(output, output.byteLength), result);
    assert.deepEqual(parsed.projection.mechanisms, request.projection.mechanisms);
  });
}

test('mechanism diagnostics cannot suppress existing audit blockers', () => {
  const base = input();
  const result = compileSourceProgramAuditOperationInput({ ...base,
    reconciliation: { ...base.reconciliation, findingDelta: undefined }
  });
  assert.deepEqual(result.blockingReasons, ['finding-reconciliation-unavailable']);
  assert.equal(compileSourceProgramAuditOperation(result).exitCode, 1);
});

test('older parent projections can omit the optional diagnostics without inventing coverage', () => {
  const base = input();
  const { mechanismReview: _removed, ...oldProjection } = base.sourceProgram;
  const result = compileSourceProgramAuditOperationInput({ ...base, sourceProgram: oldProjection });
  assert.equal(Object.hasOwn(result.projection, 'mechanisms'), false);
});

for (const field of ['sourceRevision', 'modelDigest', 'coverage'] as const) {
  test(`rejects a mechanism projection with a mismatched ${field}`, () => {
    const base = input();
    const review = base.sourceProgram.mechanismReview!;
    const altered = field === 'coverage' ? { ...review, coverage: { ...review.coverage, files: 99 } }
      : { ...review, [field]: digest('foreign') };
    assert.throws(() => compileSourceProgramAuditOperationInput({ ...base,
      sourceProgram: { ...base.sourceProgram, mechanismReview: altered }
    }), /Mechanism review is not bound/);
  });
}
