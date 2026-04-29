import { expect, test } from 'vitest';
import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import {
  CI_ARTIFACT_FILES
} from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../../platform/shared/test-budget-contract.ts';
import { withTempWorkspace, runCliInProcess as runCli } from '../helpers/test-utils.ts';

test('CLI exposes benchmark task-suite as text and JSON contracts', async () => {
  const contract = buildBenchmarkTaskSuiteContract();
  expect(formatBenchmarkTaskSuiteContract(contract)).toContain(
    'Benchmark suite engineering-compiler-core (active)'
  );
  expect(formatBenchmarkTaskSuiteContract(contract)).toContain(
    'Task add-block: install one capability block into a clean workspace; gate=resolve compose adapt verify lock explain'
  );
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    suiteId: 'engineering-compiler-core',
    status: 'active',
    command: 'npm run platform -- benchmark suite --json',
    runnerCommand: 'npm run test:benchmark-contract',
    taskCount: 5,
    artifactPathCount: 11,
    artifactPaths: [
      CI_ARTIFACT_FILES.acceptanceCoverage,
      CI_ARTIFACT_FILES.policyReport,
      CI_ARTIFACT_FILES.reviewSummary,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.explainGraph,
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.graphLock,
      CI_ARTIFACT_FILES.repairPlan,
      CI_ARTIFACT_FILES.upgradeDiagnostics,
      CI_ARTIFACT_FILES.upgradePlan,
      'source/patches/override-manifest.yaml'
    ],
    tasks: expect.arrayContaining([
      expect.objectContaining({
        id: 'add-block',
        gate: 'resolve compose adapt verify lock explain',
        command: 'npm run demo:quickstart',
        artifactPathCount: 4,
        artifactPaths: expect.arrayContaining([
          CI_ARTIFACT_FILES.graphLock,
          CI_ARTIFACT_FILES.verificationReport,
          CI_ARTIFACT_FILES.explainGraph
        ]),
        scoreFocusCount: 3,
        scoreFocus: ['success-rate', 'files-touched', 'verification-status']
      }),
      expect.objectContaining({
        id: 'repair-slot',
        gate: 'repair verify',
        command: 'npm run platform -- repair --dry-run --json --compact',
        artifactPathCount: 3,
        artifactPaths: expect.arrayContaining([
          CI_ARTIFACT_FILES.repairPlan,
          CI_ARTIFACT_FILES.provenance
        ]),
        scoreFocusCount: 3,
        scoreFocus: ['repairability', 'attempt-count', 'verification-status']
      }),
      expect.objectContaining({
        id: 'override-conflict',
        gate: 'upgrade --dry-run',
        command: 'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
        artifactPathCount: 3,
        artifactPaths: expect.arrayContaining([
          'source/patches/override-manifest.yaml',
          CI_ARTIFACT_FILES.upgradeDiagnostics
        ]),
        scoreFocusCount: 2,
        scoreFocus: ['conflict-detection', 'machine-recoverability']
      })
    ]),
    scoreDimensionCount: 9,
    scoreDimensions: expect.arrayContaining([
      'success-rate',
      'wall-time',
      'verification-status',
      'machine-recoverability'
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['benchmark', 'suite']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Benchmark suite engineering-compiler-core (active)');
    expect(textResult.stdout).toContain('Command: npm run platform -- benchmark suite --json');
    expect(textResult.stdout).toContain('Runner command: npm run test:benchmark-contract');
    expect(textResult.stdout).toContain('Artifact paths: 11');
    expect(textResult.stdout).toContain('Score dimension count: 9');
    expect(textResult.stdout).toContain(
      `Artifact path list: ${[
        CI_ARTIFACT_FILES.acceptanceCoverage,
        CI_ARTIFACT_FILES.policyReport,
        CI_ARTIFACT_FILES.reviewSummary,
        CI_ARTIFACT_FILES.verificationReport,
        CI_ARTIFACT_FILES.explainGraph,
        CI_ARTIFACT_FILES.provenance,
        CI_ARTIFACT_FILES.graphLock,
        CI_ARTIFACT_FILES.repairPlan,
        CI_ARTIFACT_FILES.upgradeDiagnostics,
        CI_ARTIFACT_FILES.upgradePlan,
        'source/patches/override-manifest.yaml'
      ].join(', ')}`
    );
    expect(textResult.stdout).toContain('Task override-conflict: surface one override conflict during upgrade planning');
    expect(textResult.stdout).toContain('command=npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact');
    expect(textResult.stdout).toContain(
      `artifactCount=3; artifacts=source/patches/override-manifest.yaml, ${CI_ARTIFACT_FILES.upgradeDiagnostics}, ${CI_ARTIFACT_FILES.reviewSummary}`
    );
    expect(textResult.stdout).toContain('scoreFocusCount=2; score=conflict-detection, machine-recoverability');

    const jsonResult = await runCli(workspaceRoot, ['benchmark', 'suite', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      suiteId: 'engineering-compiler-core',
      command: 'npm run platform -- benchmark suite --json',
      runnerCommand: 'npm run test:benchmark-contract',
      taskCount: 5,
      artifactPathCount: 11,
      artifactPaths: expect.arrayContaining([
        CI_ARTIFACT_FILES.reviewSummary,
        CI_ARTIFACT_FILES.upgradePlan,
        CI_ARTIFACT_FILES.provenance
      ]),
      tasks: expect.arrayContaining([
        expect.objectContaining({ id: 'add-block', artifactPathCount: 4, scoreFocusCount: 3 }),
        expect.objectContaining({ id: 'override-conflict', artifactPathCount: 3, scoreFocusCount: 2 })
      ]),
      scoreDimensionCount: 9
    });

    const compactResult = await runCli(workspaceRoot, ['benchmark', 'suite', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      suiteId: 'engineering-compiler-core',
      runnerCommand: 'npm run test:benchmark-contract',
      taskCount: 5,
      artifactPathCount: 11,
      tasks: expect.arrayContaining([
        expect.objectContaining({ id: 'add-block', artifactPathCount: 4, scoreFocusCount: 3 }),
        expect.objectContaining({ id: 'override-conflict', artifactPathCount: 3, scoreFocusCount: 2 })
      ]),
      scoreDimensionCount: 9
    });
  });
});

