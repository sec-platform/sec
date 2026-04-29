import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import {
  buildCiContract,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../../platform/shared/contract-freeze-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../platform/shared/error-protocol-contract.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../../platform/shared/test-budget-contract.ts';
import {
  ACCEPTANCE_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  REPAIR_USAGE,
  RUNTIME_USAGE,
  USAGE
} from '../../platform/cli/usage.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../../platform/shared/reference-check.ts';
import type {
  ExplainGraph,
  RepairPlan,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { withTempWorkspace, runCliInProcess as runCli } from '../helpers/test-utils.ts';

function usageErrorStderr(usage: string): string {
  return [
    `UNEXPECTED ${usage}`,
    JSON.stringify({
      code: 'UNEXPECTED',
      message: usage,
      recoverable: true,
      issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments'],
      artifactPaths: []
    }),
    ''
  ].join('\n');
}

async function expectRepairUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['repair', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(REPAIR_USAGE)
  });
}

async function expectLockUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['lock', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(LOCK_USAGE)
  });
}

async function expectPolicyUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['policy', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(POLICY_USAGE)
  });
}

async function expectAcceptanceUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['acceptance', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(ACCEPTANCE_USAGE)
  });
}

async function expectPostgresUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['postgres', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(POSTGRES_USAGE)
  });
}

async function installPrivateBannerBlock(workspaceRoot: string): Promise<void> {
  const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockRoot = path.join(privateRegistryRoot, 'private.banner-basic');

  await fs.mkdir(path.join(blockRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
  await fs.mkdir(path.join(blockRoot, 'files', 'tests', 'unit'), { recursive: true });

  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), {
    id: 'private/banner-basic',
    version: '0.1.0',
    kind: 'governance',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    compatibility: {
      blockApi: '1',
      compilerApi: '1',
      stackProfiles: ['nextjs-ts-prisma-sqlite']
    },
    requires: [],
    provides: ['governance/banner'],
    conflicts: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/src/installed/private/banner.ts',
        to: 'src/installed/private/banner.ts'
      },
      {
        kind: 'copy',
        from: 'files/tests/unit/private-banner.test.ts',
        to: 'tests/unit/private-banner.test.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: [
        {
          id: 'banner_message',
          type: 'string',
          required: true
        }
      ]
    },
    slots: [],
    acceptance: [],
    routes: []
  });

  await fs.writeFile(
    path.join(blockRoot, 'files', 'src', 'installed', 'private', 'banner.ts'),
    `export function projectBanner(projectName: string): string {\n  return \`private-banner:\${projectName}\`;\n}\n`,
    'utf8'
  );

  await fs.writeFile(
    path.join(blockRoot, 'files', 'tests', 'unit', 'private-banner.test.ts'),
    `import assert from 'node:assert/strict';\nimport { projectBanner } from '../../src/installed/private/banner.ts';\n\nexport async function runSuite() {\n  assert.equal(projectBanner('customer-admin'), 'private-banner:customer-admin');\n}\n`,
    'utf8'
  );
}

