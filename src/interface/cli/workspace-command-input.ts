import { parseVerificationLaneOption } from './verification-lane-option.ts';
import { decodeBooleanFlag } from './boolean-option.ts';
import { jsonOpts, usageError } from './command-options.ts';

// Own field spelling and defaults here; command-specific help stays at registration.
export const COMPOSE_LOCK_OPTION = Object.freeze({
  name: 'lock', flags: '--lock', defaultValue: false
} as const);
export const WORKSPACE_DRY_RUN_OPTION = Object.freeze({
  name: 'dryRun', flags: '--dry-run', defaultValue: false
} as const);

type WorkspaceBooleanOption = typeof COMPOSE_LOCK_OPTION | typeof WORKSPACE_DRY_RUN_OPTION;
type RawOptions = Readonly<Record<string, unknown>>;

function readBooleanOption(options: RawOptions, definition: WorkspaceBooleanOption): boolean {
  const value = Object.getOwnPropertyDescriptor(options, definition.name)?.enumerable
    ? options[definition.name] : undefined;
  return decodeBooleanFlag(value, definition.defaultValue, () => {
    throw usageError(`${definition.flags} must be a boolean flag`);
  });
}

function dryRunRequest(options: RawOptions) {
  return Object.freeze({ [WORKSPACE_DRY_RUN_OPTION.name]: readBooleanOption(options, WORKSPACE_DRY_RUN_OPTION) });
}

export function parseComposeCommandInput(options: RawOptions) {
  return Object.freeze({ [COMPOSE_LOCK_OPTION.name]: readBooleanOption(options, COMPOSE_LOCK_OPTION) });
}

/** Inspection has no write request; do not read even a getter for an unused flag. */
export function parseRepairCommandInput(mode: unknown, options: RawOptions) {
  const output = jsonOpts(options);
  if (mode === 'plan') return Object.freeze({ kind: 'plan' as const, output });
  if (mode !== undefined) throw usageError('Unsupported repair mode');
  return Object.freeze({ kind: 'execute' as const, output, request: dryRunRequest(options) });
}

export function parseUpgradeCommandInput(
  subject: unknown,
  targetVersion: unknown,
  options: RawOptions,
  command: string
) {
  const output = jsonOpts(options);
  if (subject === 'plan' && targetVersion === undefined) {
    return Object.freeze({ kind: 'plan' as const, output });
  }
  if (subject === 'diagnostics' && targetVersion === undefined) {
    return Object.freeze({ kind: 'diagnostics' as const, output });
  }
  if (typeof subject !== 'string' || typeof targetVersion !== 'string') {
    throw usageError(`Usage: ${command} <block-id> <target-version> [--dry-run] [--json [--compact]]`);
  }
  return Object.freeze({ kind: 'execute' as const, subject, targetVersion, output, request: dryRunRequest(options) });
}

// A standalone verification request and a pipeline compile have independent defaults.
export const VERIFY_COMMAND_DEFAULT_LANE = 'fast' as const;

export function parseVerifyCommandInput(options: RawOptions) {
  const { json, compact } = options;
  const lane = Object.getOwnPropertyDescriptor(options, 'lane')?.enumerable ? options.lane : undefined;
  const admittedLane = parseVerificationLaneOption(lane, (choices) => { throw usageError(`Lane must be ${choices}`); });
  const output = jsonOpts({ json, compact });
  return Object.freeze({ output, request: Object.freeze({ lane: admittedLane, emitTiming: !output.json }) });
}
