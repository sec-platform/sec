import {
  createUpgradeExecutionAttempt,
  createUpgradeExecutionTerminal,
  createUpgradePlan,
  UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
  upgradeArtifactDigest,
  validateUpgradeDiagnostics,
  type UpgradeDiagnostics,
  type UpgradeExecutionTerminal,
  type UpgradePlan,
  type UpgradePlanInput
} from '../../src/change-management/upgrade/contract/upgrade-artifact.ts';

export function buildUpgradeDiagnostics(options: Partial<UpgradeDiagnostics> = {}): UpgradeDiagnostics {
  return validateUpgradeDiagnostics({
    formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
    artifactKind: 'upgrade-diagnostics',
    status: 'blocked',
    phase: 'planning',
    workspaceIdentityDigest: upgradeArtifactDigest({ fixture: 'upgrade-workspace' }),
    planningRequestRevision: upgradeArtifactDigest({ fixture: 'upgrade-planning-request' }),
    blockId: 'private/block-upgrade',
    targetVersion: '0.2.0',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'Migration path "../outside-project.md" escapes project root',
    ...options
  });
}

export function buildUpgradePlanArtifact(options: Partial<UpgradePlanInput> = {}): UpgradePlan {
  const defaultMigrationOperations: UpgradePlan['migrationOperations'] = [
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      role: 'file',
      source: 'files/src/installed/auth/session.ts'
    }
  ];
  const migrationOperations = options.migrationOperations ?? defaultMigrationOperations;
  return createUpgradePlan({
    workspaceIdentityDigest: upgradeArtifactDigest({ fixture: 'upgrade-workspace' }),
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    planningInputRevision: upgradeArtifactDigest({ fixture: 'upgrade-planning-input' }),
    sourceRevision: upgradeArtifactDigest({ fixture: 'upgrade-source' }),
    lockRevision: upgradeArtifactDigest({ fixture: 'upgrade-lock' }),
    compatibility: { blockApi: '1', compilerApi: '1', stackProfiles: ['typescript-library'] },
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
    ...options,
    migrationOperations,
    orderedSteps: migrationOperations.map((operation, ordinal) => ({
      ordinal,
      migrationId: operation.id,
      kind: operation.kind,
      target: operation.target,
      operationRevision: upgradeArtifactDigest(operation)
    }))
  });
}

export function buildUpgradeExecutionTerminalArtifact(
  plan: UpgradePlan,
  options: { settlement?: UpgradeExecutionTerminal['settlement'] } = {}
): UpgradeExecutionTerminal {
  const settlement = options.settlement ?? 'applied';
  return createUpgradeExecutionTerminal({
    workspaceIdentityDigest: plan.workspaceIdentityDigest,
    operationIdentityDigest: plan.operationIdentityDigest,
    planRevision: plan.planRevision,
    attempt: createUpgradeExecutionAttempt({
      leaseGeneration: 1,
      leaseId: 'fixture-upgrade-lease',
      ownerFileIdentityDigest: 'fixture-owner-file'
    }),
    receipts: {
      workspacePlanRevision: upgradeArtifactDigest({ fixture: 'applied-workspace-plan' }),
      resultLockRevision: upgradeArtifactDigest({ fixture: 'applied-lock' }),
      planArtifactRevision: plan.planRevision
    },
    settlement,
    readback: {
      workspaceBlockVersion: settlement === 'applied' ? plan.toVersion : plan.fromVersion,
      resolvedBlockVersion: settlement === 'applied' ? plan.toVersion : plan.fromVersion
    }
  });
}

export function buildUpgradeExecutionDiagnostics(
  plan: UpgradePlan,
  terminal: UpgradeExecutionTerminal,
  options: Partial<UpgradeDiagnostics> = {}
): UpgradeDiagnostics {
  return validateUpgradeDiagnostics({
    formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
    artifactKind: 'upgrade-diagnostics',
    status: 'blocked',
    phase: 'apply',
    workspaceIdentityDigest: plan.workspaceIdentityDigest,
    operationIdentityDigest: plan.operationIdentityDigest,
    planRevision: plan.planRevision,
    attemptRevision: terminal.attempt.attemptRevision,
    executionTerminalRevision: terminal.terminalRevision,
    blockId: plan.blockId,
    targetVersion: plan.toVersion,
    failedCheck: 'migration-file-operations',
    errorCode: 'UPGRADE-MIGRATION-016',
    message: 'Upgrade apply failed and rollback restored the source version',
    ...options
  });
}
