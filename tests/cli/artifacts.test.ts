import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_MISSING_REASON,
  CI_ARTIFACT_PATHS,
  ciArtifactUploadName
} from '../../platform/shared/ci-artifact-contract.ts';
import type {
  CiArtifactKind,
  CiArtifactManifest,
  CiArtifactMissingEntry,
  CiArtifactMissingReason,
  CiArtifactSummary,
  CiArtifactUploadGroup
} from '../../platform/shared/ci-artifact-types.ts';
import { pathExists, readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { expectContainsAll } from '../helpers/assertion-helpers.ts';
import { buildArtifactMissingReasonCounts, buildArtifactUploadGroup } from '../helpers/ci-artifact-fixtures.ts';
import {
  expectCliJson,
  expectCliSuccess,
  expectCliText,
  runCliInProcess as runCli
} from '../helpers/cli-helpers.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

type ReviewArtifactSummary = CiArtifactSummary & {
  uploadGroups?: CiArtifactUploadGroup[];
  missing?: CiArtifactMissingEntry[];
};

type ArtifactPathsPayload = {
  formatVersion: string;
  root: string;
  kind: string;
  artifactStatus?: CiArtifactSummary['artifactStatus'];
  count: number;
  paths: string[];
  byKind: Record<string, number>;
  uploadGroupCount: number;
  uploadGroups: CiArtifactUploadGroup[];
  missingCount?: number;
  missingReasonTypeCount?: number;
  missingReasonCounts?: Record<CiArtifactMissingReason, number>;
  missing?: CiArtifactMissingEntry[];
};

function artifactPathsByKind(manifest: CiArtifactManifest, kind: CiArtifactKind): string[] {
  return manifest.artifacts
    .filter((artifact) => artifact.kind === kind)
    .map((artifact) => artifact.path);
}

function optionalUploadGroup(
  kind: CiArtifactKind,
  count: number,
  paths: string[]
): CiArtifactUploadGroup[] {
  return paths.length > 0 ? [buildArtifactUploadGroup(kind, count, paths)] : [];
}

function expectUploadGroup(
  groups: readonly CiArtifactUploadGroup[] | undefined,
  kind: CiArtifactKind,
  paths: string[],
  count = paths.length
): void {
  expect(groups).toContainEqual(buildArtifactUploadGroup(kind, count, paths));
}

type ExpectedArtifactPathsPayload = {
  artifactStatus?: CiArtifactSummary['artifactStatus'];
  byKind: Record<string, number>;
  exact?: boolean;
  kind: string;
  missing?: CiArtifactMissingEntry[];
  missingReasonCounts?: Record<CiArtifactMissingReason, number>;
  missingReasonTypeCount?: number;
  paths: string[];
  uploadGroups: CiArtifactUploadGroup[];
};

function expectArtifactPathsPayload(payload: ArtifactPathsPayload, expected: ExpectedArtifactPathsPayload): void {
  const expectedPayload = {
    formatVersion: '1',
    root: 'workspace',
    kind: expected.kind,
    count: expected.paths.length,
    paths: expected.paths,
    byKind: expected.byKind,
    uploadGroupCount: expected.uploadGroups.length,
    uploadGroups: expected.uploadGroups,
    ...(expected.artifactStatus === undefined ? {} : { artifactStatus: expected.artifactStatus }),
    ...(expected.missing === undefined ? {} : { missingCount: expected.missing.length, missing: expected.missing }),
    ...(expected.missingReasonTypeCount === undefined ? {} : { missingReasonTypeCount: expected.missingReasonTypeCount }),
    ...(expected.missingReasonCounts === undefined ? {} : { missingReasonCounts: expected.missingReasonCounts })
  };

  if (expected.exact === true) {
    expect(payload).toEqual(expectedPayload);
    return;
  }

  expect(payload).toMatchObject(expectedPayload);
}

test('CLI emits artifact manifest JSON for CI upload consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
    await expectCliSuccess(workspaceRoot, ['resolve'], 'Resolved 3 blocks\n');
    await expectCliSuccess(workspaceRoot, ['compose'], 'Composed project\n');

    await expectCliText(workspaceRoot, ['install', 'manifest'], [
      'Install manifest 7 steps',
      'Blocks: auth/basic-session, entity/customer-basic, tenant/basic-workspace',
      'Actions: copy=6, merge-prisma=1',
      'Statuses: installed=7'
    ]);

    const installManifest = await expectCliJson<Array<{ blockId: string; status: string }>>(
      workspaceRoot,
      ['install', 'manifest', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(installManifest).toHaveLength(7);
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

    await expectCliText(workspaceRoot, ['blocks', 'usage'], [
      'Block usage map 3 blocks',
      'Install order: 1:auth/basic-session, 2:tenant/basic-workspace, 3:entity/customer-basic'
    ]);

    const blockUsageJson = await expectCliJson(
      workspaceRoot,
      ['blocks', 'usage', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(blockUsageJson).toEqual({
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

    await expectCliText(workspaceRoot, ['postgres', 'contract'], [
      'Postgres contract postgres',
      'mode=contract-only; tables=3; tenantScoped=3',
      'Table list: customers, tickets, worklogs'
    ]);

    const postgresJson = await expectCliJson(
      workspaceRoot,
      ['postgres', 'contract', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(postgresJson).toEqual(postgresContract);

    await withTempWorkspace(async (missingPostgresWorkspace) => {
      await expect(runCli(missingPostgresWorkspace, ['postgres', 'contract'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Postgres contract not found; run platform compose first')
      });
    });

    await expectCliSuccess(workspaceRoot, ['adapt'], 'Adapted slots\n');
    await expectCliSuccess(workspaceRoot, ['verify', '--lane', 'all']);
    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');

    await expectCliText(workspaceRoot, ['lock', 'inspect'], [
      'Graph lock ',
      'stack=nextjs-ts-prisma-sqlite;',
      'blocks=3; slots=1;',
      'Block order: 1:auth/basic-session@0.1.0, 2:tenant/basic-workspace@0.1.0, 3:entity/customer-basic@0.1.0',
      'Pass status:'
    ]);

    const lockPayload = await expectCliJson<{ resolvedBlocks: Array<{ id: string }>; slotTasks: unknown[] }>(
      workspaceRoot,
      ['lock', 'inspect', '--json', '--compact'],
      undefined,
      { compact: true }
    );
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

    await expectCliSuccess(workspaceRoot, ['explain']);
    {
      const { overviewViewPath } = getWorkspacePaths(workspaceRoot);
      await fs.rm(overviewViewPath, { force: true });
    }

    {
      const { ciArtifactsPath, lockPath, provenancePath } = getWorkspacePaths(workspaceRoot);
      const lockBeforePaths = await fs.readFile(lockPath, 'utf8');
      const provenanceBeforePaths = await fs.readFile(provenancePath, 'utf8');
      expect(await pathExists(ciArtifactsPath)).toBe(false);

      await expectCliJson(
        workspaceRoot,
        [
          'artifacts',
          '--paths',
          '--json',
          '--compact',
          '--kind',
          'governance'
        ],
        undefined,
        { compact: true }
      );
      expect(await pathExists(ciArtifactsPath)).toBe(false);
      expect(await fs.readFile(lockPath, 'utf8')).toBe(lockBeforePaths);
      expect(await fs.readFile(provenancePath, 'utf8')).toBe(provenanceBeforePaths);
    }

    const manifest = await expectCliJson<CiArtifactManifest>(workspaceRoot, ['artifacts', '--json']);
    expect(manifest).toMatchObject({
      formatVersion: '1',
      root: 'workspace'
    });
    const overviewMissingDiagnostics: CiArtifactMissingEntry[] = [
      {
        path: CI_ARTIFACT_FILES.overviewView,
        reason: CI_ARTIFACT_MISSING_REASON.fixedViewMissing,
        declaredBy: 'artifact-manifest'
      }
    ];
    expect(manifest.missing).toEqual(overviewMissingDiagnostics);
    const governancePaths = artifactPathsByKind(manifest, 'governance');
    const viewPaths = artifactPathsByKind(manifest, 'view');
    const testPaths = artifactPathsByKind(manifest, 'test');
    const contractPaths = artifactPathsByKind(manifest, 'contract');
    const expectedUploadGroups = [
      buildArtifactUploadGroup('governance', manifest.summary.governanceCount, governancePaths),
      buildArtifactUploadGroup('view', manifest.summary.viewCount, viewPaths),
      ...optionalUploadGroup('test', manifest.summary.testCount, testPaths),
      ...optionalUploadGroup('contract', manifest.summary.contractCount, contractPaths)
    ];
    expect(manifest.summary).toEqual({
      artifactStatus: 'attention',
      artifactCount: manifest.artifacts.length,
      governanceCount: governancePaths.length,
      viewCount: viewPaths.length,
      testCount: testPaths.length,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: expectedUploadGroups.length,
      missingCount: overviewMissingDiagnostics.length,
      missingReasonTypeCount: 1,
      missingReasonCounts: buildArtifactMissingReasonCounts({
        [CI_ARTIFACT_MISSING_REASON.fixedViewMissing]: 1
      })
    });
    expect(manifest.uploadGroups).toEqual(expectedUploadGroups);

    await expectCliText(workspaceRoot, ['artifacts', 'manifest'], [
      'Artifact manifest attention',
      `artifacts=${manifest.summary.artifactCount}; missing=${overviewMissingDiagnostics.length}; upload groups=${manifest.summary.uploadGroupCount}`
    ]);

    const inspectJson = await expectCliJson<CiArtifactManifest>(
      workspaceRoot,
      ['artifacts', 'manifest', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(inspectJson).toEqual(manifest);

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
          path: CI_ARTIFACT_MANIFEST_PATH,
          kind: 'governance',
          uploadName: ciArtifactUploadName(CI_ARTIFACT_MANIFEST_PATH),
          exists: true
        },
        {
          path: CI_ARTIFACT_FILES.reviewSummary,
          kind: 'governance',
          uploadName: 'control__evidence__review-summary.json',
          exists: true
        },
        {
          path: CI_ARTIFACT_FILES.explainGraph,
          kind: 'governance',
          uploadName: 'control__graph__explain-graph.json',
          exists: true
        },
        {
          path: CI_ARTIFACT_FILES.sourceView,
          kind: 'view',
          uploadName: 'control__workbench__views__source-view.html',
          exists: true
        },
        {
          path: CI_ARTIFACT_FILES.graphView,
          kind: 'view',
          uploadName: 'control__workbench__views__graph-view.html',
          exists: true
        },
        {
          path: CI_ARTIFACT_FILES.reviewView,
          kind: 'view',
          uploadName: 'control__workbench__views__review-view.html',
          exists: true
        }
      ])
    );

    const { lockPath, overviewViewPath, provenancePath, reviewSummaryPath, sourceViewPath } = getWorkspacePaths(workspaceRoot);
    const lock = await readJson<{ generatedPaths: string[] }>(lockPath);
    const provenance = await readJson<{
      artifacts: Array<{ path: string; generatedByPass?: string }>;
    }>(provenancePath);
    expect(lock.generatedPaths).toContain(CI_ARTIFACT_MANIFEST_PATH);
    expect(provenance.artifacts).toContainEqual(
      expect.objectContaining({
        path: CI_ARTIFACT_MANIFEST_PATH,
        generatedByPass: 'artifacts'
      })
    );

    try {
      await fs.writeFile(overviewViewPath, '<!doctype html><title>Overview</title>\n', 'utf8');
      const manifestWithOverview = await expectCliJson<typeof manifest>(workspaceRoot, ['artifacts', '--json']);
      const viewPathsWithOverview = artifactPathsByKind(manifestWithOverview, 'view');
      expect(CI_ARTIFACT_PATHS.view[0]).toBe(CI_ARTIFACT_FILES.overviewView);
      expect(viewPathsWithOverview).toContain(CI_ARTIFACT_FILES.overviewView);
      expect(manifestWithOverview.missing).toEqual([]);
      expect(manifestWithOverview.summary).toMatchObject({
        artifactStatus: 'passed',
        missingCount: 0,
        missingReasonTypeCount: 0
      });
      expect(manifestWithOverview.artifacts).toContainEqual({
        path: CI_ARTIFACT_FILES.overviewView,
        kind: 'view',
        uploadName: 'control__workbench__views__overview-view.html',
        exists: true
      });
      expectUploadGroup(
        manifestWithOverview.uploadGroups,
        'view',
        viewPathsWithOverview,
        viewPathsWithOverview.length
      );
    } finally {
      await fs.rm(overviewViewPath, { force: true });
    }
    const manifestAfterOverviewProbe = await expectCliJson<typeof manifest>(workspaceRoot, ['artifacts', '--json']);
    expect(manifestAfterOverviewProbe.summary).toMatchObject(manifest.summary);
    expect(manifestAfterOverviewProbe.missing).toEqual(overviewMissingDiagnostics);

    const explainPayload = await expectCliJson<{
      reviewSummary: {
        artifactSummary?: ReviewArtifactSummary;
      };
    }>(workspaceRoot, ['explain', '--json']);
    expect(explainPayload.reviewSummary.artifactSummary).toMatchObject(manifest.summary);
    expect(explainPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(manifest.uploadGroups);
    await fs.rm(overviewViewPath, { force: true });

    const contractArtifactPath = path.join(workspaceRoot, 'project', 'generated', 'postgres-contract.json');
    await fs.mkdir(path.dirname(contractArtifactPath), { recursive: true });
    await fs.writeFile(contractArtifactPath, '{"provider":"postgres"}\n', 'utf8');
    const lockWithContractArtifact = await readJson<{ generatedPaths: string[] }>(lockPath);
    lockWithContractArtifact.generatedPaths.push('generated/postgres-contract.json');
    await writeJson(lockPath, lockWithContractArtifact);

    const contractManifest = await expectCliJson<typeof manifest>(workspaceRoot, ['artifacts', '--json']);
    expect(contractManifest.summary).toMatchObject({
      artifactStatus: 'attention',
      contractCount: 1,
      contractPaths: ['generated/postgres-contract.json'],
      uploadGroupCount: contractManifest.uploadGroups.length,
      missingCount: overviewMissingDiagnostics.length,
      missingReasonTypeCount: 1,
      missingReasonCounts: buildArtifactMissingReasonCounts({
        [CI_ARTIFACT_MISSING_REASON.fixedViewMissing]: 1
      })
    });
    expect(contractManifest.missing).toEqual(overviewMissingDiagnostics);
    expect(contractManifest.artifacts).toContainEqual({
      path: 'generated/postgres-contract.json',
      kind: 'contract',
      uploadName: 'generated__postgres-contract.json',
      exists: true
    });
    expectUploadGroup(
      contractManifest.uploadGroups,
      'contract',
      ['generated/postgres-contract.json']
    );

    await expectCliSuccess(
      workspaceRoot,
      ['artifacts', '--paths', '--kind', 'contract'],
      'project/generated/postgres-contract.json\n'
    );

    const contractPathsJson = await expectCliJson<ArtifactPathsPayload>(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'contract'
    ]);
    const contractPathsCompact = await expectCliJson<ArtifactPathsPayload>(
      workspaceRoot,
      [
        'artifacts',
        '--paths',
        '--json',
        '--compact',
        '--kind',
        'contract'
      ],
      undefined,
      { compact: true }
    );
    expectArtifactPathsPayload(contractPathsJson, {
      kind: 'contract',
      paths: ['project/generated/postgres-contract.json'],
      byKind: { contract: 1 },
      uploadGroups: [buildArtifactUploadGroup('contract', 1, ['project/generated/postgres-contract.json'])]
    });
    expect(contractPathsCompact).toEqual(contractPathsJson);

    await expectCliText(workspaceRoot, ['explain'], [
      `E2E artifacts: attention; total=${contractManifest.summary.artifactCount}; missing=${overviewMissingDiagnostics.length}; evidence=total=${contractManifest.summary.artifactCount}, missing=${overviewMissingDiagnostics.length}, uploadGroups=${contractManifest.summary.uploadGroupCount}, missingReasonTypes=1`,
      'missing reason types: 1',
      'contracts: 1',
      `upload groups: ${contractManifest.summary.uploadGroupCount}`
    ]);
    await fs.rm(overviewViewPath, { force: true });

    const contractReviewSummary = await readJson<{
      artifactSummary?: ReviewArtifactSummary;
    }>(reviewSummaryPath);
    expect(contractReviewSummary.artifactSummary).toMatchObject({
      contractCount: 1,
      contractPaths: ['generated/postgres-contract.json'],
      uploadGroupCount: contractManifest.uploadGroups.length,
      missingCount: overviewMissingDiagnostics.length,
      missingReasonTypeCount: 1
    });
    expectUploadGroup(
      contractReviewSummary.artifactSummary?.uploadGroups,
      'contract',
      ['generated/postgres-contract.json']
    );

    const lockWithMissingArtifact = await readJson<{ generatedPaths: string[] }>(lockPath);
    lockWithMissingArtifact.generatedPaths.push('generated/missing-diagnostic.json');
    await writeJson(lockPath, lockWithMissingArtifact);

    const manifestWithLockMissing = await expectCliJson<typeof manifest>(workspaceRoot, ['artifacts', '--json']);
    const lockMissingDiagnostics: CiArtifactMissingEntry[] = [
      {
        path: 'generated/missing-diagnostic.json',
        reason: CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing,
        declaredBy: 'graph.lock.json'
      }
    ];
    expect(manifestWithLockMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithLockMissing.summary.uploadGroupCount).toBe(manifestWithLockMissing.uploadGroups.length);
    expect(manifestWithLockMissing.summary.missingCount).toBe(2);
    expect(manifestWithLockMissing.summary.missingReasonTypeCount).toBe(2);
    expect(manifestWithLockMissing.summary.missingReasonCounts).toEqual(buildArtifactMissingReasonCounts({
      [CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing]: 1,
      [CI_ARTIFACT_MISSING_REASON.fixedViewMissing]: 1
    }));
    expect(manifestWithLockMissing.missing).toEqual([...overviewMissingDiagnostics, ...lockMissingDiagnostics]);

    const explainWithMissingPayload = await expectCliJson<{
      e2eMatrix: {
        rows: Array<{ stage: string; evidenceCount: number; evidence: string[] }>;
      };
      reviewSummary: {
        artifactSummary?: ReviewArtifactSummary;
      };
    }>(workspaceRoot, ['explain', '--json']);
    await fs.rm(overviewViewPath, { force: true });
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(
      manifestWithLockMissing.uploadGroups
    );
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.missingReasonTypeCount).toBe(2);
    expect(explainWithMissingPayload.e2eMatrix.rows.find((row) => row.stage === 'artifacts')).toMatchObject({
      evidenceCount: 4,
      evidence: [
        `total=${manifestWithLockMissing.summary.artifactCount}`,
        'missing=2',
        `uploadGroups=${manifestWithLockMissing.summary.uploadGroupCount}`,
        'missingReasonTypes=2'
      ]
    });
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.missing).toEqual([
      ...overviewMissingDiagnostics,
      ...lockMissingDiagnostics
    ]);

    const testPathsBeforeFixture = await expectCliSuccess(workspaceRoot, ['artifacts', '--paths', '--kind', 'test']);
    expect(testPathsBeforeFixture.stdout === '\n' || testPathsBeforeFixture.stdout === 'project/test-results/**\n').toBe(true);

    await fs.mkdir(path.join(workspaceRoot, 'project', 'test-results'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'project', 'test-results', 'runtime.xml'), '<testsuite />\n', 'utf8');

    await expectCliSuccess(workspaceRoot, ['artifacts', '--paths', '--kind', 'test'], 'project/test-results/**\n');

    const testPathsJson = await expectCliJson<ArtifactPathsPayload>(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'test'
    ]);
    expectArtifactPathsPayload(testPathsJson, {
      kind: 'test',
      exact: true,
      artifactStatus: 'attention',
      paths: ['project/test-results/**'],
      byKind: { test: 1 },
      uploadGroups: [buildArtifactUploadGroup('test', 1, ['project/test-results/**'])],
      missingReasonTypeCount: 2,
      missingReasonCounts: buildArtifactMissingReasonCounts({
        [CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing]: 1,
        [CI_ARTIFACT_MISSING_REASON.fixedViewMissing]: 1
      }),
      missing: [...overviewMissingDiagnostics, ...lockMissingDiagnostics]
    });

    const testManifest = await expectCliJson<typeof manifest>(workspaceRoot, ['artifacts', '--json']);
    expect(testManifest.summary.testCount).toBe(1);
    expectUploadGroup(testManifest.uploadGroups, 'test', [CI_ARTIFACT_FILES.testResults]);

    const refreshedReviewSummary = await readJson<{
      artifactSummary?: ReviewArtifactSummary;
    }>(reviewSummaryPath);
    expect(refreshedReviewSummary.artifactSummary).toMatchObject({
      testCount: 1,
      missingCount: 2,
      missingReasonTypeCount: 2
    });
    expectUploadGroup(
      refreshedReviewSummary.artifactSummary?.uploadGroups,
      'test',
      [CI_ARTIFACT_FILES.testResults]
    );

    const refreshedSourceView = await fs.readFile(sourceViewPath, 'utf8');
    expectContainsAll(refreshedSourceView, [
      '<td>Contract Artifacts</td><td>1</td>',
      `<td>Upload Groups</td><td>${testManifest.summary.uploadGroupCount}</td>`,
      `<td>Missing Reason Types</td><td>${testManifest.summary.missingReasonTypeCount}</td>`,
      '<td>contract</td>',
      'generated/postgres-contract.json',
      '<td>Test Artifacts</td><td>1</td>',
      '<td>test</td>',
      CI_ARTIFACT_FILES.testResults
    ]);

    await fs.rm(path.join(workspaceRoot, 'control', 'evidence', 'policy-report.json'));
    await fs.rm(sourceViewPath);
    console.log('DEBUG: overviewViewPath exists before artifacts at 630:', await pathExists(overviewViewPath));

    await fs.rm(overviewViewPath, { force: true });
    const manifestWithMissing = await expectCliJson<typeof manifest>(workspaceRoot, ['artifacts', '--json']);
    const fixedMissingDiagnostics = [
      {
        path: CI_ARTIFACT_FILES.policyReport,
        reason: CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing,
        declaredBy: 'artifact-manifest'
      },
      {
        path: CI_ARTIFACT_FILES.overviewView,
        reason: CI_ARTIFACT_MISSING_REASON.fixedViewMissing,
        declaredBy: 'artifact-manifest'
      },
      {
        path: CI_ARTIFACT_FILES.sourceView,
        reason: CI_ARTIFACT_MISSING_REASON.fixedViewMissing,
        declaredBy: 'artifact-manifest'
      },
      ...lockMissingDiagnostics
    ];
    expect(manifestWithMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithMissing.summary.missingCount).toBe(4);
    expect(manifestWithMissing.summary.missingReasonTypeCount).toBe(3);
    expect(manifestWithMissing.summary.missingReasonCounts).toEqual(buildArtifactMissingReasonCounts({
      [CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing]: 1,
      [CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing]: 1,
      [CI_ARTIFACT_MISSING_REASON.fixedViewMissing]: 2
    }));
    expect(manifestWithMissing.missing).toEqual(fixedMissingDiagnostics);

    await expectCliJson(
      workspaceRoot,
      ['artifacts', '--json', '--compact'],
      {
        formatVersion: '1',
        root: 'workspace'
      },
      { compact: true }
    );

    const pathsResult = await expectCliSuccess(workspaceRoot, ['artifacts', '--paths']);
    const uploadPaths = pathsResult.stdout.trim().split('\n');
    expect(uploadPaths).toContain(CI_ARTIFACT_MANIFEST_PATH);
    expect(uploadPaths).toContain(CI_ARTIFACT_FILES.reviewSummary);
    expect(uploadPaths).not.toContain('project/generated/missing-diagnostic.json');
    expect(uploadPaths).not.toContain(CI_ARTIFACT_FILES.overviewView);
    expect(uploadPaths).not.toContain(CI_ARTIFACT_FILES.sourceView);

    const pathsJson = await expectCliJson<ArtifactPathsPayload>(workspaceRoot, ['artifacts', '--paths', '--json']);
    expect(pathsJson.formatVersion).toBe('1');
    expect(pathsJson.root).toBe('workspace');
    expect(pathsJson.kind).toBe('all');
    expect(pathsJson.artifactStatus).toBe('attention');
    expect(pathsJson.count).toBe(uploadPaths.length);
    expect(pathsJson.paths).toEqual(uploadPaths);
    const viewUploadPaths = uploadPaths.filter((pathEntry) => pathEntry.includes('/views/'));
    expect(pathsJson.byKind.view).toBe(viewUploadPaths.length);
    expect(pathsJson.byKind.test).toBe(1);
    expect(Object.values(pathsJson.byKind).reduce((total, count) => total + count, 0)).toBe(
      uploadPaths.length
    );
    expect(pathsJson.uploadGroupCount).toBe(pathsJson.uploadGroups.length);
    expectUploadGroup(pathsJson.uploadGroups, 'test', ['project/test-results/**']);
    expectUploadGroup(pathsJson.uploadGroups, 'view', viewUploadPaths, pathsJson.byKind.view);
    expect(pathsJson.uploadGroups.reduce((total, group) => total + group.count, 0)).toBe(
      uploadPaths.length
    );
    expect(pathsJson.missingCount).toBe(fixedMissingDiagnostics.length);
    expect(pathsJson.missingReasonTypeCount).toBe(3);
    expect(pathsJson.missingReasonCounts).toEqual(buildArtifactMissingReasonCounts({
      [CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing]: 1,
      [CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing]: 1,
      [CI_ARTIFACT_MISSING_REASON.fixedViewMissing]: 2
    }));
    expect(pathsJson.missing).toEqual(fixedMissingDiagnostics);

    const governancePathsResult = await expectCliSuccess(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']);
    const governanceUploadPaths = governancePathsResult.stdout.trim().split('\n');
    expect(governanceUploadPaths).toContain(CI_ARTIFACT_MANIFEST_PATH);
    expect(governanceUploadPaths).toContain(CI_ARTIFACT_FILES.reviewSummary);
    expect(governanceUploadPaths).not.toContain(CI_ARTIFACT_FILES.slotRuleView);

    const viewPathsJson = await expectCliJson<ArtifactPathsPayload>(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'view'
    ]);
    const expectedAvailableViewPaths = CI_ARTIFACT_PATHS.view
      .filter((viewPath) => viewPath !== CI_ARTIFACT_FILES.overviewView && viewPath !== CI_ARTIFACT_FILES.sourceView)
      .sort();
    expectArtifactPathsPayload(viewPathsJson, {
      kind: 'view',
      paths: expectedAvailableViewPaths,
      byKind: { view: expectedAvailableViewPaths.length },
      uploadGroups: [buildArtifactUploadGroup('view', expectedAvailableViewPaths.length, expectedAvailableViewPaths)]
    });
    expect(viewPathsJson.paths).not.toContain(CI_ARTIFACT_MANIFEST_PATH);

  });
}, 120000);
