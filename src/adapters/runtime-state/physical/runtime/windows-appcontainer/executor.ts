import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Pointer } from 'bun:ffi';
import { createSha256Hasher } from '../../../../../contracts/digest.ts';
import { canonicalEquals, compareCodeUnits, rawSha256Hex, rawSha256 } from '../../../../../contracts/canonical.ts';
import {
  assertWindowsAppContainerExecutionBindingReceipt,
  assertWindowsAppContainerExecutionCapability,
  type WindowsAppContainerExecutionBindingReceipt,
  type WindowsAppContainerExecutionCapability
} from '../../contract/windows-appcontainer-execution-capability.ts';
import {
  runObservedCommand,
  type ObservedCommandOutcome
} from '../observed-process.ts';
import {
  acquireWindowsAppContainerNativeHelperCapability,
  readWindowsAppContainerNativeHelperCapability,
  WindowsAppContainerNativeHelperMaterializationError,
  type WindowsAppContainerNativeHelperCapability
} from './native-helper-materialization.ts';
import {
  bindNativeHelperSettlement,
  classifyNativeHelperSettlement,
  copyNativeHelperSettlement,
  NATIVE_HELPER_EXIT_STATUS_UNPROVEN,
  type NativeHelperDiagnosticCapture,
  type NativeHelperMode,
  type NativeHelperSettlementClassification
} from './native-helper-settlement.ts';
import {
  loadWindowsAppContainerProbeAssetSet,
  stageWindowsAppContainerProbeAssetSet,
  windowsAppContainerProbeAssetRelativePath,
  windowsAppContainerProbeAssetRelativePaths
} from './probe-assets.ts';
import {
  acquireWindowsAppContainerProbeConformanceServersForTests,
  buildWindowsAppContainerProbeEnvironmentForTests,
  observeWindowsAppContainerProbeReportForTests,
  windowsAppContainerProbeReportIsIsolatedForTests,
  type WindowsAppContainerNestedChildDiagnostic,
  type WindowsAppContainerProbeConformanceServerLease
} from './probe-conformance.ts';

const PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x0002_0002;
const PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002_000d;
const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x0002_0009;
const EXTENDED_STARTUPINFO_PRESENT = 0x0008_0000;
const CREATE_UNICODE_ENVIRONMENT = 0x0000_0400;
const CREATE_NO_WINDOW = 0x0800_0000;
const CREATE_SUSPENDED = 0x0000_0004;
const STARTF_USESTDHANDLES = 0x0000_0100;
const GENERIC_READ = 0x8000_0000;
const GENERIC_WRITE = 0x4000_0000;
const FILE_SHARE_READ = 0x0000_0001;
const FILE_SHARE_WRITE = 0x0000_0002;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x0000_0080;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;
const WAIT_OBJECT_0 = 0x0000_0000;
const WAIT_TIMEOUT = 0x0000_0102;
const WAIT_FAILED = 0xffff_ffff;
const MAXIMUM_SID_BYTES = 68;
const MAXIMUM_ATTRIBUTE_LIST_BYTES = 1024 * 1024;
const MAXIMUM_RESUME_THREAD_RESULT = 0xffff_ffff;
const MAX_WINDOWS_DWORD = 0xffff_ffff;
const MAX_NATIVE_RECEIPT_BYTES = 1024;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;
const TERMINATED_EXIT_CODE = 0x534d_3301;
const RUNTIME_DIRECTORY_NAME = '.sm3r';
const RUNTIME_EXECUTABLE_NAME = 'bun.exe';
const RUNTIME_CONFIG_NAME = 'bunfig.toml';
const HOST_BUN_CONFIG_RELATIVE_ROOT = '.sm3h';
const ISOLATED_BUN_CONFIG_CONTENT = '# isolated runtime\n';
const NATIVE_HELPER_BUNDLE_NAME = 'windows-appcontainer-native-helper.mjs';
const RECOVERY_OWNER_FORMAT_VERSION = 'windows-appcontainer-recovery-owner-v1';
const RECOVERY_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-owner.json';
const RECOVERY_OWNER_PENDING_FILE_NAME = `${RECOVERY_OWNER_FILE_NAME}.pending`;
const LEGACY_RECOVERY_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-owner-v1.json';
const LEGACY_RECOVERY_OWNER_PENDING_FILE_NAME = `${LEGACY_RECOVERY_OWNER_FILE_NAME}.pending-v1`;
const PROVISIONAL_OWNER_FORMAT_VERSION = 'windows-appcontainer-provisional-owner-v1';
const PROVISIONAL_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-provisional-owner.json';
const PROVISIONAL_OWNER_PENDING_FILE_NAME = `${PROVISIONAL_OWNER_FILE_NAME}.pending`;
const LEGACY_PROVISIONAL_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
const LEGACY_PROVISIONAL_OWNER_PENDING_FILE_NAME = `${LEGACY_PROVISIONAL_OWNER_FILE_NAME}.pending-v1`;
const PROBE_OWNER_FORMAT_VERSION = 'windows-appcontainer-probe-owner-v1';
const PROBE_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-probe-owner.json';
const PROBE_OWNER_PENDING_FILE_NAME = `${PROBE_OWNER_FILE_NAME}.pending`;
const LEGACY_PROBE_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-probe-owner-v1.json';
const LEGACY_PROBE_OWNER_PENDING_FILE_NAME = `${LEGACY_PROBE_OWNER_FILE_NAME}.pending-v1`;
const NATIVE_RESULT_FILE_NAME = '.semantic-mutation-appcontainer-result.json';
const LEGACY_NATIVE_RESULT_FILE_NAME = '.semantic-mutation-appcontainer-result-v1.json';
const WINDOWS_HOST_TOOL_DEADLINE_MS = 120_000;
const WINDOWS_HOST_TOOL_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const NATIVE_EXECUTION_DEFAULT_TIMEOUT_MS = 120_000;
const NATIVE_HELPER_STARTUP_SETTLEMENT_ALLOWANCE_MS = 10_000;
const NATIVE_WAIT_SLICE_MS = 20;
const NATIVE_JOB_SETTLEMENT_MS = 5_000;
const WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
const WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_BYTES = 48;
const WINDOWS_JOB_OBJECT_ACTIVE_PROCESSES_OFFSET = 40;

type BunFfiToBuffer = (typeof import('bun:ffi'))['toBuffer'];
const WINDOWS_APPCONTAINER_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'BUN_INSTALL_CACHE_DIR',
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'SEC_APPCONTAINER_PROBE_HTTP_PORT',
  'SEC_APPCONTAINER_PROBE_RAW_PORT',
  'SEC_ISOLATED_VERIFICATION',
  'SYSTEMROOT',
  'TEMP',
  'TEST_PORT',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR'
]);

const CAPABILITY_PROBE_RELATIVE_ROOT = '.sm3p';
const CAPABILITY_PARENT_CANARY_NAME = '.appcontainer-host-read-canary';
const CAPABILITY_OUTER_CANARY_NAME = '.appcontainer-outer-host-read-canary';
const LEGACY_CAPABILITY_PARENT_CANARY_NAME = '.appcontainer-host-read-canary-v1';
const LEGACY_CAPABILITY_OUTER_CANARY_NAME = '.appcontainer-outer-host-read-canary-v1';
const CAPABILITY_CANARY_CONTENT = 'windows-appcontainer-host-read-canary-v1\n';


/**
 * Frozen x64/arm64 Windows ABI facts used by the FFI boundary. Keeping these
 * values visible to a narrow contract test makes pointer/offset drift fail
 * before CreateProcessW can observe a malformed native structure.
 */
const WINDOWS_APPCONTAINER_NATIVE_CONTRACT = Object.freeze({
  pointerBytes: 8,
  securityAttributesBytes: 24,
  securityAttributesLengthOffset: 0,
  securityAttributesDescriptorOffset: 8,
  securityAttributesInheritHandleOffset: 16,
  securityCapabilitiesBytes: 24,
  securityCapabilitiesAppContainerSidOffset: 0,
  securityCapabilitiesCapabilitiesOffset: 8,
  securityCapabilitiesCapabilityCountOffset: 16,
  securityCapabilitiesReservedOffset: 20,
  startupInfoExBytes: 112,
  startupInfoExFlagsOffset: 60,
  startupInfoExStdInputOffset: 80,
  startupInfoExStdOutputOffset: 88,
  startupInfoExStdErrorOffset: 96,
  startupInfoExAttributeListOffset: 104,
  processInformationBytes: 24,
  processInformationProcessHandleOffset: 0,
  processInformationThreadHandleOffset: 8,
  jobObjectExtendedLimitInformationBytes: 144,
  jobObjectLimitFlagsOffset: 16,
  procThreadAttributeHandleList: PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
  procThreadAttributeJobList: PROC_THREAD_ATTRIBUTE_JOB_LIST,
  procThreadAttributeSecurityCapabilities: PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
  procThreadAttributeCount: 3,
  standardHandleCount: 3,
  startfUseStdHandles: STARTF_USESTDHANDLES,
  inheritHandles: 1,
  capabilityCount: 0,
  reserved: 0,
  creationFlags:
    EXTENDED_STARTUPINFO_PRESENT |
    CREATE_UNICODE_ENVIRONMENT |
    CREATE_NO_WINDOW |
    CREATE_SUSPENDED,
  jobLimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
} as const);

export const WINDOWS_APPCONTAINER_RECOVERY_CONTRACT = Object.freeze({
  formatVersion: RECOVERY_OWNER_FORMAT_VERSION,
  ownerFileName: RECOVERY_OWNER_FILE_NAME,
  resultFileName: NATIVE_RESULT_FILE_NAME,
  runtimeRelativePath: RUNTIME_DIRECTORY_NAME
} as const);

export type WindowsAppContainerCapability =
  | Readonly<{ status: 'available' }>
  | Readonly<{
    status: 'unavailable';
    reason: 'non-windows' | 'unsupported-architecture';
  }>;

export type WindowsAppContainerExecutionPhase =
  | 'invalid-input'
  | 'preparation'
  | 'acl'
  | 'launch'
  | 'wait'
  | 'timeout'
  | 'cleanup';

export type WindowsAppContainerPreparationSubstage =
  | 'native-helper-entry'
  | 'native-helper-build'
  | 'native-helper-bundle-contract'
  | 'native-helper-materialization'
  | 'native-helper-invocation'
  | 'native-helper-protocol'
  | 'native-helper-diagnostic'
  | 'native-receipt'
  | 'sid-derivation'
  | 'profile-creation'
  | 'owner-publication'
  | 'runtime-identity'
  | 'system-directory'
  | 'unknown';

export type WindowsAppContainerHostToolStage =
  | 'acl-grant'
  | 'acl-remove'
  | 'acl-verify-absent'
  | 'profile-query';

type WindowsAppContainerHostToolFailureReason =
  | 'spawn'
  | 'nonzero-exit'
  | 'timeout'
  | 'lease-loss'
  | 'lifecycle-failure'
  | 'output-limit'
  | 'aborted'
  | 'termination-unconfirmed';

export interface WindowsAppContainerHostToolFailure {
  readonly stage: WindowsAppContainerHostToolStage;
  readonly reason: WindowsAppContainerHostToolFailureReason;
  readonly termination: 'not-requested' | 'confirmed' | 'unconfirmed';
}

export type WindowsAppContainerNativeHelperMode =
  | 'derive'
  | 'create-profile'
  | 'suspended-create'
  | 'execute';

const WINDOWS_APPCONTAINER_SID_PATTERN = /^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u;

const WINDOWS_APPCONTAINER_EXECUTION_PHASE_VALUES = [
  'invalid-input',
  'preparation',
  'acl',
  'launch',
  'wait',
  'timeout',
  'cleanup'
] as const satisfies readonly WindowsAppContainerExecutionPhase[];

const WINDOWS_APPCONTAINER_EXECUTION_PHASES = new Set<WindowsAppContainerExecutionPhase>(
  WINDOWS_APPCONTAINER_EXECUTION_PHASE_VALUES
);

const WINDOWS_APPCONTAINER_PREPARATION_SUBSTAGES = new Set<WindowsAppContainerPreparationSubstage>([
  'native-helper-entry',
  'native-helper-build',
  'native-helper-bundle-contract',
  'native-helper-materialization',
  'native-helper-invocation',
  'native-helper-protocol',
  'native-helper-diagnostic',
  'native-receipt',
  'sid-derivation',
  'profile-creation',
  'owner-publication',
  'runtime-identity',
  'system-directory',
  'unknown'
]);

function isWindowsDword(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_WINDOWS_DWORD;
}

type WindowsAppContainerNativeHelperProtocolClass =
  | 'ok'
  | 'declared-failure'
  | 'invalid';

type WindowsAppContainerNativeReceiptClass =
  | 'not-applicable'
  | 'absent'
  | 'exit-code'
  | 'declared-failure'
  | 'invalid'
  | 'read-error';

type WindowsAppContainerNativeHelperExitClass = 'zero' | 'nonzero' | 'invalid';

export type WindowsAppContainerNativeHelperObservation = Readonly<{
  readonly mode: WindowsAppContainerNativeHelperMode;
  readonly exitClass: WindowsAppContainerNativeHelperExitClass;
  readonly diagnosticStream: 'empty' | 'present';
  readonly protocol: WindowsAppContainerNativeHelperProtocolClass;
  readonly nativeReceipt: WindowsAppContainerNativeReceiptClass;
}>;

const WINDOWS_APPCONTAINER_NATIVE_HELPER_MODES = new Set<WindowsAppContainerNativeHelperMode>([
  'derive', 'create-profile', 'suspended-create', 'execute'
]);
const WINDOWS_APPCONTAINER_NATIVE_HELPER_EXIT_CLASSES =
  new Set<WindowsAppContainerNativeHelperExitClass>(['zero', 'nonzero', 'invalid']);
const WINDOWS_APPCONTAINER_NATIVE_HELPER_DIAGNOSTICS = new Set(['empty', 'present'] as const);
const WINDOWS_APPCONTAINER_NATIVE_HELPER_PROTOCOL_CLASSES =
  new Set<WindowsAppContainerNativeHelperProtocolClass>(['ok', 'declared-failure', 'invalid']);
const WINDOWS_APPCONTAINER_NATIVE_RECEIPT_CLASSES =
  new Set<WindowsAppContainerNativeReceiptClass>([
    'not-applicable', 'absent', 'exit-code', 'declared-failure', 'invalid', 'read-error'
  ]);

function canonicalPreparationSubstage(
  value: unknown
): WindowsAppContainerPreparationSubstage {
  return typeof value === 'string' && WINDOWS_APPCONTAINER_PREPARATION_SUBSTAGES.has(
    value as WindowsAppContainerPreparationSubstage
  )
    ? value as WindowsAppContainerPreparationSubstage
    : 'unknown';
}

function canonicalNativeHelperObservation(
  value: unknown
): WindowsAppContainerNativeHelperObservation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!WINDOWS_APPCONTAINER_NATIVE_HELPER_MODES.has(
    record.mode as WindowsAppContainerNativeHelperMode
  ) || !WINDOWS_APPCONTAINER_NATIVE_HELPER_EXIT_CLASSES.has(
    record.exitClass as WindowsAppContainerNativeHelperExitClass
  ) || !WINDOWS_APPCONTAINER_NATIVE_HELPER_DIAGNOSTICS.has(
    record.diagnosticStream as 'empty' | 'present'
  ) || !WINDOWS_APPCONTAINER_NATIVE_HELPER_PROTOCOL_CLASSES.has(
    record.protocol as WindowsAppContainerNativeHelperProtocolClass
  ) || !WINDOWS_APPCONTAINER_NATIVE_RECEIPT_CLASSES.has(
    record.nativeReceipt as WindowsAppContainerNativeReceiptClass
  )) {
    return undefined;
  }
  return Object.freeze({
    mode: record.mode as WindowsAppContainerNativeHelperMode,
    exitClass: record.exitClass as WindowsAppContainerNativeHelperExitClass,
    diagnosticStream: record.diagnosticStream as 'empty' | 'present',
    protocol: record.protocol as WindowsAppContainerNativeHelperProtocolClass,
    nativeReceipt: record.nativeReceipt as WindowsAppContainerNativeReceiptClass
  });
}

type WindowsAppContainerProbeStage =
  | 'capability'
  | 'boundary'
  | 'probe-root'
  | 'server'
  | 'environment'
  | 'ownership'
  | 'canary'
  | 'initial-recovery'
  | 'prefix-recovery'
  | 'lease-loss'
  | 'isolated-execution'
  | 'isolation-report'
  | 'cleanup';

type WindowsAppContainerProbeInvariant =
  | 'host-supported'
  | 'outer-boundary-valid'
  | 'probe-root-prepared'
  | 'probe-server-listening'
  | 'probe-address-valid'
  | 'probe-environment-valid'
  | 'probe-lease-owned'
  | 'probe-owner-valid'
  | 'canary-owned'
  | 'probe-input-clean'
  | 'initial-owner-recovered'
  | 'prefix-failure-recovered'
  | 'lease-loss-observed'
  | 'lease-loss-owner-durable'
  | 'lease-loss-processes-exited'
  | 'isolated-child-succeeded'
  | 'spawned-child-succeeded'
  | 'spawned-child-isolated'
  | 'no-resource-residue'
  | 'isolation-report-valid'
  | 'canary-intact'
  | 'lease-release'
  | 'server-close'
  | 'outer-canary-remove'
  | 'probe-root-remove'
  | 'probe-clean';

interface WindowsAppContainerProbeFault {
  readonly stage: WindowsAppContainerProbeStage;
  readonly invariant: WindowsAppContainerProbeInvariant;
  readonly executionPhase?: WindowsAppContainerExecutionPhase;
  readonly hostToolFailure?: WindowsAppContainerHostToolFailure;
  readonly nativeCode?: number;
  readonly nestedChildDiagnostic?: WindowsAppContainerNestedChildDiagnostic;
}

export type WindowsAppContainerDetailedProbeCapability =
  | Readonly<{ status: 'available' }>
  | Readonly<{
    status: 'unavailable';
    primary: WindowsAppContainerProbeFault;
    cleanup: readonly WindowsAppContainerProbeFault[];
  }>;

export class WindowsAppContainerCapabilityUnavailableError extends Error {
  public readonly code = 'VERIFY-APPCONTAINER-UNAVAILABLE' as const;

  constructor() {
    super('Windows AppContainer isolated execution is unavailable');
    this.name = 'WindowsAppContainerCapabilityUnavailableError';
  }
}

export class WindowsAppContainerExecutionError extends Error {
  public readonly code = 'VERIFY-APPCONTAINER-EXECUTION' as const;
  public readonly preparationSubstage?: WindowsAppContainerPreparationSubstage;
  public readonly nativeHelperObservation?: WindowsAppContainerNativeHelperObservation;
  public readonly nativeWorkerProgressStage?: WindowsAppContainerNativeWorkerProgressStage;

  constructor(
    public readonly phase: WindowsAppContainerExecutionPhase,
    public readonly nativeCode?: number,
    public readonly hostToolFailure?: WindowsAppContainerHostToolFailure,
    preparationSubstage?: WindowsAppContainerPreparationSubstage,
    nativeHelperObservation?: WindowsAppContainerNativeHelperObservation,
    nativeWorkerProgressStage?: WindowsAppContainerNativeWorkerProgressStage
  ) {
    super(`Windows AppContainer isolated execution failed during ${phase}`);
    this.name = 'WindowsAppContainerExecutionError';
    this.preparationSubstage = phase === 'preparation'
      ? canonicalPreparationSubstage(preparationSubstage)
      : undefined;
    this.nativeHelperObservation = canonicalNativeHelperObservation(nativeHelperObservation);
    this.nativeWorkerProgressStage = phase === 'timeout'
      ? canonicalNativeWorkerProgressStage(nativeWorkerProgressStage)
      : undefined;
  }
}

export interface WindowsAppContainerExecutionRequest {
  /** A real, already materialized staging tree. */
  readonly stagingRoot: string;
  /** A lexical relative path to a physical runner file inside stagingRoot. */
  readonly runnerRelativePath: string;
  /** Script arguments only. Bun runtime flags are owned by this executor. */
  readonly runnerArguments?: readonly string[];
  /** Complete replacement environment. The host environment is never merged. */
  readonly environment: Readonly<Record<string, string>>;
  /** Opaque, workspace-owner-issued authorization for this exact staging root. */
  readonly executionCapability: WindowsAppContainerExecutionCapability;
  readonly timeoutMs?: number;
}

interface WindowsAppContainerNativeExecutionInput {
  readonly stagingRoot: string;
  readonly runnerRelativePath: string;
  readonly runnerArguments?: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly executionBinding: WindowsAppContainerExecutionBindingReceipt;
  readonly timeoutMs?: number;
}

