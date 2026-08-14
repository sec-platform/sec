import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  COMPILER_RUNTIME_RESOURCE_POSIX_PATHS,
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  RELEASE_ENTRYPOINT_RELATIVE_PATH,
  RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH
} from '../../platform/shared/runtime-layout.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('root package scripts', () => {
  test('canonical Bun version is projected into package and every setup workflow', async () => {
    const rootPackage = await readCompilerPackageJson();
    const canonicalVersion = (await readCompilerFile('.bun-version')).trim();
    const workflows = await Promise.all([
      'architecture-tools.yml',
      'compiler-pr-validation.yml',
      'compiler-release-validation.yml',
      'sec-merge-gate.yml'
    ].map((fileName) => readCompilerFile(`.github/workflows/${fileName}`)));

    expect(canonicalVersion).toBe('1.3.14');
    expect(rootPackage.packageManager).toBe(`bun@${canonicalVersion}`);
    for (const workflow of workflows) {
      expect(workflow).toContain('bun-version-file: .bun-version');
      expect(workflow).not.toContain('bun-version: 1.3.6');
    }
  });

  test('release builder consumes the canonical package and runtime asset layout', async () => {
    const rootPackage = await readCompilerPackageJson();
    const builder = await readCompilerFile('scripts/build-release.ts');
    const publicBin = (rootPackage as typeof rootPackage & {
      readonly bin: Readonly<{ readonly sec: string }>;
    }).bin;

    expect(publicBin.sec).toBe(`./${RELEASE_ENTRYPOINT_RELATIVE_PATH.replaceAll('\\', '/')}`);
    expect(RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH.replaceAll('\\', '/')).toBe('dist');
    expectContainsAll(builder, [
      'compilerRuntimeLayout.packageRoot',
      'compilerRuntimeLayout.repositorySourceRoot',
      'RELEASE_ENTRYPOINT_RELATIVE_PATH',
      'resolveCompilerRuntimeLayout',
      'releaseRuntimeLayout.runtimeAssetRoot'
    ]);
    expectContainsNone(builder, [
      "path.resolve(process.cwd(), 'dist')",
      "path.resolve(process.cwd(), 'platform'",
      'process.cwd()'
    ]);
  });

  test('runtime resource consumers and release builder share one canonical inventory', async () => {
    const [
      builder,
      composeTemplateEngine,
      localViewWriter,
      isolatedRuntimeInputResolver,
      isolatedRuntimePlan,
      policyLoader,
      workbenchServer,
      workspaceOrchestrator,
      sharedPaths
    ] = await Promise.all([
      readCompilerFile('scripts/build-release.ts'),
      readCompilerFile('platform/compiler/compose/template-engine.ts'),
      readCompilerFile('platform/compiler/emit/write-local-views.ts'),
      readCompilerFile('platform/compiler/verify/run-semantic-mutation-isolated-child.ts'),
      readCompilerFile('platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts'),
      readCompilerFile('platform/compiler/parse/load-policy-declarations.ts'),
      readCompilerFile('platform/orchestrator/workbench-server-v2.ts'),
      readCompilerFile('platform/orchestrator/workspace-orchestrator.ts'),
      readCompilerFile('platform/shared/paths.ts')
    ]);

    expect(Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS).map(
      (relativePath) => relativePath.replaceAll('\\', '/')
    )).toEqual(Object.values(COMPILER_RUNTIME_RESOURCE_POSIX_PATHS));
    expect(Object.values(COMPILER_RUNTIME_RESOURCE_POSIX_PATHS)).toEqual([
      'platform/compiler/compose/templates',
      'platform/compiler/emit/templates',
      'platform/policies/official',
      'platform/registry/official'
    ]);
    expectContainsAll(builder, [
      'COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS',
      'releaseRuntimeLayout.runtimeAssetRoot',
      'Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)'
    ]);
    expectContainsAll(composeTemplateEngine, [
      'compilerRuntimeResources',
      'compilerRuntimeResources.composeTemplates'
    ]);
    expectContainsAll(localViewWriter, [
      'compilerRuntimeResources',
      'compilerRuntimeResources.localViewTemplates'
    ]);
    expectContainsAll(isolatedRuntimeInputResolver, [
      'compilerRuntimeLayout.packageRoot',
      'compilerRuntimeResources.composeTemplates',
      'compilerRuntimeResources.officialPolicies',
      'compilerRuntimeResources.officialRegistry',
      'SEMANTIC_MUTATION_ISOLATED_COMPILER_RESOURCE_DESTINATIONS.officialRegistry',
      'SEMANTIC_MUTATION_ISOLATED_COMPILER_DEPS_RELATIVE_ROOT',
      'SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH'
    ]);
    expectContainsNone(isolatedRuntimeInputResolver, [
      '`${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/${officialPath}`',
      "'../../node_modules"
    ]);
    expectContainsAll(sharedPaths, [
      'COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialRegistry',
      'compilerRuntimeResources.officialPolicies',
      'compilerRuntimeResources.officialRegistry'
    ]);
    expectContainsAll(isolatedRuntimePlan, [
      'COMPILER_RUNTIME_RESOURCE_POSIX_PATHS',
      'RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH',
      'SEMANTIC_MUTATION_ISOLATED_COMPILER_RUNTIME_ASSET_RELATIVE_ROOT',
      'SEMANTIC_MUTATION_ISOLATED_COMPILER_RESOURCE_DESTINATIONS'
    ]);
    expectContainsAll(policyLoader, [
      'officialPoliciesRelativePath',
      'posixPath(officialPoliciesRelativePath)'
    ]);
    expectContainsAll(workbenchServer, [
      'compilerRuntimeResources.officialRegistry'
    ]);
    expectContainsNone(workbenchServer, [
      'path.join(context.workspaceRoot, officialRegistryRelativePath)'
    ]);
    expectContainsAll(workspaceOrchestrator, [
      'officialRegistryRelativePath',
      'posixPath(officialRegistryRelativePath)'
    ]);
    expectContainsNone([
      composeTemplateEngine,
      localViewWriter,
      isolatedRuntimeInputResolver
    ].join('\n'), [
      "path.join(compilerRoot, 'platform', 'compiler', 'compose', 'templates')",
      "path.join(compilerRoot, 'platform', 'compiler', 'emit', 'templates')",
      "path.join(compilerRoot, 'platform', 'policies', 'official')",
      "path.join(compilerRoot, 'platform', 'registry', 'official')"
    ]);

    const allowedTrackedSourceSelectors = new Set([
      'platform/shared/test-impact-rules/semantic.ts'
    ]);
    const competingDefinitions: string[] = [];
    const sourceGlob = new Bun.Glob('**/*.ts');
    for await (const rawPath of sourceGlob.scan({ cwd: repositoryRoot, onlyFiles: true })) {
      const relativePath = rawPath.replaceAll('\\', '/');
      if (
        (!relativePath.startsWith('platform/') && !relativePath.startsWith('scripts/'))
        || allowedTrackedSourceSelectors.has(relativePath)
      ) continue;
      const source = await readFile(path.join(repositoryRoot, relativePath), 'utf8');
      for (const resourcePath of Object.values(COMPILER_RUNTIME_RESOURCE_POSIX_PATHS)) {
        if (source.includes(resourcePath)) {
          competingDefinitions.push(`${relativePath}:${resourcePath}`);
        }
      }
    }
    expect(competingDefinitions).toEqual([]);
  });

  test('common workspace write authority binds the V3 retained-identity retirement ledger', async () => {
    const leaseAuthority = await readCompilerFile('platform/shared/workspace-write-lease.ts');

    expectContainsAll(leaseAuthority, [
      "WORKSPACE_WRITE_LEASE_TOKEN_VERSION = 'workspace-write-lease-token-v3'",
      "WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION = 'workspace-write-lease-protocol-v3'",
      'type ImmutablePublicationOutcome =',
      'await fs.link(candidate, target)',
      'const ownerPublication = await linkImmutableCandidateNoReplace(',
      "if (ownerPublication.state === 'not-published')",
      "if (ownerPublication.state === 'durability-unknown')",
      "publishTerminal(paths, tokenFromOwner(finalState.owner), 'recovered')",
      'firstInventory.highestGeneration !== token.generation',
      'relocateRetainedNoFollowDirectoryAcrossParentsV1',
      'assertWorkspaceWriteLeaseRetirementProofV1',
      'resumeWorkspaceWriteLeaseRetirementV1',
      'retireOwnedNamespace'
    ]);
    expectContainsNone(leaseAuthority, [
      "from 'bun'",
      "import('bun')",
      'bun:ffi',
      'Bun.',
      'leaseTargetExists'
    ]);
  });

  test('demo scripts follow the documented platform chain', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['demo:quickstart']).toBe('bun run sec -- init --reset && bun run reference:refresh');
    expect(scripts['demo:governance']).toBe(
      'bun run demo:quickstart && bun run sec -- artifacts --paths --kind governance'
    );
    expect(scripts['demo:closed-loop']).toBe(
      'bun run demo:quickstart && bun run sec -- verify --lane all && bun run sec -- artifacts --paths --kind governance && bun run sec -- explain --json --compact'
    );
  });

  test('dogfood scripts delegate to reference and governance commands', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['dogfood:reference']).toBe('bun run reference:refresh');
    expect(scripts['dogfood:governance']).toBe(
      'bun run dogfood:reference && bun run sec -- artifacts --paths --json --kind governance'
    );
  });

  test('reference:refresh delegates to the canonical pipeline compiler', async () => {
    const { scripts } = await readCompilerPackageJson();
    const source = await readCompilerFile('scripts/compile-reference-workspace.ts');

    expect(scripts['reference:refresh']).toBe('bun ./scripts/compile-reference-workspace.ts');
    expectContainsAll(source, [
      "import { compileWorkspace } from '../platform/orchestrator.ts';",
      'await compileWorkspace(process.cwd(), {',
      "source: 'reference'"
    ]);
  });
});

