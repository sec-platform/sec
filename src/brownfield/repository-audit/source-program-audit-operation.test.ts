import { describe, expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { SourceProgramModel } from '../source-program-model/contract.ts';
import { sourceProgramTestBaselineEvidenceDigest } from '../source-program-model/test-value.ts';
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

const digest = (value: unknown): `sha256:${string}` => sha256(value) as `sha256:${string}`;

function input(): CompileSourceProgramAuditOperationInput {
  const sourceRevision = digest('source');
  const modelDigest = digest('model');
  const testCompilationDigest = digest('test-compilation');
  const supersessionReceiptDigest = digest('supersession');
  const reconciliationProjectionDigest = digest('reconciliation');
  const baselineEvidence = Object.freeze([]);
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
    baselineEvidenceDigest: sourceProgramTestBaselineEvidenceDigest(baselineEvidence),
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
      baselineEvidenceDigest: sourceProgramTestBaselineEvidenceDigest(baselineEvidence),
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

    expect(parseSourceProgramAuditOperationResult(
      encodedResult,
      encodedResult.byteLength
    )).toEqual(result);
    const unknownInput = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(encodedInput).toString('utf8')),
      transportAuthority: true
    }));
    expect(() => parseSourceProgramAuditOperationInput(
      unknownInput,
      unknownInput.byteLength
    )).toThrow(/unsupported root key/u);
    const changedResult = Buffer.from(encodedResult);
    changedResult[changedResult.byteLength - 2] ^= 1;
    expect(() => parseSourceProgramAuditOperationResult(
      changedResult,
      changedResult.byteLength
    )).toThrow();
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

    expect(first).toEqual(second);
    expect(serialized).toEqual(first);
    expect(first.exitCode).toBe(0);
    expect(first.reductionPatch).toBeNull();
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

    expect(projected.projection.result).toBe(queryProjection);
    expect(projected.projection.candidates).toEqual([]);
    expect(projected.projection.architecture).toEqual({
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

    expect(result.reductionPatch).toBe(patch);
    expect(result.projection.versionReductionPlan).toEqual({
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
    expect(() => compileSourceProgramAuditOperationInput({
      ...facts,
      reduction: { mode: 'version+graph-cut' }
    } as unknown as CompileSourceProgramAuditOperationInput)).toThrow(
      'Unsupported Source Program audit reduction mode'
    );
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

    expect(blocked.exitCode).toBe(1);
    expect(diagnosticOnly.exitCode).toBe(0);
    expect(blocked.projection.summary).toEqual(expect.objectContaining({ blockingCandidates: 1 }));
  });
});
