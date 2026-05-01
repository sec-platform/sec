import { CI_ARTIFACT_KINDS } from '../shared/ci-artifact-contract.ts';
import type { CiArtifactKind } from '../shared/ci-artifact-types.ts';
import type { DependencyCleanOptions } from '../shared/dependency-environment.ts';
import type { VerificationLane } from '../shared/verification-types.ts';
import {
  ACCEPTANCE_USAGE, ARTIFACTS_USAGE, BENCHMARK_USAGE, BLOCKS_USAGE, CONTRACT_USAGE,
  DEMO_USAGE, DEPS_USAGE, DOCTOR_USAGE, EXPLAIN_USAGE, INIT_USAGE, INSTALL_USAGE,
  LOCK_USAGE, POLICY_USAGE, POSTGRES_USAGE, PROVENANCE_USAGE, REFERENCE_USAGE,
  REPAIR_USAGE, REVIEW_USAGE, RUNTIME_USAGE, TEST_USAGE, UPGRADE_USAGE,
  VERIFICATION_USAGE, VERIFY_USAGE, WORKBENCH_USAGE
} from './usage.ts';

export type ArtifactPathKind = CiArtifactKind;

export type ParsedRepairArgs =
  | { mode: 'run'; dryRun: boolean; json: boolean; compact: boolean }
  | { mode: 'plan'; json: boolean; compact: boolean };

export type ParsedUpgradeArgs =
  | { mode: 'run'; blockId: string; targetVersion: string; dryRun: boolean; json: boolean; compact: boolean }
  | { mode: 'plan'; json: boolean; compact: boolean }
  | { mode: 'diagnostics'; json: boolean; compact: boolean };

type JsonOutput = { json: boolean; compact: boolean };

function parseJsonFlags(args: string[]): JsonOutput {
  const result: JsonOutput = { json: false, compact: false };
  for (const flag of args) {
    if (flag === '--json' && !result.json) { result.json = true; continue; }
    if (flag === '--compact' && result.json && !result.compact) { result.compact = true; continue; }
    return result;
  }
  return result;
}

function expectOnlyJsonFlags(args: string[], usage: string): JsonOutput {
  const result: JsonOutput = { json: false, compact: false };
  for (const flag of args) {
    if (flag === '--json' && !result.json) { result.json = true; continue; }
    if (flag === '--compact' && result.json && !result.compact) { result.compact = true; continue; }
    throw new Error(usage);
  }
  return result;
}

function parseSubcommand<T extends string>(args: string[], usage: string, modes: readonly T[]): { mode: T } & JsonOutput | undefined {
  const mode = args[0] as T;
  if (!modes.includes(mode)) return undefined;
  return { mode, ...expectOnlyJsonFlags(args.slice(1), usage) };
}

function requireSubcommand<T extends string>(args: string[], usage: string, modes: readonly T[]): { mode: T } & JsonOutput {
  const result = parseSubcommand(args, usage, modes);
  if (!result) throw new Error(usage);
  return result;
}

export function parseResetArg(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === '--reset') return true;
  throw new Error(INIT_USAGE);
}

export function parseVerifyArgs(args: string[]): { lane: VerificationLane; json: boolean; compact: boolean } {
  let lane: VerificationLane = 'fast';
  const output: JsonOutput = { json: false, compact: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--lane' && i + 1 < args.length) {
      const value = args[i + 1];
      if (value !== 'fast' && value !== 'runtime' && value !== 'all') throw new Error(VERIFY_USAGE);
      lane = value;
      i += 1;
      continue;
    }
    if (args[i] === '--json' && !output.json) { output.json = true; continue; }
    if (args[i] === '--compact' && output.json && !output.compact) { output.compact = true; continue; }
    throw new Error(VERIFY_USAGE);
  }
  return { lane, ...output };
}

export function parseRepairArgs(args: string[]): ParsedRepairArgs {
  return parseSubcommand(args, REPAIR_USAGE, ['plan'] as const) ?? {
    mode: 'run' as const,
    ...parseDryRunArgs(args, REPAIR_USAGE)
  };
}

function parseDryRunArgs(args: string[], usage: string): JsonOutput & { dryRun: boolean } {
  const output = { dryRun: false, json: false, compact: false };
  for (const flag of args) {
    if (flag === '--dry-run' && !output.dryRun) { output.dryRun = true; continue; }
    if (flag === '--json' && !output.json) { output.json = true; continue; }
    if (flag === '--compact' && output.json && !output.compact) { output.compact = true; continue; }
    throw new Error(usage);
  }
  return output;
}

