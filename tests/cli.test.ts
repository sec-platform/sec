import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compilerRoot, getWorkspacePaths } from '../platform/shared/paths.ts';
import type { RepairPlan, VerificationReport } from '../platform/shared/types.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

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

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, 'engineering-compiler-cli-'));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
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

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, [])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|doctor|deps>\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['unknown'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|doctor|deps>\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['unknown', '--flag'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|doctor|deps>\n',
      stderr: ''
    });
  });
});

test('CLI accepts init commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
  });
});

test('CLI defaults verification to the fast lane', { timeout: 20000 }, async () => {
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

    const result = await runCli(workspaceRoot, ['verify']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Verification passed (fast)\n');
  });
});

test('CLI exposes developer dependency environment entrypoints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const doctor = await runCli(workspaceRoot, ['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');
    expect(doctor.stdout).toContain('Developer environment doctor');
    expect(doctor.stdout).toContain('node-version');
    expect(doctor.stdout).toContain('runtime-dependencies');

    const depsStatus = await runCli(workspaceRoot, ['deps', 'status']);
    expect(depsStatus.code).toBe(0);
    expect(depsStatus.stderr).toBe('');
    expect(depsStatus.stdout).toContain('Runtime dependency status');
    expect(depsStatus.stdout).toContain('top-level entries');
    expect(depsStatus.stdout).toContain('Recommended action:');

    const cleanProject = await runCli(workspaceRoot, ['deps', 'clean', '--project']);
    expect(cleanProject.code).toBe(0);
    expect(cleanProject.stderr).toBe('');
    expect(cleanProject.stdout).toBe('Cleaned 2 dependency paths\n');

    const invalidRelink = await runCli(workspaceRoot, ['deps', 'relink']);
    expect(invalidRelink.code).toBe(1);
    expect(invalidRelink.stderr).toContain('platform deps relink project');

    const invalidCleanAll = await runCli(workspaceRoot, ['deps', 'clean', '--all']);
    expect(invalidCleanAll.code).toBe(1);
    expect(invalidCleanAll.stderr).toContain('platform deps clean --all --force');

    const invalidForce = await runCli(workspaceRoot, ['deps', 'clean', '--force']);
    expect(invalidForce.code).toBe(1);
    expect(invalidForce.stderr).toContain('platform deps clean --all --force');
  });
});

test('CLI adds private registry blocks and preserves registry metadata on resolve', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await installPrivateBannerBlock(workspaceRoot);

    await expect(runCli(workspaceRoot, ['add', 'private/banner-basic'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Added block private/banner-basic@0.1.0 from private (private)\n',
      stderr: ''
    });
    await expect(fs.readFile(path.join(workspaceRoot, 'project', 'app.plan.yaml'), 'utf8')).resolves.toContain('private/banner-basic');

    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 4 blocks\n',
      stderr: ''
    });
    const lock = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'project', 'graph.lock.json'), 'utf8')) as {
      resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
    };
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
});