test('CLI exposes contract freeze target list as text and JSON contracts', async () => {
  const contract = buildContractFreezeContract();
  expect(formatContractFreezeContract(contract)).toContain('Contract freeze active');
  expect(formatContractFreezeContract(contract)).toContain('Target tests/cli/contracts.test.ts; command=bunx vitest run tests/cli/contracts.test.ts --testNamePattern');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract freeze --json',
    runnerCommand: 'npm run test:contract-freeze',
    targetFileCount: 15,
    targetFiles: [
      'tests/cli/artifacts.test.ts',
      'tests/cli/benchmark-budget.test.ts',
      'tests/cli/contracts.test.ts',
      'tests/cli/demo-doctor.test.ts',
      'tests/cli/environment.test.ts',
      'tests/cli/explain.test.ts',
      'tests/cli/provenance.test.ts',
      'tests/cli/reference.test.ts',
      'tests/cli/repair.test.ts',
      'tests/cli/review.test.ts',
      'tests/cli/upgrade.test.ts',
      'tests/cli/usage.test.ts',
      'tests/cli/verification.test.ts',
      'tests/pipeline/end-to-end.test.ts',
      'tests/runtime/project-runtime.test.ts'
    ],
    targetCount: 15,
    targets: expect.arrayContaining([
      expect.objectContaining({
        file: 'tests/cli/contracts.test.ts',
        command: expect.stringContaining('bunx vitest run tests/cli/contracts.test.ts --testNamePattern'),
        testNamePattern: expect.stringContaining('CLI exposes contract freeze target list as text and JSON contracts')
      }),
      expect.objectContaining({
        file: 'tests/runtime/project-runtime.test.ts',
        command: expect.stringContaining('bunx vitest run tests/runtime/project-runtime.test.ts --testNamePattern'),
        testNamePattern: expect.stringContaining('test budget contract documents lanes and their capabilities')
      }),
      expect.objectContaining({
        file: 'tests/pipeline/end-to-end.test.ts',
        command: 'bunx vitest run tests/pipeline/end-to-end.test.ts --testNamePattern "v0.1 pipeline runs end to end in a temporary workspace"',
        testNamePattern: 'v0.1 pipeline runs end to end in a temporary workspace'
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['contract', 'freeze']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Contract freeze active');
    expect(textResult.stdout).toContain('Command: npm run platform -- contract freeze --json');
    expect(textResult.stdout).toContain('Runner command: npm run test:contract-freeze');
    expect(textResult.stdout).toContain('Target files: 15');
    expect(textResult.stdout).toContain('Target file list: tests/cli/artifacts.test.ts, tests/cli/benchmark-budget.test.ts, tests/cli/contracts.test.ts');
    expect(textResult.stdout).toContain('tests/pipeline/end-to-end.test.ts, tests/runtime/project-runtime.test.ts');
    expect(textResult.stdout).toContain('Target tests/pipeline/end-to-end.test.ts; command=bunx vitest run tests/pipeline/end-to-end.test.ts --testNamePattern');

    const jsonResult = await runCli(workspaceRoot, ['contract', 'freeze', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      status: 'active',
      command: 'npm run platform -- contract freeze --json',
      runnerCommand: 'npm run test:contract-freeze',
      targetFileCount: 15,
      targetFiles: [
        'tests/cli/artifacts.test.ts',
        'tests/cli/benchmark-budget.test.ts',
        'tests/cli/contracts.test.ts',
        'tests/cli/demo-doctor.test.ts',
        'tests/cli/environment.test.ts',
        'tests/cli/explain.test.ts',
        'tests/cli/provenance.test.ts',
        'tests/cli/reference.test.ts',
        'tests/cli/repair.test.ts',
        'tests/cli/review.test.ts',
        'tests/cli/upgrade.test.ts',
        'tests/cli/usage.test.ts',
        'tests/cli/verification.test.ts',
        'tests/pipeline/end-to-end.test.ts',
        'tests/runtime/project-runtime.test.ts'
      ],
      targetCount: 15
    });

    const compactResult = await runCli(workspaceRoot, ['contract', 'freeze', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'active',
      runnerCommand: 'npm run test:contract-freeze',
      targetFileCount: 15,
      targetCount: 15
    });
  });
});

test('CLI exposes CI command contract as text and JSON contracts', async () => {
  const contract = buildCiContract();
  expect(formatCiContract(contract)).toContain('CI contract active');
  expect(formatCiContract(contract)).toContain('Step pr-fast-verify; phase=verify; command=npm run platform -- verify --json --compact; producesCount=1');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract ci --json',
    defaultGate: 'pr-fast-verify',
    fullRuntimeGate: 'full-runtime-verify',
    verifyCommandCount: 2,
    verifyCommands: [
      'npm run platform -- verify --json --compact',
      'npm run platform -- verify --lane all --json --compact'
    ],
    qualityCommandCount: 5,
    qualityCommands: [
      'npm run typecheck',
      'npm run platform -- test budget --json --compact',
      'npm run test:contract-freeze',
      'npm run platform -- benchmark suite --json --compact',
      'npm run platform -- reference check --json --compact'
    ],
    diagnosticCommandCount: 5,
    diagnosticCommands: [
      'npm run platform -- review summary --json --compact',
      'npm run platform -- review matrix --json --compact',
      'npm run platform -- review diagnostics --json --compact',
      'npm run platform -- explain --json --compact',
      'npm run platform -- demo checklist --json --compact'
    ],
    artifactUploadCommandCount: 4,
    artifactUploadCommands: [
      'npm run platform -- artifacts --paths --json --compact --kind governance',
      'npm run platform -- artifacts --paths --json --compact --kind view',
      'npm run platform -- artifacts --paths --json --compact --kind test',
      'npm run platform -- artifacts --paths --json --compact --kind contract'
    ],
    artifactPathCount: 6,
    artifactPaths: [
      'control/ci/artifacts.json',
      'control/evidence/acceptance-coverage.json',
      'control/evidence/review-summary.json',
      'control/evidence/runtime-report.json',
      'control/evidence/verification-report.json',
      'control/graph/explain-graph.json'
    ],
    stepCount: 16,
    steps: expect.arrayContaining([
      expect.objectContaining({
        id: 'pr-fast-verify',
        phase: 'verify',
        command: 'npm run platform -- verify --json --compact',
        producesCount: 1,
        produces: ['control/evidence/verification-report.json']
      }),
      expect.objectContaining({
        id: 'full-runtime-verify',
        phase: 'verify',
        command: 'npm run platform -- verify --lane all --json --compact',
        producesCount: 3,
        produces: expect.arrayContaining([
          'control/evidence/runtime-report.json',
          'control/evidence/acceptance-coverage.json'
        ])
      }),
      expect.objectContaining({
        id: 'typecheck',
        phase: 'quality',
        command: 'npm run typecheck',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'slow-test-budget',
        phase: 'quality',
        command: 'npm run platform -- test budget --json --compact',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'contract-freeze',
        phase: 'quality',
        command: 'npm run test:contract-freeze',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'benchmark-task-suite',
        phase: 'quality',
        command: 'npm run platform -- benchmark suite --json --compact',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'reference-drift',
        phase: 'quality',
        command: 'npm run platform -- reference check --json --compact',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'diagnostic-review-matrix',
        phase: 'diagnostics',
        command: 'npm run platform -- review matrix --json --compact',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'diagnostic-demo-checklist',
        phase: 'diagnostics',
        command: 'npm run platform -- demo checklist --json --compact',
        producesCount: 0,
        produces: []
      }),
      expect.objectContaining({
        id: 'governance-artifacts',
        phase: 'artifacts',
        command: 'npm run platform -- artifacts --paths --json --compact --kind governance'
      }),
      expect.objectContaining({
        id: 'contract-artifacts',
        phase: 'artifacts',
        command: 'npm run platform -- artifacts --paths --json --compact --kind contract'
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['contract', 'ci']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('CI contract active');
    expect(textResult.stdout).toContain('Verify command count: 2');
    expect(textResult.stdout).toContain(
      'Verify commands: npm run platform -- verify --json --compact, npm run platform -- verify --lane all --json --compact'
    );
    expect(textResult.stdout).toContain('Quality command count: 5');
    expect(textResult.stdout).toContain(
      'Quality commands: npm run typecheck, npm run platform -- test budget --json --compact, npm run test:contract-freeze, npm run platform -- benchmark suite --json --compact, npm run platform -- reference check --json --compact'
    );
    expect(textResult.stdout).toContain('Diagnostic command count: 5');
    expect(textResult.stdout).toContain(
      'Diagnostic commands: npm run platform -- review summary --json --compact, npm run platform -- review matrix --json --compact, npm run platform -- review diagnostics --json --compact, npm run platform -- explain --json --compact, npm run platform -- demo checklist --json --compact'
    );
    expect(textResult.stdout).toContain('Artifact upload command count: 4');
    expect(textResult.stdout).toContain(
      'Artifact uploads: npm run platform -- artifacts --paths --json --compact --kind governance, npm run platform -- artifacts --paths --json --compact --kind view, npm run platform -- artifacts --paths --json --compact --kind test, npm run platform -- artifacts --paths --json --compact --kind contract'
    );
    expect(textResult.stdout).toContain('Artifact paths: 6');
    expect(textResult.stdout).toContain(
      'Artifact path list: control/ci/artifacts.json, control/evidence/acceptance-coverage.json, control/evidence/review-summary.json, control/evidence/runtime-report.json, control/evidence/verification-report.json, control/graph/explain-graph.json'
    );
    expect(textResult.stdout).toContain('Step full-runtime-verify; phase=verify; command=npm run platform -- verify --lane all --json --compact; producesCount=3');
    expect(textResult.stdout).toContain('Step typecheck; phase=quality; command=npm run typecheck; producesCount=0');
    expect(textResult.stdout).toContain('Step slow-test-budget; phase=quality; command=npm run platform -- test budget --json --compact');
    expect(textResult.stdout).toContain('Step contract-freeze; phase=quality; command=npm run test:contract-freeze');
    expect(textResult.stdout).toContain('Step benchmark-task-suite; phase=quality; command=npm run platform -- benchmark suite --json --compact');
    expect(textResult.stdout).toContain('Step reference-drift; phase=quality; command=npm run platform -- reference check --json --compact');
    expect(textResult.stdout).toContain('Step diagnostic-review-matrix; phase=diagnostics; command=npm run platform -- review matrix --json --compact; producesCount=0');
    expect(textResult.stdout).toContain('Step diagnostic-review-diagnostics; phase=diagnostics; command=npm run platform -- review diagnostics --json --compact; producesCount=0');
    expect(textResult.stdout).toContain('Step diagnostic-demo-checklist; phase=diagnostics; command=npm run platform -- demo checklist --json --compact; producesCount=0');
    expect(textResult.stdout).toContain('Step contract-artifacts; phase=artifacts; command=npm run platform -- artifacts --paths --json --compact --kind contract');

    const jsonResult = await runCli(workspaceRoot, ['contract', 'ci', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      status: 'active',
      defaultGate: 'pr-fast-verify',
      verifyCommandCount: 2,
      verifyCommands: [
        'npm run platform -- verify --json --compact',
        'npm run platform -- verify --lane all --json --compact'
      ],
      qualityCommandCount: 5,
      qualityCommands: [
        'npm run typecheck',
        'npm run platform -- test budget --json --compact',
        'npm run test:contract-freeze',
        'npm run platform -- benchmark suite --json --compact',
        'npm run platform -- reference check --json --compact'
      ],
      diagnosticCommandCount: 5,
      diagnosticCommands: [
        'npm run platform -- review summary --json --compact',
        'npm run platform -- review matrix --json --compact',
        'npm run platform -- review diagnostics --json --compact',
        'npm run platform -- explain --json --compact',
        'npm run platform -- demo checklist --json --compact'
      ],
      artifactUploadCommandCount: 4,
      artifactPathCount: 6,
      artifactPaths: expect.arrayContaining([
        'control/ci/artifacts.json',
        'control/evidence/verification-report.json'
      ]),
      stepCount: 16,
      steps: expect.arrayContaining([
        expect.objectContaining({ id: 'full-runtime-verify', producesCount: 3 }),
        expect.objectContaining({ id: 'typecheck', producesCount: 0 }),
        expect.objectContaining({ id: 'diagnostic-review-matrix', producesCount: 0 }),
        expect.objectContaining({ id: 'diagnostic-review-diagnostics', producesCount: 0 }),
        expect.objectContaining({ id: 'diagnostic-demo-checklist', producesCount: 0 })
      ])
    });

    const compactResult = await runCli(workspaceRoot, ['contract', 'ci', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'active',
      fullRuntimeGate: 'full-runtime-verify',
      verifyCommandCount: 2,
      verifyCommands: [
        'npm run platform -- verify --json --compact',
        'npm run platform -- verify --lane all --json --compact'
      ],
      qualityCommandCount: 5,
      qualityCommands: [
        'npm run typecheck',
        'npm run platform -- test budget --json --compact',
        'npm run test:contract-freeze',
        'npm run platform -- benchmark suite --json --compact',
        'npm run platform -- reference check --json --compact'
      ],
      diagnosticCommandCount: 5,
      diagnosticCommands: [
        'npm run platform -- review summary --json --compact',
        'npm run platform -- review matrix --json --compact',
        'npm run platform -- review diagnostics --json --compact',
        'npm run platform -- explain --json --compact',
        'npm run platform -- demo checklist --json --compact'
      ],
      artifactUploadCommandCount: 4,
      artifactPathCount: 6,
      steps: expect.arrayContaining([
        expect.objectContaining({ id: 'full-runtime-verify', producesCount: 3 }),
        expect.objectContaining({ id: 'typecheck', producesCount: 0 }),
        expect.objectContaining({ id: 'diagnostic-review-matrix', producesCount: 0 }),
        expect.objectContaining({ id: 'diagnostic-review-diagnostics', producesCount: 0 }),
        expect.objectContaining({ id: 'diagnostic-demo-checklist', producesCount: 0 })
      ])
    });
  });
});

test('CLI exposes error protocol as text and JSON contracts', async () => {
  const contract = buildErrorProtocolContract();
  expect(formatErrorProtocolContract(contract)).toContain('Error protocol active');
  expect(formatErrorProtocolContract(contract)).toContain('Example upgrade-conflict-error; code=UPGRADE-CONFLICT-001');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract errors --json',
    exampleCount: 13,
    issueTypeCount: 5,
    issueTypes: ['composition', 'kernel', 'slot', 'spec', 'usage'],
    artifactPathCount: 7,
    artifactPaths: [
      'control/evidence/review-summary.json',
      'control/evidence/verification-report.json',
      'control/workflow/repair-plan.json',
      'control/workflow/upgrade-diagnostics.json',
      'control/workflow/upgrade-plan.json',
      'control/workflow/view-mutation-report.json',
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
          artifactPaths: ['control/evidence/verification-report.json', 'control/evidence/review-summary.json']
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
          artifactPaths: ['control/workflow/repair-plan.json', 'control/evidence/review-summary.json']
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
          artifactPaths: ['control/workflow/upgrade-diagnostics.json', 'control/workflow/upgrade-plan.json']
        })
      }),
      expect.objectContaining({
        id: 'upgrade-rollback-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['inspect-upgrade-diagnostics', 'fix-upgrade-migration'],
          artifactPaths: ['control/workflow/upgrade-diagnostics.json', 'control/workflow/upgrade-plan.json'],
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
          artifactPaths: ['control/workflow/upgrade-diagnostics.json', 'control/workflow/upgrade-plan.json']
        })
      }),
      expect.objectContaining({
        id: 'workbench-mutation-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'spec',
          suggestedActions: ['inspect-workbench-mutations', 'run-platform-workbench-mutations-apply'],
          artifactPaths: ['source/views/mutations', 'control/workflow/view-mutation-report.json']
        })
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['contract', 'errors']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Error protocol active');
    expect(textResult.stdout).toContain('Issue type count: 5');
    expect(textResult.stdout).toContain('Artifact paths: 7');
    expect(textResult.stdout).toContain('Artifact path list: control/evidence/review-summary.json, control/evidence/verification-report.json, control/workflow/repair-plan.json, control/workflow/upgrade-diagnostics.json, control/workflow/upgrade-plan.json, control/workflow/view-mutation-report.json, source/views/mutations');
    expect(textResult.stdout).toContain('Example repair-plan-error; code=REPAIR-BLOCKED-001');
    expect(textResult.stdout).toContain('Example upgrade-rollback-error; code=UPGRADE-MIGRATION-016');
    expect(textResult.stdout).toContain('Example workbench-mutation-error; code=WORKBENCH-MUTATION-002');

    const jsonResult = await runCli(workspaceRoot, ['contract', 'errors', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      status: 'active',
      exampleCount: 13,
      issueTypeCount: 5,
      suggestedActionCount: 20,
      artifactPathCount: 7
    });

    const compactResult = await runCli(workspaceRoot, ['contract', 'errors', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'active',
      exampleCount: 13,
      issueTypeCount: 5,
      artifactPathCount: 7
    });
  });
});
