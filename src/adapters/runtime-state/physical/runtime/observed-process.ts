import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { CommitFence } from '../contract/commit-fence.ts';
import {
  assertIndependentProviderProcessCapability,
  type IndependentProviderProcessCapability
} from './independent-provider-process.ts';
import {
  decodeWindowsJobActiveProcessCount,
  windowsNaturalExitSettlementDisposition,
  windowsPipeFailureDisposition,
  windowsWaitDisposition
} from './windows-process-codec.ts';

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const WINDOWS_CREATE_SUSPENDED = 0x0000_0004;
const WINDOWS_CREATE_UNICODE_ENVIRONMENT = 0x0000_0400;
const WINDOWS_EXTENDED_STARTUPINFO_PRESENT = 0x0008_0000;
const WINDOWS_CREATE_NO_WINDOW = 0x0800_0000;
const WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
const WINDOWS_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;
const WINDOWS_JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x0000_1000;
const WINDOWS_PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x0002_0002;
const WINDOWS_PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002_000d;
const WINDOWS_STARTF_USESTDHANDLES = 0x0000_0100;
const WINDOWS_TERMINATED_EXIT_CODE = 0x534d_3301;
const WINDOWS_MAX_ATTRIBUTE_LIST_BYTES = 1024 * 1024;
const WINDOWS_NATURAL_EXIT_SETTLEMENT_MS = 5_000;
export const MAX_COMMAND_STDIN_BYTES = 64 * 1024 * 1024;

export function copyBoundedCommandInput(
  input: Uint8Array | undefined,
  maximumBytes: number | undefined,
  label = 'command stdin'
): Buffer | null {
  if (maximumBytes !== undefined && (
    !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 0
    || maximumBytes > MAX_COMMAND_STDIN_BYTES
  )) {
    throw new Error(
      `${label} maximum must be a non-negative safe integer no greater than ${MAX_COMMAND_STDIN_BYTES}`
    );
  }
  if (input === undefined) return null;
  if (!(input instanceof Uint8Array)) throw new TypeError(`${label} must be a Uint8Array`);
  if (maximumBytes === undefined) throw new Error(`${label} maximum is required when input is supplied`);
  if (input.byteLength > maximumBytes) {
    throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  }
  return Buffer.from(input);
}

export type ObservedCommandTrigger =
  | 'aborted'
  | 'fence-lost'
  | 'lifecycle-failed'
  | 'observer-failed'
  | 'timed-out';

export type ObservedCommandStatus =
  | 'exited'
  | 'spawn-failed'
  | ObservedCommandTrigger
  | 'tree-unproven'
  | 'termination-unproven';

export interface ObservedCommandStreamEvidence {
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly observerTruncated: boolean;
}

export interface ObservedCommandTerminationEvidence {
  readonly requested: boolean;
  readonly gracefulAttempted: boolean;
  readonly forcedAttempted: boolean;
  readonly childCloseObserved: boolean;
  readonly streamsDrained: boolean;
  readonly treeClosed: boolean;
}

export type ObservedNativeProcessResourceKind =
  | 'root-process'
  | 'stdin-worker'
  | 'termination-helper';

export type ObservedNativeProcessResourceLedgerSnapshot = Readonly<{
  admittedResourceCount: number;
  startedResourceCount: number;
  rootProcessCount: number;
  stdinWorkerCount: number;
  helperProcessCount: number;
  settledResourceCount: number;
  failedAdmissionCount: number;
}>;

export interface ObservedNativeProcessResourceToken {
  start(): void;
  settle(): void;
}

export interface ObservedNativeProcessResourceLedger {
  readonly deadlineAtMonotonicMs: number;
  admit(kind: ObservedNativeProcessResourceKind): ObservedNativeProcessResourceToken;
  snapshot(): ObservedNativeProcessResourceLedgerSnapshot;
  close(): ObservedNativeProcessResourceLedgerSnapshot;
}

const ISSUED_OBSERVED_NATIVE_RESOURCE_LEDGERS = new WeakSet<object>();
const ISSUED_OBSERVED_NATIVE_RESOURCE_TOKENS = new WeakSet<object>();

/** Process-owner internal ledger. Raw process transports cannot mint this capability. */
export function openObservedNativeProcessResourceLedger(input: Readonly<{
  maximumResources: number;
  deadlineAtMonotonicMs: number;
}>): ObservedNativeProcessResourceLedger {
  if (!Number.isSafeInteger(input.maximumResources) || input.maximumResources < 1) {
    throw new Error('Native process resource ledger maximum is invalid.');
  }
  if (!Number.isFinite(input.deadlineAtMonotonicMs)) {
    throw new Error('Native process resource ledger deadline is invalid.');
  }
  let admittedResourceCount = 0;
  let startedResourceCount = 0;
  let rootProcessCount = 0;
  let stdinWorkerCount = 0;
  let helperProcessCount = 0;
  let settledResourceCount = 0;
  let failedAdmissionCount = 0;
  let closed = false;
  const snapshot = (): ObservedNativeProcessResourceLedgerSnapshot => Object.freeze({
    admittedResourceCount,
    startedResourceCount,
    rootProcessCount,
    stdinWorkerCount,
    helperProcessCount,
    settledResourceCount,
    failedAdmissionCount
  });
  const ledger: ObservedNativeProcessResourceLedger = {
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    admit(kind) {
      if (!ISSUED_OBSERVED_NATIVE_RESOURCE_LEDGERS.has(this) || closed) {
        throw new Error('Native process resource admission requires one live owner-issued ledger.');
      }
      if (kind !== 'root-process' && kind !== 'stdin-worker' && kind !== 'termination-helper') {
        throw new Error('Native process resource kind is invalid.');
      }
      if (performance.now() >= input.deadlineAtMonotonicMs) {
        throw new Error('Native process resource ledger deadline is exhausted.');
      }
      if (admittedResourceCount >= input.maximumResources) {
        throw new Error('Native process resource ledger process budget is exhausted.');
      }
      admittedResourceCount += 1;
      if (kind === 'root-process') rootProcessCount += 1;
      else if (kind === 'stdin-worker') stdinWorkerCount += 1;
      else helperProcessCount += 1;
      let started = false;
      let settled = false;
      const token: ObservedNativeProcessResourceToken = Object.freeze({
        start(): void {
          if (!ISSUED_OBSERVED_NATIVE_RESOURCE_TOKENS.has(this) || settled) {
            throw new Error('Native process resource start requires one unsettled owner token.');
          }
          if (started) return;
          started = true;
          startedResourceCount += 1;
        },
        settle(): void {
          if (!ISSUED_OBSERVED_NATIVE_RESOURCE_TOKENS.has(this)) {
            throw new Error('Native process resource settlement requires one owner token.');
          }
          if (settled) return;
          settled = true;
          settledResourceCount += 1;
          if (!started) failedAdmissionCount += 1;
        }
      });
      ISSUED_OBSERVED_NATIVE_RESOURCE_TOKENS.add(token);
      return token;
    },
    snapshot() {
      if (!ISSUED_OBSERVED_NATIVE_RESOURCE_LEDGERS.has(this)) {
        throw new Error('Native process resource snapshot requires one owner-issued ledger.');
      }
      return snapshot();
    },
    close() {
      if (!ISSUED_OBSERVED_NATIVE_RESOURCE_LEDGERS.has(this)) {
        throw new Error('Native process resource close requires one owner-issued ledger.');
      }
      if (settledResourceCount !== admittedResourceCount) {
        throw new Error('Native process resource ledger cannot close with unsettled admitted resources.');
      }
      closed = true;
      return snapshot();
    }
  };
  ISSUED_OBSERVED_NATIVE_RESOURCE_LEDGERS.add(ledger);
  return Object.freeze(ledger);
}

export interface ObservedCommandOutcome {
  readonly status: ObservedCommandStatus;
  readonly trigger?: ObservedCommandTrigger;
  readonly started: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly stdout: ObservedCommandStreamEvidence;
  readonly stderr: ObservedCommandStreamEvidence;
  readonly termination: ObservedCommandTerminationEvidence;
}

export type ObservedNativeLifecycleDiagnostic =
  | 'final-drain'
  | 'injected'
  | 'natural-settlement'
  | 'output-drain'
  | 'output-observation'
  | 'post-create-cleanup'
  | 'root-exit-code'
  | 'root-wait';

const observedNativeLifecycleDiagnostics = new WeakMap<
  ObservedCommandOutcome,
  ObservedNativeLifecycleDiagnostic
>();

