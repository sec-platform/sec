import { sha256 } from '../../../../contracts/canonical.ts';
import {
  WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
  WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST,
  WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON,
  WINDOWS_CONTROL_CLI_SESSION_SURFACE
} from '../contract/environment.ts';
import {
  WindowsControlCliInstalledAdoptionError,
  adoptInstalledWindowsControlCli,
  type WindowsControlCliInstalledAdoption
} from './installed-adoption.ts';

/**
 * Production Windows control-CLI admission. Untrusted PATH and standard
 * locations are locators only: the installed adopter must bind each declared
 * executable to exact manifest bytes, the effective PE loader closure, the OS System32
 * readback, and retained executable/cwd capabilities before this surface can
 * return ready. It never provisions a tool or promotes a test issuer.
 */
const WINDOWS_CONTROL_CLI_SESSION_SCHEMA =
  'sec-windows-control-cli-session-v1' as const;
const WINDOWS_CONTROL_CLI_SESSION_PROVIDER_REVISION =
  'sec-windows-control-cli-installed-adoption-session-v1' as const;

const WINDOWS_ARCHITECTURE = 'x64' as const;
const MAX_OBSERVED_BYTES = 256 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const MAX_CLOSE_SETTLEMENT_ATTEMPTS = 1;

type WindowsControlCliSessionLifecycleState =
  | 'digest-physical-binding'
  | 'session-end-fence'
  | 'disposed'
  | 'invalidated';

type WindowsControlCliSessionAvailability =
  | 'unsupported'
  | 'unavailable'
  | 'unknown'
  | 'ready';

type WindowsControlCliSessionResolutionReason =
  | 'unsupported-platform'
  | 'unsupported-architecture'
  | 'session-request-invalid'
  | 'working-directory-binding-drift'
  | typeof WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON
  | 'installed-executable-ambiguous'
  | 'installed-executable-manifest-mismatch'
  | 'installed-loader-closure-unproven'
  | 'retained-capability-unavailable'
  | 'provider-epoch-drift'
  | 'close-settlement-budget-exhausted'
  | 'session-deadline-exhausted'
  | 'session-aborted';

type WindowsControlCliSessionFailure = Readonly<{
  readonly status: Exclude<WindowsControlCliSessionAvailability, 'ready'>;
  readonly reason: WindowsControlCliSessionResolutionReason;
  readonly detailDigest: `sha256:${string}`;
}>;

type WindowsControlCliSessionResolution =
  | WindowsControlCliSessionFailure
  | Readonly<{ readonly status: 'ready'; readonly session: WindowsControlCliLiveSession }>;

type WindowsControlCliPhysicalObservation = Readonly<{
  readonly rootObservedBytes: number;
  readonly executableObservedBytes: number;
  readonly records: number;
  readonly closeSettlementAttempts: number;
}>;

type WindowsControlCliPhysicalBudget = Readonly<{
  readonly maxSessionDurationMs: number;
  readonly maxRootObservedBytes: number;
  readonly maxExecutableObservedBytes: number;
  readonly maxRecords: number;
  readonly maxCloseSettlementAttempts: number;
}>;

export type WindowsControlCliSessionRequest = Readonly<{
  readonly workingDirectoryPathHint: string;
  readonly deadlineAtUnixMs: number;
  readonly signal?: AbortSignal;
  readonly maxRootObservedBytes: number;
  readonly maxExecutableObservedBytes: number;
  readonly maxRecords: number;
  readonly maxCloseSettlementAttempts: number;
}>;

type WindowsControlCliTerminalReceipt = Readonly<{
  readonly schema: typeof WINDOWS_CONTROL_CLI_SESSION_SCHEMA;
  readonly status: 'completed' | 'invalidated';
  readonly reason: WindowsControlCliSessionResolutionReason | null;
  readonly providerRevision: `sha256:${string}`;
  readonly profileId: string;
  readonly specDigest: `sha256:${string}`;
  readonly lifecycle: 'disposed';
  readonly observation: WindowsControlCliPhysicalObservation;
  readonly receiptDigest: `sha256:${string}`;
}>;

