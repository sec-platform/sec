import { uniqueSorted } from '../../contracts/canonical.ts';
import { CompilerError } from '../errors.ts';
import { migrationManifestDetails } from './failure.ts';
import type { LockFile, PlanFile, UpgradeMigration } from '../contract.ts';
import type { UpgradeMigrationEntry } from '../../semantics/upgrade/manifest-types.ts';
import {
  createUpgradePreview,
  upgradeArtifactDigest,
  type UpgradeDiagnostics,
  type UpgradePlan,
  type UpgradePreflightCheck,
  type UpgradePreview
} from '../../semantics/upgrade/upgrade-artifact.ts';
import {
  compileUpgradeMigrationOperation,
  compileUpgradeMigrationProjectPaths
} from './migration-rules.ts';

export type UpgradeVersionRangeMatcher = (
  version: string,
  range: string
) => boolean;

export function assertUpgradeAllowed(
  currentVersion: string,
  targetVersion: string,
  migrations: UpgradeMigration[],
  acceptedRanges: string[],
  matchesVersionRange: UpgradeVersionRangeMatcher
): void {
  if (currentVersion === targetVersion) {
    throw new CompilerError(
      'UPGRADE-NOOP-001',
      `Block is already at version "${targetVersion}"`
    );
  }
  if (acceptedRanges.length === 0) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-001',
      `Target version "${targetVersion}" does not support automatic upgrade`
    );
  }
  if (!acceptedRanges.some((range) => matchesVersionRange(currentVersion, range))) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-002',
      `Target version "${targetVersion}" does not accept upgrade from "${currentVersion}"`
    );
  }
  for (const migration of migrations) {
    if (!migration.entry) {
      throw new CompilerError(
        'UPGRADE-MIGRATION-001',
        `Migration "${migration.id}" is missing entry`,
        migrationManifestDetails(migration)
      );
    }
  }
}

export function collectJsonShapeEvidence(migrationEntries: UpgradeMigrationEntry[]): string[] {
  return uniqueSorted(migrationEntries.flatMap((entry) => {
    const operation = compileUpgradeMigrationOperation(entry);
    const path = operation.path?.join('.');
    return operation.role !== 'json' ? []
      : operation.updateCount !== undefined ? [`${entry.id}:updates:${operation.updateCount}`]
      : operation.itemCount !== undefined && path ? [`${entry.id}:path:${path}:array:${operation.itemCount}`]
      : operation.valueKeyCount !== undefined && path ? [`${entry.id}:path:${path}:object:${operation.valueKeyCount}`]
      : [];
  }));
}


export type UpgradePreflightEvidence = {
  fileOperationEvidence: string[];
  jsonShapeEvidence: string[];
  jsonStructureEvidence: string[];
  migrationTargetEvidence: string[];
  scannedOverrides: string[];
  textPatternEvidence: string[];
};

type UpgradePreflightCheckInput = {
  acceptedRanges: string[];
  currentVersion: string;
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  migrations: UpgradeMigration[];
  targetVersion: string;
  evidence: UpgradePreflightEvidence;
};

type UpgradePreflightCheckSpec = {
  id: UpgradePreflightCheck['id'];
  message: (input: UpgradePreflightCheckInput) => string;
  evidence: (input: UpgradePreflightCheckInput) => string[];
};

const UPGRADE_PREFLIGHT_CHECK_SPECS = [
  {
    id: 'version-range',
    message: ({ currentVersion, targetVersion }) => `Upgrade path ${currentVersion} -> ${targetVersion} is allowed`,
    evidence: ({ acceptedRanges }) => acceptedRanges
  },
  {
    id: 'migration-entries',
    message: ({ migrationEntries }) => `${migrationEntries.length} migration entries loaded and validated`,
    evidence: ({ migrations }) => migrations.map((migration) => `${migration.id}:${migration.entry}`)
  },
  {
    id: 'migration-targets',
    message: ({ evidence }) => `${evidence.migrationTargetEvidence.length} migration paths checked`,
    evidence: ({ evidence }) => evidence.migrationTargetEvidence
  },
  {
    id: 'migration-file-operations',
    message: ({ evidence }) => `${evidence.fileOperationEvidence.length} file operations checked`,
    evidence: ({ evidence }) => evidence.fileOperationEvidence
  },
  {
    id: 'migration-json-shapes',
    message: ({ evidence }) => `${evidence.jsonShapeEvidence.length} JSON migration shapes checked`,
    evidence: ({ evidence }) => evidence.jsonShapeEvidence
  },
  {
    id: 'migration-json-structure',
    message: ({ evidence }) => `${evidence.jsonStructureEvidence.length} JSON migration targets checked`,
    evidence: ({ evidence }) => evidence.jsonStructureEvidence
  },
  {
    id: 'migration-text-patterns',
    message: ({ evidence }) => `${evidence.textPatternEvidence.length} text replacement patterns checked`,
    evidence: ({ evidence }) => evidence.textPatternEvidence
  },
  {
    id: 'impact-scan',
    message: ({ impacts }) => `${impacts.length} upgrade impacts calculated`,
    evidence: ({ impacts }) => impacts
  },
  {
    id: 'override-conflicts',
    message: ({ evidence }) => `${evidence.scannedOverrides.length} overrides scanned with no conflicts`,
    evidence: ({ evidence }) => evidence.scannedOverrides
  }
] satisfies readonly UpgradePreflightCheckSpec[];

