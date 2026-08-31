import { expect, test } from 'bun:test';
import { applyPatch, parsePatch } from 'diff';

import type { BuildEngineeringIRInput } from '../../compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../compiler/ir/validate-engineering-ir.ts';
import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  compileSecRepositoryModuleArchitectureProjection,
  compileSecRepositoryModuleGraph,
  compileSecRepositoryModuleMembershipSnapshot
} from '../../system-architecture/repository-modules/contract.ts';
import { isSourceProgramInputPath, sourceProgramSurfaceForPath } from './contract.ts';
import {
  buildSourceProgramAggregateImportReductionPatch,
  compileSourceProgramAggregateImportReductionPlan,
  compileSourceProgramGraphCutReductionPlan,
  compileSourceProgramSupersessionEvidence,
  compileSourceProgramSupersessionEvidenceIdentity,
  compileSourceProgramSupersessionReceipt,
  compileSourceProgramTestRetirementReceipt,
  compileSourceProgramVersionSuffixReductionPlan,
  parseSourceProgramSupersessionEvidence,
  projectSourceProgramTestRetirementDispositions,
  renderSourceProgramGraphCutReductionPatch,
  renderSourceProgramVersionSuffixReductionPatch,
  SourceProgramReductionAdmissionError
} from './reduction.ts';
import {
  compileRepositorySourceProgramModel,
  compileSourceProgramOwnerIntentEvidence,
  compileSourceProgramResponsibilityEvidence,
  summarizeSourceProgramTopology
} from './repository.ts';
import {
  compileSourceProgramTestBaselineEvidence,
  compileSourceProgramTestValue,
  reconcileSourceProgramTestValueWithSupersession
} from './test-value.ts';
import {
  compileTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramModelIncremental,
  querySourceProgramModel
} from './typescript.ts';

test('source program classifies catalog-installed code as a resource surface', () => {
  expect(sourceProgramSurfaceForPath(
    'catalog/registry/official/example/files/src/installed/example.ts'
  )).toBe('resource');
  expect(sourceProgramSurfaceForPath('src/example.ts')).toBe('production');
  expect(sourceProgramSurfaceForPath('tests/unit/example.test.ts')).toBe('test');
  expect(sourceProgramSurfaceForPath('examples/reference-workspace/src/example.ts')).toBe('resource');
  expect(sourceProgramSurfaceForPath('source/code/example.ts')).toBe('resource');
});

test('source program input closure excludes target workspaces and generated artifacts', () => {
  expect(isSourceProgramInputPath('src/example.ts')).toBe(true);
  expect(isSourceProgramInputPath('tests/unit/example.test.ts')).toBe(true);
  expect(isSourceProgramInputPath('src/example/sec.module.json')).toBe(true);
  expect(isSourceProgramInputPath('.github/workflows/ci.yml')).toBe(true);
  expect(isSourceProgramInputPath('docs/authority.json')).toBe(true);
  expect(isSourceProgramInputPath(
    'examples/reference-workspace/.sec/artifacts/evidence/review-summary.json'
  )).toBe(false);
  expect(isSourceProgramInputPath('examples/reference-workspace/src/example.ts')).toBe(false);
  expect(isSourceProgramInputPath(
    'catalog/registry/official/example/files/src/installed/example.ts'
  )).toBe(false);
});

test('TypeScript semantic compilation excludes test and resource declarations from the production authority graph', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const files = [
    ['src/example.ts', 'export const productionValue = 1;\n'],
    ['tests/example.test.ts', 'export const mirroredTestValue = 2;\n'],
    ['catalog/registry/official/example/files/src/generated.ts', 'export const generatedResourceValue = 3;\n']
  ].map(([path, source]) => Object.freeze({
    path: path!,
    source: source!,
    contentDigest: rawSha256(source!)
  }));
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });

  expect(model.files.map(({ path }) => path)).toEqual(['src/example.ts']);
  expect(model.declarations.map(({ name }) => name)).toEqual(['productionValue']);
});

test('unbound Source Program facts remain unknown responsibility evidence', () => {
  const sources = new Map([
    [
      'src/public-contract/types.ts',
      "import type { Runtime } from '../runtime-owner/service.ts';\n"
      + 'export interface Contract { readonly runtime: Runtime; }\n'
    ],
    ['src/public-contract/facade.ts', "export type { Contract } from './types.ts';\n"],
    [
      'src/runtime-owner/service.ts',
      'export interface Runtime { readonly ready: boolean; }\n'
      + 'export function run(): Runtime { return { ready: true }; }\n'
    ],
    [
      'src/command-owner/cli.ts',
      "import type { Contract } from '../public-contract/facade.ts';\n"
      + 'export function main(_contract?: Contract): void {}\n'
    ],
    ['src/declared-query/value.ts', 'export function read(): string { return \'value\'; }\n'],
    ['src/looks-like-query/value.ts', 'export function read(): string { return \'value\'; }\n']
  ]);
  const descriptors = [
    {
      root: 'src/public-contract',
      descriptor: { importGraph: 'runtime', externalEntrypoints: [] }
    },
    {
      root: 'src/runtime-owner',
      descriptor: {
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [{ capability: 'runtime.service', operations: ['run'] }]
      }
    },
    {
      root: 'src/command-owner',
      descriptor: {
        importGraph: 'runtime',
        externalEntrypoints: ['src/command-owner/cli.ts']
      }
    },
    {
      root: 'src/declared-query',
      descriptor: { importGraph: 'runtime', externalEntrypoints: [] }
    },
    {
      root: 'src/looks-like-query',
      descriptor: { importGraph: 'runtime', externalEntrypoints: [] }
    }
  ];
  const descriptorSources = descriptors.map(({ root, descriptor }) => ({
    descriptorPath: `${root}/sec.module.json`,
    source: JSON.stringify(descriptor)
  }));
  const membership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...sources.keys(), ...descriptorSources.map(({ descriptorPath }) => descriptorPath)],
    descriptorSources
  });
  const files = [...sources].map(([path, source]) => ({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership: membership
  });
  const graph = compileSecRepositoryModuleGraph({
    files: files.map(({ path }) => path),
    readSource: (path) => sources.get(path) ?? null
  });
  const projection = compileSecRepositoryModuleArchitectureProjection(graph, membership, model);

  expect(model.files).toContainEqual(expect.objectContaining({
    path: 'src/public-contract/facade.ts',
    semanticKind: 'pure-reexport',
    semanticObservationClass: 'derived'
  }));
  expect(model.files).toContainEqual(expect.objectContaining({
    path: 'src/public-contract/types.ts',
    semanticKind: 'declaration-owner',
    semanticObservationClass: 'derived'
  }));
  expect(model.files).toContainEqual(expect.objectContaining({
    path: 'src/runtime-owner/service.ts',
    semanticKind: 'executable',
    semanticObservationClass: 'derived'
  }));
  expect(projection.nodeResponsibilities.map(({ path, responsibility }) => [path, responsibility]))
    .toContainEqual(['src/runtime-owner/service.ts', 'unknown']);
  expect(projection.nodeResponsibilities.map(({ path, responsibility }) => [path, responsibility]))
    .toContainEqual(['src/command-owner/cli.ts', 'unknown']);
  expect(projection.aggregateFacadePaths).toContain('src/public-contract/facade.ts');
  expect(projection.nodeResponsibilities).toContainEqual(expect.objectContaining({
    path: 'src/looks-like-query/value.ts',
    responsibility: 'unknown',
    reason: 'responsibility-evidence-unresolved'
  }));
  expect(projection.violations).not.toContainEqual(expect.objectContaining({
    code: 'repository-node-responsibility-reverse-dependency'
  }));
});

