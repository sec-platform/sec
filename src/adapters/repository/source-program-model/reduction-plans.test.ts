import { expect, test } from 'bun:test';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileRepositoryModuleArchitectureProjection,
  compileRepositoryModuleMembershipSnapshot
} from '../architecture/contract.ts';
import { createSourceProgramCompilationOperation } from './compilation-operation.ts';
import {
  buildSourceProgramAggregateImportReductionPatch,
  compileSourceProgramAggregateImportReductionPlan,
  compileSourceProgramGraphCutReductionPlan,
  compileSourceProgramUnusedSymbolProviderReceipt,
  renderSourceProgramGraphCutReductionPatch,
  SourceProgramReductionAdmissionError
} from './reduction.ts';
import { compileRepositorySourceProgramModel } from './repository.ts';
import { compileSourceProgramRepositoryModuleGraph } from './source-program-module-graph.ts';
import { compileTypeScriptSourceProgramModel } from './typescript.ts';
import { compileWorkspaceSourceRevision } from './workspace-source-snapshot.ts';

test('reduction compiler resolves pure aggregate modules to declaration owners', () => {
  const sources = new Map([
    ['src/provider/facade.ts', "export { execute } from './operation.ts';\n"],
    ['src/provider/operation.ts', 'export function execute(): string { return \'ok\'; }\n'],
    ['src/consumer/use.ts', "import { execute } from '../provider/facade.ts';\nexport const result = execute();\n"]
  ]);
  const descriptorSources = ['src/provider', 'src/consumer'].map((root) => ({
    descriptorPath: `${root}/module.json`,
    source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
  }));
  const repositoryFiles = [...sources.keys(), ...descriptorSources.map(({ descriptorPath }) => descriptorPath)];
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles,
    descriptorSources
  });
  const files = [...sources].map(([path, source]) => ({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = compileWorkspaceSourceRevision(files);
  const typeScriptModel = compileTypeScriptSourceProgramModel({
    sourceRevision,
    files,
    moduleMembership
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership,
    typescriptModel: typeScriptModel
  });
  const moduleGraph = compileSourceProgramRepositoryModuleGraph({
    files: [...sources.keys()],
    readSource: (repositoryPath) => sources.get(repositoryPath) ?? null
  });
  const architecture = compileRepositoryModuleArchitectureProjection(
    moduleGraph,
    moduleMembership,
    model
  );
  const plan = compileSourceProgramAggregateImportReductionPlan(model, files, {
    sourceRevision,
    architecture
  }, {
    typeScriptModel,
    moduleMembership,
    reviewedProcessDispatchers: []
  });
  const patch = buildSourceProgramAggregateImportReductionPatch(plan, files);

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    status: 'ready',
    path: 'src/consumer/use.ts',
    targetPaths: ['src/provider/operation.ts'],
    replacementText: "import { execute } from '../provider/operation.ts';"
  }));
  expect(patch.files.map(({ path }) => path)).toEqual(['src/consumer/use.ts']);
  expect(patch.patch).toContain("from '../provider/operation.ts'");
  expect(plan.snapshotStatus).toBe('sealed');
  expect(plan.architectureDigest).toBe(sha256(architecture));
  const changedFiles = files.map((file) => file.path === 'src/consumer/use.ts'
    ? Object.freeze({
        ...file,
        source: `${file.source}// external drift\n`,
        contentDigest: rawSha256(`${file.source}// external drift\n`)
      })
    : file);
  try {
    buildSourceProgramAggregateImportReductionPatch(plan, changedFiles);
    throw new Error('expected aggregate source snapshot drift to block');
  } catch (error) {
    expect(error).toBeInstanceOf(SourceProgramReductionAdmissionError);
    expect((error as SourceProgramReductionAdmissionError).code).toBe('source-snapshot-drift');
  }

  const driftedModel = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership,
    typescriptModel: typeScriptModel,
    unknowns: [{
      code: 'working-tree-changed-during-source-program-census',
      path: '.',
      detail: 'synthetic drift',
      span: null
    }]
  });
  const driftedArchitecture = compileRepositoryModuleArchitectureProjection(
    moduleGraph,
    moduleMembership,
    driftedModel
  );
  const driftedPlan = compileSourceProgramAggregateImportReductionPlan(driftedModel, files, {
    sourceRevision,
    architecture: driftedArchitecture
  }, {
    typeScriptModel,
    moduleMembership,
    reviewedProcessDispatchers: []
  });
  expect(driftedPlan.snapshotStatus).toBe('blocked');
  expect(driftedPlan.reductions.every(({ status }) => status === 'blocked')).toBe(true);
  expect(() => compileSourceProgramAggregateImportReductionPlan(model, files, {
    sourceRevision: sha256('foreign-source-revision'),
    architecture
  }, {
    typeScriptModel,
    moduleMembership,
    reviewedProcessDispatchers: []
  })).toThrow('does not bind the Source Program revision');
});

