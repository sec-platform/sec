import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compileRepositorySourceProgramCompilation } from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../src/adapters/repository/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeWorkspaceSourceSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { currentActiveDocumentationPaths } from '../../src/adapters/self-hosting/control/documentation/active.ts';
import { issueTestInventoryProjection } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { classifyTestImpactSource } from '../../src/adapters/verification/platform/test-impact/contract/ownership.ts';
import { createRepositoryTestImpactSourceProvider, isTestImpactModuleGraphInputFile, isTestImpactSourceFile, readRepositoryModuleGraphV1, resolveTestImpactSelectionTrustBoundary, resolveTestOwnership, selectTestsForSources } from '../../src/adapters/verification/platform/test-impact/runtime/impact.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Git fixture command failed: git ${args.join(' ')}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function sourceProvider(sources: Readonly<Record<string, string>>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-test-impact-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'test-impact@sec.invalid']);
    git(root, ['config', 'user.name', 'SEC Test Impact']);
    const fixtureSources = {
      ...sources,
      ...(Object.keys(sources).some((repositoryPath) => repositoryPath.startsWith('src/compiler/'))
        ? { 'src/compiler/sec.module.json': '{"importGraph":"runtime","externalEntrypoints":[]}' }
        : {}),
      ...(Object.keys(sources).some((repositoryPath) => repositoryPath.startsWith('src/bootstrap/change-management/upgrade/'))
        ? { 'src/bootstrap/upgrade/sec.module.json': '{"importGraph":"runtime","externalEntrypoints":[]}' }
        : {})
    };
    for (const [repositoryPath, source] of Object.entries(fixtureSources)) {
      const filePath = path.join(root, ...repositoryPath.split('/'));
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source, 'utf8');
    }
    git(root, ['add', '--all']);
    git(root, ['commit', '--quiet', '-m', 'test-impact-fixture']);
    const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot: root,
      commitSha: git(root, ['rev-parse', 'HEAD'])
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function semanticSourceProvider(sources: Readonly<Record<string, string>>) {
  return sourceProvider(sources);
}

function expectUnique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

test('repository sources route by semantic kind and module identity', () => {
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

  const compilerFixturePath = 'src/compiler/fixture.ts';
  const provider = sourceProvider({
    [compilerFixturePath]: 'export const fixture = true;',
    'tests/unit/compiler-fixture.test.ts': "import { fixture } from '../../src/compiler/fixture.ts'; void fixture;",
    '.codex/agents/worker.toml': 'name = "worker"\n',
    'src/adapters/self-hosting/control/agent/skill.ts': 'export const role = true;',
    'src/adapters/self-hosting/control/agent/sec.module.json': '{"importGraph":"runtime","externalEntrypoints":[]}',
    'tests/unit/agent-fixture.test.ts': "import { role } from '../../src/adapters/self-hosting/control/agent/skill.ts'; void role;"
  });
  expect(resolveTestOwnership([compilerFixturePath], provider)).toEqual([{
    source: compilerFixturePath,
    owner: 'compiler',
    identity: { kind: 'module', id: 'compiler' }
  }]);
  expect(resolveTestOwnership(['.codex/agents/worker.toml'], provider)).toEqual([{
    source: '.codex/agents/worker.toml',
    owner: 'adapters.self-hosting.control.agent',
    identity: { kind: 'module', id: 'adapters.self-hosting.control.agent' }
  }]);
  expect(selectTestsForSources(['.codex/agents/worker.toml'], provider).fast)
    .toEqual(['tests/unit/agent-fixture.test.ts']);
});

test('observed git-hook entrypoints route through development hooks ownership', () => {
  const provider = sourceProvider({
    '.githooks/post-merge': '#!/usr/bin/env sh\nexec bun run dev -- workspace-transition post-merge "$@"\n',
    'src/adapters/self-hosting/development/hooks/install.ts': 'export const installHooks = true;',
    'src/adapters/self-hosting/development/hooks/sec.module.json': JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/adapters/self-hosting/development/hooks/install.ts'],
      capabilityProviders: [],
      preDependencyBootstrap: false
    }),
    'tests/unit/install-hooks-fixture.test.ts': "import { installHooks } from '../../src/adapters/self-hosting/development/hooks/install.ts'; void installHooks;"
  });

  expect(resolveTestOwnership(['.githooks/post-merge'], provider)).toEqual([{
    source: '.githooks/post-merge',
    owner: 'adapters.self-hosting.development.hooks',
    identity: { kind: 'module', id: 'adapters.self-hosting.development.hooks' }
  }]);
  expect(selectTestsForSources(['.githooks/post-merge'], provider).fast)
    .toContain('tests/unit/install-hooks-fixture.test.ts');
});