export interface WindowsAppContainerExecutionResult {
  readonly exitCode: number;
}

export interface WindowsAppContainerCapabilityProbeRequest {
  readonly stagingRoot: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly executionCapability: WindowsAppContainerExecutionCapability;
  readonly probeCapabilityProvider: WindowsAppContainerProbeCapabilityProvider;
  readonly timeoutMs?: number;
}

interface WindowsAppContainerProbeCapabilityLease {
  readonly capability: WindowsAppContainerExecutionCapability;
  release(): Promise<void>;
}

export interface WindowsAppContainerProbeCapabilityProvider {
  acquire(input: Readonly<{
    authorizationRoot: string;
    stagingRoot: string;
    deadlineAtUnixMs: number;
  }>): Promise<WindowsAppContainerProbeCapabilityLease>;
}

interface WindowsAppContainerRecoveryOwner {
  readonly formatVersion: typeof RECOVERY_OWNER_FORMAT_VERSION;
  readonly workspaceIdentityDigest: string;
  readonly stagingIdentityDigest: string;
  readonly stagingDirectoryName: string;
  readonly runtimeRelativePath: typeof RUNTIME_DIRECTORY_NAME;
  readonly resultFileName: typeof NATIVE_RESULT_FILE_NAME | typeof LEGACY_NATIVE_RESULT_FILE_NAME;
  readonly appContainerName: string;
  readonly appContainerSid: string;
}

interface WindowsAppContainerProvisionalOwner {
  readonly formatVersion: typeof PROVISIONAL_OWNER_FORMAT_VERSION;
  readonly workspaceIdentityDigest: string;
  readonly stagingIdentityDigest: string;
  readonly stagingDirectoryName: string;
  readonly hostBunConfigRelativePath: typeof HOST_BUN_CONFIG_RELATIVE_ROOT;
  readonly appContainerName: string;
}

interface WindowsAppContainerProbeOwner {
  readonly formatVersion: typeof PROBE_OWNER_FORMAT_VERSION;
  readonly outerWorkspaceIdentityDigest: string;
  readonly probeWorkspaceIdentityDigest: string;
  readonly outerStagingIdentityDigest: string;
  readonly probeStagingDirectoryName: 's';
  readonly parentCanaryName:
    | typeof CAPABILITY_PARENT_CANARY_NAME
    | typeof LEGACY_CAPABILITY_PARENT_CANARY_NAME;
  readonly outerCanaryName:
    | typeof CAPABILITY_OUTER_CANARY_NAME
    | typeof LEGACY_CAPABILITY_OUTER_CANARY_NAME;
}

export interface WindowsAppContainerNativeExecutionRequest {
  readonly execution: WindowsAppContainerNativeExecutionInput;
  readonly nativeResultPath: string;
  readonly owner: WindowsAppContainerRecoveryOwner;
}

interface WindowsAppContainerNativeCleanupRequest {
  readonly stagingRoot: string;
  readonly nativeResultPath: string;
  readonly executionCapability: WindowsAppContainerExecutionCapability;
  readonly owner: WindowsAppContainerRecoveryOwner;
}

interface PreparedExecution {
  readonly commandLine: Buffer;
  readonly currentDirectory: Buffer;
  readonly environmentBlock: Buffer;
  readonly executablePath: Buffer;
}

interface ValidatedExecutionBoundary {
  readonly stagingRoot: string;
  readonly transactionRoot: string;
  readonly runnerRelativePath: string;
  readonly stagingIdentityDigest: string;
}

class WindowsAppContainerProbeFailure extends Error {
  constructor(public readonly fault: WindowsAppContainerProbeFault) {
    super(`Windows AppContainer probe failed at ${fault.stage}/${fault.invariant}`);
    this.name = 'WindowsAppContainerProbeFailure';
  }
}

export type WindowsAppContainerNativeHelperWirePayload = string & Readonly<{
  __windowsAppContainerNativeHelperWirePayload: 'v1';
}>;

function encodeWindowsAppContainerNativeHelperWireValue(
  value: Readonly<Record<string, unknown>>
): WindowsAppContainerNativeHelperWirePayload {
  return JSON.stringify(value) as WindowsAppContainerNativeHelperWirePayload;
}

/** Canonical redacted wire producer shared by the native helper and its host decoder. */
export function encodeWindowsAppContainerNativeFailure(
  error: unknown
): WindowsAppContainerNativeHelperWirePayload {
  if (!(error instanceof WindowsAppContainerExecutionError) ||
    !WINDOWS_APPCONTAINER_EXECUTION_PHASES.has(error.phase) ||
    (error.nativeCode !== undefined && !isWindowsDword(error.nativeCode)) ||
    (error.nativeWorkerProgressStage !== undefined &&
      canonicalNativeWorkerProgressStage(error.nativeWorkerProgressStage) !==
        error.nativeWorkerProgressStage)) {
    return encodeWindowsAppContainerNativeHelperWireValue({
      status: 'failed',
      phase: 'preparation',
      substage: 'unknown'
    });
  }
  return encodeWindowsAppContainerNativeHelperWireValue({
    status: 'failed',
    phase: error.phase,
    ...(error.nativeCode === undefined ? {} : { nativeCode: error.nativeCode }),
    ...(error.phase === 'preparation'
      ? { substage: canonicalPreparationSubstage(error.preparationSubstage) }
      : {}),
    ...(error.phase === 'timeout' && error.nativeWorkerProgressStage !== undefined
      ? { workerStage: error.nativeWorkerProgressStage }
      : {})
  });
}

export function encodeWindowsAppContainerNativeOk(): WindowsAppContainerNativeHelperWirePayload {
  return encodeWindowsAppContainerNativeHelperWireValue({ status: 'ok' });
}

export function encodeWindowsAppContainerNativeDerivedSid(
  appContainerSid: string
): WindowsAppContainerNativeHelperWirePayload {
  if (!WINDOWS_APPCONTAINER_SID_PATTERN.test(appContainerSid)) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  return encodeWindowsAppContainerNativeHelperWireValue({ status: 'ok', appContainerSid });
}

const executionCleanupFailures = new WeakMap<Error, readonly Error[]>();
const executionRetainedOwners = new WeakSet<Error>();
const nativeHelperObservations = new WeakMap<Error, WindowsAppContainerNativeHelperObservation>();

function executionCleanupChain(error: Error, seen = new Set<Error>()): readonly Error[] {
  if (seen.has(error)) return Object.freeze([]);
  seen.add(error);
  const failures: Error[] = [];
  for (const cleanup of executionCleanupFailures.get(error) ?? []) {
    if (seen.has(cleanup)) continue;
    failures.push(cleanup, ...executionCleanupChain(cleanup, seen));
  }
  return Object.freeze(failures);
}

function rememberExecutionCleanupFailure(primary: Error, cleanup: Error): void {
  const failures = [
    ...executionCleanupChain(primary),
    cleanup,
    ...executionCleanupChain(cleanup)
  ];
  executionCleanupFailures.set(primary, Object.freeze([...new Set(failures)]));
}

/** Test-only projection of the production primary-plus-cleanup error chain. */
export function windowsAppContainerExecutionCleanupChainForTests(
  error: Error
): readonly Error[] {
  return executionCleanupChain(error);
}

/** Test-only redacted helper observation; raw helper output is never retained here. */
export function windowsAppContainerNativeHelperObservationForTests(
  error: Error
): WindowsAppContainerNativeHelperObservation | undefined {
  return nativeHelperObservations.get(error);
}

function probeFault(
  stage: WindowsAppContainerProbeStage,
  invariant: WindowsAppContainerProbeInvariant,
  error?: unknown
): WindowsAppContainerProbeFault {
  if (error instanceof WindowsAppContainerProbeFailure) return error.fault;
  if (error instanceof WindowsAppContainerExecutionError) {
    return Object.freeze({
      stage,
      invariant,
      executionPhase: error.phase,
      ...(error.hostToolFailure === undefined ? {} : { hostToolFailure: error.hostToolFailure }),
      ...(error.nativeCode === undefined ? {} : { nativeCode: error.nativeCode })
    });
  }
  return Object.freeze({ stage, invariant });
}

function throwProbeFailure(
  stage: WindowsAppContainerProbeStage,
  invariant: WindowsAppContainerProbeInvariant,
  error?: unknown
): never {
  throw new WindowsAppContainerProbeFailure(probeFault(stage, invariant, error));
}

function associatedProbeCleanupFaults(
  error: unknown,
  stage: WindowsAppContainerProbeStage,
  invariant: WindowsAppContainerProbeInvariant
): readonly WindowsAppContainerProbeFault[] {
  if (!(error instanceof Error)) return Object.freeze([]);
  return Object.freeze(executionCleanupChain(error).map((cleanup) =>
    probeFault(stage, invariant, cleanup)));
}

function executionError(
  phase: WindowsAppContainerExecutionPhase,
  nativeCode?: number,
  hostToolFailure?: WindowsAppContainerHostToolFailure,
  preparationSubstage?: WindowsAppContainerPreparationSubstage,
  nativeHelperObservation?: WindowsAppContainerNativeHelperObservation,
  nativeWorkerProgressStage?: WindowsAppContainerNativeWorkerProgressStage
): WindowsAppContainerExecutionError {
  return new WindowsAppContainerExecutionError(
    phase,
    nativeCode,
    hostToolFailure,
    preparationSubstage,
    nativeHelperObservation,
    nativeWorkerProgressStage
  );
}

interface NativeExecutionDeadlines {
  readonly childTimeoutMs: number;
  readonly hostWatchdogMs: number;
}

interface NativeExecutionBudget {
  readonly startedAtMs: number;
  readonly timeoutMs: number;
}

interface NativeProcessWaitDependencies {
  readonly nowMs: () => number;
  readonly waitForProcess: (timeoutMs: number) => number;
}

export type WindowsAppContainerNativeWorkerSettlement =
  | Readonly<{ kind: 'completed'; exitCode: number }>
  | Readonly<{ kind: 'suspended-created' }>
  | Readonly<{
      kind: 'failed';
      payload: WindowsAppContainerNativeHelperWirePayload;
    }>;

export type WindowsAppContainerNativeWorkerProgressStage =
  | 'not-observed'
  | 'create-entered'
  | 'create-returned'
  | 'job-settled';

type WindowsAppContainerNativeWorkerProgress = Readonly<{
  kind: 'progress';
  stage: Exclude<WindowsAppContainerNativeWorkerProgressStage, 'not-observed'>;
}>;

const WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE = Object.freeze([
  'create-entered',
  'create-returned',
  'job-settled'
] as const);

function canonicalNativeWorkerProgressStage(
  value: unknown
): WindowsAppContainerNativeWorkerProgressStage | undefined {
  return value === 'not-observed' ||
    WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE.includes(
      value as typeof WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE[number]
    )
    ? value as WindowsAppContainerNativeWorkerProgressStage
    : undefined;
}

export type WindowsAppContainerNativeWorkerStart = (
  onTerminal: (value: unknown) => void,
  onFailure: () => void
) => void;

interface WindowsAppContainerNativeWorkerSupervisorTimers {
  readonly setTimer: (callback: () => void, timeoutMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

const WINDOWS_APPCONTAINER_NATIVE_WORKER_SUPERVISOR_TIMERS:
WindowsAppContainerNativeWorkerSupervisorTimers = Object.freeze({
  setTimer: (callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs),
  clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
});

function decodeWindowsAppContainerNativeWorkerSettlement(
  value: unknown
): WindowsAppContainerNativeWorkerSettlement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === 'completed' && exactObjectKeys(record, ['exitCode', 'kind']) &&
    isWindowsDword(record.exitCode)) {
    return Object.freeze({ kind: 'completed', exitCode: Number(record.exitCode) });
  }
  if (record.kind === 'suspended-created' && exactObjectKeys(record, ['kind'])) {
    return Object.freeze({ kind: 'suspended-created' });
  }
  if (record.kind !== 'failed' || !exactObjectKeys(record, ['kind', 'payload']) ||
    typeof record.payload !== 'string' ||
    decodeNativeHelperOutput('execute', 1, record.payload).classification !== 'declared-failure') {
    return undefined;
  }
  return Object.freeze({
    kind: 'failed',
    payload: record.payload as WindowsAppContainerNativeHelperWirePayload
  });
}

function decodeWindowsAppContainerNativeWorkerProgress(
  value: unknown
): WindowsAppContainerNativeWorkerProgress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const stage = canonicalNativeWorkerProgressStage(record.stage);
  if (record.kind !== 'progress' || !exactObjectKeys(record, ['kind', 'stage']) ||
    stage === undefined || stage === 'not-observed') {
    return undefined;
  }
  return Object.freeze({ kind: 'progress', stage });
}

export function superviseWindowsAppContainerNativeWorkerForHelper(
  mode: 'execute' | 'suspended-create',
  timeoutMs: number,
  start: WindowsAppContainerNativeWorkerStart,
  timers: WindowsAppContainerNativeWorkerSupervisorTimers =
    WINDOWS_APPCONTAINER_NATIVE_WORKER_SUPERVISOR_TIMERS
): Promise<WindowsAppContainerNativeWorkerSettlement> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new WindowsAppContainerExecutionError('invalid-input'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: unknown;
    let lastProgress: WindowsAppContainerNativeWorkerProgressStage = 'not-observed';
    const finish = (
      result: WindowsAppContainerNativeWorkerSettlement | undefined,
      error?: Error
    ): void => {
      if (settled) return;
      settled = true;
      timers.clearTimer(timer);
      if (result) resolve(result);
      else reject(error ?? new WindowsAppContainerCapabilityUnavailableError());
    };
    timer = timers.setTimer(
      () => finish(undefined, new WindowsAppContainerExecutionError(
        'timeout', undefined, undefined, undefined, undefined, lastProgress
      )),
      timeoutMs
    );
    try {
      start(
        (value) => {
          if (settled) return;
          const progress = decodeWindowsAppContainerNativeWorkerProgress(value);
          if (progress) {
            if (mode !== 'suspended-create') return finish(undefined);
            const currentIndex = lastProgress === 'not-observed'
              ? -1
              : WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE.indexOf(lastProgress);
            if (progress.stage !== WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE[currentIndex + 1]) {
              return finish(undefined);
            }
            lastProgress = progress.stage;
            return;
          }
          const terminal = decodeWindowsAppContainerNativeWorkerSettlement(value);
          if (!terminal ||
            (terminal.kind === 'completed' && mode !== 'execute') ||
            (terminal.kind === 'suspended-created' &&
              (mode !== 'suspended-create' || lastProgress !== 'job-settled'))) {
            return finish(undefined);
          }
          finish(terminal);
        },
        () => finish(undefined)
      );
    } catch {
      finish(undefined);
    }
  });
}

interface WindowsAppContainerNativeJobSettlementDependencies {
  readonly nowMs: () => number;
  readonly terminateJob: () => boolean;
  readonly waitForRoot: (timeoutMs: number) => number;
  readonly queryActiveProcesses: () => number | null;
  readonly sleep: (timeoutMs: number) => void;
}

function arbitrateNativeExecutionDeadlines(
  requestedTimeoutMs: number | undefined
): NativeExecutionDeadlines {
  const childTimeoutMs = requestedTimeoutMs ??
    NATIVE_EXECUTION_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(childTimeoutMs) || childTimeoutMs <= 0 ||
    childTimeoutMs > Number.MAX_SAFE_INTEGER -
      NATIVE_HELPER_STARTUP_SETTLEMENT_ALLOWANCE_MS) {
    throw executionError('invalid-input');
  }
  return Object.freeze({
    childTimeoutMs,
    hostWatchdogMs: childTimeoutMs +
      NATIVE_HELPER_STARTUP_SETTLEMENT_ALLOWANCE_MS
  });
}

function createNativeExecutionBudget(
  childTimeoutMs: number,
  startedAtMs: number
): NativeExecutionBudget {
  if (!Number.isSafeInteger(childTimeoutMs) || childTimeoutMs <= 0 ||
    !Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
    throw executionError('invalid-input');
  }
  return Object.freeze({ startedAtMs, timeoutMs: childTimeoutMs });
}

function remainingNativeExecutionBudget(
  budget: NativeExecutionBudget,
  observedAtMs: number
): number {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < budget.startedAtMs) {
    throw executionError('timeout');
  }
  const elapsedMs = observedAtMs - budget.startedAtMs;
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs >= budget.timeoutMs) {
    throw executionError('timeout');
  }
  return budget.timeoutMs - elapsedMs;
}

function waitForNativeProcess(
  budget: NativeExecutionBudget,
  dependencies: NativeProcessWaitDependencies
): void {
  while (true) {
    const waitSliceMs = Math.min(
      NATIVE_WAIT_SLICE_MS,
      remainingNativeExecutionBudget(budget, dependencies.nowMs())
    );
    const waitResult = dependencies.waitForProcess(waitSliceMs);
    if (waitResult === WAIT_OBJECT_0) return;
    if (waitResult === WAIT_FAILED || waitResult !== WAIT_TIMEOUT) {
      throw executionError('wait');
    }
  }
}

function settleNativeJobAfterFailure(
  dependencies: WindowsAppContainerNativeJobSettlementDependencies,
  settlementMs = NATIVE_JOB_SETTLEMENT_MS
): boolean {
  const startedAtMs = dependencies.nowMs();
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0 ||
    !Number.isSafeInteger(settlementMs) || settlementMs <= 0 ||
    startedAtMs > Number.MAX_SAFE_INTEGER - settlementMs || !dependencies.terminateJob()) {
    return false;
  }
  const deadlineAtMs = startedAtMs + settlementMs;
  let rootClosed = false;
  while (true) {
    const observedAtMs = dependencies.nowMs();
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < startedAtMs ||
      observedAtMs >= deadlineAtMs) return false;
    const sliceMs = Math.min(NATIVE_WAIT_SLICE_MS,
      deadlineAtMs - observedAtMs);
    if (!rootClosed) {
      const waitResult = dependencies.waitForRoot(sliceMs);
      if (waitResult === WAIT_OBJECT_0) rootClosed = true;
      else if (waitResult !== WAIT_TIMEOUT) return false;
    }
    const afterWaitMs = dependencies.nowMs();
    if (!Number.isSafeInteger(afterWaitMs) || afterWaitMs < observedAtMs ||
      afterWaitMs >= deadlineAtMs) return false;
    const activeProcesses = dependencies.queryActiveProcesses();
    if (activeProcesses === null || !Number.isSafeInteger(activeProcesses) ||
      activeProcesses < 0) return false;
    if (rootClosed && activeProcesses === 0) return true;
    if (rootClosed) {
      const beforeSleepMs = dependencies.nowMs();
      if (!Number.isSafeInteger(beforeSleepMs) || beforeSleepMs < afterWaitMs ||
        beforeSleepMs >= deadlineAtMs) return false;
      dependencies.sleep(Math.min(NATIVE_WAIT_SLICE_MS,
        deadlineAtMs - beforeSleepMs));
    }
  }
}

/** Pure finite projection of the child-owned timeout and host settlement watchdog. */
export function arbitrateNativeExecutionDeadlinesForTests(
  requestedTimeoutMs: number | undefined
): NativeExecutionDeadlines {
  return arbitrateNativeExecutionDeadlines(requestedTimeoutMs);
}

/** Pure test seam for the helper-entry elapsed budget. */
export function createNativeExecutionBudgetForTests(
  requestedTimeoutMs: number | undefined,
  startedAtMs: number
): NativeExecutionBudget {
  const deadlines = arbitrateNativeExecutionDeadlines(requestedTimeoutMs);
  return createNativeExecutionBudget(deadlines.childTimeoutMs, startedAtMs);
}

/** Pure test seam for fail-closed elapsed-budget observation. */
export function remainingNativeExecutionBudgetForTests(
  budget: NativeExecutionBudget,
  observedAtMs: number
): number {
  return remainingNativeExecutionBudget(budget, observedAtMs);
}

export function remainingWindowsAppContainerNativeHelperTimeout(
  requestedTimeoutMs: number | undefined,
  helperStartedAtMs: number,
  observedAtMs: number
): number {
  const deadlines = arbitrateNativeExecutionDeadlines(
    requestedTimeoutMs
  );
  return remainingNativeExecutionBudget(
    createNativeExecutionBudget(
      deadlines.childTimeoutMs,
      helperStartedAtMs
    ),
    observedAtMs
  );
}

/** Deterministic test seam for the production-used native process wait loop. */
export function waitForNativeProcessForTests(
  requestedTimeoutMs: number,
  startedAtMs: number,
  dependencies: NativeProcessWaitDependencies
): void {
  const budget = createNativeExecutionBudgetForTests(
    requestedTimeoutMs,
    startedAtMs
  );
  waitForNativeProcess(budget, dependencies);
}

