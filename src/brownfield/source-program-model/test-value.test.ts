import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { isSecRepositoryTestModulePath } from '../../system-architecture/repository-modules/test-module-path.ts';
import type { SourceProgramSupersessionReceipt } from './contract.ts';
import { compileRepositorySourceProgramModel } from './repository.ts';
import {
  compileSourceProgramTestBaselineEvidence,
  compileSourceProgramTestValue,
  reconcileSourceProgramTestValueWithSupersession
} from './test-value.ts';
import { compileTypeScriptSourceProgramModel } from './typescript.ts';

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
    contentDigest: rawSha256(source)
  }));
  return sha256(sourceFiles.map(({ path, contentDigest }) => ({
    path,
    contentDigest
  })));
}

function compileExactTypeScriptModel(files: readonly Readonly<{
  path: string;
  source: string;
  contentDigest: string;
}>[]) {
  return compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
}

function compile(
  files: Readonly<Record<string, string>>,
  missing: readonly string[] = [],
  options: CompileOptions = {}
) {
  const sourceFiles = Object.entries(files).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = sourceRevisionFor(files);
  const typeScriptModel = compileExactTypeScriptModel(sourceFiles);
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files: sourceFiles,
    moduleMembership,
    typescriptModel: typeScriptModel,
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
      ...Object.keys(files).filter(isSecRepositoryTestModulePath),
      ...missing
    ],
    baselineEvidence: options.baselineEvidence,
    dispositions: options.dispositions
  });
}

test('test-value compilation derives behavior, effects, failures, and properties from syntax and call boundaries', () => {
  const result = compile({
    'src/example/index.ts': [
      'export function publicBehavior(value: number): number {',
      '  if (value < 0) throw new Error("negative");',
      '  return value + 1;',
      '}'
    ].join('\n'),
    'tests/unit/example.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import fs from 'node:fs/promises';",
      "import { publicBehavior } from '../../src/example/index.ts';",
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
    observedProductionPaths.includes('src/example/index.ts'))).toBe(true);
  expect(result.findings).toEqual([]);
});

