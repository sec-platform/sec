import type { UpgradeDiagnostics, UpgradePlan } from '../../platform/shared/types.ts';

export function buildUpgradeDiagnostics(options: Partial<UpgradeDiagnostics> = {}): UpgradeDiagnostics {
  return {
    formatVersion: '1',
    status: 'blocked',
    phase: 'planning',
    blockId: 'private/slot-contract',
    targetVersion: '0.2.0',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'Migration path "../outside-project.md" escapes project root',
    ...options
  };
}

export function buildUpgradePlanArtifact(options: Partial<UpgradePlan> = {}): UpgradePlan {
  const base: UpgradePlan = {
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

  return { ...base, ...options };
}