/** Deterministic test seam for timeout cleanup of the inner AppContainer Job. */
export function settleNativeJobAfterFailureForTests(
  dependencies: WindowsAppContainerNativeJobSettlementDependencies,
  settlementMs?: number
): boolean {
  return settleNativeJobAfterFailure(dependencies, settlementMs);
}

function normalizeExecutionError(
  error: unknown,
  fallback: WindowsAppContainerExecutionPhase,
  fallbackPreparationSubstage: WindowsAppContainerPreparationSubstage = 'unknown'
): WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError {
  if (error instanceof WindowsAppContainerCapabilityUnavailableError) {
    return error;
  }
  if (error instanceof WindowsAppContainerExecutionError) {
    if (fallback === 'preparation' && fallbackPreparationSubstage !== 'unknown' &&
      error.phase === 'preparation' && error.preparationSubstage === 'unknown') {
      const observation = error.nativeHelperObservation ?? nativeHelperObservations.get(error);
      const normalized = executionError(
        error.phase,
        error.nativeCode,
        error.hostToolFailure,
        fallbackPreparationSubstage,
        observation,
        error.nativeWorkerProgressStage
      );
      if (observation) nativeHelperObservations.set(normalized, observation);
      copyNativeHelperSettlement(error, normalized);
      return normalized;
    }
    return error;
  }
  return executionError(
    fallback,
    undefined,
    undefined,
    fallback === 'preparation' ? fallbackPreparationSubstage : undefined
  );
}

async function runPreparationStep<T>(
  substage: Exclude<WindowsAppContainerPreparationSubstage, 'unknown'>,
  operation: () => Promise<T> | T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizeExecutionError(error, 'preparation', substage);
  }
}

/** Pure test seam for the fail-closed unknown preparation normalization boundary. */
export function normalizeWindowsAppContainerPreparationErrorForTests(
  error: unknown,
  substage: WindowsAppContainerPreparationSubstage = 'unknown'
): WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError {
  return normalizeExecutionError(error, 'preparation', substage);
}

export function windowsAppContainerCapability(): WindowsAppContainerCapability {
  if (process.platform !== 'win32') {
    return Object.freeze({ status: 'unavailable', reason: 'non-windows' });
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    return Object.freeze({ status: 'unavailable', reason: 'unsupported-architecture' });
  }
  return Object.freeze({ status: 'available' });
}

function assertCapability(): void {
  if (windowsAppContainerCapability().status !== 'available') {
    throw new WindowsAppContainerCapabilityUnavailableError();
  }
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function foldedWindowsPath(filePath: string): string {
  return path.resolve(filePath).toLocaleLowerCase('en-US');
}

function sha256Hex(value: unknown): string {
  return rawSha256Hex(JSON.stringify(value));
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function authorizeExecutionCapability(
  capability: WindowsAppContainerExecutionCapability,
  stagingRoot: string
): Promise<WindowsAppContainerExecutionBindingReceipt> {
  try {
    return await assertWindowsAppContainerExecutionCapability(
      capability,
      path.resolve(stagingRoot)
    );
  } catch {
    throw executionError('invalid-input');
  }
}

async function authorizeExecutionRequest(
  request: WindowsAppContainerExecutionRequest
): Promise<WindowsAppContainerExecutionBindingReceipt> {
  return authorizeExecutionCapability(request.executionCapability, request.stagingRoot);
}

function authorizeNativeExecutionRequest(
  request: WindowsAppContainerNativeExecutionInput
): WindowsAppContainerExecutionBindingReceipt {
  try {
    return assertWindowsAppContainerExecutionBindingReceipt(
      request.executionBinding,
      path.resolve(request.stagingRoot)
    );
  } catch {
    throw executionError('invalid-input');
  }
}

function executionCommitFence(
  capability: WindowsAppContainerExecutionCapability,
  stagingRoot: string
): () => Promise<void> {
  return async () => {
    try {
      await assertWindowsAppContainerExecutionCapability(capability, path.resolve(stagingRoot));
    } catch {
      throw executionError('cleanup');
    }
  };
}

function nativeExecutionCommitFence(
  receipt: WindowsAppContainerExecutionBindingReceipt,
  stagingRoot: string
): () => Promise<void> {
  return async () => {
    try {
      assertWindowsAppContainerExecutionBindingReceipt(receipt, path.resolve(stagingRoot));
    } catch {
      throw executionError('cleanup');
    }
  };
}

async function validateExecutionRequest(
  request: Pick<WindowsAppContainerExecutionRequest, 'stagingRoot' | 'runnerRelativePath' | 'runnerArguments' | 'environment' | 'timeoutMs'>
): Promise<ValidatedExecutionBoundary> {
  if (!request || typeof request !== 'object' || typeof request.stagingRoot !== 'string' ||
    typeof request.runnerRelativePath !== 'string' ||
    !request.environment || typeof request.environment !== 'object' ||
    Array.isArray(request.environment)) {
    throw executionError('invalid-input');
  }
  if (request.timeoutMs !== undefined &&
    (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)) {
    throw executionError('invalid-input');
  }
  if (request.runnerArguments !== undefined &&
    (!Array.isArray(request.runnerArguments) ||
      request.runnerArguments.some((entry) => typeof entry !== 'string' || entry.includes('\0')))) {
    throw executionError('invalid-input');
  }

  const rootMetadata = await lstat(request.stagingRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw executionError('invalid-input');
  }
  const stagingRoot = path.resolve(request.stagingRoot);
  const canonicalRoot = await realpath(stagingRoot);
  if (foldedWindowsPath(canonicalRoot) !== foldedWindowsPath(stagingRoot)) {
    throw executionError('invalid-input');
  }
  const transactionRoot = path.dirname(canonicalRoot);
  const transactionMetadata = await lstat(transactionRoot);
  const canonicalTransactionRoot = await realpath(transactionRoot);
  if (!transactionMetadata.isDirectory() || transactionMetadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalTransactionRoot) !== foldedWindowsPath(transactionRoot)) {
    throw executionError('invalid-input');
  }
  const relativeInput = request.runnerRelativePath;
  if (relativeInput.length === 0 || relativeInput.includes('\0') || path.isAbsolute(relativeInput) ||
    relativeInput.split(/[\\/]/u).some((segment) => segment === '..' || segment.includes(':'))) {
    throw executionError('invalid-input');
  }
  const runnerPath = path.resolve(stagingRoot, relativeInput);
  if (!isInside(stagingRoot, runnerPath)) throw executionError('invalid-input');
  const runnerMetadata = await lstat(runnerPath);
  if (!runnerMetadata.isFile() || runnerMetadata.isSymbolicLink() || Number(runnerMetadata.nlink) !== 1) {
    throw executionError('invalid-input');
  }
  const canonicalRunner = await realpath(runnerPath);
  if (!isInside(canonicalRoot, canonicalRunner) ||
    foldedWindowsPath(canonicalRunner) !== foldedWindowsPath(runnerPath)) {
    throw executionError('invalid-input');
  }

  const runnerRelativePath = path.relative(stagingRoot, runnerPath);
  const stagingIdentityDigest = `sha256:${sha256Hex({
    domain: 'windows-appcontainer-staging-identity-v1',
    canonical: foldedWindowsPath(canonicalRoot),
    dev: String(rootMetadata.dev),
    ino: String(rootMetadata.ino)
  })}`;
  return { stagingRoot, transactionRoot, runnerRelativePath, stagingIdentityDigest };
}

function validateAndSortEnvironment(
  environment: Readonly<Record<string, string>>,
  stagingRoot: string
): readonly [string, string][] {
  const seen = new Set<string>();
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(environment)) {
    const foldedKey = key.toLocaleUpperCase('en-US');
    if (key.length === 0 || key.includes('=') || key.includes('\0') ||
      typeof value !== 'string' || value.includes('\0') || seen.has(foldedKey)) {
      throw executionError('invalid-input');
    }
    if (!WINDOWS_APPCONTAINER_ENVIRONMENT_KEYS.has(foldedKey)) {
      throw executionError('invalid-input');
    }
    seen.add(foldedKey);
    entries.push([key, value]);
  }
  const byKey = new Map(entries.map(([key, value]) => [key.toLocaleUpperCase('en-US'), value]));
  if (byKey.get('PATH') !== '' || !byKey.get('SYSTEMROOT') || !byKey.get('WINDIR')) {
    throw executionError('invalid-input');
  }
  for (const key of [
    'APPDATA',
    'BUN_INSTALL_CACHE_DIR',
    'HOME',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE'
  ]) {
    const value = byKey.get(key);
    if (value !== undefined && !isInside(stagingRoot, path.resolve(value))) {
      throw executionError('invalid-input');
    }
  }
  if (foldedWindowsPath(byKey.get('SYSTEMROOT')!) !== foldedWindowsPath(byKey.get('WINDIR')!)) {
    throw executionError('invalid-input');
  }
  for (const [key, expected] of [
    ['CI', 'true'],
    ['LANG', 'C'],
    ['LC_ALL', 'C'],
    ['SEC_ISOLATED_VERIFICATION', '1'],
    ['TZ', 'UTC']
  ] as const) {
    const value = byKey.get(key);
    if (value !== undefined && value !== expected) throw executionError('invalid-input');
  }
  for (const key of [
    'SEC_APPCONTAINER_PROBE_HTTP_PORT',
    'SEC_APPCONTAINER_PROBE_RAW_PORT',
    'TEST_PORT'
  ]) {
    const value = byKey.get(key);
    if (value !== undefined && (!/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 65_535)) {
      throw executionError('invalid-input');
    }
  }
  return entries.sort(([left], [right]) => compareCodeUnits(left, right));
}

function buildWindowsEnvironmentBlock(
  environment: Readonly<Record<string, string>>,
  stagingRoot: string
): Buffer {
  const entries = validateAndSortEnvironment(environment, stagingRoot);
  return Buffer.from(`${entries.map(([key, value]) => `${key}=${value}`).join('\0')}\0\0`, 'utf16le');
}

function quoteWindowsArgument(argument: string): string {
  if (argument.length === 0) return '""';
  if (!/[\s"]/u.test(argument)) return argument;
  let result = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }
    result += `${'\\'.repeat(backslashes)}${character}`;
    backslashes = 0;
  }
  return `${result}${'\\'.repeat(backslashes * 2)}"`;
}

async function materializeRuntime(
  stagingRoot: string,
  commitFence: () => Promise<void>
): Promise<string> {
  const runtimeRoot = path.join(stagingRoot, RUNTIME_DIRECTORY_NAME);
  await commitFence();
  await mkdir(runtimeRoot);

  const sourceExecutable = process.execPath;
  const sourceMetadata = await lstat(sourceExecutable);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw executionError('preparation', undefined, undefined, 'runtime-identity');
  }
  const executablePath = path.join(runtimeRoot, RUNTIME_EXECUTABLE_NAME);
  await commitFence();
  await copyFile(sourceExecutable, executablePath);
  const copiedMetadata = await lstat(executablePath);
  if (!copiedMetadata.isFile() || copiedMetadata.isSymbolicLink() || Number(copiedMetadata.nlink) !== 1 ||
    (String(sourceMetadata.dev) === String(copiedMetadata.dev) &&
      String(sourceMetadata.ino) === String(copiedMetadata.ino))) {
    throw executionError('preparation', undefined, undefined, 'runtime-identity');
  }

  const configRelativePath = path.join(RUNTIME_DIRECTORY_NAME, RUNTIME_CONFIG_NAME);
  await commitFence();
  await writeFile(path.join(stagingRoot, configRelativePath), ISOLATED_BUN_CONFIG_CONTENT, { flag: 'wx' });
  return runtimeRoot;
}

function prepareMaterializedExecution(
  stagingRoot: string,
  runnerRelativePath: string,
  runnerArguments: readonly string[],
  environment: Readonly<Record<string, string>>
): PreparedExecution {
  const runtimeRoot = path.join(stagingRoot, RUNTIME_DIRECTORY_NAME);
  const executablePath = path.join(runtimeRoot, RUNTIME_EXECUTABLE_NAME);
  const configPath = path.join(runtimeRoot, RUNTIME_CONFIG_NAME);
  const runnerPath = path.join(stagingRoot, runnerRelativePath);
  const bootstrapEnvironment = Object.fromEntries(validateAndSortEnvironment(environment, stagingRoot));
  // Bun 1.3.6 starts a SECURITY_CAPABILITIES child with an empty JS process.env
  // even when CreateProcessW receives a complete Unicode environment block.
  // Rebind the same validated replacement environment in the trusted bootstrap
  // before any staged module is imported. AppContainer ACL/network isolation is
  // already active, and no project-controlled code runs before this boundary.
  const bootstrap = [
    `const __secEnvironment=${JSON.stringify(bootstrapEnvironment)};`,
    'for(const key of Object.keys(process.env))delete process.env[key];',
    'for(const [key,value] of Object.entries(__secEnvironment))process.env[key]=value;',
    `process.chdir(${JSON.stringify(stagingRoot)});`,
    `await import(${JSON.stringify(pathToFileURL(runnerPath).href)});`
  ].join('');
  const argv = [
    executablePath,
    '--no-env-file',
    `--config=${configPath}`,
    '--no-install',
    '-e',
    bootstrap,
    ...runnerArguments
  ];
  const commandLine = windowsWide(argv.map(quoteWindowsArgument).join(' '));
  return {
    executablePath: windowsWide(executablePath),
    commandLine,
    currentDirectory: windowsWide(stagingRoot),
    environmentBlock: buildWindowsEnvironmentBlock(environment, stagingRoot)
  };
}

function sidBytesToString(bytes: Buffer): string {
  if (bytes.byteLength < 8) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  const revision = bytes.readUInt8(0);
  const subAuthorityCount = bytes.readUInt8(1);
  if (bytes.byteLength !== 8 + subAuthorityCount * 4) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  let identifierAuthority = 0n;
  for (let index = 2; index < 8; index += 1) {
    identifierAuthority = (identifierAuthority << 8n) | BigInt(bytes[index]!);
  }
  const subAuthorities: string[] = [];
  for (let index = 0; index < subAuthorityCount; index += 1) {
    subAuthorities.push(String(bytes.readUInt32LE(8 + index * 4)));
  }
  return `S-${revision}-${identifierAuthority}${subAuthorities.map((entry) => `-${entry}`).join('')}`;
}

function appContainerSidBytesFromString(sid: string): Buffer {
  const fields = sid.split('-');
  const subAuthorityFields = fields.slice(3);
  if (!/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(sid) || fields.length !== 11 ||
    fields[0] !== 'S' || fields[1] !== '1' || fields[2] !== '15' ||
    subAuthorityFields.length !== 8 || subAuthorityFields[0] !== '2') {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  const subAuthorities = subAuthorityFields.map((field) => {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) {
      throw executionError('preparation', undefined, undefined, 'sid-derivation');
    }
    const value = BigInt(field);
    if (value > 0xffff_ffffn) {
      throw executionError('preparation', undefined, undefined, 'sid-derivation');
    }
    return Number(value);
  });
  const bytes = Buffer.alloc(8 + subAuthorities.length * 4);
  bytes.writeUInt8(1, 0);
  bytes.writeUInt8(subAuthorities.length, 1);
  const identifierAuthority = 15n;
  for (let index = 0; index < 6; index += 1) {
    bytes.writeUInt8(
      Number((identifierAuthority >> BigInt((5 - index) * 8)) & 0xffn),
      2 + index
    );
  }
  for (const [index, value] of subAuthorities.entries()) {
    bytes.writeUInt32LE(value, 8 + index * 4);
  }
  if (sidBytesToString(bytes) !== sid) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  return bytes;
}

/** Pure ABI seam for the production-used Worker-owned AppContainer SID encoder. */
export function encodeWindowsAppContainerSidBytesForTests(sid: string): Buffer {
  return appContainerSidBytesFromString(sid);
}

async function loadAppContainerUserenv() {
  const { dlopen, FFIType } = await import('bun:ffi');
  return dlopen('userenv.dll', {
    DeriveAppContainerSidFromAppContainerName: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32
    },
    CreateAppContainerProfile: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr
      ],
      returns: FFIType.i32
    },
    DeleteAppContainerProfile: {
      args: [FFIType.ptr],
      returns: FFIType.i32
    }
  } as const);
}

let appContainerUserenvPromise: ReturnType<typeof loadAppContainerUserenv> | undefined;

function openAppContainerUserenv(): ReturnType<typeof loadAppContainerUserenv> {
  appContainerUserenvPromise ??= loadAppContainerUserenv();
  return appContainerUserenvPromise;
}

async function loadAppContainerAdvapi32() {
  const { dlopen, FFIType } = await import('bun:ffi');
  return dlopen('advapi32.dll', {
    IsValidSid: {
      args: [FFIType.ptr],
      returns: FFIType.i32
    },
    GetLengthSid: {
      args: [FFIType.ptr],
      returns: FFIType.u32
    }
  } as const);
}

let appContainerAdvapi32Promise: ReturnType<typeof loadAppContainerAdvapi32> | undefined;

function openAppContainerAdvapi32(): ReturnType<typeof loadAppContainerAdvapi32> {
  appContainerAdvapi32Promise ??= loadAppContainerAdvapi32();
  return appContainerAdvapi32Promise;
}

async function loadWindowsAppContainerKernel32() {
  const { dlopen, FFIType } = await import('bun:ffi');
  return dlopen('kernel32.dll', {
    GetSystemDirectoryW: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.u32
    },
    GetLastError: {
      args: [],
      returns: FFIType.u32
    },
    InitializeProcThreadAttributeList: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32
    },
    UpdateProcThreadAttribute: {
      args: [
        FFIType.ptr,
        FFIType.u32,
        FFIType.u64,
        FFIType.ptr,
        FFIType.u64,
        FFIType.ptr,
        FFIType.ptr
      ],
      returns: FFIType.i32
    },
    DeleteProcThreadAttributeList: {
      args: [FFIType.ptr],
      returns: FFIType.void
    },
    CreateFileW: {
      args: [
        FFIType.ptr,
        FFIType.u32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.u32,
        FFIType.u64
      ],
      returns: FFIType.u64
    },
    CreateProcessW: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.i32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr
      ],
      returns: FFIType.i32
    },
    CreateJobObjectW: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.u64
    },
    SetInformationJobObject: {
      args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32
    },
    ResumeThread: {
      args: [FFIType.u64],
      returns: FFIType.u32
    },
    WaitForSingleObject: {
      args: [FFIType.u64, FFIType.u32],
      returns: FFIType.u32
    },
    GetExitCodeProcess: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.i32
    },
    TerminateProcess: {
      args: [FFIType.u64, FFIType.u32],
      returns: FFIType.i32
    },
    TerminateJobObject: {
      args: [FFIType.u64, FFIType.u32],
      returns: FFIType.i32
    },
    QueryInformationJobObject: {
      args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32
    },
    Sleep: {
      args: [FFIType.u32],
      returns: FFIType.void
    },
    CloseHandle: {
      args: [FFIType.u64],
      returns: FFIType.i32
    }
  } as const);
}

let windowsAppContainerKernel32Promise: ReturnType<typeof loadWindowsAppContainerKernel32> | undefined;

function openWindowsAppContainerKernel32(): ReturnType<typeof loadWindowsAppContainerKernel32> {
  windowsAppContainerKernel32Promise ??= loadWindowsAppContainerKernel32();
  return windowsAppContainerKernel32Promise;
}

function sidPointerToString(
  sidPointer: Pointer,
  advapi32: Awaited<ReturnType<typeof openAppContainerAdvapi32>>,
  toBuffer: BunFfiToBuffer
): string {
  if (advapi32.symbols.IsValidSid(sidPointer) === 0) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  const sidLength = advapi32.symbols.GetLengthSid(sidPointer);
  if (sidLength < 8 || sidLength > MAXIMUM_SID_BYTES) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  const sid = sidBytesToString(Buffer.from(toBuffer(sidPointer, 0, sidLength)));
  if (!/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(sid)) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  return sid;
}

