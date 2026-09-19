import type { UpgradeMigration } from '../contract.ts';
import { CompilerError } from '../errors.ts';

export function upgradeFailureWithSecondaryFailures(
  primary: Error,
  secondaryFailures: readonly unknown[],
  message: string
): Error {
  if (secondaryFailures.length === 0) return primary;
  return new AggregateError(
    [primary, ...secondaryFailures],
    `${message}: ${primary.message}`,
    { cause: primary }
  );
}

export function throwUpgradeFailureWithSecondaryFailures(
  primary: Error,
  secondaryFailures: readonly unknown[],
  message: string
): never {
  throw upgradeFailureWithSecondaryFailures(primary, secondaryFailures, message);
}

export function isEmptyDiagnosticsDetails(details: unknown): boolean {
  if (details === undefined || details === null) {
    return true;
  }
  if (typeof details !== 'object' || Array.isArray(details)) {
    return false;
  }
  return Object.getPrototypeOf(details) === Object.prototype && Object.keys(details).length === 0;
}

export function isPlainObjectDetails(details: unknown): details is Record<string, unknown> {
  return (
    typeof details === 'object' &&
    details !== null &&
    !Array.isArray(details) &&
    Object.getPrototypeOf(details) === Object.prototype
  );
}

export function normalizeCauseDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message
    };
  }
  return details;
}

export function migrationManifestDetails(migration: UpgradeMigration): Record<string, unknown> {
  return {
    failedCheck: 'migration-entries',
    migrationId: migration.id,
    migrationKind: migration.kind,
    ...(migration.entry ? { entry: migration.entry } : {})
  };
}

export function withMigrationManifestDetails(migration: UpgradeMigration, error: CompilerError): CompilerError {
  if (isEmptyDiagnosticsDetails(error.details)) {
    return new CompilerError(error.code, error.message, migrationManifestDetails(migration));
  }
  if (isPlainObjectDetails(error.details)) {
    return new CompilerError(error.code, error.message, {
      ...migrationManifestDetails(migration),
      ...error.details
    });
  }
  return new CompilerError(error.code, error.message, {
    ...migrationManifestDetails(migration),
    causeDetails: normalizeCauseDetails(error.details)
  });
}
