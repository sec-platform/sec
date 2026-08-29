import { expect, test } from 'bun:test';
import { buildBenchmarkTaskSuiteContract, formatBenchmarkTaskSuiteContract } from '../../src/verification/benchmark/contract.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { buildTestBudgetContract, formatTestBudgetContract, getFastTestFilesSync, getSlowTestSuitesSync, isFastTestFile, isTestFile } from '../../src/verification/test-impact/contract/budget.ts';
import { expectContainsAll } from '../helpers/assertion-helpers.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import {
  expectBenchmarkTaskSuiteSelfConsistent,
  expectTestBudgetSelfConsistent
} from '../testkit/contracts.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const expectedTestBudgetLocalDefault = 'bun run check:affected runs affected fast tests and skips broad source fallback unless SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1; use test:slow -- --suite <id>, test:full, or check:full for slow runtime gates';

test('CLI exposes benchmark task-suite as text and JSON contracts', async () => {
  const contract = buildBenchmarkTaskSuiteContract();
  const formatted = formatBenchmarkTaskSuiteContract(contract);
  const artifactPaths = contract.artifactPaths;
  const overrideConflictTask = contract.tasks.find((task) => task.id === 'override-conflict');
  if (!overrideConflictTask) {
    throw new Error('Expected benchmark override-conflict task');
  }

  expectContainsAll(formatted, [
    'Benchmark suite engineering-compiler-core (active)',
    'Task add-block: install one capability block into a clean workspace; gate=resolve compose adapt verify lock explain'
  ]);
  expect(JSON.stringify(contract)).not.toContain('\n');
  expectBenchmarkTaskSuiteSelfConsistent(contract);
  expect(contract).toMatchObject({
    suiteId: 'engineering-compiler-core',
    status: 'active',
    command: 'bun run sec -- benchmark suite --json',
    runnerCommand: 'bun run test:benchmark-contract',
    tasks: expect.arrayContaining([
      expect.objectContaining({
        id: 'add-block',
        gate: 'resolve compose adapt verify lock explain',
        command: 'bun run demo:quickstart',
        artifactPaths: expect.arrayContaining([
          CI_ARTIFACT_FILES.graphLock,
          CI_ARTIFACT_FILES.verificationReport,
          CI_ARTIFACT_FILES.explainGraph
        ]),
        scoreFocus: expect.arrayContaining(['success-rate', 'files-touched', 'verification-status'])
      }),
      expect.objectContaining({
        id: 'repair-slot',
        gate: 'repair verify',
        command: 'bun run sec -- repair --dry-run --json --compact',
        artifactPaths: expect.arrayContaining([
          CI_ARTIFACT_FILES.repairPlan,
          CI_ARTIFACT_FILES.provenance
        ]),
        scoreFocus: expect.arrayContaining(['repairability', 'attempt-count', 'verification-status'])
      }),
      expect.objectContaining({
        id: 'override-conflict',
        gate: 'upgrade --dry-run',
        command: 'bun run sec -- upgrade <block-id> <target-version> --dry-run --json --compact',
        artifactPaths: expect.arrayContaining([
          'source/patches/override-manifest.yaml',
          CI_ARTIFACT_FILES.upgradeDiagnostics
        ]),
        scoreFocus: expect.arrayContaining(['conflict-detection', 'machine-recoverability'])
      })
    ]),
    scoreDimensions: expect.arrayContaining([
      'success-rate',
      'wall-time',
      'verification-status',
      'machine-recoverability'
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['benchmark', 'suite'], {
      text: [
        'Benchmark suite engineering-compiler-core (active)',
        'Command: bun run sec -- benchmark suite --json',
        'Runner command: bun run test:benchmark-contract',
        `Artifact paths: ${contract.artifactPathCount}`,
        `Score dimension count: ${contract.scoreDimensionCount}`,
        `Artifact path list: ${artifactPaths.join(', ')}`,
        'Task override-conflict: surface one override conflict during upgrade planning',
        `command=${overrideConflictTask.command}`,
        `artifactCount=${overrideConflictTask.artifactPathCount}; artifacts=${overrideConflictTask.artifactPaths.join(', ')}`,
        `scoreFocusCount=${overrideConflictTask.scoreFocusCount}; score=${overrideConflictTask.scoreFocus.join(', ')}`
      ],
      json: {
        suiteId: 'engineering-compiler-core',
        command: 'bun run sec -- benchmark suite --json',
        runnerCommand: 'bun run test:benchmark-contract',
        taskCount: contract.taskCount,
        artifactPathCount: contract.artifactPathCount,
        artifactPaths: expect.arrayContaining([
          CI_ARTIFACT_FILES.reviewSummary,
          CI_ARTIFACT_FILES.upgradePlan,
          CI_ARTIFACT_FILES.provenance
        ]),
        tasks: expect.arrayContaining([
          expect.objectContaining({ id: 'add-block' }),
          expect.objectContaining({ id: 'override-conflict' })
        ]),
        scoreDimensionCount: contract.scoreDimensionCount
      },
      compactJson: {
        suiteId: 'engineering-compiler-core',
        runnerCommand: 'bun run test:benchmark-contract',
        taskCount: contract.taskCount,
        artifactPathCount: contract.artifactPathCount,
        tasks: expect.arrayContaining([
          expect.objectContaining({ id: 'add-block' }),
          expect.objectContaining({ id: 'override-conflict' })
        ]),
        scoreDimensionCount: contract.scoreDimensionCount
      }
    });
  });
});

test('CLI exposes test budget as text and JSON contracts', async () => {
  const contract = await buildTestBudgetContract();
  const formatted = formatTestBudgetContract(contract);
  const fastTestFiles = getFastTestFilesSync();
  const importOrganizerSuite = getSlowTestSuitesSync().find((suite) => (
    suite.id === 'e2e-import-organizer-staged'
  ));

  expectTestBudgetSelfConsistent(contract);

  expect(isTestFile('tests/repair/repair.test.ts')).toBe(true);
  expect(isFastTestFile('tests/repair/repair.test.ts')).toBe(true);
  expect(isFastTestFile('tests/e2e/registry.test.ts')).toBe(false);
  expect(isTestFile('src/development/runner/test-runner.ts')).toBe(false);
  expect(fastTestFiles).not.toContain('project/tests/acceptance/customer-flow.test.ts');
  expect(fastTestFiles.some((file) => file.startsWith('tests/e2e/'))).toBe(false);
  expect(fastTestFiles.every((file) => file.startsWith('tests/'))).toBe(true);
  expect(importOrganizerSuite).toEqual({
    id: 'e2e-import-organizer-staged',
    owner: 'compiler-import-organizer-staged-e2e',
    timeoutMs: 120_000,
    parallelSafe: true,
    resourceClass: 'standard',
    prRiskBaseline: false,
    files: [
      'tests/e2e/import-organizer-staged.test.ts',
      'tests/e2e/import-organizer-worktree-isolation.test.ts'
    ]
  });

  expectContainsAll(formatted, [
    'Test budget default lane: fast',
    'Lane all; command=bun run sec -- verify --lane all',
    `Slow test files: ${contract.slowTestFileCount}`
  ]);
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    command: 'bun run sec -- test budget --json',
    runnerCommand: 'bun run test:budget',
    defaultLane: 'fast',
    laneCount: contract.lanes.length,
    slowLaneCount: contract.slowLaneIds.length,
    slowLaneIds: expect.arrayContaining(['all']),
    slowTestFileCount: contract.slowTestFiles.length,
    slowSuiteCount: contract.slowSuites.length,
    lanes: [
      {
        id: 'fast',
        command: 'bun run sec -- verify'
      },
      {
        id: 'runtime',
        command: 'bun run sec -- verify --lane runtime'
      },
      {
        id: 'all',
        command: 'bun run sec -- verify --lane all'
      }
    ],
    localDefault: expectedTestBudgetLocalDefault,
    fullRuntimeGate: 'affected runtime changes or explicit release/demo verification'
  });

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['test', 'budget'], {
      text: [
        'Test budget default lane: fast',
        'Command: bun run sec -- test budget --json',
        'Runner command: bun run test:budget',
        `Lanes: ${contract.laneCount}`,
        `Slow lane count: ${contract.slowLaneCount}`,
        'Slow lanes: runtime, all',
        `Slow test files: ${contract.slowTestFileCount}`,
        `Local default: ${expectedTestBudgetLocalDefault}`,
        'Lane fast; command=bun run sec -- verify'
      ],
      json: {
        command: 'bun run sec -- test budget --json',
        runnerCommand: 'bun run test:budget',
        defaultLane: 'fast',
        laneCount: contract.laneCount,
        slowLaneCount: contract.slowLaneCount,
        slowLaneIds: expect.arrayContaining(['all']),
        slowTestFileCount: contract.slowTestFileCount,
        slowTestFiles: contract.slowTestFiles,
        slowSuiteCount: contract.slowSuiteCount,
        slowSuites: contract.slowSuites,
        lanes: expect.arrayContaining([
          expect.objectContaining({ id: 'all' })
        ])
      },
      compactJson: {
        runnerCommand: 'bun run test:budget',
        defaultLane: 'fast',
        laneCount: contract.laneCount,
        slowLaneCount: contract.slowLaneCount,
        slowLaneIds: expect.arrayContaining(['all']),
        slowTestFileCount: contract.slowTestFileCount,
        slowTestFiles: contract.slowTestFiles,
        slowSuiteCount: contract.slowSuiteCount,
        slowSuites: contract.slowSuites
      }
    });
  });
});
