import { expect, test } from 'bun:test';

import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_KINDS,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
  ciArtifactUploadCommand
} from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildCiContract,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
import {
  buildContractFreezeContract,
  buildContractFreezeRunnerInvocations,
  formatContractFreezeContract
} from '../../platform/shared/contract-freeze-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../platform/shared/error-protocol-contract.ts';
import { slowTestSuiteIds } from '../../platform/shared/test-budget-contract.ts';
import { expectCliVariants } from '../helpers/cli-helpers.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

const expectedCiArtifactPaths = [
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_FILES.acceptanceCoverage,
  CI_ARTIFACT_FILES.reviewSummary,
  CI_ARTIFACT_FILES.runtimeReport,
  CI_ARTIFACT_FILES.verificationReport,
  ...[...CI_EXPLAIN_GRAPH_ARTIFACT_PATHS].sort()
];

const expectedContractFreezeTargetFiles = [
  'tests/contract/benchmark-budget.test.ts',
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/contracts.test.ts',
  'tests/contract/environment.test.ts',
  'tests/contract/reference.test.ts',
  'tests/contract/usage.test.ts',
  'tests/integration/project-runtime.test.ts',
  'tests/integration/review.test.ts'
];

test('CLI exposes contract freeze target list as text and JSON contracts', async () => {
  const contract = buildContractFreezeContract();
  const formatted = formatContractFreezeContract(contract);

  expect(contract.targetFileCount).toBe(expectedContractFreezeTargetFiles.length);
  expect(contract.targetCount).toBe(expectedContractFreezeTargetFiles.length);
  expect(contract.targetFiles).toEqual(expectedContractFreezeTargetFiles);
  expect(new Set(contract.targetFiles).size).toBe(contract.targetFiles.length);
  expect(contract.targetFiles.every((file) => file.endsWith('.test.ts'))).toBe(true);
  expect(contract.targetFiles.some((file) => file.startsWith('tests/e2e/'))).toBe(false);
  expect(contract.targets.every((target) => target.testNamePattern)).toBe(true);
  expect(contract.targets.map((target) => target.file).sort((left, right) => left.localeCompare(right))).toEqual(expectedContractFreezeTargetFiles);

  expect(formatted).toContain('Contract freeze active');
  expect(formatted).toContain('Command: bun run platform -- contract freeze --json');
  expect(formatted).toContain(`Target files: ${expectedContractFreezeTargetFiles.length}`);
  expect(formatted).toContain('Target tests/contract/contracts.test.ts; command=bun test tests/contract/contracts.test.ts --test-name-pattern');
  expect(formatted).toContain('Target tests/contract/ci-lanes.test.ts; command=bun test tests/contract/ci-lanes.test.ts --test-name-pattern');

  const runnerInvocations = buildContractFreezeRunnerInvocations(contract.targets);
  expect(runnerInvocations).toHaveLength(1);
  const runnerInvocation = runnerInvocations[0];
  expect(runnerInvocation).toBeDefined();
  if (!runnerInvocation) throw new Error('Missing contract-freeze runner invocation');
  expect(runnerInvocation.files).toHaveLength(expectedContractFreezeTargetFiles.length);
  expect(runnerInvocation.files).toEqual(expectedContractFreezeTargetFiles);
  expect(runnerInvocation.testNamePattern).toBeDefined();
  const runnerPattern = runnerInvocation.testNamePattern;
  if (!runnerPattern) throw new Error('Missing contract-freeze runner pattern');
  expect(runnerInvocation.args).toEqual([
    'test',
    ...expectedContractFreezeTargetFiles,
    '--test-name-pattern',
    runnerPattern
  ]);
  expect(runnerPattern).toContain('CLI exposes contract freeze target list as text and JSON contracts');
  expect(runnerPattern).toContain('CI contract separates PR fast lane commands from full lane commands');
  expect(runnerPattern).toContain('contract freeze contract documents runner wiring');
  expect(runnerPattern).not.toContain('v0.1 pipeline runs end to end in a temporary workspace');
  expect(JSON.stringify(contract)).not.toContain('\n');

  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'bun run platform -- contract freeze --json',
    runnerCommand: 'bun run test:contract-freeze',
    targetFileCount: expectedContractFreezeTargetFiles.length,
    targetFiles: expectedContractFreezeTargetFiles,
    targetCount: expectedContractFreezeTargetFiles.length,
    targets: expect.arrayContaining([
      expect.objectContaining({
        file: 'tests/contract/contracts.test.ts',
        command: expect.stringContaining('bun test tests/contract/contracts.test.ts --test-name-pattern'),
        testNamePattern: expect.stringContaining('CLI exposes contract freeze target list as text and JSON contracts')
      }),
      expect.objectContaining({
        file: 'tests/contract/ci-lanes.test.ts',
        command: expect.stringContaining('bun test tests/contract/ci-lanes.test.ts --test-name-pattern'),
        testNamePattern: expect.stringContaining('CI contract separates PR fast lane commands from full lane commands')
      }),
      expect.objectContaining({
        file: 'tests/integration/project-runtime.test.ts',
        command: expect.stringContaining('bun test tests/integration/project-runtime.test.ts --test-name-pattern'),
        testNamePattern: expect.stringContaining('test budget contract documents lanes and their capabilities')
      }),
      expect.objectContaining({
        file: 'tests/integration/review.test.ts',
        command: 'bun test tests/integration/review.test.ts --test-name-pattern "CLI exposes review summary as text and JSON contracts"',
        testNamePattern: 'CLI exposes review summary as text and JSON contracts'
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'freeze'], {
      text: [
        'Contract freeze active',
        'Command: bun run platform -- contract freeze --json',
        'Runner command: bun run test:contract-freeze',
        `Target files: ${expectedContractFreezeTargetFiles.length}`,
        `Target file list: ${expectedContractFreezeTargetFiles.join(', ')}`,
        'Target tests/contract/contracts.test.ts; command=bun test tests/contract/contracts.test.ts --test-name-pattern',
        'Target tests/contract/ci-lanes.test.ts; command=bun test tests/contract/ci-lanes.test.ts --test-name-pattern'
      ],
      json: {
        status: 'active',
        command: 'bun run platform -- contract freeze --json',
        runnerCommand: 'bun run test:contract-freeze',
        targetFileCount: expectedContractFreezeTargetFiles.length,
        targetFiles: expectedContractFreezeTargetFiles,
        targetCount: expectedContractFreezeTargetFiles.length
      },
      compactJson: {
        status: 'active',
        runnerCommand: 'bun run test:contract-freeze',
        targetFileCount: expectedContractFreezeTargetFiles.length,
        targetCount: expectedContractFreezeTargetFiles.length
      }
    });
  });
});

