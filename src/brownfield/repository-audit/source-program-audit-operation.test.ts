import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';

import { canonicalJson, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { SourceProgramModel } from '../source-program-model/contract.ts';
import {
  compileSourceProgramAuditOperation,
  compileSourceProgramAuditOperationInput,
  compileSourceProgramAuditSourceProgramProjection,
  compileSourceProgramAuditTestValueProjection,
  encodeSourceProgramAuditOperationInput,
  encodeSourceProgramAuditOperationResult,
  parseSourceProgramAuditOperationInput,
  parseSourceProgramAuditOperationResult,
  type CompileSourceProgramAuditOperationInput,
  type SourceProgramAuditOperationInput
} from './source-program-audit-operation.ts';

import { compileSourceProgramFindingDelta } from '../source-program-model/reconciliation-findings.ts';
import { captureRepositoryAnalysisPolicy } from '../source-program-model/repository-analysis-policy.ts';

const digest = (value: unknown): `sha256:${string}` => sha256(value) as `sha256:${string}`;

function input(): CompileSourceProgramAuditOperationInput {
  const sourceRevision = digest('source');
  const modelDigest = digest('model');
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
    candidates: Object.freeze([]),
    unknowns: Object.freeze([]),
    modelDigest
  });
  const sourceFileIdentities = Object.freeze([Object.freeze({
    path: sourcePath,
    contentDigest
  })]);
  const testValue = Object.freeze({
    sourceRevision,
    baselineTestPaths: Object.freeze([]),
    baselineDigest: sha256([]),
    baselineEvidenceDigest,
    dispositions: Object.freeze([]),
    records: Object.freeze([]),
    findings: Object.freeze([]),
    compilationDigest: testCompilationDigest
  });
  return Object.freeze({
    sourceProgram: compileSourceProgramAuditSourceProgramProjection(
      model,
      sourceFileIdentities,
      false
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
        sourceRevision: digest('before-source'),
        modelDigest: digest('before-model'),
        compilationReceiptDigest: digest('before-compilation')
      }),
      after: Object.freeze({
        sourceRevision,
        modelDigest,
        compilationReceiptDigest: digest('compilation')
      }),
      changes: Object.freeze([]),
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
    blockingCandidates: Object.freeze([]),
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
      full: false,
      enforce: true,
      includeCandidates: false,
      queryProjection: null,
      outputPath: null
    })
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

  test('enforce converts derived blockers into a domain exit decision without publishing effects', () => {
    const facts = input();
    const blocker = Object.freeze({
      code: 'direct-process-transport-outside-owner' as const,
      subject: 'spawn',
      paths: Object.freeze(['src/domain.ts']),
      reason: 'direct process transport is outside its canonical owner',
      observationClass: 'derived' as const
    });
    const blockedSourceProgram = Object.freeze({
      ...facts.sourceProgram,
      candidateDigests: Object.freeze([sha256(blocker)]),
      counts: Object.freeze({ ...facts.sourceProgram.counts, candidates: 1 })
    });
    const blocked = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      sourceProgram: blockedSourceProgram,
      blockingCandidates: Object.freeze([blocker]),
      implementationDominance: facts.implementationDominance
    })));
    const diagnosticOnly = compileSourceProgramAuditOperation(
      compileSourceProgramAuditOperationInput(Object.freeze({
      ...facts,
      sourceProgram: blockedSourceProgram,
      blockingCandidates: Object.freeze([blocker]),
      implementationDominance: facts.implementationDominance,
      options: Object.freeze({ ...facts.options, enforce: false })
    })));

    assert.equal(blocked.exitCode, 1);
    assert.equal(diagnosticOnly.exitCode, 0);
    assert.equal((blocked.projection.summary as { blockingCandidates: number }).blockingCandidates, 1);
  });


  test('enforced audits refuse uncovered source observations even without known candidates', () => {
    const facts = input();
    const request = compileSourceProgramAuditOperationInput({ ...facts,
      sourceProgram: { ...facts.sourceProgram, counts: { ...facts.sourceProgram.counts, unknowns: 1 } }
    });
    assert.ok(request.blockingReasons.includes('source-program-incomplete'));
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 1);
  });

  test('unresolved declaration topology independently blocks enforce', () => {
    const facts = input();
    const request = compileSourceProgramAuditOperationInput({ ...facts,
      declarationTopology: { ...facts.declarationTopology, unknowns: [{ reason: 'unresolved-reference' }] }
    });
    assert.ok(request.blockingReasons.includes('declaration-topology-incomplete'));
    assert.equal(compileSourceProgramAuditOperation(request).exitCode, 1);
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
        sourceProgram: { ...facts.sourceProgram, counts: { ...facts.sourceProgram.counts, unknowns: 1 } },
        declarationTopology: { ...facts.declarationTopology, unknowns: [{ reason: 'unresolved' }] },
        testRetirement: { ...facts.testRetirement, proofs: [{ status: 'blocked' }] },
        options: { ...facts.options, full, enforce }
      });
      const expected = ['declaration-topology-incomplete', 'source-program-incomplete', 'test-retirement-blocked'];
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
      sourceProgram: { ...facts.sourceProgram, counts: { ...facts.sourceProgram.counts, unknowns: 1 } } });
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
      sourceProgram: { ...facts.sourceProgram, counts: { ...facts.sourceProgram.counts, unknowns: 1 } },
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
