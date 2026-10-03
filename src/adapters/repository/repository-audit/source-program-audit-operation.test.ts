import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';

import { syntheticTestFindingComparison } from '../../../../tests/testkit/source-program-test-finding-fixture.ts';

import { canonicalJson, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan, issueSecSemanticOperationAttemptContext } from '../../../execution/operation/semantic.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { SOURCE_PROGRAM_TEST_OBLIGATIONS_NOT_REQUESTED, type SourceProgramModel } from '../source-program-model/contract.ts';
import { compileVirtualRepositorySourceProgramCompilation, compileVirtualRepositorySourceProgramTestObligationsCompilation } from '../source-program-model/repository-compilation.ts';
import { querySourceProgramModel } from '../source-program-model/typescript.ts';
import { compileVirtualWorkspaceSourceSnapshot } from '../source-program-model/workspace-source-snapshot.ts';
import type { RepositoryAuditLoadedImplementationEvidence } from './loaded-implementation.ts';
import {
  BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES,
  compileSourceProgramAuditAnalyses,
  compileSourceProgramAuditOperation,
  compileSourceProgramAuditOperationInput,
  compileSourceProgramAuditSourceProgramProjection,
  compileSourceProgramAuditTestObligationsSourceProgramProjection,
  compileSourceProgramAuditTestValueProjection,
  encodeSourceProgramAuditOperationInput,
  encodeSourceProgramAuditOperationResult,
  isTestObligationsAuditFacts,
  parseSourceProgramAuditOperationInput,
  parseSourceProgramAuditOperationResult,
  SourceProgramAuditBlockingDetailError,
  type CompileScopedCandidateTestObligationsAuditOperationInput,
  type CompileSourceProgramAuditOperationInput,
  type CompileTestObligationsAuditOperationInput,
  type CompileWholeSourceProgramAuditOperationInput,
  type SourceProgramAuditOperationInput
} from './source-program-audit-operation.ts';

import { compileSourceProgramFindingDelta } from '../source-program-model/reconciliation-findings.ts';
import { compileSourceProgramSupersessionEvidenceIdentity, type SourceProgramSupersessionEvidence } from '../source-program-model/reduction.ts';
import { captureRepositoryAnalysisPolicy } from '../source-program-model/repository-analysis-policy.ts';
import { createSourceProgramTransitionAssessment, parseSourceProgramTransitionAssessment } from './transition.ts';
import {
  compileRepositoryAuditWorkerHandshakeCandidate,
  compileRepositoryAuditWorkerRequest,
  compileRepositoryAuditWorkerResultCandidate,
  encodeRepositoryAuditWorkerCandidateStream,
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS
} from './worker-protocol.ts';

const digest = (value: unknown): `sha256:${string}` => sha256(value) as `sha256:${string}`;