async function deriveAppContainerSidPointer(
  appContainerName: string
): Promise<Readonly<{ sid: string; sidPointer: Pointer }>> {
  let userenv: Awaited<ReturnType<typeof openAppContainerUserenv>> | undefined;
  let advapi32: Awaited<ReturnType<typeof openAppContainerAdvapi32>> | undefined;
  try {
    const { ptr, read, toBuffer } = await import('bun:ffi');
    userenv = await openAppContainerUserenv();
    advapi32 = await openAppContainerAdvapi32();
    const sidHolder = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes);
    const result = userenv.symbols.DeriveAppContainerSidFromAppContainerName(
      windowsWide(appContainerName),
      sidHolder
    );
    if (result < 0) {
      throw executionError('preparation', result, undefined, 'sid-derivation');
    }
    const sidPointer = read.ptr(ptr(sidHolder)) as Pointer;
    if (!sidPointer) {
      throw executionError('preparation', undefined, undefined, 'sid-derivation');
    }
    // Bun 1.3.6 can corrupt the process while FreeSid releases an FFI-returned
    // AppContainer SID. Every caller is a short-lived native helper, so the OS
    // reclaims this allocation at helper exit.
    return Object.freeze({
      sid: sidPointerToString(sidPointer, advapi32, toBuffer),
      sidPointer
    });
  } catch (error) {
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw new WindowsAppContainerCapabilityUnavailableError();
  }
}

export async function deriveWindowsAppContainerSidForNativeHelper(
  appContainerName: string
): Promise<string> {
  return (await deriveAppContainerSidPointer(appContainerName)).sid;
}

async function createAppContainerProfile(
  appContainerName: string,
  expectedSid: string,
  commitFence: () => Promise<void>
): Promise<void> {
  let userenv: Awaited<ReturnType<typeof openAppContainerUserenv>> | undefined;
  let advapi32: Awaited<ReturnType<typeof openAppContainerAdvapi32>> | undefined;
  try {
    const { ptr, read, toBuffer } = await import('bun:ffi');
    userenv = await openAppContainerUserenv();
    advapi32 = await openAppContainerAdvapi32();
    const sidHolder = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes);
    await commitFence();
    const result = userenv.symbols.CreateAppContainerProfile(
      windowsWide(appContainerName),
      windowsWide('SEC Semantic Mutation isolated verifier'),
      windowsWide('Ephemeral profile for one isolated Verification child'),
      null,
      0,
      sidHolder
    );
    if (result < 0) {
      throw executionError('preparation', result, undefined, 'profile-creation');
    }
    const sidPointer = read.ptr(ptr(sidHolder)) as Pointer;
    if (!sidPointer || sidPointerToString(sidPointer, advapi32, toBuffer) !== expectedSid) {
      throw executionError('preparation', undefined, undefined, 'profile-creation');
    }
  } catch (error) {
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw new WindowsAppContainerCapabilityUnavailableError();
  }
}

async function deleteAppContainerProfile(
  appContainerName: string,
  commitFence: () => Promise<void>
): Promise<void> {
  const userenv = await openAppContainerUserenv();
  await commitFence();
  if (userenv.symbols.DeleteAppContainerProfile(windowsWide(appContainerName)) < 0) {
    throw executionError('cleanup');
  }
}

async function windowsSystemDirectory(): Promise<string> {
  let kernel32: Awaited<ReturnType<typeof openWindowsAppContainerKernel32>> | undefined;
  try {
    kernel32 = await openWindowsAppContainerKernel32();
    const capacity = 32_768;
    const output = Buffer.alloc(capacity * 2);
    const length = kernel32.symbols.GetSystemDirectoryW(output, capacity);
    if (length === 0 || length >= capacity) {
      throw executionError('preparation', undefined, undefined, 'system-directory');
    }
    return output.subarray(0, length * 2).toString('utf16le');
  } catch (error) {
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw new WindowsAppContainerCapabilityUnavailableError();
  }
}

async function runIcacls(
  systemDirectory: string,
  args: readonly string[],
  commitFence: () => Promise<void>,
  phase: 'acl' | 'cleanup',
  stage: 'acl-grant' | 'acl-remove',
  signal?: AbortSignal
): Promise<string> {
  const result = await runFencedWindowsCommand(
    path.join(systemDirectory, 'icacls.exe'),
    args,
    systemDirectory,
    commitFence,
    phase,
    stage,
    signal
  );
  if (result.code !== 0) throw hostToolExecutionError(phase, stage, 'nonzero-exit');
  return result.stdout;
}

function hostToolTermination(
  result: ObservedCommandOutcome
): WindowsAppContainerHostToolFailure['termination'] {
  if (!result.termination.treeClosed) return 'unconfirmed';
  return result.termination.requested ? 'confirmed' : 'not-requested';
}

function hostToolFailureReason(
  result: ObservedCommandOutcome
): WindowsAppContainerHostToolFailureReason {
  switch (result.trigger) {
    case 'timed-out': return 'timeout';
    case 'fence-lost': return 'lease-loss';
    case 'lifecycle-failed': return 'lifecycle-failure';
    case 'observer-failed': return 'output-limit';
    case 'aborted': return 'aborted';
    default:
      return result.status === 'tree-unproven' || result.status === 'termination-unproven'
        ? 'termination-unconfirmed'
        : 'spawn';
  }
}

function projectWindowsAppContainerHostToolFailure(
  stage: WindowsAppContainerHostToolStage,
  result: ObservedCommandOutcome
): WindowsAppContainerHostToolFailure {
  return Object.freeze({
    stage,
    reason: hostToolFailureReason(result),
    termination: hostToolTermination(result)
  });
}

/** Test-only projection of the production orthogonal trigger/termination evidence. */
export function projectWindowsAppContainerHostToolFailureForTests(
  stage: WindowsAppContainerHostToolStage,
  result: ObservedCommandOutcome
): WindowsAppContainerHostToolFailure {
  return projectWindowsAppContainerHostToolFailure(stage, result);
}

function hostToolExecutionError(
  phase: 'acl' | 'cleanup',
  stage: WindowsAppContainerHostToolStage,
  reason: WindowsAppContainerHostToolFailureReason,
  termination: WindowsAppContainerHostToolFailure['termination'] = 'not-requested'
): WindowsAppContainerExecutionError {
  return executionError(phase, undefined, Object.freeze({ stage, reason, termination }));
}

interface WindowsAppContainerExecutionSteps {
  readonly grantAcl: () => Promise<void>;
  readonly createProfile: () => Promise<void>;
  readonly execute: () => Promise<void>;
}

async function runWindowsAppContainerExecutionSteps(
  steps: WindowsAppContainerExecutionSteps
): Promise<void> {
  await steps.grantAcl();
  await steps.createProfile();
  await steps.execute();
}

/** Test-only sequencing seam; production ownership remains in this module. */
export function runWindowsAppContainerExecutionStepsForTests(
  steps: WindowsAppContainerExecutionSteps
): Promise<void> {
  return runWindowsAppContainerExecutionSteps(steps);
}

type WindowsAppContainerFailure =
  | WindowsAppContainerCapabilityUnavailableError
  | WindowsAppContainerExecutionError;

async function completeWindowsAppContainerOwnedExecution<T>(
  result: T | undefined,
  primaryError: WindowsAppContainerFailure | undefined,
  cleanup: () => Promise<void>,
  missingResultPhase: WindowsAppContainerExecutionPhase
): Promise<T> {
  let cleanupError: WindowsAppContainerFailure | undefined;
  const terminationUnconfirmed = primaryError instanceof WindowsAppContainerExecutionError &&
    (primaryError.hostToolFailure?.termination === 'unconfirmed' ||
      executionRetainedOwners.has(primaryError));
  if (!terminationUnconfirmed) {
    try {
      await cleanup();
    } catch (error) {
      cleanupError = normalizeExecutionError(error, 'cleanup');
    }
  }
  if (primaryError) {
    if (cleanupError) rememberExecutionCleanupFailure(primaryError, cleanupError);
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
  if (result === undefined) throw executionError(missingResultPhase);
  return result;
}

/** Test-only entrypoint for the production cleanup suppression/settlement seam. */
export function completeWindowsAppContainerOwnedExecutionForTests<T>(
  result: T | undefined,
  primaryError: WindowsAppContainerFailure | undefined,
  cleanup: () => Promise<void>,
  missingResultPhase: WindowsAppContainerExecutionPhase = 'wait'
): Promise<T> {
  return completeWindowsAppContainerOwnedExecution(
    result,
    primaryError,
    cleanup,
    missingResultPhase
  );
}

async function runFencedWindowsCommand(
  executable: string,
  args: readonly string[],
  systemDirectory: string,
  commitFence: () => Promise<void>,
  phase: 'acl' | 'cleanup',
  stage: WindowsAppContainerHostToolStage,
  signal?: AbortSignal
): Promise<{ code: number; stdout: string }> {
  try {
    await commitFence();
  } catch {
    throw hostToolExecutionError(phase, stage, 'lease-loss');
  }
  const stdoutChunks: Buffer[] = [];
  const result = await runObservedCommand(executable, args, {
    cwd: systemDirectory,
    env: {
      PATH: '',
      SystemRoot: path.dirname(systemDirectory),
      WINDIR: path.dirname(systemDirectory)
    },
    envMode: 'replace',
    maxObservedOutputBytes: WINDOWS_HOST_TOOL_OUTPUT_LIMIT_BYTES,
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') stdoutChunks.push(Buffer.from(chunk));
    },
    signal,
    timeoutMs: WINDOWS_HOST_TOOL_DEADLINE_MS,
    whileRunning: commitFence
  });
  const stdout = Buffer.concat(stdoutChunks).toString();
  if (result.status === 'exited' && result.termination.treeClosed) {
    if (result.stdout.observerTruncated) {
      throw hostToolExecutionError(phase, stage, 'output-limit');
    }
    return { code: result.exitCode ?? 1, stdout };
  }
  throw executionError(phase, undefined, projectWindowsAppContainerHostToolFailure(stage, result));
}

async function appContainerProfileExists(
  systemDirectory: string,
  appContainerName: string,
  commitFence: () => Promise<void>,
  signal?: AbortSignal
): Promise<boolean> {
  const result = await runFencedWindowsCommand(
    path.join(systemDirectory, 'reg.exe'),
    [
      'query',
      'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings',
      '/s',
      '/f',
      appContainerName,
      '/d',
      '/e'
    ],
    systemDirectory,
    commitFence,
    'cleanup',
    'profile-query',
    signal
  );
  if (result.code !== 0 && result.code !== 1) {
    throw hostToolExecutionError('cleanup', 'profile-query', 'nonzero-exit');
  }
  return result.code === 0 &&
    result.stdout.toLocaleLowerCase('en-US').includes(appContainerName.toLocaleLowerCase('en-US'));
}