test('Source Program binds validated semantic intent to one exact exported declaration', () => {
  const sourcePath = 'src/example/run.ts';
  const source = 'export function run(): string { return \'ok\'; }\n';
  const descriptorPath = 'src/example/sec.module.json';
  const membership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [sourcePath, descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
    }]
  });
  const files = [{ path: sourcePath, source, contentDigest: rawSha256(source) }];
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  const model = compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership: membership });
  const semanticContract = {
    blockId: 'example/basic',
    contractPath: 'catalog/registry/official/example.basic/contracts/example.yaml',
    contract: {
      formatVersion: '1' as const,
      id: 'example-core',
      namespace: 'example',
      entities: [],
      states: [],
      responsibilities: [{
        id: 'ExampleOperation',
        role: 'legacy prose cannot classify a node',
        bindings: [{
          target: { kind: 'operation' as const, id: 'run' },
          declaration: { path: sourcePath, exportName: 'run' }
        }],
        owns: [],
        implements: ['run'],
        dependsOn: []
      }],
      operations: [{
        id: 'run',
        responsibility: 'ExampleOperation',
        inputs: [], reads: [], writes: [], mutates: [], requiresPolicies: [],
        requiresPermissions: [], performsEffects: [], emits: [], invokes: [], awaits: []
      }],
      events: [], policies: [], permissions: [], effects: [], scenarios: []
    }
  };
  const engineeringInput = (contractInput: typeof semanticContract): BuildEngineeringIRInput => ({
    app: { id: 'responsibility-binding', name: 'Responsibility Binding' },
    resolvedBlocks: [{
      id: 'example/basic', version: '0.1.0', kind: 'capability', installOrder: 1,
      manifestPath: 'catalog/registry/official/example.basic/block.manifest.yaml',
      registrySourceId: 'official', registryKind: 'official', registryLocation: 'compiler',
      registryPath: 'catalog/registry/official'
    }],
    manifests: [{
      blockId: 'example/basic',
      manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
    }],
    acceptanceIds: [],
    policyDeclarations: [],
    semanticContracts: [contractInput]
  });
  const snapshot = buildValidatedEngineeringIR(engineeringInput(semanticContract));
  const responsibilityEvidence = compileSourceProgramResponsibilityEvidence(model, snapshot);
  expect(responsibilityEvidence).toEqual([
    expect.objectContaining({
      responsibilityId: 'responsibility:example:ExampleOperation',
      target: { kind: 'operation', id: 'operation:example:run' },
      declaration: expect.objectContaining({
        path: sourcePath,
        exportName: 'run',
        moduleId: 'example'
      }),
      sourceRevision,
      semanticRevision: snapshot.ir.semanticRevision,
      observationClass: 'observed',
      reason: 'validated'
    })
  ]);
  const graph = compileSecRepositoryModuleGraph({
    files: [sourcePath],
    readSource: () => source
  });
  const projection = compileSecRepositoryModuleArchitectureProjection(graph, membership, {
    ...model,
    semanticRevision: snapshot.ir.semanticRevision,
    responsibilityEvidence
  });
  expect(projection.nodeResponsibilities).toEqual([
    expect.objectContaining({ path: sourcePath, responsibility: 'operation' })
  ]);

  const missingContract = structuredClone(semanticContract);
  missingContract.contract.responsibilities[0]!.bindings![0]!.declaration.exportName = 'missing';
  const missingSnapshot = buildValidatedEngineeringIR(engineeringInput(missingContract));
  expect(compileSourceProgramResponsibilityEvidence(model, missingSnapshot)).toEqual([
    expect.objectContaining({
      observationClass: 'unknown',
      reason: 'exported-declaration-missing'
    })
  ]);

  const conflictingContract = structuredClone(semanticContract);
  conflictingContract.contract.responsibilities.push({
    id: 'DuplicateDeclarationClaim',
    role: 'another prose claim is still not authority',
    bindings: [{
      target: { kind: 'operation', id: 'run' },
      declaration: { path: sourcePath, exportName: 'run' }
    }],
    owns: [],
    implements: [],
    dependsOn: []
  });
  const conflictingSnapshot = buildValidatedEngineeringIR(engineeringInput(conflictingContract));
  expect(compileSourceProgramResponsibilityEvidence(model, conflictingSnapshot)).toEqual([
    expect.objectContaining({
      observationClass: 'unknown',
      reason: 'declaration-binding-conflict'
    }),
    expect.objectContaining({
      observationClass: 'unknown',
      reason: 'declaration-binding-conflict'
    })
  ]);
});