function input(
  currentCandidates: SourceProgramModel['candidates'] = Object.freeze([]),
  baselineCandidates: SourceProgramModel['candidates'] = Object.freeze([]),
  includeMechanismReview = true
): CompileWholeSourceProgramAuditOperationInput {
  const sourceRevision = digest('source');
  const modelDigest = digest('model');
  const beforeSourceRevision = digest('before-source');
  const beforeModelDigest = digest('before-model');
  const testCompilationDigest = digest('test-compilation');
  const supersessionReceiptDigest = digest('supersession');
  const reconciliationProjectionDigest = digest('reconciliation');
  // Parent-normalized fixture identity, not owner-issued baseline Evidence.
  const baselineEvidenceDigest = digest('baseline-evidence-fixture');
  const sourcePath = 'src/domain.ts';
  const source = 'export const domain = true;\n';
  const contentDigest = rawSha256(source);
  const model: SourceProgramModel = Object.freeze({
    sourceRevision,
    providers: Object.freeze([]),
    files: Object.freeze([Object.freeze({
      path: sourcePath,
      contentDigest,
      moduleId: 'domain',
      surface: 'production' as const,
      semanticKind: 'executable' as const,
      semanticObservationClass: 'observed' as const
    })]),
    declarations: Object.freeze([]),
    references: Object.freeze([]),
    returnProvenances: Object.freeze([]),
    literals: Object.freeze([]),
    entrypoints: Object.freeze([]),
    entrypointClosures: Object.freeze([]),
    packages: Object.freeze([]),
    dependencies: Object.freeze([]),
    capabilities: Object.freeze([]),
    candidates: Object.freeze([...currentCandidates]),
    unknowns: Object.freeze([]),
    modelDigest
  });
  const sourceFileIdentities = Object.freeze([Object.freeze({
    path: sourcePath,
    contentDigest
  })]);
  type FindingSnapshot = Parameters<typeof compileSourceProgramFindingDelta>[0];
  const projectGeneration = Object.freeze({
    compilerRevision: digest('compiler'),
    providerRevision: digest('provider'),
    compilerConfigDigest: digest('configuration'),
    dependencyGenerationDigest: digest('dependency'),
    environmentDigest: digest('environment'),
    projectConfigDigest: null
  });
  const findingSnapshot = (
    snapshotSourceRevision: string,
    snapshotModelDigest: string,
    candidates: SourceProgramModel['candidates']
  ): FindingSnapshot => ({
    analysisPolicy: captureRepositoryAnalysisPolicy([]),
    sourceRevision: snapshotSourceRevision,
    moduleMembershipDigest: digest('membership'),
    workspaceSnapshot: { files: sourceFileIdentities },
    projectGeneration,
    model: {
      ...model,
      sourceRevision: snapshotSourceRevision,
      modelDigest: snapshotModelDigest,
      candidates
    }
  }) as unknown as FindingSnapshot;
  const findingDelta = compileSourceProgramFindingDelta(
    findingSnapshot(beforeSourceRevision, beforeModelDigest, baselineCandidates),
    findingSnapshot(sourceRevision, modelDigest, currentCandidates)
  );
  const testValue = Object.freeze({
    sourceRevision,
    baselineTestPaths: Object.freeze([]),
    baselineDigest: sha256([]),
    baselineEvidenceDigest,
    dispositions: Object.freeze([]),
    records: Object.freeze([]),
    findings: Object.freeze([]),
    definitionInputs: Object.freeze([]),
    definitionContext: null,
    compilationDigest: testCompilationDigest
  });
  const facts: CompileSourceProgramAuditOperationInput = Object.freeze({
    sourceProgram: compileSourceProgramAuditSourceProgramProjection(
      model,
      sourceFileIdentities,
      false,
      false,
      includeMechanismReview
    ),
    sourceFileIdentities,
    moduleArchitecture: Object.freeze({
      ownerEdges: Object.freeze([]),
      strongComponents: Object.freeze([]),
      fileStrongComponents: Object.freeze([]),
      reciprocalPairs: Object.freeze([]),
      feedbackCuts: Object.freeze([]),
      aggregateFacadePaths: Object.freeze([]),
      unresolvedAggregateSurfacePaths: Object.freeze([]),
      nodeResponsibilities: Object.freeze([]),
      violations: Object.freeze([])
    }),
    sourceProgramCompilation: Object.freeze({
      subjectDigest: digest('subject'),
      snapshotDigest: digest('snapshot'),
      moduleGraphDigest: digest('module-graph'),
      receiptDigest: digest('compilation')
    }),
    declarationTopology: Object.freeze({
      compilationReceiptDigest: digest('compilation'),
      sourceRevision,
      modelDigest,
      declarations: Object.freeze([]),
      edges: Object.freeze([]),
      strongComponents: Object.freeze([]),
      unknowns: Object.freeze([]),
      topologyDigest: digest('topology')
    }),
    cache: 'hit',
    invalidatedTypeScriptPaths: Object.freeze([]),
    implementationDominance: Object.freeze({
      sourceRevision,
      sourceProgramModelDigest: modelDigest,
      units: Object.freeze([]),
      findings: Object.freeze([]),
      compilationDigest: digest('dominance')
    }),
    reconciliation: Object.freeze({
      status: 'resolved',
      before: Object.freeze({
        sourceRevision: beforeSourceRevision,
        modelDigest: beforeModelDigest,
        compilationReceiptDigest: digest('before-compilation')
      }),
      after: Object.freeze({
        sourceRevision,
        modelDigest,
        compilationReceiptDigest: digest('compilation')
      }),
      changes: Object.freeze([]),
      findingDelta,
      frontiers: Object.freeze([]),
      providerEvidence: Object.freeze([]),
      unresolvedReasons: Object.freeze([]),
      projectionDigest: reconciliationProjectionDigest
    }),
    architectureEvolution: Object.freeze({
      status: 'no-change',
      direction: 'neutral',
      before: Object.freeze({
        sourceRevision: digest('before-source'),
        modelDigest: digest('before-model'),
        architectureDigest: digest('before-architecture')
      }),
      after: Object.freeze({
        sourceRevision,
        modelDigest,
        architectureDigest: digest('architecture')
      }),
      reconciliationProjectionDigest,
      changes: Object.freeze([]),
      changedPaths: Object.freeze([]),
      consumerPaths: Object.freeze([]),
      retirementPaths: Object.freeze([]),
      graphDelta: Object.freeze({
        addedOwnerEdges: Object.freeze([]),
        removedOwnerEdges: Object.freeze([]),
        addedOwnerEdgeWitnesses: Object.freeze([]),
        removedOwnerEdgeWitnesses: Object.freeze([]),
        addedReciprocalPairs: Object.freeze([]),
        removedReciprocalPairs: Object.freeze([]),
        addedStrongComponents: Object.freeze([]),
        removedStrongComponents: Object.freeze([]),
        addedOwnerCycleRelations: Object.freeze([]),
        removedOwnerCycleRelations: Object.freeze([]),
        addedFileCycleRelations: Object.freeze([]),
        removedFileCycleRelations: Object.freeze([]),
        addedCyclicEdgeWitnesses: Object.freeze([]),
        removedCyclicEdgeWitnesses: Object.freeze([]),
        expandedCyclicStructuralEdges: Object.freeze([]),
        contractedCyclicStructuralEdges: Object.freeze([]),
        addedFeedbackCuts: Object.freeze([]),
        removedFeedbackCuts: Object.freeze([]),
        addedViolations: Object.freeze([]),
        removedViolations: Object.freeze([]),
        addedAggregateFacades: Object.freeze([]),
        removedAggregateFacades: Object.freeze([]),
        addedUnresolvedSurfaces: Object.freeze([]),
        removedUnresolvedSurfaces: Object.freeze([])
      }),
      blockers: Object.freeze([]),
      referenceDigest: digest('architecture-evolution')
    }),
    testValue: compileSourceProgramAuditTestValueProjection(testValue, false),
    testDisposition: Object.freeze({
      sourceRevision,
      baselineTestPaths: Object.freeze([]),
      baselineDigest: sha256([]),
      baselineEvidenceDigest,
      dispositions: Object.freeze([]),
      findings: Object.freeze([]),
      observationCompilationDigest: testCompilationDigest,
      supersessionReceiptDigest: null,
      projectionDigest: digest('test-disposition')
    }),
    blockingCandidates: Object.freeze([...currentCandidates]),
    blockingTestFindings: Object.freeze([]),
    unknownDispositionClusters: Object.freeze([]),
    topology: Object.freeze({
      packages: 0,
      dependencyScopes: Object.freeze({}),
      entrypointKinds: Object.freeze({}),
      entrypointRoles: Object.freeze({}),
      entrypointHandlerModules: Object.freeze({}),
      entrypointObservationClasses: Object.freeze({}),
      capabilityKinds: Object.freeze({}),
      capabilityTransports: Object.freeze({}),
      capabilityAuthorityClasses: Object.freeze({
        'repository-provider': 0,
        'runtime-built-in-api': 0,
        'external-package-api': 0,
        'unresolved-transport': 0
      }),
      providerModules: Object.freeze({}),
      candidateCodes: Object.freeze({}),
      unknownCodes: Object.freeze({}),
      directProcessTransportPaths: 0
    }),
    supersession: Object.freeze({
      authorityScope: 'whole-program' as const,
      status: 'equivalent',
      baseline: Object.freeze({
        sourceRevision: digest('before-source'),
        modelDigest: digest('before-model'),
        testCompilationDigest: digest('before-tests'),
        intentEvidenceDigest: digest('before-intent')
      }),
      current: Object.freeze({
        sourceRevision,
        modelDigest,
        testCompilationDigest,
        intentEvidenceDigest: digest('intent')
      }),
      lifecycleCost: Object.freeze({
        baseline: Object.freeze({
          productionUnits: 0,
          testUnits: 0,
          owners: 0,
          unresolvedObservations: 0,
          unobservedTestRisk: 0
        }),
        current: Object.freeze({
          productionUnits: 0,
          testUnits: 0,
          owners: 0,
          unresolvedObservations: 0,
          unobservedTestRisk: 0
        })
      }),
      replacements: Object.freeze([]),
      findings: Object.freeze([]),
      receiptDigest: supersessionReceiptDigest
    }),
    testRetirement: Object.freeze({
      baselineSourceRevision: digest('before-source'),
      currentSourceRevision: sourceRevision,
      baselineActionKey: digest('before-action'),
      currentActionKey: digest('action'),
      baselineTestPathsDigest: sha256([]),
      baselineRegistrationCensusDigest: digest('before-census'),
      currentRegistrationCensusDigest: digest('current-census'),
      currentTestCompilationDigest: testCompilationDigest,
      supersessionReceiptDigest,
      proofs: Object.freeze([]),
      receiptDigest: digest('test-retirement')
    }),
    reduction: Object.freeze({ mode: 'none' }),
    options: Object.freeze({
      blockingDetails: false,
      blockingDetailsDomain: 'priority',
      blockingDetailsPage: 0,
      full: false,
      enforce: true,
      includeCandidates: false,
      queryProjection: null,
      outputPath: null
    })
  });
  return Object.freeze({ ...facts, ...syntheticTestFindingComparison(facts) });
}

function sourceProgramWithOneUnknown(
  sourceProgram: CompileWholeSourceProgramAuditOperationInput['sourceProgram']
): CompileWholeSourceProgramAuditOperationInput['sourceProgram'] {
  const observation = Object.freeze({ reason: 'unresolved-observation' });
  return Object.freeze({
    ...sourceProgram,
    unknownDigests: Object.freeze([sha256(observation)]),
    unknownsDigest: sha256([observation]),
    counts: Object.freeze({ ...sourceProgram.counts, unknowns: 1 })
  });
}