/** Test-only bounded native lifecycle diagnostic bound to the exact outcome identity. */
export function observedCommandNativeLifecycleDiagnosticForTests(
  outcome: ObservedCommandOutcome
): ObservedNativeLifecycleDiagnostic | undefined {
  return observedNativeLifecycleDiagnostics.get(outcome);
}

class ObservedNativeLifecycleFailure extends Error {
  constructor(
    readonly status: ObservedCommandStatus,
    readonly trigger: ObservedCommandTrigger | undefined,
    readonly started: boolean,
    readonly termination: ObservedCommandTerminationEvidence,
    readonly diagnostic: ObservedNativeLifecycleDiagnostic,
    message: string
  ) {
    super(message);
    this.name = 'ObservedNativeLifecycleFailure';
  }
}

interface ObservedNativeLifecycleFailureVectorForTests {
  readonly status: ObservedCommandStatus;
  readonly trigger?: ObservedCommandTrigger;
  readonly started: boolean;
  readonly termination: ObservedCommandTerminationEvidence;
}

/** Test-only fault vector for the native spawn and runtime lifecycle boundaries. */
export function createObservedNativeLifecycleFailureForTests(
  vector: ObservedNativeLifecycleFailureVectorForTests
): Error {
  return new ObservedNativeLifecycleFailure(
    vector.status,
    vector.trigger,
    vector.started,
    Object.freeze({ ...vector.termination }),
    'injected',
    'Injected Windows observed process lifecycle failure'
  );
}

export interface ObservedCommandCoreOptions {
  /** Final fence evaluated only after the root, descendant tree, and streams settle. */
  readonly afterSettlement?: CommitFence;
  readonly beforeSpawn?: CommitFence;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly envMode?: 'inherit' | 'replace';
  readonly fenceIntervalMs?: number;
  readonly maxObservedOutputBytes?: number;
  readonly onChunk?: (stream: 'stdout' | 'stderr', byteLength: number) => void;
  readonly onOutput?: (stream: 'stdout' | 'stderr', chunk: Uint8Array) => void;
  readonly signal?: AbortSignal;
  /** Process-owner transport mapping; semantic capability admission remains with the caller. */
  readonly stdio?: SpawnOptions['stdio'];
  readonly terminationDeadlineMs?: number;
  readonly terminationGraceMs?: number;
  readonly timeoutMs?: number;
  readonly whileRunning?: CommitFence;
  readonly windowsHide?: boolean;
  /**
   * Allows a launcher root to create an independently owned provider process.
   * Only the retained launcher root remains in this observer's Job; callers
   * must perform an independent provider-state readback before claiming the
   * external descendant settled.
   */
  readonly independentProvider?: IndependentProviderProcessCapability;
  /** Process-owner internal native resource ledger; never a semantic Effect grant. */
  readonly nativeResourceLedger?: ObservedNativeProcessResourceLedger;
  /** Internal deterministic test seam. */
  readonly dependencies?: Partial<ObservedCommandDependencies>;
}

export function compileWindowsObservedJobLimitFlags(
  descendants: 'contained' | 'independent-provider'
): number {
  if (descendants === 'contained') return WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (descendants === 'independent-provider') {
    return WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      | WINDOWS_JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
  }
  throw new Error('Windows observed Job descendant disposition is invalid.');
}

export function windowsObservedJobDescendantDisposition(
  capability?: IndependentProviderProcessCapability
): 'contained' | 'independent-provider' {
  if (capability === undefined) return 'contained';
  assertIndependentProviderProcessCapability(capability);
  return 'independent-provider';
}

/** No-stdin process observation options used by the core capability. */
export type ObservedCommandOptions = ObservedCommandCoreOptions;

export type ObservedProcessTimerHandle = ReturnType<typeof setTimeout>;

type ObservedSpawnOptions = SpawnOptions & {
  readonly observedInput?: ObservedCommandInputCapability;
  readonly windowsJobDescendants?: 'contained' | 'independent-provider';
};

export interface ObservedCommandStdinController {
  readonly settlement: Promise<boolean>;
  abort(): void;
}

/**
 * Explicit stdin transport injected only by callers that need command input.
 * The process lifecycle core intentionally owns no worker or asset dependency.
 */
export interface ObservedCommandInputCapability {
  readonly input: Uint8Array;
  startWindowsWriter(
    handle: bigint,
    closeHandle: () => void
  ): ObservedCommandStdinController;
}

export interface ObservedProcessRuntime {
  readonly platform: NodeJS.Platform;
  readonly systemRoot: string;
  readonly monotonicNowMs: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => ObservedProcessTimerHandle;
  readonly clearTimer: (handle: ObservedProcessTimerHandle) => void;
  readonly spawnChild: (
    command: string,
    args: readonly string[],
    options: ObservedSpawnOptions
  ) => ChildProcess | Promise<ChildProcess>;
}

export interface ObservedProcessTreeInspectionRequest {
  readonly child: ChildProcess;
  readonly rootPid: number;
  readonly deadlineAtMs: number;
  readonly runtime: ObservedProcessRuntime;
}

export interface ObservedProcessTreeInspectionResult {
  readonly treeClosed: boolean;
  readonly forcedAttempted: boolean;
}

export interface ObservedProcessTreeTerminationRequest {
  readonly child: ChildProcess;
  readonly deadlineAtMs: number;
  readonly graceMs: number;
  readonly isChildCloseObserved: () => boolean;
  readonly waitForChildClose: (timeoutMs: number) => Promise<boolean>;
  readonly runtime: ObservedProcessRuntime;
  readonly nativeResourceLedger?: ObservedNativeProcessResourceLedger;
}

export interface ObservedProcessTreeTerminationResult {
  readonly gracefulAttempted: boolean;
  readonly forcedAttempted: boolean;
  readonly treeClosed: boolean;
}

export interface ObservedCommandDependencies {
  readonly platform: NodeJS.Platform;
  readonly systemRoot: string;
  readonly monotonicNowMs: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => ObservedProcessTimerHandle;
  readonly clearTimer: (handle: ObservedProcessTimerHandle) => void;
  readonly spawnChild: (
    command: string,
    args: readonly string[],
    options: ObservedSpawnOptions
  ) => ChildProcess | Promise<ChildProcess>;
  readonly terminateProcessTree: (
    request: ObservedProcessTreeTerminationRequest
  ) => Promise<ObservedProcessTreeTerminationResult>;
  readonly inspectProcessTreeClosed: (
    request: ObservedProcessTreeInspectionRequest
  ) => Promise<boolean | ObservedProcessTreeInspectionResult>;
}

interface MutableStreamEvidence {
  bytes: number;
  digest: ReturnType<typeof createHash>;
  observerBytes: number;
  observerTruncated: boolean;
}

function emptyStreamEvidence(): MutableStreamEvidence {
  return {
    bytes: 0,
    digest: createHash('sha256'),
    observerBytes: 0,
    observerTruncated: false
  };
}

function finalStreamEvidence(value: MutableStreamEvidence): ObservedCommandStreamEvidence {
  return Object.freeze({
    bytes: value.bytes,
    digest: `sha256:${value.digest.digest('hex')}`,
    observerTruncated: value.observerTruncated
  });
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return resolved;
}

function nonNegativeInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return resolved;
}

export interface WindowsObservedJobController {
  readonly activeProcessCount: () => number | null;
  readonly close: () => void;
  readonly terminate: () => boolean;
}

const windowsObservedJobs = new WeakMap<ChildProcess, WindowsObservedJobController>();

const windowsObservedStdinControllers = new WeakMap<ChildProcess, ObservedCommandStdinController>();

/** Test-only stable Job identity seam; production registrations come from suspended launch. */
export function registerObservedWindowsJobControllerForTests(
  child: ChildProcess,
  controller: WindowsObservedJobController
): void {
  windowsObservedJobs.set(child, controller);
}