function compileGraphCutFixture(
  sources: Readonly<Record<string, string>>,
  descriptorOverrides: Readonly<Record<string, unknown>> = Object.freeze({})
) {
  const descriptorPath = 'src/example/module.json';
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [],
    operationObligations: [],
    causalRelations: [],
    preDependencyBootstrap: false,
    ...descriptorOverrides
  });
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({
      path,
      mode: '100644' as const,
      source,
      contentDigest: rawSha256(source)
    }));
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const sourceRevision = sha256(files.map(({ contentDigest, path }) => ({ contentDigest, path })));
  const typeScriptModel = compileTypeScriptSourceProgramModel({
    sourceRevision,
    files,
    moduleMembership
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership,
    typescriptModel: typeScriptModel
  });
  return Object.freeze({ files, model, typeScriptModel, moduleMembership, sourceRevision });
}

function graphCutContext(fixture: ReturnType<typeof compileGraphCutFixture>) {
  return Object.freeze({
    typeScriptModel: fixture.typeScriptModel,
    moduleMembership: fixture.moduleMembership,
    reviewedProcessDispatchers: Object.freeze([] as string[])
  });
}

function compileGraphCutProviderReceipt(
  fixture: ReturnType<typeof compileGraphCutFixture>,
  candidates: readonly Readonly<{ readonly path: string; readonly name: string }>[]
) {
  return compileSourceProgramUnusedSymbolProviderReceipt({
    model: fixture.model,
    files: fixture.files,
    providerRevision: rawSha256('synthetic-knip-provider-revision'),
    configuration: Object.freeze({
      includedIssueTypes: Object.freeze(['exports', 'types'] as const),
      isShowProgress: false as const
    }),
    settlement: 'completed',
    candidates
  });
}

test('graph cut admits exact provider receipts and requests syntax only for their candidates', () => {
  const fixture = compileGraphCutFixture({
    'tsconfig.json': `${JSON.stringify({ include: ['src/**/*.ts'] })}\n`,
    'src/example/contract.ts': 'export const UNUSED = 1;\n',
    'tests/fixtures/outside-program.ts': 'export const FIXTURE_ONLY = 1;\n'
  });
  expect(fixture.typeScriptModel.files.map(({ path }) => path)).not.toContain(
    'tests/fixtures/outside-program.ts'
  );
  const unrelatedOutsideProgram = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    compileGraphCutProviderReceipt(fixture, [{
      path: 'src/example/contract.ts',
      name: 'UNUSED'
    }]),
    graphCutContext(fixture)
  );
  expect(unrelatedOutsideProgram.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'UNUSED'
  }));

  const outsideCandidate = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    compileGraphCutProviderReceipt(fixture, [{
      path: 'tests/fixtures/outside-program.ts',
      name: 'FIXTURE_ONLY'
    }]),
    graphCutContext(fixture)
  );
  expect(outsideCandidate.reductions).toEqual([expect.objectContaining({
    path: 'tests/fixtures/outside-program.ts',
    name: 'FIXTURE_ONLY',
    status: 'blocked',
    reason: 'declaration source snapshot is unresolved'
  })]);
  const candidates = Object.freeze([Object.freeze({
    path: 'src/example/contract.ts',
    name: 'UNUSED'
  })]);
  expect(() => compileSourceProgramUnusedSymbolProviderReceipt({
    model: fixture.model,
    files: fixture.files,
    providerRevision: 'synthetic-knip' as `sha256:${string}`,
    configuration: Object.freeze({
      includedIssueTypes: Object.freeze(['exports', 'types'] as const),
      isShowProgress: false as const
    }),
    settlement: 'completed',
    candidates
  })).toThrow('completed exact-snapshot provider observation');

  const receipt = compileGraphCutProviderReceipt(fixture, candidates);
  expect(() => compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    { ...receipt },
    graphCutContext(fixture)
  )).toThrow('compiler-issued exact provider candidate receipt');

  const controller = new AbortController();
  const operation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + 30_000,
    signal: controller.signal,
    observePhase: ({ phase, state }) => {
      if (phase === 'reduction-plan' && state === 'start') controller.abort();
    }
  });
  expect(() => compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    receipt,
    { ...graphCutContext(fixture), operation }
  )).toThrow('source-program-compilation-cancelled:reduction-plan');
});