describe('Source Program audit domain operation', () => {
  test('canonical wire codecs reject unknown input fields and changed result bytes', () => {
    const canonical = compileSourceProgramAuditOperationInput(input());
    const encodedInput = encodeSourceProgramAuditOperationInput(canonical);
    const parsedInput = parseSourceProgramAuditOperationInput(
      encodedInput,
      encodedInput.byteLength
    );
    const result = compileSourceProgramAuditOperation(parsedInput);
    const encodedResult = encodeSourceProgramAuditOperationResult(result);

    assert.deepEqual(parseSourceProgramAuditOperationResult(
      encodedResult,
      encodedResult.byteLength
    ), result);
    const unknownInput = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(encodedInput).toString('utf8')),
      transportAuthority: true
    }));
    assert.throws(() => parseSourceProgramAuditOperationInput(
      unknownInput,
      unknownInput.byteLength
    ), /unsupported root key/u);
    const changedResult = Buffer.from(encodedResult);
    changedResult[changedResult.byteLength - 2] ^= 1;
    assert.throws(() => parseSourceProgramAuditOperationResult(
      changedResult,
      changedResult.byteLength
    ));
    assert.throws(() => compileSourceProgramAuditOperationInput({
      ...input(),
      options: { ...input().options, blockingDetailsDomain: 'foreign' }
    } as unknown as CompileSourceProgramAuditOperationInput), /Unsupported Repository Audit blocking-detail domain/u);
  });

  test('is deterministic and excludes unknown caller properties from its result identity', () => {
    const canonical = compileSourceProgramAuditOperationInput(input());
    const withUnknown = Object.freeze({ ...canonical, futureTransportHint: 'ignored' });
    const first = compileSourceProgramAuditOperation(canonical);
    const second = compileSourceProgramAuditOperation(
      withUnknown as SourceProgramAuditOperationInput
    );
    const serialized = compileSourceProgramAuditOperation(
      JSON.parse(JSON.stringify(canonical)) as SourceProgramAuditOperationInput
    );

    assert.deepEqual(first, second);
    assert.deepEqual(serialized, first);
    assert.equal(first.exitCode, 0);
    assert.equal(first.reductionPatch, null);
  });

  test('projects parent-issued query facts and candidate observations without a compiler import', () => {
    const facts = input();
    const queryProjection = Object.freeze({ query: 'domain', declarations: Object.freeze([]) });
    const projected = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      options: Object.freeze({
        ...facts.options,
        full: true,
        includeCandidates: true,
        queryProjection
      })
    })));

    assert.equal(projected.projection.result, queryProjection);
    assert.deepEqual(projected.projection.candidates, []);
    assert.deepEqual(projected.projection.architecture, {
      feedbackProjections: [],
      reciprocalPairs: [],
      strongComponents: [],
      violations: []
    });
  });

  test('uses one reduction discriminant and returns the parent-issued patch candidate', () => {
    const facts = input();
    const planDigest = digest('version-plan');
    const patch = Object.freeze({
      sourceRevision: facts.sourceProgram.sourceRevision,
      planDigest,
      patchDigest: digest('version-patch'),
      patch: 'diff --git a/src/domain.ts b/src/domain.ts\n',
      files: Object.freeze([Object.freeze({
        path: 'src/domain.ts',
        beforeDigest: facts.sourceFileIdentities[0]!.contentDigest,
        afterDigest: digest('after')
      })])
    });
    const result = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      reduction: Object.freeze({
        mode: 'version' as const,
        plan: Object.freeze({
          sourceRevision: facts.sourceProgram.sourceRevision,
          planDigest,
          reductions: Object.freeze([])
        }),
        patch
      })
    })));

    assert.equal(result.reductionPatch, patch);
    assert.deepEqual(result.projection.versionReductionPlan, {
      sourceRevision: facts.sourceProgram.sourceRevision,
      planDigest,
      ready: 0,
      blocked: 0,
      locations: 0,
      patchDigest: patch.patchDigest,
      changedFiles: 1,
      outputPath: null,
      blockedReductions: []
    });
    assert.throws(() => compileSourceProgramAuditOperationInput({
      ...facts,
      reduction: { mode: 'version+graph-cut' }
    } as unknown as CompileSourceProgramAuditOperationInput), /Unsupported Source Program audit reduction mode/u);
  });

  test('enforce blocks introduced findings while persistent inventory remains diagnostic', () => {
    const blocker = Object.freeze({
      code: 'direct-process-transport-outside-owner' as const,
      subject: 'spawn',
      paths: Object.freeze(['src/domain.ts']),
      reason: 'direct process transport is outside its canonical owner',
      observationClass: 'derived' as const
    });
    const facts = input(Object.freeze([blocker]));
    const blocked = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(facts));
    const diagnosticOnly = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      options: Object.freeze({ ...facts.options, enforce: false })
    })));
    const detailed = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(Object.freeze({
        ...facts,
        options: Object.freeze({ ...facts.options, blockingDetails: true })
      })));
    const persistent = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(input(
        Object.freeze([blocker]),
        Object.freeze([blocker])
      )));

    assert.equal(blocked.exitCode, 1);
    assert.deepEqual(blocked.projection.enforcement, {
      requested: true,
      blockingReasons: ['source-program-finding-regression']
    });
    assert.equal(diagnosticOnly.exitCode, 0);
    assert.equal(persistent.exitCode, 0);
    assert.equal((persistent.projection.summary as { blockingCandidates: number }).blockingCandidates, 1);
    assert.equal((blocked.projection.summary as { blockingCandidates: number }).blockingCandidates, 1);
    assert.deepEqual(detailed.projection.blockingDetails, {
      count: 1,
      digest: sha256([{ category: 'blocking-candidate', record: blocker }]),
      page: 0,
      pageCount: 1,
      pageMaximumBytes: BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES,
      records: [{ category: 'blocking-candidate', record: blocker }]
    });
  });


  test('absolute unknown inventory remains visible without overriding a resolved comparison', () => {
    const facts = input();
    const request = compileSourceProgramAuditOperationInput({ ...facts,
      sourceProgram: sourceProgramWithOneUnknown(facts.sourceProgram)
    });
    assert.ok(!request.blockingReasons.includes('source-program-incomplete'));
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 0);
    assert.equal((request.projection.summary as { unknowns: number }).unknowns, 1);
    assert.throws(() => compileSourceProgramAuditOperationInput({
      ...facts,
      sourceProgram: sourceProgramWithOneUnknown(facts.sourceProgram),
      options: {
        ...facts.options, blockingDetails: true, blockingDetailsDomain: 'source-program'
      }
    }), /not the exact Source Program unknown set/);
  });

  test('enforcement fails closed when the canonical finding comparison is absent', () => {
    const facts = input();
    const { findingDelta: omittedFindingDelta, ...reconciliation } = facts.reconciliation;
    assert.ok(omittedFindingDelta !== undefined);
    const request = compileSourceProgramAuditOperationInput({ ...facts, reconciliation });

    assert.deepEqual(request.blockingReasons, ['finding-reconciliation-unavailable']);
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 1);
  });

  test('missing test finding comparison cannot inherit synthetic codec success', () => {
    const { testFindingDelta: omitted, ...facts } = input();
    assert.ok(omitted !== undefined);
    const request = compileSourceProgramAuditOperationInput(facts);
    assert.deepEqual(request.blockingReasons, ['test-finding-reconciliation-unavailable']);
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 1);
  });

  test('byte pages bind the complete retirement set and survive canonical wire readback', () => {
    const facts = input();
    const proofs = Object.freeze(Array.from({ length: 50 }, (_, index) => Object.freeze({
      status: 'blocked' as const,
      path: `tests/retirement-${index}.test.ts`,
      unknownEvidence: Object.freeze([`${index}:`.padEnd(120_000, 'x')])
    })));
    const compiled = compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      testRetirement: Object.freeze({ ...facts.testRetirement, proofs }),
      options: Object.freeze({
        ...facts.options,
        blockingDetails: true,
        blockingDetailsDomain: 'test-retirement' as const,
        blockingDetailsPage: 1
      })
    }));
    const page = compiled.projection.blockingDetails as Readonly<{
      count: number;
      digest: string;
      page: number;
      pageCount: number;
      pageMaximumBytes: number;
      records: readonly unknown[];
    }>;

    assert.equal(page.count, 50);
    assert.equal(page.digest, sha256(proofs.map((record) => ({
      category: 'blocked-test-retirement-proof', record
    }))));
    assert.equal(page.page, 1);
    assert.equal(page.pageCount, 2);
    assert.ok(page.records.length > 0 && page.records.length < proofs.length);
    assert.equal(page.pageMaximumBytes, BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES);
    const encoded = encodeSourceProgramAuditOperationInput(compiled);
    assert.ok(encoded.byteLength
      < REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes);
    const parsed = parseSourceProgramAuditOperationInput(
      encoded,
      REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes
    );
    assert.deepEqual(
      compileSourceProgramAuditOperation(parsed).projection.blockingDetails,
      page
    );
  });

  test('priority details isolate actionable findings from large unselected domains', () => {
    const facts = input();
    const blocker = Object.freeze({
      code: 'direct-process-transport-outside-owner' as const,
      subject: 'spawn',
      paths: Object.freeze(['src/domain.ts']),
      reason: 'direct process transport is outside its canonical owner',
      observationClass: 'derived' as const
    });
    const finding = Object.freeze({
      code: 'test-module-disposition-unknown' as const,
      path: 'tests/domain.test.ts',
      detail: 'unknown disposition',
      span: null,
      disposition: null
    });
    const proofs = Object.freeze(Array.from({ length: 50 }, (_, index) => Object.freeze({
      status: 'blocked' as const,
      unknownEvidence: Object.freeze([`${index}:`.padEnd(120_000, 'x')])
    })));
    const sourceProgram = Object.freeze({
      ...facts.sourceProgram,
      candidateDigests: Object.freeze([sha256(blocker)]),
      counts: Object.freeze({ ...facts.sourceProgram.counts, candidates: 1 })
    });
    const compiled = compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      ...syntheticTestFindingComparison(facts, [finding]),
      sourceProgram,
      blockingCandidates: Object.freeze([blocker]),
      testDisposition: Object.freeze({
        ...facts.testDisposition, findings: Object.freeze([finding])
      }),
      blockingTestFindings: Object.freeze([finding]),
      testRetirement: Object.freeze({ ...facts.testRetirement, proofs }),
      options: Object.freeze({ ...facts.options, blockingDetails: true })
    }));
    const details = compiled.projection.blockingDetails as Readonly<{
      count: number; records: readonly Readonly<{ category: string }>[];
    }>;
    assert.equal(details.count, 2);
    assert.deepEqual(details.records.map(({ category }) => category), [
      'blocking-candidate', 'blocking-test-finding'
    ]);
    assert.equal((compiled.projection.testRetirement as { blocked: number }).blocked, 50);
    assert.ok(encodeSourceProgramAuditOperationInput(compiled).byteLength
      < REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes);
  });

  test('one blocking-detail record larger than the derived page budget is typed and never truncated', () => {
    const facts = input();
    const proof = Object.freeze({
      status: 'blocked' as const,
      unknownEvidence: Object.freeze(['x'.repeat(BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES)])
    });
    let failure: unknown;
    try {
      compileSourceProgramAuditOperationInput(Object.freeze({
        ...facts,
        testRetirement: Object.freeze({ ...facts.testRetirement, proofs: Object.freeze([proof]) }),
        options: Object.freeze({
          ...facts.options, blockingDetails: true, blockingDetailsDomain: 'test-retirement' as const
        })
      }));
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof SourceProgramAuditBlockingDetailError);
    assert.equal(failure.domain, 'test-retirement');
    assert.equal(failure.index, 0);
    assert.equal(failure.recordDigest, sha256({
      category: 'blocked-test-retirement-proof', record: proof
    }));
    assert.ok(failure.recordBytes > BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES);
  });

  test('reported test-finding count follows the selected byte page plus compact findings', () => {
    const facts = input();
    const blockers = Object.freeze(Array.from({ length: 2 }, (_, index) => Object.freeze({
      code: 'direct-process-transport-outside-owner' as const,
      subject: `spawn-${index}`,
      paths: Object.freeze([`src/domain-${index}.ts`]),
      reason: 'x'.repeat(Math.floor(BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES / 2) + 1_000),
      observationClass: 'derived' as const
    })));
    const disposition = Object.freeze({
      path: 'tests/domain.test.ts',
      disposition: 'unknown' as const,
      evidence: Object.freeze({
        owner: 'verification.tests', sourceRevision: facts.sourceProgram.sourceRevision,
        replacementTestIds: Object.freeze([]),
        census: Object.freeze({ producerCount: 0, consumerCount: 0, externalContractCount: 0 }),
        supersession: null,
        ownerDecisionDigest: null
      }),
      baselineDigest: digest('baseline'),
      evidenceDigest: digest('evidence')
    });
    const finding = Object.freeze({
      code: 'test-module-disposition-unknown' as const,
      path: disposition.path,
      detail: 'unknown disposition',
      span: null,
      disposition
    });
    const sourceProgram = Object.freeze({
      ...facts.sourceProgram,
      candidateDigests: Object.freeze(blockers.map((blocker) => sha256(blocker))),
      counts: Object.freeze({ ...facts.sourceProgram.counts, candidates: blockers.length })
    });
    const common = Object.freeze({
      ...facts,
      ...syntheticTestFindingComparison(facts, [finding]),
      sourceProgram,
      blockingCandidates: blockers,
      testDisposition: Object.freeze({ ...facts.testDisposition, findings: Object.freeze([finding]) }),
      blockingTestFindings: Object.freeze([finding])
    });
    const page = (page: number) => compileSourceProgramAuditOperationInput(Object.freeze({
      ...common,
      options: Object.freeze({
        ...facts.options, blockingDetails: true, blockingDetailsPage: page
      })
    })).projection;

    const first = page(0), second = page(1);
    assert.equal((first.summary as { reportedBlockingTestFindings: number })
      .reportedBlockingTestFindings, 0);
    assert.equal((second.summary as { reportedBlockingTestFindings: number })
      .reportedBlockingTestFindings, 1);
    assert.deepEqual((first.blockingDetails as { records: readonly unknown[] }).records.length, 1);
    assert.deepEqual((second.blockingDetails as { records: readonly unknown[] }).records.length, 2);
  });

  test('absolute declaration-topology unknowns remain diagnostic under a resolved comparison', () => {
    const facts = input();
    const request = compileSourceProgramAuditOperationInput({ ...facts,
      declarationTopology: { ...facts.declarationTopology, unknowns: [{ reason: 'unresolved-reference' }] }
    });
    assert.deepEqual(request.blockingReasons, []);
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 0);
    assert.equal((request.projection.declarationTopology as { unknowns: number }).unknowns, 1);
  });

  test('a blocked retirement proof cannot disappear behind an empty test-finding list', () => {
    const facts = input();
    const request = compileSourceProgramAuditOperationInput({ ...facts,
      testRetirement: { ...facts.testRetirement, proofs: [{ status: 'blocked' }] }
    });
    assert.ok(request.blockingReasons.includes('test-retirement-blocked'));
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 1);
  });

  test('full and compact reports disclose the same reasons without granting diagnostic success', () => {
    const facts = input();
    for (const full of [false, true]) for (const enforce of [false, true]) {
      const request = compileSourceProgramAuditOperationInput({ ...facts,
        sourceProgram: sourceProgramWithOneUnknown(facts.sourceProgram),
        declarationTopology: { ...facts.declarationTopology, unknowns: [{ reason: 'unresolved' }] },
        testRetirement: { ...facts.testRetirement, proofs: [{ status: 'blocked' }] },
        options: { ...facts.options, full, enforce }
      });
      const expected = ['test-retirement-blocked'];
      assert.deepEqual(request.blockingReasons, expected);
      assert.deepEqual(request.projection.enforcement, { requested: enforce, blockingReasons: expected });
      assert.equal(compileSourceProgramAuditOperation(request).exitCode, enforce ? 1 : 0);
    }
  });

  test('complete coverage and retired proofs remain nonblocking', () => {
    const facts = input();
    const request = compileSourceProgramAuditOperationInput({ ...facts,
      testRetirement: { ...facts.testRetirement, proofs: [{ status: 'retired' }] }
    });
    assert.deepEqual(request.blockingReasons, []);
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 0);
  });

  test('invalid unknown counts reject instead of masquerading as zero coverage gaps', () => {
    const facts = input();
    for (const unknowns of [-1, NaN, Infinity, 0.5, undefined, '0']) {
      assert.throws(() => compileSourceProgramAuditOperationInput({ ...facts,
        sourceProgram: { ...facts.sourceProgram, counts: { ...facts.sourceProgram.counts, unknowns: unknowns as number } }
      }), /unknown observation count/u);
    }
  });


  test('full and compact reports carry the same finding comparison through the actual wire chain', () => {
    const facts = input();
    type Snapshot = Parameters<typeof compileSourceProgramFindingDelta>[0];
    const make = (which: 'before' | 'after'): Snapshot => ({
      analysisPolicy: captureRepositoryAnalysisPolicy([]),
      sourceRevision: facts.reconciliation[which].sourceRevision,
      moduleMembershipDigest: digest('membership'),
      workspaceSnapshot: { files: facts.sourceFileIdentities },
      projectGeneration: { compilerRevision: digest('compiler'), providerRevision: digest('provider'),
        compilerConfigDigest: digest('configuration'), dependencyGenerationDigest: digest('dependency'),
        environmentDigest: digest('environment'), projectConfigDigest: null },
      model: { modelDigest: facts.reconciliation[which].modelDigest,
        providers: [{ id: 'test-provider', revision: 'fixed' }], unknowns: [],
        files: facts.sourceFileIdentities.map(file => ({ ...file, semanticObservationClass: 'observed' })),
        candidates: which === 'before' ? [{ code: 'production-declaration-without-consumer', subject: 'domain',
          paths: ['src/domain.ts'], reason: 'prior observation', observationClass: 'derived' }] : [] }
    }) as unknown as Snapshot;
    const findingDelta = compileSourceProgramFindingDelta(make('before'), make('after'));
    assert.equal(findingDelta.entries[0]!.status, 'absent');
    for (const full of [false, true]) for (const enforce of [false, true]) {
      const request = compileSourceProgramAuditOperationInput({ ...facts,
        reconciliation: { ...facts.reconciliation, findingDelta }, options: { ...facts.options, full, enforce } });
      const decoded = parseSourceProgramAuditOperationInput(encodeSourceProgramAuditOperationInput(request), 1_000_000);
      const result = parseSourceProgramAuditOperationResult(
        encodeSourceProgramAuditOperationResult(compileSourceProgramAuditOperation(decoded)), 1_000_000);
      const observed = (result.projection.reconciliation as { findingDelta: typeof findingDelta }).findingDelta;
      assert.deepEqual(observed.counts, { introduced: 0, persistent: 0, changed: 0, absent: 1,
        'out-of-scope': 0, unobserved: 0 });
      assert.equal(observed.contextComparable, true); assert.equal(observed.deltaDigest, findingDelta.deltaDigest);
      assert.equal('entries' in observed, full); assert.equal(result.exitCode, 0);
    }
  });

  test('foreign finding models and an unresolved comparison disguised as resolved are refused', () => {
    const facts = input();
    type Snapshot = Parameters<typeof compileSourceProgramFindingDelta>[0];
    const base = { analysisPolicy: captureRepositoryAnalysisPolicy([]),
      sourceRevision: facts.reconciliation.before.sourceRevision,
      moduleMembershipDigest: digest('membership'), workspaceSnapshot: { files: facts.sourceFileIdentities },
      projectGeneration: { compilerRevision: digest('compiler'), providerRevision: digest('provider'),
        compilerConfigDigest: digest('configuration'), dependencyGenerationDigest: digest('dependency'),
        environmentDigest: digest('environment'), projectConfigDigest: null },
      model: { modelDigest: facts.reconciliation.before.modelDigest, providers: [], unknowns: [], candidates: [],
        files: facts.sourceFileIdentities.map(file => ({ ...file, semanticObservationClass: 'observed' })) }
    } as unknown as Snapshot;
    const after = { ...base, sourceRevision: facts.reconciliation.after.sourceRevision,
      model: { ...base.model, modelDigest: facts.reconciliation.after.modelDigest, files: [] } };
    const delta = compileSourceProgramFindingDelta(base, after);
    assert.throws(() => compileSourceProgramAuditOperationInput({ ...facts,
      reconciliation: { ...facts.reconciliation, findingDelta: delta } }), /Finding reconciliation/);
    for (const full of [false, true]) for (const enforce of [false, true]) {
      const request = compileSourceProgramAuditOperationInput({ ...facts,
        reconciliation: { ...facts.reconciliation, status: 'unresolved', findingDelta: delta,
          unresolvedReasons: [{ code: 'source-program-observation-coverage-regressed' }] },
        options: { ...facts.options, full, enforce } });
      assert.ok(request.blockingReasons.includes('reconciliation-unresolved'));
      assert.equal(compileSourceProgramAuditOperation(request).exitCode, enforce ? 1 : 0);
    }
    const foreign = { ...delta, after: { ...delta.after, modelDigest: digest('foreign') } };
    assert.throws(() => compileSourceProgramAuditOperationInput({ ...facts,
      reconciliation: { ...facts.reconciliation, status: 'unresolved', findingDelta: foreign } }), /Finding reconciliation/);
  });

  test('missing review context cannot be supplied as a resolved comparison in either report mode', () => {
    const facts = input();
    type Snapshot = Parameters<typeof compileSourceProgramFindingDelta>[0];
    const make = (which: 'before' | 'after'): Snapshot => ({
      sourceRevision: facts.reconciliation[which].sourceRevision,
      moduleMembershipDigest: digest('membership'),
      workspaceSnapshot: { files: facts.sourceFileIdentities },
      projectGeneration: { compilerRevision: digest('compiler'), providerRevision: digest('provider'),
        compilerConfigDigest: digest('configuration'), dependencyGenerationDigest: digest('dependency'),
        environmentDigest: digest('environment'), projectConfigDigest: null },
      model: { modelDigest: facts.reconciliation[which].modelDigest, providers: [], unknowns: [], candidates: [],
        files: facts.sourceFileIdentities.map(file => ({ ...file, semanticObservationClass: 'observed' })) }
    }) as unknown as Snapshot;
    const findingDelta = compileSourceProgramFindingDelta(make('before'), make('after'));
    assert.equal(findingDelta.contextComparable, false);
    assert.equal(findingDelta.entries.length, 0);
    for (const full of [false, true]) for (const enforce of [false, true]) {
      assert.throws(() => compileSourceProgramAuditOperationInput({ ...facts,
        reconciliation: { ...facts.reconciliation, findingDelta },
        options: { ...facts.options, full, enforce } }), /Finding reconciliation/);
    }
  });

  test('an input cannot advertise a different decision from the one the worker executes', () => {
    const original = compileSourceProgramAuditOperationInput(input());
    for (const projection of [
      { ...original.projection, enforcement: { requested: false, blockingReasons: [] } },
      { ...original.projection, enforcement: { requested: true, blockingReasons: ['hidden'] } }
    ]) {
      const altered = { ...original, projection };
      assert.throws(() => compileSourceProgramAuditOperation(altered), /reported enforcement/);
      assert.throws(() => encodeSourceProgramAuditOperationInput(altered), /reported enforcement/);
      const bytes = Buffer.from(JSON.stringify(canonicalJson(altered)));
      assert.throws(() => parseSourceProgramAuditOperationInput(bytes, 1_000_000), /reported enforcement/);
    }
  });

  test('recomputed public result hashes cannot hide a failed enforced decision behind exit zero', () => {
    const facts = input(), request = compileSourceProgramAuditOperationInput({ ...facts,
      testRetirement: { ...facts.testRetirement, proofs: [{ status: 'blocked' }] } });
    const honest = compileSourceProgramAuditOperation(request);
    assert.equal(honest.exitCode, 1);
    const unsigned = { projection: honest.projection, reductionPatch: honest.reductionPatch, exitCode: 0 as const };
    const forged = { ...unsigned, resultDigest: digest(unsigned) };
    assert.throws(() => encodeSourceProgramAuditOperationResult(forged), /contradicts.*decision/);
    assert.throws(() => parseSourceProgramAuditOperationResult(Buffer.from(JSON.stringify(canonicalJson(forged))),
      1_000_000), /contradicts.*decision/);
  });

  test('a failure exit cannot be invented for an explicitly successful diagnostic decision', () => {
    const facts = input(), request = compileSourceProgramAuditOperationInput({ ...facts,
      sourceProgram: sourceProgramWithOneUnknown(facts.sourceProgram),
      options: { ...facts.options, enforce: false } });
    const honest = compileSourceProgramAuditOperation(request);
    assert.equal(honest.exitCode, 0);
    const unsigned = { projection: honest.projection, reductionPatch: honest.reductionPatch, exitCode: 1 as const };
    const forged = { ...unsigned, resultDigest: digest(unsigned) };
    assert.throws(() => encodeSourceProgramAuditOperationResult(forged), /contradicts.*decision/);
  });

  test('missing or malformed reported enforcement is not interpreted as success', () => {
    const original = compileSourceProgramAuditOperationInput(input());
    for (const enforcement of [undefined, null, {}, { requested: 'false', blockingReasons: [] },
      { requested: true, blockingReasons: [null] }, { requested: true, blockingReasons: ['same', 'same'] },
      { requested: true, blockingReasons: new Array(1) }]) {
      assert.throws(() => compileSourceProgramAuditOperation({ ...original,
        projection: { ...original.projection, enforcement } }), /enforcement|blocking reason/);
    }
  });

});