test('source program model finds capability producers, consumers, literals, and opaque paths deterministically', () => {
  const lazyDomainPath = 'src/example/lazy-domain.ts';
  const lazyDomainLoaderPath = 'src/example/lazy-loader.ts';
  const lazySchemaName = 'LAZY_SCHEMA';
  const mirroredSourcePath = 'src/example/index.ts';
  const sources = new Map([
    [
      'src/example/index.ts',
      "export const CAPABILITY_ROUTE = 'external-runtime';\n"
      + "export const UNUSED_SCHEMA = 'opaque-shape';\n"
      + "export const SERVICE_ENDPOINT = 'https://service.example.test/api';\n"
      + 'export function orphanProjection(): string { return CAPABILITY_ROUTE; }\n'
      + 'export function approvedExternalCapability(): string { return CAPABILITY_ROUTE; }\n'
      + 'export function calculateProjectionV1(): string { return CAPABILITY_ROUTE; }\n'
      + 'export const calculatedProjection = calculateProjectionV1();\n'
      + 'function calculatePrivateProjectionV1(): string { return CAPABILITY_ROUTE; }\n'
      + 'export const calculatedPrivateProjection = calculatePrivateProjectionV1();\n'
      + 'export function normalizeInput(): string { return CAPABILITY_ROUTE; }\n'
      + 'export function normalizeInputV1(): string { return normalizeInput(); }\n'
      + 'export const normalizedInput = normalizeInputV1();\n'
      + 'export function dispatchCapability(input: string): boolean {\n'
      + '  return input === CAPABILITY_ROUTE;\n'
      + '}\n'
    ],
    [
      'src/example/consumer.ts',
      "import { dispatchCapability } from './index.ts';\n"
      + "import { REAL_SCHEMA } from './public.ts';\n"
      + "export const accepted = dispatchCapability('external-runtime');\n"
      + 'export const schema = REAL_SCHEMA;\n'
      + `export const sourceAddress = '${mirroredSourcePath}';\n`
      + "export const serviceEndpoint = 'https://service.example.test/api';\n"
    ],
    [
      'src/example/alias-consumer.ts',
      "import { REAL_SCHEMA as REAL_SCHEMA_V2 } from './contract.ts';\n"
      + 'export const aliasSchema = REAL_SCHEMA_V2;\n'
    ],
    [
      'src/example/contract.ts',
      "export const REAL_SCHEMA = 'real-schema';\n"
      + "export const SECOND_UNUSED_SCHEMA = 'opaque-shape';\n"
      + "export const CANONICAL_STEPS = ['first-step', 'second-step', 'third-step'];\n"
    ],
    [
      'src/example/address-consumer.ts',
      `export const sourceAddress = '${mirroredSourcePath}';\n`
    ],
    [
      'src/example/public.ts',
      "export * from './contract.ts';\n"
      + "export { approvedExternalCapability as approvedExternalCapabilityV1 } from './index.ts';\n"
    ],
    [
      'src/example/dynamic.ts',
      'export async function loadCapability(specifier: string) {\n'
      + '  return import(specifier);\n'
      + '}\n'
    ],
    [
      'src/example/dynamic-known.ts',
      'export async function readSchema() {\n'
      + "  const domain = await import('./public.ts');\n"
      + '  return domain.REAL_SCHEMA;\n'
      + '}\n'
    ],
    [
      lazyDomainPath,
      `export const ${lazySchemaName} = 'lazy-schema';\n`
      + `export function buildLazyDomain(): string { return ${lazySchemaName}; }\n`
    ],
    [
      lazyDomainLoaderPath,
      "export function loadLazyDomain() { return import('./lazy-domain.ts'); }\n"
    ],
    [
      'tests/lazy-domain.test.ts',
      `import { ${lazySchemaName} } from '../${lazyDomainPath}';\n`
      + `export const observedLazySchema = ${lazySchemaName};\n`
    ],
    [
      'tests/identity-mirror.test.ts',
      "import { UNUSED_SCHEMA } from '../src/example/index.ts';\n"
      + "expect(UNUSED_SCHEMA).toBe('opaque-shape');\n"
      + `expect(candidatePath).toBe('${mirroredSourcePath}');\n`
    ],
    [
      'tests/collection-mirror.test.ts',
      "import { CANONICAL_STEPS } from '../src/example/contract.ts';\n"
      + "expect(CANONICAL_STEPS).toEqual(['first-step', 'second-step', 'third-step']);\n"
    ],
    [
      'src/example/fs.ts',
      "import { readFile } from 'node:fs/promises';\n"
      + "export const read = () => readFile('input.txt');\n"
    ],
    [
      'src/example/network.ts',
      "import { fetch } from 'remote-fetch';\n"
      + "export const request = () => fetch('https://example.test');\n"
    ],
    [
      'src/example/embedded.ts',
      "export const hiddenSource = `import { value } from './value.ts';\\nexport const generated = value;\\n`;\n"
    ],
    [
      'src/example/cli.ts',
      "import { Command } from 'commander';\n"
      + "import { spawnSync } from 'node:child_process';\n"
      + "new Command().command('inspect').action(() => spawnSync('git', ['status']));\n"
    ]
  ]);
  const packageManifest = {
    name: 'example-repository',
    private: true,
    source: './src/example/cli.ts',
    scripts: {
      inspect: 'bun ./src/example/cli.ts',
      alias: 'bun run inspect',
      opaque: 'bun run inspect && echo done',
      missing: 'bun run absent',
      'cycle-a': 'bun run cycle-b',
      'cycle-b': 'bun run cycle-a'
    },
    bin: { inspect: './dist/index.js' },
    dependencies: {
      commander: '^14.0.3',
      'remote-fetch': '^1.0.0'
    }
  };
  const packageSource = JSON.stringify(packageManifest);
  const repositoryFiles = [
    'package.json',
    'src/example/sec.module.json',
    ...sources.keys()
  ];
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles,
    descriptorSources: [{
      descriptorPath: 'src/example/sec.module.json',
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [{
          capability: 'example.api',
          operations: ['approvedExternalCapability', 'dispatchCapability', 'missingOperation']
        }]
      })
    }]
  });
  const files = [...sources, ['package.json', packageSource] as const].map(([path, source]) => ({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = rawSha256(JSON.stringify(
    files.map(({ contentDigest, path }) => ({ path, contentDigest }))
  ));
  const compile = (orderedFiles: typeof files) => compileRepositorySourceProgramModel({
    sourceRevision,
    files: orderedFiles,
    moduleMembership
  });

  const model = compile(files);
  const tcbReviewedModel = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership,
    reviewedProcessDispatchers: ['src/example/cli.ts::spawnSync:git']
  });
  expect(tcbReviewedModel.candidates).toContainEqual(expect.objectContaining({
    code: 'direct-process-transport-outside-owner',
    subject: 'src/example/cli.ts'
  }));
  expect(new Set(model.candidates.map((candidate) => sha256(candidate))).size)
    .toBe(model.candidates.length);
  const versionReductionPlan = compileSourceProgramVersionSuffixReductionPlan(model, files);
  const versionReductionPatch = renderSourceProgramVersionSuffixReductionPatch(
    versionReductionPlan,
    files
  );
  const reordered = compile([...files].reverse());
  expect(reordered.modelDigest).toBe(model.modelDigest);
  expect(model.declarations).toContainEqual(expect.objectContaining({
    exported: true,
    kind: 'ExportSpecifier',
    name: 'approvedExternalCapabilityV1',
    path: 'src/example/public.ts'
  }));
  expect(versionReductionPlan.reductions).toContainEqual(expect.objectContaining({
    status: 'ready',
    currentName: 'calculateProjectionV1',
    proposedName: 'calculateProjection'
  }));
  expect(versionReductionPlan.reductions).toContainEqual(expect.objectContaining({
    status: 'ready',
    currentName: 'calculatePrivateProjectionV1',
    proposedName: 'calculatePrivateProjection'
  }));
  expect(versionReductionPlan.reductions).toContainEqual(expect.objectContaining({
    status: 'ready',
    currentName: 'REAL_SCHEMA_V2',
    proposedName: 'REAL_SCHEMA'
  }));
  expect(versionReductionPlan.reductions).not.toContainEqual(expect.objectContaining({
    currentName: 'normalizeInputV1'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'versioned-declaration-conflicts-with-canonical-name',
    subject: 'approvedExternalCapabilityV1'
  }));
  expect(versionReductionPatch.patch).toContain('--- a/src/example/index.ts');
  expect(versionReductionPatch.patch).toContain('+++ b/src/example/index.ts');
  expect(versionReductionPatch.patch).toContain('--- a/src/example/alias-consumer.ts');
  const indexPatch = parsePatch(versionReductionPatch.patch).find(({ oldFileName }) =>
    oldFileName === 'a/src/example/index.ts');
  expect(indexPatch).toBeDefined();
  const reducedSource = applyPatch(
    sources.get('src/example/index.ts')!,
    indexPatch!
  );
  expect(reducedSource).not.toBe(false);
  expect(reducedSource).toContain('function calculateProjection()');
  expect(reducedSource).not.toContain('calculateProjectionV1');
  const unboundPackageSource = JSON.stringify({ ...packageManifest, source: undefined });
  const unboundFiles = files.map((file) => file.path === 'package.json'
    ? { ...file, source: unboundPackageSource, contentDigest: rawSha256(unboundPackageSource) }
    : file);
  const unboundModel = compileRepositorySourceProgramModel({
    sourceRevision: sha256(unboundFiles.map(({ contentDigest, path }) => ({ contentDigest, path }))),
    files: unboundFiles,
    moduleMembership
  });

  const capability = querySourceProgramModel(model, 'dispatchCapability');
  expect(capability.declarations.map(({ name }) => name)).toContain('dispatchCapability');
  expect(capability.references.some(({ kind, path, targetPath }) =>
    kind === 'call'
    && path === 'src/example/consumer.ts'
    && targetPath === 'src/example/index.ts'
  )).toBe(true);

  const route = querySourceProgramModel(model, 'external-runtime');
  expect(new Set(route.literals.map(({ context }) => context)).has('producer')).toBe(true);
  expect(route.literals.some(({ path }) => path === 'src/example/consumer.ts')).toBe(true);
  expect(model.unknowns).toContainEqual(expect.objectContaining({
    code: 'dynamic-module-unresolved',
    path: 'src/example/dynamic.ts'
  }));
  expect(model.references).toContainEqual(expect.objectContaining({
    kind: 'import',
    name: '*',
    path: lazyDomainLoaderPath,
    targetPath: lazyDomainPath,
    observationClass: 'observed'
  }));
  expect(model.references).toContainEqual(expect.objectContaining({
    kind: 'import',
    moduleSpecifier: './index.ts'
  }));
  expect(model.candidates).not.toContainEqual(expect.objectContaining({
    code: 'production-declaration-only-test-consumers',
    subject: lazySchemaName
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'versioned-declaration-without-coexisting-version',
    subject: 'calculateProjectionV1',
    paths: ['src/example/index.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'versioned-declaration-conflicts-with-canonical-name',
    subject: 'normalizeInputV1',
    paths: ['src/example/index.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'test-mirrors-production-identity-literal',
    subject: 'UNUSED_SCHEMA',
    paths: ['src/example/index.ts', 'tests/identity-mirror.test.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'test-mirrors-production-literal-collection',
    subject: 'CANONICAL_STEPS',
    paths: ['src/example/contract.ts', 'tests/collection-mirror.test.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'duplicate-production-identity-token',
    subject: 'opaque-shape',
    paths: ['src/example/contract.ts', 'src/example/index.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'duplicate-production-endpoint-literal',
    subject: 'https://service.example.test/api',
    paths: ['src/example/consumer.ts', 'src/example/index.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'production-embeds-executable-source-text',
    paths: ['src/example/embedded.ts']
  }));
  expect(model.entrypoints).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'package-script', name: 'inspect' }),
    expect.objectContaining({
      kind: 'package-script',
      name: 'alias',
      targetEntrypoints: ['package-script:package.json#inspect']
    }),
    expect.objectContaining({
      kind: 'package-bin',
      name: 'inspect',
      targetPaths: ['dist/index.js'],
      targetEntrypoints: ['package-script:package.json#inspect'],
      observationClass: 'derived'
    }),
    expect.objectContaining({ kind: 'cli-command', name: 'inspect' })
  ]));
  expect(unboundModel.unknowns).toContainEqual(expect.objectContaining({
    code: 'generated-output-unresolved',
    path: 'package.json',
    detail: expect.stringContaining('dist/index.js')
  }));
  expect(unboundModel.candidates).toContainEqual(expect.objectContaining({
    code: 'generated-output-unresolved',
    subject: 'package-bin:package.json#inspect',
    paths: ['dist/index.js', 'package.json']
  }));
  expect(model.candidates).not.toContainEqual(expect.objectContaining({
    code: 'generated-output-unresolved',
    subject: 'package-bin:package.json#inspect'
  }));
  expect(model.entrypointClosures).toContainEqual(expect.objectContaining({
    name: 'inspect',
    targetPaths: ['src/example/cli.ts'],
    handlerModuleIds: ['example'],
    capabilityPaths: ['src/example/cli.ts'],
    transports: ['native-runtime']
  }));
  expect(model.entrypointClosures).toContainEqual(expect.objectContaining({
    name: 'alias',
    targetPaths: ['src/example/cli.ts']
  }));
  expect(model.dependencies).toContainEqual(expect.objectContaining({
    name: 'commander',
    consumerPaths: ['src/example/cli.ts']
  }));
  expect(model.unknowns).not.toContainEqual(expect.objectContaining({
    code: 'external-module-opaque',
    detail: 'commander'
  }));
  expect(model.unknowns).not.toContainEqual(expect.objectContaining({
    code: 'external-module-opaque',
    detail: 'node:child_process'
  }));
  expect(model.capabilities).toContainEqual(expect.objectContaining({
    capability: 'process',
    operation: 'spawnSync',
    subject: 'git',
    moduleId: 'example',
    moduleSpecifier: 'node:child_process',
    transport: 'native-runtime'
  }));
  expect(model.capabilities).toContainEqual(expect.objectContaining({
    capability: 'filesystem',
    operation: 'readFile',
    moduleSpecifier: 'node:fs/promises',
    transport: 'runtime-built-in-api'
  }));
  expect(model.capabilities).toContainEqual(expect.objectContaining({
    capability: 'network',
    operation: 'fetch',
    moduleSpecifier: 'remote-fetch',
    transport: 'package-api'
  }));
  expect(model.capabilities).toContainEqual(expect.objectContaining({
    capability: 'provider',
    operation: 'dispatchCapability',
    providerCapability: 'example.api',
    providerModuleId: 'example',
    transport: 'repository-provider'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'direct-process-transport-outside-owner',
    subject: 'src/example/cli.ts',
    paths: ['src/example/cli.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'capability-provider-operation-unresolved',
    subject: 'example.api:missingOperation'
  }));
  expect(model.candidates).not.toContainEqual(expect.objectContaining({
    code: 'capability-provider-operation-unresolved',
    subject: 'example.api:dispatchCapability'
  }));
  expect(model.unknowns.map(({ code }) => code)).toEqual(expect.arrayContaining([
    'package-script-cycle',
    'package-script-shell-opaque',
    'package-script-target-unresolved'
  ]));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'production-declaration-only-test-consumers',
    subject: 'UNUSED_SCHEMA'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'production-declaration-without-consumer',
    subject: 'orphanProjection',
    paths: ['src/example/index.ts']
  }));
  expect(model.candidates).not.toContainEqual(expect.objectContaining({
    code: 'production-declaration-without-consumer',
    subject: 'approvedExternalCapability'
  }));
  expect(model.candidates).not.toContainEqual(expect.objectContaining({
    code: 'identity-token-without-consumer',
    subject: 'REAL_SCHEMA'
  }));
  expect(model.references).toContainEqual(expect.objectContaining({
    path: 'src/example/dynamic-known.ts',
    name: 'REAL_SCHEMA',
    targetPath: 'src/example/contract.ts'
  }));
  expect(summarizeSourceProgramTopology(model)).toEqual(expect.objectContaining({
    packages: 1,
    directProcessTransportPaths: 1,
    dependencyScopes: { runtime: 2 },
    entrypointRoles: expect.objectContaining({
      'package-operation': 6,
      'product-cli-operation': 1
    }),
    entrypointHandlerModules: expect.objectContaining({
      'example': 5
    }),
    capabilityAuthorityClasses: expect.objectContaining({
      'repository-provider': 1,
      'runtime-built-in-api': 1,
      'external-package-api': 1,
      'unresolved-transport': 1
    }),
    providerModules: expect.objectContaining({
      'example': 1,
      'node:fs/promises': 1,
      'remote-fetch': 1,
      '<unresolved>': 1
    }),
    candidateCodes: expect.objectContaining({
      'capability-provider-operation-unresolved': 1,
      'direct-process-transport-outside-owner': 1
    })
  }));
});

