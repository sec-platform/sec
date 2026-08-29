import { expect, test } from 'bun:test';

import {
  compileSourceProgramTestBaselineEvidence,
  compileRepositorySourceProgramModel,
  compileSourceProgramTestValue
} from './index.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';

const repositoryRoot = process.cwd();
const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

interface CompileOptions {
  readonly baselineTestPaths?: readonly string[];
  readonly baselineEvidence?: readonly unknown[];
  readonly dispositions?: readonly unknown[];
}

function sourceRevisionFor(files: Readonly<Record<string, string>>): string {
  const sourceFiles = Object.entries(files).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: sha256(source)
  }));
  return sha256(sourceFiles.map(({ path, contentDigest }) => ({
    path,
    contentDigest
  })));
}

function compile(
  files: Readonly<Record<string, string>>,
  missing: readonly string[] = [],
  options: CompileOptions = {}
) {
  const sourceFiles = Object.entries(files).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: sha256(source)
  }));
  const sourceRevision = sourceRevisionFor(files);
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files: sourceFiles,
    moduleMembership,
    unknowns: missing.map((path) => Object.freeze({
      code: 'working-tree-path-unreadable',
      path,
      detail: 'ENOENT',
      span: null
    }))
  });
  return compileSourceProgramTestValue({
    repositoryRoot,
    files: sourceFiles,
    model,
    baselineTestPaths: options.baselineTestPaths ?? [
      ...Object.keys(files).filter((path) => /^(?:src|tests)\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(path)),
      ...missing
    ],
    baselineEvidence: options.baselineEvidence,
    dispositions: options.dispositions
  });
}

test('test-value compilation derives behavior, effects, failures, and properties from syntax and call boundaries', () => {
  const result = compile({
    'platform/example/index.ts': [
      'export function publicBehavior(value: number): number {',
      '  if (value < 0) throw new Error("negative");',
      '  return value + 1;',
      '}'
    ].join('\n'),
    'tests/unit/example.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import fs from 'node:fs/promises';",
      "import { publicBehavior } from '../../platform/example/index.ts';",
      "test('observes the public boundary and durable effect', async () => {",
      "  const target = 'test-output';",
      "  await fs.writeFile(target, String(publicBehavior(1)));",
      "  expect(await fs.readFile(target, 'utf8')).toBe('2');",
      '});',
      "test('preserves the typed failure boundary over a property set', () => {",
      '  for (const value of [-1, -2]) expect(() => publicBehavior(value)).toThrow();',
      '});'
    ].join('\n')
  });

  expect(result.records.map(({ semanticClasses }) => semanticClasses)).toEqual([
    ['behavior', 'durable-state', 'effect'],
    ['algorithm-property', 'behavior', 'failure-boundary']
  ]);
  expect(result.records.every(({ observedProductionPaths }) =>
    observedProductionPaths.includes('platform/example/index.ts'))).toBe(true);
  expect(result.findings).toEqual([]);
});

test('test-value compilation blocks missing modules and implementation-shape mirrors', () => {
  const missing = 'tests/unit/deleted.test.ts';
  const result = compile({
    'platform/example/index.ts': 'export const FORMAT = Object.freeze({ formatVersion: "1" });\n',
    'tests/helpers/fixture.ts': 'export const fixture = true;\n',
    'tests/unit/arity-mirror.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { publicBehavior } from '../../platform/example/behavior.ts';",
      "test('mirrors function shape', () => {",
      '  expect(publicBehavior.length).toBe(1);',
      '});'
    ].join('\n'),
    'tests/unit/source-reader.test.ts': [
      "import { test } from 'bun:test';",
      "import fs from 'node:fs/promises';",
      "test('reads implementation text', async () => {",
      "  await fs.readFile('platform/example/index.ts', 'utf8');",
      '});'
    ].join('\n'),
    'tests/unit/version-mirror.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { FORMAT } from '../../platform/example/index.ts';",
      "test('mirrors a format number', () => {",
      "  expect(FORMAT.formatVersion).toBe('1');",
      '});'
    ].join('\n')
  }, [missing]);

  expect(result.findings.map(({ code, path }) => ({ code, path }))).toEqual([
    {
      code: 'test-mirrors-imported-function-arity',
      path: 'tests/unit/arity-mirror.test.ts'
    },
    {
      code: 'test-module-disposition-unbound',
      path: missing
    },
    {
      code: 'test-module-missing-from-worktree',
      path: missing
    },
    {
      code: 'test-reads-production-source-text',
      path: 'tests/unit/source-reader.test.ts'
    },
    {
      code: 'test-asserts-only-version-identity',
      path: 'tests/unit/version-mirror.test.ts'
    }
  ]);
});