function legacyTestFacts(): CompileWholeSourceProgramAuditOperationInput {
  const facts = input();
  return { ...facts, options: { ...facts.options, authorityScope: 'test-obligations' },
    supersession: { ...facts.supersession, authorityScope: 'test-obligations' } };
}

function scopedTestFacts(facts = legacyTestFacts()): CompileTestObligationsAuditOperationInput {
  const analyses = compileSourceProgramAuditAnalyses({ authorityScope: 'test-obligations',
    baselineCompilation: facts.reconciliation.before,
    compileWholeProgram: () => { throw new Error('unrequested general analysis ran'); } });
  assert.equal(analyses.schema, 'source-program-test-obligations-audit-facts-v1');
  if (analyses.schema === undefined) throw new Error('scope selection returned full analyses');
  assert.ok(facts.testFindingDelta !== undefined);
  return { ...facts, ...analyses, testFindingDelta: facts.testFindingDelta,
    reduction: { mode: 'none' }, options: { ...facts.options, authorityScope: 'test-obligations' } };
}

// Pure historical replay fixture. These structures are deliberately not issued
// physical observations, compilation receipts, author approval or Gate authority.
function historicalTransition(facts: CompileSourceProgramAuditOperationInput): Parameters<typeof createSourceProgramTransitionAssessment>[0] {
  const evidence = (sourceRevision: string, modelDigest: string, testCompilationDigest: string): SourceProgramSupersessionEvidence => {
    const identity = { ...compileSourceProgramSupersessionEvidenceIdentity({
      revisionDigest: digest(sourceRevision), treeDigest: digest(modelDigest),
      toolchainDigest: digest('test-toolchain'), configurationDigest: digest('test-configuration')
    }), sourceRevision };
    const source = { modelDigest, testCompilationDigest, intentEvidenceDigest: digest([]) };
    const fields = { identity, source, actionKey: digest({ identity, source }), productionUnits: [],
      resourceUnits: [], entrypointUnits: [], tests: [], testDefinitionInputs: [], testDefinitionContext: null,
      intentEvidence: [], unknowns: [] };
    return { ...fields, evidenceDigest: digest(fields) };
  };
  const baseline = evidence(facts.supersession.baseline.sourceRevision,
    facts.supersession.baseline.modelDigest, facts.supersession.baseline.testCompilationDigest);
  const current = evidence(facts.sourceProgram.sourceRevision, facts.sourceProgram.modelDigest,
    facts.testValue.compilationDigest);
  const operation = compileSourceProgramAuditOperationInput(facts);
  const result = compileSourceProgramAuditOperation(operation);
  const plan = compileSecSemanticOperationPlan({ operation: 'fixture.audit',
    intentDigest: digest('fixture-intent'), decisionDigest: digest('fixture-decision'), deadlineAtUnixMs: 1,
    aggregateBudgets: [{ resource: 'duration-ms', maximum: 1 }, { resource: 'input-bytes', maximum: 1_000_000 },
      { resource: 'output-bytes', maximum: 1_000_000 }, { resource: 'processes', maximum: 1 }],
    requirements: [{ id: 'fixture.worker', contractDigest: digest('fixture-contract'), effectKinds: ['process'], failureKinds: ['unknown'] }],
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: digest('fixture-only') })
  });
  const binding = compileSecCapabilityBinding({ requirementId: 'fixture.worker',
    contractDigest: digest('fixture-contract'), providerIdentityDigest: digest('fixture-provider') });
  const boundOperation = bindSecSemanticOperation(plan, [binding]);
  const request = compileRepositoryAuditWorkerRequest({
    operationIdentityDigest: plan.identity.identityDigest, boundAttemptDigest: boundOperation.boundAttemptDigest,
    generationDigest: digest('fixture-generation'),
    entrypointAddress: 'module-entrypoint:src/fixture/module.json#fixture.audit:src/fixture/worker.ts',
    implementationDigest: digest('fixture-implementation'), dependencyGenerationDigest: digest('fixture-dependencies'),
    subjectDigest: operation.binding.subjectDigest, payload: encodeSourceProgramAuditOperationInput(operation)
  });
  const handshake = compileRepositoryAuditWorkerHandshakeCandidate(request);
  const candidate = compileRepositoryAuditWorkerResultCandidate(request, handshake, encodeSourceProgramAuditOperationResult(result));
  const stream = encodeRepositoryAuditWorkerCandidateStream(request, handshake, candidate);
  const { payloadBase64: _requestPayload, ...requestIdentity } = request;
  const { payloadBase64: _resultPayload, ...resultIdentity } = candidate;
  const physicalRoot = { path: '/synthetic-replay-only', finalPath: '/synthetic-replay-only',
    device: '0', inode: '0', objectId: 'synthetic-replay-only' };
  const resourceFields = {
    operationIdentityDigest: request.operationIdentityDigest, boundAttemptDigest: request.boundAttemptDigest,
    requirementId: 'fixture.worker', providerBindingDigest: binding.bindingDigest,
    resourceCeilingIdentityDigest: digest('fixture-ceiling'), requirementBindingContextDigest: digest('fixture-context'),
    processCount: 1, settledProcessCount: 1, successfulProcessRecordCount: 1, failedProcessCount: 0,
    admittedNativeResourceCount: 1, startedNativeResourceCount: 1, rootProcessCount: 1, stdinWorkerCount: 0,
    helperProcessCount: 0, settledNativeResourceCount: 1, failedNativeAdmissionCount: 0,
    inputBytes: encodeSourceProgramAuditOperationInput(operation).byteLength, outputBytes: stream.byteLength, deadlineAtUnixMs: 1
  };
  const history: Omit<RepositoryAuditLoadedImplementationEvidence, 'evidenceDigest'> = {
    schema: 'repository-audit-loaded-implementation-history-v1', authority: 'historical-evidence-only',
    operation: boundOperation,
    observation: { kind: 'repository-audit-loaded-implementation-observation', entrypointAddress: request.entrypointAddress,
      implementationDigest: request.implementationDigest, operationIdentityDigest: request.operationIdentityDigest,
      boundAttemptDigest: request.boundAttemptDigest, observationDigest: digest('synthetic-observation-only') },
    producerClosure: { authority: 'source-evidence-only', operation: { capability: 'fixture', operation: 'audit' },
      moduleId: 'fixture', descriptor: { path: 'src/fixture/module.json', contentDigest: digest('fixture-descriptor') },
      entrypoint: { path: 'src/fixture/worker.ts', contentDigest: digest('fixture-worker'), address: request.entrypointAddress },
      implementationFiles: [{ path: 'src/fixture/worker.ts', contentDigest: digest('fixture-worker') }], closureDigest: digest('fixture-closure') },
    generationRetirement: { generationIdentity: {
      borrowedGenerationDigest: digest('fixture-borrowed'), exactFileSetDigest: digest('fixture-files'),
      generationDigest: request.generationDigest, materializationOperationDigest: digest('fixture-materialization'),
      protectedSubjectRootsDigest: digest('fixture-protected-roots'), sealedRoot: physicalRoot,
      treeDigest: digest('fixture-tree'), workingDirectoryGenerationDigest: digest('fixture-workdir')
    }, linkedSettlements: [], protectedRootSettlements: [], treeAuthority: 'released',
      tree: { entryCount: 1, root: physicalRoot, status: 'physically-absent' } },
    dependencyRetirement: { generationDigest: request.dependencyGenerationDigest, physicalRoot, terminal: 'released' },
    resources: { ...resourceFields, receiptDigest: digest(resourceFields) },
    process: { ordinal: 1, code: 0, stdoutDigest: rawSha256(stream), stdoutBytes: stream.byteLength,
      stderrBytes: 0, stderrDigest: rawSha256('') },
    request: requestIdentity, handshake, result: resultIdentity, streamDigest: rawSha256(stream)
  };
  assert.equal(facts.testRetirement.proofs.length, 0);
  return {
    runtimeSha: 'a'.repeat(40), baseSha: 'a'.repeat(40), baseTreeSha: 'b'.repeat(40),
    headSha: 'c'.repeat(40), headTreeSha: 'd'.repeat(40), baseline, current,
    changedPaths: [], authorAssessment: null, currentTestValue: {
      sourceRevision: facts.testValue.sourceRevision, compilationDigest: facts.testValue.compilationDigest,
      baselineTestPaths: [], baselineDigest: facts.testValue.baselineDigest,
      baselineEvidenceDigest: facts.testValue.baselineEvidenceDigest, dispositions: [], records: [], findings: [],
      definitionInputs: [], definitionContext: null
    }, testRetirement: { ...facts.testRetirement, proofs: [] }, auditFacts: facts,
    producerExecution: { ...history, evidenceDigest: digest(history) }
  };
}

