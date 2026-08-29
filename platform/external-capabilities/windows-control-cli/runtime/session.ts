import { sha256 } from '../../../foundation/canonical.ts';
import {
  SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY_V1,
  SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST_V1,
  SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON_V1,
  SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE_V1
} from '../contract/environment.ts';

/**
 * Production Windows control-CLI admission.
 *
 * The current repository has no authenticated installed-capability adopter.
 * Therefore this operation is deliberately zero-effect and can only return a
 * typed non-ready result. A future positive implementation must be backed by
 * real retained executable/cwd capabilities; test issuers do not live here.
 */
export const WINDOWS_CONTROL_CLI_SESSION_SCHEMA_V1 =
  'sec-windows-control-cli-session-v1' as const;
export const WINDOWS_CONTROL_CLI_SESSION_PROVIDER_REVISION_V1 =
  'sec-windows-control-cli-installed-adoption-session-v1' as const;

const WINDOWS_ARCHITECTURE_V1 = 'x64' as const;
const MAX_ARGUMENT_BYTES_V1 = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES_V1 = 16 * 1024 * 1024;
const MAX_OBSERVED_BYTES_V1 = 256 * 1024 * 1024;
const MAX_RECORDS_V1 = 100_000;

export type SupportedCommandIdV1 = 'git' | 'gh';

export type WindowsControlCliSessionLifecycleStateV1 =
  | 'unbound'
  | 'platform/profile'
  | 'bounded-path-hints'
  | 'derived-official-layout-root'
  | 'authenticated-root-closure'
  | 'retained-working-directory'
  | 'retained-effective-executable'
  | 'digest-physical-version-probe'
  | 'serial-bounded-commands'
  | 'per-command-end-fence'
  | 'session-end-fence'
  | 'tree-stdio-settlement'
  | 'terminal-receipt'
  | 'disposed'
  | 'invalidated';

export type WindowsControlCliSessionAvailabilityV1 =
  | 'unsupported'
  | 'unavailable'
  | 'unknown'
  | 'ready';

export type WindowsControlCliSessionResolutionReasonV1 =
  | 'unsupported-platform'
  | 'unsupported-architecture'
  | 'session-request-invalid'
  | 'working-directory-binding-drift'
  | typeof SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON_V1
  | 'retained-capability-unavailable'
  | 'provider-epoch-drift'
  | 'command-budget-exhausted'
  | 'command-arguments-invalid'
  | 'command-output-budget-exhausted'
  | 'command-settlement-unproven'
  | 'command-version-drift'
  | 'reentrant-command'
  | 'session-deadline-exhausted'
  | 'session-aborted';

export type WindowsControlCliSessionFailureV1 = Readonly<{
  readonly status: Exclude<WindowsControlCliSessionAvailabilityV1, 'ready'>;
  readonly reason: WindowsControlCliSessionResolutionReasonV1;
  readonly detailDigest: `sha256:${string}`;
}>;

export type WindowsControlCliSessionResolutionV1 =
  | WindowsControlCliSessionFailureV1
  | Readonly<{ readonly status: 'ready'; readonly session: WindowsControlCliLiveSessionV1 }>;

export type WindowsControlCliSessionCounterV1 = Readonly<{
  readonly commandCount: number;
  readonly argumentCount: number;
  readonly argumentBytes: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly totalOutputBytes: number;
  readonly rootObservedBytes: number;
  readonly executableObservedBytes: number;
  readonly records: number;
  readonly reopenRefreshes: number;
  readonly settlementAttempts: number;
}>;

export type WindowsControlCliSessionBudgetV1 = Readonly<{
  readonly maxSessionDurationMs: number;
  readonly maxCommandsPerSession: number;
  readonly maxTotalArgumentBytes: number;
  readonly maxTotalOutputBytes: number;
  readonly maxRootObservedBytes: number;
  readonly maxExecutableObservedBytes: number;
  readonly maxRecords: number;
  readonly maxReopenRefreshes: number;
  readonly maxSettlementAttempts: number;
}>;

export type WindowsControlCliSessionRequestV1 = Readonly<{
  readonly workingDirectoryPathHint: string;
  readonly deadlineAtUnixMs: number;
  readonly signal?: AbortSignal;
  readonly maxCommandsPerSession: number;
  readonly maxTotalArgumentBytes: number;
  readonly maxTotalOutputBytes: number;
  readonly maxRootObservedBytes: number;
  readonly maxExecutableObservedBytes: number;
  readonly maxRecords: number;
  readonly maxReopenRefreshes: number;
  readonly maxSettlementAttempts: number;
}>;

export type WindowsControlCliSessionCommandResultV1 = Readonly<{
  readonly commandId: SupportedCommandIdV1;
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly counter: WindowsControlCliSessionCounterV1;
}>;

export type WindowsControlCliTerminalReceiptV1 = Readonly<{
  readonly schema: typeof WINDOWS_CONTROL_CLI_SESSION_SCHEMA_V1;
  readonly status: 'completed' | 'invalidated';
  readonly reason: WindowsControlCliSessionResolutionReasonV1 | null;
  readonly providerRevision: `sha256:${string}`;
  readonly profileId: string;
  readonly specDigest: `sha256:${string}`;
  readonly lifecycle: 'tree-stdio-settlement' | 'disposed';
  readonly counter: WindowsControlCliSessionCounterV1;
  readonly receiptDigest: `sha256:${string}`;
}>;

