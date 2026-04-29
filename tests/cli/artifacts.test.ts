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

test('CLI emits artifact manifest JSON for CI upload consumers', async () => {
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

    const installText = await runCli(workspaceRoot, ['install', 'manifest']);
    expect(installText.code).toBe(0);
    expect(installText.stderr).toBe('');
    expect(installText.stdout).toContain('Install manifest 6 steps');
    expect(installText.stdout).toContain('Blocks: auth/basic-session, entity/customer-basic, tenant/basic-workspace');
    expect(installText.stdout).toContain('Actions: copy=5, merge-prisma=1');
    expect(installText.stdout).toContain('Statuses: installed=6');

    const installJson = await runCli(workspaceRoot, ['install', 'manifest', '--json', '--compact']);
    expect(installJson.code).toBe(0);
    expect(installJson.stderr).toBe('');
    expect(installJson.stdout).not.toContain('\n  "stepId"');
    const installManifest = JSON.parse(installJson.stdout) as Array<{ blockId: string; status: string }>;
    expect(installManifest).toHaveLength(6);
    expect(installManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockId: 'auth/basic-session', status: 'installed' }),
        expect.objectContaining({ blockId: 'entity/customer-basic', status: 'installed' }),
        expect.objectContaining({ blockId: 'tenant/basic-workspace', status: 'installed' })
      ])
    );

    await withTempWorkspace(async (missingInstallWorkspace) => {
      await expect(runCli(missingInstallWorkspace, ['install', 'manifest'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Install manifest not found; run platform compose first')
      });
    });

    const blockUsageText = await runCli(workspaceRoot, ['blocks', 'usage']);
    expect(blockUsageText.code).toBe(0);
    expect(blockUsageText.stderr).toBe('');
    expect(blockUsageText.stdout).toContain('Block usage map 3 blocks');
    expect(blockUsageText.stdout).toContain(
      'Install order: 1:auth/basic-session, 2:tenant/basic-workspace, 3:entity/customer-basic'
    );

    const blockUsageJson = await runCli(workspaceRoot, ['blocks', 'usage', '--json', '--compact']);
    expect(blockUsageJson.code).toBe(0);
    expect(blockUsageJson.stderr).toBe('');
    expect(blockUsageJson.stdout).not.toContain('\n  "blocks"');
    expect(JSON.parse(blockUsageJson.stdout)).toEqual({
      blocks: [
        { id: 'auth/basic-session', installOrder: 1 },
        { id: 'tenant/basic-workspace', installOrder: 2 },
        { id: 'entity/customer-basic', installOrder: 3 }
      ]
    });

    await withTempWorkspace(async (missingUsageWorkspace) => {
      await expect(runCli(missingUsageWorkspace, ['blocks', 'usage'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Block usage map not found; run platform compose first')
      });
    });

    const postgresContractPath = path.join(workspaceRoot, 'project', 'generated', 'postgres-contract.json');
    const postgresContract = {
      formatVersion: '1',
      provider: 'postgres',
      persistenceMode: 'contract-only',
      tables: [
        { name: 'customers', tenantScoped: true, columns: ['id', 'tenant_id', 'name'] },
        { name: 'tickets', tenantScoped: true, columns: ['id', 'tenant_id', 'title'] },
        { name: 'worklogs', tenantScoped: true, columns: ['id', 'tenant_id', 'minutes'] }
      ]
    };
    await writeJson(postgresContractPath, postgresContract);

    const postgresText = await runCli(workspaceRoot, ['postgres', 'contract']);
    expect(postgresText.code).toBe(0);
    expect(postgresText.stderr).toBe('');
    expect(postgresText.stdout).toContain('Postgres contract postgres');
    expect(postgresText.stdout).toContain('mode=contract-only; tables=3; tenantScoped=3');
    expect(postgresText.stdout).toContain('Table list: customers, tickets, worklogs');

    const postgresJson = await runCli(workspaceRoot, ['postgres', 'contract', '--json', '--compact']);
    expect(postgresJson.code).toBe(0);
    expect(postgresJson.stderr).toBe('');
    expect(postgresJson.stdout).not.toContain('\n  "provider"');
    expect(JSON.parse(postgresJson.stdout)).toEqual(postgresContract);

    await withTempWorkspace(async (missingPostgresWorkspace) => {
      await expect(runCli(missingPostgresWorkspace, ['postgres', 'contract'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Postgres contract not found; run platform compose first')
      });
    });

    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'all'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

    const lockText = await runCli(workspaceRoot, ['lock', 'inspect']);
    expect(lockText.code).toBe(0);
    expect(lockText.stderr).toBe('');
    expect(lockText.stdout).toContain('Graph lock ');
    expect(lockText.stdout).toContain('stack=nextjs-ts-prisma-sqlite;');
    expect(lockText.stdout).toContain('blocks=3; slots=1;');
    expect(lockText.stdout).toContain('Block order: 1:auth/basic-session@0.1.0, 2:tenant/basic-workspace@0.1.0, 3:entity/customer-basic@0.1.0');
    expect(lockText.stdout).toContain('Pass status:');

    const lockJson = await runCli(workspaceRoot, ['lock', 'inspect', '--json', '--compact']);
    expect(lockJson.code).toBe(0);
    expect(lockJson.stderr).toBe('');
    expect(lockJson.stdout).not.toContain('\n  "formatVersion"');
    const lockPayload = JSON.parse(lockJson.stdout) as { resolvedBlocks: Array<{ id: string }>; slotTasks: unknown[] };
    expect(lockPayload.resolvedBlocks.map((block) => block.id)).toEqual([
      'auth/basic-session',
      'tenant/basic-workspace',
      'entity/customer-basic'
    ]);
    expect(lockPayload.slotTasks).toHaveLength(1);

    await withTempWorkspace(async (missingLockWorkspace) => {
      await expect(runCli(missingLockWorkspace, ['lock', 'inspect'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Graph lock not found; run platform lock first')
      });
    });

    await expect(runCli(workspaceRoot, ['explain'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const result = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(result.stdout) as {
      formatVersion: string;
      root: string;
      summary: {
        artifactStatus: 'passed' | 'attention';
        artifactCount: number;
        governanceCount: number;
        viewCount: number;
        testCount: number;
        contractCount: number;
        contractPaths: string[];
        uploadGroupCount: number;
        missingCount: number;
        missingReasonTypeCount: number;
        missingReasonCounts: Record<string, number>;
      };
      artifacts: Array<{ path: string; kind: string; uploadName: string; exists: boolean }>;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
      missing: Array<{ path: string; reason: string; declaredBy: string }>;
    };
    expect(manifest).toMatchObject({
      formatVersion: '1',
      root: 'workspace'
    });
    expect(manifest.missing).toEqual([]);
    const governancePaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'governance')
      .map((artifact) => artifact.path);
    const viewPaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'view')
      .map((artifact) => artifact.path);
    const testPaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'test')
      .map((artifact) => artifact.path);
    const contractPaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'contract')
      .map((artifact) => artifact.path);
    const expectedUploadGroups = [
      {
        kind: 'governance',
        count: manifest.summary.governanceCount,
        paths: governancePaths
      },
      {
        kind: 'view',
        count: manifest.summary.viewCount,
        paths: viewPaths
      }
    ];
    if (testPaths.length > 0) {
      expectedUploadGroups.push({
        kind: 'test',
        count: manifest.summary.testCount,
        paths: testPaths
      });
    }
    if (contractPaths.length > 0) {
      expectedUploadGroups.push({
        kind: 'contract',
        count: manifest.summary.contractCount,
        paths: contractPaths
      });
    }
    expect(manifest.summary).toEqual({
      artifactStatus: 'passed',
      artifactCount: manifest.artifacts.length,
      governanceCount: governancePaths.length,
      viewCount: viewPaths.length,
      testCount: testPaths.length,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: expectedUploadGroups.length,
      missingCount: 0,
      missingReasonTypeCount: 0,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 0
      }
    });
    expect(manifest.uploadGroups).toEqual(expectedUploadGroups);

    const inspectText = await runCli(workspaceRoot, ['artifacts', 'manifest']);
    expect(inspectText.code).toBe(0);
    expect(inspectText.stderr).toBe('');
    expect(inspectText.stdout).toContain('Artifact manifest passed');
    expect(inspectText.stdout).toContain(
      `artifacts=${manifest.summary.artifactCount}; missing=0; upload groups=${manifest.summary.uploadGroupCount}`
    );

    const inspectJson = await runCli(workspaceRoot, ['artifacts', 'manifest', '--json', '--compact']);
    expect(inspectJson.code).toBe(0);
    expect(inspectJson.stderr).toBe('');
    expect(inspectJson.stdout).not.toContain('\n  "formatVersion"');
    expect(JSON.parse(inspectJson.stdout)).toEqual(manifest);

    await withTempWorkspace(async (missingManifestWorkspace) => {
      await expect(runCli(missingManifestWorkspace, ['artifacts', 'manifest'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Artifact manifest not found; run platform artifacts --json first')
      });
    });

    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        {
          path: 'control/ci/artifacts.json',
          kind: 'governance',
          uploadName: 'control__ci__artifacts.json',
          exists: true
        },
        {
          path: 'control/evidence/review-summary.json',
          kind: 'governance',
          uploadName: 'control__evidence__review-summary.json',
          exists: true
        },
        {
          path: 'control/graph/explain-graph.json',
          kind: 'governance',
          uploadName: 'control__graph__explain-graph.json',
          exists: true
        },
        {
          path: 'control/workbench/views/source-view.html',
          kind: 'view',
          uploadName: 'control__workbench__views__source-view.html',
          exists: true
        }
      ])
    );

    const { lockPath, provenancePath, reviewSummaryPath, sourceViewPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
      artifacts: Array<{ path: string; generatedByPass?: string }>;
    };
    expect(lock.generatedPaths).toContain('control/ci/artifacts.json');
    expect(provenance.artifacts).toContainEqual(
      expect.objectContaining({
        path: 'control/ci/artifacts.json',
        generatedByPass: 'artifacts'
      })
    );

    const explainResult = await runCli(workspaceRoot, ['explain', '--json']);
    const explainPayload = JSON.parse(explainResult.stdout) as {
      reviewSummary: {
        artifactSummary?: typeof manifest.summary & { uploadGroups?: typeof manifest.uploadGroups };
      };
    };
    expect(explainPayload.reviewSummary.artifactSummary).toMatchObject(manifest.summary);
    expect(explainPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(manifest.uploadGroups);

    const contractArtifactPath = path.join(workspaceRoot, 'project', 'generated', 'postgres-contract.json');
    await fs.mkdir(path.dirname(contractArtifactPath), { recursive: true });
    await fs.writeFile(contractArtifactPath, '{"provider":"postgres"}\n', 'utf8');
    const lockWithContractArtifact = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    lockWithContractArtifact.generatedPaths.push('generated/postgres-contract.json');
    await fs.writeFile(lockPath, `${JSON.stringify(lockWithContractArtifact, null, 2)}\n`, 'utf8');

    const contractResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(contractResult.code).toBe(0);
    expect(contractResult.stderr).toBe('');
    const contractManifest = JSON.parse(contractResult.stdout) as typeof manifest;
    expect(contractManifest.summary).toMatchObject({
      contractCount: 1,
      contractPaths: ['generated/postgres-contract.json'],
      uploadGroupCount: contractManifest.uploadGroups.length,
      missingReasonTypeCount: 0
    });
    expect(contractManifest.artifacts).toContainEqual({
      path: 'generated/postgres-contract.json',
      kind: 'contract',
      uploadName: 'generated__postgres-contract.json',
      exists: true
    });
    expect(contractManifest.uploadGroups).toContainEqual({
      kind: 'contract',
      count: 1,
      paths: ['generated/postgres-contract.json']
    });

    const contractPathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'contract']);
    expect(contractPathsResult.code).toBe(0);
    expect(contractPathsResult.stderr).toBe('');
    expect(contractPathsResult.stdout.trim()).toBe('project/generated/postgres-contract.json');

    const contractPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'contract'
    ]);
    expect(contractPathsJsonResult.code).toBe(0);
    expect(contractPathsJsonResult.stderr).toBe('');
    const contractPathsCompactResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--compact',
      '--kind',
      'contract'
    ]);
    expect(contractPathsCompactResult.code).toBe(0);
    expect(contractPathsCompactResult.stderr).toBe('');
    expect(contractPathsCompactResult.stdout.trim()).not.toContain('\n');
    const contractPathsJson = JSON.parse(contractPathsJsonResult.stdout) as {
      kind: string;
      count: number;
      paths: string[];
      byKind: Record<string, number>;
      uploadGroupCount: number;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
    };
    expect(contractPathsJson).toMatchObject({
      kind: 'contract',
      count: 1,
      paths: ['project/generated/postgres-contract.json'],
      byKind: { contract: 1 },
      uploadGroupCount: 1,
      uploadGroups: [
        {
          kind: 'contract',
          count: 1,
          paths: ['project/generated/postgres-contract.json']
        }
      ]
    });
    expect(JSON.parse(contractPathsCompactResult.stdout)).toEqual(contractPathsJson);

    const explainWithContractResult = await runCli(workspaceRoot, ['explain']);
    expect(explainWithContractResult.code).toBe(0);
    expect(explainWithContractResult.stderr).toBe('');
    expect(explainWithContractResult.stdout).toContain(
      `E2E artifacts: passed; total=${contractManifest.summary.artifactCount}; missing=0; evidence=total=${contractManifest.summary.artifactCount}, missing=0, uploadGroups=${contractManifest.summary.uploadGroupCount}, missingReasonTypes=0`
    );
    expect(explainWithContractResult.stdout).toContain('missing reason types: 0');
    expect(explainWithContractResult.stdout).toContain('contracts: 1');
    expect(explainWithContractResult.stdout).toContain(`upload groups: ${contractManifest.summary.uploadGroupCount}`);

    const contractReviewSummary = JSON.parse(await fs.readFile(reviewSummaryPath, 'utf8')) as {
      artifactSummary?: typeof contractManifest.summary & { uploadGroups?: typeof contractManifest.uploadGroups };
    };
    expect(contractReviewSummary.artifactSummary).toMatchObject({
      contractCount: 1,
      contractPaths: ['generated/postgres-contract.json'],
      uploadGroupCount: contractManifest.uploadGroups.length,
      missingReasonTypeCount: 0
    });
    expect(contractReviewSummary.artifactSummary?.uploadGroups).toContainEqual({
      kind: 'contract',
      count: 1,
      paths: ['generated/postgres-contract.json']
    });

    const lockWithMissingArtifact = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    lockWithMissingArtifact.generatedPaths.push('generated/missing-diagnostic.json');
    await fs.writeFile(lockPath, `${JSON.stringify(lockWithMissingArtifact, null, 2)}\n`, 'utf8');

    const lockMissingResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(lockMissingResult.code).toBe(0);
    expect(lockMissingResult.stderr).toBe('');

    const manifestWithLockMissing = JSON.parse(lockMissingResult.stdout) as typeof manifest;
    const lockMissingDiagnostics = [
      {
        path: 'generated/missing-diagnostic.json',
        reason: 'declared-generated-missing',
        declaredBy: 'graph.lock.json'
      }
    ];
    expect(manifestWithLockMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithLockMissing.summary.uploadGroupCount).toBe(manifestWithLockMissing.uploadGroups.length);
    expect(manifestWithLockMissing.summary.missingCount).toBe(1);
    expect(manifestWithLockMissing.summary.missingReasonTypeCount).toBe(1);
    expect(manifestWithLockMissing.summary.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 0,
      'fixed-view-missing': 0
    });
    expect(manifestWithLockMissing.missing).toEqual(lockMissingDiagnostics);

    const explainWithMissingResult = await runCli(workspaceRoot, ['explain', '--json']);
    const explainWithMissingPayload = JSON.parse(explainWithMissingResult.stdout) as {
      e2eMatrix: {
        rows: Array<{ stage: string; evidenceCount: number; evidence: string[] }>;
      };
      reviewSummary: {
        artifactSummary?: typeof manifest.summary & {
          uploadGroups?: typeof manifest.uploadGroups;
          missingReasonTypeCount?: number;
          missing?: typeof lockMissingDiagnostics;
        };
      };
    };
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(
      manifestWithLockMissing.uploadGroups
    );
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.missingReasonTypeCount).toBe(1);
    expect(explainWithMissingPayload.e2eMatrix.rows.find((row) => row.stage === 'artifacts')).toMatchObject({
      evidenceCount: 4,
      evidence: [
        `total=${manifestWithLockMissing.summary.artifactCount}`,
        'missing=1',
        `uploadGroups=${manifestWithLockMissing.summary.uploadGroupCount}`,
        'missingReasonTypes=1'
      ]
    });
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.missing).toEqual(lockMissingDiagnostics);

    const testPathsBeforeFixture = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'test']);
    expect(testPathsBeforeFixture.code).toBe(0);
    expect(testPathsBeforeFixture.stderr).toBe('');
    expect(testPathsBeforeFixture.stdout === '\n' || testPathsBeforeFixture.stdout === 'project/test-results/**\n').toBe(true);

    await fs.mkdir(path.join(workspaceRoot, 'project', 'test-results'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'project', 'test-results', 'runtime.xml'), '<testsuite />\n', 'utf8');

    const testPathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'test']);
    expect(testPathsResult.code).toBe(0);
    expect(testPathsResult.stderr).toBe('');
    expect(testPathsResult.stdout).toBe('project/test-results/**\n');

    const testPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'test'
    ]);
    expect(testPathsJsonResult.code).toBe(0);
    expect(testPathsJsonResult.stderr).toBe('');
    expect(JSON.parse(testPathsJsonResult.stdout)).toEqual({
      formatVersion: '1',
      root: 'workspace',
      kind: 'test',
      artifactStatus: 'attention',
      count: 1,
      paths: ['project/test-results/**'],
      byKind: {
        test: 1
      },
      uploadGroupCount: 1,
      uploadGroups: [
        {
          kind: 'test',
          count: 1,
          paths: ['project/test-results/**']
        }
      ],
      missingCount: 1,
      missingReasonTypeCount: 1,
      missingReasonCounts: {
        'declared-generated-missing': 1,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 0
      },
      missing: lockMissingDiagnostics
    });

    const testManifestResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    const testManifest = JSON.parse(testManifestResult.stdout) as typeof manifest;
    expect(testManifest.summary.testCount).toBe(1);
    expect(testManifest.uploadGroups).toContainEqual({
      kind: 'test',
      count: 1,
      paths: ['test-results/**']
    });

    const refreshedReviewSummary = JSON.parse(await fs.readFile(reviewSummaryPath, 'utf8')) as {
      artifactSummary?: typeof testManifest.summary & { uploadGroups?: typeof testManifest.uploadGroups };
    };
    expect(refreshedReviewSummary.artifactSummary).toMatchObject({
      testCount: 1,
      missingReasonTypeCount: 1
    });
    expect(refreshedReviewSummary.artifactSummary?.uploadGroups).toContainEqual({
      kind: 'test',
      count: 1,
      paths: ['test-results/**']
    });

    const refreshedSourceView = await fs.readFile(sourceViewPath, 'utf8');
    expect(refreshedSourceView).toContain('<td>Contract Artifacts</td><td>1</td>');
    expect(refreshedSourceView).toContain(`<td>Upload Groups</td><td>${testManifest.summary.uploadGroupCount}</td>`);
    expect(refreshedSourceView).toContain(
      `<td>Missing Reason Types</td><td>${testManifest.summary.missingReasonTypeCount}</td>`
    );
    expect(refreshedSourceView).toContain('<td>contract</td>');
    expect(refreshedSourceView).toContain('generated/postgres-contract.json');
    expect(refreshedSourceView).toContain('<td>Test Artifacts</td><td>1</td>');
    expect(refreshedSourceView).toContain('<td>test</td>');
    expect(refreshedSourceView).toContain('test-results/**');

    await fs.rm(path.join(workspaceRoot, 'control', 'evidence', 'policy-report.json'));
    await fs.rm(sourceViewPath);

    const missingResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(missingResult.code).toBe(0);
    expect(missingResult.stderr).toBe('');

    const manifestWithMissing = JSON.parse(missingResult.stdout) as typeof manifest;
    const fixedMissingDiagnostics = [
      {
        path: 'control/evidence/policy-report.json',
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      },
      {
        path: 'control/workbench/views/source-view.html',
        reason: 'fixed-view-missing',
        declaredBy: 'artifact-manifest'
      },
      ...lockMissingDiagnostics
    ];
    expect(manifestWithMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithMissing.summary.missingCount).toBe(3);
    expect(manifestWithMissing.summary.missingReasonTypeCount).toBe(3);
    expect(manifestWithMissing.summary.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 1,
      'fixed-view-missing': 1
    });
    expect(manifestWithMissing.missing).toEqual(fixedMissingDiagnostics);

    const compactResult = await runCli(workspaceRoot, ['artifacts', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      formatVersion: '1',
      root: 'workspace'
    });

    const pathsResult = await runCli(workspaceRoot, ['artifacts', '--paths']);
    expect(pathsResult.code).toBe(0);
    expect(pathsResult.stderr).toBe('');
    const uploadPaths = pathsResult.stdout.trim().split('\n');
    expect(uploadPaths).toContain('control/ci/artifacts.json');
    expect(uploadPaths).toContain('control/evidence/review-summary.json');
    expect(uploadPaths).not.toContain('project/generated/missing-diagnostic.json');
    expect(uploadPaths).not.toContain('control/workbench/views/source-view.html');

    const pathsJsonResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--json']);
    expect(pathsJsonResult.code).toBe(0);
    expect(pathsJsonResult.stderr).toBe('');
    const pathsJson = JSON.parse(pathsJsonResult.stdout) as {
      formatVersion: string;
      root: string;
      kind: string;
      artifactStatus: 'passed' | 'attention';
      count: number;
      paths: string[];
      byKind: Record<string, number>;
      uploadGroupCount: number;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
      missingCount: number;
      missingReasonTypeCount: number;
      missingReasonCounts: Record<string, number>;
      missing: typeof fixedMissingDiagnostics;
    };
    expect(pathsJson.formatVersion).toBe('1');
    expect(pathsJson.root).toBe('workspace');
    expect(pathsJson.kind).toBe('all');
    expect(pathsJson.artifactStatus).toBe('attention');
    expect(pathsJson.count).toBe(uploadPaths.length);
    expect(pathsJson.paths).toEqual(uploadPaths);
    expect(pathsJson.byKind.view).toBe(
      uploadPaths.filter((pathEntry) => pathEntry.includes('/views/')).length
    );
    expect(pathsJson.byKind.test).toBe(1);
    expect(Object.values(pathsJson.byKind).reduce((total, count) => total + count, 0)).toBe(
      uploadPaths.length
    );
    expect(pathsJson.uploadGroupCount).toBe(pathsJson.uploadGroups.length);
    expect(pathsJson.uploadGroups).toContainEqual({
      kind: 'test',
      count: 1,
      paths: ['project/test-results/**']
    });
    expect(pathsJson.uploadGroups).toContainEqual({
      kind: 'view',
      count: pathsJson.byKind.view,
      paths: uploadPaths.filter((pathEntry) => pathEntry.includes('/views/'))
    });
    expect(pathsJson.uploadGroups.reduce((total, group) => total + group.count, 0)).toBe(
      uploadPaths.length
    );
    expect(pathsJson.missingCount).toBe(fixedMissingDiagnostics.length);
    expect(pathsJson.missingReasonTypeCount).toBe(3);
    expect(pathsJson.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 1,
      'fixed-view-missing': 1
    });
    expect(pathsJson.missing).toEqual(fixedMissingDiagnostics);

    const governancePathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']);
    expect(governancePathsResult.code).toBe(0);
    expect(governancePathsResult.stderr).toBe('');
    const governanceUploadPaths = governancePathsResult.stdout.trim().split('\n');
    expect(governanceUploadPaths).toContain('control/ci/artifacts.json');
    expect(governanceUploadPaths).toContain('control/evidence/review-summary.json');
    expect(governanceUploadPaths).not.toContain('control/workbench/views/slot-rule-view.html');

    const viewPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'view'
    ]);
    expect(viewPathsJsonResult.code).toBe(0);
    expect(viewPathsJsonResult.stderr).toBe('');
    const viewPathsJson = JSON.parse(viewPathsJsonResult.stdout) as {
      formatVersion: string;
      root: string;
      kind: string;
      count: number;
      paths: string[];
      byKind: Record<string, number>;
      uploadGroupCount: number;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
    };
    expect(viewPathsJson.formatVersion).toBe('1');
    expect(viewPathsJson.root).toBe('workspace');
    expect(viewPathsJson.kind).toBe('view');
    expect(viewPathsJson.paths).toEqual(['control/workbench/views/slot-rule-view.html']);
    expect(viewPathsJson.count).toBe(viewPathsJson.paths.length);
    expect(viewPathsJson.byKind).toEqual({ view: 1 });
    expect(viewPathsJson.uploadGroupCount).toBe(1);
    expect(viewPathsJson.uploadGroups).toEqual([
      {
        kind: 'view',
        count: 1,
        paths: ['control/workbench/views/slot-rule-view.html']
      }
    ]);
    expect(viewPathsJson.paths).not.toContain('control/ci/artifacts.json');

  });
}, 120000);