describe('test-obligations scoped audit facts', () => {
  test('omits optional mechanism diagnostics without changing test-obligation decisions', () => {
    const fullFacts = legacyTestFacts();
    const leanFacts = { ...fullFacts, sourceProgram: input([], [], false).sourceProgram };
    const { mechanismReview, ...requiredSourceFacts } = fullFacts.sourceProgram;
    assert.ok(mechanismReview !== undefined);
    assert.deepEqual(leanFacts.sourceProgram, requiredSourceFacts);
    const full = compileSourceProgramAuditOperationInput(scopedTestFacts(fullFacts));
    const lean = compileSourceProgramAuditOperationInput(scopedTestFacts(leanFacts));
    const { mechanisms, ...requiredProjection } = full.projection;
    assert.ok(mechanisms !== undefined);
    assert.deepEqual(lean.projection, requiredProjection);
    assert.deepEqual(lean.blockingReasons, full.blockingReasons);
    assert.equal(compileSourceProgramAuditOperation(lean).exitCode,
      compileSourceProgramAuditOperation(full).exitCode);
    // Existing historical facts still retain and replay the complete diagnostic.
    assert.deepEqual(parseSourceProgramTransitionAssessment(
      createSourceProgramTransitionAssessment(historicalTransition(scopedTestFacts(fullFacts))))
      .auditFacts.sourceProgram.mechanismReview, mechanismReview);
  });

  test('omits general producer calls and reports unrequested analyses without zero success counts', () => {
    const full = legacyTestFacts();
    let calls = 0;
    const prepare = (authorityScope: 'whole-program' | 'test-obligations') => compileSourceProgramAuditAnalyses({
      authorityScope, baselineCompilation: full.reconciliation.before, compileWholeProgram: () => {
        calls++; return { implementationDominance: full.implementationDominance,
          reconciliation: full.reconciliation, architectureEvolution: full.architectureEvolution };
      }
    });
    assert.equal(prepare('test-obligations').schema, 'source-program-test-obligations-audit-facts-v1');
    assert.equal(calls, 0);
    assert.equal(prepare('whole-program').schema, undefined);
    assert.equal(calls, 1);
    const facts = scopedTestFacts();
    for (const full of [false, true]) {
      const report = compileSourceProgramAuditOperationInput({ ...facts, options: { ...facts.options, full } }).projection;
      for (const name of ['implementationDominance', 'reconciliation', 'architectureEvolution']) {
        assert.deepEqual(report[name], { status: 'not-requested', reason: 'outside-test-obligations' });
      }
      assert.equal(Object.hasOwn(report.summary as object, 'reconciliationChanges'), false);
      assert.equal(Object.hasOwn(report.summary as object, 'implementationDominanceFindings'), false);
    }
    assert.throws(() => compileSourceProgramAuditOperationInput({ ...facts,
      options: { ...facts.options, blockingDetails: true, blockingDetailsDomain: 'implementation-dominance' } }), /not requested/);
  });

  test('preserves test blockers and decisions across full and scoped facts', () => {
    const full = legacyTestFacts();
    assert.ok(full.testFindingDelta !== undefined);
    const cut = (value: typeof full.testFindingDelta.before) => {
      const context = { ...value.context, analysisPolicyDigest: null };
      return { ...value, context, contextDigest: digest(context), incompleteContextFields: ['analysisPolicyDigest'] };
    };
    const { deltaDigest: _digest, ...priorDelta } = full.testFindingDelta;
    const unresolvedDelta = { ...priorDelta, before: cut(priorDelta.before), after: cut(priorDelta.after), contextComparable: false };
    const unresolved = { ...full, testFindingDelta: { ...unresolvedDelta, deltaDigest: digest(unresolvedDelta) } };
    const finding = { code: 'test-module-disposition-unknown' as const, path: 'tests/new.test.ts',
      detail: 'new unknown disposition', span: null, disposition: null };
    const regression = { ...full, ...syntheticTestFindingComparison(full, [finding]),
      testDisposition: { ...full.testDisposition, findings: [finding] }, blockingTestFindings: [finding] };
    const variants: CompileWholeSourceProgramAuditOperationInput[] = [full, unresolved, regression,
      { ...full, testRetirement: { ...full.testRetirement, proofs: [{ status: 'blocked' }] } },
      { ...full, supersession: { ...full.supersession, status: 'owner-decision-required' } },
      { ...full, supersession: { ...full.supersession, status: 'author-decision-conditional' } }
    ];
    for (const variant of variants) {
      const legacy = compileSourceProgramAuditOperationInput(variant);
      const scoped = compileSourceProgramAuditOperationInput(scopedTestFacts(variant));
      assert.deepEqual(scoped.blockingReasons, legacy.blockingReasons);
      assert.equal(compileSourceProgramAuditOperation(scoped).exitCode, compileSourceProgramAuditOperation(legacy).exitCode);
    }
    assert.ok(compileSourceProgramAuditOperationInput(scopedTestFacts(unresolved)).blockingReasons
      .includes('test-finding-reconciliation-unresolved'));
    assert.ok(compileSourceProgramAuditOperationInput(scopedTestFacts(regression)).blockingReasons
      .includes('test-value-finding-regression'));
  });

  test('rejects anchor drift, missing comparison and mixed scope or fact versions', () => {
    const facts = scopedTestFacts();
    const invalid: unknown[] = [
      { ...facts, baselineCompilation: undefined },
      { ...facts, baselineCompilation: { ...facts.baselineCompilation, sourceRevision: digest('foreign') } },
      { ...facts, baselineCompilation: { ...facts.baselineCompilation, modelDigest: digest('foreign') } },
      { ...facts, baselineCompilation: { ...facts.baselineCompilation, compilationReceiptDigest: digest('foreign') } },
      { ...facts, sourceProgramCompilation: { ...facts.sourceProgramCompilation, receiptDigest: digest('foreign') } },
      { ...facts, testValue: { ...facts.testValue, findingsDigest: digest('foreign') } },
      { ...facts, testFindingDelta: undefined },
      { ...facts, options: { ...facts.options, authorityScope: 'whole-program' } },
      { ...facts, reduction: { mode: 'version' } },
      { ...facts, schema: 'future-version' },
      { ...facts, reconciliation: { status: 'resolved', changes: [] } },
      { ...facts, architectureEvolution: undefined },
      { ...facts, implementationDominance: { status: 'not-requested', reason: 'outside-test-obligations', findings: [] } },
      { ...legacyTestFacts(), implementationDominance: facts.implementationDominance },
      { ...legacyTestFacts(), baselineCompilation: facts.baselineCompilation }
    ];
    for (const candidate of invalid) assert.throws(() =>
      compileSourceProgramAuditOperationInput(candidate as CompileSourceProgramAuditOperationInput));
  });

  test('retains scoped facts identity through the canonical request and result payload', () => {
    const facts = scopedTestFacts();
    const operation = compileSourceProgramAuditOperationInput(facts);
    const wire = encodeSourceProgramAuditOperationInput(operation);
    const parsed = parseSourceProgramAuditOperationInput(wire, 1_000_000);
    assert.deepEqual(encodeSourceProgramAuditOperationInput(parsed), wire);
    assert.equal(parsed.projection.factsSchema, facts.schema);
    assert.deepEqual(parsed.projection.baselineCompilation, facts.baselineCompilation);
    const result = compileSourceProgramAuditOperation(parsed);
    assert.deepEqual(parseSourceProgramAuditOperationResult(encodeSourceProgramAuditOperationResult(result), 1_000_000), result);
    assert.throws(() => encodeSourceProgramAuditOperationResult({ ...result,
      projection: { ...result.projection, factsSchema: 'other' } }), Error);
    const legacy = compileSourceProgramAuditOperationInput(legacyTestFacts());
    assert.equal(Object.hasOwn(legacy.projection, 'factsSchema'), false);
    assert.equal(Object.hasOwn(legacy.projection, 'baselineCompilation'), false);
  });

  test('replays historical v1 and scoped v2 without converting history into live authority', () => {
    for (const facts of [legacyTestFacts(), scopedTestFacts()]) {
      const assessment = createSourceProgramTransitionAssessment(historicalTransition(facts));
      assert.equal(assessment.schema, isTestObligationsAuditFacts(facts)
        ? 'source-program-transition-assessment-v2' : 'source-program-transition-assessment-v1');
      assert.deepEqual(parseSourceProgramTransitionAssessment(JSON.parse(JSON.stringify(assessment))), assessment);
      assert.equal(assessment.producerExecution.authority, 'historical-evidence-only');
      assert.throws(() => parseSourceProgramTransitionAssessment({ ...assessment,
        schema: assessment.schema === 'source-program-transition-assessment-v1'
          ? 'source-program-transition-assessment-v2' : 'source-program-transition-assessment-v1' }), /canonical/);
      const producer = assessment.producerExecution;
      const { evidenceDigest: _digest, ...history } = producer;
      const changed = { ...history, process: { ...history.process, stdoutBytes: history.process.stdoutBytes + 1 } };
      assert.throws(() => createSourceProgramTransitionAssessment({ ...assessment,
        producerExecution: { ...changed, evidenceDigest: digest(changed) } }), /protocol bytes/);
    }
  });

  test('binds scoped compared evidence and added or deleted shared-input paths before replay', () => {
    const original = historicalTransition(scopedTestFacts());
    for (const changedPaths of [['test-preload.ts'], ['deleted-test-config.ts']]) {
      const context = { compilerIdentityDigest: digest('compiler'), inputs: [], unresolved: [],
        readEnvelopes: [{ root: '.', descendants: true }], runtimeIsolation: 'unassessed' as const,
        hasUnknownReadScope: false };
      const baseline = { ...original.baseline, testDefinitionContext: { ...context, contextDigest: digest(context) } };
      const { evidenceDigest: _digest, ...fields } = baseline;
      assert.throws(() => createSourceProgramTransitionAssessment({ ...original, changedPaths,
        baseline: { ...fields, evidenceDigest: digest(fields) } }), /shared test-input delta/);
    }
    assert.throws(() => createSourceProgramTransitionAssessment({ ...original,
      auditFacts: { ...scopedTestFacts(), baselineCompilation: {
        ...scopedTestFacts().baselineCompilation, sourceRevision: digest('wrong-baseline')
      } } }), /compared source evidence/);
  });
});