async function assertAppContainerAclAbsent(
  systemDirectory: string,
  stagingRoot: string,
  appContainerSid: string,
  commitFence: () => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const result = await runFencedWindowsCommand(
    path.join(systemDirectory, 'icacls.exe'),
    [stagingRoot, '/findsid', `*${appContainerSid}`, '/T', '/C', '/Q'],
    systemDirectory,
    commitFence,
    'cleanup',
    'acl-verify-absent',
    signal
  );
  if (result.code !== 0 && result.code !== 1) {
    throw hostToolExecutionError('cleanup', 'acl-verify-absent', 'nonzero-exit');
  }
  if (result.stdout.toLocaleLowerCase('en-US').includes(foldedWindowsPath(stagingRoot))) {
    throw executionError('cleanup', 21);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function fsyncDirectory(
  directory: string,
  commitFence?: () => Promise<void>
): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await commitFence?.();
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function durableCreateFile(
  filePath: string,
  contents: string,
  commitFence: () => Promise<void>
): Promise<void> {
  await commitFence();
  const handle = await open(filePath, 'wx');
  try {
    await commitFence();
    await handle.writeFile(contents, 'utf8');
    await commitFence();
    await handle.sync();
  } finally {
    await handle.close();
  }
  await commitFence();
  await fsyncDirectory(path.dirname(filePath), commitFence);
}

async function durableRemoveFile(
  filePath: string,
  commitFence: () => Promise<void>
): Promise<void> {
  await commitFence();
  await rm(filePath, { force: true });
  await commitFence();
  await fsyncDirectory(path.dirname(filePath), commitFence);
}

async function durableRemovePendingOwnerFile(
  pendingPath: string,
  commitFence: () => Promise<void>
): Promise<void> {
  await commitFence();
  if (!await pathExists(pendingPath)) return;
  const metadata = await lstat(pendingPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1) {
    throw executionError('cleanup');
  }
  await durableRemoveFile(pendingPath, commitFence);
}

interface DurableOwnerPublishTestHooks {
  readonly afterPendingDurableBeforeRename?: () => Promise<void>;
  readonly afterRenameBeforeDirectorySync?: () => Promise<void>;
}

async function durablePublishOwnerFile(
  ownerPath: string,
  pendingPath: string,
  contents: string,
  commitFence: () => Promise<void>,
  testHooks: DurableOwnerPublishTestHooks = {}
): Promise<void> {
  await commitFence();
  if (await pathExists(ownerPath) || await pathExists(pendingPath)) {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
  await durableCreateFile(pendingPath, contents, commitFence);
  await testHooks.afterPendingDurableBeforeRename?.();
  await commitFence();
  await rename(pendingPath, ownerPath);
  await testHooks.afterRenameBeforeDirectorySync?.();
  await commitFence();
  await fsyncDirectory(path.dirname(ownerPath), commitFence);
  const [metadata, canonicalContents] = await Promise.all([
    lstat(ownerPath),
    readFile(ownerPath, 'utf8')
  ]);
  if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1 ||
    canonicalContents !== contents) {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
}

async function materializeHostBunRuntime(
  stagingRoot: string,
  commitFence: () => Promise<void>
): Promise<{ readonly configPath: string; readonly helperPath: string }> {
  const processRoot = path.join(stagingRoot, '.isolated-process');
  await commitFence();
  await mkdir(processRoot, { recursive: true });
  const [processRootMetadata, canonicalProcessRoot] = await Promise.all([
    lstat(processRoot),
    realpath(processRoot)
  ]);
  if (!processRootMetadata.isDirectory() || processRootMetadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalProcessRoot) !== foldedWindowsPath(processRoot)) {
    throw executionError('preparation', undefined, undefined, 'native-helper-materialization');
  }

  const configRoot = path.join(stagingRoot, HOST_BUN_CONFIG_RELATIVE_ROOT);
  if (await pathExists(configRoot)) {
    const [metadata, canonicalRoot] = await Promise.all([
      lstat(configRoot),
      realpath(configRoot)
    ]);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      foldedWindowsPath(canonicalRoot) !== foldedWindowsPath(configRoot)) {
      throw executionError('preparation', undefined, undefined, 'native-helper-materialization');
    }
    await commitFence();
    await rm(configRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
  await commitFence();
  await mkdir(configRoot);
  const [configRootMetadata, canonicalConfigRoot] = await Promise.all([
    lstat(configRoot),
    realpath(configRoot)
  ]);
  if (!configRootMetadata.isDirectory() || configRootMetadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalConfigRoot) !== foldedWindowsPath(configRoot)) {
    throw executionError('preparation', undefined, undefined, 'native-helper-materialization');
  }

  const configPath = path.join(configRoot, RUNTIME_CONFIG_NAME);
  await durableCreateFile(configPath, ISOLATED_BUN_CONFIG_CONTENT, commitFence);
  let helperCapability: WindowsAppContainerNativeHelperCapability;
  let helperBundle: Uint8Array;
  try {
    helperCapability = await acquireWindowsAppContainerNativeHelperCapability();
    helperBundle = readWindowsAppContainerNativeHelperCapability(helperCapability);
  } catch (error) {
    const failure = error instanceof WindowsAppContainerNativeHelperMaterializationError
      ? error.failure
      : 'native-helper-build';
    const substage: WindowsAppContainerPreparationSubstage = failure === 'native-helper-capability'
      ? 'native-helper-bundle-contract'
      : failure;
    throw executionError('preparation', undefined, undefined, substage);
  }
  const helperContents = new TextDecoder().decode(helperBundle);
  const helperPath = path.join(configRoot, NATIVE_HELPER_BUNDLE_NAME);
  await durableCreateFile(helperPath, helperContents, commitFence);
  const [configMetadata, canonicalConfigPath, configContents] = await Promise.all([
    lstat(configPath),
    realpath(configPath),
    readFile(configPath, 'utf8')
  ]);
  if (!configMetadata.isFile() || configMetadata.isSymbolicLink() || Number(configMetadata.nlink) !== 1 ||
    foldedWindowsPath(canonicalConfigPath) !== foldedWindowsPath(configPath) ||
    configContents !== ISOLATED_BUN_CONFIG_CONTENT) {
    throw executionError('preparation', undefined, undefined, 'native-helper-materialization');
  }
  const [helperMetadata, canonicalHelperPath, materializedHelper] = await Promise.all([
    lstat(helperPath),
    realpath(helperPath),
    readFile(helperPath)
  ]);
  if (!helperMetadata.isFile() || helperMetadata.isSymbolicLink() || Number(helperMetadata.nlink) !== 1 ||
    foldedWindowsPath(canonicalHelperPath) !== foldedWindowsPath(helperPath) ||
    rawSha256(materializedHelper) !== helperCapability.contentDigest) {
    throw executionError('preparation', undefined, undefined, 'native-helper-materialization');
  }
  return { configPath, helperPath };
}

async function cleanupHostBunConfig(
  stagingRoot: string,
  commitFence: () => Promise<void>
): Promise<void> {
  const configRoot = path.join(stagingRoot, HOST_BUN_CONFIG_RELATIVE_ROOT);
  if (!(await pathExists(configRoot))) return;
  const [metadata, canonicalRoot] = await Promise.all([
    lstat(configRoot),
    realpath(configRoot)
  ]);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalRoot) !== foldedWindowsPath(configRoot)) {
    throw executionError('cleanup');
  }
  await commitFence();
  await rm(configRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  await commitFence();
  if (await pathExists(configRoot)) throw executionError('cleanup');
}

interface HostBunCommandResult {
  readonly code: number;
  readonly payload: string;
  readonly diagnosticPresent: boolean;
}

function settleObservedHostBunCommand(
  mode: NativeHelperMode,
  outcome: ObservedCommandOutcome,
  stdoutChunks: readonly Uint8Array[],
  diagnostic: NativeHelperDiagnosticCapture
): HostBunCommandResult {
  const stdout = Buffer.concat(stdoutChunks.map((chunk) => Buffer.from(chunk)));
  const closedTree = outcome.termination.childCloseObserved &&
    outcome.termination.streamsDrained && outcome.termination.treeClosed;
  const cleanupSafe = outcome.started
    ? closedTree
    : outcome.termination.streamsDrained && outcome.termination.treeClosed;
  const classification = classifyNativeHelperSettlement(
    outcome,
    stdout,
    diagnostic
  );
  if (classification.status !== 'success' || outcome.exitCode === null) {
    const rejection: NativeHelperSettlementClassification =
      classification.status === 'rejected'
        ? classification
        : NATIVE_HELPER_EXIT_STATUS_UNPROVEN;
    const error = executionError(
      'preparation', undefined, undefined, 'native-helper-invocation'
    );
    bindNativeHelperSettlement(error, mode, rejection);
    if (!cleanupSafe) executionRetainedOwners.add(error);
    throw error;
  }
  return Object.freeze({
    code: outcome.exitCode,
    payload: stdout.toString(),
    diagnosticPresent: diagnostic.present
  });
}

function observedDiagnosticCaptureForTests(
  stderr: Uint8Array
): NativeHelperDiagnosticCapture {
  return Object.freeze({
    bytes: stderr.byteLength,
    digest: rawSha256(stderr),
    present: stderr.byteLength > 0
  });
}

/** Test-only finite projection; it returns no process or wire values. */
export function classifyObservedWindowsAppContainerNativeHelperForTests(
  outcome: ObservedCommandOutcome,
  stdout: Uint8Array,
  stderr: Uint8Array
): NativeHelperSettlementClassification {
  return classifyNativeHelperSettlement(
    outcome,
    stdout,
    observedDiagnosticCaptureForTests(stderr)
  );
}

/** Test-only settlement seam; production bytes come only from the observed pipes. */
export function settleObservedWindowsAppContainerNativeHelperForTests(
  outcome: ObservedCommandOutcome,
  stdout: Uint8Array,
  stderr: Uint8Array,
  mode: NativeHelperMode = 'execute'
): HostBunCommandResult {
  return settleObservedHostBunCommand(
    mode,
    outcome,
    [stdout],
    observedDiagnosticCaptureForTests(stderr)
  );
}

async function runHostBunCommand(
  mode: NativeHelperMode,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined,
  encodedRequest: string
) {
  let materialized: Awaited<ReturnType<typeof materializeHostBunRuntime>>;
  try {
    materialized = await materializeHostBunRuntime(stagingRoot, commitFence);
  } catch (error) {
    throw normalizeExecutionError(error, 'preparation', 'native-helper-materialization');
  }
  const { configPath, helperPath } = materialized;
  let result: HostBunCommandResult | undefined;
  let primaryError: WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError | undefined;
  try {
    const stdoutChunks: Buffer[] = [];
    const diagnosticDigest = createSha256Hasher();
    let diagnosticBytes = 0;
    let diagnosticPresent = false;
    const observed = await runObservedCommand(process.execPath, [
      '--no-env-file',
      `--config=${configPath}`,
      '--no-install',
      helperPath,
      encodedRequest
    ], {
      beforeSpawn: commitFence,
      // libuv cannot spawn with a Windows working directory beyond MAX_PATH even
      // though Bun can read the absolute long-path config and helper arguments.
      // The trusted helper uses only absolute staging-bound paths, so keep the
      // process cwd at the volume root while the executable payload stays fenced.
      cwd: path.parse(stagingRoot).root,
      envMode: 'replace',
      env: environment,
      maxObservedOutputBytes: WINDOWS_HOST_TOOL_OUTPUT_LIMIT_BYTES,
      onOutput: (stream, chunk) => {
        if (stream === 'stdout') {
          stdoutChunks.push(Buffer.from(chunk));
          return;
        }
        diagnosticBytes += chunk.byteLength;
        diagnosticDigest.update(chunk);
        if (chunk.byteLength > 0) diagnosticPresent = true;
      },
      timeoutMs,
      whileRunning: commitFence
    });
    result = settleObservedHostBunCommand(mode, observed, stdoutChunks, Object.freeze({
      bytes: diagnosticBytes,
      digest: diagnosticDigest.finish(),
      present: diagnosticPresent
    }));
    await commitFence();
  } catch (error) {
    primaryError = normalizeExecutionError(error,
      'preparation',
      'native-helper-invocation'
    );
  }
  return completeWindowsAppContainerOwnedExecution(
    result,
    primaryError,
    () => cleanupHostBunConfig(stagingRoot, commitFence),
    'preparation'
  );
}

function buildAppContainerName(stagingRoot: string, stagingIdentityDigest: string): string {
  const rootDigest = sha256Hex({
    domain: 'windows-appcontainer-staging-path-v1',
    path: foldedWindowsPath(stagingRoot)
  }).slice(0, 12);
  const identityDigest = sha256Hex({
    domain: 'windows-appcontainer-profile-identity-v1',
    stagingIdentityDigest
  }).slice(0, 24);
  return `sec.sm3.${rootDigest}.${identityDigest}`;
}

async function executeNativeAppContainer(
  appContainerSidBytes: Buffer,
  prepared: PreparedExecution,
  executionBudget: NativeExecutionBudget,
  commitFence: () => Promise<void>,
  suspendedCreateOnly = false,
  onProgress?: (
    stage: Exclude<WindowsAppContainerNativeWorkerProgressStage, 'not-observed'>
  ) => void
): Promise<number> {
  let kernel32: Awaited<ReturnType<typeof openWindowsAppContainerKernel32>> | undefined;
  let attributeList: Buffer | undefined;
  let attributeListInitialized = false;
  const attributePayloads: Buffer[] = [];
  let processHandle = 0n;
  let threadHandle = 0n;
  let jobHandle = 0n;
  let standardInputHandle = 0n;
  let standardOutputHandle = 0n;
  let standardErrorHandle = 0n;
  let executionCommitted = false;

  try {
    const { ptr } = await import('bun:ffi');
    kernel32 = await openWindowsAppContainerKernel32();
    attributePayloads.push(appContainerSidBytes);
    const appContainerSidPointer = ptr(appContainerSidBytes);

    const securityCapabilities = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityCapabilitiesBytes
    );
    securityCapabilities.writeBigUInt64LE(
      BigInt(appContainerSidPointer),
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityCapabilitiesAppContainerSidOffset
    );
    securityCapabilities.writeBigUInt64LE(
      0n,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityCapabilitiesCapabilitiesOffset
    );
    securityCapabilities.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.capabilityCount,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityCapabilitiesCapabilityCountOffset
    );
    securityCapabilities.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.reserved,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityCapabilitiesReservedOffset
    );
    attributePayloads.push(securityCapabilities);
    const inheritableHandleSecurityAttributes = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityAttributesBytes
    );
    inheritableHandleSecurityAttributes.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityAttributesBytes,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityAttributesLengthOffset
    );
    inheritableHandleSecurityAttributes.writeBigUInt64LE(
      0n,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityAttributesDescriptorOffset
    );
    inheritableHandleSecurityAttributes.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.inheritHandles,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.securityAttributesInheritHandleOffset
    );
    const nullDeviceName = windowsWide('NUL');
    const openNullHandle = (desiredAccess: number): bigint => {
      const handle = kernel32!.symbols.CreateFileW(
        nullDeviceName,
        desiredAccess,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        inheritableHandleSecurityAttributes,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        0n
      );
      if (handle === 0n || handle === INVALID_HANDLE_VALUE) throw executionError('launch');
      return handle;
    };
    standardInputHandle = openNullHandle(GENERIC_READ);
    standardOutputHandle = openNullHandle(GENERIC_WRITE);
    standardErrorHandle = openNullHandle(GENERIC_WRITE);

    const standardHandleList = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes *
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.standardHandleCount
    );
    standardHandleList.writeBigUInt64LE(standardInputHandle, 0);
    standardHandleList.writeBigUInt64LE(
      standardOutputHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes
    );
    standardHandleList.writeBigUInt64LE(
      standardErrorHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes * 2
    );
    attributePayloads.push(standardHandleList);

    const jobInformation = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.jobObjectExtendedLimitInformationBytes
    );
    jobInformation.writeUInt32LE(
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.jobObjectLimitFlagsOffset
    );
    jobHandle = kernel32.symbols.CreateJobObjectW(null, null);
    if (jobHandle === 0n || kernel32.symbols.SetInformationJobObject(
      jobHandle,
      JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
      jobInformation,
      jobInformation.byteLength
    ) === 0) {
      throw executionError('launch');
    }
    const jobHandleList = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes);
    jobHandleList.writeBigUInt64LE(jobHandle, 0);
    attributePayloads.push(jobHandleList);

    const attributeListSize = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT.pointerBytes);
    kernel32.symbols.InitializeProcThreadAttributeList(
      null,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.procThreadAttributeCount,
      0,
      attributeListSize
    );
    const requiredAttributeBytes = Number(attributeListSize.readBigUInt64LE(0));
    if (!Number.isSafeInteger(requiredAttributeBytes) || requiredAttributeBytes <= 0 ||
      requiredAttributeBytes > MAXIMUM_ATTRIBUTE_LIST_BYTES) {
      throw executionError('launch');
    }
    attributeList = Buffer.alloc(requiredAttributeBytes);
    if (kernel32.symbols.InitializeProcThreadAttributeList(
      attributeList,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.procThreadAttributeCount,
      0,
      attributeListSize
    ) === 0) {
      throw executionError('launch');
    }
    attributeListInitialized = true;
    if (kernel32.symbols.UpdateProcThreadAttribute(
      attributeList,
      0,
      BigInt(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES),
      securityCapabilities,
      BigInt(securityCapabilities.byteLength),
      null,
      null
    ) === 0) {
      throw executionError('launch');
    }
    if (kernel32.symbols.UpdateProcThreadAttribute(
      attributeList,
      0,
      BigInt(PROC_THREAD_ATTRIBUTE_HANDLE_LIST),
      standardHandleList,
      BigInt(standardHandleList.byteLength),
      null,
      null
    ) === 0) {
      throw executionError('launch');
    }
    if (kernel32.symbols.UpdateProcThreadAttribute(
      attributeList,
      0,
      BigInt(PROC_THREAD_ATTRIBUTE_JOB_LIST),
      jobHandleList,
      BigInt(jobHandleList.byteLength),
      null,
      null
    ) === 0) {
      throw executionError('launch');
    }
    const startupInfoEx = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExBytes);
    startupInfoEx.writeUInt32LE(WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExBytes, 0);
    startupInfoEx.writeUInt32LE(
      STARTF_USESTDHANDLES,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExFlagsOffset
    );
    startupInfoEx.writeBigUInt64LE(
      standardInputHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExStdInputOffset
    );
    startupInfoEx.writeBigUInt64LE(
      standardOutputHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExStdOutputOffset
    );
    startupInfoEx.writeBigUInt64LE(
      standardErrorHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExStdErrorOffset
    );
    startupInfoEx.writeBigUInt64LE(
      BigInt(ptr(attributeList)),
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.startupInfoExAttributeListOffset
    );

    const processInformation = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.processInformationBytes
    );
    await commitFence();
    remainingNativeExecutionBudget(executionBudget, Date.now());
    const applicationName = suspendedCreateOnly
      ? windowsWide(process.execPath)
      : prepared.executablePath;
    const commandLine = suspendedCreateOnly
      ? windowsWide(quoteWindowsArgument(process.execPath))
      : prepared.commandLine;
    const environmentBlock = suspendedCreateOnly
      ? null
      : prepared.environmentBlock;
    const currentDirectory = suspendedCreateOnly
      ? null
      : prepared.currentDirectory;
    onProgress?.('create-entered');
    const createResult = kernel32.symbols.CreateProcessW(
      applicationName,
      commandLine,
      null,
      null,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.inheritHandles,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.creationFlags,
      environmentBlock,
      currentDirectory,
      startupInfoEx,
      processInformation
    );
    onProgress?.('create-returned');
    if (createResult === 0) throw executionError('launch', kernel32.symbols.GetLastError());
    processHandle = processInformation.readBigUInt64LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.processInformationProcessHandleOffset
    );
    threadHandle = processInformation.readBigUInt64LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT.processInformationThreadHandleOffset
    );
    if (processHandle === 0n || threadHandle === 0n) {
      throw executionError('launch');
    }
    if (suspendedCreateOnly) {
      const jobAccounting = Buffer.alloc(
        WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_BYTES
      );
      if (!settleNativeJobAfterFailure({
        nowMs: Date.now,
        terminateJob: () => kernel32!.symbols.TerminateJobObject(
          jobHandle,
          TERMINATED_EXIT_CODE
        ) !== 0,
        waitForRoot: (timeoutMs) => kernel32!.symbols.WaitForSingleObject(
          processHandle,
          timeoutMs
        ),
        queryActiveProcesses: () => kernel32!.symbols.QueryInformationJobObject(
          jobHandle,
          WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
          jobAccounting,
          jobAccounting.byteLength,
          null
        ) === 0
          ? null
          : jobAccounting.readUInt32LE(WINDOWS_JOB_OBJECT_ACTIVE_PROCESSES_OFFSET),
        sleep: (timeoutMs) => kernel32!.symbols.Sleep(timeoutMs)
      })) throw executionError('wait');
      onProgress?.('job-settled');
      await commitFence();
      remainingNativeExecutionBudget(executionBudget, Date.now());
      executionCommitted = true;
      return 0;
    }
    await commitFence();
    remainingNativeExecutionBudget(executionBudget, Date.now());
    if (kernel32.symbols.ResumeThread(threadHandle) === MAXIMUM_RESUME_THREAD_RESULT) {
      throw executionError('launch');
    }
    kernel32.symbols.CloseHandle(threadHandle);
    threadHandle = 0n;

    waitForNativeProcess(executionBudget, {
      nowMs: Date.now,
      waitForProcess: (timeoutMs) => kernel32!.symbols.WaitForSingleObject(
        processHandle,
        timeoutMs
      )
    });

    const exitCodeBuffer = Buffer.alloc(4);
    if (kernel32.symbols.GetExitCodeProcess(processHandle, exitCodeBuffer) === 0) {
      throw executionError('wait');
    }
    const exitCode = exitCodeBuffer.readUInt32LE(0);
    executionCommitted = true;
    return exitCode;
  } catch (error) {
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw new WindowsAppContainerCapabilityUnavailableError();
  } finally {
    if (kernel32) {
      if (processHandle !== 0n && !executionCommitted) {
        const jobAccounting = Buffer.alloc(
          WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_BYTES
        );
        const settled = jobHandle !== 0n && settleNativeJobAfterFailure({
          nowMs: Date.now,
          terminateJob: () => kernel32!.symbols.TerminateJobObject(
            jobHandle,
            TERMINATED_EXIT_CODE
          ) !== 0,
          waitForRoot: (timeoutMs) => kernel32!.symbols.WaitForSingleObject(
            processHandle,
            timeoutMs
          ),
          queryActiveProcesses: () => kernel32!.symbols.QueryInformationJobObject(
            jobHandle,
            WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
            jobAccounting,
            jobAccounting.byteLength,
            null
          ) === 0
            ? null
            : jobAccounting.readUInt32LE(WINDOWS_JOB_OBJECT_ACTIVE_PROCESSES_OFFSET),
          sleep: (timeoutMs) => kernel32!.symbols.Sleep(timeoutMs)
        });
        if (!settled) kernel32.symbols.TerminateProcess(processHandle, TERMINATED_EXIT_CODE);
      }
      if (jobHandle !== 0n) {
        kernel32.symbols.CloseHandle(jobHandle);
      }
      if (threadHandle !== 0n) kernel32.symbols.CloseHandle(threadHandle);
      if (processHandle !== 0n) kernel32.symbols.CloseHandle(processHandle);
      if (standardErrorHandle !== 0n && standardErrorHandle !== INVALID_HANDLE_VALUE) {
        kernel32.symbols.CloseHandle(standardErrorHandle);
      }
      if (standardOutputHandle !== 0n && standardOutputHandle !== INVALID_HANDLE_VALUE) {
        kernel32.symbols.CloseHandle(standardOutputHandle);
      }
      if (standardInputHandle !== 0n && standardInputHandle !== INVALID_HANDLE_VALUE) {
        kernel32.symbols.CloseHandle(standardInputHandle);
      }
      if (attributeListInitialized && attributeList) {
        kernel32.symbols.DeleteProcThreadAttributeList(attributeList);
      }
      for (const payload of attributePayloads) void payload.byteLength;
    }
  }
}

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  return canonicalEquals(Object.keys(value).sort(), [...expected].sort());
}

function recoveryOwnerLooksValid(value: unknown): value is WindowsAppContainerRecoveryOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'appContainerName',
    'appContainerSid',
    'formatVersion',
    'resultFileName',
    'runtimeRelativePath',
    'stagingDirectoryName',
    'stagingIdentityDigest',
    'workspaceIdentityDigest'
  ])) return false;
  const owner = value as Record<string, unknown>;
  return owner.formatVersion === RECOVERY_OWNER_FORMAT_VERSION &&
    owner.runtimeRelativePath === RUNTIME_DIRECTORY_NAME &&
    (owner.resultFileName === NATIVE_RESULT_FILE_NAME ||
      owner.resultFileName === LEGACY_NATIVE_RESULT_FILE_NAME) &&
    typeof owner.workspaceIdentityDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(owner.workspaceIdentityDigest) &&
    typeof owner.stagingIdentityDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(owner.stagingIdentityDigest) &&
    typeof owner.stagingDirectoryName === 'string' && owner.stagingDirectoryName.length > 0 &&
    path.basename(owner.stagingDirectoryName) === owner.stagingDirectoryName &&
    typeof owner.appContainerName === 'string' && /^sec\.sm3\.[0-9a-f]{12}\.[0-9a-f]{24}$/u.test(owner.appContainerName) &&
    typeof owner.appContainerSid === 'string' && /^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(owner.appContainerSid);
}

function provisionalOwnerLooksValid(value: unknown): value is WindowsAppContainerProvisionalOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'appContainerName',
    'formatVersion',
    'hostBunConfigRelativePath',
    'stagingDirectoryName',
    'stagingIdentityDigest',
    'workspaceIdentityDigest'
  ])) return false;
  const owner = value as Record<string, unknown>;
  return owner.formatVersion === PROVISIONAL_OWNER_FORMAT_VERSION &&
    owner.hostBunConfigRelativePath === HOST_BUN_CONFIG_RELATIVE_ROOT &&
    typeof owner.workspaceIdentityDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(owner.workspaceIdentityDigest) &&
    typeof owner.stagingIdentityDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(owner.stagingIdentityDigest) &&
    typeof owner.stagingDirectoryName === 'string' && owner.stagingDirectoryName.length > 0 &&
    path.basename(owner.stagingDirectoryName) === owner.stagingDirectoryName &&
    typeof owner.appContainerName === 'string' && /^sec\.sm3\.[0-9a-f]{12}\.[0-9a-f]{24}$/u.test(owner.appContainerName);
}

function probeOwnerLooksValid(value: unknown): value is WindowsAppContainerProbeOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'formatVersion',
    'outerCanaryName',
    'outerStagingIdentityDigest',
    'outerWorkspaceIdentityDigest',
    'parentCanaryName',
    'probeStagingDirectoryName',
    'probeWorkspaceIdentityDigest'
  ])) return false;
  const owner = value as Record<string, unknown>;
  const canaryNamesAreCurrent = owner.outerCanaryName === CAPABILITY_OUTER_CANARY_NAME &&
    owner.parentCanaryName === CAPABILITY_PARENT_CANARY_NAME;
  const canaryNamesAreLegacy = owner.outerCanaryName === LEGACY_CAPABILITY_OUTER_CANARY_NAME &&
    owner.parentCanaryName === LEGACY_CAPABILITY_PARENT_CANARY_NAME;
  return owner.formatVersion === PROBE_OWNER_FORMAT_VERSION &&
    (canaryNamesAreCurrent || canaryNamesAreLegacy) &&
    owner.probeStagingDirectoryName === 's' &&
    typeof owner.outerWorkspaceIdentityDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(owner.outerWorkspaceIdentityDigest) &&
    typeof owner.probeWorkspaceIdentityDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(owner.probeWorkspaceIdentityDigest) &&
    typeof owner.outerStagingIdentityDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(owner.outerStagingIdentityDigest);
}

async function validateRecoveryStagingBoundary(
  stagingRootInput: string
): Promise<Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>> {
  if (typeof stagingRootInput !== 'string') {
    throw executionError('invalid-input');
  }
  const stagingRoot = path.resolve(stagingRootInput);
  const [stagingMetadata, canonicalStagingRoot] = await Promise.all([
    lstat(stagingRoot),
    realpath(stagingRoot)
  ]);
  if (!stagingMetadata.isDirectory() || stagingMetadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalStagingRoot) !== foldedWindowsPath(stagingRoot)) {
    throw executionError('invalid-input');
  }
  const transactionRoot = path.dirname(canonicalStagingRoot);
  const [transactionMetadata, canonicalTransactionRoot] = await Promise.all([
    lstat(transactionRoot),
    realpath(transactionRoot)
  ]);
  if (!transactionMetadata.isDirectory() || transactionMetadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalTransactionRoot) !== foldedWindowsPath(transactionRoot)) {
    throw executionError('invalid-input');
  }
  return {
    stagingRoot,
    transactionRoot,
    stagingIdentityDigest: `sha256:${sha256Hex({
      domain: 'windows-appcontainer-staging-identity-v1',
      canonical: foldedWindowsPath(canonicalStagingRoot),
      dev: String(stagingMetadata.dev),
      ino: String(stagingMetadata.ino)
    })}`
  };
}

type AppContainerArtifactGeneration = 'current' | 'legacy';

interface DurableOwnerArtifactPaths {
  readonly generation: AppContainerArtifactGeneration;
  readonly ownerPath: string;
  readonly pendingPath: string;
}

function recoveryOwnerArtifactPaths(
  transactionRoot: string,
  generation: AppContainerArtifactGeneration = 'current'
): DurableOwnerArtifactPaths {
  return generation === 'current'
    ? Object.freeze({
      generation,
      ownerPath: path.join(transactionRoot, RECOVERY_OWNER_FILE_NAME),
      pendingPath: path.join(transactionRoot, RECOVERY_OWNER_PENDING_FILE_NAME)
    })
    : Object.freeze({
      generation,
      ownerPath: path.join(transactionRoot, LEGACY_RECOVERY_OWNER_FILE_NAME),
      pendingPath: path.join(transactionRoot, LEGACY_RECOVERY_OWNER_PENDING_FILE_NAME)
    });
}

function provisionalOwnerArtifactPaths(
  transactionRoot: string,
  generation: AppContainerArtifactGeneration = 'current'
): DurableOwnerArtifactPaths {
  return generation === 'current'
    ? Object.freeze({
      generation,
      ownerPath: path.join(transactionRoot, PROVISIONAL_OWNER_FILE_NAME),
      pendingPath: path.join(transactionRoot, PROVISIONAL_OWNER_PENDING_FILE_NAME)
    })
    : Object.freeze({
      generation,
      ownerPath: path.join(transactionRoot, LEGACY_PROVISIONAL_OWNER_FILE_NAME),
      pendingPath: path.join(transactionRoot, LEGACY_PROVISIONAL_OWNER_PENDING_FILE_NAME)
    });
}

