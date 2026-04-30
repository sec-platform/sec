import { CI_ARTIFACT_KINDS } from '../shared/ci-artifact-contract.ts';
import type { CiArtifactKind } from '../shared/ci-artifact-types.ts';
import type { DependencyCleanOptions } from '../shared/dependency-environment.ts';
import type { VerificationLane } from '../shared/verification-types.ts';
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
  VERIFY_USAGE,
  WORKBENCH_USAGE
} from './usage.ts';

export type ArtifactPathKind = CiArtifactKind;

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

type JsonOutputArgs = { json: boolean; compact: boolean };
type JsonModeArgs<TMode extends string> = TMode extends string ? { mode: TMode } & JsonOutputArgs : never;

function applyJsonOutputFlag(output: JsonOutputArgs, flag: string): boolean {
  if (flag === '--json' && !output.json) {
    output.json = true;
    return true;
  }
  if (flag === '--compact' && output.json && !output.compact) {
    output.compact = true;
    return true;
  }
  return false;
}

function parseDryRunJsonOutputArgs(args: string[], usage: string): JsonOutputArgs & { dryRun: boolean } {
  const output = { dryRun: false, json: false, compact: false };
  for (const flag of args) {
    if (flag === '--dry-run' && !output.dryRun) {
      output.dryRun = true;
      continue;
    }
    if (applyJsonOutputFlag(output, flag)) {
      continue;
    }
    throw new Error(usage);
  }
  return output;
}

export function parseVerifyArgs(args: string[]): { lane: VerificationLane; json: boolean; compact: boolean } {
  let lane: VerificationLane = 'fast';
  const output: JsonOutputArgs = { json: false, compact: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--lane' && index + 1 < args.length) {
      lane = parseLaneValue(args[index + 1]);
      index += 1;
      continue;
    }
    if (applyJsonOutputFlag(output, flag)) {
      continue;
    }
    throw new Error(VERIFY_USAGE);
  }
  return { lane, ...output };
}

export function parseRepairArgs(args: string[]): ParsedRepairArgs {
  return parseJsonSubcommandArgs(args, REPAIR_USAGE, ['plan'] as const) ?? {
    mode: 'run',
    ...parseDryRunJsonOutputArgs(args, REPAIR_USAGE)
  };
}

export function parseUpgradeArgs(args: string[]): ParsedUpgradeArgs {
  const modeArgs = parseJsonSubcommandArgs(args, UPGRADE_USAGE, ['plan', 'diagnostics'] as const);
  if (modeArgs) {
    return modeArgs;
  }
  if (args.length < 2) {
    throw new Error(UPGRADE_USAGE);
  }

  const [blockId, targetVersion, ...flags] = args;
  return { mode: 'run', blockId, targetVersion, ...parseDryRunJsonOutputArgs(flags, UPGRADE_USAGE) };
}

function parseOptionalJsonOutputArgs(args: string[], usage: string): JsonOutputArgs {
  const output: JsonOutputArgs = { json: false, compact: false };
  for (const flag of args) {
    if (applyJsonOutputFlag(output, flag)) {
      continue;
    }
    throw new Error(usage);
  }
  return output;
}

function createOptionalJsonOutputParser(usage: string): (args: string[]) => JsonOutputArgs {
  return (args) => parseOptionalJsonOutputArgs(args, usage);
}

function parseJsonSubcommandArgs<TMode extends string>(
  args: string[],
  usage: string,
  modes: readonly TMode[]
): JsonModeArgs<TMode> | undefined {
  const mode = args[0];
  if (!modes.includes(mode as TMode)) {
    return undefined;
  }
  return {
    mode: mode as TMode,
    ...parseOptionalJsonOutputArgs(args.slice(1), usage)
  } as JsonModeArgs<TMode>;
}

function parseRequiredJsonSubcommandArgs<TMode extends string>(
  args: string[],
  usage: string,
  modes: readonly TMode[]
): JsonModeArgs<TMode> {
  const parsed = parseJsonSubcommandArgs(args, usage, modes);
  if (!parsed) {
    throw new Error(usage);
  }
  return parsed;
}

export function parseLockArgs(
  args: string[]
): { mode: 'run' } | { mode: 'inspect'; json: boolean; compact: boolean } {
  const inspectArgs = parseJsonSubcommandArgs(args, LOCK_USAGE, ['inspect'] as const);
  if (inspectArgs) {
    return inspectArgs;
  }
  if (args.length === 0) {
    return { mode: 'run' };
  }
  throw new Error(LOCK_USAGE);
}