test('graph cut blocks a declaration with same-file type consumers from the canonical Program', () => {
  const fixture = compileGraphCutFixture({
    'src/example/contract.ts': [
      "export type SourceProgramObservationClass = 'observed' | 'unknown';",
      'export interface Observation { readonly observationClass: SourceProgramObservationClass; }',
      ''
    ].join('\n')
  });
  const plan = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    compileGraphCutProviderReceipt(fixture, [{
      path: 'src/example/contract.ts',
      name: 'SourceProgramObservationClass'
    }]),
    graphCutContext(fixture)
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'SourceProgramObservationClass',
    status: 'blocked',
    reason: 'TypeScript Program resolved one or more value, type, alias, or re-export consumers'
  }));
});

test('graph cut keeps Source Program unknown consumer frontiers blocked', () => {
  const fixture = compileGraphCutFixture({
    'src/example/contract.ts': [
      'function register(): number { return 1; }',
      'export const UNUSED = register();',
      'export const KEPT = 2;',
      ''
    ].join('\n')
  });
  const plan = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    compileGraphCutProviderReceipt(fixture, [{
      path: 'src/example/contract.ts',
      name: 'UNUSED'
    }]),
    graphCutContext(fixture)
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'UNUSED',
    status: 'blocked',
    disposition: 'blocked',
    reason: 'canonical Source Program consumer frontier is unknown; unused provider evidence cannot authorize deletion'
  }));
  expect(() => renderSourceProgramGraphCutReductionPatch(plan, fixture.files)).toThrow(
    'Graph-cut patch requires at least one ready reduction'
  );
  const driftedFiles = fixture.files.map((file) => Object.freeze({
    ...file,
    source: `${file.source}// external drift\n`,
    contentDigest: rawSha256(`${file.source}// external drift\n`)
  }));
  expect(() => renderSourceProgramGraphCutReductionPatch(plan, driftedFiles)).toThrow(
    'do not match the compiler-sealed Source Program snapshot'
  );
  expect(() => renderSourceProgramGraphCutReductionPatch({ ...plan }, fixture.files)).toThrow(
    'compiler-issued verified plan'
  );
});

test('graph cut blocks typed required-unmaterialized owner obligations before deletion', () => {
  const fixture = compileGraphCutFixture({
    'src/example/contract.ts': 'export function deliver(): string { return "pending"; }\n'
  }, {
    capabilityProviders: [{
      capability: 'example.delivery',
      operations: ['deliver'],
      effectKinds: [],
      ownerInternalOperations: [],
      operationRoles: []
    }],
    operationObligations: [{
      operation: { kind: 'capability', capability: 'example.delivery', operation: 'deliver' },
      consumerSupport: { consumers: [] },
      effect: {
        kinds: [],
        failureKinds: [],
        recovery: 'not-applicable'
      },
      evolution: {
        migration: 'not-required',
        retirement: 'replacement-obligations-satisfied'
      },
      resources: { aggregateBudgets: [{ resource: 'duration-ms', maximum: 100 }] },
      futureSupport: { condition: 'semantic-superset-required' }
    }]
  });
  const plan = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    compileGraphCutProviderReceipt(fixture, [{
      path: 'src/example/contract.ts',
      name: 'deliver'
    }]),
    graphCutContext(fixture)
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'deliver',
    status: 'blocked',
    disposition: 'required-unmaterialized',
    removalSpan: null,
    requiredUnmaterializedObligations: [expect.objectContaining({
      targetOwner: 'example',
      replacementDag: [
        expect.objectContaining({ node: 'target-closure' }),
        expect.objectContaining({ node: 'obligation-acceptance' }),
        expect.objectContaining({ node: 'source-retirement' })
      ]
    })]
  }));
  expect(() => renderSourceProgramGraphCutReductionPatch(plan, fixture.files)).toThrow(
    'Graph-cut patch requires at least one ready reduction'
  );
});

test('graph cut blocks compiler-resolved cross-file aliases and re-exports', () => {
  const fixture = compileGraphCutFixture({
    'src/example/provider.ts': 'export type SharedContract = { readonly value: string };\n',
    'src/example/facade.ts': "export { type SharedContract } from './provider.ts';\n",
    'src/example/consumer.ts': "import type { SharedContract } from './facade.ts';\nexport const value: SharedContract = { value: 'ok' };\n"
  });
  const plan = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    compileGraphCutProviderReceipt(fixture, [{
      path: 'src/example/provider.ts',
      name: 'SharedContract'
    }]),
    graphCutContext(fixture)
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/provider.ts',
    name: 'SharedContract',
    status: 'blocked',
    reason: 'TypeScript Program resolved one or more value, type, alias, or re-export consumers'
  }));
});