test('source program blocks owner-internal process primitives at repository provider boundaries', () => {
  const providerPath = 'src/physical-provider/process.ts';
  const consumerPath = 'src/consumer/run.ts';
  const descriptorPath = 'src/physical-provider/sec.module.json';
  const files = [
    {
      path: providerPath,
      source: 'export function nativePrimitive(): void {}\n'
    },
    {
      path: consumerPath,
      source: "import { nativePrimitive } from '../physical-provider/process.ts';\nnativePrimitive();\n"
    }
  ].map(({ path, source }) => ({ path, source, contentDigest: rawSha256(source) }));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [descriptorPath, 'src/consumer/sec.module.json', ...files.map(({ path }) => path)],
    descriptorSources: [
      {
        descriptorPath,
        source: JSON.stringify({
          importGraph: 'runtime',
          externalEntrypoints: [],
          capabilityProviders: [{
            capability: 'process.native',
            operations: ['nativePrimitive'],
            effectKinds: ['process'],
            ownerInternalOperations: ['nativePrimitive']
          }]
        })
      },
      {
        descriptorPath: 'src/consumer/sec.module.json',
        source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
      }
    ]
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision: rawSha256(JSON.stringify(files.map(({ path, contentDigest }) => ({
      path,
      contentDigest
    })))),
    files,
    moduleMembership
  });

  expect(model.capabilities).toContainEqual(expect.objectContaining({
    path: consumerPath,
    operation: 'nativePrimitive',
    providerCapability: 'process.native',
    providerModuleId: 'physical-provider',
    transport: 'repository-provider'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'direct-process-transport-outside-owner',
    subject: consumerPath,
    paths: [consumerPath]
  }));
});

