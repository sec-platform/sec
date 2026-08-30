import { expect, test } from 'bun:test';
import { applyPatch, parsePatch } from 'diff';

import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import {
  buildSourceProgramAggregateImportReductionPatch,
  compileRepositorySourceProgramModel,
  compileSourceProgramAggregateImportReductionPlan,
  compileSourceProgramVersionSuffixReductionPlan,
  compileTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramModelIncremental,
  querySourceProgramModel,
  renderSourceProgramVersionSuffixReductionPatch,
  summarizeSourceProgramTopology
} from './index.ts';

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
    contentDigest: sha256(source)
  }));
  const sourceRevision = sha256(files.map(({ contentDigest, path }) => ({ contentDigest, path })));
  const compile = (orderedFiles: typeof files) => compileRepositorySourceProgramModel({
    sourceRevision,
    files: orderedFiles,
    moduleMembership
  });

  const model = compile(files);
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
    ? { ...file, source: unboundPackageSource, contentDigest: sha256(unboundPackageSource) }
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
      .map(([path, source]) => Object.freeze({ path, source, contentDigest: sha256(source) }));
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
    contentDigest: sha256(source)
  }));
  const sourceRevision = sha256(files.map(({ contentDigest, path }) => ({ contentDigest, path })));
  const model = compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership });
  const plan = compileSourceProgramAggregateImportReductionPlan(model, files);
  const patch = buildSourceProgramAggregateImportReductionPatch(plan, files);

  expect(plan.reductions).toContainEqual(expect.objectContaining({
    status: 'ready',
    path: 'src/consumer/use.ts',
    targetPaths: ['src/provider/operation.ts'],
    replacementText: "import { execute } from '../provider/operation.ts';"
  }));
  expect(patch.files.map(({ path }) => path)).toEqual(['src/consumer/use.ts']);
  expect(patch.patch).toContain("from '../provider/operation.ts'");
});
