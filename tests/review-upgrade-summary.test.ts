import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildReviewSummary } from '../platform/compiler/emit/write-review-summary.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  RepairPlan,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../platform/shared/types.ts';

function buildPassingReport(): VerificationReport {
  return {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'passed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: '' }
    },
    runtime: {
      status: 'skipped',
      build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
      unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
      logs: { stdout: '', stderr: '' }
    },
    summary: {
      status: 'passed',
      requestedLane: 'fast',
      failedLanes: []
    },
    logs: { stdout: '', stderr: '' }
  };
}

function buildPassingCoverage(): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };
}

test('review summary surfaces pending upgrade plans without running upgrade e2e', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-review-upgrade-'));
  try {
    const { repairPlanPath, upgradeDiagnosticsPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [{
        id: 'auth/basic-session',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      }],
      resolvedCapabilities: ['auth/session'],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'skipped',
        lock: 'succeeded',
        emit: 'succeeded'
      }
    };
    const provenance: ProvenanceFile = {
      formatVersion: '1',
      artifacts: []
    };
    const report: VerificationReport = {
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      fast: {
        status: 'passed',
        build: { status: 'passed' },
        unit: { status: 'passed', passed: [] },
        acceptance: { status: 'passed', passed: [], failed: [] },
        policy: { status: 'passed', violations: [] },
        logs: { stdout: '', stderr: '' }
      },
      runtime: {
        status: 'skipped',
        build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
        unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
        acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
        logs: { stdout: '', stderr: '' }
      },
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      logs: { stdout: '', stderr: '' }
    };
    const coverage: AcceptanceCoverageReport = {
      formatVersion: '1',
      status: 'passed',
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    };
    const upgradePlan: UpgradePlan = {
      formatVersion: '1',
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      status: 'planned',
      preflightChecks: [
        {
          id: 'version-range',
          status: 'passed',
          message: 'Upgrade path 0.1.0 -> 0.1.1 is allowed',
          evidence: ['0.1.x']
        },
        {
          id: 'migration-entries',
          status: 'passed',
          message: '1 migration entries loaded and validated',
          evidence: ['mig-auth-session-refresh:migrations/auth-session-refresh.json']
        },
        {
          id: 'migration-targets',
          status: 'passed',
          message: '1 migration paths checked',
          evidence: ['mig-auth-session-refresh:target:src/installed/auth/session.ts:exists']
        },
        {
          id: 'migration-file-operations',
          status: 'passed',
          message: '1 file operations checked',
          evidence: ['mig-auth-session-refresh:manifest-source:exists']
        },
        {
          id: 'migration-json-shapes',
          status: 'passed',
          message: '0 JSON migration shapes checked',
          evidence: []
        },
        {
          id: 'migration-json-structure',
          status: 'passed',
          message: '0 JSON migration targets checked',
          evidence: []
        },
        {
          id: 'migration-text-patterns',
          status: 'passed',
          message: '0 text replacement patterns checked',
          evidence: []
        },
        {
          id: 'migration-slot-contracts',
          status: 'passed',
          message: '0 slot contract fields checked',
          evidence: []
        },
        {
          id: 'impact-scan',
          status: 'passed',
          message: '1 upgrade impacts calculated',
          evidence: ['src/installed/auth/session.ts']
        },
        {
          id: 'override-conflicts',
          status: 'passed',
          message: '0 overrides scanned with no conflicts',
          evidence: []
        }
      ],
      impacts: ['src/installed/auth/session.ts'],
      migrations: [
        {
          id: 'mig-auth-session-refresh',
          kind: 'file-replace',
          entry: 'migrations/auth-session-refresh.json',
          requiresVerification: true
        }
      ],
      migrationKindCounts: {
        'file-replace': 1
      },
      migrationSummaries: [
        {
          id: 'mig-auth-session-refresh',
          kind: 'file-replace',
          target: 'src/installed/auth/session.ts',
          reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
          requiresVerification: true,
          source: 'files/src/installed/auth/session.ts'
        }
      ],
      migrationOperations: [
        {
          id: 'mig-auth-session-refresh',
          kind: 'file-replace',
          target: 'src/installed/auth/session.ts',
          role: 'file',
          source: 'files/src/installed/auth/session.ts'
        }
      ]
    };
    const upgradeDiagnostics: UpgradeDiagnostics = {
      formatVersion: '1',
      status: 'blocked',
      phase: 'planning',
      blockId: 'auth/basic-session',
      targetVersion: '0.1.1',
      failedCheck: 'override-conflicts',
      errorCode: 'UPGRADE-CONFLICT-001',
      message: 'Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"',
      details: {
        failedCheck: 'override-conflicts',
        overrideId: 'manual-auth-session-hotfix'
      }
    };
    const repairPlan: RepairPlan = {
      formatVersion: '1',
      status: 'pending',
      sourceVerificationStatus: 'failed',
      requiresVerification: false,
      tasks: [
        {
          taskId: 'repair_zeta',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'zeta',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/zeta.ts',
          allowedPaths: ['custom/zeta.ts'],
          requiredSymbols: [],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        },
        {
          taskId: 'repair_alpha',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'alpha',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/alpha.ts',
          allowedPaths: ['custom/alpha.ts'],
          requiredSymbols: [],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        }
      ]
    };
    await writeJson(upgradePlanPath, upgradePlan);
    await writeJson(upgradeDiagnosticsPath, upgradeDiagnostics);
    await writeJson(repairPlanPath, repairPlan);

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(summary.ciSummary.status).toBe('failed');
    expect(summary.ciSummary.failureCount).toBe(1);
    expect(summary.ciSummary.regressionRiskCount).toBeGreaterThanOrEqual(2);
    expect(summary.ciSummary.conflictHintCount).toBe(4);
    expect(summary.upgradeSummary).toMatchObject({
      status: 'blocked',
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      preflightCheckCount: 10,
      preflightEvidenceCount: 5,
      migrationCount: 1,
      migrationKindCounts: {
        'file-replace': 1
      },
      requiresVerification: true,
      requiresVerificationCount: 1,
      impactCount: 1,
      impacts: ['src/installed/auth/session.ts'],
      diagnostics: {
        status: 'blocked',
        phase: 'planning',
        failedCheck: 'override-conflicts',
        errorCode: 'UPGRADE-CONFLICT-001',
        message: 'Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"',
        details: {
          failedCheck: 'override-conflicts',
          overrideId: 'manual-auth-session-hotfix'
        }
      }
    });
    expect(summary.upgradeSummary?.preflightSummaries).toEqual([
      {
        group: 'impact',
        checkCount: 1,
        evidenceCount: 1
      },
      {
        group: 'migration',
        checkCount: 7,
        evidenceCount: 3
      },
      {
        group: 'override',
        checkCount: 1,
        evidenceCount: 0
      },
      {
        group: 'version',
        checkCount: 1,
        evidenceCount: 1
      }
    ]);
    expect(summary.upgradeSummary?.migrationSummaries).toEqual([
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        source: 'files/src/installed/auth/session.ts',
        target: 'src/installed/auth/session.ts',
        reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
        requiresVerification: true
      }
    ]);
    expect(summary.conflictHints).toEqual([
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_alpha',
        message: 'Repair task pending: repair_alpha -> custom/alpha.ts'
      },
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_zeta',
        message: 'Repair task pending: repair_zeta -> custom/zeta.ts'
      },
      {
        kind: 'upgrade-plan-present',
        relatedId: 'auth/basic-session',
        message: 'Upgrade plan present: auth/basic-session 0.1.0 -> 0.1.1'
      },
      {
        kind: 'upgrade-preflight-passed',
        relatedId: 'auth/basic-session',
        message: 'Upgrade preflight passed: version-range, migration-entries, migration-targets, migration-file-operations, migration-json-shapes, migration-json-structure, migration-text-patterns, migration-slot-contracts, impact-scan, override-conflicts'
      }
    ]);
    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: 'generated/upgrade-diagnostics.json',
      message: 'Upgrade blocked at override-conflicts: UPGRADE-CONFLICT-001 Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"'
    });
    expect(summary.regressionRisks).toContainEqual({
      kind: 'upgrade-impact',
      blockId: 'auth/basic-session',
      message: 'Upgrade auth/basic-session impacts src/installed/auth/session.ts'
    });
    expect(summary.regressionRisks).toContainEqual({
      kind: 'upgrade-verification',
      blockId: 'auth/basic-session',
      message: 'Upgrade migration mig-auth-session-refresh requires verification for src/installed/auth/session.ts'
    });

    upgradePlan.status = 'applied';
    await writeJson(upgradePlanPath, upgradePlan);

    const appliedSummary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(appliedSummary.upgradeSummary).toMatchObject({
      status: 'blocked',
      blockId: 'auth/basic-session',
      requiresVerification: true,
      requiresVerificationCount: 1,
      diagnostics: {
        phase: 'planning',
        failedCheck: 'override-conflicts',
        errorCode: 'UPGRADE-CONFLICT-001'
      }
    });
    expect(appliedSummary.conflictHints).toEqual(
      expect.arrayContaining([
        {
          kind: 'upgrade-plan-present',
          relatedId: 'auth/basic-session',
          message: 'Upgrade plan applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
        }
      ])
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('review summary preserves upgrade diagnostics details without an upgrade plan', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-review-upgrade-diagnostics-'));
  try {
    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'skipped',
        lock: 'succeeded',
        emit: 'succeeded'
      }
    };
    const diagnostics: UpgradeDiagnostics = {
      formatVersion: '1',
      status: 'blocked',
      phase: 'planning',
      blockId: 'private/slot-contract',
      targetVersion: '0.2.0',
      failedCheck: 'migration-targets',
      errorCode: 'UPGRADE-MIGRATION-004',
      message: 'Migration path "../outside-project.md" escapes project root',
      details: {
        failedCheck: 'migration-targets',
        migrationId: 'mig-target-escape',
        path: '../outside-project.md',
        role: 'target',
        root: 'project'
      }
    };

    await writeJson(upgradeDiagnosticsPath, diagnostics);

    const summary = await buildReviewSummary(
      workspaceRoot,
      lock,
      { formatVersion: '1', artifacts: [] },
      buildPassingReport(),
      buildPassingCoverage()
    );

    expect(summary.upgradeSummary).toMatchObject({
      status: 'blocked',
      blockId: 'private/slot-contract',
      toVersion: '0.2.0',
      diagnostics: {
        phase: 'planning',
        failedCheck: 'migration-targets',
        errorCode: 'UPGRADE-MIGRATION-004',
        details: {
          migrationId: 'mig-target-escape',
          path: '../outside-project.md',
          role: 'target',
          root: 'project'
        }
      }
    });
    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: 'generated/upgrade-diagnostics.json',
      message: 'Upgrade blocked at migration-targets: UPGRADE-MIGRATION-004 Migration path "../outside-project.md" escapes project root; migration=mig-target-escape; target=../outside-project.md'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('review summary includes entry migration attribution in upgrade failure points', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-review-upgrade-entry-diagnostics-'));
  try {
    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    const diagnostics: UpgradeDiagnostics = {
      formatVersion: '1',
      status: 'blocked',
      phase: 'planning',
      blockId: 'private/slot-contract',
      targetVersion: '0.2.0',
      failedCheck: 'migration-entries',
      errorCode: 'UPGRADE-MIGRATION-003',
      message: 'Migration entry "migrations/mismatched-entry.json" does not match manifest metadata',
      details: {
        migrationId: 'mig-expected-entry',
        migrationKind: 'text-append',
        entry: 'migrations/mismatched-entry.json',
        entryId: 'mig-actual-entry',
        entryKind: 'text-replace'
      }
    };

    await writeJson(upgradeDiagnosticsPath, diagnostics);

    const summary = await buildReviewSummary(
      workspaceRoot,
      {
        formatVersion: '1',
        app: {
          name: 'customer-admin',
          stack: 'nextjs-ts-prisma-sqlite',
          mode: 'single-tenant'
        },
        resolvedBlocks: [],
        resolvedCapabilities: [],
        installPlan: [],
        slotTasks: [],
        generatedPaths: [],
        acceptancePlan: [],
        passStatus: {
          parse: 'succeeded',
          align: 'succeeded',
          resolve: 'succeeded',
          compose: 'succeeded',
          adapt: 'succeeded',
          verify: 'succeeded',
          repair: 'skipped',
          lock: 'succeeded',
          emit: 'succeeded'
        }
      },
      { formatVersion: '1', artifacts: [] },
      buildPassingReport(),
      buildPassingCoverage()
    );

    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: 'generated/upgrade-diagnostics.json',
      message: 'Upgrade blocked at migration-entries: UPGRADE-MIGRATION-003 Migration entry "migrations/mismatched-entry.json" does not match manifest metadata; migration=mig-expected-entry; kind=text-append; entry=migrations/mismatched-entry.json; entryId=mig-actual-entry; entryKind=text-replace'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('review summary includes apply migration attribution in upgrade failure points', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-review-upgrade-apply-diagnostics-'));
  try {
    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    const diagnostics: UpgradeDiagnostics = {
      formatVersion: '1',
      status: 'blocked',
      phase: 'apply',
      blockId: 'private/slot-contract',
      targetVersion: '0.2.0',
      failedCheck: 'migration-file-operations',
      errorCode: 'UPGRADE-MIGRATION-016',
      message: 'slot-contract-update target "custom/customer_normalizer.ts" is missing',
      details: {
        migrationId: 'mig-customer-normalizer-contract',
        migrationKind: 'slot-contract-update',
        slotId: 'customer_normalizer',
        target: 'custom/customer_normalizer.ts',
        rollbackStatus: 'restored'
      }
    };

    await writeJson(upgradeDiagnosticsPath, diagnostics);

    const summary = await buildReviewSummary(
      workspaceRoot,
      {
        formatVersion: '1',
        app: {
          name: 'customer-admin',
          stack: 'nextjs-ts-prisma-sqlite',
          mode: 'single-tenant'
        },
        resolvedBlocks: [],
        resolvedCapabilities: [],
        installPlan: [],
        slotTasks: [],
        generatedPaths: [],
        acceptancePlan: [],
        passStatus: {
          parse: 'succeeded',
          align: 'succeeded',
          resolve: 'succeeded',
          compose: 'succeeded',
          adapt: 'succeeded',
          verify: 'succeeded',
          repair: 'skipped',
          lock: 'succeeded',
          emit: 'succeeded'
        }
      },
      { formatVersion: '1', artifacts: [] },
      buildPassingReport(),
      buildPassingCoverage()
    );

    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: 'generated/upgrade-diagnostics.json',
      message: 'Upgrade blocked at migration-file-operations: UPGRADE-MIGRATION-016 slot-contract-update target "custom/customer_normalizer.ts" is missing; migration=mig-customer-normalizer-contract; kind=slot-contract-update; target=custom/customer_normalizer.ts; slot=customer_normalizer; rollback=restored'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