// Exact compiler equivalence boundary: an incremental answer must equal a clean full compile.
test('incremental source facts invalidate the reverse consumer closure and remain byte-equivalent to full compilation', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const sourceInput = (sources: Readonly<Record<string, string>>) => {
    const files = Object.entries(sources)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
    return Object.freeze({
      sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
      files,
      moduleMembership
    });
  };
  const initialInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 1;\n'
  });
  const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
  expect(initial.mode).toBe('full');

  const changedBytesWithStaleDeclaredDigest = Object.freeze({
    ...initialInput,
    files: Object.freeze(initialInput.files.map((file) => file.path === 'src/example/contract.ts'
      ? Object.freeze({ ...file, source: 'export const VALUE = 3;\n' })
      : file))
  });
  const changedBytes = compileTypeScriptSourceProgramModelIncremental(
    changedBytesWithStaleDeclaredDigest,
    initial.state
  );
  expect(changedBytes.mode).toBe('incremental');
  expect(changedBytes.invalidatedPaths).toEqual([
    'src/example/consumer.ts',
    'src/example/contract.ts'
  ]);
  expect(changedBytes.model).toEqual(
    compileTypeScriptSourceProgramModel(changedBytesWithStaleDeclaredDigest)
  );

  const exact = compileTypeScriptSourceProgramModelIncremental(initialInput, initial.state);
  expect(exact.mode).toBe('exact');
  expect(exact.invalidatedPaths).toEqual([]);
  expect(exact.model).toEqual(compileTypeScriptSourceProgramModel(initialInput));

  const foreignProviderState = Object.freeze({
    ...exact.state,
    providerRevision: sha256('foreign-typescript-workspace-generation')
  });
  const providerChanged = compileTypeScriptSourceProgramModelIncremental(
    initialInput,
    foreignProviderState
  );
  expect(providerChanged.mode).toBe('full');
  expect(providerChanged.invalidatedPaths).toEqual([
    'src/example/consumer.ts',
    'src/example/contract.ts',
    'src/example/leaf.ts'
  ]);
  expect(providerChanged.model).toEqual(compileTypeScriptSourceProgramModel(initialInput));

  const leafInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 2;\n'
  });
  const leaf = compileTypeScriptSourceProgramModelIncremental(leafInput, initial.state);
  expect(leaf.mode).toBe('incremental');
  expect(leaf.invalidatedPaths).toEqual(['src/example/leaf.ts']);
  expect(leaf.model).toEqual(compileTypeScriptSourceProgramModel(leafInput));

  const contractInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 2;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 2;\n'
  });
  const contract = compileTypeScriptSourceProgramModelIncremental(contractInput, leaf.state);
  expect(contract.mode).toBe('incremental');
  expect(contract.invalidatedPaths).toEqual([
    'src/example/consumer.ts',
    'src/example/contract.ts'
  ]);
  expect(contract.model).toEqual(compileTypeScriptSourceProgramModel(contractInput));
});

test('reduction compiler resolves pure aggregate modules to declaration owners', () => {
  const sources = new Map([
    ['src/provider/facade.ts', "export { execute } from './operation.ts';\n"],
    ['src/provider/operation.ts', 'export function execute(): string { return \'ok\'; }\n'],
    ['src/consumer/use.ts', "import { execute } from '../provider/facade.ts';\nexport const result = execute();\n"]
  ]);
  const descriptorSources = ['src/provider', 'src/consumer'].map((root) => ({
    descriptorPath: `${root}/sec.module.json`,
    source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
  }));
  const repositoryFiles = [...sources.keys(), ...descriptorSources.map(({ descriptorPath }) => descriptorPath)];
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles,
    descriptorSources
  });
  const files = [...sources].map(([path, source]) => ({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = rawSha256(JSON.stringify(
    files.map(({ contentDigest, path }) => ({ path, contentDigest }))
  ));
  const model = compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership });
  const moduleGraph = compileSecRepositoryModuleGraph({
    files: [...sources.keys()],
    readSource: (repositoryPath) => sources.get(repositoryPath) ?? null
  });
  const architecture = compileSecRepositoryModuleArchitectureProjection(
    moduleGraph,
    moduleMembership,
    model
  );
  const plan = compileSourceProgramAggregateImportReductionPlan(model, files, {
    sourceRevision,
    architecture
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
    unknowns: [{
      code: 'working-tree-changed-during-source-program-census',
      path: '.',
      detail: 'synthetic drift',
      span: null
    }]
  });
  const driftedArchitecture = compileSecRepositoryModuleArchitectureProjection(
    moduleGraph,
    moduleMembership,
    driftedModel
  );
  const driftedPlan = compileSourceProgramAggregateImportReductionPlan(driftedModel, files, {
    sourceRevision,
    architecture: driftedArchitecture
  });
  expect(driftedPlan.snapshotStatus).toBe('blocked');
  expect(driftedPlan.reductions.every(({ status }) => status === 'blocked')).toBe(true);
  expect(() => compileSourceProgramAggregateImportReductionPlan(model, files, {
    sourceRevision: sha256('foreign-source-revision'),
    architecture
  })).toThrow('does not bind the Source Program revision');
});

function compileGraphCutFixture(sources: Readonly<Record<string, string>>) {
  const descriptorPath = 'src/example/sec.module.json';
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [],
    operationObligations: [],
    preDependencyBootstrap: false
  });
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const sourceRevision = sha256(files.map(({ contentDigest, path }) => ({ contentDigest, path })));
  const model = compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership });
  return Object.freeze({ files, model, moduleMembership, sourceRevision });
}

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
    [{
      path: 'src/example/contract.ts',
      name: 'SourceProgramObservationClass',
      provider: 'knip',
      providerRevision: 'synthetic-knip'
    }],
    { moduleMembership: fixture.moduleMembership, reviewedProcessDispatchers: [] }
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'SourceProgramObservationClass',
    status: 'blocked',
    reason: 'TypeScript Program resolved one or more value, type, alias, or re-export consumers'
  }));
});

test('graph cut verifies one consumer-zero declaration against a virtual exact Program', () => {
  const fixture = compileGraphCutFixture({
    'src/example/contract.ts': 'export const UNUSED = 1;\nexport const KEPT = 2;\n'
  });
  const plan = compileSourceProgramGraphCutReductionPlan(
    fixture.model,
    fixture.files,
    [{
      path: 'src/example/contract.ts',
      name: 'UNUSED',
      provider: 'knip',
      providerRevision: 'synthetic-knip'
    }],
    { moduleMembership: fixture.moduleMembership, reviewedProcessDispatchers: [] }
  );
  const patch = renderSourceProgramGraphCutReductionPatch(plan, fixture.files);

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'UNUSED',
    status: 'ready',
    reason: null
  }));
  expect(patch.patch).toContain('-export const UNUSED = 1;');
  expect(patch.patch).toContain('export const KEPT');
  expect(patch.files).toEqual([expect.objectContaining({
    path: 'src/example/contract.ts',
    afterDigest: rawSha256('export const KEPT = 2;\n')
  })]);
  const changedFiles = fixture.files.map((file) => Object.freeze({
    ...file,
    source: `${file.source}// external drift\n`,
    contentDigest: rawSha256(`${file.source}// external drift\n`)
  }));
  try {
    renderSourceProgramGraphCutReductionPatch(plan, changedFiles);
    throw new Error('expected graph-cut source snapshot drift to block');
  } catch (error) {
    expect(error).toBeInstanceOf(SourceProgramReductionAdmissionError);
    expect((error as SourceProgramReductionAdmissionError).code).toBe('source-snapshot-drift');
  }
  try {
    renderSourceProgramGraphCutReductionPatch({ ...plan }, fixture.files);
    throw new Error('expected forged graph-cut plan to block');
  } catch (error) {
    expect(error).toBeInstanceOf(SourceProgramReductionAdmissionError);
    expect((error as SourceProgramReductionAdmissionError).code).toBe('compiler-issued-plan-required');
  }
});

test('graph cut blocks a consumer-zero declaration whose body changes reference semantics', () => {
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
    [{
      path: 'src/example/contract.ts',
      name: 'UNUSED',
      provider: 'knip',
      providerRevision: 'synthetic-knip'
    }],
    { moduleMembership: fixture.moduleMembership, reviewedProcessDispatchers: [] }
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/contract.ts',
    name: 'UNUSED',
    status: 'blocked',
    reason: 'virtual graph cut changes declarations, references, entrypoints, or capability semantics'
  }));
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
    [{
      path: 'src/example/provider.ts',
      name: 'SharedContract',
      provider: 'knip',
      providerRevision: 'synthetic-knip'
    }],
    { moduleMembership: fixture.moduleMembership, reviewedProcessDispatchers: [] }
  );

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    path: 'src/example/provider.ts',
    name: 'SharedContract',
    status: 'blocked',
    reason: 'TypeScript Program resolved one or more value, type, alias, or re-export consumers'
  }));
});