test('test-value compilation blocks missing modules and implementation-shape mirrors', () => {
  const missing = 'tests/unit/deleted.test.ts';
  const result = compile({
    'src/example/index.ts': 'export const FORMAT = Object.freeze({ formatVersion: "1" });\n',
    'tests/helpers/fixture.ts': 'export const fixture = true;\n',
    'tests/unit/arity-mirror.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { publicBehavior } from '../../src/example/behavior.ts';",
      "test('mirrors function shape', () => {",
      '  expect(publicBehavior.length).toBe(1);',
      '});'
    ].join('\n'),
    'tests/unit/source-reader.test.ts': [
      "import { test } from 'bun:test';",
      "import fs from 'node:fs/promises';",
      "test('reads implementation text', async () => {",
      "  await fs.readFile('src/example/index.ts', 'utf8');",
      '});'
    ].join('\n'),
    'tests/unit/version-mirror.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { FORMAT } from '../../src/example/index.ts';",
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

test('caller-authored DELETE and MERGE cannot bypass Source Program supersession proof', () => {
  const files = {
    'src/example/index.ts': [
      'export function publicBehavior(value: number): number {',
      '  if (value < 0) throw new Error("negative");',
      '  return value + 1;',
      '}'
    ].join('\n'),
    'tests/unit/replacement.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { publicBehavior } from '../../src/example/index.ts';",
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
      evidence('tests/unit/rewritten.test.ts', 'rewrite', {
        producerCount: 1,
        consumerCount: 1,
        externalContractCount: 0
      }, replacementTestId === undefined ? [] : [replacementTestId]),
      evidence('tests/unit/unknown.test.ts', 'unknown', {
        producerCount: 0,
        consumerCount: 0,
        externalContractCount: 0
      })
    ]
  });

  expect(result.dispositions).toHaveLength(2);
  expect(result.baselineDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(result.findings.map(({ code, path }) => ({ code, path }))).toEqual([
    { code: 'test-module-disposition-unbound', path: 'tests/unit/deleted.test.ts' },
    { code: 'test-module-missing-from-worktree', path: 'tests/unit/deleted.test.ts' },
    { code: 'test-module-disposition-unbound', path: 'tests/unit/live-contract.test.ts' },
    { code: 'test-module-missing-from-worktree', path: 'tests/unit/live-contract.test.ts' },
    {
      code: 'test-module-disposition-unknown',
      path: 'tests/unit/unknown.test.ts'
    }
  ]);
  expect(result.findings.filter(({ path }) => path === 'tests/unit/unknown.test.ts')
    .every(({ disposition }) => disposition !== null)).toBe(true);
  expect(() => compile(files, [], {
    baselineTestPaths,
    dispositions: [evidence('tests/unit/deleted.test.ts', 'delete', {
      producerCount: 0,
      consumerCount: 0,
      externalContractCount: 0
    })]
  })).toThrow('DELETE requires a Source Program supersession receipt');
  expect(() => compile(files, [], {
    baselineTestPaths,
    dispositions: [evidence('tests/unit/deleted.test.ts', 'merge', {
      producerCount: 0,
      consumerCount: 0,
      externalContractCount: 0
    }, replacementTestId === undefined ? [] : [replacementTestId])]
  })).toThrow('MERGE requires a Source Program supersession receipt');
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

test('baseline Git census stays UNKNOWN without Source Program retirement proof', () => {
  const candidateFiles = {
    'src/example/index.ts': 'export const value = 1;\n',
    'tests/unit/replacement.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { value } from '../../src/example/index.ts';",
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
      contentDigest: rawSha256("import { test } from 'bun:test';\ntest('orphan assertion', () => expect(1).toBe(1));\n")
    }),
    Object.freeze({
      path: baselinePaths[1]!,
      source: [
        "import { test } from 'bun:test';",
        "import { value } from '../../src/example/index.ts';",
        "test('business behavior', () => expect(value).toBe(1));"
      ].join('\n'),
      contentDigest: rawSha256([
        "import { test } from 'bun:test';",
        "import { value } from '../../src/example/index.ts';",
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
      contentDigest: rawSha256([
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
  const candidateSourceFiles = Object.entries(candidateFiles).map(([path, source]) => Object.freeze({
      path,
      source,
      contentDigest: rawSha256(source)
    }));
  const baselineEvidence = compileSourceProgramTestBaselineEvidence({
    baselineTestPaths: baselinePaths,
    baselineModel: compileExactTypeScriptModel(baselineSources),
    candidateModel: compileExactTypeScriptModel(candidateSourceFiles),
    baselineRevision
  });
  expect(baselineEvidence.map(({ observationStatus, observationReason }) => ({
    observationStatus,
    observationReason
  }))).toEqual([
    { observationStatus: 'resolved', observationReason: null },
    { observationStatus: 'resolved', observationReason: null },
    { observationStatus: 'resolved', observationReason: null }
  ]);
  expect(() => compile(candidateFiles, [], {
    baselineTestPaths: baselinePaths,
    baselineEvidence: [{
      ...baselineEvidence[0],
      observationStatus: 'unresolved',
      observationReason: 'caller-invented-reason'
    }]
  })).toThrow('unresolved evidence requires one canonical reason');
  const result = compile(candidateFiles, [], {
    baselineTestPaths: baselinePaths,
    baselineEvidence
  });
  expect(result.dispositions.map(({ path, disposition }) => ({ path, disposition }))).toEqual([
    { path: 'tests/unit/empty.test.ts', disposition: 'unknown' },
    { path: 'tests/unit/production.test.ts', disposition: 'unknown' },
    { path: 'tests/unit/provider.test.ts', disposition: 'unknown' }
  ]);
  expect(result.findings.map(({ code, path }) => ({ code, path }))).toEqual([
    { code: 'test-module-disposition-unknown', path: 'tests/unit/empty.test.ts' },
    { code: 'test-module-disposition-unknown', path: 'tests/unit/production.test.ts' },
    { code: 'test-module-disposition-unknown', path: 'tests/unit/provider.test.ts' }
  ]);
  expect(result.baselineEvidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('strict supersession receipt derives MERGE with exact replacement test ids', () => {
  const candidateFiles = {
    'src/example/index.ts': 'export const value = 1;\n',
    'tests/unit/replacement.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { value } from '../../src/example/index.ts';",
      "test('observes behavior and failure', () => expect(value).toBe(1));"
    ].join('\n')
  };
  const baselinePath = 'tests/unit/retired.test.ts';
  const baselineSource = [
    "import { expect, test } from 'bun:test';",
    "test('old observation', () => expect(1).toBe(1));"
  ].join('\n');
  const baselineFiles = [Object.freeze({
    path: baselinePath,
    source: baselineSource,
    contentDigest: rawSha256(baselineSource)
  })];
  const baselineRevision = sha256(baselineFiles.map(({ path, contentDigest }) => ({
    path,
    contentDigest
  })));
  const candidateSourceFiles = Object.entries(candidateFiles).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const initial = compile(candidateFiles, [], {
    baselineTestPaths: [baselinePath],
    baselineEvidence: compileSourceProgramTestBaselineEvidence({
      baselineTestPaths: [baselinePath],
      baselineModel: compileExactTypeScriptModel(baselineFiles),
      candidateModel: compileExactTypeScriptModel(candidateSourceFiles),
      baselineRevision
    })
  });
  const replacement = initial.records[0];
  expect(replacement).toBeDefined();
  expect(initial.dispositions[0]?.disposition).toBe('unknown');
  const canonicalReceipt = Object.freeze({
    status: 'superseded' as const,
    baseline: Object.freeze({
      sourceRevision: baselineRevision,
      modelDigest: sha256('baseline-model'),
      testCompilationDigest: sha256('baseline-tests'),
      intentEvidenceDigest: sha256('baseline-intent')
    }),
    current: Object.freeze({
      sourceRevision: initial.sourceRevision,
      modelDigest: sha256('current-model'),
      testCompilationDigest: initial.compilationDigest,
      intentEvidenceDigest: sha256('current-intent')
    }),
    lifecycleCost: Object.freeze({
      baseline: Object.freeze({
        productionUnits: 1,
        testUnits: 2,
        owners: 1,
        unresolvedObservations: 0,
        unobservedTestRisk: 0
      }),
      current: Object.freeze({
        productionUnits: 1,
        testUnits: 1,
        owners: 1,
        unresolvedObservations: 0,
        unobservedTestRisk: 0
      })
    }),
    replacements: Object.freeze([Object.freeze({
      kind: 'test' as const,
      baselineId: sha256('baseline-test'),
      currentIds: Object.freeze([replacement!.testId]),
      owner: null,
      baselinePaths: Object.freeze([baselinePath]),
      currentPaths: Object.freeze([replacement!.path]),
      proof: 'strict-observation-superset' as const
    })]),
    findings: Object.freeze([])
  });
  const receipt: SourceProgramSupersessionReceipt = Object.freeze({
    ...canonicalReceipt,
    receiptDigest: sha256(canonicalReceipt)
  });

  const reconciled = reconcileSourceProgramTestValueWithSupersession(initial, receipt);
  expect(reconciled.dispositions).toEqual([
    expect.objectContaining({
      path: baselinePath,
      disposition: 'merge',
      evidence: expect.objectContaining({
        replacementTestIds: [replacement!.testId],
        supersession: {
          receiptDigest: receipt.receiptDigest,
          baselineTestId: sha256('baseline-test'),
          proof: 'strict-observation-superset'
        }
      })
    })
  ]);
  expect(reconciled.findings).toEqual([]);
  expect(reconciled.supersessionReceiptDigest).toBe(receipt.receiptDigest);
  expect(reconciled.observationCompilationDigest).toBe(initial.compilationDigest);
  expect(reconciled.projectionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

  const forged = Object.freeze({
    ...receipt,
    current: Object.freeze({
      ...receipt.current,
      testCompilationDigest: sha256('different-compilation')
    })
  });
  expect(reconcileSourceProgramTestValueWithSupersession(initial, forged))
    .toMatchObject({
      dispositions: initial.dispositions,
      findings: initial.findings,
      supersessionReceiptDigest: null
    });
  expect(reconcileSourceProgramTestValueWithSupersession(initial, Object.freeze({
    ...receipt,
    status: 'owner-decision-required'
  }))).toMatchObject({
    dispositions: initial.dispositions,
    findings: initial.findings,
    supersessionReceiptDigest: null
  });
});