test('repository module graph is the single resolved dependency observation', () => {
  const provider = sourceProvider({
    'src/compiler/fixture.ts': 'export const fixture = true;',
    'tests/unit/compiler-fixture.test.ts': "import { fixture } from '../../src/compiler/fixture.ts'; void fixture;"
  });
  const graph = readRepositoryModuleGraphV1(provider);
  const resolution = resolveTestImpactSelectionTrustBoundary(provider);

  expect(resolution).toEqual({ selectionResolved: true, unresolvedModuleFiles: [] });
  expect(graph.files.length).toBeGreaterThan(0);
  expectUnique(graph.files);
  expectUnique(graph.references.map((reference) => (
    `${reference.from}\0${reference.kind}\0${reference.specifier}\0${reference.resolvedTarget ?? ''}`
  )));
  for (const reference of graph.references) {
    expect(reference.candidateTargets).toEqual([...new Set(reference.candidateTargets)].sort());
    if (reference.resolvedTarget !== null) expect(graph.files).toContain(reference.resolvedTarget);
  }
});

test('impact follows executable imports instead of import-like text', () => {
  const source = 'src/compiler/virtual-source.ts';
  const facade = 'src/compiler/virtual-entrypoint.ts';
  const helper = 'src/compiler/virtual-test-helper.ts';
  const selected = 'tests/unit/virtual-facade.test.ts';
  const ignored = 'tests/unit/virtual-import-text.test.ts';
  const provider = sourceProvider({
      [source]: 'export const value = 1;',
      [facade]: "export { value } from './virtual-source.ts';",
      [helper]: "export { value } from './virtual-entrypoint.ts';",
      [selected]: "import { value } from '../../src/compiler/virtual-test-helper.ts'; void value;",
      [ignored]: "const text = \"import '../../src/compiler/virtual-source.ts'\"; void text;"
  });

  const selection = selectTestsForSources([source], provider);
  expect(selection.fast).toEqual([selected]);
  expect(selection.slow).toEqual([]);
  expect(selection.owners).toEqual(['compiler']);
});

test('colocated source tests use the canonical repository test-module identity', () => {
  const source = 'src/compiler/colocated-source.ts';
  const selected = 'src/compiler/colocated-source.spec.ts';
  const provider = sourceProvider({
    [source]: 'export const value = 1;',
    [selected]: "import { value } from './colocated-source.ts'; void value;"
  });

  expect(isTestImpactModuleGraphInputFile(selected, provider)).toBe(false);
  expect(isTestImpactSourceFile(selected, provider)).toBe(false);
  expect(selectTestsForSources([source], provider).fast).toEqual([selected]);
});

test('compiler-resolved named barrel references do not select unrelated consumers', () => {
  const alpha = 'src/compiler/virtual-alpha.ts';
  const beta = 'src/compiler/virtual-beta.ts';
  const facade = 'src/compiler/virtual-public.ts';
  const alphaTest = 'tests/unit/virtual-alpha.test.ts';
  const betaTest = 'tests/unit/virtual-beta.test.ts';
  const provider = semanticSourceProvider({
    [alpha]: 'export const alpha = 1;',
    [beta]: 'export const beta = 2;',
    [facade]: "export { alpha } from './virtual-alpha.ts';\nexport { beta } from './virtual-beta.ts';",
    [alphaTest]: "import { alpha } from '../../src/compiler/virtual-public.ts'; void alpha;",
    [betaTest]: "import { beta } from '../../src/compiler/virtual-public.ts'; void beta;"
  });

  expect(selectTestsForSources([alpha], provider).fast).toEqual([alphaTest]);
  expect(selectTestsForSources([beta], provider).fast).toEqual([betaTest]);
  expect(selectTestsForSources([facade], provider).fast).toEqual([alphaTest, betaTest]);
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

test('imported machine data uses the same reverse dependency graph', () => {
  const data = 'src/compiler/virtual-registry.json';
  const consumer = 'src/compiler/virtual-registry-consumer.ts';
  const selected = 'tests/unit/virtual-registry-consumer.test.ts';
  const provider = sourceProvider({
      [consumer]: "import registry from './virtual-registry.json' with { type: 'json' }; export { registry };",
      [selected]: "import { registry } from '../../src/compiler/virtual-registry-consumer.ts'; void registry;"
  });

  expect(selectTestsForSources([data], provider)).toEqual({
    fast: [selected],
    slow: [],
    owners: ['compiler']
  });
});

test('non-code product inputs reach tests through semantic module owners', () => {
  const provider = sourceProvider({
    'catalog/registry/official/ticket.basic/block.manifest.yaml': 'id: ticket.basic\n',
    'src/compiler/virtual-manifest-consumer.ts': 'export const manifestConsumer = true;',
    'tests/unit/virtual-manifest-consumer.test.ts': "import { manifestConsumer } from '../../src/compiler/virtual-manifest-consumer.ts'; void manifestConsumer;"
  });
  const documentation = selectTestsForSources(['docs/产品/产品要求与工作约束.md'], provider);
  expect(documentation.owners).toContain('adapters.self-hosting.control.documentation');
  expect(documentation.fast).toEqual([]);
  expect(documentation.slow).toEqual([]);

  const manifest = selectTestsForSources([
    'catalog/registry/official/ticket.basic/block.manifest.yaml'
  ], provider);
  expect(manifest.owners).toEqual(expect.arrayContaining(['compiler', 'compiler.registry']));
  expect(manifest.fast.length + manifest.slow.length).toBeGreaterThan(0);
});