test('CLI exposes CI command contract as text and JSON contracts', async () => {
  const contract = buildCiContract();
  const formatted = formatCiContract(contract);
  const artifactUploadCommands = CI_ARTIFACT_KINDS.map(ciArtifactUploadCommand);
  const slowSuiteCommands = slowTestSuiteIds().map((suiteId) => `bun run test:slow -- --suite ${suiteId}`);
  const stepsById = new Map(contract.steps.map((step) => [step.id, step]));
  const defaultGate = stepsById.get(contract.defaultGate);
  const fullRuntimeGate = stepsById.get(contract.fullRuntimeGate);

  if (!defaultGate) throw new Error(`Missing CI default gate ${contract.defaultGate}`);
  if (!fullRuntimeGate) throw new Error(`Missing CI full runtime gate ${contract.fullRuntimeGate}`);

  expect(formatted).toContain('CI contract active');
  expect(formatted).toContain(`Command: ${contract.command}`);
  expect(formatted).toContain(`Default gate: ${contract.defaultGate}`);
  expect(formatted).toContain(`Full runtime gate: ${contract.fullRuntimeGate}`);
  expect(formatted).toContain(
    `Step ${contract.defaultGate}; phase=verify; command=${defaultGate.command}; producesCount=${defaultGate.producesCount}`
  );
  expect(JSON.stringify(contract)).not.toContain('\n');

  expect(contract.formatVersion).toBe('1');
  expect(contract.status).toBe('active');
  expect(contract.command).toBe('bun run platform -- contract ci --json');
  expect(contract.defaultGate).toBe('pr-fast-verify');
  expect(contract.fullRuntimeGate).toBe('full-runtime-verify');

  expect(contract.prFastLaneCommandCount).toBe(contract.prFastLaneCommands.length);
  expect(contract.prFullLaneCommandCount).toBe(contract.prFullLaneCommands.length);
  expect(contract.fullLaneCommandCount).toBe(contract.fullLaneCommands.length);
  expect(contract.verifyCommandCount).toBe(contract.verifyCommands.length);
  expect(contract.qualityCommandCount).toBe(contract.qualityCommands.length);
  expect(contract.diagnosticCommandCount).toBe(contract.diagnosticCommands.length);
  expect(contract.artifactUploadCommandCount).toBe(contract.artifactUploadCommands.length);
  expect(contract.artifactPathCount).toBe(contract.artifactPaths.length);
  expect(contract.stepCount).toBe(contract.steps.length);
  for (const step of contract.steps) {
    expect(step.producesCount).toBe(step.produces.length);
  }

  expect(contract.verifyCommands).toEqual(
    contract.steps.filter((step) => step.phase === 'verify').map((step) => step.command)
  );
  expect(contract.qualityCommands).toEqual(
    contract.steps.filter((step) => step.phase === 'quality').map((step) => step.command)
  );
  expect(contract.diagnosticCommands).toEqual(
    contract.steps.filter((step) => step.phase === 'diagnostics').map((step) => step.command)
  );
  expect(contract.artifactUploadCommands).toEqual(artifactUploadCommands);
  expect(contract.artifactPaths).toEqual(expectedCiArtifactPaths);

  expect(contract.prFastLaneCommands).toContain('bun scripts/ci-pr-gate.ts');
  expect(contract.prFastLaneCommands).toContain('bun run imports:organize');
  expect(contract.prFastLaneCommands.some((command) => command.startsWith('bun run test:slow'))).toBe(false);
  expect(contract.prFullLaneCommands).toContain('bun scripts/ci-full-gate.ts');
  expect(contract.prFullLaneCommands.some((command) => command.startsWith('bun run test:slow'))).toBe(false);
  expect(contract.fullLaneCommands).toEqual(expect.arrayContaining([
    'bun run typecheck',
    'bun run test:contract-freeze',
    'bun run platform -- verify --lane all --json --compact',
    'bun run platform -- reference check --json --compact',
    ...slowSuiteCommands
  ]));

  expect(defaultGate).toMatchObject({
    phase: 'verify',
    command: 'bun run platform -- verify --json --compact',
    produces: [CI_ARTIFACT_FILES.verificationReport]
  });
  expect(fullRuntimeGate).toMatchObject({
    phase: 'verify',
    command: 'bun run platform -- verify --lane all --json --compact',
    produces: expect.arrayContaining([
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.runtimeReport,
      CI_ARTIFACT_FILES.acceptanceCoverage
    ])
  });
  for (const suiteId of slowTestSuiteIds()) {
    expect(stepsById.get(`slow-e2e-${suiteId}`)).toMatchObject({
      phase: 'quality',
      command: `bun run test:slow -- --suite ${suiteId}`,
      produces: []
    });
  }
  for (const kind of CI_ARTIFACT_KINDS) {
    expect(stepsById.get(`${kind}-artifacts`)).toMatchObject({
      phase: 'artifacts',
      command: ciArtifactUploadCommand(kind),
      produces: [CI_ARTIFACT_MANIFEST_PATH]
    });
  }

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'ci'], {
      text: [
        'CI contract active',
        `Command: ${contract.command}`,
        `Default gate: ${contract.defaultGate}`,
        `Full runtime gate: ${contract.fullRuntimeGate}`,
        `Verify command count: ${contract.verifyCommands.length}`,
        `Quality command count: ${contract.qualityCommands.length}`,
        `Diagnostic command count: ${contract.diagnosticCommands.length}`,
        `Artifact upload command count: ${artifactUploadCommands.length}`,
        `Artifact uploads: ${artifactUploadCommands.join(', ')}`,
        `Artifact paths: ${expectedCiArtifactPaths.length}`,
        `Artifact path list: ${expectedCiArtifactPaths.join(', ')}`,
        `Steps: ${contract.steps.length}`,
        `Step ${contract.defaultGate}; phase=verify; command=${defaultGate.command}; producesCount=${defaultGate.producesCount}`,
        `Step ${contract.fullRuntimeGate}; phase=verify; command=${fullRuntimeGate.command}; producesCount=${fullRuntimeGate.producesCount}`,
        'Step contract-freeze; phase=quality; command=bun run test:contract-freeze',
        'Step reference-drift; phase=quality; command=bun run platform -- reference check --json --compact',
        'Step diagnostic-review-matrix; phase=diagnostics; command=bun run platform -- review matrix --json --compact',
        'Step contract-artifacts; phase=artifacts; command=bun run platform -- artifacts --paths --json --compact --kind contract'
      ],
      json: {
        status: 'active',
        command: contract.command,
        defaultGate: contract.defaultGate,
        fullRuntimeGate: contract.fullRuntimeGate,
        verifyCommandCount: contract.verifyCommands.length,
        verifyCommands: contract.verifyCommands,
        qualityCommandCount: contract.qualityCommands.length,
        qualityCommands: expect.arrayContaining([
          'bun run typecheck',
          'bun run test:contract-freeze',
          'bun run platform -- reference check --json --compact',
          ...slowSuiteCommands
        ]),
        diagnosticCommandCount: contract.diagnosticCommands.length,
        diagnosticCommands: contract.diagnosticCommands,
        artifactUploadCommandCount: artifactUploadCommands.length,
        artifactUploadCommands,
        artifactPathCount: expectedCiArtifactPaths.length,
        artifactPaths: expectedCiArtifactPaths,
        stepCount: contract.steps.length
      }
    });
  });
});