export function buildUpgradePreflightChecks(input: UpgradePreflightCheckInput): UpgradePreflightCheck[] {
  return UPGRADE_PREFLIGHT_CHECK_SPECS.map((spec) => ({
    id: spec.id,
    status: 'passed',
    message: spec.message(input),
    evidence: spec.evidence(input)
  }));
}

export function collectMigrationImpacts(migrationEntries: UpgradeMigrationEntry[]): string[] {
  return migrationEntries.flatMap((entry) =>
    compileUpgradeMigrationProjectPaths(entry).map(([, relativePath]) => relativePath)
  );
}


export function lockStateRevision(lock: LockFile | null): `sha256:${string}` {
  return upgradeArtifactDigest({ domain: 'sec.upgrade.lock-state', state: lock === null ? 'absent' : 'present', lock });
}

export function planningRequestRevision(input: {
  workspaceIdentityDigest: string;
  blockId: string;
  targetVersion: string;
  plan: PlanFile;
  lock: LockFile | null;
}): `sha256:${string}` {
  return upgradeArtifactDigest({ domain: 'sec.upgrade.planning-request', ...input, lockRevision: lockStateRevision(input.lock) });
}


const PREFLIGHT_FAILURE_BY_ERROR_CODE = new Map<string, UpgradeDiagnostics['failedCheck']>([
  ['UPGRADE-BLOCKED-003', 'plan-block'],
  ['MANIFEST-SCHEMA-004', 'target-manifest'],
  ['UPGRADE-NOOP-001', 'version-range'],
  ['UPGRADE-BLOCKED-001', 'version-range'],
  ['UPGRADE-BLOCKED-002', 'version-range'],
  ['UPGRADE-MIGRATION-004', 'migration-targets'],
  ['UPGRADE-MIGRATION-007', 'migration-targets'],
  ['UPGRADE-MIGRATION-012', 'migration-json-structure'],
  ['UPGRADE-MIGRATION-013', 'migration-json-structure'],
  ['UPGRADE-MIGRATION-030', 'migration-json-structure'],
  ['UPGRADE-MIGRATION-015', 'migration-text-patterns'],
  ['UPGRADE-CONFLICT-001', 'override-conflicts']
]);

const MIGRATION_FILE_OPERATION_FAILURE_CODES = new Set([
  'UPGRADE-MIGRATION-005',
  'UPGRADE-MIGRATION-008',
  'UPGRADE-MIGRATION-016',
  'UPGRADE-MIGRATION-017',
  'UPGRADE-MIGRATION-018',
  'UPGRADE-MIGRATION-019',
  'UPGRADE-MIGRATION-020',
  'UPGRADE-MIGRATION-023',
  'UPGRADE-MIGRATION-024',
  'UPGRADE-MIGRATION-025',
  'UPGRADE-MIGRATION-026',
  'UPGRADE-MIGRATION-027',
  'UPGRADE-MIGRATION-028'
]);

export function classifyPreflightFailure(code: string): UpgradeDiagnostics['failedCheck'] {
  const failedCheck = PREFLIGHT_FAILURE_BY_ERROR_CODE.get(code);
  if (failedCheck) {
    return failedCheck;
  }
  if (MIGRATION_FILE_OPERATION_FAILURE_CODES.has(code)) {
    return 'migration-file-operations';
  }
  return code.startsWith('UPGRADE-MIGRATION-') ? 'migration-entries' : 'impact-scan';
}


function buildMigrationKindCounts(migrationEntries: UpgradeMigrationEntry[]): Record<string, number> {
  return migrationEntries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function buildMigrationSummary(entry: UpgradeMigrationEntry, migrations: UpgradeMigration[]): UpgradePlan['migrationSummaries'][number] {
  const migration = migrations.find((candidate) => candidate.id === entry.id);
  const operation = compileUpgradeMigrationOperation(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    target: entry.target,
    reason: entry.reason,
    requiresVerification: migration?.requiresVerification ?? true,
    ...(operation.source ? { source: operation.source } : {})
  };
}

export function buildUpgradePreview(
  blockId: string,
  fromVersion: string,
  toVersion: string,
  planningInputRevision: `sha256:${string}`,
  sourceRevision: `sha256:${string}`,
  lockRevision: `sha256:${string}`,
  compatibility: { blockApi: string; compilerApi: string; stackProfiles: string[] },
  preflightChecks: UpgradePreflightCheck[],
  impacts: string[],
  migrations: UpgradeMigration[],
  migrationEntries: UpgradeMigrationEntry[]
): UpgradePreview {
  const migrationOperations = migrationEntries.map(compileUpgradeMigrationOperation);
  return createUpgradePreview({
    artifactKind: 'unbound-upgrade-preview',
    blockId,
    fromVersion,
    toVersion,
    planningInputRevision,
    sourceRevision,
    lockRevision,
    compatibility: {
      blockApi: compatibility.blockApi,
      compilerApi: compatibility.compilerApi,
      stackProfiles: uniqueSorted(compatibility.stackProfiles)
    },
    preflightChecks,
    impacts,
    migrations,
    migrationKindCounts: buildMigrationKindCounts(migrationEntries),
    migrationSummaries: migrationEntries.map((entry) => buildMigrationSummary(entry, migrations)),
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
