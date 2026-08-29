import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
  SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST,
  SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON,
  SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE
} from '../contract/environment.ts';

/**
 * Production Windows control-CLI admission.
 *
 * The current repository has no authenticated installed-capability adopter.
 * Therefore this operation is deliberately zero-effect and can only return a
 * typed non-ready result. A future positive implementation must be backed by
 * real retained executable/cwd capabilities; test issuers do not live here.
 */
export const WINDOWS_CONTROL_CLI_SESSION_SCHEMA =
  'sec-windows-control-cli-session-v1' as const;
export const WINDOWS_CONTROL_CLI_SESSION_PROVIDER_REVISION =
  'sec-windows-control-cli-installed-adoption-session-v1' as const;

const WINDOWS_ARCHITECTURE = 'x64' as const;
const MAX_ARGUMENT_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_OBSERVED_BYTES = 256 * 1024 * 1024;
const MAX_RECORDS = 100_000;

export type SupportedCommandId = 'git' | 'gh';

export type WindowsControlCliSessionLifecycleState =
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

export type WindowsControlCliSessionAvailability =
  | 'unsupported'
  | 'unavailable'
  | 'unknown'
  | 'ready';

export type WindowsControlCliSessionResolutionReason =
  | 'unsupported-platform'
  | 'unsupported-architecture'
  | 'session-request-invalid'
  | 'working-directory-binding-drift'
  | typeof SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON
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

export type WindowsControlCliSessionFailure = Readonly<{
  readonly status: Exclude<WindowsControlCliSessionAvailability, 'ready'>;
  readonly reason: WindowsControlCliSessionResolutionReason;
  readonly detailDigest: `sha256:${string}`;
}>;

export type WindowsControlCliSessionResolution =
  | WindowsControlCliSessionFailure
  | Readonly<{ readonly status: 'ready'; readonly session: WindowsControlCliLiveSession }>;

export type WindowsControlCliSessionCounter = Readonly<{
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

export type WindowsControlCliSessionBudget = Readonly<{
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

export type WindowsControlCliSessionRequest = Readonly<{
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

export type WindowsControlCliSessionCommandResult = Readonly<{
  readonly commandId: SupportedCommandId;
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly counter: WindowsControlCliSessionCounter;
}>;

export type WindowsControlCliTerminalReceipt = Readonly<{
  readonly schema: typeof WINDOWS_CONTROL_CLI_SESSION_SCHEMA;
  readonly status: 'completed' | 'invalidated';
  readonly reason: WindowsControlCliSessionResolutionReason | null;
  readonly providerRevision: `sha256:${string}`;
  readonly profileId: string;
  readonly specDigest: `sha256:${string}`;
  readonly lifecycle: 'tree-stdio-settlement' | 'disposed';
  readonly counter: WindowsControlCliSessionCounter;
  readonly receiptDigest: `sha256:${string}`;
}>;

export interface WindowsControlCliLiveSession {
  readonly schema: typeof WINDOWS_CONTROL_CLI_SESSION_SCHEMA;
  readonly surface: typeof SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE;
  readonly profileId: string;
  readonly specDigest: `sha256:${string}`;
  readonly providerRevision: `sha256:${string}`;
  readonly lifecycleState: WindowsControlCliSessionLifecycleState;
  readonly counter: WindowsControlCliSessionCounter;
  readonly budget: WindowsControlCliSessionBudget;
  run(commandId: SupportedCommandId, args: readonly string[]): Promise<WindowsControlCliSessionCommandResult>;
  close(): Promise<WindowsControlCliTerminalReceipt>;
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
  input: WindowsControlCliSessionRequest,
  now: number
): WindowsControlCliSessionRequest {
  if (!/^[A-Za-z]:[\\/]/u.test(input.workingDirectoryPathHint)
      || input.workingDirectoryPathHint.includes('\u0000')) {
    throw new Error('working-directory locator must be an absolute Windows path');
  }
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= now) {
    throw new Error('session deadline must be a future safe Unix millisecond');
  }
  assertPositiveInteger(input.maxCommandsPerSession, 'maxCommandsPerSession', 128);
  assertPositiveInteger(input.maxTotalArgumentBytes, 'maxTotalArgumentBytes', MAX_ARGUMENT_BYTES);
  assertPositiveInteger(input.maxTotalOutputBytes, 'maxTotalOutputBytes', MAX_OUTPUT_BYTES);
  assertPositiveInteger(input.maxRootObservedBytes, 'maxRootObservedBytes', MAX_OBSERVED_BYTES);
  assertPositiveInteger(input.maxExecutableObservedBytes, 'maxExecutableObservedBytes', MAX_OBSERVED_BYTES);
  assertPositiveInteger(input.maxRecords, 'maxRecords', MAX_RECORDS);
  assertPositiveInteger(input.maxReopenRefreshes, 'maxReopenRefreshes', 10_000);
  assertPositiveInteger(input.maxSettlementAttempts, 'maxSettlementAttempts', 10_000);
  return Object.freeze({ ...input });
}

function detailDigest(
  reason: WindowsControlCliSessionResolutionReason,
  platform: string,
  architecture: string,
  request: WindowsControlCliSessionRequest | null
): `sha256:${string}` {
  return sha256({
    schema: WINDOWS_CONTROL_CLI_SESSION_SCHEMA,
    providerRevision: WINDOWS_CONTROL_CLI_SESSION_PROVIDER_REVISION,
    profileId: SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.profileId,
    specDigest: SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST,
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
  status: Exclude<WindowsControlCliSessionAvailability, 'ready'>,
  reason: WindowsControlCliSessionResolutionReason,
  platform: string,
  architecture: string,
  request: WindowsControlCliSessionRequest | null = null
): WindowsControlCliSessionFailure {
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
export function resolveWindowsControlCliSession(
  requestInput: WindowsControlCliSessionRequest
): WindowsControlCliSessionFailure {
  const platform = process.platform;
  const architecture = process.arch;
  let request: WindowsControlCliSessionRequest;
  try {
    request = validateRequest(requestInput, Date.now());
  } catch {
    return failure('unavailable', 'session-request-invalid', platform, architecture);
  }
  if (platform !== 'win32') {
    return failure('unsupported', 'unsupported-platform', platform, architecture, request);
  }
  if (architecture !== WINDOWS_ARCHITECTURE) {
    return failure('unsupported', 'unsupported-architecture', platform, architecture, request);
  }
  return failure(
    'unknown',
    SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON,
    platform,
    architecture,
    request
  );
}
