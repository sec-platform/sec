import { expect, test } from 'bun:test';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileRepositoryModuleArchitectureProjection,
  compileRepositoryModuleMembershipSnapshot
} from '../architecture/contract.ts';
import { createSourceProgramCompilationOperation } from './compilation-operation.ts';
import {
  compileSourceProgramVersionSuffixReductionPlan,
  renderSourceProgramVersionSuffixReductionPatch
} from './reduction.ts';
import {
  compileRepositorySourceProgramModel,
  compileRepositorySourceProgramModelFromWorkspaceSnapshot,
  observeRepositorySourceProgramDescriptorOperationExports,
  summarizeSourceProgramTopology
} from './repository.ts';
import { compileTypeScriptSourceProgramModel, querySourceProgramModel } from './typescript.ts';
import {
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceSourceRevision
} from './workspace-source-snapshot.ts';

test('descriptor operations use exact owned runtime exports, including aliases, without admitting a nested owner', () => {
  const sources = new Map([
    ['src/example/root.ts',
      "export function live(): void {}\nexport { live as alias };\nexport type { TypeOnly as old } from './type.ts';\nexport * from './star.ts';\n"],
    ['src/example/type.ts', 'export class TypeOnly {}\n'],
    ['src/example/star.ts', 'export function starred(): void {}\n'],
    ['src/example/nested/old.ts', 'export function old(): void {}\n']
  ]);
  const descriptorSources = [
    {
      descriptorPath: 'src/example/module.json',
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [{
          capability: 'example.operations',
          operations: ['live', 'alias', 'starred', 'old'],
          ownerInternalOperations: ['old']
        }]
      })
    },
    {
      descriptorPath: 'src/example/nested/module.json',
      source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
    }
  ];
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...sources.keys(), ...descriptorSources.map(({ descriptorPath }) => descriptorPath)],
    descriptorSources
  });
  const files = [...sources].map(([path, source]) => ({
    path, source, contentDigest: rawSha256(source)
  }));
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('descriptor-operation-base'),
        mutationDigest: rawSha256('descriptor-operation-positive')
      }
    },
    files,
    moduleMembership: membership
  });
  const model = compileRepositorySourceProgramModelFromWorkspaceSnapshot({
    sourceRevision: workspaceSnapshot.sourceRevision,
    files: workspaceSnapshot.files,
    moduleMembership: membership
  }, workspaceSnapshot);
  const observations = observeRepositorySourceProgramDescriptorOperationExports(model);
  expect(observations).not.toBeNull();
  const byOperation = new Map(observations!.map((observation) => [observation.operation, observation]));
  for (const name of ['live', 'alias', 'starred']) {
    expect(byOperation.get(name)?.status).toBe('resolved');
    expect(byOperation.get(name)?.resolutions.some((resolution) => (
      resolution.status === 'resolved'
      && resolution.targetDeclarationObservationIds.length > 0
      && resolution.targetPaths.every((path) => path.startsWith('src/example/'))
    ))).toBe(true);
  }
  expect(byOperation.get('old')?.status).toBe('absent');
  expect(byOperation.get('old')?.scopePaths).not.toContain('src/example/nested/old.ts');
  const architecture = compileRepositoryModuleArchitectureProjection(workspaceSnapshot.moduleGraph, membership, {
    ...model,
    descriptorOperationExports: observations!
  });
  expect(architecture.violations).toContainEqual(expect.objectContaining({
    code: 'repository-descriptor-operation-export-absent',
    to: 'example.operations:old'
  }));
  expect(observeRepositorySourceProgramDescriptorOperationExports({ ...model })).toBeNull();
  const foreignMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...sources.keys(), ...descriptorSources.map(({ descriptorPath }) => descriptorPath)],
    descriptorSources: [{
      descriptorPath: 'src/example/module.json',
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [{
          capability: 'example.operations',
          operations: ['foreign']
        }]
      })
    }, descriptorSources[1]!]
  });
  const foreignTypeScriptModel = compileTypeScriptSourceProgramModel({
    sourceRevision: model.sourceRevision,
    files,
    moduleMembership: foreignMembership
  });
  const foreignComposite = compileRepositorySourceProgramModel({
    sourceRevision: model.sourceRevision,
    files,
    moduleMembership: membership,
    typescriptModel: foreignTypeScriptModel
  });
  expect(observeRepositorySourceProgramDescriptorOperationExports(foreignComposite)).toBeNull();
  const foreignRevisionTypeScriptModel = compileTypeScriptSourceProgramModel({
    sourceRevision: 'foreign-revision',
    files,
    moduleMembership: membership
  });
  expect(() => compileRepositorySourceProgramModel({
    sourceRevision: model.sourceRevision,
    files,
    moduleMembership: membership,
    typescriptModel: foreignRevisionTypeScriptModel
  })).toThrow('invalid TypeScript fact snapshot');
  const unselectedEntrypoint = 'src/example/unselected.ts';
  const partialMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [
      ...sources.keys(),
      unselectedEntrypoint,
      ...descriptorSources.map(({ descriptorPath }) => descriptorPath)
    ],
    descriptorSources: [{
      descriptorPath: 'src/example/module.json',
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [unselectedEntrypoint],
        capabilityProviders: [{
          capability: 'example.operations',
          operations: ['old']
        }]
      })
    }, descriptorSources[1]!]
  });
  const partialModel = compileRepositorySourceProgramModel({
    sourceRevision: model.sourceRevision,
    files,
    moduleMembership: partialMembership
  });
  expect(observeRepositorySourceProgramDescriptorOperationExports(partialModel)
    ?.find(({ operation }) => operation === 'old')?.status).toBe('unresolved');
  const extraFile = {
    path: 'src/example/extra.ts',
    source: 'export function old(): void {}\n',
    contentDigest: rawSha256('export function old(): void {}\n')
  };
  const fallbackMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [
      ...sources.keys(),
      extraFile.path,
      ...descriptorSources.map(({ descriptorPath }) => descriptorPath)
    ],
    descriptorSources: [{
      descriptorPath: 'src/example/module.json',
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [{ capability: 'example.operations', operations: ['old'] }]
      })
    }, descriptorSources[1]!]
  });
  const completeSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('descriptor-operation-base'),
        mutationDigest: rawSha256('descriptor-operation-complete')
      }
    },
    files: [...files, extraFile],
    moduleMembership: fallbackMembership
  });
  expect(completeSnapshot.files.map(({ path }) => path)).toContain(extraFile.path);
  const unboundPartialModel = compileRepositorySourceProgramModel({
    sourceRevision: model.sourceRevision,
    files,
    moduleMembership: fallbackMembership
  });
  expect(observeRepositorySourceProgramDescriptorOperationExports(unboundPartialModel)
    ?.find(({ operation }) => operation === 'old')?.status).toBe('unresolved');
  expect(() => compileRepositorySourceProgramModelFromWorkspaceSnapshot({
    sourceRevision: completeSnapshot.sourceRevision,
    files,
    moduleMembership: fallbackMembership
  }, completeSnapshot)).toThrow();
});