function probeOwnerArtifactPaths(
  probeRoot: string,
  generation: AppContainerArtifactGeneration = 'current'
): DurableOwnerArtifactPaths {
  return generation === 'current'
    ? Object.freeze({
      generation,
      ownerPath: path.join(probeRoot, PROBE_OWNER_FILE_NAME),
      pendingPath: path.join(probeRoot, PROBE_OWNER_PENDING_FILE_NAME)
    })
    : Object.freeze({
      generation,
      ownerPath: path.join(probeRoot, LEGACY_PROBE_OWNER_FILE_NAME),
      pendingPath: path.join(probeRoot, LEGACY_PROBE_OWNER_PENDING_FILE_NAME)
    });
}

async function selectDurableOwnerArtifactPaths(
  current: DurableOwnerArtifactPaths,
  legacy: DurableOwnerArtifactPaths
): Promise<DurableOwnerArtifactPaths | undefined> {
  const [currentOwner, currentPending, legacyOwner, legacyPending] = await Promise.all([
    pathExists(current.ownerPath),
    pathExists(current.pendingPath),
    pathExists(legacy.ownerPath),
    pathExists(legacy.pendingPath)
  ]);
  const currentExists = currentOwner || currentPending;
  const legacyExists = legacyOwner || legacyPending;
  if (currentExists && legacyExists) throw executionError('cleanup');
  if (currentExists) return current;
  if (legacyExists) return legacy;
  return undefined;
}

function nativeResultPath(
  transactionRoot: string,
  generation: AppContainerArtifactGeneration = 'current'
): string {
  return path.join(
    transactionRoot,
    generation === 'current' ? NATIVE_RESULT_FILE_NAME : LEGACY_NATIVE_RESULT_FILE_NAME
  );
}

function nativeResultPathForOwner(
  transactionRoot: string,
  owner: WindowsAppContainerRecoveryOwner
): string {
  return path.join(transactionRoot, owner.resultFileName);
}

function canaryNamesForGeneration(generation: AppContainerArtifactGeneration): Readonly<{
  parent: WindowsAppContainerProbeOwner['parentCanaryName'];
  outer: WindowsAppContainerProbeOwner['outerCanaryName'];
}> {
  return generation === 'current'
    ? Object.freeze({ parent: CAPABILITY_PARENT_CANARY_NAME, outer: CAPABILITY_OUTER_CANARY_NAME })
    : Object.freeze({
      parent: LEGACY_CAPABILITY_PARENT_CANARY_NAME,
      outer: LEGACY_CAPABILITY_OUTER_CANARY_NAME
    });
}

async function assertRecoveryOwner(
  owner: WindowsAppContainerRecoveryOwner,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  executionBinding: WindowsAppContainerExecutionBindingReceipt,
  requestedNativeResultPath: string,
  knownOwnerPaths?: DurableOwnerArtifactPaths
): Promise<void> {
  const ownerPaths = knownOwnerPaths ?? await selectDurableOwnerArtifactPaths(
    recoveryOwnerArtifactPaths(boundary.transactionRoot),
    recoveryOwnerArtifactPaths(boundary.transactionRoot, 'legacy')
  );
  if (!ownerPaths) throw executionError('cleanup');
  const expectedResultFileName = ownerPaths.generation === 'current'
    ? NATIVE_RESULT_FILE_NAME
    : LEGACY_NATIVE_RESULT_FILE_NAME;
  if (!recoveryOwnerLooksValid(owner) ||
    owner.resultFileName !== expectedResultFileName ||
    owner.workspaceIdentityDigest !== executionBinding.authorityBindingDigest ||
    owner.stagingIdentityDigest !== boundary.stagingIdentityDigest ||
    owner.stagingDirectoryName !== path.basename(boundary.stagingRoot) ||
    owner.appContainerName !== buildAppContainerName(boundary.stagingRoot, boundary.stagingIdentityDigest) ||
    foldedWindowsPath(requestedNativeResultPath) !==
      foldedWindowsPath(nativeResultPath(boundary.transactionRoot, ownerPaths.generation))) {
    throw executionError('cleanup');
  }
  const canonicalOwner = await readRecoveryOwner(ownerPaths.ownerPath);
  if (!canonicalOwner || !canonicalEquals(canonicalOwner, owner)) {
    throw executionError('cleanup');
  }
}

async function readOwnerRecord<T>(
  ownerPath: string,
  looksValid: (value: unknown) => value is T
): Promise<T | undefined> {
  try {
    const metadata = await lstat(ownerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1 ||
      metadata.size < 1 || metadata.size > 4096) {
      throw executionError('cleanup');
    }
    const parsed = JSON.parse(await readFile(ownerPath, 'utf8')) as unknown;
    if (!looksValid(parsed)) throw executionError('cleanup');
    return Object.freeze(parsed);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw executionError('cleanup');
  }
}

function assertProvisionalOwner(
  owner: WindowsAppContainerProvisionalOwner,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  executionBinding: WindowsAppContainerExecutionBindingReceipt
): void {
  if (!provisionalOwnerLooksValid(owner) ||
    owner.workspaceIdentityDigest !== executionBinding.authorityBindingDigest ||
    owner.stagingIdentityDigest !== boundary.stagingIdentityDigest ||
    owner.stagingDirectoryName !== path.basename(boundary.stagingRoot) ||
    owner.appContainerName !== buildAppContainerName(boundary.stagingRoot, boundary.stagingIdentityDigest)) {
    throw executionError('cleanup');
  }
}

function assertProbeOwner(
  owner: WindowsAppContainerProbeOwner,
  ownerPaths: DurableOwnerArtifactPaths,
  outerBoundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  outerExecutionBinding: WindowsAppContainerExecutionBindingReceipt,
  probeExecutionBinding: WindowsAppContainerExecutionBindingReceipt
): void {
  const expectedCanaries = canaryNamesForGeneration(ownerPaths.generation);
  if (!probeOwnerLooksValid(owner) ||
    owner.parentCanaryName !== expectedCanaries.parent ||
    owner.outerCanaryName !== expectedCanaries.outer ||
    owner.outerWorkspaceIdentityDigest !== outerExecutionBinding.authorityBindingDigest ||
    owner.probeWorkspaceIdentityDigest !== probeExecutionBinding.authorityBindingDigest ||
    owner.outerStagingIdentityDigest !== outerBoundary.stagingIdentityDigest) {
    throw executionError('cleanup');
  }
}

async function readRecoveryOwner(ownerPath: string): Promise<WindowsAppContainerRecoveryOwner | undefined> {
  return readOwnerRecord(ownerPath, recoveryOwnerLooksValid);
}

async function readProvisionalOwner(ownerPath: string): Promise<WindowsAppContainerProvisionalOwner | undefined> {
  return readOwnerRecord(ownerPath, provisionalOwnerLooksValid);
}

async function readProbeOwner(ownerPath: string): Promise<WindowsAppContainerProbeOwner | undefined> {
  return readOwnerRecord(ownerPath, probeOwnerLooksValid);
}

type DecodedNativeHelperOutput =
  | Readonly<{ classification: 'ok'; appContainerSid: string | null }>
  | Readonly<{
      classification: 'declared-failure';
      failure: DecodedNativeFailure;
    }>
  | Readonly<{ classification: 'invalid' }>;

type DecodedNativeFailure = Readonly<{
  phase: WindowsAppContainerExecutionPhase;
  nativeCode: number | null;
  preparationSubstage: WindowsAppContainerPreparationSubstage | null;
  nativeWorkerProgressStage: WindowsAppContainerNativeWorkerProgressStage | null;
}>;

type DecodedNativeReceipt =
  | Readonly<{ classification: 'not-applicable' }>
  | Readonly<{ classification: 'absent' }>
  | Readonly<{
      classification: 'exit-code';
      result: WindowsAppContainerExecutionResult;
    }>
  | Readonly<{
      classification: 'declared-failure';
      failure: DecodedNativeFailure;
    }>
  | Readonly<{ classification: 'invalid' | 'read-error' }>;

function decodeNativeFailureRecord(value: unknown): DecodedNativeFailure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.status !== 'failed') return undefined;
  const preparationSubstage = record.phase === 'preparation'
    ? canonicalPreparationSubstage(record.substage)
    : null;
  const nativeWorkerProgressStage = record.phase === 'timeout' && record.workerStage !== undefined
    ? canonicalNativeWorkerProgressStage(record.workerStage) ?? null
    : null;
  const expectedKeys = [
    'phase',
    'status',
    ...(record.nativeCode === undefined ? [] : ['nativeCode']),
    ...(record.phase === 'preparation' ? ['substage'] : []),
    ...(record.workerStage === undefined ? [] : ['workerStage'])
  ].sort();
  if (!exactObjectKeys(record, expectedKeys) ||
    !WINDOWS_APPCONTAINER_EXECUTION_PHASES.has(record.phase as WindowsAppContainerExecutionPhase) ||
    (record.phase === 'preparation' &&
      (!WINDOWS_APPCONTAINER_PREPARATION_SUBSTAGES.has(
        record.substage as WindowsAppContainerPreparationSubstage
      ) || preparationSubstage !== record.substage)) ||
    (record.workerStage !== undefined &&
      (record.phase !== 'timeout' || nativeWorkerProgressStage !== record.workerStage)) ||
    (record.nativeCode !== undefined && !isWindowsDword(record.nativeCode))) {
    return undefined;
  }
  return Object.freeze({
    phase: record.phase as WindowsAppContainerExecutionPhase,
    nativeCode: record.nativeCode === undefined ? null : Number(record.nativeCode),
    preparationSubstage,
    nativeWorkerProgressStage
  });
}

function decodeNativeHelperOutput(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocolOutput: string
): DecodedNativeHelperOutput {
  if (!isWindowsDword(exitCode)) return Object.freeze({ classification: 'invalid' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(protocolOutput);
  } catch {
    return Object.freeze({ classification: 'invalid' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Object.freeze({ classification: 'invalid' });
  }
  const record = parsed as Record<string, unknown>;
  if (record.status === 'failed') {
    const failure = decodeNativeFailureRecord(parsed);
    return failure && exitCode !== 0
      ? Object.freeze({ classification: 'declared-failure', failure })
      : Object.freeze({ classification: 'invalid' });
  }
  if (exitCode !== 0 || record.status !== 'ok') {
    return Object.freeze({ classification: 'invalid' });
  }
  if (mode === 'derive') {
    if (!exactObjectKeys(record, ['appContainerSid', 'status'])) {
      return Object.freeze({ classification: 'invalid' });
    }
    const sid = record.appContainerSid;
    if (typeof sid !== 'string' || !WINDOWS_APPCONTAINER_SID_PATTERN.test(sid)) {
      return Object.freeze({ classification: 'invalid' });
    }
    return Object.freeze({ classification: 'ok', appContainerSid: sid });
  }
  return exactObjectKeys(record, ['status'])
    ? Object.freeze({ classification: 'ok', appContainerSid: null })
    : Object.freeze({ classification: 'invalid' });
}

function decodeNativeReceiptValue(value: unknown): DecodedNativeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ classification: 'invalid' });
  }
  const record = value as Record<string, unknown>;
  if (record.status === 'failed') {
    const failure = decodeNativeFailureRecord(value);
    return failure
      ? Object.freeze({ classification: 'declared-failure', failure })
      : Object.freeze({ classification: 'invalid' });
  }
  if (!exactObjectKeys(record, ['exitCode']) ||
    !isWindowsDword(record.exitCode)) {
    return Object.freeze({ classification: 'invalid' });
  }
  return Object.freeze({
    classification: 'exit-code',
    result: Object.freeze({ exitCode: Number(record.exitCode) })
  });
}

async function readNativeReceipt(
  resultPath: string,
  commitFence: () => Promise<void>
): Promise<DecodedNativeReceipt> {
  await commitFence();
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(resultPath);
  } catch (error) {
    await commitFence();
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return Object.freeze({ classification: 'absent' });
    }
    return Object.freeze({ classification: 'read-error' });
  }
  if (!before.isFile() || before.isSymbolicLink() || Number(before.nlink) !== 1 ||
    before.size < 1 || before.size > MAX_NATIVE_RECEIPT_BYTES) {
    await commitFence();
    return Object.freeze({ classification: 'invalid' });
  }
  let handle;
  try {
    handle = await open(resultPath, 'r');
  } catch (error) {
    await commitFence();
    return Object.freeze({
      classification: error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'absent'
        : 'read-error'
    });
  }
  let bytes: Uint8Array | undefined;
  let readFailure: 'invalid' | 'read-error' | undefined;
  try {
    const after = await handle.stat();
    if (!after.isFile() || Number(after.nlink) !== 1 ||
      String(after.dev) !== String(before.dev) || String(after.ino) !== String(before.ino)) {
      readFailure = 'read-error';
    } else if (after.size < 1 || after.size > MAX_NATIVE_RECEIPT_BYTES) {
      readFailure = 'invalid';
    } else {
      const buffer = Buffer.alloc(MAX_NATIVE_RECEIPT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead < 1 || bytesRead > MAX_NATIVE_RECEIPT_BYTES) readFailure = 'invalid';
      else bytes = new Uint8Array(buffer.subarray(0, bytesRead));
    }
  } catch {
    readFailure = 'read-error';
  }
  try {
    await handle.close();
  } catch {
    await commitFence();
    return Object.freeze({ classification: 'read-error' });
  }
  await commitFence();
  if (readFailure !== undefined) return Object.freeze({ classification: readFailure });
  if (bytes === undefined) return Object.freeze({ classification: 'read-error' });
  try {
    return decodeNativeReceiptValue(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    );
  } catch {
    return Object.freeze({ classification: 'invalid' });
  }
}

function projectNativeHelperObservation(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocol: DecodedNativeHelperOutput,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): WindowsAppContainerNativeHelperObservation {
  return Object.freeze({
    mode,
    exitClass: !isWindowsDword(exitCode) ? 'invalid' : exitCode === 0 ? 'zero' : 'nonzero',
    diagnosticStream: diagnosticStreamPresent ? 'present' : 'empty',
    protocol: protocol.classification,
    nativeReceipt: nativeReceipt.classification
  });
}

function settleNativeHelperInvocation(
  mode: 'derive',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): string;
function settleNativeHelperInvocation(
  mode: 'create-profile',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): void;
function settleNativeHelperInvocation(
  mode: 'suspended-create',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): void;
function settleNativeHelperInvocation(
  mode: 'execute',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): WindowsAppContainerExecutionResult;
function settleNativeHelperInvocation(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): string | WindowsAppContainerExecutionResult | undefined {
  const protocol = decodeNativeHelperOutput(mode, exitCode, protocolOutput);
  const observation = projectNativeHelperObservation(
    mode,
    exitCode,
    protocol,
    diagnosticStreamPresent,
    nativeReceipt
  );
  try {
    if (diagnosticStreamPresent || protocol.classification === 'invalid') {
      throw executionError(
        'preparation',
        undefined,
        undefined,
        diagnosticStreamPresent ? 'native-helper-diagnostic' : 'native-helper-protocol',
        observation
      );
    }
    if (protocol.classification === 'declared-failure') {
      throw executionError(
        protocol.failure.phase,
        protocol.failure.nativeCode ?? undefined,
        undefined,
        protocol.failure.preparationSubstage ?? undefined,
        observation,
        protocol.failure.nativeWorkerProgressStage ?? undefined
      );
    }
    if (mode === 'execute') {
      if (nativeReceipt.classification === 'declared-failure') {
        throw executionError(
          nativeReceipt.failure.phase,
          nativeReceipt.failure.nativeCode ?? undefined,
          undefined,
          nativeReceipt.failure.preparationSubstage ?? undefined,
          observation,
          nativeReceipt.failure.nativeWorkerProgressStage ?? undefined
        );
      }
      if (nativeReceipt.classification !== 'exit-code') {
        throw executionError('wait', undefined, undefined, undefined, observation);
      }
      return nativeReceipt.result;
    }
    if (nativeReceipt.classification !== 'not-applicable') {
      throw executionError(
        'preparation', undefined, undefined, 'native-receipt', observation
      );
    }
    if (mode === 'derive') {
      if (!protocol.appContainerSid) {
        throw executionError(
          'preparation', undefined, undefined, 'native-helper-protocol', observation
        );
      }
      return protocol.appContainerSid;
    }
    return undefined;
  } catch (error) {
    if (error instanceof Error) nativeHelperObservations.set(error, observation);
    throw error;
  }
}

function encodeNativeHelperRequestForHost(value: unknown): string {
  try {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  } catch (error) {
    throw normalizeExecutionError(error, 'preparation', 'native-helper-invocation');
  }
}