function compileSupersessionFixture(
  sources: Readonly<Record<string, string>>,
  declareIntent = true,
  declareObligation = declareIntent
) {
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: declareIntent
      ? [{ capability: 'example-operation', operations: ['execute'] }]
      : [],
    operationObligations: declareIntent && declareObligation
      ? [{
          operation: {
            kind: 'capability',
            capability: 'example-operation',
            operation: 'execute'
          },
          consumerSupport: { consumers: [] },
          effect: { kinds: [], failureKinds: [], recovery: 'not-applicable' },
          evolution: {
            migration: 'not-required',
            retirement: 'replacement-obligations-satisfied'
          },
          resources: {
            aggregateBudgets: [{ resource: 'duration-ms', maximum: 30_000 }]
          },
          futureSupport: { condition: 'semantic-superset-required' }
        }]
      : [],
    preDependencyBootstrap: false
  });
  const descriptorPath = 'src/example/sec.module.json';
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
  const membership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const sourceRevision = rawSha256(JSON.stringify(
    files.map(({ contentDigest, path }) => ({ path, contentDigest }))
  ));
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership: membership
  });
  const tests = compileSourceProgramTestValue({
    repositoryRoot: 'C:/synthetic/repository',
    files,
    model
  });
  const full = Object.freeze({
    model,
    tests,
    intentEvidence: compileSourceProgramOwnerIntentEvidence(model, membership)
  });
  const inputDigest = sha256({
    paths: files.map(({ path, contentDigest }) => ({ path, contentDigest })),
    descriptorSource
  });
  const identityInput = Object.freeze({
    revisionDigest: sha256({ revision: sourceRevision }),
    treeDigest: sourceRevision,
    toolchainDigest: sha256({ toolchain: 'synthetic-typescript-compiler' }),
    configurationDigest: inputDigest
  });
  const identity = compileSourceProgramSupersessionEvidenceIdentity(identityInput);
  return Object.freeze({
    files,
    membership,
    full,
    identityInput,
    identity,
    evidence: compileSourceProgramSupersessionEvidence({
      ...full,
      identity
    })
  });
}

function compileSupersessionSnapshot(
  sources: Readonly<Record<string, string>>,
  declareIntent = true,
  declareObligation = declareIntent
) {
  return compileSupersessionFixture(sources, declareIntent, declareObligation).evidence;
}

test('supersession proves a renamed implementation only through the same owner and semantic graph', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/legacy.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/legacy.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });
  const current = compileSupersessionSnapshot({
    'src/example/current.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/current.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('equivalent');
  expect(receipt.findings).toEqual([]);
  expect(receipt.replacements.find(({ kind }) => kind === 'production')).toEqual(
    expect.objectContaining({
      baselinePaths: ['src/example/legacy.ts'],
      currentPaths: ['src/example/current.ts'],
      proof: 'exact-semantic-obligation'
    })
  );
});

function compileTestRetirementFixture(
  baselineTestSource: string,
  productionSource = "export const value = 'ok';\n"
) {
  const baseline = compileSupersessionFixture({
    'src/example/operation.ts': productionSource,
    'tests/obsolete.test.ts': baselineTestSource
  });
  const current = compileSupersessionFixture({
    'src/example/operation.ts': productionSource
  });
  const baselineTestPaths = ['tests/obsolete.test.ts'];
  const baselineEvidence = compileSourceProgramTestBaselineEvidence(
    baselineTestPaths,
    baseline.files,
    baseline.evidence.identity.sourceRevision,
    current.files
  );
  const currentTests = compileSourceProgramTestValue({
    repositoryRoot: 'C:/synthetic/repository',
    files: current.files,
    model: current.full.model,
    baselineTestPaths,
    baselineEvidence
  });
  const currentEvidence = compileSourceProgramSupersessionEvidence({
    model: current.full.model,
    tests: currentTests,
    intentEvidence: current.full.intentEvidence,
    identity: current.identity
  });
  const supersession = compileSourceProgramSupersessionReceipt({
    baseline: baseline.evidence,
    current: currentEvidence
  });
  const observedProjection = reconcileSourceProgramTestValueWithSupersession(
    currentTests,
    supersession
  );
  const retirement = compileSourceProgramTestRetirementReceipt({
    baseline: baseline.evidence,
    current: currentEvidence,
    supersession,
    currentModel: current.full.model,
    currentTestCompilation: currentTests,
    baselineFiles: baseline.files,
    currentFiles: current.files
  });
  return Object.freeze({ observedProjection, retirement });
}

test('test retirement derives DELETE only from one compiler-issued consumer-zero receipt', () => {
  const fixture = compileTestRetirementFixture('// obsolete module with no observable contract\n');
  const proof = fixture.retirement.proofs[0]!;
  const projection = projectSourceProgramTestRetirementDispositions(
    fixture.observedProjection,
    fixture.retirement
  );

  expect(proof).toEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts',
    status: 'retired',
    reason: null,
    census: { producerCount: 0, consumerCount: 0, externalContractCount: 0 },
    observationClasses: [],
    consumerEvidence: [],
    unknownEvidence: []
  }));
  expect(projection.dispositions).toContainEqual(expect.objectContaining({
    path: 'tests/obsolete.test.ts',
    disposition: 'delete',
    evidence: expect.objectContaining({
      replacementTestIds: [],
      supersession: expect.objectContaining({ proof: 'consumer-zero' })
    })
  }));
  expect(projection.findings.some(({ path, code }) =>
    path === 'tests/obsolete.test.ts' && code === 'test-module-disposition-unknown')).toBe(false);
  expect(() => projectSourceProgramTestRetirementDispositions(
    fixture.observedProjection,
    { ...fixture.retirement }
  )).toThrow('compiler-issued exact receipt');
});

test('test retirement blocks real consumers, path contracts, dynamic imports, and parse unknowns', () => {
  const fixtures = [
    compileTestRetirementFixture(
      "import { value } from '../src/example/operation.ts';\nvoid value;\n"
    ),
    compileTestRetirementFixture(
      '// test path is consumed by the production registry\n',
      "export const retiredPath = 'tests/obsolete.test.ts';\n"
    ),
    compileTestRetirementFixture(
      "const target = '../src/example/operation.ts';\nvoid import(target);\n"
    ),
    compileTestRetirementFixture('export const malformed = ;\n')
  ];

  expect(fixtures.map(({ retirement }) => retirement.proofs[0]?.status))
    .toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
  expect(fixtures.map(({ retirement }) => retirement.proofs[0]?.reason))
    .toEqual([
      'consumer-closure-not-empty',
      'consumer-closure-not-empty',
      'consumer-closure-not-empty',
      'consumer-closure-not-empty'
    ]);
  for (const fixture of fixtures) {
    const projection = projectSourceProgramTestRetirementDispositions(
      fixture.observedProjection,
      fixture.retirement
    );
    expect(projection.dispositions).toContainEqual(expect.objectContaining({
      path: 'tests/obsolete.test.ts',
      disposition: 'unknown'
    }));
  }
});

test('test retirement preserves behavior, Effect, durable, failure, and algorithm observations', () => {
  const fixtures = [
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('behavior', () => expect(execute()).toBe('ok'));\n",
      "export function execute(): string { return 'ok'; }\n"
    ),
    compileTestRetirementFixture(
      "import { test } from 'bun:test';\nimport { readFile } from 'node:fs/promises';\ntest('effect', async () => { await readFile('state'); });\n"
    ),
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\nimport { readFile, writeFile } from 'node:fs/promises';\ntest('durable', async () => { await writeFile('state', 'x'); expect(await readFile('state', 'utf8')).toBe('x'); });\n"
    ),
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\ntest('failure', () => expect(() => { throw new Error('failure'); }).toThrow());\n"
    ),
    compileTestRetirementFixture(
      "import { expect, test } from 'bun:test';\ntest('property', () => { for (const value of [1, 2]) expect(value).toBeGreaterThan(0); });\n"
    )
  ];
  const classes = fixtures.map(({ retirement }) => retirement.proofs[0]!.observationClasses);

  expect(classes[0]).toContain('behavior');
  expect(classes[1]).toContain('effect');
  expect(classes[2]).toEqual(expect.arrayContaining(['durable-state', 'effect']));
  expect(classes[3]).toContain('failure-boundary');
  expect(classes[4]).toContain('algorithm-property');
  expect(fixtures.every(({ retirement }) => retirement.proofs[0]?.status === 'blocked')).toBe(true);
});