describe('test budget and benchmark contracts', () => {
  test('root package exposes budget and contract scripts', async () => {
    const { scripts, devDependencies, trustedDependencies } = await readCompilerPackageJson();

    expect(scripts.sec).toBe('bun ./platform/cli/index.ts');
    expect(scripts['hooks:install']).toBe('bun ./scripts/install-git-hooks.ts');
    expect(scripts.postinstall).toBe('bun ./scripts/install-git-hooks.ts --lifecycle');

    expect(scripts.depcruise).toBe('bunx --bun dependency-cruiser@17.3.10 "platform/**/*.ts" --config .dependency-cruiser.json');
    expect(scripts.jscpd).toBe('bunx --bun jscpd@4.0.9 platform/ scripts/ -o report/jscpd --reporters html,console,json --format typescript,javascript --ignore "**/node_modules/**,**/dist/**,**/*.test.ts,**/*.d.ts,**/upgrade/**,.tmp/**" --min-lines 5 --min-tokens 50 --absolute');
    expect(scripts.discover).toBe('bun scripts/discover-all.ts --json --output report/discover.json');
    expect(scripts['gitnexus:analyze']).toBe('gitnexus analyze --skip-agents-md --no-stats');
    expect(scripts['gitnexus:status']).toBe('gitnexus status');
    expect(scripts['gitnexus:mcp']).toBeUndefined();
    expect(scripts.graphify).toBe('uvx --from graphifyy==0.7.10 graphify');
    expect(scripts['graphify:update']).toBe('uvx --from graphifyy==0.7.10 graphify update .');
    expect(scripts['graphify:extract']).toBe('uvx --from graphifyy==0.7.10 graphify extract . --out report/graphify --no-cluster');
    expect(devDependencies?.gitnexus).toBe('1.6.3');
    expect(trustedDependencies).toEqual(expect.arrayContaining([
      '@ladybugdb/core',
      'gitnexus',
      'onnxruntime-node',
      'protobufjs'
    ]));
    expect(scripts['arch:check']).toBe('bun run depcruise && bun run jscpd');
    expect(scripts.preflight).toBe('bun run depcruise && bun run jscpd && bun run discover');

    expect(scripts.format).toBeUndefined();
  });

  test('external graph provider caches stay out of version control', async () => {
    const gitignore = await readCompilerFile('.gitignore');

    expectContainsAll(gitignore, ['.gitnexus/', 'graphify-out/']);
  });

  test('retired MCP entrypoints stay absent while CLI analysis remains available', async () => {
    const { scripts } = await readCompilerPackageJson();
    const mcpConfig = new URL('../../.mcp.json', import.meta.url);

    expect(await Bun.file(mcpConfig).exists()).toBe(false);
    expect(scripts['gitnexus:mcp']).toBeUndefined();
    expect(scripts['gitnexus:analyze']).toBeDefined();
    expect(scripts['gitnexus:status']).toBeDefined();
    expect(scripts.graphify).toBeDefined();
  });

  test('architecture tools workflow delegates to canonical package scripts', async () => {
    const workflow = await readCompilerFile('.github/workflows/architecture-tools.yml');

    expectContainsAll(workflow, [
      'run: bun install --frozen-lockfile',
      'run: bun run depcruise',
      'run: bun run jscpd',
      'run: bun run discover'
    ]);
    expectContainsNone(workflow, [
      'run: bunx --bun dependency-cruiser@17.3.10',
      'run: bunx --bun jscpd@4.0.9'
    ]);
  });

});

describe('developer contract entrypoints', () => {
  test('contract scripts bypass dev-runner', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['test:budget']).not.toContain('dev-runner');
    expect(scripts['test:benchmark-contract']).not.toContain('dev-runner');
    expect(scripts['reference:check']).not.toContain('reference-clean');
  });
});