export function parseExplainArgs(
  args: string[]
): { mode: 'run'; json: boolean; compact: boolean } | { mode: 'graph'; json: boolean; compact: boolean } {
  return parseJsonSubcommandArgs(args, EXPLAIN_USAGE, ['graph'] as const) ?? {
    mode: 'run',
    ...parseOptionalJsonOutputArgs(args, EXPLAIN_USAGE)
  };
}

function parseArtifactPathKind(value: string): ArtifactPathKind {
  if (CI_ARTIFACT_KINDS.includes(value as CiArtifactKind)) {
    return value as CiArtifactKind;
  }
  throw new Error(ARTIFACTS_USAGE);
}

export function parseArtifactsArgs(
  args: string[]
):
  | { mode: 'json'; compact: boolean }
  | { mode: 'manifest'; json: boolean; compact: boolean }
  | { mode: 'paths'; json: boolean; compact: boolean; kind?: ArtifactPathKind } {
  const manifestArgs = parseJsonSubcommandArgs(args, ARTIFACTS_USAGE, ['manifest'] as const);
  if (manifestArgs) {
    return manifestArgs;
  }
  if (args[0] === '--paths') {
    const output: JsonOutputArgs = { json: false, compact: false };
    let kind: ArtifactPathKind | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index];
      if (applyJsonOutputFlag(output, flag)) {
        continue;
      }
      if (flag === '--kind' && !kind && index + 1 < args.length) {
        kind = parseArtifactPathKind(args[index + 1]);
        index += 1;
        continue;
      }
      throw new Error(ARTIFACTS_USAGE);
    }
    return { mode: 'paths', ...output, ...(kind ? { kind } : {}) };
  }
  const output = parseOptionalJsonOutputArgs(args, ARTIFACTS_USAGE);
  if (!output.json) {
    throw new Error(ARTIFACTS_USAGE);
  }
  return { mode: 'json', compact: output.compact };
}

export const parseDoctorArgs = createOptionalJsonOutputParser(DOCTOR_USAGE);
export const parseReferenceOutputArgs = createOptionalJsonOutputParser(REFERENCE_USAGE);
export const parseBenchmarkOutputArgs = createOptionalJsonOutputParser(BENCHMARK_USAGE);
export const parseTestOutputArgs = createOptionalJsonOutputParser(TEST_USAGE);
export const parseContractOutputArgs = createOptionalJsonOutputParser(CONTRACT_USAGE);

export function parsePolicyArgs(
  args: string[]
): { mode: 'report'; json: boolean; compact: boolean } | { mode: 'sources'; json: boolean; compact: boolean } {
  return parseRequiredJsonSubcommandArgs(args, POLICY_USAGE, ['report', 'sources'] as const);
}

export function parseAcceptanceArgs(
  args: string[]
):
  | { mode: 'coverage'; json: boolean; compact: boolean }
  | { mode: 'blocks'; json: boolean; compact: boolean }
  | { mode: 'slots'; json: boolean; compact: boolean } {
  return parseRequiredJsonSubcommandArgs(args, ACCEPTANCE_USAGE, ['coverage', 'blocks', 'slots'] as const);
}

export function parseRuntimeOutputArgs(
  args: string[]
): { mode: 'report'; json: boolean; compact: boolean } | { mode: 'steps'; json: boolean; compact: boolean } {
  return parseRequiredJsonSubcommandArgs(args, RUNTIME_USAGE, ['report', 'steps'] as const);
}

export const parseInstallOutputArgs = createOptionalJsonOutputParser(INSTALL_USAGE);
export const parseBlocksOutputArgs = createOptionalJsonOutputParser(BLOCKS_USAGE);
export const parsePostgresOutputArgs = createOptionalJsonOutputParser(POSTGRES_USAGE);
export const parseVerificationOutputArgs = createOptionalJsonOutputParser(VERIFICATION_USAGE);

export function parseWorkbenchArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args[0] !== 'mutations' || args[1] !== 'apply') {
    throw new Error(WORKBENCH_USAGE);
  }
  return parseOptionalJsonOutputArgs(args.slice(2), WORKBENCH_USAGE);
}

export const parseProvenanceOutputArgs = createOptionalJsonOutputParser(PROVENANCE_USAGE);

export function parseReviewArgs(
  args: string[]
):
  | { mode: 'summary'; json: boolean; compact: boolean }
  | { mode: 'matrix'; json: boolean; compact: boolean }
  | { mode: 'diagnostics'; json: boolean; compact: boolean } {
  return parseRequiredJsonSubcommandArgs(args, REVIEW_USAGE, ['summary', 'matrix', 'diagnostics'] as const);
}

export const parseDemoOutputArgs = createOptionalJsonOutputParser(DEMO_USAGE);
export const parseDepsOutputArgs = createOptionalJsonOutputParser(DEPS_USAGE);

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