test('type-only star exports are absent while ambient declarations stay unresolved', () => {
  const files = [
    {
      path: 'src/example/root.ts',
      source: "export type * from './type.ts';\nexport declare function declared(): void;\n"
    },
    { path: 'src/example/type.ts', source: 'export class TypeOnly {}\n' }
  ].map(({ path, source }) => ({ path, source, contentDigest: rawSha256(source) }));
  const descriptorPath = 'src/example/module.json';
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [descriptorPath, ...files.map(({ path }) => path)],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: ['src/example/root.ts'],
        capabilityProviders: [{ capability: 'example', operations: ['TypeOnly', 'declared'] }]
      })
    }]
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: membership
  });
  const observations = observeRepositorySourceProgramDescriptorOperationExports(model);
  expect(observations?.find(({ operation }) => operation === 'TypeOnly')?.status).toBe('absent');
  expect(observations?.find(({ operation }) => operation === 'declared')?.status).toBe('unresolved');
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
      + "function run(): void { spawnSync('git', ['status']); }\n"
      + "new Command().command('inspect').action(run);\n"
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
    'src/example/module.json',
    ...sources.keys()
  ];
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles,
    descriptorSources: [{
      descriptorPath: 'src/example/module.json',
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
  const sourceRevision = compileWorkspaceSourceRevision(files);
  const typeScriptModel = compileTypeScriptSourceProgramModel({
    sourceRevision,
    files,
    moduleMembership
  });
  const compile = (orderedFiles: typeof files) => compileRepositorySourceProgramModel({
    sourceRevision,
    files: orderedFiles,
    moduleMembership,
    typescriptModel: typeScriptModel,
    reviewedProcessDispatchers: ['src/example/cli.ts::function-declaration:run::spawnSync#1']
  });

  const model = compile(files);
  expect(new Set(model.candidates.map((candidate) => sha256(candidate))).size)
    .toBe(model.candidates.length);
  const versionReductionPlan = compileSourceProgramVersionSuffixReductionPlan(model, files, {
    typeScriptModel,
    moduleMembership,
    reviewedProcessDispatchers: []
  });
  const cancelled = new AbortController();
  const cancelledOperation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + 30_000,
    signal: cancelled.signal
  });
  cancelled.abort();
  expect(() => compileSourceProgramVersionSuffixReductionPlan(model, files, {
    typeScriptModel,
    moduleMembership,
    reviewedProcessDispatchers: [],
    operation: cancelledOperation
  })).toThrow('source-program-compilation-cancelled:reduction-plan');
  expect(() => compileSourceProgramVersionSuffixReductionPlan(model, files, {
    typeScriptModel,
    moduleMembership,
    reviewedProcessDispatchers: [],
    operation: createSourceProgramCompilationOperation({
      deadlineAtUnixMs: Date.now() - 1
    })
  })).toThrow('source-program-compilation-deadline-exhausted:reduction-plan');
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
    currentName: 'REAL_SCHEMA_V2',
    proposedName: 'REAL_SCHEMA'
  }));
  expect(versionReductionPlan.reductions).not.toContainEqual(expect.objectContaining({
    currentName: 'normalizeInputV1'
  }));
  expect(versionReductionPlan.reductions).not.toContainEqual(expect.objectContaining({
    currentName: 'calculateProjectionV1'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'versioned-declaration-conflicts-with-canonical-name',
    subject: 'approvedExternalCapabilityV1'
  }));
  expect(versionReductionPatch.patch).toContain('--- a/src/example/alias-consumer.ts');
  expect(versionReductionPatch.patch).not.toContain('--- a/src/example/index.ts');
  const unboundPackageSource = JSON.stringify({ ...packageManifest, source: undefined });
  const unboundFiles = files
    .filter(({ path }) => path === 'package.json' || path === 'src/example/cli.ts')
    .map((file) => file.path === 'package.json'
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
  expect(model.candidates.some(({ subject }) => subject === 'calculateProjectionV1')).toBe(false);
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

test('source program blocks owner-internal process calls and import-only test seams at repository provider boundaries', () => {
  const providerPath = 'src/physical-provider/process.ts';
  const consumerPath = 'src/consumer/run.ts';
  const descriptorPath = 'src/physical-provider/module.json';
  const seamPath = 'src/consumer/options.ts';
  const files = [
    {
      path: providerPath,
      source: 'export function nativePrimitive(): void {}\n'
    },
    {
      path: consumerPath,
      source: "import { nativePrimitive } from '../physical-provider/process.ts';\nnativePrimitive();\n"
    },
    {
      path: seamPath,
      source: "import { nativePrimitive } from '../physical-provider/process.ts';\n"
        + 'export interface Options { runner?: typeof nativePrimitive }\n'
    }
  ].map(({ path, source }) => ({ path, source, contentDigest: rawSha256(source) }));
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [descriptorPath, 'src/consumer/module.json', ...files.map(({ path }) => path)],
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
        descriptorPath: 'src/consumer/module.json',
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
    moduleMembership,
    reviewedProcessDispatchers: [
      `${consumerPath}::nativePrimitive`,
      `${seamPath}::nativePrimitive`
    ]
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
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'process-resource-session-boundary-unresolved',
    subject: 'process.native'
  }));
  expect(model.capabilities).not.toContainEqual(expect.objectContaining({
    path: seamPath,
    capability: 'process'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'direct-process-transport-outside-owner',
    subject: seamPath,
    paths: [seamPath],
    reason: expect.stringContaining('1 raw owner-internal import')
  }));
});

test('source program classifies worker-thread construction as native process transport', () => {
  const consumerPath = 'src/consumer/worker.ts';
  const source = "import { Worker } from 'node:worker_threads';\n"
    + "export function start(): Worker { return new Worker('./worker.ts'); }\n";
  const files = [{ path: consumerPath, source, contentDigest: rawSha256(source) }];
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: ['src/consumer/module.json', consumerPath],
    descriptorSources: [{
      descriptorPath: 'src/consumer/module.json',
      source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
    }]
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision: rawSha256(JSON.stringify(files)),
    files,
    moduleMembership
  });

  expect(model.capabilities).toContainEqual(expect.objectContaining({
    path: consumerPath,
    capability: 'process',
    operation: 'Worker',
    moduleSpecifier: 'node:worker_threads',
    transport: 'native-runtime'
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'direct-process-transport-outside-owner',
    subject: consumerPath
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'process-resource-session-boundary-unresolved',
    subject: 'process.native',
    paths: [consumerPath]
  }));
});

// Exact compiler equivalence boundary: an incremental answer must equal a clean full compile.
