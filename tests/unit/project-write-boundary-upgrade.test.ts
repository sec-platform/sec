import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  createUpgradePlan,
  parseUpgradeDiagnosticsJson,
  parseUpgradePlanJson,
  UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
  UPGRADE_PLAN_FORMAT_VERSION,
  UpgradeContractError,
  upgradeDiagnosticsDigest,
  upgradePlanDigest,
  type UpgradePlan
} from '../../src/change-management/upgrade/contract/upgrade-artifact.ts';
import { readReviewGovernanceReports } from '../../src/adapters/compilation/emit/read-review-governance-reports.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { checkProjectWriteBoundary } from '../../src/adapters/workspace/project-write-boundary.ts';
import { writeJson, writeText } from "../../src/adapters/filesystem/files.ts";
import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease
} from '../../src/adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { writeProjectBaseline } from '../../src/adapters/workspace/project-baseline.ts';
import {
  projectProjectWriteAuthorization,
  ProjectWriteAuthorizationError,
  withProjectWriteAuthorization,
  type ProjectWriteAuthorization
} from '../../src/adapters/workspace/project-write-authorization.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function baselinePathInput(paths: string[]) {
  return {
    artifactPaths: paths
  };
}

function plannedUpgrade(impacts: string[]): UpgradePlan {
  return createUpgradePlan({
    workspaceIdentityDigest: sha256({ fixture: 'workspace' }) as `sha256:${string}`,
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    planningInputRevision: sha256({ fixture: 'planning-input', impacts }) as `sha256:${string}`,
    sourceRevision: sha256({ fixture: 'source' }) as `sha256:${string}`,
    lockRevision: sha256({ fixture: 'lock' }) as `sha256:${string}`,
    compatibility: { blockApi: '1', compilerApi: '1', stackProfiles: ['typescript-library'] },
    preflightChecks: [],
    impacts,
    migrations: [],
    migrationKindCounts: {},
    migrationSummaries: [],
    migrationOperations: [],
    orderedSteps: []
  });
}

test('change-management authorizes only the UpgradePlan impact scope', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const upgradePlanPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.upgradePlan);
    const allowedPath = 'src/ui/page.ts';
    const deniedPath = 'src/ui/other.ts';
    const allowedAbsolute = path.join(root, allowedPath);
    const deniedAbsolute = path.join(root, deniedPath);

    await writeText(allowedAbsolute, 'export const allowed = 1;\n');
    await writeText(deniedAbsolute, 'export const denied = 1;\n');
    await writeProjectBaseline(workspaceRoot, baselinePathInput([allowedPath, deniedPath]));
    const upgradePlan = plannedUpgrade([allowedPath]);
    await writeJson(upgradePlanPath, upgradePlan);

    await withWorkspaceWriteLease(workspaceRoot, undefined, async (token) => {
      const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
      await withProjectWriteAuthorization(
        {
          workspaceRoot,
          operation: 'change.upgrade',
          impactPaths: upgradePlan.impacts,
          beforeCommit: commitFence
        },
        async () => {
        await writeText(allowedAbsolute, 'export const allowed = 2;\n');
        await checkProjectWriteBoundary(workspaceRoot);

        await writeText(deniedAbsolute, 'export const denied = 2;\n');
        await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
          code: 'ERROR-DRIFT-001',
          details: { path: deniedPath }
        });
        }
      );
    });
  }, 'engineering-compiler-upgrade-write-boundary-');
});

test('project write authorizations are origin, root, operation, scope, and lifetime bound', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const plan = plannedUpgrade(['src/ui/page.ts']);
    let settledAuthorization: ProjectWriteAuthorization | null = null;
    let upgradeScopeDigest: string | null = null;

    await withProjectWriteAuthorization({
      workspaceRoot,
      operation: 'change.upgrade',
      impactPaths: plan.impacts
    }, async (authorization) => {
      settledAuthorization = authorization;
      const projection = projectProjectWriteAuthorization(workspaceRoot, authorization);
      upgradeScopeDigest = projection.scopeDigest;
      expect(projection).toMatchObject({
        operation: 'change.upgrade',
        impactPaths: ['src/ui/page.ts']
      });
      expect(() => projectProjectWriteAuthorization(path.join(workspaceRoot, 'other'), authorization))
        .toThrow(ProjectWriteAuthorizationError);
      await expect(withProjectWriteAuthorization({
        workspaceRoot,
        operation: 'change.upgrade',
        impactPaths: plan.impacts
      }, async () => undefined)).rejects.toMatchObject({ kind: 'concurrent-authorization' });
    });

    await withProjectWriteAuthorization({
      workspaceRoot,
      operation: 'change.repair',
      impactPaths: plan.impacts
    }, async (authorization) => {
      expect(projectProjectWriteAuthorization(workspaceRoot, authorization).scopeDigest)
        .not.toBe(upgradeScopeDigest);
    });

    expect(() => projectProjectWriteAuthorization(workspaceRoot, settledAuthorization!))
      .toThrow(ProjectWriteAuthorizationError);
    expect(() => projectProjectWriteAuthorization(
      workspaceRoot,
      Object.freeze({}) as ProjectWriteAuthorization
    )).toThrow(ProjectWriteAuthorizationError);
  }, 'engineering-workspace-project-write-authorization-');
});