interface WindowsControlCliLiveSession {
  readonly schema: typeof WINDOWS_CONTROL_CLI_SESSION_SCHEMA;
  readonly surface: typeof WINDOWS_CONTROL_CLI_SESSION_SURFACE;
  readonly profileId: string;
  readonly specDigest: `sha256:${string}`;
  readonly providerRevision: `sha256:${string}`;
  readonly lifecycleState: WindowsControlCliSessionLifecycleState;
  readonly observation: WindowsControlCliPhysicalObservation;
  readonly budget: WindowsControlCliPhysicalBudget;
  close(): Promise<WindowsControlCliTerminalReceipt>;
}

type SessionDeadline = Readonly<{
  remainingMs(): number;
  assertLive(): void;
}>;

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
  assertPositiveInteger(input.maxRootObservedBytes, 'maxRootObservedBytes', MAX_OBSERVED_BYTES);
  assertPositiveInteger(input.maxExecutableObservedBytes, 'maxExecutableObservedBytes', MAX_OBSERVED_BYTES);
  assertPositiveInteger(input.maxRecords, 'maxRecords', MAX_RECORDS);
  assertPositiveInteger(
    input.maxCloseSettlementAttempts,
    'maxCloseSettlementAttempts',
    MAX_CLOSE_SETTLEMENT_ATTEMPTS
  );
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
    profileId: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.profileId,
    specDigest: WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST,
    platform,
    architecture,
    reason,
    request: request === null ? null : {
      cwdDigest: sha256(normalizedLocator(request.workingDirectoryPathHint)),
      deadlineClass: 'caller-absolute-deadline',
      maxRootObservedBytes: request.maxRootObservedBytes,
      maxExecutableObservedBytes: request.maxExecutableObservedBytes,
      maxRecords: request.maxRecords,
      maxCloseSettlementAttempts: request.maxCloseSettlementAttempts
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

function sessionDeadline(
  request: WindowsControlCliSessionRequest,
  startedAtUnixMs: number,
  startedAtMonotonicMs: number
): SessionDeadline {
  const deadlineAtUnixMs = Math.min(
    request.deadlineAtUnixMs,
    startedAtUnixMs + WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.resourceContract.maxSessionDurationMs
  );
  const deadlineAtMonotonicMs = startedAtMonotonicMs
    + Math.max(0, deadlineAtUnixMs - startedAtUnixMs);
  const remainingMs = (): number => Math.min(
    deadlineAtUnixMs - Date.now(),
    Math.floor(deadlineAtMonotonicMs - performance.now())
  );
  const assertLive = (): void => {
    if (request.signal?.aborted === true) {
      throw new WindowsControlCliInstalledAdoptionError('session-aborted');
    }
    if (remainingMs() < 1) {
      throw new WindowsControlCliInstalledAdoptionError('session-deadline-exhausted');
    }
  };
  return Object.freeze({ remainingMs, assertLive });
}

function initialObservation(
  adoption: WindowsControlCliInstalledAdoption
): WindowsControlCliPhysicalObservation {
  return Object.freeze({
    rootObservedBytes: adoption.rootObservedBytes,
    executableObservedBytes: adoption.executableObservedBytes,
    records: adoption.records,
    closeSettlementAttempts: 0
  });
}

function sessionBudget(request: WindowsControlCliSessionRequest): WindowsControlCliPhysicalBudget {
  const contract = WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.resourceContract;
  return Object.freeze({
    maxSessionDurationMs: Math.min(
      contract.maxSessionDurationMs,
      request.deadlineAtUnixMs - Date.now()
    ),
    maxRootObservedBytes: request.maxRootObservedBytes,
    maxExecutableObservedBytes: request.maxExecutableObservedBytes,
    maxRecords: request.maxRecords,
    maxCloseSettlementAttempts: request.maxCloseSettlementAttempts
  });
}

function projectSessionReason(error: unknown): WindowsControlCliSessionResolutionReason {
  if (error instanceof WindowsControlCliInstalledAdoptionError) return error.reason;
  return 'retained-capability-unavailable';
}

function createLiveSession(
  request: WindowsControlCliSessionRequest,
  adoption: WindowsControlCliInstalledAdoption,
  deadline: SessionDeadline
): WindowsControlCliLiveSession {
  const budget = sessionBudget(request);
  let observation = initialObservation(adoption);
  if (observation.rootObservedBytes > budget.maxRootObservedBytes
      || observation.executableObservedBytes > budget.maxExecutableObservedBytes
      || observation.records > budget.maxRecords) {
    adoption.dispose();
    throw new WindowsControlCliInstalledAdoptionError('retained-capability-unavailable');
  }
  let lifecycleState: WindowsControlCliSessionLifecycleState = 'digest-physical-binding';
  let terminal: WindowsControlCliTerminalReceipt | null = null;
  let invalidReason: WindowsControlCliSessionResolutionReason | null = null;
  const invalidate = (reason: WindowsControlCliSessionResolutionReason): void => {
    invalidReason ??= reason;
    lifecycleState = 'invalidated';
  };
  const receipt = (status: 'completed' | 'invalidated'): WindowsControlCliTerminalReceipt => {
    const body = Object.freeze({
      schema: WINDOWS_CONTROL_CLI_SESSION_SCHEMA,
      status,
      reason: invalidReason,
      providerRevision: adoption.providerRevision,
      profileId: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.profileId,
      specDigest: WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST,
      lifecycle: 'disposed' as const,
      observation
    });
    return Object.freeze({
      ...body,
      receiptDigest: sha256(body) as `sha256:${string}`
    });
  };

  const session: WindowsControlCliLiveSession = {
    schema: WINDOWS_CONTROL_CLI_SESSION_SCHEMA,
    surface: WINDOWS_CONTROL_CLI_SESSION_SURFACE,
    profileId: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.profileId,
    specDigest: WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST,
    providerRevision: adoption.providerRevision,
    get lifecycleState() { return lifecycleState; },
    get observation() { return observation; },
    budget,
    async close() {
      if (terminal !== null) return terminal;
      if (observation.closeSettlementAttempts >= budget.maxCloseSettlementAttempts) {
        invalidate('close-settlement-budget-exhausted');
      } else {
        observation = Object.freeze({
          ...observation,
          closeSettlementAttempts: observation.closeSettlementAttempts + 1
        });
      }
      try {
        if (invalidReason === null) {
          deadline.assertLive();
          adoption.assertCurrent();
          lifecycleState = 'session-end-fence';
        }
      } catch (error) {
        invalidate(projectSessionReason(error));
      }
      try {
        adoption.dispose();
        lifecycleState = 'disposed';
      } catch {
        invalidate('provider-epoch-drift');
      }
      terminal = receipt(invalidReason === null ? 'completed' : 'invalidated');
      return terminal;
    }
  };
  return Object.freeze(session);
}

/** Production admission performs bounded read-only adoption and no provisioning. */
export function resolveWindowsControlCliSession(
  requestInput: WindowsControlCliSessionRequest
): WindowsControlCliSessionResolution {
  const platform = process.platform;
  const architecture = process.arch;
  const startedAtUnixMs = Date.now();
  const startedAtMonotonicMs = performance.now();
  let request: WindowsControlCliSessionRequest;
  try {
    request = validateRequest(requestInput, startedAtUnixMs);
  } catch {
    return failure('unavailable', 'session-request-invalid', platform, architecture);
  }
  if (platform !== 'win32') {
    return failure('unsupported', 'unsupported-platform', platform, architecture, request);
  }
  if (architecture !== WINDOWS_ARCHITECTURE) {
    return failure('unsupported', 'unsupported-architecture', platform, architecture, request);
  }
  const deadline = sessionDeadline(request, startedAtUnixMs, startedAtMonotonicMs);
  try {
    const adoption = adoptInstalledWindowsControlCli({
      spec: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
      workingDirectory: request.workingDirectoryPathHint,
      deadline,
      budget: {
        maxRootObservedBytes: Math.min(
          request.maxRootObservedBytes,
          WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.adoptionContract.physicalClosure.maxObservedBytes
        ),
        maxExecutableObservedBytes: request.maxExecutableObservedBytes,
        maxRecords: request.maxRecords
      }
    });
    return Object.freeze({ status: 'ready', session: createLiveSession(request, adoption, deadline) });
  } catch (error) {
    const reason = projectSessionReason(error);
    return failure(
      reason === 'session-aborted' || reason === 'session-deadline-exhausted'
        ? 'unavailable'
        : 'unknown',
      reason,
      platform,
      architecture,
      request
    );
  }
}
