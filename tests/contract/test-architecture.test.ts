import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { posixPath } from '../../platform/shared/paths.ts';
import {
  getSlowTestSuitesSync,
  isFastTestFile
} from '../../platform/shared/test-budget-contract.ts';

const repoRoot = process.cwd();
const canonicalTestkitFiles = [
  'tests/testkit/cli.ts',
  'tests/testkit/contracts.ts',
  'tests/testkit/workspace.ts'
];
const legacyAliasFiles = [
  ['tests', 'helpers', 'cli-helpers.ts'].join('/'),
  ['tests', 'helpers', 'workspace-fixtures.ts'].join('/'),
  ['tests', 'helpers', 'scenario.ts'].join('/')
];
const legacyImportSpecifiers = [
  ['..', 'helpers', 'cli-helpers.ts'].join('/'),
  ['..', 'helpers', 'workspace-fixtures.ts'].join('/'),
  ['.', 'workspace-fixtures.ts'].join('/')
];
const canonicalPackageTestScripts = ['test', 'test:affected', 'test:fast', 'test:slow', 'test:full'];
const forbiddenPackageTestAliases = [
  'test:changed',
  'test:all',
  'test:quick',
  'test:ci',
  'test:smoke',
  'test:runtime-full',
  'test:workspace',
  'test:watch',
  'test:coverage',
  'check:changed',
  'check:lite',
  'check:pr'
];
const activeDocsWithIntentionalForbiddenExamples = new Set([
  'docs/test-architecture.md'
]);
const forbiddenActiveDocFragments = [
  "from 'vitest'",
  'from "vitest"',
  'tests/overview/',
  'tests/cli/',
  'tests/pipeline/',
  'tests/helpers/cli-helpers.ts',
  'tests/helpers/workspace-fixtures.ts',
  'fast/runtime/all 三 lane',
  'PR/push → fast lane，schedule/manual → all lane',
  '`imports:check` 在 typecheck 之后检查 TypeScript import baseline',
  'changed slow test files require explicit slow verification',
  'future `scenario()` helpers',
  'slow-suite matrix: upgrade, runtime, pipeline, repair, registry, explain, other',
  'Recommended package script shape',
  '"test:affected": "bun ./platform/dev-runner.ts test:affected"'
];

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listFiles(relativeRoot: string, extension: string): Promise<string[]> {
  const root = path.join(repoRoot, relativeRoot);
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name.endsWith(extension)) {
        files.push(posixPath(path.relative(repoRoot, entryPath)));
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function listTypeScriptFiles(relativeRoot: string): Promise<string[]> {
  return listFiles(relativeRoot, '.ts');
}

async function listMarkdownFiles(relativeRoot: string): Promise<string[]> {
  return listFiles(relativeRoot, '.md');
}

test('test architecture exposes only canonical testkit primitives', async () => {
  await expect(Promise.all(canonicalTestkitFiles.map(pathExists))).resolves.toEqual([true, true, true]);
  await expect(Promise.all(legacyAliasFiles.map(pathExists))).resolves.toEqual([false, false, false]);
});

test('production runtime acceptance is owned by the registered slow runtime-host suite', async () => {
  const fastRuntimeFile = 'tests/integration/project-runtime.test.ts';
  const slowRuntimeFile = 'tests/e2e/runtime-host.test.ts';
  const [fastSource, slowSource] = await Promise.all([
    fs.readFile(path.join(repoRoot, fastRuntimeFile), 'utf8'),
    fs.readFile(path.join(repoRoot, slowRuntimeFile), 'utf8')
  ]);
  const runtimeHostSuite = getSlowTestSuitesSync().find((suite) => suite.id === 'e2e-runtime-host');

  expect(isFastTestFile(fastRuntimeFile)).toBe(true);
  expect(isFastTestFile(slowRuntimeFile)).toBe(false);
  expect(runtimeHostSuite?.files).toEqual([slowRuntimeFile]);
  expect(fastSource).not.toContain('withIsolatedRuntimeAcceptanceServer');
  expect(fastSource).not.toContain('isolated runtime acceptance launches generated Next');
  expect(slowSource).toContain('withIsolatedRuntimeAcceptanceServer');
  expect(slowSource).toContain('isolated runtime acceptance launches generated Next');
});

test('testkit primitives do not depend on helper-layer fixtures', async () => {
  const offenders: string[] = [];

  for (const file of canonicalTestkitFiles) {
    const source = await fs.readFile(path.join(repoRoot, file), 'utf8');
    if (source.includes("'../helpers/") || source.includes('"../helpers/')) {
      offenders.push(file);
    }
  }

  expect(offenders).toEqual([]);
});

test('test sources do not import legacy test helper aliases', async () => {
  const offenders: string[] = [];

  for (const file of await listTypeScriptFiles('tests')) {
    if (file === 'tests/contract/test-architecture.test.ts') {
      continue;
    }
    const source = await fs.readFile(path.join(repoRoot, file), 'utf8');
    for (const specifier of legacyImportSpecifiers) {
      if (source.includes(`'${specifier}'`) || source.includes(`"${specifier}"`)) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test('root package exposes only canonical test entry scripts', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  expect(Object.keys(packageJson.scripts).filter((name) => name === 'test' || name.startsWith('test:')).sort()).toEqual([
    ...canonicalPackageTestScripts,
    'test:benchmark-contract',
    'test:budget',
    'test:contract-freeze'
  ].sort());
  for (const scriptName of forbiddenPackageTestAliases) {
    expect(packageJson.scripts[scriptName]).toBeUndefined();
  }
});

test('active docs do not reintroduce legacy test architecture examples', async () => {
  const offenders: string[] = [];

  for (const file of await listMarkdownFiles('docs')) {
    if (file.startsWith('docs/archive/') || activeDocsWithIntentionalForbiddenExamples.has(file)) {
      continue;
    }
    const source = await fs.readFile(path.join(repoRoot, file), 'utf8');
    for (const fragment of forbiddenActiveDocFragments) {
      if (source.includes(fragment)) {
        offenders.push(`${file} -> ${fragment}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

/**
 * LLVM 风格代码生成契约：compose 层生成 TS 源码必须经 CodeBuilder 程序化构造，
 * 不允许大段模板字符串拼接（类似 LLVM IRBuilder 的设计约束）。
 *
 * 受约束文件：platform/compiler/compose/ 下所有调用 writeText 写 .ts/.tsx 文件的模块。
 * 当前覆盖：microservice-lower-pass.ts、compose-project.ts。
 * 若新增 compose 模块需要生成 TS 源码，必须 import CodeBuilder。
 */
const codegenComposeFiles = [
  'platform/compiler/compose/microservice-lower-pass.ts',
  'platform/compiler/compose/compose-project.ts'
];
const codegenBuilderImport = '../codegen/code-builder.ts';

test('compose-layer TS codegen uses CodeBuilder instead of template string concatenation', async () => {
  const offenders: string[] = [];

  for (const file of codegenComposeFiles) {
    const source = await fs.readFile(path.join(repoRoot, file), 'utf8');
    if (!source.includes(`from '${codegenBuilderImport}'`) && !source.includes(`from "${codegenBuilderImport}"`)) {
      offenders.push(`${file} missing import of CodeBuilder from ${codegenBuilderImport}`);
    }
    // 禁止大段模板字符串生成 TS 代码的模式：const xxxContent = `// @generated
    // 这类模式表明仍在用模板字符串拼接而非 CodeBuilder
    const templateCodegenPattern = /const\s+\w+Content\s*=\s*`\/\/\s*@generated/;
    if (templateCodegenPattern.test(source)) {
      offenders.push(`${file} still uses template string concatenation for @generated TS code`);
    }
  }

  expect(offenders).toEqual([]);
});

test('isolated Verification evidence does not depend back on its child runner', async () => {
  const evidenceSource = await fs.readFile(
    path.join(
      repoRoot,
      'platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts'
    ),
    'utf8'
  );
  expect(evidenceSource).not.toContain("from './run-semantic-mutation-isolated-child.ts'");
});

/**
 * 编译器门面契约：read-only API 通过 platform/compiler/index.ts 暴露；具有副作用的运行时
 * 不得进入 public facade，只能由拥有对应 pipeline stage 的 production owner 直接导入 canonical
 * internal module。除下列精确 owner -> side-effect/runtime module pair 外，platform/ 仍不得导入编译器子目录。
 */
const compilerInternalSubdirs = ['align', 'codegen', 'compose', 'emit', 'parse', 'repair', 'resolve', 'synthesize', 'verify', 'workbench'];
const compilerInternalOwnerImportAllowlist: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'platform/orchestrator/compose-orchestrator.ts': Object.freeze([
    '../compiler/compose/compose-project.ts',
    '../compiler/synthesize/adapt-project.ts'
  ]),
  'platform/orchestrator/emit-orchestrator.ts': Object.freeze([
    '../compiler/emit/ci-artifacts.ts',
    '../compiler/emit/lock-project.ts',
    '../compiler/emit/write-explain-graph.ts',
    '../compiler/emit/write-local-views.ts',
    '../compiler/emit/write-review-summary.ts'
  ]),
  'platform/orchestrator/repair-orchestrator.ts': Object.freeze([
    '../compiler/repair/build-repair-plan.ts'
  ]),
  'platform/orchestrator/semantic-mutation-orchestrator.ts': Object.freeze([
    '../compiler/verify/run-semantic-mutation-isolated-child.ts',
    '../compiler/verify/semantic-mutation-isolated-verification-evidence.ts',
    '../compiler/verify/semantic-mutation-isolated-verification-failure.ts',
    '../compiler/verify/staged-verification-proof.ts'
  ]),
  'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts': Object.freeze([
    '../compiler/verify/windows-browser-launch-path.ts'
  ]),
  'platform/orchestrator/verify-orchestrator.ts': Object.freeze([
    '../compiler/verify/staged-verification-proof.ts',
    '../compiler/verify/verify-project.ts',
    '../compiler/verify/write-policy-snapshot.ts'
  ]),
  'platform/orchestrator/workbench-orchestrator.ts': Object.freeze([
    '../compiler/workbench/apply-view-mutations.ts'
  ]),
  'platform/upgrade/upgrade-workspace.ts': Object.freeze([
    '../compiler/emit/write-provenance.ts'
  ])
});
const compilerInternalImportPattern = new RegExp(
  `from\\s+['"](?<specifier>\\.\\./compiler/(?:${compilerInternalSubdirs.join('|')})/[^'"]+)['"]`,
  'g'
);

function compilerInternalImportIsAllowed(file: string, specifier: string): boolean {
  return compilerInternalOwnerImportAllowlist[file]?.includes(specifier) ?? false;
}

test('platform modules import compiler APIs through the facade or an exact owner-scoped runtime boundary', async () => {
  const offenders: string[] = [];
  const observedAllowedPairs: string[] = [];
  const allPlatformFiles = await listTypeScriptFiles('platform');

  for (const file of allPlatformFiles) {
    // 跳过编译器自身（包括 facade 和内部子目录）
    if (file.startsWith('platform/compiler/')) continue;
    // 跳过测试文件（测试可以直接导入内部模块做白盒测试）
    if (file.startsWith('tests/')) continue;

    const source = await fs.readFile(path.join(repoRoot, file), 'utf8');
    for (const match of source.matchAll(compilerInternalImportPattern)) {
      const specifier = match.groups?.specifier;
      if (!specifier) throw new Error(`Compiler internal import capture failed for ${file}`);
      const line = source.slice(0, match.index ?? 0).split('\n').length;
      const pair = `${file} -> ${specifier}`;
      if (compilerInternalImportIsAllowed(file, specifier)) {
        observedAllowedPairs.push(pair);
      } else {
        offenders.push(`${file}:${line} -> ${specifier}`);
      }
    }
  }

  expect(offenders).toEqual([]);
  const expectedAllowedPairs = Object.entries(compilerInternalOwnerImportAllowlist)
    .flatMap(([file, specifiers]) => specifiers.map((specifier) => `${file} -> ${specifier}`))
    .sort();
  expect(observedAllowedPairs.sort()).toEqual(expectedAllowedPairs);
  expect(compilerInternalImportIsAllowed(
    'platform/orchestrator/unknown-owner.ts',
    '../compiler/emit/write-provenance.ts'
  )).toBe(false);
  expect(compilerInternalImportIsAllowed(
    'platform/orchestrator/emit-orchestrator.ts',
    '../compiler/emit/unknown-writer.ts'
  )).toBe(false);
});