let observedKernel32Promise: Promise<any> | undefined;

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function windowsQuoteArgument(value: string): string {
  if (value.length > 0 && !/[\s"]/u.test(value)) return value;
  let quoted = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    quoted += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

function windowsEnvironmentBlock(environment: NodeJS.ProcessEnv | undefined): Buffer {
  const entries = Object.entries(environment ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return Buffer.from(`${entries.map(([key, value]) => `${key}=${value}`).join('\0')}\0\0`, 'utf16le');
}

async function loadObservedKernel32(): Promise<any> {
  observedKernel32Promise ??= (async () => {
    const { dlopen, FFIType, ptr } = await import('bun:ffi');
    const library = dlopen('kernel32.dll', {
      CreatePipe: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      SetHandleInformation: { args: [FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
      InitializeProcThreadAttributeList: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32
      },
      UpdateProcThreadAttribute: {
        args: [
          FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr,
          FFIType.u64, FFIType.ptr, FFIType.ptr
        ],
        returns: FFIType.i32
      },
      DeleteProcThreadAttributeList: { args: [FFIType.ptr], returns: FFIType.void },
      CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
      SetInformationJobObject: {
        args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32],
        returns: FFIType.i32
      },
      QueryInformationJobObject: {
        args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32
      },
      TerminateJobObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
      CreateProcessW: {
        args: [
          FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32,
          FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr
        ],
        returns: FFIType.i32
      },
      AssignProcessToJobObject: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
      ResumeThread: { args: [FFIType.u64], returns: FFIType.u32 },
      TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      GetLastError: { args: [], returns: FFIType.u32 },
      PeekNamedPipe: {
        args: [
          FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr,
          FFIType.ptr, FFIType.ptr
        ],
        returns: FFIType.i32
      },
      ReadFile: {
        args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32
      },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
    } as const);
    return { library, ptr, symbols: library.symbols };
  })();
  return observedKernel32Promise;
}

async function spawnWindowsJobChild(
  command: string,
  args: readonly string[],
  options: ObservedSpawnOptions
): Promise<ChildProcess> {
  const kernel32 = await loadObservedKernel32();
  const closeHandles = new Set<bigint>();
  const closeHandle = (handle: bigint): void => {
    if (handle === 0n || !closeHandles.delete(handle)) return;
    kernel32.symbols.CloseHandle(handle);
  };
  const security = Buffer.alloc(24);
  security.writeUInt32LE(24, 0);
  security.writeUInt32LE(1, 16);
  const createPipe = (parentReads: boolean): { parent: bigint; child: bigint } => {
    const readHandle = Buffer.alloc(8);
    const writeHandle = Buffer.alloc(8);
    if (kernel32.symbols.CreatePipe(readHandle, writeHandle, security, 0) === 0) {
      throw new Error('Windows observed process pipe creation failed');
    }
    const read = readHandle.readBigUInt64LE(0);
    const write = writeHandle.readBigUInt64LE(0);
    closeHandles.add(read);
    closeHandles.add(write);
    const parent = parentReads ? read : write;
    const child = parentReads ? write : read;
    if (kernel32.symbols.SetHandleInformation(parent, 1, 0) === 0) {
      throw new Error('Windows observed process pipe inheritance failed');
    }
    return { parent, child };
  };

  let processHandle = 0n;
  let threadHandle = 0n;
  let jobHandle = 0n;
  let processAssignedToJob = false;
  try {
    const stdin = createPipe(false);
    const stdoutPipe = createPipe(true);
    const stderrPipe = createPipe(true);
    const observedInput = options.observedInput;
    if (observedInput === undefined) closeHandle(stdin.parent);
    const jobInformation = Buffer.alloc(144);
    const jobLimitFlags = compileWindowsObservedJobLimitFlags(
      options.windowsJobDescendants ?? 'contained'
    );
    jobInformation.writeUInt32LE(jobLimitFlags, 16);
    jobHandle = kernel32.symbols.CreateJobObjectW(null, null) as bigint;
    closeHandles.add(jobHandle);
    if (jobHandle === 0n || kernel32.symbols.SetInformationJobObject(
      jobHandle,
      WINDOWS_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
      jobInformation,
      jobInformation.byteLength
    ) === 0) throw new Error('Windows observed process Job creation failed');

    const inheritedHandles = Buffer.alloc(24);
    inheritedHandles.writeBigUInt64LE(stdin.child, 0);
    inheritedHandles.writeBigUInt64LE(stdoutPipe.child, 8);
    inheritedHandles.writeBigUInt64LE(stderrPipe.child, 16);
    const attributePayloads: Buffer[] = [inheritedHandles];
    const attributeListSize = Buffer.alloc(8);
    kernel32.symbols.InitializeProcThreadAttributeList(null, 2, 0, attributeListSize);
    const requiredAttributeBytes = Number(attributeListSize.readBigUInt64LE(0));
    if (!Number.isSafeInteger(requiredAttributeBytes) || requiredAttributeBytes <= 0 ||
      requiredAttributeBytes > WINDOWS_MAX_ATTRIBUTE_LIST_BYTES) {
      throw new Error('Windows observed process attribute-list size is invalid');
    }
    const attributeList = Buffer.alloc(requiredAttributeBytes);
    let attributeListInitialized = false;
    try {
      if (kernel32.symbols.InitializeProcThreadAttributeList(
        attributeList,
        2,
        0,
        attributeListSize
      ) === 0) throw new Error('Windows observed process attribute-list initialization failed');
      attributeListInitialized = true;
      if (kernel32.symbols.UpdateProcThreadAttribute(
        attributeList,
        0,
        BigInt(WINDOWS_PROC_THREAD_ATTRIBUTE_HANDLE_LIST),
        inheritedHandles,
        BigInt(inheritedHandles.byteLength),
        null,
        null
      ) === 0) throw new Error('Windows observed process handle-list publication failed');
      const inheritedJobs = Buffer.alloc(8);
      inheritedJobs.writeBigUInt64LE(jobHandle, 0);
      attributePayloads.push(inheritedJobs);
      if (kernel32.symbols.UpdateProcThreadAttribute(
        attributeList,
        0,
        BigInt(WINDOWS_PROC_THREAD_ATTRIBUTE_JOB_LIST),
        inheritedJobs,
        BigInt(inheritedJobs.byteLength),
        null,
        null
      ) === 0) throw new Error('Windows observed process Job-list publication failed');

      const startupInfo = Buffer.alloc(112);
      startupInfo.writeUInt32LE(112, 0);
      startupInfo.writeUInt32LE(WINDOWS_STARTF_USESTDHANDLES, 60);
      startupInfo.writeBigUInt64LE(stdin.child, 80);
      startupInfo.writeBigUInt64LE(stdoutPipe.child, 88);
      startupInfo.writeBigUInt64LE(stderrPipe.child, 96);
      startupInfo.writeBigUInt64LE(BigInt(kernel32.ptr(attributeList)), 104);
      const processInformation = Buffer.alloc(24);
      const commandLine = windowsWide([command, ...args].map(windowsQuoteArgument).join(' '));
      const currentDirectory = options.cwd === undefined ? null : windowsWide(String(options.cwd));
      const environmentBlock = windowsEnvironmentBlock(options.env);
      if (kernel32.symbols.CreateProcessW(
        windowsWide(command),
        commandLine,
        null,
        null,
        1,
        WINDOWS_CREATE_SUSPENDED | WINDOWS_CREATE_UNICODE_ENVIRONMENT |
          WINDOWS_EXTENDED_STARTUPINFO_PRESENT | WINDOWS_CREATE_NO_WINDOW,
        environmentBlock,
        currentDirectory,
        startupInfo,
        processInformation
      ) === 0) throw new Error('Windows observed process creation failed');
      processHandle = processInformation.readBigUInt64LE(0);
      threadHandle = processInformation.readBigUInt64LE(8);
      closeHandles.add(processHandle);
      closeHandles.add(threadHandle);
      const pid = processInformation.readUInt32LE(16);
      processAssignedToJob = true;
      if (processHandle === 0n || threadHandle === 0n || pid === 0) {
        throw new Error('Windows observed process creation returned invalid handles');
      }
      closeHandle(stdoutPipe.child);
      closeHandle(stderrPipe.child);
      closeHandle(stdin.child);
      if (kernel32.symbols.ResumeThread(threadHandle) === 0xffff_ffff) {
        throw new Error('Windows observed process resume failed');
      }
      closeHandle(threadHandle);
      threadHandle = 0n;

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const emitter = new EventEmitter() as ChildProcess & {
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
      };
      Object.defineProperties(emitter, {
        pid: { value: pid, enumerable: true },
        stdout: { value: stdout, enumerable: true },
        stderr: { value: stderr, enumerable: true },
        stdin: { value: null, enumerable: true }
      });
      Object.defineProperties(emitter, {
        exitCode: { value: null, writable: true, enumerable: true },
        signalCode: { value: null, writable: true, enumerable: true }
      });
      const controller: WindowsObservedJobController = {
        activeProcessCount: (): number | null => {
          const information = Buffer.alloc(48);
          if (kernel32.symbols.QueryInformationJobObject(
            jobHandle,
            WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
            information,
            information.byteLength,
            null
          ) === 0) return null;
          return decodeWindowsJobActiveProcessCount(information);
        },
        terminate: (): boolean => kernel32.symbols.TerminateJobObject(
          jobHandle,
          0xc000_013a
        ) !== 0,
        close: (): void => closeHandle(jobHandle)
      };
      windowsObservedJobs.set(emitter, controller);
      if (observedInput !== undefined) {
        const stdinController = observedInput.startWindowsWriter(
          stdin.parent,
          () => closeHandle(stdin.parent)
        );
        windowsObservedStdinControllers.set(emitter, stdinController);
      }
      emitter.kill = (): boolean => controller.terminate();

      const stdoutPipeState = { eof: false };
      const stderrPipeState = { eof: false };
      const drainPipe = (
        handle: bigint,
        output: PassThrough,
        state: { eof: boolean }
      ): Readonly<{ empty: boolean; failed: boolean }> => {
        if (state.eof) return { empty: true, failed: false };
        const nativeFailure = (): Readonly<{ empty: boolean; failed: boolean }> => {
          if (windowsPipeFailureDisposition(kernel32.symbols.GetLastError()) === 'eof') {
            state.eof = true;
            return { empty: true, failed: false };
          }
          return { empty: false, failed: true };
        };
        const maximumBytesPerTurn = 256 * 1024;
        const maximumReadsPerTurn = 4;
        let drainedBytes = 0;
        let reads = 0;
        while (drainedBytes < maximumBytesPerTurn && reads < maximumReadsPerTurn) {
          const available = Buffer.alloc(4);
          if (kernel32.symbols.PeekNamedPipe(handle, null, 0, null, available, null) === 0) {
            return nativeFailure();
          }
          const byteLength = Math.min(
            64 * 1024,
            maximumBytesPerTurn - drainedBytes,
            available.readUInt32LE(0)
          );
          if (byteLength === 0) return { empty: true, failed: false };
          const bytes = Buffer.alloc(byteLength);
          const read = Buffer.alloc(4);
          if (kernel32.symbols.ReadFile(handle, bytes, byteLength, read, null) === 0) {
            return nativeFailure();
          }
          const actual = read.readUInt32LE(0);
          if (actual === 0) return { empty: false, failed: true };
          output.write(bytes.subarray(0, actual));
          drainedBytes += actual;
          reads += 1;
        }
        const available = Buffer.alloc(4);
        if (kernel32.symbols.PeekNamedPipe(handle, null, 0, null, available, null) === 0) {
          return nativeFailure();
        }
        return { empty: available.readUInt32LE(0) === 0, failed: false };
      };
      let stdoutFirst = true;
      const drainPipes = (): Readonly<{ empty: boolean; failed: boolean }> => {
        const first = stdoutFirst
          ? drainPipe(stdoutPipe.parent, stdout, stdoutPipeState)
          : drainPipe(stderrPipe.parent, stderr, stderrPipeState);
        const second = stdoutFirst
          ? drainPipe(stderrPipe.parent, stderr, stderrPipeState)
          : drainPipe(stdoutPipe.parent, stdout, stdoutPipeState);
        stdoutFirst = !stdoutFirst;
        return {
          empty: first.empty && second.empty,
          failed: first.failed || second.failed
        };
      };
      let terminalizing = false;
      let completed = false;
      let rootExitCode: number | null = null;
      const readRootExitCode = (): number | null => {
        if (rootExitCode !== null) return rootExitCode;
        const exit = Buffer.alloc(4);
        if (kernel32.symbols.GetExitCodeProcess(processHandle, exit) === 0) return null;
        rootExitCode = exit.readUInt32LE(0);
        return rootExitCode;
      };
      const closeObservedHandles = (): void => {
        closeHandle(stdoutPipe.parent);
        closeHandle(stderrPipe.parent);
        closeHandle(processHandle);
        processHandle = 0n;
      };
      const emitComplete = (exitCode: number | null): void => {
        if (completed) return;
        completed = true;
        Object.defineProperty(emitter, 'exitCode', {
          value: exitCode,
          writable: true,
          enumerable: true
        });
        closeObservedHandles();
        emitter.emit('exit', exitCode, null);
        stdout.end();
        stderr.end();
        setTimeout(() => emitter.emit('close', exitCode, null), 0);
      };
      const emitLifecycleFailure = (
        childCloseObserved: boolean,
        streamsDrained: boolean,
        treeClosed: boolean,
        diagnostic: ObservedNativeLifecycleDiagnostic,
        message: string
      ): void => {
        if (completed) return;
        completed = true;
        Object.defineProperty(emitter, 'exitCode', {
          value: null,
          writable: true,
          enumerable: true
        });
        closeObservedHandles();
        stdout.end();
        stderr.end();
        emitter.emit('error', new ObservedNativeLifecycleFailure(
          treeClosed && streamsDrained ? 'lifecycle-failed' : 'termination-unproven',
          'lifecycle-failed',
          true,
          Object.freeze({
            requested: true,
            gracefulAttempted: false,
            forcedAttempted: true,
            childCloseObserved,
            streamsDrained,
            treeClosed: treeClosed && streamsDrained
          }),
          diagnostic,
          message
        ));
        setTimeout(() => emitter.emit('close', null, null), 0);
      };
      const drainUntilEmpty = (
        onDrained: () => void,
        onFailure: () => void
      ): void => {
        if (completed) return;
        const drained = drainPipes();
        if (drained.failed) {
          onFailure();
          return;
        }
        if (!drained.empty) {
          setTimeout(() => drainUntilEmpty(onDrained, onFailure), 0);
          return;
        }
        onDrained();
      };
      const drainUntilClosed = (
        onDrained: () => void,
        onFailure: () => void
      ): void => {
        if (completed) return;
        const drained = drainPipes();
        if (drained.failed) {
          onFailure();
          return;
        }
        if (!drained.empty || !stdoutPipeState.eof || !stderrPipeState.eof) {
          setTimeout(() => drainUntilClosed(onDrained, onFailure), drained.empty ? 5 : 0);
          return;
        }
        onDrained();
      };
      const forceLifecycleFailure = (
        message: string,
        diagnostic: ObservedNativeLifecycleDiagnostic
      ): void => {
        controller.terminate();
        const processWait = windowsWaitDisposition(
          kernel32.symbols.WaitForSingleObject(processHandle, 5_000)
        );
        const activeProcesses = controller.activeProcessCount();
        const childCloseObserved = processWait === 'signaled';
        const treeClosed = childCloseObserved && activeProcesses === 0;
        controller.close();
        windowsObservedJobs.delete(emitter);
        if (!treeClosed) {
          emitLifecycleFailure(childCloseObserved, false, false, diagnostic, message);
          return;
        }
        drainUntilEmpty(
          () => emitLifecycleFailure(true, true, true, diagnostic, message),
          () => emitLifecycleFailure(true, false, false, 'final-drain', message)
        );
      };
      const failClosed = (
        message: string,
        diagnostic: ObservedNativeLifecycleDiagnostic
      ): void => {
        if (completed) return;
        terminalizing = true;
        // Anonymous-pipe observation can race Bun's final handle teardown.
        // Retry that primitive inside one finite window while independently
        // observing the root handle and Job membership. A recovered observer
        // resumes normal polling; a signalled root is accepted only after the
        // Job reaches zero and a final empty drain succeeds.
        const settlementDeadline = Date.now() + WINDOWS_NATURAL_EXIT_SETTLEMENT_MS;
        const recoverLifecycleObservation = (): void => {
          if (completed) return;
          const drained = drainPipes();
          const processWait = windowsWaitDisposition(
            kernel32.symbols.WaitForSingleObject(processHandle, 0)
          );
          const remainingMs = settlementDeadline - Date.now();
          if (processWait === 'failed') {
            forceLifecycleFailure(message, 'root-wait');
            return;
          }
          if (processWait === 'pending') {
            if (!drained.failed) {
              terminalizing = false;
              setTimeout(poll, 0);
              return;
            }
            if (remainingMs > 0) {
              setTimeout(recoverLifecycleObservation, 5);
              return;
            }
            forceLifecycleFailure(message, diagnostic);
            return;
          }
          const exitCode = readRootExitCode();
          if (exitCode === null) {
            forceLifecycleFailure(message, 'root-exit-code');
            return;
          }
          const disposition = windowsNaturalExitSettlementDisposition(
            controller.activeProcessCount(),
            remainingMs
          );
          if (disposition === 'pending') {
            setTimeout(recoverLifecycleObservation, 5);
            return;
          }
          if (disposition === 'settled' && drained.failed) {
            if (remainingMs > 0) {
              setTimeout(recoverLifecycleObservation, 5);
            } else {
              forceLifecycleFailure(message, 'final-drain');
            }
            return;
          }
          if (disposition === 'unproven') {
            forceLifecycleFailure(message, 'natural-settlement');
            return;
          }
          drainUntilEmpty(
            () => emitComplete(exitCode),
            () => forceLifecycleFailure(message, 'final-drain')
          );
        };
        setTimeout(recoverLifecycleObservation, 5);
      };
      const complete = (exitCode: number | null): void => {
        if (terminalizing || completed) return;
        terminalizing = true;
        // The root may exit before Bun's builder workers. Wait for both
        // inherited pipes to reach EOF, then let runObservedCommand perform
        // the single authoritative Job accounting/closure proof.
        drainUntilClosed(
          () => emitComplete(exitCode),
          () => failClosed('Windows observed process output drain failed', 'output-drain')
        );
      };
      const poll = (): void => {
        if (terminalizing || completed) return;
        const drained = drainPipes();
        if (drained.failed) {
          failClosed(
            'Windows observed process output observation failed',
            'output-observation'
          );
          return;
        }
        const wait = windowsWaitDisposition(kernel32.symbols.WaitForSingleObject(processHandle, 0));
        if (wait === 'pending') {
          setTimeout(poll, 5);
          return;
        }
        if (wait === 'failed') {
          failClosed('Windows observed process wait failed', 'root-wait');
          return;
        }
        complete(readRootExitCode());
      };
      setTimeout(poll, 0);
      return emitter;
    } finally {
      if (attributeListInitialized) {
        kernel32.symbols.DeleteProcThreadAttributeList(attributeList);
      }
      for (const payload of attributePayloads) void payload.byteLength;
    }
  } catch (error) {
    let lifecycleFailure: ObservedNativeLifecycleFailure | undefined;
    if (processAssignedToJob) {
      const terminated = jobHandle !== 0n &&
        kernel32.symbols.TerminateJobObject(jobHandle, WINDOWS_TERMINATED_EXIT_CODE) !== 0;
      if (!terminated && jobHandle !== 0n) {
        closeHandle(jobHandle);
        jobHandle = 0n;
      }
      const processWait = processHandle === 0n
        ? 'failed'
        : windowsWaitDisposition(kernel32.symbols.WaitForSingleObject(processHandle, 5_000));
      let activeProcesses: number | null = null;
      if (jobHandle !== 0n) {
        const information = Buffer.alloc(48);
        activeProcesses = kernel32.symbols.QueryInformationJobObject(
          jobHandle,
          WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
          information,
          information.byteLength,
          null
        ) === 0 ? null : decodeWindowsJobActiveProcessCount(information);
      }
      const childCloseObserved = processWait === 'signaled' ||
        (processHandle === 0n && activeProcesses === 0);
      const treeClosed = childCloseObserved && activeProcesses === 0;
      lifecycleFailure = new ObservedNativeLifecycleFailure(
        treeClosed ? 'spawn-failed' : 'termination-unproven',
        undefined,
        true,
        Object.freeze({
          requested: true,
          gracefulAttempted: false,
          forcedAttempted: true,
          childCloseObserved,
          streamsDrained: treeClosed,
          treeClosed
        }),
        'post-create-cleanup',
        'Windows observed process post-create cleanup failed'
      );
    } else if (processHandle !== 0n) {
      const terminated = kernel32.symbols.TerminateProcess(
        processHandle,
        WINDOWS_TERMINATED_EXIT_CODE
      ) !== 0;
      const processWait = terminated
        ? windowsWaitDisposition(kernel32.symbols.WaitForSingleObject(processHandle, 5_000))
        : 'failed';
      const treeClosed = processWait === 'signaled';
      lifecycleFailure = new ObservedNativeLifecycleFailure(
        treeClosed ? 'spawn-failed' : 'termination-unproven',
        undefined,
        true,
        Object.freeze({
          requested: true,
          gracefulAttempted: false,
          forcedAttempted: true,
          childCloseObserved: treeClosed,
          streamsDrained: treeClosed,
          treeClosed
        }),
        'post-create-cleanup',
        'Windows observed process unassigned cleanup failed'
      );
    }
    for (const handle of [...closeHandles]) closeHandle(handle);
    if (lifecycleFailure) throw lifecycleFailure;
    throw error;
  }
}

async function defaultSpawnChild(
  command: string,
  args: readonly string[],
  options: ObservedSpawnOptions
): Promise<ChildProcess> {
  const {
    observedInput: _observedInput,
    windowsJobDescendants: _windowsJobDescendants,
    ...spawnOptions
  } = options;
  return process.platform === 'win32'
    ? spawnWindowsJobChild(command, args, options)
    : spawn(command, [...args], spawnOptions);
}

function remainingBudgetMs(deadlineAtMs: number, runtime: ObservedProcessRuntime): number {
  return Math.max(0, Math.ceil(deadlineAtMs - runtime.monotonicNowMs()));
}

function phaseDeadlineAtMs(
  deadlineAtMs: number,
  phaseBudgetMs: number,
  runtime: ObservedProcessRuntime
): number {
  return Math.min(deadlineAtMs, runtime.monotonicNowMs() + phaseBudgetMs);
}

function waitForProcessClose(
  child: ChildProcess,
  deadlineAtMs: number,
  runtime: ObservedProcessRuntime,
  onLifecycleFailure?: (failure: ObservedNativeLifecycleFailure) => void
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  const timeoutMs = remainingBudgetMs(deadlineAtMs, runtime);
  if (timeoutMs === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let complete = false;
    const finish = (closed: boolean): void => {
      if (complete) return;
      complete = true;
      runtime.clearTimer(timeout);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve(closed);
    };
    const onClose = (): void => finish(true);
    const onError = (error: Error): void => {
      if (error instanceof ObservedNativeLifecycleFailure) onLifecycleFailure?.(error);
      finish(false);
    };
    const timeout = runtime.setTimer(() => finish(false), timeoutMs);
    child.once('close', onClose);
    child.once('error', onError);
  });
}

async function inspectWindowsProcessTreeClosed(
  request: ObservedProcessTreeInspectionRequest
): Promise<ObservedProcessTreeInspectionResult> {
  const controller = windowsObservedJobs.get(request.child);
  if (!controller) return { treeClosed: false, forcedAttempted: false };
  while (remainingBudgetMs(request.deadlineAtMs, request.runtime) > 0) {
    const active = controller.activeProcessCount();
    if (active === 0) {
      controller.close();
      windowsObservedJobs.delete(request.child);
      return { treeClosed: true, forcedAttempted: false };
    }
    if (active === null) break;
    await new Promise<void>((resolve) => request.runtime.setTimer(
      resolve,
      Math.min(5, remainingBudgetMs(request.deadlineAtMs, request.runtime))
    ));
  }
  controller.terminate();
  controller.close();
  windowsObservedJobs.delete(request.child);
  return { treeClosed: false, forcedAttempted: true };
}

async function inspectObservedProcessTreeClosed(
  request: ObservedProcessTreeInspectionRequest
): Promise<ObservedProcessTreeInspectionResult> {
  return request.runtime.platform === 'win32'
    ? inspectWindowsProcessTreeClosed(request)
    : { treeClosed: !processGroupExists(request.rootPid), forcedAttempted: false };
}

async function terminateWindowsProcessTree(
  request: ObservedProcessTreeTerminationRequest
): Promise<ObservedProcessTreeTerminationResult> {
  const pid = request.child.pid;
  const runTaskkill = async (
    force: boolean
  ): Promise<Readonly<{ commandSucceeded: boolean; helperTreeClosed: boolean }>> => {
    if (!pid || request.isChildCloseObserved()) {
      return { commandSucceeded: false, helperTreeClosed: true };
    }
    if (remainingBudgetMs(request.deadlineAtMs, request.runtime) === 0) {
      return { commandSucceeded: false, helperTreeClosed: true };
    }
    const systemDirectory = path.win32.join(request.runtime.systemRoot, 'System32');
    let killer: ChildProcess;
    let helperResource: ObservedNativeProcessResourceToken | undefined;
    try {
      helperResource = request.nativeResourceLedger?.admit('termination-helper');
      killer = await request.runtime.spawnChild(
        path.win32.join(systemDirectory, 'taskkill.exe'),
        ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
        {
          cwd: systemDirectory,
          env: {
            SystemRoot: request.runtime.systemRoot,
            SYSTEMROOT: request.runtime.systemRoot,
            WINDIR: request.runtime.systemRoot
          },
          shell: false,
          stdio: 'ignore',
          windowsHide: true
        }
      );
      helperResource?.start();
    } catch (error) {
      if (error instanceof ObservedNativeLifecycleFailure && error.started) helperResource?.start();
      helperResource?.settle();
      return {
        commandSucceeded: false,
        helperTreeClosed: error instanceof ObservedNativeLifecycleFailure
          ? error.termination.treeClosed
        : true
      };
    }
    try {
      const phaseDeadline = phaseDeadlineAtMs(
        request.deadlineAtMs,
        request.graceMs,
        request.runtime
      );
      let killerLifecycleFailure: ObservedNativeLifecycleFailure | undefined;
      let helperForceAttempted = false;
      const captureLifecycleFailure = (failure: ObservedNativeLifecycleFailure): void => {
        killerLifecycleFailure ??= failure;
      };
      let closed = await waitForProcessClose(
        killer,
        phaseDeadline,
        request.runtime,
        captureLifecycleFailure
      );
      const killerController = windowsObservedJobs.get(killer);
      if (!closed) {
        if (killerController) {
          killerController.terminate();
          helperForceAttempted = true;
        }
        else killer.kill('SIGKILL');
        closed = await waitForProcessClose(
          killer,
          request.deadlineAtMs,
          request.runtime,
          captureLifecycleFailure
        );
      }
      let taskkillTreeClosed = killerController === undefined
        ? killerLifecycleFailure?.termination.treeClosed === true ||
          (killerLifecycleFailure === undefined && closed && killer.exitCode !== null)
        : false;
      if (killerController) {
        let active = killerController.activeProcessCount();
        if (active !== 0 && !helperForceAttempted &&
          remainingBudgetMs(request.deadlineAtMs, request.runtime) > 0) {
          killerController.terminate();
          helperForceAttempted = true;
        }
        while (active !== 0 && active !== null &&
          remainingBudgetMs(request.deadlineAtMs, request.runtime) > 0) {
          await new Promise<void>((resolve) => request.runtime.setTimer(
            resolve,
            Math.min(5, remainingBudgetMs(request.deadlineAtMs, request.runtime))
          ));
          active = killerController.activeProcessCount();
        }
        taskkillTreeClosed = closed && active === 0;
        if (windowsObservedJobs.get(killer) === killerController) {
          killerController.close();
          windowsObservedJobs.delete(killer);
        }
      }
      return {
        commandSucceeded: closed && taskkillTreeClosed && killer.exitCode === 0,
        helperTreeClosed: taskkillTreeClosed
      };
    } finally {
      helperResource?.settle();
    }
  };

  const controller = windowsObservedJobs.get(request.child);
  if (controller) {
    let gracefulAttempted = false;
    let helperTreesClosed = true;
    // Owner-issued resource sessions already retain the Job controller. Use
    // that native capability directly so termination cannot require a child
    // process that was not reserved at root-process admission. The legacy
    // raw transport keeps taskkill accounting below until its consumers move
    // behind the resource-session owner.
    if (request.nativeResourceLedger === undefined
      && pid && !request.isChildCloseObserved() &&
      remainingBudgetMs(request.deadlineAtMs, request.runtime) > 0) {
      gracefulAttempted = true;
      const graceful = await runTaskkill(false);
      helperTreesClosed = helperTreesClosed && graceful.helperTreeClosed;
      if (!request.isChildCloseObserved()) {
        await request.waitForChildClose(Math.min(
          request.graceMs,
          remainingBudgetMs(request.deadlineAtMs, request.runtime)
        ));
      }
    }
    let active = controller.activeProcessCount();
    if (active === 0 && request.isChildCloseObserved()) {
      controller.close();
      windowsObservedJobs.delete(request.child);
      return {
        gracefulAttempted,
        forcedAttempted: false,
        treeClosed: helperTreesClosed
      };
    }

    const forcedAttempted = true;
    controller.terminate();
    if (!request.isChildCloseObserved()) {
      await request.waitForChildClose(Math.min(
        request.graceMs,
        remainingBudgetMs(request.deadlineAtMs, request.runtime)
      ));
    }
    while (remainingBudgetMs(request.deadlineAtMs, request.runtime) > 0) {
      active = controller.activeProcessCount();
      if (active === 0) break;
      if (active === null) break;
      await new Promise<void>((resolve) => request.runtime.setTimer(
        resolve,
        Math.min(5, remainingBudgetMs(request.deadlineAtMs, request.runtime))
      ));
    }
    const treeClosed = helperTreesClosed && active === 0 && request.isChildCloseObserved();
    controller.close();
    windowsObservedJobs.delete(request.child);
    return { gracefulAttempted, forcedAttempted, treeClosed };
  }

  if (!pid) {
    request.child.kill('SIGKILL');
    await request.waitForChildClose(Math.min(
      request.graceMs,
      remainingBudgetMs(request.deadlineAtMs, request.runtime)
    ));
    return { gracefulAttempted: false, forcedAttempted: true, treeClosed: false };
  }
  const graceful = await runTaskkill(false);
  if (!request.isChildCloseObserved()) {
    await request.waitForChildClose(Math.min(
      request.graceMs,
      remainingBudgetMs(request.deadlineAtMs, request.runtime)
    ));
  }
  if (graceful.commandSucceeded && graceful.helperTreeClosed && request.isChildCloseObserved()) {
    return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
  }
  if (request.isChildCloseObserved()) {
    return { gracefulAttempted: true, forcedAttempted: false, treeClosed: false };
  }
  const forced = await runTaskkill(true);
  if (!request.isChildCloseObserved()) {
    await request.waitForChildClose(Math.min(
      request.graceMs,
      remainingBudgetMs(request.deadlineAtMs, request.runtime)
    ));
  }
  return {
    gracefulAttempted: true,
    forcedAttempted: true,
    treeClosed: graceful.helperTreeClosed && forced.commandSucceeded &&
      forced.helperTreeClosed && request.isChildCloseObserved()
  };
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    return true;
  }
}

async function terminatePosixProcessTree(
  request: ObservedProcessTreeTerminationRequest
): Promise<ObservedProcessTreeTerminationResult> {
  const pid = request.child.pid;
  if (!pid) {
    request.child.kill('SIGKILL');
    await request.waitForChildClose(Math.min(
      request.graceMs,
      remainingBudgetMs(request.deadlineAtMs, request.runtime)
    ));
    return { gracefulAttempted: true, forcedAttempted: true, treeClosed: false };
  }
  const gracefulAttempted = signalProcessGroup(pid, 'SIGTERM');
  await request.waitForChildClose(Math.min(
    request.graceMs,
    remainingBudgetMs(request.deadlineAtMs, request.runtime)
  ));
  let forcedAttempted = false;
  if (processGroupExists(pid)) {
    forcedAttempted = signalProcessGroup(pid, 'SIGKILL');
    if (!request.isChildCloseObserved()) {
      await request.waitForChildClose(Math.min(
        request.graceMs,
        remainingBudgetMs(request.deadlineAtMs, request.runtime)
      ));
    }
  }
  return {
    gracefulAttempted,
    forcedAttempted,
    treeClosed: request.isChildCloseObserved() && !processGroupExists(pid)
  };
}

export async function terminateObservedProcessTree(
  request: ObservedProcessTreeTerminationRequest
): Promise<ObservedProcessTreeTerminationResult> {
  return request.runtime.platform === 'win32'
    ? terminateWindowsProcessTree(request)
    : terminatePosixProcessTree(request);
}

const DEFAULT_DEPENDENCIES: ObservedCommandDependencies = {
  platform: process.platform,
  systemRoot: (() => {
    const configured = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? String.raw`C:\Windows`;
    return path.isAbsolute(configured) ? configured : String.raw`C:\Windows`;
  })(),
  monotonicNowMs: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
  spawnChild: defaultSpawnChild,
  terminateProcessTree: terminateObservedProcessTree,
  inspectProcessTreeClosed: inspectObservedProcessTreeClosed
};

function raceWithDeadline<T>(
  promise: Promise<T>,
  deadlineAtMs: number,
  dependencies: ObservedCommandDependencies
): Promise<T | null> {
  const timeoutMs = Math.max(0, Math.ceil(deadlineAtMs - dependencies.monotonicNowMs()));
  if (timeoutMs === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let complete = false;
    const finish = (value: T | null): void => {
      if (complete) return;
      complete = true;
      dependencies.clearTimer(timer);
      resolve(value);
    };
    const timer = dependencies.setTimer(() => finish(null), timeoutMs);
    void promise.then(finish, () => finish(null));
  });
}

export async function runObservedCommand(
  command: string,
  args: readonly string[],
  options: ObservedCommandCoreOptions,
  inputCapability?: ObservedCommandInputCapability
): Promise<ObservedCommandOutcome> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const fenceIntervalMs = positiveInteger(options.fenceIntervalMs, 50, 'fenceIntervalMs');
  const terminationGraceMs = positiveInteger(options.terminationGraceMs, 5_000, 'terminationGraceMs');
  const terminationDeadlineMs = positiveInteger(
    options.terminationDeadlineMs,
    terminationGraceMs * 4,
    'terminationDeadlineMs'
  );
  const maxObservedOutputBytes = nonNegativeInteger(
    options.maxObservedOutputBytes,
    0,
    'maxObservedOutputBytes'
  );
  const commandInput = inputCapability?.input ?? null;
  if (options.timeoutMs !== undefined) positiveInteger(options.timeoutMs, 1, 'timeoutMs');

  const startedAt = dependencies.monotonicNowMs();
  const operationDeadlineAtMs = options.timeoutMs === undefined
    ? options.nativeResourceLedger?.deadlineAtMonotonicMs ?? null
    : Math.min(
      startedAt + options.timeoutMs,
      options.nativeResourceLedger?.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY
    );
  const settlementDeadlineAtMs = (): number => Math.min(
    dependencies.monotonicNowMs() + terminationDeadlineMs,
    options.nativeResourceLedger?.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY
  );
  const stdout = emptyStreamEvidence();
  const stderr = emptyStreamEvidence();
  let child: ChildProcess | undefined;
  let spawnObserved = false;
  let spawnFailureObserved = false;
  let childCloseObserved = false;
  let streamsDrained = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let settled = false;
  let trigger: ObservedCommandTrigger | undefined;
  let settlementFenceLost = false;
  let timeoutTimer: ObservedProcessTimerHandle | undefined;
  let fenceTimer: ObservedProcessTimerHandle | undefined;
  let rootResource: ObservedNativeProcessResourceToken | undefined;
  const closeWaiters = new Set<(closed: boolean) => void>();
  const processRuntime: ObservedProcessRuntime = Object.freeze({
    platform: dependencies.platform,
    systemRoot: dependencies.systemRoot,
    monotonicNowMs: dependencies.monotonicNowMs,
    setTimer: dependencies.setTimer,
    clearTimer: dependencies.clearTimer,
    spawnChild: dependencies.spawnChild
  });

  const finishWithoutChild = (status: ObservedCommandStatus): ObservedCommandOutcome => Object.freeze({
    status,
    ...(trigger ? { trigger } : {}),
    started: false,
    exitCode: null,
    signal: null,
    durationMs: Math.max(0, dependencies.monotonicNowMs() - startedAt),
    stdout: finalStreamEvidence(stdout),
    stderr: finalStreamEvidence(stderr),
    termination: Object.freeze({
      requested: trigger !== undefined,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: false,
      streamsDrained: true,
      treeClosed: true
    })
  });
  const finishLifecycleFailure = (
    error: ObservedNativeLifecycleFailure
  ): ObservedCommandOutcome => {
    trigger = error.trigger;
    const outcome = Object.freeze({
      status: error.status,
      ...(error.trigger ? { trigger: error.trigger } : {}),
      started: error.started,
      exitCode: null,
      signal: null,
      durationMs: Math.max(0, dependencies.monotonicNowMs() - startedAt),
      stdout: finalStreamEvidence(stdout),
      stderr: finalStreamEvidence(stderr),
      termination: error.termination
    });
    observedNativeLifecycleDiagnostics.set(outcome, error.diagnostic);
    return outcome;
  };

  if (options.signal?.aborted) {
    trigger = 'aborted';
    return finishWithoutChild('aborted');
  }
  try {
    const beforeSpawn = Promise.resolve()
      .then(() => options.beforeSpawn?.())
      .then(() => true, () => false);
    const admitted = operationDeadlineAtMs === null
      ? await beforeSpawn
      : await raceWithDeadline(beforeSpawn, operationDeadlineAtMs, dependencies);
    if (admitted === null) {
      trigger = 'timed-out';
      return finishWithoutChild('timed-out');
    }
    if (!admitted) return finishWithoutChild('spawn-failed');
  } catch {
    return finishWithoutChild('spawn-failed');
  }
  if (options.signal?.aborted) {
    trigger = 'aborted';
    return finishWithoutChild('aborted');
  }

  const inheritedEnv = options.envMode === 'replace' ? {} : process.env;
  const env = Object.fromEntries(Object.entries({
    ...inheritedEnv,
    ...options.env
  }).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;

  try {
    const descendantDisposition = windowsObservedJobDescendantDisposition(
      options.independentProvider
    );
    const configuredStdio = options.stdio ?? ['ignore', 'pipe', 'pipe'];
    const stdio = (commandInput === null
      ? configuredStdio
      : Object.assign([...configuredStdio], { 0: 'pipe' as const })) as SpawnOptions['stdio'];
    rootResource = options.nativeResourceLedger?.admit('root-process');
    child = await dependencies.spawnChild(command, args, {
      cwd: options.cwd,
      env,
      shell: false,
      stdio,
      windowsHide: options.windowsHide ?? true,
      windowsJobDescendants: descendantDisposition,
      detached: dependencies.platform !== 'win32',
      ...(inputCapability === undefined ? {} : { observedInput: inputCapability })
    });
    spawnObserved = child.pid !== undefined;
    if (spawnObserved) rootResource?.start();
  } catch (error) {
    if (error instanceof ObservedNativeLifecycleFailure && error.started) rootResource?.start();
    rootResource?.settle();
    if (error instanceof ObservedNativeLifecycleFailure) return finishLifecycleFailure(error);
    return finishWithoutChild('spawn-failed');
  }

  return new Promise<ObservedCommandOutcome>((resolve) => {
    const runningChild = child!;
    const outputDrained = { stdout: runningChild.stdout == null, stderr: runningChild.stderr == null };
    const nativeStdinController = windowsObservedStdinControllers.get(runningChild);
    let stdinFinished = false;
    let stdinFailed = false;
    let resolveStandardStdin!: (value: boolean) => void;
    const standardStdinSettlement = new Promise<boolean>((resolveStdin) => {
      resolveStandardStdin = resolveStdin;
    });
    let standardStdinSettled = false;
    const settleStandardStdin = (value: boolean): void => {
      if (standardStdinSettled) return;
      standardStdinSettled = true;
      stdinFinished = value;
      stdinFailed = !value;
      resolveStandardStdin(value);
    };
    const stdinSettlement = nativeStdinController === undefined
      ? runningChild.stdin == null
        ? Promise.resolve(commandInput === null)
        : standardStdinSettlement
      : nativeStdinController.settlement.then((value) => {
          stdinFinished = value;
          stdinFailed = !value;
          return value;
        });
    if (nativeStdinController === undefined && runningChild.stdin == null) {
      stdinFinished = commandInput === null;
      stdinFailed = commandInput !== null;
    }

    const clearLifecycle = (): void => {
      if (timeoutTimer !== undefined) dependencies.clearTimer(timeoutTimer);
      if (fenceTimer !== undefined) dependencies.clearTimer(fenceTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const updateStreamsDrained = (): void => {
      streamsDrained = outputDrained.stdout && outputDrained.stderr;
    };
    const settle = (
      status: ObservedCommandStatus,
      termination: ObservedCommandTerminationEvidence,
      nativeDiagnostic?: ObservedNativeLifecycleDiagnostic
    ): void => {
      if (settled) return;
      settled = true;
      clearLifecycle();
      for (const waiter of closeWaiters) waiter(childCloseObserved);
      closeWaiters.clear();
      void (async () => {
        if (options.afterSettlement !== undefined) {
          const fenceDeadlineAtMs = settlementDeadlineAtMs();
          const finalFencePassed = await raceWithDeadline(
            Promise.resolve()
              .then(() => options.afterSettlement!())
              .then(() => true, () => false),
            fenceDeadlineAtMs,
            dependencies
          );
          if (finalFencePassed !== true) settlementFenceLost = true;
        }
        const finalStatus = settlementFenceLost && termination.treeClosed
          ? 'fence-lost' as const
          : status;
        const outcome = Object.freeze({
          status: finalStatus,
          ...(trigger
            ? { trigger }
            : settlementFenceLost ? { trigger: 'fence-lost' as const } : {}),
          started: spawnObserved || runningChild.pid !== undefined,
          exitCode,
          signal: exitSignal,
          durationMs: Math.max(0, dependencies.monotonicNowMs() - startedAt),
          stdout: finalStreamEvidence(stdout),
          stderr: finalStreamEvidence(stderr),
          termination: Object.freeze(termination)
        });
        if (nativeDiagnostic !== undefined) {
          observedNativeLifecycleDiagnostics.set(outcome, nativeDiagnostic);
        }
        rootResource?.settle();
        resolve(outcome);
      })();
    };
    const waitForChildClose = (timeoutMs: number): Promise<boolean> => {
      if (childCloseObserved) return Promise.resolve(true);
      return new Promise((waitResolve) => {
        let complete = false;
        const finish = (closed: boolean): void => {
          if (complete) return;
          complete = true;
          dependencies.clearTimer(timer);
          closeWaiters.delete(finish);
          waitResolve(closed);
        };
        const timer = dependencies.setTimer(() => finish(false), timeoutMs);
        closeWaiters.add(finish);
      });
    };
    const requestTermination = async (reason: ObservedCommandTrigger): Promise<void> => {
      if (settled || trigger !== undefined) return;
      trigger = reason;
      nativeStdinController?.abort();
      if (runningChild.stdin != null && !runningChild.stdin.destroyed) {
        runningChild.stdin.destroy();
      }
      if (timeoutTimer !== undefined) dependencies.clearTimer(timeoutTimer);
      const deadlineAtMs = settlementDeadlineAtMs();
      // An error without an observed spawn/PID proves admission failure, not a
      // running tree. Still await native close and pipe settlement; missing
      // close evidence must remain termination-unproven.
      const failedBeforeSpawn = spawnFailureObserved && !spawnObserved && runningChild.pid === undefined;
      const termination = await raceWithDeadline(
        failedBeforeSpawn
          ? waitForChildClose(Math.max(0, deadlineAtMs - dependencies.monotonicNowMs())).then((closed) => ({
              gracefulAttempted: false,
              forcedAttempted: false,
              treeClosed: closed && !spawnObserved && runningChild.pid === undefined
            }))
          : Promise.resolve().then(() => dependencies.terminateProcessTree({
          child: runningChild,
          deadlineAtMs,
          graceMs: terminationGraceMs,
          isChildCloseObserved: () => childCloseObserved,
          waitForChildClose,
          runtime: processRuntime,
          nativeResourceLedger: options.nativeResourceLedger
        })),
        deadlineAtMs,
        dependencies
      );
      const stdinClosed = await raceWithDeadline(stdinSettlement, deadlineAtMs, dependencies);
      updateStreamsDrained();
      const evidence: ObservedCommandTerminationEvidence = {
        requested: !failedBeforeSpawn,
        gracefulAttempted: termination?.gracefulAttempted ?? false,
        forcedAttempted: termination?.forcedAttempted ?? false,
        childCloseObserved,
        streamsDrained,
        treeClosed: termination?.treeClosed === true
          && childCloseObserved
          && streamsDrained
          && stdinClosed !== null
      };
      settle(evidence.treeClosed
        ? settlementFenceLost ? 'fence-lost' : failedBeforeSpawn ? 'spawn-failed' : reason
        : 'termination-unproven', evidence);
    };
    const observeChunk = (
      streamName: 'stdout' | 'stderr',
      state: MutableStreamEvidence,
      chunk: string | Buffer | Uint8Array
    ): void => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      state.bytes += bytes.byteLength;
      state.digest.update(bytes);
      try {
        options.onChunk?.(streamName, bytes.byteLength);
      } catch {
        void requestTermination('observer-failed');
        return;
      }
      if (!options.onOutput) return;
      const remaining = Math.max(0, maxObservedOutputBytes - state.observerBytes);
      if (remaining === 0) {
        if (bytes.byteLength > 0) state.observerTruncated = true;
        return;
      }
      const observed = bytes.subarray(0, remaining);
      state.observerBytes += observed.byteLength;
      if (observed.byteLength < bytes.byteLength) state.observerTruncated = true;
      try {
        options.onOutput(streamName, observed);
      } catch {
        void requestTermination('observer-failed');
      }
    };
    const onAbort = (): void => {
      void requestTermination('aborted');
    };
    const scheduleFence = (): void => {
      if (!options.whileRunning || settled || settlementFenceLost) return;
      fenceTimer = dependencies.setTimer(() => {
        void Promise.resolve()
          .then(() => options.whileRunning!())
          .then(scheduleFence, () => {
            if (trigger === undefined) {
              return requestTermination('fence-lost');
            }
            settlementFenceLost = true;
          });
      }, fenceIntervalMs);
    };

    runningChild.stdout?.on('data', (chunk) => observeChunk('stdout', stdout, chunk));
    runningChild.stderr?.on('data', (chunk) => observeChunk('stderr', stderr, chunk));
    if (nativeStdinController === undefined) {
      runningChild.stdin?.once('error', () => {
        settleStandardStdin(false);
        void requestTermination('lifecycle-failed');
      });
      runningChild.stdin?.once('finish', () => settleStandardStdin(true));
      runningChild.stdin?.once('close', () => {
        if (!stdinFinished) settleStandardStdin(false);
      });
    }
    const markStdoutDrained = (): void => {
      outputDrained.stdout = true;
      updateStreamsDrained();
    };
    const markStderrDrained = (): void => {
      outputDrained.stderr = true;
      updateStreamsDrained();
    };
    runningChild.stdout?.once('end', markStdoutDrained);
    runningChild.stdout?.once('close', markStdoutDrained);
    runningChild.stderr?.once('end', markStderrDrained);
    runningChild.stderr?.once('close', markStderrDrained);
    runningChild.stdout?.once('error', () => {
      void requestTermination('lifecycle-failed');
    });
    runningChild.stderr?.once('error', () => {
      void requestTermination('lifecycle-failed');
    });
    runningChild.once('spawn', () => {
      spawnObserved = true;
      if (!settled) rootResource?.start();
    });
    runningChild.once('error', (error) => {
      if (trigger !== undefined) return;
      if (error instanceof ObservedNativeLifecycleFailure) {
        trigger = error.trigger;
        childCloseObserved = error.termination.childCloseObserved;
        streamsDrained = error.termination.streamsDrained;
        settle(error.status, error.termination, error.diagnostic);
        return;
      }
      spawnFailureObserved = !spawnObserved && runningChild.pid === undefined;
      void requestTermination('lifecycle-failed');
    });
    runningChild.once('close', (code, signal) => {
      childCloseObserved = true;
      // Native close can carry a negative spawn errno when no process ran.
      exitCode = spawnObserved ? code : null;
      exitSignal = spawnObserved ? signal : null;
      updateStreamsDrained();
      for (const waiter of [...closeWaiters]) waiter(true);
      if (trigger !== undefined || settled) return;
      const rootPid = runningChild.pid;
      const deadlineAtMs = settlementDeadlineAtMs();
      void raceWithDeadline(Promise.all([
        rootPid === undefined
          ? Promise.resolve(false)
          : Promise.resolve().then(() => dependencies.inspectProcessTreeClosed({
              child: runningChild,
              rootPid,
              deadlineAtMs,
              runtime: processRuntime
            })),
        stdinSettlement
      ]),
        deadlineAtMs,
        dependencies
      ).then((settlement) => {
        if (trigger !== undefined || settled) return;
        updateStreamsDrained();
        const [inspection, stdinClosed] = settlement ?? [null, false];
        const normalized = typeof inspection === 'boolean'
          ? { treeClosed: inspection, forcedAttempted: false }
          : inspection ?? { treeClosed: false, forcedAttempted: false };
        const proven = normalized.treeClosed
          && streamsDrained
          && stdinClosed
          && stdinFinished
          && !stdinFailed;
        if (!proven) {
          void requestTermination('lifecycle-failed');
          return;
        }
        settle(settlementFenceLost ? 'fence-lost' : 'exited', {
          requested: normalized.forcedAttempted,
          gracefulAttempted: false,
          forcedAttempted: normalized.forcedAttempted,
          childCloseObserved: true,
          streamsDrained,
          treeClosed: proven
        });
      });
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    if (trigger === undefined && nativeStdinController === undefined && runningChild.stdin != null) {
      runningChild.stdin.end(commandInput ?? undefined);
    } else if (commandInput !== null
        && runningChild.stdin == null
        && nativeStdinController === undefined) {
      void requestTermination('lifecycle-failed');
    }
    if (options.timeoutMs !== undefined) {
      const remainingMs = Math.max(
        0,
        (operationDeadlineAtMs ?? dependencies.monotonicNowMs()) - dependencies.monotonicNowMs()
      );
      timeoutTimer = dependencies.setTimer(() => {
        void requestTermination('timed-out');
      }, remainingMs);
    }
    scheduleFence();
  });
}