test('CLI exposes test budget as text and JSON contracts', async () => {
  const contract = buildTestBudgetContract();
  expect(formatTestBudgetContract(contract)).toContain('Test budget default lane: fast');
  expect(formatTestBudgetContract(contract)).toContain(
    'Lane all; nextBuild=true; playwright=true; command=npm run platform -- verify --lane all'
  );
  expect(formatTestBudgetContract(contract)).toContain('Slow test files: 22');
  expect(formatTestBudgetContract(contract)).toContain('tests/pipeline/end-to-end.test.ts');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    command: 'npm run platform -- test budget --json',
    runnerCommand: 'npm run test:budget',
    defaultLane: 'fast',
    laneCount: 3,
    slowLaneCount: 1,
    slowLaneIds: ['all'],
    slowTestFileCount: 22,
    slowTestFiles: [
      'tests/cli/artifacts.test.ts',
      'tests/cli/demo-doctor.test.ts',
      'tests/cli/explain.test.ts',
      'tests/cli/provenance.test.ts',
      'tests/cli/repair.test.ts',
      'tests/cli/upgrade.test.ts',
      'tests/cli/verification.test.ts',
      'tests/cli/workspace.test.ts',
      'tests/explain/graph.test.ts',
      'tests/override/manifest.test.ts',
      'tests/pipeline/end-to-end.test.ts',
      'tests/pipeline/lanes.test.ts',
      'tests/pipeline/local-views.test.ts',
      'tests/pipeline/runtime-host.test.ts',
      'tests/policy/policy.test.ts',
      'tests/registry/expanded-blocks.test.ts',
      'tests/registry/private-registry.test.ts',
      'tests/registry/registry.test.ts',
      'tests/review/summary.test.ts',
      'tests/upgrade/conflicts.test.ts',
      'tests/upgrade/dry-run-plan.test.ts',
      'tests/upgrade/pipeline.test.ts'
    ],
    lanes: [
      {
        id: 'fast',
        nextBuild: false,
        playwright: false,
        command: 'npm run platform -- verify'
      },
      {
        id: 'runtime',
        nextBuild: false,
        playwright: false,
        command: 'npm run platform -- verify --lane runtime'
      },
      {
        id: 'all',
        nextBuild: true,
        playwright: true,
        command: 'npm run platform -- verify --lane all'
      }
    ],
    localDefault: 'npm test / npm run check stay on fast tests; use test:all or check:full for slow runtime gates',
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['test', 'budget']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Test budget default lane: fast');
    expect(textResult.stdout).toContain('Command: npm run platform -- test budget --json');
    expect(textResult.stdout).toContain('Runner command: npm run test:budget');
    expect(textResult.stdout).toContain('Lanes: 3');
    expect(textResult.stdout).toContain('Slow lane count: 1');
    expect(textResult.stdout).toContain('Slow lanes: all');
    expect(textResult.stdout).toContain('Slow test files: 22');
    expect(textResult.stdout).toContain('tests/pipeline/end-to-end.test.ts');
    expect(textResult.stdout).toContain('Lane fast; nextBuild=false; playwright=false');

    const jsonResult = await runCli(workspaceRoot, ['test', 'budget', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      command: 'npm run platform -- test budget --json',
      runnerCommand: 'npm run test:budget',
      defaultLane: 'fast',
      laneCount: 3,
      slowLaneCount: 1,
      slowLaneIds: ['all'],
      slowTestFileCount: 22,
      slowTestFiles: expect.arrayContaining(['tests/pipeline/end-to-end.test.ts']),
      lanes: expect.arrayContaining([
        expect.objectContaining({ id: 'all', nextBuild: true, playwright: true })
      ])
    });

    const compactResult = await runCli(workspaceRoot, ['test', 'budget', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      runnerCommand: 'npm run test:budget',
      defaultLane: 'fast',
      laneCount: 3,
      slowLaneCount: 1,
      slowLaneIds: ['all'],
      slowTestFileCount: 22,
      slowTestFiles: expect.arrayContaining(['tests/pipeline/end-to-end.test.ts'])
    });
  });
});