function invokeNativeHelper(
  mode: 'create-profile',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<void>;
function invokeNativeHelper(
  mode: 'suspended-create',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<void>;
function invokeNativeHelper(
  mode: 'execute',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<WindowsAppContainerExecutionResult>;
async function invokeNativeHelper(
  mode: 'create-profile' | 'suspended-create' | 'execute',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<void | WindowsAppContainerExecutionResult> {
  const serialized = encodeNativeHelperRequestForHost({ mode, request: helperRequest });
  const result = await runHostBunCommand(
    mode,
    stagingRoot,
    environment,
    commitFence,
    timeoutMs,
    serialized
  );
  let nativeReceipt: DecodedNativeReceipt;
  try {
    nativeReceipt = mode === 'execute'
      ? await readNativeReceipt(helperRequest.nativeResultPath, commitFence)
      : Object.freeze({ classification: 'not-applicable' as const });
  } catch (error) {
    throw normalizeExecutionError(error, 'preparation', 'native-receipt');
  }
  if (mode === 'execute') {
    return settleNativeHelperInvocation(
      'execute',
      result.code,
      result.payload,
      result.diagnosticPresent,
      nativeReceipt
    );
  }
  if (mode === 'suspended-create') {
    settleNativeHelperInvocation(
      'suspended-create',
      result.code,
      result.payload,
      result.diagnosticPresent,
      nativeReceipt
    );
    return;
  }
  settleNativeHelperInvocation(
    'create-profile',
    result.code,
    result.payload,
    result.diagnosticPresent,
    nativeReceipt
  );
}

type WindowsAppContainerNativeReceiptReadForTests =
  | 'not-applicable'
  | 'absent'
  | 'read-error'
  | Readonly<{ value: unknown }>;

/** Pure settlement seam; it accepts wire values and never spawns an AppContainer. */
export function settleWindowsAppContainerNativeHelperInvocationForTests(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  receiptRead: WindowsAppContainerNativeReceiptReadForTests
): string | WindowsAppContainerExecutionResult | undefined {
  const nativeReceipt: DecodedNativeReceipt = typeof receiptRead === 'string'
    ? Object.freeze({ classification: receiptRead })
    : decodeNativeReceiptValue(receiptRead.value);
  if (mode === 'derive') {
    return settleNativeHelperInvocation(
      'derive', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
    );
  }
  if (mode === 'create-profile') {
    settleNativeHelperInvocation(
      'create-profile', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
    );
    return undefined;
  }
  if (mode === 'suspended-create') {
    settleNativeHelperInvocation(
      'suspended-create', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
    );
    return undefined;
  }
  return settleNativeHelperInvocation(
    'execute', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
  );
}

async function deriveAppContainerSidViaHelper(
  appContainerName: string,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>
): Promise<string> {
  const serialized = encodeNativeHelperRequestForHost({
    mode: 'derive',
    request: { appContainerName }
  });
  const result = await runHostBunCommand(
    'derive',
    stagingRoot,
    environment,
    commitFence,
    10_000,
    serialized
  );
  return settleNativeHelperInvocation(
    'derive',
    result.code,
    result.payload,
    result.diagnosticPresent,
    Object.freeze({ classification: 'not-applicable' })
  );
}

/** Native-helper-only profile creation. The durable outer owner is the recovery authority. */
export async function createWindowsAppContainerProfileForNativeHelper(
  request: WindowsAppContainerNativeExecutionRequest
): Promise<void> {
  assertCapability();
  const execution = request.execution;
  const executionBinding = authorizeNativeExecutionRequest(execution);
  const commitFence = nativeExecutionCommitFence(executionBinding, execution.stagingRoot);
  await commitFence();
  const validated = await validateExecutionRequest(execution);
  validateAndSortEnvironment(execution.environment, validated.stagingRoot);
  await runPreparationStep('owner-publication', () => assertRecoveryOwner(
    request.owner,
    validated,
    executionBinding,
    request.nativeResultPath
  ));
  await runPreparationStep('profile-creation', () => createAppContainerProfile(
    request.owner.appContainerName,
    request.owner.appContainerSid,
    commitFence
  ));
}

/** Native-helper-only launch. No profile, ACL, runtime, or owner cleanup occurs here. */
async function runWindowsAppContainerNativeChildInternal(
  request: WindowsAppContainerNativeExecutionRequest,
  suspendedCreateOnly: boolean,
  onProgress?: (
    stage: Exclude<WindowsAppContainerNativeWorkerProgressStage, 'not-observed'>
  ) => void
): Promise<WindowsAppContainerExecutionResult> {
  const startedAtMs = Date.now();
  const execution = request.execution;
  const executionDeadlines = arbitrateNativeExecutionDeadlines(
    execution.timeoutMs
  );
  const executionBudget = createNativeExecutionBudget(
    executionDeadlines.childTimeoutMs,
    startedAtMs
  );
  assertCapability();
  const executionBinding = authorizeNativeExecutionRequest(execution);
  const commitFence = nativeExecutionCommitFence(executionBinding, execution.stagingRoot);
  await commitFence();
  const validated = await validateExecutionRequest(execution);
  validateAndSortEnvironment(execution.environment, validated.stagingRoot);
  await runPreparationStep('owner-publication', () => assertRecoveryOwner(
    request.owner,
    validated,
    executionBinding,
    request.nativeResultPath
  ));
  const prepared = await runPreparationStep('runtime-identity', async () => {
    const materialized = prepareMaterializedExecution(
      validated.stagingRoot,
      validated.runnerRelativePath,
      execution.runnerArguments ?? [],
      execution.environment
    );
    const runtimeMetadata = await lstat(path.join(validated.stagingRoot, RUNTIME_DIRECTORY_NAME));
    const executableMetadata = await lstat(path.join(
      validated.stagingRoot,
      RUNTIME_DIRECTORY_NAME,
      RUNTIME_EXECUTABLE_NAME
    ));
    if (!runtimeMetadata.isDirectory() || runtimeMetadata.isSymbolicLink() ||
      !executableMetadata.isFile() || executableMetadata.isSymbolicLink() ||
      Number(executableMetadata.nlink) !== 1) {
      throw executionError('preparation', undefined, undefined, 'runtime-identity');
    }
    return materialized;
  });
  const appContainerSidBytes = await runPreparationStep(
    'sid-derivation',
    () => appContainerSidBytesFromString(request.owner.appContainerSid)
  );
  const exitCode = await executeNativeAppContainer(
    appContainerSidBytes,
    prepared,
    executionBudget,
    commitFence,
    suspendedCreateOnly,
    onProgress
  );
  return Object.freeze({ exitCode });
}

export function runWindowsAppContainerNativeChild(
  request: WindowsAppContainerNativeExecutionRequest
): Promise<WindowsAppContainerExecutionResult> {
  return runWindowsAppContainerNativeChildInternal(request, false);
}

export async function runWindowsAppContainerNativeSuspendedCreateForHelper(
  request: WindowsAppContainerNativeExecutionRequest,
  onProgress?: (
    stage: Exclude<WindowsAppContainerNativeWorkerProgressStage, 'not-observed'>
  ) => void
): Promise<void> {
  await runWindowsAppContainerNativeChildInternal(request, true, onProgress);
}

/** Native cleanup helper. Every planned resource is removed unconditionally. */
async function cleanupWindowsAppContainerNativeOwner(
  request: WindowsAppContainerNativeCleanupRequest,
  provenAppContainerSid: string,
  signal?: AbortSignal
): Promise<void> {
  assertCapability();
  signal?.throwIfAborted();
  const executionBinding = await authorizeExecutionCapability(
    request.executionCapability,
    request.stagingRoot
  );
  const commitFence = executionCommitFence(request.executionCapability, request.stagingRoot);
  await commitFence();
  const boundary = await validateRecoveryStagingBoundary(request.stagingRoot);
  await assertRecoveryOwner(
    request.owner,
    boundary,
    executionBinding,
    request.nativeResultPath
  );
  if (provenAppContainerSid !== request.owner.appContainerSid) {
    throw executionError('cleanup');
  }
  const systemDirectory = await windowsSystemDirectory();
  await runIcacls(systemDirectory, [
    boundary.stagingRoot,
    '/remove:g',
    `*${request.owner.appContainerSid}`,
    '/T',
    '/C',
    '/Q'
  ], commitFence, 'cleanup', 'acl-remove', signal);
  signal?.throwIfAborted();
  await commitFence();
  await rm(path.join(boundary.stagingRoot, request.owner.runtimeRelativePath), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25
  });
  if (await appContainerProfileExists(
    systemDirectory,
    request.owner.appContainerName,
    commitFence,
    signal
  )) {
    signal?.throwIfAborted();
    await deleteAppContainerProfile(request.owner.appContainerName, commitFence);
  }
  signal?.throwIfAborted();
  await commitFence();
  await rm(request.nativeResultPath, { force: true });
  await assertAppContainerAclAbsent(
    systemDirectory,
    boundary.stagingRoot,
    request.owner.appContainerSid,
    commitFence,
    signal
  );
  signal?.throwIfAborted();
  await commitFence();
  if (await pathExists(path.join(boundary.stagingRoot, request.owner.runtimeRelativePath))) {
    throw executionError('cleanup', 22);
  }
  if (await pathExists(request.nativeResultPath)) throw executionError('cleanup', 23);
  if (await appContainerProfileExists(
    systemDirectory,
    request.owner.appContainerName,
    commitFence,
    signal
  )) throw executionError('cleanup', 24);
}

async function cleanupPlannedOwner(
  execution: WindowsAppContainerExecutionRequest,
  owner: WindowsAppContainerRecoveryOwner,
  ownerPaths: DurableOwnerArtifactPaths,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  commitFence: () => Promise<void>
): Promise<void> {
  const resultPath = nativeResultPathForOwner(boundary.transactionRoot, owner);
  const cleanupRequest: WindowsAppContainerNativeCleanupRequest = {
    stagingRoot: boundary.stagingRoot,
    nativeResultPath: resultPath,
    executionCapability: execution.executionCapability,
    owner
  };
  const provenAppContainerSid = await deriveAppContainerSidViaHelper(
    owner.appContainerName,
    boundary.stagingRoot,
    execution.environment,
    commitFence
  );
  await cleanupWindowsAppContainerNativeOwner(cleanupRequest, provenAppContainerSid);
  await commitFence();
  await durableRemovePendingOwnerFile(ownerPaths.pendingPath, commitFence);
  await durableRemoveFile(ownerPaths.ownerPath, commitFence);
}

async function cleanupProvisionalOwner(
  owner: WindowsAppContainerProvisionalOwner,
  ownerPaths: DurableOwnerArtifactPaths,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  executionBinding: WindowsAppContainerExecutionBindingReceipt,
  commitFence: () => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  assertProvisionalOwner(owner, boundary, executionBinding);
  await cleanupHostBunConfig(boundary.stagingRoot, commitFence);
  signal?.throwIfAborted();
  await durableRemovePendingOwnerFile(ownerPaths.pendingPath, commitFence);
  signal?.throwIfAborted();
  await durableRemoveFile(ownerPaths.ownerPath, commitFence);
}

async function publishProvisionalOwner(
  owner: WindowsAppContainerProvisionalOwner,
  transactionRoot: string,
  commitFence: () => Promise<void>,
  testHooks: DurableOwnerPublishTestHooks = {}
): Promise<void> {
  const currentPaths = provisionalOwnerArtifactPaths(transactionRoot);
  const existingPaths = await selectDurableOwnerArtifactPaths(
    currentPaths,
    provisionalOwnerArtifactPaths(transactionRoot, 'legacy')
  );
  if (existingPaths?.generation === 'legacy') {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
  await durablePublishOwnerFile(
    currentPaths.ownerPath,
    currentPaths.pendingPath,
    `${JSON.stringify(owner)}\n`,
    commitFence,
    testHooks
  );
  const canonical = await readProvisionalOwner(currentPaths.ownerPath);
  if (!canonical || !canonicalEquals(canonical, owner)) {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
}

/** Test-only atomic publication vector; never re-exported from a product facade. */
export async function publishWindowsAppContainerProvisionalOwnerForTests(
  transactionRoot: string,
  interruption: 'after-pending' | 'after-rename'
): Promise<void> {
  const owner: WindowsAppContainerProvisionalOwner = Object.freeze({
    formatVersion: PROVISIONAL_OWNER_FORMAT_VERSION,
    workspaceIdentityDigest: `sha256:${'a'.repeat(64)}`,
    stagingIdentityDigest: `sha256:${'b'.repeat(64)}`,
    stagingDirectoryName: 's',
    hostBunConfigRelativePath: HOST_BUN_CONFIG_RELATIVE_ROOT,
    appContainerName: `sec.sm3.${'c'.repeat(12)}.${'d'.repeat(24)}`
  });
  const interrupted = async (): Promise<void> => {
    throw new Error(`simulated-owner-publication-${interruption}`);
  };
  await publishProvisionalOwner(owner, transactionRoot, async () => undefined, {
    ...(interruption === 'after-pending'
      ? { afterPendingDurableBeforeRename: interrupted }
      : { afterRenameBeforeDirectorySync: interrupted })
  });
}

/** Test-only pending recovery vector; never re-exported from a product facade. */
export async function recoverWindowsAppContainerProvisionalOwnerForTests(
  transactionRoot: string
): Promise<'canonical' | 'none'> {
  const paths = await selectDurableOwnerArtifactPaths(
    provisionalOwnerArtifactPaths(transactionRoot),
    provisionalOwnerArtifactPaths(transactionRoot, 'legacy')
  );
  if (!paths) return 'none';
  await durableRemovePendingOwnerFile(paths.pendingPath, async () => undefined);
  return await readProvisionalOwner(paths.ownerPath) ? 'canonical' : 'none';
}

async function publishRecoveryOwner(
  owner: WindowsAppContainerRecoveryOwner,
  transactionRoot: string,
  commitFence: () => Promise<void>
): Promise<void> {
  const currentPaths = recoveryOwnerArtifactPaths(transactionRoot);
  const existingPaths = await selectDurableOwnerArtifactPaths(
    currentPaths,
    recoveryOwnerArtifactPaths(transactionRoot, 'legacy')
  );
  if (existingPaths?.generation === 'legacy') {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
  await durablePublishOwnerFile(
    currentPaths.ownerPath,
    currentPaths.pendingPath,
    `${JSON.stringify(owner)}\n`,
    commitFence
  );
  const canonical = await readRecoveryOwner(currentPaths.ownerPath);
  if (!canonical || !canonicalEquals(canonical, owner)) {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
}

async function recoverPreviousOwnership(
  execution: WindowsAppContainerExecutionRequest,
  executionBinding: WindowsAppContainerExecutionBindingReceipt,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  commitFence: () => Promise<void>
): Promise<void> {
  const recoveryPaths = await selectDurableOwnerArtifactPaths(
    recoveryOwnerArtifactPaths(boundary.transactionRoot),
    recoveryOwnerArtifactPaths(boundary.transactionRoot, 'legacy')
  );
  const provisionalPaths = await selectDurableOwnerArtifactPaths(
    provisionalOwnerArtifactPaths(boundary.transactionRoot),
    provisionalOwnerArtifactPaths(boundary.transactionRoot, 'legacy')
  );
  if (recoveryPaths) await durableRemovePendingOwnerFile(recoveryPaths.pendingPath, commitFence);
  if (provisionalPaths) await durableRemovePendingOwnerFile(provisionalPaths.pendingPath, commitFence);
  const owner = recoveryPaths ? await readRecoveryOwner(recoveryPaths.ownerPath) : undefined;
  const provisional = provisionalPaths
    ? await readProvisionalOwner(provisionalPaths.ownerPath)
    : undefined;
  if (recoveryPaths && provisionalPaths && recoveryPaths.generation !== provisionalPaths.generation) {
    throw executionError('cleanup');
  }
  const [currentResultExists, legacyResultExists] = await Promise.all([
    pathExists(nativeResultPath(boundary.transactionRoot)),
    pathExists(nativeResultPath(boundary.transactionRoot, 'legacy'))
  ]);
  if (!owner && (currentResultExists || legacyResultExists)) throw executionError('cleanup');
  if (owner) {
    const oppositeResultExists = recoveryPaths!.generation === 'current'
      ? legacyResultExists
      : currentResultExists;
    if (oppositeResultExists) throw executionError('cleanup');
    await assertRecoveryOwner(
      owner,
      boundary,
      executionBinding,
      nativeResultPathForOwner(boundary.transactionRoot, owner),
      recoveryPaths!
    );
    await cleanupPlannedOwner(execution, owner, recoveryPaths!, boundary, commitFence);
  }
  if (provisional) {
    await cleanupProvisionalOwner(
      provisional,
      provisionalPaths!,
      boundary,
      executionBinding,
      commitFence
    );
  }
}

type WindowsAppContainerChildInternalResult =
  | Readonly<{
      kind: 'executed';
      execution: WindowsAppContainerExecutionResult;
    }>
  | Readonly<{ kind: 'suspended-created' }>;

async function runWindowsAppContainerChildInternal(
  request: WindowsAppContainerExecutionRequest,
  suspendedCreateOnly: boolean
): Promise<WindowsAppContainerChildInternalResult> {
  assertCapability();
  const executionBinding = await authorizeExecutionRequest(request);
  const commitFence = executionCommitFence(request.executionCapability, request.stagingRoot);
  await commitFence();
  const validated = await validateExecutionRequest(request);
  const executionDeadlines = arbitrateNativeExecutionDeadlines(
    request.timeoutMs
  );
  validateAndSortEnvironment(request.environment, validated.stagingRoot);
  await recoverPreviousOwnership(request, executionBinding, validated, commitFence);

  const appContainerName = buildAppContainerName(
    validated.stagingRoot,
    validated.stagingIdentityDigest
  );
  const provisionalOwner: WindowsAppContainerProvisionalOwner = Object.freeze({
    formatVersion: PROVISIONAL_OWNER_FORMAT_VERSION,
    workspaceIdentityDigest: executionBinding.authorityBindingDigest,
    stagingIdentityDigest: validated.stagingIdentityDigest,
    stagingDirectoryName: path.basename(validated.stagingRoot),
    hostBunConfigRelativePath: HOST_BUN_CONFIG_RELATIVE_ROOT,
    appContainerName
  });
  const resultPath = nativeResultPath(validated.transactionRoot);
  let result: WindowsAppContainerChildInternalResult | undefined;
  let owner: WindowsAppContainerRecoveryOwner | undefined;
  let primaryError:
    | WindowsAppContainerCapabilityUnavailableError
    | WindowsAppContainerExecutionError
    | undefined;

  try {
    await runPreparationStep('owner-publication', () =>
      publishProvisionalOwner(provisionalOwner, validated.transactionRoot, commitFence));
    const appContainerSid = await runPreparationStep(
      'native-helper-invocation',
      () => deriveAppContainerSidViaHelper(
        appContainerName,
        validated.stagingRoot,
        request.environment,
        commitFence
      )
    );
    owner = Object.freeze({
      formatVersion: RECOVERY_OWNER_FORMAT_VERSION,
      workspaceIdentityDigest: executionBinding.authorityBindingDigest,
      stagingIdentityDigest: validated.stagingIdentityDigest,
      stagingDirectoryName: path.basename(validated.stagingRoot),
      runtimeRelativePath: RUNTIME_DIRECTORY_NAME,
      resultFileName: NATIVE_RESULT_FILE_NAME,
      appContainerName,
      appContainerSid
    });
    await runPreparationStep('owner-publication', () =>
      publishRecoveryOwner(owner!, validated.transactionRoot, commitFence));
    await runPreparationStep('owner-publication', () =>
      durableRemovePendingOwnerFile(
        provisionalOwnerArtifactPaths(validated.transactionRoot).pendingPath,
        commitFence
      ));
    await runPreparationStep('owner-publication', () =>
      durableRemoveFile(
        provisionalOwnerArtifactPaths(validated.transactionRoot).ownerPath,
        commitFence
      ));
    await runPreparationStep('runtime-identity', () =>
      materializeRuntime(validated.stagingRoot, commitFence));
    const systemDirectory = await runPreparationStep(
      'system-directory',
      () => windowsSystemDirectory()
    );
    const nativeRequest: WindowsAppContainerNativeExecutionRequest = {
      execution: {
        stagingRoot: validated.stagingRoot,
        runnerRelativePath: validated.runnerRelativePath,
        ...(request.runnerArguments ? { runnerArguments: request.runnerArguments } : {}),
        environment: request.environment,
        executionBinding,
        ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {})
      },
      nativeResultPath: resultPath,
      owner
    };
    await runWindowsAppContainerExecutionSteps({
      grantAcl: async () => {
        await runIcacls(systemDirectory, [
          validated.stagingRoot,
          '/grant',
          `*${nativeRequest.owner.appContainerSid}:(OI)(CI)(M)`,
          '/T',
          '/C',
          '/Q'
        ], commitFence, 'acl', 'acl-grant');
      },
      createProfile: async () => {
        await invokeNativeHelper(
          'create-profile',
          nativeRequest,
          validated.stagingRoot,
          request.environment,
          commitFence,
          10_000
        );
      },
      execute: async () => {
        if (suspendedCreateOnly) {
          await invokeNativeHelper(
            'suspended-create',
            nativeRequest,
            validated.stagingRoot,
            request.environment,
            commitFence,
            executionDeadlines.hostWatchdogMs
          );
          result = Object.freeze({ kind: 'suspended-created' });
        } else {
          const execution = await invokeNativeHelper(
            'execute',
            nativeRequest,
            validated.stagingRoot,
            request.environment,
            commitFence,
            executionDeadlines.hostWatchdogMs
          );
          result = Object.freeze({ kind: 'executed', execution });
        }
      }
    });
  } catch (error) {
    primaryError = normalizeExecutionError(error, 'preparation');
  }

  return completeWindowsAppContainerOwnedExecution(result, primaryError, async () => {
    await commitFence();
    const recoveryPaths = await selectDurableOwnerArtifactPaths(
      recoveryOwnerArtifactPaths(validated.transactionRoot),
      recoveryOwnerArtifactPaths(validated.transactionRoot, 'legacy')
    );
    const canonicalOwner = recoveryPaths
      ? await readRecoveryOwner(recoveryPaths.ownerPath)
      : undefined;
    if (canonicalOwner) {
      if (!owner || !canonicalEquals(canonicalOwner, owner)) {
        throw executionError('cleanup');
      }
      await cleanupPlannedOwner(request, canonicalOwner, recoveryPaths!, validated, commitFence);
    }
    const provisionalPaths = await selectDurableOwnerArtifactPaths(
      provisionalOwnerArtifactPaths(validated.transactionRoot),
      provisionalOwnerArtifactPaths(validated.transactionRoot, 'legacy')
    );
    const canonicalProvisional = provisionalPaths
      ? await readProvisionalOwner(provisionalPaths.ownerPath)
      : undefined;
    if (canonicalProvisional) {
      await cleanupProvisionalOwner(
        canonicalProvisional,
        provisionalPaths!,
        validated,
        executionBinding,
        commitFence
      );
    }
    if (recoveryPaths) await durableRemovePendingOwnerFile(recoveryPaths.pendingPath, commitFence);
    if (provisionalPaths) await durableRemovePendingOwnerFile(provisionalPaths.pendingPath, commitFence);
    if (await executionRecoveryResidueExists(validated.transactionRoot)) {
      throw executionError('cleanup');
    }
  }, 'wait');
}

export function runWindowsAppContainerChild(
  request: WindowsAppContainerExecutionRequest
): Promise<WindowsAppContainerExecutionResult> {
  return runWindowsAppContainerChildInternal(request, false).then((result) => {
    if (result.kind !== 'executed') throw executionError('wait');
    return result.execution;
  });
}

async function waitForProbeMarker(
  markerPath: string,
  timeoutMs: number
): Promise<Readonly<{ processId: number; descendantProcessId: number }>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = JSON.parse(await readFile(markerPath, 'utf8')) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value) &&
        exactObjectKeys(value, ['descendantProcessId', 'processId'])) {
        const marker = value as Record<string, unknown>;
        if (Number.isSafeInteger(marker.processId) && Number(marker.processId) > 0 &&
          Number.isSafeInteger(marker.descendantProcessId) && Number(marker.descendantProcessId) > 0) {
          return Object.freeze({
            processId: Number(marker.processId),
            descendantProcessId: Number(marker.descendantProcessId)
          });
        }
      }
    } catch {
      // The marker is written only after both Job members exist.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw executionError('wait');
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    return true;
  }
}

async function waitForProcessesToExit(processIds: readonly number[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (processIds.every((processId) => !processIsAlive(processId))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw executionError('wait');
}

async function publishProbeOwner(
  owner: WindowsAppContainerProbeOwner,
  probeRoot: string,
  commitFence: () => Promise<void>
): Promise<void> {
  const currentPaths = probeOwnerArtifactPaths(probeRoot);
  const existingPaths = await selectDurableOwnerArtifactPaths(
    currentPaths,
    probeOwnerArtifactPaths(probeRoot, 'legacy')
  );
  if (existingPaths?.generation === 'legacy') {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
  await durablePublishOwnerFile(
    currentPaths.ownerPath,
    currentPaths.pendingPath,
    `${JSON.stringify(owner)}\n`,
    commitFence
  );
  const canonical = await readProbeOwner(currentPaths.ownerPath);
  if (!canonical || !canonicalEquals(canonical, owner)) {
    throw executionError('preparation', undefined, undefined, 'owner-publication');
  }
}

async function executionRecoveryResidueExists(transactionRoot: string): Promise<boolean> {
  const currentRecovery = recoveryOwnerArtifactPaths(transactionRoot);
  const legacyRecovery = recoveryOwnerArtifactPaths(transactionRoot, 'legacy');
  const currentProvisional = provisionalOwnerArtifactPaths(transactionRoot);
  const legacyProvisional = provisionalOwnerArtifactPaths(transactionRoot, 'legacy');
  for (const candidate of [
    currentRecovery.ownerPath,
    currentRecovery.pendingPath,
    legacyRecovery.ownerPath,
    legacyRecovery.pendingPath,
    currentProvisional.ownerPath,
    currentProvisional.pendingPath,
    legacyProvisional.ownerPath,
    legacyProvisional.pendingPath,
    nativeResultPath(transactionRoot),
    nativeResultPath(transactionRoot, 'legacy')
  ]) {
    if (await pathExists(candidate)) return true;
  }
  return false;
}

async function executionRecoveryAuthorityExists(transactionRoot: string): Promise<boolean> {
  const currentRecovery = recoveryOwnerArtifactPaths(transactionRoot);
  const legacyRecovery = recoveryOwnerArtifactPaths(transactionRoot, 'legacy');
  const currentProvisional = provisionalOwnerArtifactPaths(transactionRoot);
  const legacyProvisional = provisionalOwnerArtifactPaths(transactionRoot, 'legacy');
  for (const candidate of [
    currentRecovery.ownerPath,
    currentRecovery.pendingPath,
    legacyRecovery.ownerPath,
    legacyRecovery.pendingPath,
    currentProvisional.ownerPath,
    currentProvisional.pendingPath,
    legacyProvisional.ownerPath,
    legacyProvisional.pendingPath
  ]) {
    if (await pathExists(candidate)) return true;
  }
  return false;
}

/**
 * Test-only detailed sentinel seam. Evidence is canonical and path-free; the
 * product API below always redacts it to exactly { status }.
 */
export async function probeWindowsAppContainerCapabilityForTests(
  request: WindowsAppContainerCapabilityProbeRequest
): Promise<WindowsAppContainerDetailedProbeCapability> {
  if (windowsAppContainerCapability().status !== 'available') {
    return Object.freeze({
      status: 'unavailable',
      primary: probeFault('capability', 'host-supported'),
      cleanup: Object.freeze([])
    });
  }
  let outerExecutionBinding: WindowsAppContainerExecutionBindingReceipt;
  try {
    outerExecutionBinding = await assertWindowsAppContainerExecutionCapability(
      request.executionCapability,
      path.resolve(request.stagingRoot)
    );
  } catch (error) {
    return Object.freeze({
      status: 'unavailable',
      primary: probeFault('boundary', 'outer-boundary-valid', error),
      cleanup: Object.freeze([])
    });
  }
  const outerFence = executionCommitFence(request.executionCapability, request.stagingRoot);
  let currentStage: WindowsAppContainerProbeStage = 'boundary';
  let currentInvariant: WindowsAppContainerProbeInvariant = 'outer-boundary-valid';
  const at = (
    stage: WindowsAppContainerProbeStage,
    invariant: WindowsAppContainerProbeInvariant
  ): void => {
    currentStage = stage;
    currentInvariant = invariant;
  };
  const cleanupFaults: WindowsAppContainerProbeFault[] = [];
  const captureCleanup = async (
    invariant: WindowsAppContainerProbeInvariant,
    action: () => Promise<void>
  ): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch (error) {
      cleanupFaults.push(probeFault('cleanup', invariant, error));
      cleanupFaults.push(...associatedProbeCleanupFaults(error, 'cleanup', invariant));
      return false;
    }
  };

  let probeLease: WindowsAppContainerProbeCapabilityLease | undefined;
  let probeExecutionBinding: WindowsAppContainerExecutionBindingReceipt | undefined;
  let probeLeaseReleased = false;
  let conformanceServers: WindowsAppContainerProbeConformanceServerLease | undefined;
  let probeRoot: string | undefined;
  let parentCanaryPath: string | undefined;
  let outerCanaryPath: string | undefined;
  let outerCanaryOwned = false;
  let observedLeaseLossProcessIds: readonly number[] = Object.freeze([]);
  let primaryFault: WindowsAppContainerProbeFault | undefined;
  let availableCandidate = false;

  try {
    at('boundary', 'outer-boundary-valid');
    const probeAssets = await loadWindowsAppContainerProbeAssetSet();
    await outerFence();
    const boundary = await validateRecoveryStagingBoundary(request.stagingRoot);
    validateAndSortEnvironment(request.environment, boundary.stagingRoot);
    probeRoot = path.join(boundary.stagingRoot, CAPABILITY_PROBE_RELATIVE_ROOT);
    const probeStagingRoot = path.join(probeRoot, 's');
    const initialProbePaths = await selectDurableOwnerArtifactPaths(
      probeOwnerArtifactPaths(probeRoot),
      probeOwnerArtifactPaths(probeRoot, 'legacy')
    );
    const hadProbeOwner = initialProbePaths
      ? await pathExists(initialProbePaths.ownerPath)
      : false;
    const hadProbeOwnerPending = initialProbePaths
      ? await pathExists(initialProbePaths.pendingPath)
      : false;
    const needsInitialRecovery = await executionRecoveryAuthorityExists(probeRoot);

    at('probe-root', 'probe-root-prepared');
    if (await pathExists(probeRoot) && !hadProbeOwner && !hadProbeOwnerPending && !needsInitialRecovery) {
      await outerFence();
      await rm(probeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
    await outerFence();
    await mkdir(probeStagingRoot, { recursive: true });

    at('server', 'probe-server-listening');
    conformanceServers = await acquireWindowsAppContainerProbeConformanceServersForTests();

    at('environment', 'probe-environment-valid');
    const environment = buildWindowsAppContainerProbeEnvironmentForTests(
      request.environment,
      probeStagingRoot,
      conformanceServers.httpPort,
      conformanceServers.rawPort
    );
    validateAndSortEnvironment(environment, probeStagingRoot);
    const processDirectories = [
      environment.HOME,
      environment.APPDATA,
      environment.LOCALAPPDATA,
      environment.TEMP,
      environment.BUN_INSTALL_CACHE_DIR
    ].filter((entry): entry is string => typeof entry === 'string');
    for (const directory of processDirectories) {
      await outerFence();
      await mkdir(directory, { recursive: true });
    }

    at('ownership', 'probe-lease-owned');
    probeLease = await request.probeCapabilityProvider.acquire({
      authorizationRoot: probeRoot,
      stagingRoot: probeStagingRoot,
      deadlineAtUnixMs: outerExecutionBinding.deadlineAtUnixMs
    });
    probeExecutionBinding = await assertWindowsAppContainerExecutionCapability(
      probeLease.capability,
      probeStagingRoot
    );
    const probeFence = async (): Promise<void> => {
      await outerFence();
      await assertWindowsAppContainerExecutionCapability(
        probeLease!.capability,
        probeStagingRoot
      );
    };
    const existingProbePaths = await selectDurableOwnerArtifactPaths(
      probeOwnerArtifactPaths(probeRoot),
      probeOwnerArtifactPaths(probeRoot, 'legacy')
    );
    if (existingProbePaths) {
      await durableRemovePendingOwnerFile(existingProbePaths.pendingPath, probeFence);
    }
    const existingProbeOwner = existingProbePaths
      ? await readProbeOwner(existingProbePaths.ownerPath)
      : undefined;
    if (existingProbeOwner) {
      at('ownership', 'probe-owner-valid');
      assertProbeOwner(
        existingProbeOwner,
        existingProbePaths!,
        boundary,
        outerExecutionBinding,
        probeExecutionBinding
      );
      const oppositeCanaries = canaryNamesForGeneration(
        existingProbePaths!.generation === 'current' ? 'legacy' : 'current'
      );
      if (await pathExists(path.join(probeRoot, oppositeCanaries.parent)) ||
        await pathExists(path.join(boundary.stagingRoot, oppositeCanaries.outer))) {
        throwProbeFailure('canary', 'canary-owned');
      }
      parentCanaryPath = path.join(probeRoot, existingProbeOwner.parentCanaryName);
      outerCanaryPath = path.join(boundary.stagingRoot, existingProbeOwner.outerCanaryName);
      outerCanaryOwned = true;
    } else {
      const currentCanaries = canaryNamesForGeneration('current');
      const legacyCanaries = canaryNamesForGeneration('legacy');
      const canaryCandidates = [
        path.join(probeRoot, currentCanaries.parent),
        path.join(boundary.stagingRoot, currentCanaries.outer),
        path.join(probeRoot, legacyCanaries.parent),
        path.join(boundary.stagingRoot, legacyCanaries.outer)
      ];
      const existingCanary = (await Promise.all(canaryCandidates.map(pathExists))).some(Boolean);
      if (existingCanary) {
        throwProbeFailure('canary', 'canary-owned');
      }
      const probeOwner: WindowsAppContainerProbeOwner = Object.freeze({
        formatVersion: PROBE_OWNER_FORMAT_VERSION,
        outerWorkspaceIdentityDigest: outerExecutionBinding.authorityBindingDigest,
        probeWorkspaceIdentityDigest: probeExecutionBinding.authorityBindingDigest,
        outerStagingIdentityDigest: boundary.stagingIdentityDigest,
        probeStagingDirectoryName: 's',
        parentCanaryName: CAPABILITY_PARENT_CANARY_NAME,
        outerCanaryName: CAPABILITY_OUTER_CANARY_NAME
      });
      at('ownership', 'probe-owner-valid');
      await publishProbeOwner(probeOwner, probeRoot, probeFence);
      parentCanaryPath = path.join(probeRoot, probeOwner.parentCanaryName);
      outerCanaryPath = path.join(boundary.stagingRoot, probeOwner.outerCanaryName);
      outerCanaryOwned = true;
    }

    at('canary', 'canary-owned');
    if (!parentCanaryPath || !outerCanaryPath) throwProbeFailure('canary', 'canary-owned');
    for (const canaryPath of [parentCanaryPath, outerCanaryPath]) {
      if (await pathExists(canaryPath)) {
        await probeFence();
        if (await readFile(canaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT) {
          throwProbeFailure('canary', 'canary-owned');
        }
      } else {
        await outerFence();
        await assertWindowsAppContainerExecutionCapability(probeLease.capability, probeStagingRoot);
        await writeFile(canaryPath, CAPABILITY_CANARY_CONTENT, { flag: 'wx' });
      }
    }

    at('probe-root', 'probe-input-clean');
    for (const relativePath of [
      'lease-loss-marker.json',
      'capability-result.json',
      'spawned-result.json',
      'direct-inside.txt',
      'spawned-inside.txt',
      'execution-conformance-result.json',
      '.spawned-probe-stdout',
      '.spawned-probe-stderr',
      ...windowsAppContainerProbeAssetRelativePaths()
    ]) {
      await outerFence();
      await assertWindowsAppContainerExecutionCapability(probeLease.capability, probeStagingRoot);
      await rm(path.join(probeStagingRoot, relativePath), { force: true });
    }
    await stageWindowsAppContainerProbeAssetSet(probeStagingRoot, probeAssets, probeFence);

    const timeoutMs = request.timeoutMs ?? 10_000;
    if (needsInitialRecovery) {
      at('initial-recovery', 'initial-owner-recovered');
      const recoveryExecution = await runWindowsAppContainerChild({
        stagingRoot: probeStagingRoot,
        runnerRelativePath: windowsAppContainerProbeAssetRelativePath('vector-runner'),
        environment,
        executionCapability: probeLease.capability,
        timeoutMs
      });
      if (recoveryExecution.exitCode !== 0 || await executionRecoveryResidueExists(probeRoot) ||
        await pathExists(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME)) ||
        await pathExists(path.join(probeStagingRoot, HOST_BUN_CONFIG_RELATIVE_ROOT))) {
        throwProbeFailure('initial-recovery', 'initial-owner-recovered');
      }
      for (const relativePath of [
        'capability-result.json',
        'spawned-result.json',
        'direct-inside.txt',
        'spawned-inside.txt'
      ]) {
        await outerFence();
        await assertWindowsAppContainerExecutionCapability(probeLease.capability, probeStagingRoot);
        await rm(path.join(probeStagingRoot, relativePath), { force: true });
      }
    }

    at('prefix-recovery', 'prefix-failure-recovered');
    await outerFence();
    await assertWindowsAppContainerExecutionCapability(probeLease.capability, probeStagingRoot);
    await mkdir(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME));
    const prefixRejected = await runWindowsAppContainerChild({
      stagingRoot: probeStagingRoot,
      runnerRelativePath: windowsAppContainerProbeAssetRelativePath('vector-runner'),
      environment,
      executionCapability: probeLease.capability,
      timeoutMs
    }).then(() => false, () => true);
    if (!prefixRejected || await executionRecoveryResidueExists(probeRoot) ||
      await pathExists(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME)) ||
      await pathExists(path.join(probeStagingRoot, HOST_BUN_CONFIG_RELATIVE_ROOT))) {
      throwProbeFailure('prefix-recovery', 'prefix-failure-recovered');
    }

    at('lease-loss', 'lease-loss-observed');
    const leaseLossRejected = runWindowsAppContainerChild({
      stagingRoot: probeStagingRoot,
      runnerRelativePath: windowsAppContainerProbeAssetRelativePath('lease-loss-runner'),
      environment,
      executionCapability: probeLease.capability,
      timeoutMs
    }).then(() => false, () => true);
    const marker = await waitForProbeMarker(
      path.join(probeStagingRoot, 'lease-loss-marker.json'),
      timeoutMs
    );
    observedLeaseLossProcessIds = Object.freeze([marker.processId, marker.descendantProcessId]);
    await probeLease.release();
    probeLeaseReleased = true;
    const leaseLossRecoveryPaths = await selectDurableOwnerArtifactPaths(
      recoveryOwnerArtifactPaths(probeRoot),
      recoveryOwnerArtifactPaths(probeRoot, 'legacy')
    );
    if (!await leaseLossRejected || !leaseLossRecoveryPaths ||
      !await pathExists(leaseLossRecoveryPaths.ownerPath)) {
      throwProbeFailure('lease-loss', 'lease-loss-owner-durable');
    }
    at('lease-loss', 'lease-loss-processes-exited');
    await waitForProcessesToExit(observedLeaseLossProcessIds, 5_000);
    observedLeaseLossProcessIds = Object.freeze([]);

    at('isolated-execution', 'isolated-child-succeeded');
    probeLease = await request.probeCapabilityProvider.acquire({
      authorizationRoot: probeRoot,
      stagingRoot: probeStagingRoot,
      deadlineAtUnixMs: outerExecutionBinding.deadlineAtUnixMs
    });
    probeLeaseReleased = false;
    const execution = await runWindowsAppContainerChild({
      stagingRoot: probeStagingRoot,
      runnerRelativePath: windowsAppContainerProbeAssetRelativePath('vector-runner'),
      environment,
      executionCapability: probeLease.capability,
      timeoutMs
    });
    if (execution.exitCode !== 0) {
      let spawnedFailureExitCode: number | undefined;
      let spawnedFailureDiagnostic: WindowsAppContainerNestedChildDiagnostic | undefined;
      try {
        const failedReportText = await readFile(
          path.join(probeStagingRoot, 'capability-result.json'),
          'utf8'
        );
        const failedReport = JSON.parse(failedReportText) as unknown;
        const report = observeWindowsAppContainerProbeReportForTests(failedReport);
        if (report) {
          spawnedFailureDiagnostic = report.spawnedDiagnostic;
          if (report.spawnedExitCode === 43 && report.spawnedResultPresent) {
            currentInvariant = 'spawned-child-isolated';
          } else if (report.spawnedExitCode !== 0) {
            currentInvariant = 'spawned-child-succeeded';
            spawnedFailureExitCode = report.spawnedExitCode;
          }
        }
      } catch {}
      if (spawnedFailureExitCode !== undefined) {
        throw new WindowsAppContainerProbeFailure(Object.freeze({
          stage: 'isolated-execution',
          invariant: currentInvariant,
          executionPhase: 'wait',
          nativeCode: spawnedFailureExitCode,
          ...(spawnedFailureDiagnostic === undefined
            ? {}
            : { nestedChildDiagnostic: spawnedFailureDiagnostic })
        }));
      }
      throwProbeFailure('isolated-execution', currentInvariant);
    }
    at('isolated-execution', 'no-resource-residue');
    const connectionAttempts = conformanceServers.connectionAttempts();
    if (connectionAttempts.http !== 0 || connectionAttempts.raw !== 0 ||
      await executionRecoveryResidueExists(probeRoot) ||
      await pathExists(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME)) ||
      await pathExists(path.join(probeStagingRoot, HOST_BUN_CONFIG_RELATIVE_ROOT)) ||
      await pathExists(path.join(probeRoot, 'direct-outside.txt')) ||
      await pathExists(path.join(probeRoot, 'spawned-outside.txt'))) {
      throwProbeFailure('isolated-execution', 'no-resource-residue');
    }

    at('isolation-report', 'isolation-report-valid');
    const report = JSON.parse(await readFile(
      path.join(probeStagingRoot, 'capability-result.json'),
      'utf8'
    )) as unknown;
    if (!windowsAppContainerProbeReportIsIsolatedForTests(report)) {
      throwProbeFailure('isolation-report', 'isolation-report-valid');
    }
    await outerFence();
    await assertWindowsAppContainerExecutionCapability(probeLease.capability, probeStagingRoot);
    if (await readFile(parentCanaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT ||
      await readFile(outerCanaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT) {
      throwProbeFailure('isolation-report', 'canary-intact');
    }
    availableCandidate = true;
  } catch (error) {
    primaryFault = probeFault(currentStage, currentInvariant, error);
    cleanupFaults.push(...associatedProbeCleanupFaults(error, 'cleanup', 'probe-clean'));
  } finally {
    let processesExitedForRootCleanup = observedLeaseLossProcessIds.length === 0;
    if (!processesExitedForRootCleanup) {
      processesExitedForRootCleanup = await captureCleanup('lease-loss-processes-exited', async () => {
        await waitForProcessesToExit(observedLeaseLossProcessIds, 5_000);
        observedLeaseLossProcessIds = Object.freeze([]);
      });
    }
    let leaseReleasedForRootCleanup = probeLease === undefined || probeLeaseReleased;
    if (probeLease && !probeLeaseReleased) {
      leaseReleasedForRootCleanup = await captureCleanup('lease-release', async () => {
        await probeLease!.release();
        probeLeaseReleased = true;
      });
    }
    if (conformanceServers) {
      await captureCleanup('server-close', async () => conformanceServers!.close());
      conformanceServers = undefined;
    }

    let outerCanaryRemoved = !outerCanaryOwned;
    if (outerCanaryPath && outerCanaryOwned) {
      outerCanaryRemoved = await captureCleanup('outer-canary-remove', async () => {
        await outerFence();
        await rm(outerCanaryPath!, { force: true });
        await fsyncDirectory(path.dirname(outerCanaryPath!), outerFence);
        if (await pathExists(outerCanaryPath!)) throw executionError('cleanup');
        outerCanaryOwned = false;
      });
    }
    if (probeRoot && processesExitedForRootCleanup && leaseReleasedForRootCleanup && outerCanaryRemoved) {
      await captureCleanup('probe-root-remove', async () => {
        if (await executionRecoveryAuthorityExists(probeRoot!)) return;
        await outerFence();
        await rm(probeRoot!, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
        if (await pathExists(probeRoot!)) throw executionError('cleanup');
      });
    }
  }

  if (!primaryFault && cleanupFaults.length > 0) primaryFault = cleanupFaults.shift();
  if (primaryFault || !availableCandidate) {
    return Object.freeze({
      status: 'unavailable',
      primary: primaryFault ?? probeFault('cleanup', 'probe-clean'),
      cleanup: Object.freeze([...cleanupFaults])
    });
  }
  return Object.freeze({ status: 'available' });
}