test('test-obligations candidate scope preserves source facts and refuses ordinary candidate queries', () => {
  const descriptorPath = 'src/example/module.json';
  const descriptorSource = JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [],
    capabilityProviders: [], preDependencyBootstrap: false });
  const sources = {
    [descriptorPath]: descriptorSource,
    'src/example/operation.ts': 'export const value = 1;\n',
    'package.json': JSON.stringify({ name: 'fixture', scripts: { first: 'echo sample', second: 'echo sample' } })
  };
  const files = Object.entries(sources).map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) }));
  const sourceRevision = digest(files);
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: { kind: 'virtual-mutation', provenance: { kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: digest('candidate-scope-fixture'), mutationDigest: sourceRevision } },
    files,
    moduleMembership: compileSecRepositoryModuleMembershipSnapshot({
      repositoryFiles: files.map(({ path }) => path),
      descriptorSources: [{ descriptorPath, source: descriptorSource }]
    })
  });
  const complete = compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
  const scoped = compileVirtualRepositorySourceProgramTestObligationsCompilation({ workspaceSnapshot });
  assert.ok(complete.model.candidates.some(({ code }) => code === 'duplicate-entrypoint-command'));
  assert.deepEqual(scoped.model.candidates, { status: 'not-requested', reason: 'outside-test-obligations' });
  const { candidates: _completeCandidates, modelDigest: _completeDigest, ...completeFacts } = complete.model;
  const { candidates: _scopedCandidates, modelDigest: _scopedDigest, ...scopedFacts } = scoped.model;
  assert.deepEqual(scopedFacts, completeFacts);
  assert.notEqual(scoped.model.modelDigest, complete.model.modelDigest);
  assert.notEqual(scoped.receiptDigest, complete.receiptDigest);
  assert.equal(scoped.typeScriptCompilation.model.modelDigest, complete.typeScriptCompilation.model.modelDigest);
  assert.equal(scoped.testObservations.observationDigest, complete.testObservations.observationDigest);
  const identities = scoped.model.files.map(({ path, contentDigest }) => ({ path, contentDigest }));
  const projected = compileSourceProgramAuditTestObligationsSourceProgramProjection(scoped.model, identities);
  assert.deepEqual(projected.counts.candidates, scoped.model.candidates);
  assert.deepEqual(projected.candidateDigests, scoped.model.candidates);
  assert.throws(() => compileSourceProgramAuditSourceProgramProjection(
    scoped.model as unknown as SourceProgramModel, identities, false), /candidate analysis was not requested/);
  assert.throws(() => querySourceProgramModel(scoped.model as unknown as SourceProgramModel, 'value'),
    /candidate analysis was not requested/);
});

