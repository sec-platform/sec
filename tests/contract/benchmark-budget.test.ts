import { expect, test } from 'bun:test';
import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract,
  getFastTestFilesSync,
  isFastTestFile,
  isSlowTestFile,
  isTestFile
} from '../../platform/shared/test-budget-contract.ts';
import { expectContainsAll } from '../helpers/assertion-helpers.ts';
import { expectCliVariants } from '../helpers/cli-helpers.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';
import {
  expectBenchmarkTaskSuiteSelfConsistent,
  expectTestBudgetSelfConsistent
} from '../testkit/contracts.ts';

const expectedTestBudgetLocalDefault = 'bun run check:affected runs affected fast tests and skips broad source fallback unless PJC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1; use test:slow -- --suite <id>, test:full, or check:full for slow runtime gates';

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
    formatVersion: '1',
    suiteId: 'engineering-compiler-core',
    status: 'active',
    command: 'bun run platform -- benchmark suite --json',
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
        command: 'bun run platform -- repair --dry-run --json --compact',
        artifactPaths: expect.arrayContaining([
          CI_ARTIFACT_FILES.repairPlan,
          CI_ARTIFACT_FILES.provenance
        ]),
        scoreFocus: expect.arrayContaining(['repairability', 'attempt-count', 'verification-status'])
      }),
      expect.objectContaining({
        id: 'override-conflict',
        gate: 'upgrade --dry-run',
        command: 'bun run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
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
        'Command: bun run platform -- benchmark suite --json',
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
        command: 'bun run platform -- benchmark suite --json',
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

  expectTestBudgetSelfConsistent(contract);

  expect(isTestFile('tests/repair/repair.test.ts')).toBe(true);
  expect(isFastTestFile('tests/repair/repair.test.ts')).toBe(true);
  expect(isSlowTestFile('tests/e2e/dry-run-plan.slow.test.ts')).toBe(true);
  expect(isFastTestFile('tests/e2e/dry-run-plan.slow.test.ts')).toBe(false);
  expect(isTestFile('platform/dev-runner/test-runner.ts')).toBe(false);
  expect(fastTestFiles).not.toContain('project/tests/runtime/acceptance/customer-flow.spec.ts');
  expect(fastTestFiles.every((file) => file.startsWith('tests/'))).toBe(true);

  expectContainsAll(formatted, [
    'Test budget default lane: fast',
    'Lane all; nextBuild=true; playwright=true; command=bun run platform -- verify --lane all',
    `Slow test files: ${contract.slowTestFileCount}`,
    'tests/e2e/end-to-end.slow.test.ts',
    'Slow suites:',
    'Slow suite upgrade; owner=platform/compiler/upgrade',
    'Slow suite pipeline; owner=platform/compiler/pipeline'
  ]);
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    command: 'bun run platform -- test budget --json',
    runnerCommand: 'bun run test:budget',
    defaultLane: 'fast',
    laneCount: contract.lanes.length,
    slowLaneCount: contract.slowLaneIds.length,
    slowLaneIds: expect.arrayContaining(['all']),
    slowTestFiles: expect.arrayContaining([
      'tests/e2e/artifacts.slow.test.ts',
      'tests/e2e/end-to-end.slow.test.ts',
      'tests/e2e/graph.slow.test.ts',
      'tests/e2e/policy.slow.test.ts',
      'tests/e2e/registry.slow.test.ts',
      'tests/e2e/pipeline.slow.test.ts'
    ]),
    slowSuiteCount: expect.any(Number),
    slowSuites: expect.arrayContaining([
      expect.objectContaining({
        id: 'upgrade',
        owner: 'platform/compiler/upgrade',
        timeoutMs: 120000,
        files: expect.arrayContaining(['tests/e2e/dry-run-plan.slow.test.ts'])
      }),
      expect.objectContaining({
        id: 'pipeline',
        owner: 'platform/compiler/pipeline',
        timeoutMs: 120000,
        files: expect.arrayContaining(['tests/e2e/end-to-end.slow.test.ts', 'tests/e2e/pipeline.slow.test.ts'])
      })
    ]),
    lanes: [
      {
        id: 'fast',
        nextBuild: false,
        playwright: false,
        command: 'bun run platform -- verify'
      },
      {
        id: 'runtime',
        nextBuild: false,
        playwright: false,
        command: 'bun run platform -- verify --lane runtime'
      },
      {
        id: 'all',
        nextBuild: true,
        playwright: true,
        command: 'bun run platform -- verify --lane all'
      }
    ],
    localDefault: expectedTestBudgetLocalDefault,
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
  });

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['test', 'budget'], {
      text: [
        'Test budget default lane: fast',
        'Command: bun run platform -- test budget --json',
        'Runner command: bun run test:budget',
        `Lanes: ${contract.laneCount}`,
        `Slow lane count: ${contract.slowLaneCount}`,
        'Slow lanes: all',
        `Slow test files: ${contract.slowTestFileCount}`,
        'Slow suites:',
        'Slow suite upgrade; owner=platform/compiler/upgrade',
        'Slow suite pipeline; owner=platform/compiler/pipeline',
        'tests/e2e/end-to-end.slow.test.ts',
        `Local default: ${expectedTestBudgetLocalDefault}`,
        'Lane fast; nextBuild=false; playwright=false'
      ],
      json: {
        command: 'bun run platform -- test budget --json',
        runnerCommand: 'bun run test:budget',
        defaultLane: 'fast',
        laneCount: contract.laneCount,
        slowLaneCount: contract.slowLaneCount,
        slowLaneIds: expect.arrayContaining(['all']),
        slowTestFileCount: contract.slowTestFileCount,
        slowTestFiles: expect.arrayContaining(['tests/e2e/end-to-end.slow.test.ts']),
        slowSuiteCount: expect.any(Number),
        slowSuites: expect.arrayContaining([
          expect.objectContaining({ id: 'upgrade', owner: 'platform/compiler/upgrade' }),
          expect.objectContaining({ id: 'pipeline', owner: 'platform/compiler/pipeline' })
        ]),
        lanes: expect.arrayContaining([
          expect.objectContaining({ id: 'all', nextBuild: true, playwright: true })
        ])
      },
      compactJson: {
        runnerCommand: 'bun run test:budget',
        defaultLane: 'fast',
        laneCount: contract.laneCount,
        slowLaneCount: contract.slowLaneCount,
        slowLaneIds: expect.arrayContaining(['all']),
        slowTestFileCount: contract.slowTestFileCount,
        slowTestFiles: expect.arrayContaining(['tests/e2e/end-to-end.slow.test.ts']),
        slowSuiteCount: expect.any(Number),
        slowSuites: expect.arrayContaining([
          expect.objectContaining({ id: 'upgrade' }),
          expect.objectContaining({ id: 'pipeline' })
        ])
      }
    });
  });
});