test('CLI emits explain JSON for CI consumers', { timeout: 120000 }, async () => {
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

    const result = await runCli(workspaceRoot, ['explain', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      graph: { nodes: Array<{ id: string; type: string }>; edges: unknown[] };
      reviewSummary: {
        formatVersion: string;
        ciSummary: { status: string; failureCount: number };
        impactedBlocks: string[];
        failurePoints: unknown[];
      };
    };
    expect(payload.graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
    expect(payload.graph.edges.length).toBeGreaterThan(0);
    expect(payload.reviewSummary.formatVersion).toBe('2');
    expect(payload.reviewSummary.ciSummary).toMatchObject({
      status: 'passed',
      failureCount: 0
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

test('CLI emits artifact manifest JSON for CI upload consumers', { timeout: 120000 }, async () => {
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
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'all'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
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
        missingCount: number;
        missingReasonCounts: Record<string, number>;
      };
      artifacts: Array<{ path: string; kind: string; uploadName: string; exists: boolean }>;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
      missing: Array<{ path: string; reason: string; declaredBy: string }>;
    };
    expect(manifest).toMatchObject({
      formatVersion: '1',
      root: 'project'
    });
    expect(manifest.missing).toEqual([]);
    expect(manifest.summary).toEqual({
      artifactStatus: 'passed',
      artifactCount: manifest.artifacts.length,
      governanceCount: manifest.artifacts.filter((artifact) => artifact.kind === 'governance').length,
      viewCount: manifest.artifacts.filter((artifact) => artifact.kind === 'view').length,
      missingCount: 0,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 0
      }
    });
    const governancePaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'governance')
      .map((artifact) => artifact.path);
    const viewPaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'view')
      .map((artifact) => artifact.path);
    expect(manifest.uploadGroups).toEqual([
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
    ]);
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        {
          path: 'generated/ci-artifacts.json',
          kind: 'governance',
          uploadName: 'generated__ci-artifacts.json',
          exists: true
        },
        {
          path: 'generated/review-summary.json',
          kind: 'governance',
          uploadName: 'generated__review-summary.json',
          exists: true
        },
        {
          path: 'generated/explain-graph.json',
          kind: 'governance',
          uploadName: 'generated__explain-graph.json',
          exists: true
        },
        {
          path: 'generated/views/source-view.html',
          kind: 'view',
          uploadName: 'generated__views__source-view.html',
          exists: true
        }
      ])
    );

    const { lockPath, provenancePath, sourceViewPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
      artifacts: Array<{ path: string; generatedByPass?: string }>;
    };
    expect(lock.generatedPaths).toContain('generated/ci-artifacts.json');
    expect(provenance.artifacts).toContainEqual(
      expect.objectContaining({
        path: 'generated/ci-artifacts.json',
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
    expect(manifestWithLockMissing.summary.missingCount).toBe(1);
    expect(manifestWithLockMissing.summary.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 0,
      'fixed-view-missing': 0
    });
    expect(manifestWithLockMissing.missing).toEqual(lockMissingDiagnostics);

    const explainWithMissingResult = await runCli(workspaceRoot, ['explain', '--json']);
    const explainWithMissingPayload = JSON.parse(explainWithMissingResult.stdout) as {
      reviewSummary: {
        artifactSummary?: typeof manifest.summary & {
          uploadGroups?: typeof manifest.uploadGroups;
          missing?: typeof lockMissingDiagnostics;
        };
      };
    };
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(
      manifestWithLockMissing.uploadGroups
    );
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.missing).toEqual(lockMissingDiagnostics);

    await fs.rm(path.join(workspaceRoot, 'project', 'generated', 'policy-report.json'));
    await fs.rm(sourceViewPath);

    const missingResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(missingResult.code).toBe(0);
    expect(missingResult.stderr).toBe('');

    const manifestWithMissing = JSON.parse(missingResult.stdout) as typeof manifest;
    const fixedMissingDiagnostics = [
      ...lockMissingDiagnostics,
      {
        path: 'generated/policy-report.json',
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      },
      {
        path: 'generated/views/source-view.html',
        reason: 'fixed-view-missing',
        declaredBy: 'artifact-manifest'
      }
    ];
    expect(manifestWithMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithMissing.summary.missingCount).toBe(3);
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
      root: 'project'
    });

    const pathsResult = await runCli(workspaceRoot, ['artifacts', '--paths']);
    expect(pathsResult.code).toBe(0);
    expect(pathsResult.stderr).toBe('');
    const uploadPaths = pathsResult.stdout.trim().split('\n');
    expect(uploadPaths).toContain('project/generated/ci-artifacts.json');
    expect(uploadPaths).toContain('project/generated/review-summary.json');
    expect(uploadPaths).not.toContain('project/generated/missing-diagnostic.json');
    expect(uploadPaths).not.toContain('project/generated/views/source-view.html');

    const pathsJsonResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--json']);
    expect(pathsJsonResult.code).toBe(0);
    expect(pathsJsonResult.stderr).toBe('');
    const pathsJson = JSON.parse(pathsJsonResult.stdout) as { count: number; paths: string[] };
    expect(pathsJson).toEqual({
      count: uploadPaths.length,
      paths: uploadPaths
    });

    const governancePathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']);
    expect(governancePathsResult.code).toBe(0);
    expect(governancePathsResult.stderr).toBe('');
    const governanceUploadPaths = governancePathsResult.stdout.trim().split('\n');
    expect(governanceUploadPaths).toContain('project/generated/ci-artifacts.json');
    expect(governanceUploadPaths).toContain('project/generated/review-summary.json');
    expect(governanceUploadPaths).not.toContain('project/generated/views/slot-rule-view.html');

    const viewPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'view'
    ]);
    expect(viewPathsJsonResult.code).toBe(0);
    expect(viewPathsJsonResult.stderr).toBe('');
    const viewPathsJson = JSON.parse(viewPathsJsonResult.stdout) as { count: number; paths: string[] };
    expect(viewPathsJson.paths).toEqual(['project/generated/views/slot-rule-view.html']);
    expect(viewPathsJson.count).toBe(viewPathsJson.paths.length);
    expect(viewPathsJson.paths).not.toContain('project/generated/ci-artifacts.json');
  });
});