test('baseline test dispositions require owner evidence and a real replacement or empty census', () => {
  const files = {
    'platform/example/index.ts': [
      'export function publicBehavior(value: number): number {',
      '  if (value < 0) throw new Error("negative");',
      '  return value + 1;',
      '}'
    ].join('\n'),
    'tests/unit/replacement.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { publicBehavior } from '../../platform/example/index.ts';",
      "test('replaces a removed test with the same public behavior', () => {",
      '  expect(publicBehavior(1)).toBe(2);',
      '});'
    ].join('\n')
  };
  const baselineTestPaths = [
    'tests/unit/replacement.test.ts',
    'tests/unit/deleted.test.ts',
    'tests/unit/rewritten.test.ts',
    'tests/unit/unknown.test.ts',
    'tests/unit/live-contract.test.ts'
  ];
  const sourceRevision = sourceRevisionFor(files);
  const seed = compile(files, [], { baselineTestPaths });
  const replacementTestId = seed.records.find(({ path }) =>
    path === 'tests/unit/replacement.test.ts')?.testId;
  expect(replacementTestId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  const evidence = (
    path: string,
    disposition: 'delete' | 'rewrite' | 'merge' | 'unknown',
    census: Readonly<Record<'producerCount' | 'consumerCount' | 'externalContractCount', number>>,
    replacementTestIds: readonly string[] = []
  ) => ({
    path,
    disposition,
    evidence: {
      owner: 'brownfield.test-value',
      sourceRevision,
      replacementTestIds,
      census
    }
  });
  const result = compile(files, [], {
    baselineTestPaths,
    dispositions: [
      evidence('tests/unit/deleted.test.ts', 'delete', {
        producerCount: 0,
        consumerCount: 0,
        externalContractCount: 0
      }),
      evidence('tests/unit/rewritten.test.ts', 'rewrite', {
        producerCount: 1,
        consumerCount: 1,
        externalContractCount: 0
      }, replacementTestId === undefined ? [] : [replacementTestId]),
      evidence('tests/unit/unknown.test.ts', 'unknown', {
        producerCount: 0,
        consumerCount: 0,
        externalContractCount: 0
      }),
      evidence('tests/unit/live-contract.test.ts', 'delete', {
        producerCount: 1,
        consumerCount: 0,
        externalContractCount: 0
      })
    ]
  });

  expect(result.dispositions).toHaveLength(4);
  expect(result.baselineDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(result.findings.map(({ code, path }) => ({ code, path }))).toEqual([
    {
      code: 'test-module-delete-contract-not-empty',
      path: 'tests/unit/live-contract.test.ts'
    },
    {
      code: 'test-module-disposition-unknown',
      path: 'tests/unit/unknown.test.ts'
    }
  ]);
  expect(result.findings.every(({ disposition }) => disposition !== null)).toBe(true);
  expect(() => compile(files, [], {
    baselineTestPaths,
    dispositions: [{
      ...evidence('tests/unit/deleted.test.ts', 'delete', {
        producerCount: 0,
        consumerCount: 0,
        externalContractCount: 0
      }),
      extra: true
    }]
  })).toThrow('unknown field');
});

test('baseline Git evidence derives DELETE only for a proven zero graph', () => {
  const candidateFiles = {
    'platform/example/index.ts': 'export const value = 1;\n',
    'tests/unit/replacement.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { value } from '../../platform/example/index.ts';",
      "test('replacement', () => expect(value).toBe(1));"
    ].join('\n')
  };
  const baselinePaths = [
    'tests/unit/empty.test.ts',
    'tests/unit/production.test.ts',
    'tests/unit/provider.test.ts'
  ];
  const baselineSources = [
    Object.freeze({
      path: baselinePaths[0]!,
      source: "import { test } from 'bun:test';\ntest('orphan assertion', () => expect(1).toBe(1));\n",
      contentDigest: sha256("import { test } from 'bun:test';\ntest('orphan assertion', () => expect(1).toBe(1));\n")
    }),
    Object.freeze({
      path: baselinePaths[1]!,
      source: [
        "import { test } from 'bun:test';",
        "import { value } from '../../platform/example/index.ts';",
        "test('business behavior', () => expect(value).toBe(1));"
      ].join('\n'),
      contentDigest: sha256([
        "import { test } from 'bun:test';",
        "import { value } from '../../platform/example/index.ts';",
        "test('business behavior', () => expect(value).toBe(1));"
      ].join('\n'))
    }),
    Object.freeze({
      path: baselinePaths[2]!,
      source: [
        "import { test } from 'bun:test';",
        "import fs from 'node:fs/promises';",
        "test('provider behavior', async () => fs.readFile('x'));"
      ].join('\n'),
      contentDigest: sha256([
        "import { test } from 'bun:test';",
        "import fs from 'node:fs/promises';",
        "test('provider behavior', async () => fs.readFile('x'));"
      ].join('\n'))
    })
  ];
  const baselineRevision = sha256(baselineSources.map(({ path, contentDigest }) => ({
    path,
    contentDigest
  })));
  const baselineEvidence = compileSourceProgramTestBaselineEvidence(
    baselinePaths,
    baselineSources,
    baselineRevision,
    Object.entries(candidateFiles).map(([path, source]) => Object.freeze({
      path,
      source,
      contentDigest: sha256(source)
    }))
  );
  const result = compile(candidateFiles, [], {
    baselineTestPaths: baselinePaths,
    baselineEvidence
  });
  expect(result.dispositions.map(({ path, disposition }) => ({ path, disposition }))).toEqual([
    { path: 'tests/unit/empty.test.ts', disposition: 'delete' },
    { path: 'tests/unit/production.test.ts', disposition: 'unknown' },
    { path: 'tests/unit/provider.test.ts', disposition: 'unknown' }
  ]);
  expect(result.findings.map(({ code, path }) => ({ code, path }))).toEqual([
    { code: 'test-module-disposition-unknown', path: 'tests/unit/production.test.ts' },
    { code: 'test-module-disposition-unknown', path: 'tests/unit/provider.test.ts' }
  ]);
  expect(result.baselineEvidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});