test('supersession evidence is compact, deterministic, and reusable by exact ActionKey', () => {
  const declarations = Array.from({ length: 96 }, (_, index) =>
    `export function operation${index}(value: number): number { return value + ${index}; }`)
    .join('\n');
  const fixture = compileSupersessionFixture({
    'src/example/operations.ts': `${declarations}\n`,
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { operation0 } from '../src/example/operations.ts';\ntest('executes', () => expect(operation0(1)).toBe(1));\n"
  });
  const replay = compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: fixture.identity
  });
  const identityFields = Object.keys(fixture.identityInput) as (keyof typeof fixture.identityInput)[];
  const changedEvidence = identityFields.map((field) => compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: compileSourceProgramSupersessionEvidenceIdentity(Object.freeze({
      ...fixture.identityInput,
      [field]: sha256({ field, previous: fixture.identityInput[field] })
    }))
  }));
  const { evidenceDigest: _evidenceDigest, ...validEvidence } = fixture.evidence;
  const malformedCanonical = Object.freeze({
    ...validEvidence,
    duplicateProjection: fixture.evidence.productionUnits
  });
  const malformedEvidence = Object.freeze({
    ...malformedCanonical,
    evidenceDigest: sha256(malformedCanonical)
  });
  const fullBytes = Buffer.byteLength(JSON.stringify(fixture.full));
  const compactBytes = Buffer.byteLength(JSON.stringify(fixture.evidence));

  expect(replay).toEqual(fixture.evidence);
  expect(replay.actionKey).toBe(fixture.evidence.actionKey);
  expect(new Set([
    fixture.evidence.actionKey,
    ...changedEvidence.map(({ actionKey }) => actionKey)
  ]).size).toBe(identityFields.length + 1);
  expect(changedEvidence.every(({ evidenceDigest }) =>
    evidenceDigest !== fixture.evidence.evidenceDigest)).toBe(true);
  expect(() => compileSourceProgramSupersessionEvidence({
    ...fixture.full,
    identity: Object.freeze({
      ...fixture.identity,
      schemaDigest: sha256({ foreignSchema: fixture.identity.schemaDigest })
    })
  })).toThrow('exact revision-bound inputs');
  expect(compactBytes).toBeLessThan(fullBytes / 2);
  expect(compileSourceProgramSupersessionReceipt({
    baseline: malformedEvidence,
    current: fixture.evidence
  }).findings).toContainEqual(expect.objectContaining({
    code: 'baseline-evidence-invalid'
  }));
  expect(compileSourceProgramSupersessionReceipt({
    baseline: fixture.evidence,
    current: replay
  })).toEqual(compileSourceProgramSupersessionReceipt({
    baseline: replay,
    current: fixture.evidence
  }));
});

test('supersession evidence rejects a caller-forged observation that expands owner intent', () => {
  const evidence = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });
  const owner = evidence.intentEvidence[0]!;
  const original = owner.operationObligations[0]!;
  const observation = Object.freeze({
    ...original.observation,
    effectKinds: Object.freeze(['process'])
  });
  const forgedObligationCanonical = Object.freeze({
    obligation: original.obligation,
    observation
  });
  const forgedObligation = Object.freeze({
    ...forgedObligationCanonical,
    evidenceDigest: sha256(forgedObligationCanonical)
  });
  const forgedOwnerCanonical = Object.freeze({
    owner: owner.owner,
    capabilityEnvelope: owner.capabilityEnvelope,
    publicEntrypointEnvelope: owner.publicEntrypointEnvelope,
    operationObligations: Object.freeze([forgedObligation])
  });
  const forgedOwner = Object.freeze({
    ...forgedOwnerCanonical,
    evidenceDigest: sha256(forgedOwnerCanonical)
  });
  const intentEvidence = Object.freeze([forgedOwner]);
  const source = Object.freeze({
    ...evidence.source,
    intentEvidenceDigest: sha256(intentEvidence)
  });
  const { evidenceDigest: _digest, ...withoutDigest } = evidence;
  const forgedCanonical = Object.freeze({
    ...withoutDigest,
    actionKey: sha256({ identity: evidence.identity, source }),
    source,
    intentEvidence
  });
  const forged = Object.freeze({
    ...forgedCanonical,
    evidenceDigest: sha256(forgedCanonical)
  });

  expect(() => parseSourceProgramSupersessionEvidence(forged))
    .toThrow('not canonical or action-bound');
});

test('source observations can invalidate but never expand an owner operation envelope', () => {
  const fixture = compileSupersessionFixture({
    'src/example/operation.ts': "export function execute(): void { Bun.spawn(['tool']); }\n",
    'tests/example.test.ts': "import { test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => execute());\n"
  });
  const evidence = fixture.full.intentEvidence[0]!.operationObligations[0]!;

  expect(evidence.obligation.effect.kinds).toEqual([]);
  expect(evidence.observation).toEqual(expect.objectContaining({
    status: 'unknown',
    reason: 'effect-closure-unresolved',
    effectKinds: ['process']
  }));
});

test('supersession accepts stronger effect and failure observation only with lower lifecycle risk', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });
  const current = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { readFile } from 'node:fs/promises';\nimport { execute } from '../src/example/operation.ts';\ntest('executes and rejects invalid state', async () => { expect(execute()).toBe('ok'); await readFile('observation'); expect(() => { throw new Error('invalid'); }).toThrow(); });\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('superseded');
  expect(receipt.findings).toEqual([]);
  expect(receipt.lifecycleCost.current.unobservedTestRisk).toBeLessThan(
    receipt.lifecycleCost.baseline.unobservedTestRisk
  );
  expect(receipt.replacements.find(({ kind }) => kind === 'test')?.proof).toBe(
    'strict-observation-superset'
  );
});

test('supersession blocks a missing required production behavior', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  });
  const current = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute(): string { return 'changed'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', () => expect(execute()).toBe('changed'));\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toContainEqual(expect.objectContaining({
    code: 'required-production-behavior-missing',
    baselinePaths: ['src/example/operation.ts']
  }));
});

test('supersession blocks dynamic or external observations instead of inventing intent', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/operation.ts': "export async function execute(specifier: string) { return import(specifier); }\n",
    'tests/example.test.ts': "import { test } from 'bun:test';\nimport { execute } from '../src/example/operation.ts';\ntest('executes', async () => { await execute('external'); });\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current: baseline });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toContainEqual(expect.objectContaining({
    code: 'dynamic-or-external-observation-unresolved'
  }));
});

test('supersession requires owner obligations only when a declared operation is replaced', () => {
  const baseline = compileSupersessionSnapshot({
    'src/example/legacy.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/legacy.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  }, true, false);
  const current = compileSupersessionSnapshot({
    'src/example/current.ts': "export function execute(): string { return 'ok'; }\n",
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/current.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n"
  }, true, false);

  const receipt = compileSourceProgramSupersessionReceipt({
    baseline,
    current
  });
  expect(receipt.status).toBe('owner-decision-required');
  expect(receipt.findings).toContainEqual(expect.objectContaining({
    code: 'operation-obligation-unresolved',
    owner: 'example'
  }));
});

test('supersession resolves duplicate bytes by semantic target and never by relative path similarity', () => {
  const provider = "import { VALUE } from './value.ts';\nexport function execute(): number { return VALUE; }\n";
  const baseline = compileSupersessionSnapshot({
    'src/example/legacy/provider.ts': provider,
    'src/example/legacy/value.ts': 'export const VALUE = 1;\n',
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/legacy/provider.ts';\ntest('executes', () => expect(execute()).toBe(1));\n"
  });
  const current = compileSupersessionSnapshot({
    'src/example/a/provider.ts': provider,
    'src/example/a/value.ts': 'export const VALUE = 1;\n',
    'src/example/b/provider.ts': provider,
    'src/example/b/value.ts': 'export const VALUE = 2;\n',
    'tests/example.test.ts': "import { expect, test } from 'bun:test';\nimport { execute } from '../src/example/a/provider.ts';\ntest('executes', () => expect(execute()).toBe(1));\n"
  });

  const receipt = compileSourceProgramSupersessionReceipt({ baseline, current });
  expect(receipt.findings).not.toContainEqual(expect.objectContaining({
    code: 'replacement-ambiguous',
    baselinePaths: ['src/example/legacy/provider.ts']
  }));
  expect(receipt.replacements).toContainEqual(expect.objectContaining({
    kind: 'production',
    baselinePaths: ['src/example/legacy/provider.ts'],
    currentPaths: ['src/example/a/provider.ts']
  }));
});

function compileIssuerRoleFixture(input: Readonly<{
  sources: Readonly<Record<string, string>>;
  operationObligations?: Readonly<Record<string, readonly unknown[]>>;
  descriptors: Readonly<Record<string, readonly Readonly<{
    capability: string;
    operations: readonly string[];
    effectKinds?: readonly string[];
    operationRoles: readonly Readonly<{
      operation: string;
      role: string;
      semanticOperation: string;
      requirementId: string | null;
      recovery: Readonly<{
        capability: string;
        operation: string;
        semanticOperation: string;
      }> | null;
    }>[];
  }>[]>>;
}>) {
  const files = Object.entries(input.sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const descriptorSources = Object.entries(input.descriptors).map(([root, capabilityProviders]) => ({
    descriptorPath: `${root}/sec.module.json`,
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders,
      operationObligations: input.operationObligations?.[root] ?? [],
      preDependencyBootstrap: false
    })
  }));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [
      ...files.map(({ path }) => path),
      ...descriptorSources.map(({ descriptorPath }) => descriptorPath)
    ],
    descriptorSources
  });
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  return compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership });
}

