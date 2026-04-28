import type { DependencyCleanOptions } from '../shared/dependency-environment.ts';
import type { VerificationLane } from '../shared/types.ts';
import {
  ACCEPTANCE_USAGE,
  ARTIFACTS_USAGE,
  BENCHMARK_USAGE,
  BLOCKS_USAGE,
  CONTRACT_USAGE,
  DEMO_USAGE,
  DEPS_USAGE,
  DOCTOR_USAGE,
  EXPLAIN_USAGE,
  INIT_USAGE,
  INSTALL_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  PROVENANCE_USAGE,
  REFERENCE_USAGE,
  REPAIR_USAGE,
  REVIEW_USAGE,
  RUNTIME_USAGE,
  TEST_USAGE,
  UPGRADE_USAGE,
  VERIFICATION_USAGE,
  VERIFY_USAGE
} from './usage.ts';

export type ArtifactPathKind = 'governance' | 'view' | 'test' | 'contract';

export type ParsedRepairArgs =
  | { mode: 'run'; dryRun: boolean; json: boolean; compact: boolean }
  | { mode: 'plan'; json: boolean; compact: boolean };

export type ParsedUpgradeArgs =
  | { mode: 'run'; blockId: string; targetVersion: string; dryRun: boolean; json: boolean; compact: boolean }
  | { mode: 'plan'; json: boolean; compact: boolean }
  | { mode: 'diagnostics'; json: boolean; compact: boolean };

export function parseResetArg(args: string[]): boolean {
  if (args.length === 0) {
    return false;
  }
  if (args.length === 1 && args[0] === '--reset') {
    return true;
  }
  throw new Error(INIT_USAGE);
}

function parseLaneValue(value: string): VerificationLane {
  if (value === 'fast' || value === 'runtime' || value === 'all') {
    return value;
  }
  throw new Error(VERIFY_USAGE);
}

export function parseVerifyArgs(args: string[]): { lane: VerificationLane; json: boolean; compact: boolean } {
  let lane: VerificationLane = 'fast';
  let json = false;
  let compact = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--lane' && index + 1 < args.length) {
      lane = parseLaneValue(args[index + 1]);
      index += 1;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(VERIFY_USAGE);
  }
  return { lane, json, compact };
}

function parseRepairOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(REPAIR_USAGE);
  }
  return { json, compact };
}

export function parseRepairArgs(args: string[]): ParsedRepairArgs {
  if (args[0] === 'plan') {
    return { mode: 'plan', ...parseRepairOutputArgs(args.slice(1)) };
  }

  let dryRun = false;
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(REPAIR_USAGE);
  }
  return { mode: 'run', dryRun, json, compact };
}

function parseUpgradeOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(UPGRADE_USAGE);
  }
  return { json, compact };
}

export function parseUpgradeArgs(args: string[]): ParsedUpgradeArgs {
  if (args[0] === 'plan') {
    return { mode: 'plan', ...parseUpgradeOutputArgs(args.slice(1)) };
  }
  if (args[0] === 'diagnostics') {
    return { mode: 'diagnostics', ...parseUpgradeOutputArgs(args.slice(1)) };
  }
  if (args.length < 2) {
    throw new Error(UPGRADE_USAGE);
  }

  const [blockId, targetVersion, ...flags] = args;
  let dryRun = false;
  let json = false;
  let compact = false;
  for (const flag of flags) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(UPGRADE_USAGE);
  }

  return { mode: 'run', blockId, targetVersion, dryRun, json, compact };
}

function parseOptionalJsonOutputArgs(args: string[], usage: string): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(usage);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(usage);
}

export function parseLockArgs(
  args: string[]
): { mode: 'run' } | { mode: 'inspect'; json: boolean; compact: boolean } {
  if (args[0] === 'inspect') {
    return { mode: 'inspect', ...parseOptionalJsonOutputArgs(args.slice(1), LOCK_USAGE) };
  }
  if (args.length === 0) {
    return { mode: 'run' };
  }
  throw new Error(LOCK_USAGE);
}

export function parseExplainArgs(
  args: string[]
): { mode: 'run'; json: boolean; compact: boolean } | { mode: 'graph'; json: boolean; compact: boolean } {
  if (args[0] === 'graph') {
    return { mode: 'graph', ...parseOptionalJsonOutputArgs(args.slice(1), EXPLAIN_USAGE) };
  }
  return { mode: 'run', ...parseOptionalJsonOutputArgs(args, EXPLAIN_USAGE) };
}

function parseArtifactPathKind(value: string): ArtifactPathKind {
  if (value === 'governance' || value === 'view' || value === 'test' || value === 'contract') {
    return value;
  }
  throw new Error(ARTIFACTS_USAGE);
}

function parseArtifactOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(ARTIFACTS_USAGE);
  }
  return { json, compact };
}

export function parseArtifactsArgs(
  args: string[]
):
  | { mode: 'json'; compact: boolean }
  | { mode: 'manifest'; json: boolean; compact: boolean }
  | { mode: 'paths'; json: boolean; compact: boolean; kind?: ArtifactPathKind } {
  if (args[0] === 'manifest') {
    return { mode: 'manifest', ...parseArtifactOutputArgs(args.slice(1)) };
  }
  if (args[0] === '--paths') {
    let json = false;
    let compact = false;
    let kind: ArtifactPathKind | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === '--json' && !json) {
        json = true;
        continue;
      }
      if (flag === '--compact' && json && !compact) {
        compact = true;
        continue;
      }
      if (flag === '--kind' && !kind && index + 1 < args.length) {
        kind = parseArtifactPathKind(args[index + 1]);
        index += 1;
        continue;
      }
      throw new Error(ARTIFACTS_USAGE);
    }
    return { mode: 'paths', json, compact, ...(kind ? { kind } : {}) };
  }
  if (args[0] !== '--json') {
    throw new Error(ARTIFACTS_USAGE);
  }
  if (args.length === 1) {
    return { mode: 'json', compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { mode: 'json', compact: true };
  }
  throw new Error(ARTIFACTS_USAGE);
}

export function parseDoctorArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, DOCTOR_USAGE);
}

export function parseReferenceOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, REFERENCE_USAGE);
}

export function parseBenchmarkOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, BENCHMARK_USAGE);
}

export function parseTestOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, TEST_USAGE);
}

export function parseContractOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, CONTRACT_USAGE);
}

export function parsePolicyArgs(
  args: string[]
): { mode: 'report'; json: boolean; compact: boolean } | { mode: 'sources'; json: boolean; compact: boolean } {
  if (args[0] === 'report') {
    return { mode: 'report', ...parseOptionalJsonOutputArgs(args.slice(1), POLICY_USAGE) };
  }
  if (args[0] === 'sources') {
    return { mode: 'sources', ...parseOptionalJsonOutputArgs(args.slice(1), POLICY_USAGE) };
  }
  throw new Error(POLICY_USAGE);
}

export function parseAcceptanceArgs(
  args: string[]
):
  | { mode: 'coverage'; json: boolean; compact: boolean }
  | { mode: 'blocks'; json: boolean; compact: boolean }
  | { mode: 'slots'; json: boolean; compact: boolean } {
  if (args[0] === 'coverage') {
    return { mode: 'coverage', ...parseOptionalJsonOutputArgs(args.slice(1), ACCEPTANCE_USAGE) };
  }
  if (args[0] === 'blocks') {
    return { mode: 'blocks', ...parseOptionalJsonOutputArgs(args.slice(1), ACCEPTANCE_USAGE) };
  }
  if (args[0] === 'slots') {
    return { mode: 'slots', ...parseOptionalJsonOutputArgs(args.slice(1), ACCEPTANCE_USAGE) };
  }
  throw new Error(ACCEPTANCE_USAGE);
}

export function parseRuntimeOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, RUNTIME_USAGE);
}

export function parseInstallOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, INSTALL_USAGE);
}

export function parseBlocksOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, BLOCKS_USAGE);
}

export function parsePostgresOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, POSTGRES_USAGE);
}

export function parseVerificationOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, VERIFICATION_USAGE);
}

export function parseProvenanceOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, PROVENANCE_USAGE);
}

export function parseReviewOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, REVIEW_USAGE);
}

export function parseDemoOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, DEMO_USAGE);
}

export function parseDepsOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  return parseOptionalJsonOutputArgs(args, DEPS_USAGE);
}

export function parseDepsCleanArgs(args: string[]): DependencyCleanOptions {
  if (args.length === 0) {
    throw new Error(DEPS_USAGE);
  }

  const options: DependencyCleanOptions = {};
  for (const flag of args) {
    if (flag === '--project') {
      options.project = true;
      continue;
    }
    if (flag === '--shared') {
      options.shared = true;
      continue;
    }
    if (flag === '--npm-cache') {
      options.npmCache = true;
      continue;
    }
    if (flag === '--all') {
      options.all = true;
      continue;
    }
    if (flag === '--force') {
      options.force = true;
      continue;
    }
    throw new Error(DEPS_USAGE);
  }

  if (options.all && options.force !== true) {
    throw new Error(DEPS_USAGE);
  }
  if (!options.all && options.force) {
    throw new Error(DEPS_USAGE);
  }

  return options;
}