test('CLI emits repair dry-run JSON for CI consumers', { timeout: 20000 }, async () => {
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
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const { lockPath, repairPlanPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { passStatus: { verify: string } };
    lock.passStatus.verify = 'failed';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    const report = JSON.parse(await fs.readFile(verificationReportPath, 'utf8')) as VerificationReport;
    report.unit.status = 'failed';
    report.fast.status = 'failed';
    report.fast.unit.status = 'failed';
    report.fast.logs.stderr = 'Unit verification failed for customer_normalizer';
    report.summary.status = 'failed';
    report.summary.failedLanes = ['fast'];
    report.logs.stderr = 'Unit verification failed for customer_normalizer';
    await fs.writeFile(verificationReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const result = await runCli(workspaceRoot, ['repair', '--dry-run', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const repairPlan = JSON.parse(result.stdout) as RepairPlan;
    expect(repairPlan).toMatchObject({
      formatVersion: '1',
      status: 'pending',
      sourceVerificationStatus: 'failed',
      requiresVerification: false
    });
    expect(repairPlan.tasks).toHaveLength(1);
    expect(repairPlan.tasks[0]).toMatchObject({
      taskId: 'repair_slot_customer_normalizer',
      taskKind: 'repair-slot',
      sourceSlotId: 'customer_normalizer',
      targetBlock: 'entity/customer-basic',
      targetFile: 'custom/customer_normalizer.ts'
    });
    expect(repairPlan.tasks[0].failurePoints).toEqual([
      expect.objectContaining({
        lane: 'fast',
        kind: 'unit',
        issueType: 'slot',
        repairable: true,
        artifactPath: 'tests/unit',
        message: 'Unit verification failed for customer_normalizer'
      })
    ]);
    expect(repairPlan.tasks[0].preview).toMatchObject({
      changed: false
    });

    const writtenRepairPlan = JSON.parse(await fs.readFile(repairPlanPath, 'utf8')) as RepairPlan;
    expect(writtenRepairPlan).toEqual(repairPlan);
  });
});

test('CLI emits upgrade dry-run JSON for CI consumers', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    const result = await runCli(workspaceRoot, ['upgrade', 'auth/basic-session', '0.1.1', '--dry-run', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const upgradePlan = JSON.parse(result.stdout) as {
      blockId: string;
      fromVersion: string;
      toVersion: string;
      status: string;
      migrationKindCounts: Record<string, number>;
      impacts: string[];
    };
    expect(upgradePlan).toMatchObject({
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      status: 'planned',
      migrationKindCounts: {
        'file-replace': 1,
        'json-array-append': 1
      }
    });
    expect(upgradePlan.impacts).toEqual(['src/installed/auth/session.ts', 'upgrade.metadata.json']);
  });
});

test('CLI reports argument usage errors', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--unknown'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform init [--reset]\n'
    });
    await expect(runCli(workspaceRoot, ['init', '--reset', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform init [--reset]\n'
    });
    await expect(runCli(workspaceRoot, ['add'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform add <block-id>\n'
    });
    await expect(runCli(workspaceRoot, ['add', 'entity/customer-basic', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform add <block-id>\n'
    });
    await expect(runCli(workspaceRoot, ['repair', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform repair [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['repair', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform repair [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['explain', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform explain [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['explain', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform explain [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['artifacts'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform artifacts (--json [--compact]|--paths [--json] [--kind governance|view])\n'
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform artifacts (--json [--compact]|--paths [--json] [--kind governance|view])\n'
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--paths', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform artifacts (--json [--compact]|--paths [--json] [--kind governance|view])\n'
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform artifacts (--json [--compact]|--paths [--json] [--kind governance|view])\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'slow'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', 'fast'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['resolve', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform resolve\n'
    });
  });
});
