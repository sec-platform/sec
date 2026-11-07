import { settleResources, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { commitTestImpactFixtureSources } from '../../helpers/test-impact-git-commit.ts';

import { canonicalGitChildEnvironment } from '../../../src/adapters/providers/git/environment.ts';
import { compileRepositorySourceProgramCompilation } from '../../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../../src/adapters/repository/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeWorkspaceSourceSnapshot } from '../../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { currentActiveDocumentationPaths } from '../../../src/adapters/self-hosting/control/documentation/active.ts';
import { issueTestInventoryProjection } from '../../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { TEST_IMPACT_SOURCE_KINDS, classifyTestImpactSource, testImpactModuleIdsForSourceKind } from '../../../src/adapters/verification/platform/test-impact/contract/ownership.ts';
import { createRepositoryTestImpactSourceProvider, isTestImpactModuleGraphInputFile, isTestImpactSourceFile, readRepositoryModuleGraphV1, resolveTestImpactSelectionTrustBoundary, selectTestsForSources } from '../../../src/adapters/verification/platform/test-impact/runtime/impact.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: canonicalGitChildEnvironment() });
  if (result.status !== 0) {
    throw new Error(`Git fixture command failed: git ${args.join(' ')}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

// Actual source graphs, Git commits and compiler projections remain
// independent per observation. Only an empty native Git identity is copied.
let testImpactEmptyGit: string | undefined;

afterAll(() => {
  if (testImpactEmptyGit !== undefined) {
    rmSync(testImpactEmptyGit, { recursive: true, force: true });
    testImpactEmptyGit = undefined;
  }
});

function emptyGitTestImpactBase(): string {
  if (testImpactEmptyGit !== undefined) return testImpactEmptyGit;
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-test-impact-base-'));
  try {
    git(root, ['init', '--quiet']);
    testImpactEmptyGit = root;
    return root;
  } catch (error) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'TestImpact base setup and cleanup failed');
    }
    throw error;
  }
}

function sourceProvider(sources: Readonly<Record<string, string>>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-test-impact-'));
  let primary: ResourceSettlementFailure | undefined;
  try {
    cpSync(emptyGitTestImpactBase(), root, { recursive: true });
    const fixtureSources = {
      ...sources,
      ...(Object.keys(sources).some((repositoryPath) => repositoryPath.startsWith('src/compiler/'))
        ? { 'src/compiler/module.json': '{"importGraph":"runtime","externalEntrypoints":[]}' }
        : {})
    };
    for (const [repositoryPath, source] of Object.entries(fixtureSources)) {
      const filePath = path.join(root, ...repositoryPath.split('/'));
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source, 'utf8');
    }
    const commitSha = commitTestImpactFixtureSources(
      root, fixtureSources, canonicalGitChildEnvironment(),
      { name: 'SEC Test Impact', email: 'test-impact@sec.invalid' }
    );
    const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot: root,
      commitSha
    });
    const repositoryCompilation = compileRepositorySourceProgramCompilation({ workspaceSnapshot });
    return createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot,
        repositoryModel: repositoryCompilation.model,
        typeScriptModel: repositoryCompilation.typeScriptCompilation.model,
        testObservations: repositoryCompilation.testObservations
      }),
      testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
      activeDocumentationPaths: currentActiveDocumentationPaths()
    });
  } catch (error) {
    primary = { label: 'source-provider fixture', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'source-provider root', settle: () => rmSync(root, { recursive: true, force: true }) }] });
  }
}

function expectUnique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

test('non-code source ownership and executable import impact remain independently path-scoped', () => {
  // Keep exact descriptor bindings and all non-code source kinds in the
  // existing routing contract; no second test file or per-kind registration.
  for (const kind of TEST_IMPACT_SOURCE_KINDS.filter(kind => kind !== 'typescript')) {
    const owners = testImpactModuleIdsForSourceKind(kind);
    expect(new Set(owners).size).toBe(owners.length);
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      const descriptor = path.join(repositoryRoot, 'src', ...owner.split('.'), 'module.json');
      expect(JSON.parse(readFileSync(descriptor, 'utf8')).importGraph).toBe('runtime');
    }
  }

  // TypeScript uses executable import edges, not the non-code kind-to-owner map.
  expect(testImpactModuleIdsForSourceKind('typescript')).toEqual([]);
  const activeDocumentationPath = (candidate: string) => candidate === 'config/repository/work-selection.md';
  expect(classifyTestImpactSource(
    'catalog/registry/official/ticket.basic/block.manifest.yaml',
    activeDocumentationPath
  ))
    .toBe('manifest');
  expect(classifyTestImpactSource('source/model/app.plan.yaml', activeDocumentationPath))
    .toBe('source-model');
  expect(classifyTestImpactSource(
    '.github/workflows/compiler-pr-validation.yml', activeDocumentationPath
  )).toBe('workflow');
  expect(classifyTestImpactSource(
    '.githooks/post-merge',
    activeDocumentationPath,
    (candidate) => candidate === '.githooks/post-merge'
  )).toBe('git-hook');
  expect(classifyTestImpactSource(
    '.githooks/unobserved',
    activeDocumentationPath
  )).toBeNull();
  expect(classifyTestImpactSource('config/repository/work-selection.md', activeDocumentationPath))
    .toBe('active-documentation');
  expect(classifyTestImpactSource('docs/unregistered.manifest.yaml', activeDocumentationPath))
    .toBeNull();
  expect(classifyTestImpactSource('.codex/agents/worker.toml', activeDocumentationPath))
    .toBe('agent-role');
  expect(classifyTestImpactSource('.codex/unowned.toml', activeDocumentationPath)).toBeNull();
  expect(classifyTestImpactSource('.codex/agents/notes.md', activeDocumentationPath)).toBeNull();

  const source = 'src/bootstrap/engineering/pipeline-kernel.ts';
  const facade = 'src/bootstrap/engineering/virtual-entrypoint.ts';
  const helper = 'src/bootstrap/engineering/virtual-test-helper.ts';
  const direct = 'tests/integration/workspace/pipeline-workspace-write-lease.test.ts';
  const selected = 'tests/unit/virtual-facade.test.ts';
  const slow = 'tests/e2e/workspace/upgrade.test.ts';
  const ignored = 'tests/unit/virtual-import-text.test.ts';
  const alpha = 'src/compiler/virtual-alpha.ts';
  const beta = 'src/compiler/virtual-beta.ts';
  const alphaFacade = 'src/compiler/virtual-public.ts';
  const alphaTest = 'src/compiler/virtual-alpha.spec.ts';
  const betaTest = 'tests/unit/virtual-beta.test.ts';
  // The three disjoint positive source worlds share one immutable Git/Source Program input.
  const provider = sourceProvider({
    '.codex/agents/worker.toml': 'name = "worker"\n',
    'src/adapters/self-hosting/control/agent/skill.ts': 'export const role = true;',
    'src/adapters/self-hosting/control/agent/module.json': '{"importGraph":"runtime","externalEntrypoints":[]}',
    'tests/unit/agent-fixture.test.ts': "import { role } from '../../src/adapters/self-hosting/control/agent/skill.ts'; void role;",
    'catalog/registry/official/ticket.basic/block.manifest.yaml': 'id: ticket.basic\n',
    'src/compiler/virtual-manifest-consumer.ts': 'export const manifestConsumer = true;',
    'tests/unit/virtual-manifest-consumer.test.ts': "import { manifestConsumer } from '../../src/compiler/virtual-manifest-consumer.ts'; void manifestConsumer;",
    '.githooks/post-merge': '#!/usr/bin/env sh\nexec bun run dev -- workspace-transition post-merge "$@"\n',
    'src/adapters/self-hosting/development/hooks/install.ts': 'export const installHooks = true;',
    'src/adapters/self-hosting/development/hooks/module.json': JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/adapters/self-hosting/development/hooks/install.ts'],
      capabilityProviders: [],
      preDependencyBootstrap: false
    }),
    'tests/unit/install-hooks-fixture.test.ts': "import { installHooks } from '../../src/adapters/self-hosting/development/hooks/install.ts'; void installHooks;",
      'src/bootstrap/engineering/module.json':
        '{"importGraph":"runtime","externalEntrypoints":["src/bootstrap/engineering/cli.ts"]}',
      'src/bootstrap/engineering/cli.ts': "import { kernel } from './pipeline-kernel.ts'; void kernel;",
      [source]: 'export const kernel = true;',
      [facade]: "export { kernel } from './pipeline-kernel.ts';",
      [helper]: "export { kernel } from './virtual-entrypoint.ts';",
      [direct]: "import { kernel } from '../../../src/bootstrap/engineering/pipeline-kernel.ts'; void kernel;",
      [selected]: "import { kernel } from '../../src/bootstrap/engineering/virtual-test-helper.ts'; void kernel;",
      [slow]: "import { kernel } from '../../../src/bootstrap/engineering/pipeline-kernel.ts'; void kernel;",
      [ignored]: "const text = \"import '../../src/bootstrap/engineering/pipeline-kernel.ts'\"; void text;",
    [alpha]: 'export const alpha = 1;',
    [beta]: 'export const beta = 2;',
    [alphaFacade]: "export { alpha } from './virtual-alpha.ts';\nexport { beta } from './virtual-beta.ts';",
    [alphaTest]: "import { alpha } from './virtual-public.ts'; void alpha;",
    [betaTest]: "import { beta } from '../../src/compiler/virtual-public.ts'; void beta;"
  });
  expect(selectTestsForSources(['.codex/agents/worker.toml'], provider).fast)
    .toEqual(['tests/unit/agent-fixture.test.ts']);

  expect(selectTestsForSources(['.githooks/post-merge'], provider).fast)
    .toContain('tests/unit/install-hooks-fixture.test.ts');

  const documentation = selectTestsForSources(['docs/产品/产品要求与工作约束.md'], provider);
  expect(documentation.owners).toContain('adapters.self-hosting.control.documentation');
  expect(documentation.fast).toEqual([]);
  expect(documentation.slow).toEqual([]);

  const manifest = selectTestsForSources([
    'catalog/registry/official/ticket.basic/block.manifest.yaml'
  ], provider);
  expect(manifest.owners).toEqual(expect.arrayContaining(['compiler', 'compiler.registry']));
  expect(manifest.fast).toContain('tests/unit/virtual-manifest-consumer.test.ts');

  const selection = selectTestsForSources([source], provider);
  expect(selection.fast).toEqual([direct, selected]);
  expect(selection.slow).toEqual([slow]);
  expect(selection.owners).toEqual(['bootstrap.engineering']);

  const graph = readRepositoryModuleGraphV1(provider);
  expect(resolveTestImpactSelectionTrustBoundary(provider))
    .toEqual({ selectionResolved: true, unresolvedModuleFiles: [] });
  expect(graph.files.length).toBeGreaterThan(0);
  expectUnique(graph.files);
  expectUnique(graph.references.map((reference) => (
    `${reference.from}\0${reference.kind}\0${reference.specifier}\0${reference.resolvedTarget ?? ''}`
  )));
  for (const reference of graph.references) {
    expect(reference.candidateTargets).toEqual([...new Set(reference.candidateTargets)].sort());
    if (reference.resolvedTarget !== null) expect(graph.files).toContain(reference.resolvedTarget);
  }
  expect(isTestImpactModuleGraphInputFile(alphaTest, provider)).toBe(false);
  expect(isTestImpactSourceFile(alphaTest, provider)).toBe(false);
  expect(selectTestsForSources([alpha], provider).fast).toEqual([alphaTest]);
  expect(selectTestsForSources([beta], provider).fast).toEqual([betaTest]);
  expect(selectTestsForSources([alphaFacade], provider).fast).toEqual([alphaTest, betaTest]);
});

test('repository receipts isolate exact source bytes across equal-length mutations', () => {
  const sourceA = 'src/compiler/virtual-source-a.ts';
  const sourceB = 'src/compiler/virtual-source-b.ts';
  const selected = 'tests/unit/virtual-source-switch.test.ts';
  const sources: Record<string, string> = {
    [sourceA]: 'export const a = 1;',
    [sourceB]: 'export const b = 1;',
    [selected]: "import '../../src/compiler/virtual-source-a.ts';"
  };
  const initialProvider = sourceProvider(sources);

  expect(selectTestsForSources([sourceA], initialProvider).fast).toEqual([selected]);
  const previousLength = Buffer.byteLength(sources[selected]!);
  sources[selected] = "import '../../src/compiler/virtual-source-b.ts';";
  expect(Buffer.byteLength(sources[selected]!)).toBe(previousLength);
  const mutatedProvider = sourceProvider(sources);
  expect(selectTestsForSources([sourceA], initialProvider).fast).toEqual([selected]);
  expect(selectTestsForSources([sourceA], mutatedProvider).fast).toEqual([]);
  expect(selectTestsForSources([sourceB], mutatedProvider).fast).toEqual([selected]);
});

test('deleted local dependency makes selection unresolved', () => {
  const consumer = 'tests/unit/retired-owner-consumer.test.ts';
  const provider = sourceProvider({
    [consumer]: "import '../../src/adapters/self-hosting/development/tooling/retired-owner.ts';"
  });

  expect(resolveTestImpactSelectionTrustBoundary(provider)).toEqual({
    selectionResolved: false,
    unresolvedModuleFiles: [consumer]
  });
});

test('imported machine data retains exact consumers for present and missing sources', () => {
  const data = 'src/compiler/virtual-registry.json';
  const consumer = 'src/compiler/virtual-registry-consumer.ts';
  const selected = 'tests/unit/virtual-registry-consumer.test.ts';
  const unrelated = 'tests/unit/virtual-unrelated.test.ts';
  const sources = {
    [consumer]: "import registry from './virtual-registry.json' with { type: 'json' }; export { registry };",
    [selected]: "import { registry } from '../../src/compiler/virtual-registry-consumer.ts'; void registry;",
    'src/compiler/virtual-unrelated.ts': 'export const unrelated = true;',
    [unrelated]: "import { unrelated } from '../../src/compiler/virtual-unrelated.ts'; void unrelated;"
  };

  for (const dataPresent of [true, false]) {
    const provider = sourceProvider({
      ...sources,
      ...(dataPresent ? { [data]: '{"enabled":true}\n' } : {})
    });
    expect(resolveTestImpactSelectionTrustBoundary(provider)).toEqual({
      selectionResolved: dataPresent,
      unresolvedModuleFiles: dataPresent ? [] : [consumer]
    });
    expect(selectTestsForSources([data], provider)).toEqual({
      fast: [selected],
      slow: [],
      owners: ['compiler']
    });
  }
});