test('upgrade durable contracts reject ambiguous JSON and unbound authority', () => {
  const plan = plannedUpgrade(['src/ui/page.ts']);
  expect(parseUpgradePlanJson(JSON.stringify(plan))).toMatchObject({
    formatVersion: UPGRADE_PLAN_FORMAT_VERSION,
    blockId: 'auth/basic-session',
    impacts: ['src/ui/page.ts']
  });
  expect(upgradePlanDigest(plan)).toBe(plan.planRevision);
  expect(() => upgradePlanDigest({ ...plan, impacts: ['src/ui/other.ts'] })).toThrow();

  const expectFailure = (
    operation: () => unknown,
    kind: UpgradeContractError['kind']
  ): void => {
    try {
      operation();
      throw new Error('expected upgrade contract rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeContractError);
      expect(error).toMatchObject({ kind });
    }
  };

  expectFailure(
    () => parseUpgradePlanJson(
      `{"formatVersion":"${UPGRADE_PLAN_FORMAT_VERSION}","formatVersion":"${UPGRADE_PLAN_FORMAT_VERSION}"}`
    ),
    'duplicate-key'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, formatVersion: 'future' })),
    'schema'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, unsupportedField: true })),
    'schema'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, impacts: ['../outside'] })),
    'status-impact'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, blockId: '../foreign' })),
    'provenance'
  );

  const diagnostics = {
    formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
    artifactKind: 'upgrade-diagnostics',
    status: 'blocked',
    phase: 'planning',
    workspaceIdentityDigest: plan.workspaceIdentityDigest,
    planningRequestRevision: sha256({ fixture: 'planning-request' }) as `sha256:${string}`,
    blockId: 'auth/basic-session',
    targetVersion: '0.1.1',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'target is missing'
  };
  expect(parseUpgradeDiagnosticsJson(JSON.stringify(diagnostics))).toMatchObject(diagnostics);
  expect(upgradeDiagnosticsDigest(diagnostics)).not.toBe(upgradeDiagnosticsDigest({
    ...diagnostics,
    errorCode: 'UPGRADE-MIGRATION-OTHER'
  }));
  expectFailure(
    () => parseUpgradeDiagnosticsJson(
      `{"formatVersion":"${UPGRADE_DIAGNOSTICS_FORMAT_VERSION}","formatVersion":"${UPGRADE_DIAGNOSTICS_FORMAT_VERSION}"}`
    ),
    'duplicate-key'
  );
  expectFailure(
    () => parseUpgradeDiagnosticsJson(JSON.stringify({ ...diagnostics, unsupportedField: true })),
    'schema'
  );
  expectFailure(
    () => parseUpgradeDiagnosticsJson(JSON.stringify({ ...diagnostics, blockId: '../foreign' })),
    'provenance'
  );
});

test('review governance rejects ambiguous persisted upgrade artifacts before object parsing', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    await fs.mkdir(path.dirname(upgradePlanPath), { recursive: true });
    await fs.writeFile(
      upgradePlanPath,
      `{"formatVersion":"${UPGRADE_PLAN_FORMAT_VERSION}","formatVersion":"${UPGRADE_PLAN_FORMAT_VERSION}"}`,
      'utf8'
    );

    expect(() => readReviewGovernanceReports(workspaceRoot)).toThrow(/duplicate.*key/iu);
  }, 'engineering-compiler-upgrade-review-reader-');
});

test('review governance rejects upgrade artifacts from different operations', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeDiagnostics
    );
    await writeJson(upgradePlanPath, plannedUpgrade(['src/ui/page.ts']));
    await writeJson(upgradeDiagnosticsPath, {
      formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
      artifactKind: 'upgrade-diagnostics',
      status: 'blocked',
      phase: 'planning',
      workspaceIdentityDigest: sha256({ fixture: 'other-workspace' }),
      planningRequestRevision: sha256({ fixture: 'other-planning-request' }),
      blockId: 'ticket/basic',
      targetVersion: '0.2.0',
      failedCheck: 'migration-targets',
      errorCode: 'UPGRADE-MIGRATION-004',
      message: 'target is missing'
    });

    try {
      readReviewGovernanceReports(workspaceRoot);
      throw new Error('expected upgrade artifact provenance rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeContractError);
      expect(error).toMatchObject({ contract: 'diagnostics', kind: 'provenance' });
    }
  }, 'engineering-compiler-upgrade-review-provenance-');
});