test('test-obligations candidate scope v2 preserves omission and legacy v1 replay', () => {
  const legacy = scopedTestFacts();
  assert.equal(legacy.schema, 'source-program-test-obligations-audit-facts-v1');
  if (legacy.schema !== 'source-program-test-obligations-audit-facts-v1') throw new Error('Expected historical v1');
  const omitted = SOURCE_PROGRAM_TEST_OBLIGATIONS_NOT_REQUESTED;
  const scoped: CompileScopedCandidateTestObligationsAuditOperationInput = {
    ...legacy, schema: 'source-program-test-obligations-audit-facts-v2',
    blockingCandidates: omitted,
    sourceProgram: { ...legacy.sourceProgram, candidates: omitted, candidateDigests: omitted,
      counts: { ...legacy.sourceProgram.counts, candidates: omitted } },
    topology: { ...legacy.topology, candidateCodes: omitted, directProcessTransportPaths: omitted }
  };
  const prior = compileSourceProgramAuditOperationInput(legacy);
  const priorBytes = encodeSourceProgramAuditOperationInput(prior);
  const compiled = compileSourceProgramAuditOperationInput(scoped);
  const summary = compiled.projection.summary as Record<string, unknown>;
  assert.deepEqual(compiled.blockingReasons, prior.blockingReasons);
  assert.deepEqual(compiled.projection.blockingCandidates, omitted);
  assert.deepEqual(summary.blockingCandidates, omitted);
  assert.deepEqual(summary.candidates, omitted);
  const encoded = encodeSourceProgramAuditOperationInput(compiled);
  assert.deepEqual(parseSourceProgramAuditOperationInput(encoded, encoded.byteLength), compiled);
  assert.deepEqual(encodeSourceProgramAuditOperationInput(compileSourceProgramAuditOperationInput(legacy)), priorBytes);
  const replay = parseSourceProgramTransitionAssessment(
    createSourceProgramTransitionAssessment(historicalTransition(scoped)));
  assert.equal(replay.auditFacts.schema, 'source-program-test-obligations-audit-facts-v2');
  assert.deepEqual(replay.auditFacts.sourceProgram.candidates, omitted);
  const priorReplay = parseSourceProgramTransitionAssessment(
    createSourceProgramTransitionAssessment(historicalTransition(legacy)));
  assert.equal(priorReplay.auditFacts.schema, 'source-program-test-obligations-audit-facts-v1');
  assert.deepEqual(priorReplay.auditFacts.sourceProgram.candidates, legacy.sourceProgram.candidates);
  assert.throws(() => compileSourceProgramAuditOperationInput({ ...scoped,
    blockingCandidates: [] } as unknown as CompileSourceProgramAuditOperationInput), /explicitly not requested/);
  assert.throws(() => compileSourceProgramAuditOperationInput({ ...scoped,
    sourceProgram: { ...scoped.sourceProgram, counts: { ...scoped.sourceProgram.counts, candidates: 0 } }
  } as unknown as CompileSourceProgramAuditOperationInput), /explicitly not requested/);
});