test('source program closes issuer roles over exact owners and recovery modules', () => {
  const model = compileIssuerRoleFixture({
    sources: {
      'src/grant/issuer.ts': 'export function issueGrant(): void {}\n',
      'src/binding/issuer.ts': 'export function issueBinding(): void {}\n',
      'src/provider/issuer.ts': 'export function settleProvider(): void {}\n',
      'src/readback/issuer.ts': 'export function readback(): void {}\n',
      'src/terminal/issuer.ts': 'export function joinTerminal(): void {}\n',
      'src/recovery/issuer.ts': 'export function recover(): void {}\n',
      'src/store/worker.ts': 'export function appendAttempt(): void {}\n'
    },
    descriptors: {
      'src/grant': [{ capability: 'semantic.grant', operations: ['issueGrant'], operationRoles: [
        { operation: 'issueGrant', role: 'grant-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/binding': [{ capability: 'semantic.binding', operations: ['issueBinding'], operationRoles: [
        { operation: 'issueBinding', role: 'binding-issuer', semanticOperation: 'example.operation', requirementId: 'example.provider', recovery: null }
      ] }],
      'src/provider': [{ capability: 'semantic.provider', operations: ['settleProvider'], operationRoles: [
        { operation: 'settleProvider', role: 'provider-settlement-issuer', semanticOperation: 'example.operation', requirementId: 'example.provider', recovery: null }
      ] }],
      'src/readback': [{ capability: 'semantic.readback', operations: ['readback'], operationRoles: [
        { operation: 'readback', role: 'readback-issuer', semanticOperation: 'example.operation', requirementId: 'example.provider', recovery: null }
      ] }],
      'src/terminal': [{ capability: 'semantic.terminal', operations: ['joinTerminal'], operationRoles: [
        { operation: 'joinTerminal', role: 'terminal-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/recovery': [{ capability: 'runtime.recovery', operations: ['recover'], operationRoles: [
        { operation: 'recover', role: 'recovery-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/store': [{ capability: 'runtime.store', operations: ['appendAttempt'], operationRoles: [
        {
          operation: 'appendAttempt',
          role: 'durable-worker',
          semanticOperation: 'example.operation',
          requirementId: null,
          recovery: {
            capability: 'runtime.recovery',
            operation: 'recover',
            semanticOperation: 'example.operation'
          }
        }
      ] }]
    }
  });
  expect(model.candidates.filter(({ code }) => code.startsWith('operation-issuer')
    || code.startsWith('operation-recovery')
    || code.startsWith('durable-worker'))).toEqual([]);
});

test('source program rejects cross-owner issuers, generic worker inputs, domain imports, and missing recovery without conflating unrelated issuer roles', () => {
  const model = compileIssuerRoleFixture({
    sources: {
      'src/grant-owner/empty.ts': 'export const marker = true;\n',
      'src/foreign/issuer.ts': 'export function issueGrant(): void {}\n',
      'src/conflict/issuer.ts': 'export function settle(): void {}\nexport function readback(): void {}\n',
      'src/domain/operation.ts': 'export const domainOperation = 1;\n',
      'src/store/worker.ts': "import { domainOperation } from '../domain/operation.ts';\nexport function append(argv: string[], callback: () => void): number { callback(); return argv.length + domainOperation; }\n"
    },
    descriptors: {
      'src/grant-owner': [{ capability: 'semantic.grant', operations: ['issueGrant'], operationRoles: [
        { operation: 'issueGrant', role: 'grant-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/foreign': [],
      'src/conflict': [{ capability: 'semantic.conflict', operations: ['settle', 'readback'], operationRoles: [
        { operation: 'settle', role: 'provider-settlement-issuer', semanticOperation: 'example.settle-operation', requirementId: 'example.settle-provider', recovery: null },
        { operation: 'readback', role: 'readback-issuer', semanticOperation: 'example.readback-operation', requirementId: 'example.readback-provider', recovery: null }
      ] }],
      'src/domain': [{ capability: 'domain.operation', operations: ['domainOperation'], operationRoles: [
        { operation: 'domainOperation', role: 'domain-owner', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/store': [{ capability: 'runtime.store', operations: ['append'], operationRoles: [
        { operation: 'append', role: 'durable-worker', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }]
    }
  });
  const codes = model.candidates.map(({ code }) => code);
  expect(codes).toContain('operation-issuer-role-outside-owner');
  expect(codes).not.toContain('operation-issuer-role-conflict');
  expect(codes).toContain('durable-worker-generic-input-exposed');
  expect(codes).toContain('durable-worker-domain-import');
  expect(codes).toContain('operation-recovery-binding-unresolved');
});

test('source program keeps an effectful public operation without an exact domain owner typed unknown', () => {
  const model = compileIssuerRoleFixture({
    sources: {
      'src/effect/operation.ts': 'export function execute(): void {}\n'
    },
    operationObligations: {
      'src/effect': [{
        operation: {
          kind: 'capability',
          capability: 'example.effect',
          operation: 'execute'
        },
        consumerSupport: { consumers: [] },
        effect: {
          kinds: ['process'],
          failureKinds: ['example.failed'],
          recovery: 'owner-intervention'
        },
        evolution: {
          migration: 'not-required',
          retirement: 'replacement-obligations-satisfied'
        },
        resources: {
          aggregateBudgets: [{ resource: 'processes', maximum: 1 }]
        },
        futureSupport: { condition: 'semantic-superset-required' }
      }]
    },
    descriptors: {
      'src/effect': [{
        capability: 'example.effect',
        operations: ['execute'],
        effectKinds: ['process'],
        operationRoles: []
      }]
    }
  });
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'operation-critical-role-unresolved',
    subject: 'example.effect:execute',
    observationClass: 'unknown'
  }));
});

test('source program keeps an unresolved durable input contract blocking', () => {
  const model = compileIssuerRoleFixture({
    sources: {
      'src/recovery/issuer.ts': 'export function recover(): void {}\n',
      'src/store/worker.ts': 'export interface DurableInput { readonly claim: string; }\nexport function append(input: DurableInput): string { return input.claim; }\n'
    },
    descriptors: {
      'src/recovery': [{ capability: 'runtime.recovery', operations: ['recover'], operationRoles: [
        { operation: 'recover', role: 'recovery-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/store': [{ capability: 'runtime.store', operations: ['append'], operationRoles: [
        {
          operation: 'append',
          role: 'durable-worker',
          semanticOperation: 'example.operation',
          requirementId: null,
          recovery: {
            capability: 'runtime.recovery',
            operation: 'recover',
            semanticOperation: 'example.operation'
          }
        }
      ] }]
    }
  });
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'durable-worker-generic-input-exposed',
    observationClass: 'unknown'
  }));
});