test('GitHub compiler CI workflow covers CI command contract gates', async () => {
  const workflow = await readCompilerFile('.github/workflows/compiler-ci.yml');
  const contract = buildCiContract();

  const missingPrFastLaneCommands = contract.prFastLaneCommands.filter(
    (command) => !workflow.includes(command)
  );

  const missingFullLaneCommands = contract.fullLaneCommands.filter(
    (command) => !workflow.includes(command)
  );

  expect(missingPrFastLaneCommands).toEqual([]);
  expect(missingFullLaneCommands).toEqual([]);

  expect(workflow).not.toContain('# bun run platform -- verify --json --compact');
  expect(workflow).not.toContain('# bun run imports:check');
});

test('CLI exposes error protocol as text and JSON contracts', async () => {
  const contract = buildErrorProtocolContract();
  const formatted = formatErrorProtocolContract(contract);
  expect(formatted).toContain('Error protocol active');
  expect(formatted).toContain('Example upgrade-conflict-error; code=UPGRADE-CONFLICT-001');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'bun run platform -- contract errors --json',
    exampleCount: 13,
    issueTypeCount: 5,
    issueTypes: ['composition', 'kernel', 'slot', 'spec', 'usage'],
    artifactPathCount: 7,
    artifactPaths: [
      CI_ARTIFACT_FILES.reviewSummary,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.repairPlan,
      CI_ARTIFACT_FILES.upgradeDiagnostics,
      CI_ARTIFACT_FILES.upgradePlan,
      CI_ARTIFACT_FILES.viewMutationReport,
      'source/views/mutations'
    ],
    examples: expect.arrayContaining([
      expect.objectContaining({
        id: 'usage-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'usage',
          suggestedActions: ['retry-with-supported-arguments']
        })
      }),
      expect.objectContaining({
        id: 'verify-blocked-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'run-platform-adapt', 'retry-platform-verify']
        })
      }),
      expect.objectContaining({
        id: 'verify-acceptance-error',
        output: expect.objectContaining({
          recoverable: false,
          issueType: 'spec',
          suggestedActions: ['inspect-verification-report', 'run-platform-explain'],
          artifactPaths: [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.reviewSummary]
        })
      }),
      expect.objectContaining({
        id: 'repair-preflight-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['run-platform-verify', 'retry-platform-repair-dry-run']
        })
      }),
      expect.objectContaining({
        id: 'repair-plan-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'slot',
          suggestedActions: ['inspect-repair-plan', 'run-platform-repair-dry-run'],
          artifactPaths: [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.reviewSummary]
        })
      }),
      expect.objectContaining({
        id: 'upgrade-noop-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['choose-different-upgrade-target']
        })
      }),
      expect.objectContaining({
        id: 'upgrade-blocked-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['choose-compatible-upgrade-target', 'run-platform-upgrade-dry-run']
        })
      }),
      expect.objectContaining({
        id: 'upgrade-migration-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['inspect-upgrade-diagnostics', 'fix-upgrade-migration'],
          artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan]
        })
      }),
      expect.objectContaining({
        id: 'upgrade-rollback-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['inspect-upgrade-diagnostics', 'fix-upgrade-migration'],
          artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan],
          details: {
            migrationId: 'mig-customer-normalizer-contract',
            migrationKind: 'slot-contract-update',
            target: 'custom/customer_normalizer.ts',
            rollbackStatus: 'restored'
          }
        })
      }),
      expect.objectContaining({
        id: 'upgrade-conflict-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['run-platform-upgrade-dry-run', 'inspect-upgrade-diagnostics'],
          artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan]
        })
      }),
      expect.objectContaining({
        id: 'workbench-mutation-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'spec',
          suggestedActions: ['inspect-workbench-mutations', 'run-platform-workbench-mutations-apply'],
          artifactPaths: ['source/views/mutations', CI_ARTIFACT_FILES.viewMutationReport]
        })
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'errors'], {
      text: [
        'Error protocol active',
        'Issue type count: 5',
        'Artifact paths: 7',
        `Artifact path list: ${[
          CI_ARTIFACT_FILES.reviewSummary,
          CI_ARTIFACT_FILES.verificationReport,
          CI_ARTIFACT_FILES.repairPlan,
          CI_ARTIFACT_FILES.upgradeDiagnostics,
          CI_ARTIFACT_FILES.upgradePlan,
          CI_ARTIFACT_FILES.viewMutationReport,
          'source/views/mutations'
        ].join(', ')}`,
        'Example repair-plan-error; code=REPAIR-BLOCKED-001',
        'Example upgrade-rollback-error; code=UPGRADE-MIGRATION-016',
        'Example workbench-mutation-error; code=WORKBENCH-MUTATION-002'
      ],
      json: {
        status: 'active',
        exampleCount: 13,
        issueTypeCount: 5,
        suggestedActionCount: 20,
        artifactPathCount: 7
      },
      compactJson: {
        status: 'active',
        exampleCount: 13,
        issueTypeCount: 5,
        artifactPathCount: 7
      }
    });
  });
});