export function parseUpgradeArgs(args: string[]): ParsedUpgradeArgs {
  const modeArgs = parseSubcommand(args, UPGRADE_USAGE, ['plan', 'diagnostics'] as const);
  if (modeArgs) return modeArgs;
  if (args.length < 2) throw new Error(UPGRADE_USAGE);
  const [blockId, targetVersion, ...flags] = args;
  return { mode: 'run', blockId, targetVersion, ...parseDryRunArgs(flags, UPGRADE_USAGE) };
}

export function parseLockArgs(args: string[]): { mode: 'run' } | { mode: 'inspect'; json: boolean; compact: boolean } {
  return parseSubcommand(args, LOCK_USAGE, ['inspect'] as const) ?? (args.length === 0 ? { mode: 'run' as const } : (() => { throw new Error(LOCK_USAGE); })());
}

export function parseExplainArgs(args: string[]): { mode: 'run'; json: boolean; compact: boolean } | { mode: 'graph'; json: boolean; compact: boolean } {
  return parseSubcommand(args, EXPLAIN_USAGE, ['graph'] as const) ?? { mode: 'run' as const, ...expectOnlyJsonFlags(args, EXPLAIN_USAGE) };
}

export function parseArtifactsArgs(args: string[]): { mode: 'json'; compact: boolean } | { mode: 'manifest'; json: boolean; compact: boolean } | { mode: 'paths'; json: boolean; compact: boolean; kind?: ArtifactPathKind } {
  const manifestArgs = parseSubcommand(args, ARTIFACTS_USAGE, ['manifest'] as const);
  if (manifestArgs) return manifestArgs;
  if (args[0] === '--paths') {
    const output: JsonOutput = { json: false, compact: false };
    let kind: ArtifactPathKind | undefined;
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === '--json' && !output.json) { output.json = true; continue; }
      if (args[i] === '--compact' && output.json && !output.compact) { output.compact = true; continue; }
      if (args[i] === '--kind' && !kind && i + 1 < args.length) {
        const value = args[i + 1];
        if (!CI_ARTIFACT_KINDS.includes(value as CiArtifactKind)) throw new Error(ARTIFACTS_USAGE);
        kind = value as CiArtifactKind;
        i += 1;
        continue;
      }
      throw new Error(ARTIFACTS_USAGE);
    }
    return { mode: 'paths', ...output, ...(kind ? { kind } : {}) };
  }
  const output = expectOnlyJsonFlags(args, ARTIFACTS_USAGE);
  if (!output.json) throw new Error(ARTIFACTS_USAGE);
  return { mode: 'json', compact: output.compact };
}

export const parseDoctorArgs = (args: string[]) => expectOnlyJsonFlags(args, DOCTOR_USAGE);
export const parseReferenceOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, REFERENCE_USAGE);
export const parseBenchmarkOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, BENCHMARK_USAGE);
export const parseTestOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, TEST_USAGE);
export const parseContractOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, CONTRACT_USAGE);
export const parseInstallOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, INSTALL_USAGE);
export const parseBlocksOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, BLOCKS_USAGE);
export const parsePostgresOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, POSTGRES_USAGE);
export const parseVerificationOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, VERIFICATION_USAGE);
export const parseProvenanceOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, PROVENANCE_USAGE);
export const parseDemoOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, DEMO_USAGE);
export const parseDepsOutputArgs = (args: string[]) => expectOnlyJsonFlags(args, DEPS_USAGE);

export const parsePolicyArgs = (args: string[]) => requireSubcommand(args, POLICY_USAGE, ['report', 'sources'] as const);
export const parseAcceptanceArgs = (args: string[]) => requireSubcommand(args, ACCEPTANCE_USAGE, ['coverage', 'blocks', 'slots'] as const);
export const parseRuntimeOutputArgs = (args: string[]) => requireSubcommand(args, RUNTIME_USAGE, ['report', 'steps'] as const);
export const parseReviewArgs = (args: string[]) => requireSubcommand(args, REVIEW_USAGE, ['summary', 'matrix', 'diagnostics'] as const);

export function parseWorkbenchArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args[0] !== 'mutations' || args[1] !== 'apply') throw new Error(WORKBENCH_USAGE);
  return expectOnlyJsonFlags(args.slice(2), WORKBENCH_USAGE);
}

export function parseDepsCleanArgs(args: string[]): DependencyCleanOptions {
  if (args.length === 0) throw new Error(DEPS_USAGE);
  const options: DependencyCleanOptions = {};
  for (const flag of args) {
    if (flag === '--project') { options.project = true; continue; }
    if (flag === '--shared') { options.shared = true; continue; }
    if (flag === '--npm-cache') { options.npmCache = true; continue; }
    if (flag === '--all') { options.all = true; continue; }
    if (flag === '--force') { options.force = true; continue; }
    throw new Error(DEPS_USAGE);
  }
  if (options.all && options.force !== true) throw new Error(DEPS_USAGE);
  if (!options.all && options.force) throw new Error(DEPS_USAGE);
  return options;
}
