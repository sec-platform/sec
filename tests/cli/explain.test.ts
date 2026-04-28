import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
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
import { compilerRoot, getWorkspacePaths } from '../../platform/shared/paths.ts';
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
import { withTempWorkspace } from '../helpers/test-utils.ts';

function runCli(workspaceRoot: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(compilerRoot, 'platform', 'cli', 'index.ts'), ...args], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

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

test('CLI emits explain JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    const verification = await runCli(workspaceRoot, ['verify', '--lane', 'all']);
    expect(verification.code).toBe(0);
    expect(verification.stderr).toBe('');
    expect(verification.stdout).toContain('Verification passed (all)');
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['explain']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Explain graph');
    expect(textResult.stdout).toContain('Node types:');
    expect(textResult.stdout).toContain('block=');
    expect(textResult.stdout).toContain('policy=');
    expect(textResult.stdout).toContain('Edge types:');
    expect(textResult.stdout).toContain('depends_on=');
    expect(textResult.stdout).toContain('Coverage: 3 blocks; 1 slots;');
    expect(textResult.stdout).toContain('uncovered blocks=0');
    expect(textResult.stdout).toContain('uncovered slots=0');
    expect(textResult.stdout).toContain('Coverage detail: passed;');
    expect(textResult.stdout).toContain('covered blocks: 3/3');
    expect(textResult.stdout).toContain('covered slots: 1/1');
    expect(textResult.stdout).toContain('Provenance origins:');
    expect(textResult.stdout).toContain('block=');
    expect(textResult.stdout).toContain('slot=');
    expect(textResult.stdout).toContain('Provenance detail: artifacts:');
    expect(textResult.stdout).toContain('registry:');
    expect(textResult.stdout).toContain('unverified:');
    expect(textResult.stdout).toContain('Install impact: 3 impacts; groups: 2; actions: copy, merge-prisma;');
    expect(textResult.stdout).toContain('runtime entries: 0; targets: 6');
    expect(textResult.stdout).toContain(
      'CI status: passed; failures: 0; regression risks: 0; conflict hints: 0'
    );
    expect(textResult.stdout).toContain('Chain: attention; stages: 3/4; attention: 1; failed: 0');
    expect(textResult.stdout).toContain('E2E verification: passed; lane=all; failed=none; evidence=ci=passed, failures=0');
    expect(textResult.stdout).toContain('E2E coverage: passed; blocks=3/3; slots=1/1; evidence=blocks=3/3, slots=1/1');
    expect(textResult.stdout).toContain('E2E artifacts: attention; total=0; missing=0; evidence=artifacts=missing');
    expect(textResult.stdout).toContain('E2E review: passed; review-summary=generated; evidence=review-summary=generated');
    expect(textResult.stdout).toContain('Impacted: 3 blocks, 1 slots,');
    expect(textResult.stdout).toContain(
      'Policy: passed; official: 1; project: 0; merged: 1; violations: 0'
    );

    const result = await runCli(workspaceRoot, ['explain', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const compactResult = await runCli(workspaceRoot, ['explain', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');

    const payload = JSON.parse(result.stdout) as {
      graph: { nodes: Array<{ id: string; type: string }>; edges: unknown[] };
      e2eMatrix: {
        status: string;
        rowCount: number;
        rows: Array<{
          stage: string;
          status: string;
          detail: string;
          evidenceCount: number;
          evidence: string[];
        }>;
      };
      reviewSummary: {
        formatVersion: string;
        ciSummary: { status: string; failureCount: number };
        chainSummary: {
          status: string;
          stageCount: number;
          passedStageCount: number;
          attentionStageCount: number;
          failedStageCount: number;
          stageSummaries: Array<{ id: string; status: string; detail: string }>;
        };
        coverageSummary?: {
          status: string;
          acceptancePassedCount: number;
          blockCount: number;
          slotCount: number;
          coveredBlockCount: number;
          coveredSlotCount: number;
          uncoveredBlockCount: number;
          uncoveredSlotCount: number;
          blockSummaries: Array<{ id: string; coveredByCount: number; coveredBy: string[] }>;
          slotSummaries: Array<{ id: string; coveredByCount: number; coveredBy: string[] }>;
        };
        provenanceSummary?: {
          artifactCount: number;
          overrideArtifactCount: number;
          registryArtifactCount: number;
          generatedArtifactCount: number;
          unverifiedArtifactCount: number;
          originSummaryCount: number;
          originSummaries: Array<{ originType: string; count: number; paths: string[] }>;
          overrideSummaryCount: number;
          overrideSummaries: Array<{ overrideStatus: string; count: number; paths: string[] }>;
          registrySummaryCount: number;
          registrySummaries: Array<{ registrySourceId: string; count: number; paths: string[] }>;
          generatedPassSummaries: Array<{ pass: string; count: number; paths: string[] }>;
        };
        policySummary?: {
          status: string;
          officialPolicyCount: number;
          projectPolicyCount: number;
          mergedPolicyCount: number;
          sourceCount: number;
          violationCount: number;
          sourceSummaries: Array<{ scope: string; path: string; policyIds: string[] }>;
          mergedSummaries: Array<{ id: string; targetCount: number; targets: string[] }>;
        };
        changeSourceCount: number;
        runtimeEntryCount: number;
        installImpactCount: number;
        installImpactSummary: {
          impactCount: number;
          groupCount: number;
          blockCount: number;
          actionKinds: string[];
          runtimeEntryCount: number;
          targetPathCount: number;
          groupSummaries: Array<{
            vertical: string;
            blockCount: number;
            actionKinds: string[];
            runtimeEntries: string[];
            targetPaths: string[];
          }>;
        };
        impactedBlocks: string[];
        failurePoints: unknown[];
      };
    };
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      e2eMatrix: {
        status: 'attention',
        rowCount: 4
      },
      reviewSummary: {
        formatVersion: '2',
        chainSummary: { stageCount: 4 }
      }
    });
    expect(payload.graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
    expect(payload.graph.edges.length).toBeGreaterThan(0);
    expect(payload.e2eMatrix).toMatchObject({
      status: 'attention',
      rowCount: 4,
      rows: [
        { stage: 'verification', status: 'passed', evidenceCount: 2, evidence: ['ci=passed', 'failures=0'] },
        { stage: 'coverage', status: 'passed', evidenceCount: 2, evidence: ['blocks=3/3', 'slots=1/1'] },
        { stage: 'artifacts', status: 'attention', evidenceCount: 1, evidence: ['artifacts=missing'] },
        { stage: 'review', status: 'passed', evidenceCount: 1, evidence: ['review-summary=generated'] }
      ]
    });

    const matrixText = await runCli(workspaceRoot, ['review', 'matrix']);
    expect(matrixText.code).toBe(0);
    expect(matrixText.stderr).toBe('');
    expect(matrixText.stdout).toContain('E2E matrix attention; rows=4');
    expect(matrixText.stdout).toContain('verification: passed; lane=all; failed=none; evidence=ci=passed, failures=0');
    expect(matrixText.stdout).toContain('artifacts: attention; total=0; missing=0; evidence=artifacts=missing');

    const matrixJson = await runCli(workspaceRoot, ['review', 'matrix', '--json', '--compact']);
    expect(matrixJson.code).toBe(0);
    expect(matrixJson.stderr).toBe('');
    expect(matrixJson.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(matrixJson.stdout)).toEqual(payload.e2eMatrix);
    expect(payload.reviewSummary.formatVersion).toBe('2');
    expect(payload.reviewSummary.ciSummary).toMatchObject({
      status: 'passed',
      failureCount: 0
    });
    expect(payload.reviewSummary.chainSummary).toMatchObject({
      status: 'attention',
      stageCount: 4,
      passedStageCount: 3,
      attentionStageCount: 1,
      failedStageCount: 0,
      stageSummaries: [
        { id: 'verification', status: 'passed', detail: 'lane=all; failed=none' },
        { id: 'coverage', status: 'passed', detail: 'blocks=3/3; slots=1/1' },
        { id: 'artifacts', status: 'attention', detail: 'total=0; missing=0' },
        { id: 'review', status: 'passed', detail: 'review-summary=generated' }
      ]
    });
    expect(payload.reviewSummary.coverageSummary).toMatchObject({
      status: 'passed',
      blockCount: 3,
      slotCount: 1,
      coveredBlockCount: 3,
      coveredSlotCount: 1,
      uncoveredBlockCount: 0,
      uncoveredSlotCount: 0
    });
    expect(payload.reviewSummary.coverageSummary?.blockSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity/customer-basic',
          coveredByCount: 3,
          coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer', 'user_can_list_customers']
        })
      ])
    );
    expect(payload.reviewSummary.coverageSummary?.slotSummaries).toEqual([
      expect.objectContaining({
        id: 'customer_normalizer',
        coveredByCount: 2,
        coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer']
      })
    ]);
    expect(payload.reviewSummary.provenanceSummary).toMatchObject({
      overrideArtifactCount: 0,
      registryArtifactCount: expect.any(Number),
      generatedArtifactCount: expect.any(Number),
      unverifiedArtifactCount: expect.any(Number),
      originSummaryCount: expect.any(Number),
      overrideSummaryCount: expect.any(Number),
      registrySummaryCount: expect.any(Number),
      originSummaries: expect.arrayContaining([
        expect.objectContaining({
          originType: 'block',
          count: expect.any(Number)
        }),
        expect.objectContaining({
          originType: 'slot',
          count: expect.any(Number)
        })
      ]),
      generatedPassSummaries: expect.arrayContaining([
        expect.objectContaining({
          pass: 'compose',
          count: expect.any(Number)
        })
      ])
    });
    expect(payload.reviewSummary.provenanceSummary?.artifactCount).toBeGreaterThan(0);
    expect(payload.reviewSummary.policySummary).toMatchObject({
      status: 'passed',
      officialPolicyCount: 1,
      projectPolicyCount: 0,
      mergedPolicyCount: 1,
      sourceCount: 2,
      violationCount: 0,
      sourceSummaries: [
        {
          scope: 'official',
          path: 'platform/policies/official/policy.spec.yaml',
          policyIds: ['tenant-scope-required']
        },
        {
          scope: 'project',
          path: 'project/policies/policy.spec.yaml',
          policyIds: []
        }
      ],
      mergedSummaries: [
        {
          id: 'tenant-scope-required',
          targetCount: 1,
          targets: ['src/installed/entity/customer-service.ts']
        }
      ]
    });
    expect(payload.reviewSummary.installImpactSummary).toMatchObject({
      impactCount: 3,
      groupCount: 2,
      blockCount: 3,
      actionKinds: ['copy', 'merge-prisma'],
      runtimeEntryCount: 0,
      targetPathCount: 6,
      groupSummaries: expect.arrayContaining([
        expect.objectContaining({
          vertical: 'customer',
          blockCount: 1,
          actionKinds: ['copy', 'merge-prisma'],
          runtimeEntries: [],
          targetPaths: expect.arrayContaining([
            'prisma/schema.prisma',
            'src/installed/entity/customer-service.ts',
            'tests/acceptance/customer-flow.test.ts',
            'tests/unit/customer-normalizer.test.ts'
          ])
        }),
        expect.objectContaining({
          vertical: 'none',
          blockCount: 2,
          actionKinds: ['copy'],
          runtimeEntries: [],
          targetPaths: expect.arrayContaining([
            'src/installed/auth/session.ts',
            'src/installed/tenant/context.ts'
          ])
        })
      ])
    });
    expect(payload.reviewSummary.impactedBlocks).toEqual(
      expect.arrayContaining([
        'auth/basic-session',
        'entity/customer-basic',
        'tenant/basic-workspace'
      ])
    );
    expect(payload.reviewSummary.failurePoints).toEqual([]);
  });
});