export interface WindowsControlCliLiveSessionV1 {
  readonly schema: typeof WINDOWS_CONTROL_CLI_SESSION_SCHEMA_V1;
  readonly surface: typeof SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE_V1;
  readonly profileId: string;
  readonly specDigest: `sha256:${string}`;
  readonly providerRevision: `sha256:${string}`;
  readonly lifecycleState: WindowsControlCliSessionLifecycleStateV1;
  readonly counter: WindowsControlCliSessionCounterV1;
  readonly budget: WindowsControlCliSessionBudgetV1;
  run(commandId: SupportedCommandIdV1, args: readonly string[]): Promise<WindowsControlCliSessionCommandResultV1>;
  close(): Promise<WindowsControlCliTerminalReceiptV1>;
}

function normalizedLocator(value: string): string {
  return value.replaceAll('/', '\\').replace(/[\\]+$/u, '').toLowerCase();
}

function assertPositiveInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive safe integer at or below ${maximum}`);
  }
}

function validateRequest(
  input: WindowsControlCliSessionRequestV1,
  now: number
): WindowsControlCliSessionRequestV1 {
  if (!/^[A-Za-z]:[\\/]/u.test(input.workingDirectoryPathHint)
      || input.workingDirectoryPathHint.includes('\u0000')) {
    throw new Error('working-directory locator must be an absolute Windows path');
  }
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= now) {
    throw new Error('session deadline must be a future safe Unix millisecond');
  }
  assertPositiveInteger(input.maxCommandsPerSession, 'maxCommandsPerSession', 128);
  assertPositiveInteger(input.maxTotalArgumentBytes, 'maxTotalArgumentBytes', MAX_ARGUMENT_BYTES_V1);
  assertPositiveInteger(input.maxTotalOutputBytes, 'maxTotalOutputBytes', MAX_OUTPUT_BYTES_V1);
  assertPositiveInteger(input.maxRootObservedBytes, 'maxRootObservedBytes', MAX_OBSERVED_BYTES_V1);
  assertPositiveInteger(input.maxExecutableObservedBytes, 'maxExecutableObservedBytes', MAX_OBSERVED_BYTES_V1);
  assertPositiveInteger(input.maxRecords, 'maxRecords', MAX_RECORDS_V1);
  assertPositiveInteger(input.maxReopenRefreshes, 'maxReopenRefreshes', 10_000);
  assertPositiveInteger(input.maxSettlementAttempts, 'maxSettlementAttempts', 10_000);
  return Object.freeze({ ...input });
}

function detailDigest(
  reason: WindowsControlCliSessionResolutionReasonV1,
  platform: string,
  architecture: string,
  request: WindowsControlCliSessionRequestV1 | null
): `sha256:${string}` {
  return sha256({
    schema: WINDOWS_CONTROL_CLI_SESSION_SCHEMA_V1,
    providerRevision: WINDOWS_CONTROL_CLI_SESSION_PROVIDER_REVISION_V1,
    profileId: SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY_V1.profileId,
    specDigest: SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST_V1,
    platform,
    architecture,
    reason,
    request: request === null ? null : {
      cwdDigest: sha256(normalizedLocator(request.workingDirectoryPathHint)),
      deadlineClass: 'caller-absolute-deadline',
      maxCommandsPerSession: request.maxCommandsPerSession,
      maxTotalArgumentBytes: request.maxTotalArgumentBytes,
      maxTotalOutputBytes: request.maxTotalOutputBytes,
      maxRootObservedBytes: request.maxRootObservedBytes,
      maxExecutableObservedBytes: request.maxExecutableObservedBytes,
      maxRecords: request.maxRecords,
      maxReopenRefreshes: request.maxReopenRefreshes,
      maxSettlementAttempts: request.maxSettlementAttempts
    }
  }) as `sha256:${string}`;
}

function failure(
  status: Exclude<WindowsControlCliSessionAvailabilityV1, 'ready'>,
  reason: WindowsControlCliSessionResolutionReasonV1,
  platform: string,
  architecture: string,
  request: WindowsControlCliSessionRequestV1 | null = null
): WindowsControlCliSessionFailureV1 {
  return Object.freeze({
    status,
    reason,
    detailDigest: detailDigest(reason, platform, architecture, request)
  });
}

/**
 * Zero-effect production admission. No PATH lookup, filesystem discovery,
 * process launch, download, extraction, installation, or cache write occurs.
 */
export function resolveWindowsControlCliSessionV1(
  requestInput: WindowsControlCliSessionRequestV1
): WindowsControlCliSessionFailureV1 {
  const platform = process.platform;
  const architecture = process.arch;
  let request: WindowsControlCliSessionRequestV1;
  try {
    request = validateRequest(requestInput, Date.now());
  } catch {
    return failure('unavailable', 'session-request-invalid', platform, architecture);
  }
  if (platform !== 'win32') {
    return failure('unsupported', 'unsupported-platform', platform, architecture, request);
  }
  if (architecture !== WINDOWS_ARCHITECTURE_V1) {
    return failure('unsupported', 'unsupported-architecture', platform, architecture, request);
  }
  return failure(
    'unknown',
    SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON_V1,
    platform,
    architecture,
    request
  );
}
