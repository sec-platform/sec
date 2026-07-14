import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Pointer } from 'bun:ffi';
import {
  runObservedCommand,
  type ObservedCommandOutcome
} from './observed-process.ts';
import { runCommand } from './process.ts';
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease,
  type WorkspaceWriteLeaseHandle,
  type WorkspaceWriteLeaseToken
} from './workspace-write-lease.ts';

const PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x0002_0002;
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
const RECOVERY_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-owner-v1.json';
const RECOVERY_OWNER_PENDING_FILE_NAME = `${RECOVERY_OWNER_FILE_NAME}.pending-v1`;
const PROVISIONAL_OWNER_FORMAT_VERSION = 'windows-appcontainer-provisional-owner-v1';
const PROVISIONAL_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
const PROVISIONAL_OWNER_PENDING_FILE_NAME = `${PROVISIONAL_OWNER_FILE_NAME}.pending-v1`;
const PROBE_OWNER_FORMAT_VERSION = 'windows-appcontainer-probe-owner-v1';
const PROBE_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-probe-owner-v1.json';
const PROBE_OWNER_PENDING_FILE_NAME = `${PROBE_OWNER_FILE_NAME}.pending-v1`;
const NATIVE_RESULT_FILE_NAME = '.semantic-mutation-appcontainer-result-v1.json';
const NATIVE_HELPER_PATH = fileURLToPath(new URL('./windows-appcontainer-native-helper.ts', import.meta.url));
const WINDOWS_HOST_TOOL_DEADLINE_MS = 120_000;
const WINDOWS_HOST_TOOL_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const WINDOWS_APPCONTAINER_LEASE_MONITOR_INTERVAL_MS = 250;
const WINDOWS_APPCONTAINER_NATIVE_WAIT_SLICE_MS = 20;

type BunFfiToBuffer = (typeof import('bun:ffi'))['toBuffer'];
type NativeHelperBundleSource = () => Promise<Uint8Array>;
interface NativeHelperBundleLoader {
  readonly build: () => Promise<Uint8Array>;
}

async function defaultNativeHelperBundleSource(): Promise<Uint8Array> {
  const result = await Bun.build({
    entrypoints: [NATIVE_HELPER_PATH],
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    splitting: false,
    target: 'bun'
  });
  if (!result.success || result.outputs.length !== 1) throw executionError('preparation');
  return new Uint8Array(await result.outputs[0].arrayBuffer());
}

function createNativeHelperBundleLoader(source: NativeHelperBundleSource): NativeHelperBundleLoader {
  let cachedPromise: Promise<Uint8Array> | undefined;
  return Object.freeze({
    build: (): Promise<Uint8Array> => {
      if (cachedPromise) return cachedPromise;
      const pending = (async () => {
        const bytes = await source();
        const text = new TextDecoder().decode(bytes);
        if (bytes.byteLength === 0 || /(?:from|import\s*\()\s*["'][^"']+\.ts["']/u.test(text)) {
          throw executionError('preparation');
        }
        return bytes;
      })();
      let cached: Promise<Uint8Array>;
      cached = pending.catch((error: unknown) => {
        if (cachedPromise === cached) cachedPromise = undefined;
        throw error;
      });
      cachedPromise = cached;
      return cached;
    }
  });
}

const nativeHelperBundleLoader = createNativeHelperBundleLoader(defaultNativeHelperBundleSource);

function buildNativeHelperBundle(): Promise<Uint8Array> {
  return nativeHelperBundleLoader.build();
}

/** Test-only isolated cache factory; never re-exported from a product facade. */
export function createWindowsAppContainerNativeHelperBundleLoaderForTests(
  source: NativeHelperBundleSource
): NativeHelperBundleLoader {
  return createNativeHelperBundleLoader(source);
}

const WINDOWS_APPCONTAINER_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'BUN_INSTALL_CACHE_DIR',
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
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
const CAPABILITY_PARENT_CANARY_NAME = '.appcontainer-host-read-canary-v1';
const CAPABILITY_OUTER_CANARY_NAME = '.appcontainer-outer-host-read-canary-v1';
const CAPABILITY_CANARY_CONTENT = 'windows-appcontainer-host-read-canary-v1\n';

const CAPABILITY_LEASE_LOSS_RUNNER = String.raw`
import path from 'node:path';

const bunConfigPath = path.join(path.dirname(process.execPath), 'bunfig.toml');
const descendant = Bun.spawn([
  process.execPath,
  '--no-env-file',
  '--config=' + bunConfigPath,
  '--no-install',
  '-e',
  'setInterval(() => {}, 1000)'
], {
  cwd: process.cwd(),
  env: process.env,
  stdin: 'ignore',
  stdout: 'ignore',
  stderr: 'ignore'
});
await Bun.write('lease-loss-marker.json', JSON.stringify({
  processId: process.pid,
  descendantProcessId: descendant.pid
}));
await new Promise(() => {});
`;

const CAPABILITY_SPAWNED_RUNNER = String.raw`
import net from 'node:net';
import path from 'node:path';

async function rawConnect(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 800);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

const result = {
  insideWrite: false,
  outsideWrite: false,
  parentRead: false,
  outerRead: false,
  fetchConnect: false,
  rawConnect: false
};
try { await Bun.write(path.resolve(process.cwd(), 'spawned-inside.txt'), 'inside'); result.insideWrite = true; } catch {}
try { await Bun.write(path.resolve(process.cwd(), '..', 'spawned-outside.txt'), 'outside'); result.outsideWrite = true; } catch {}
try { await Bun.file(path.resolve(process.cwd(), '..', '.appcontainer-host-read-canary-v1')).text(); result.parentRead = true; } catch {}
try { await Bun.file(path.resolve(process.cwd(), '..', '..', '.appcontainer-outer-host-read-canary-v1')).text(); result.outerRead = true; } catch {}
try {
  const response = await fetch('http://127.0.0.1:' + process.env.SEC_APPCONTAINER_PROBE_HTTP_PORT + '/probe', {
    signal: AbortSignal.timeout(800)
  });
  result.fetchConnect = response.ok;
} catch {}
try { result.rawConnect = await rawConnect(Number(process.env.SEC_APPCONTAINER_PROBE_RAW_PORT)); } catch {}
await Bun.write(path.resolve(process.cwd(), 'spawned-result.json'), JSON.stringify(result));
process.exit(result.insideWrite && !result.outsideWrite && !result.parentRead && !result.outerRead &&
  !result.fetchConnect && !result.rawConnect ? 0 : 43);
`;

const CAPABILITY_VECTOR_RUNNER = String.raw`
import net from 'node:net';
import path from 'node:path';

async function rawConnect(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 800);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

const direct = {
  insideWrite: false,
  outsideWrite: false,
  parentRead: false,
  outerRead: false,
  fetchConnect: false,
  rawConnect: false
};
try { await Bun.write(path.resolve(process.cwd(), 'direct-inside.txt'), 'inside'); direct.insideWrite = true; } catch {}
try { await Bun.write(path.resolve(process.cwd(), '..', 'direct-outside.txt'), 'outside'); direct.outsideWrite = true; } catch {}
try { await Bun.file(path.resolve(process.cwd(), '..', '.appcontainer-host-read-canary-v1')).text(); direct.parentRead = true; } catch {}
try { await Bun.file(path.resolve(process.cwd(), '..', '..', '.appcontainer-outer-host-read-canary-v1')).text(); direct.outerRead = true; } catch {}
try {
  const response = await fetch('http://127.0.0.1:' + process.env.SEC_APPCONTAINER_PROBE_HTTP_PORT + '/probe', {
    signal: AbortSignal.timeout(800)
  });
  direct.fetchConnect = response.ok;
} catch {}
try { direct.rawConnect = await rawConnect(Number(process.env.SEC_APPCONTAINER_PROBE_RAW_PORT)); } catch {}

const bunConfigPath = path.join(path.dirname(process.execPath), 'bunfig.toml');
const spawned = Bun.spawn([
  process.execPath,
  '--no-env-file',
  '--config=' + bunConfigPath,
  '--no-install',
  '-e',
  ${JSON.stringify(CAPABILITY_SPAWNED_RUNNER)}
], {
  cwd: process.cwd(),
  env: process.env,
  stdin: 'ignore',
  stdout: 'ignore',
  stderr: 'ignore'
});
const spawnedExitCode = await spawned.exited;
let spawnedResult = null;
try { spawnedResult = JSON.parse(await Bun.file(path.resolve(process.cwd(), 'spawned-result.json')).text()); } catch {}
const report = { direct, spawnedExitCode, spawned: spawnedResult };
await Bun.write(path.resolve(process.cwd(), 'capability-result.json'), JSON.stringify(report));
const ok = direct.insideWrite && !direct.outsideWrite && !direct.parentRead && !direct.outerRead &&
  !direct.fetchConnect && !direct.rawConnect && spawnedExitCode === 0 &&
  spawnedResult?.insideWrite && !spawnedResult?.outsideWrite && !spawnedResult?.parentRead &&
  !spawnedResult?.outerRead && !spawnedResult?.fetchConnect && !spawnedResult?.rawConnect;
process.exit(ok ? 0 : 44);
`;

/**
 * Frozen x64/arm64 Windows ABI facts used by the FFI boundary. Keeping these
 * values visible to a narrow contract test makes pointer/offset drift fail
 * before CreateProcessW can observe a malformed native structure.
 */
export const WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1 = Object.freeze({
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
  procThreadAttributeSecurityCapabilities: PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
  procThreadAttributeCount: 2,
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

export const WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1 = Object.freeze({
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

export type WindowsAppContainerProbeCapability =
  | Readonly<{ status: 'available' }>
  | Readonly<{ status: 'unavailable' }>;

export type WindowsAppContainerExecutionPhase =
  | 'invalid-input'
  | 'preparation'
  | 'acl'
  | 'launch'
  | 'wait'
  | 'timeout'
  | 'cleanup';

export type WindowsAppContainerHostToolStage =
  | 'acl-grant'
  | 'acl-remove'
  | 'acl-verify-absent'
  | 'profile-query';

export type WindowsAppContainerHostToolFailureReason =
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

export type WindowsAppContainerNativeHelperMode = 'derive' | 'create-profile' | 'execute';

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

function isWindowsDword(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_WINDOWS_DWORD;
}

export type WindowsAppContainerNativeHelperProtocolClass =
  | 'ok'
  | 'declared-failure'
  | 'invalid';

export type WindowsAppContainerNativeReceiptClass =
  | 'not-applicable'
  | 'absent'
  | 'exit-code'
  | 'declared-failure'
  | 'invalid'
  | 'read-error';

export type WindowsAppContainerNativeHelperObservation = Readonly<{
  readonly mode: WindowsAppContainerNativeHelperMode;
  readonly helperExit: number;
  readonly diagnosticStream: 'empty' | 'present';
  readonly protocol: WindowsAppContainerNativeHelperProtocolClass;
  readonly nativeReceipt: WindowsAppContainerNativeReceiptClass;
}>;

export type WindowsAppContainerProbeStage =
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

export type WindowsAppContainerProbeInvariant =
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
  | 'no-resource-residue'
  | 'isolation-report-valid'
  | 'canary-intact'
  | 'lease-release'
  | 'server-close'
  | 'outer-canary-remove'
  | 'probe-root-remove'
  | 'probe-clean';

export interface WindowsAppContainerProbeFault {
  readonly stage: WindowsAppContainerProbeStage;
  readonly invariant: WindowsAppContainerProbeInvariant;
  readonly executionPhase?: WindowsAppContainerExecutionPhase;
  readonly hostToolFailure?: WindowsAppContainerHostToolFailure;
  readonly nativeCode?: number;
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

  constructor(
    public readonly phase: WindowsAppContainerExecutionPhase,
    public readonly nativeCode?: number,
    public readonly hostToolFailure?: WindowsAppContainerHostToolFailure
  ) {
    super(`Windows AppContainer isolated execution failed during ${phase}`);
    this.name = 'WindowsAppContainerExecutionError';
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
  /** Live workspace whose exact writer lease fences every host-side effect. */
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  readonly timeoutMs?: number;
}

export interface WindowsAppContainerExecutionResult {
  readonly exitCode: number;
}

export interface WindowsAppContainerCapabilityProbeRequest {
  readonly stagingRoot: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  readonly timeoutMs?: number;
}

export interface WindowsAppContainerRecoveryOwnerV1 {
  readonly formatVersion: typeof RECOVERY_OWNER_FORMAT_VERSION;
  readonly workspaceIdentityDigest: string;
  readonly stagingIdentityDigest: string;
  readonly stagingDirectoryName: string;
  readonly runtimeRelativePath: typeof RUNTIME_DIRECTORY_NAME;
  readonly resultFileName: typeof NATIVE_RESULT_FILE_NAME;
  readonly appContainerName: string;
  readonly appContainerSid: string;
}

interface WindowsAppContainerProvisionalOwnerV1 {
  readonly formatVersion: typeof PROVISIONAL_OWNER_FORMAT_VERSION;
  readonly workspaceIdentityDigest: string;
  readonly stagingIdentityDigest: string;
  readonly stagingDirectoryName: string;
  readonly hostBunConfigRelativePath: typeof HOST_BUN_CONFIG_RELATIVE_ROOT;
  readonly appContainerName: string;
}

interface WindowsAppContainerProbeOwnerV1 {
  readonly formatVersion: typeof PROBE_OWNER_FORMAT_VERSION;
  readonly outerWorkspaceIdentityDigest: string;
  readonly probeWorkspaceIdentityDigest: string;
  readonly outerStagingIdentityDigest: string;
  readonly probeStagingDirectoryName: 's';
  readonly parentCanaryName: typeof CAPABILITY_PARENT_CANARY_NAME;
  readonly outerCanaryName: typeof CAPABILITY_OUTER_CANARY_NAME;
}

export interface WindowsAppContainerNativeExecutionRequest {
  readonly execution: WindowsAppContainerExecutionRequest;
  readonly nativeResultPath: string;
  readonly owner: WindowsAppContainerRecoveryOwnerV1;
}

export interface WindowsAppContainerNativeCleanupRequest {
  readonly stagingRoot: string;
  readonly nativeResultPath: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  readonly owner: WindowsAppContainerRecoveryOwnerV1;
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
    (error.nativeCode !== undefined && !isWindowsDword(error.nativeCode))) {
    return encodeWindowsAppContainerNativeHelperWireValue({
      status: 'failed',
      phase: 'preparation'
    });
  }
  return encodeWindowsAppContainerNativeHelperWireValue({
    status: 'failed',
    phase: error.phase,
    ...(error.nativeCode === undefined ? {} : { nativeCode: error.nativeCode })
  });
}

export function encodeWindowsAppContainerNativeOk(): WindowsAppContainerNativeHelperWirePayload {
  return encodeWindowsAppContainerNativeHelperWireValue({ status: 'ok' });
}

export function encodeWindowsAppContainerNativeDerivedSid(
  appContainerSid: string
): WindowsAppContainerNativeHelperWirePayload {
  if (!WINDOWS_APPCONTAINER_SID_PATTERN.test(appContainerSid)) {
    throw executionError('preparation');
  }
  return encodeWindowsAppContainerNativeHelperWireValue({ status: 'ok', appContainerSid });
}

const executionCleanupFailures = new WeakMap<Error, readonly Error[]>();
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
  hostToolFailure?: WindowsAppContainerHostToolFailure
): WindowsAppContainerExecutionError {
  return new WindowsAppContainerExecutionError(phase, nativeCode, hostToolFailure);
}

function normalizeExecutionError(
  error: unknown,
  fallback: WindowsAppContainerExecutionPhase
): WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError {
  if (error instanceof WindowsAppContainerCapabilityUnavailableError ||
    error instanceof WindowsAppContainerExecutionError) {
    return error;
  }
  return executionError(fallback);
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
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function validateExecutionRequest(
  request: WindowsAppContainerExecutionRequest
): Promise<ValidatedExecutionBoundary> {
  if (!request || typeof request !== 'object' || typeof request.stagingRoot !== 'string' ||
    typeof request.runnerRelativePath !== 'string' ||
    !request.environment || typeof request.environment !== 'object' ||
    Array.isArray(request.environment) || typeof request.workspaceRoot !== 'string' ||
    !request.workspaceWriteLease || typeof request.workspaceWriteLease !== 'object') {
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
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  if (foldedWindowsPath(canonicalWorkspaceRoot) !== foldedWindowsPath(workspaceRoot) ||
    !isInside(canonicalWorkspaceRoot, transactionRoot)) {
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
    'PLAYWRIGHT_BROWSERS_PATH',
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
    ['PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', '1'],
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
  return entries.sort(([left], [right]) => {
    const foldedLeft = left.toLocaleUpperCase('en-US');
    const foldedRight = right.toLocaleUpperCase('en-US');
    return foldedLeft.localeCompare(foldedRight, 'en-US') || left.localeCompare(right, 'en-US');
  });
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
    throw executionError('preparation');
  }
  const executablePath = path.join(runtimeRoot, RUNTIME_EXECUTABLE_NAME);
  await commitFence();
  await copyFile(sourceExecutable, executablePath);
  const copiedMetadata = await lstat(executablePath);
  if (!copiedMetadata.isFile() || copiedMetadata.isSymbolicLink() || Number(copiedMetadata.nlink) !== 1 ||
    (String(sourceMetadata.dev) === String(copiedMetadata.dev) &&
      String(sourceMetadata.ino) === String(copiedMetadata.ino))) {
    throw executionError('preparation');
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
  if (bytes.byteLength < 8) throw executionError('preparation');
  const revision = bytes.readUInt8(0);
  const subAuthorityCount = bytes.readUInt8(1);
  if (bytes.byteLength !== 8 + subAuthorityCount * 4) throw executionError('preparation');
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
    AssignProcessToJobObject: {
      args: [FFIType.u64, FFIType.u64],
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
  if (advapi32.symbols.IsValidSid(sidPointer) === 0) throw executionError('preparation');
  const sidLength = advapi32.symbols.GetLengthSid(sidPointer);
  if (sidLength < 8 || sidLength > MAXIMUM_SID_BYTES) throw executionError('preparation');
  const sid = sidBytesToString(Buffer.from(toBuffer(sidPointer, 0, sidLength)));
  if (!/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(sid)) throw executionError('preparation');
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
    const sidHolder = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes);
    const result = userenv.symbols.DeriveAppContainerSidFromAppContainerName(
      windowsWide(appContainerName),
      sidHolder
    );
    if (result < 0) throw executionError('preparation', result);
    const sidPointer = read.ptr(ptr(sidHolder)) as Pointer;
    if (!sidPointer) throw executionError('preparation');
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
    const sidHolder = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes);
    await commitFence();
    const result = userenv.symbols.CreateAppContainerProfile(
      windowsWide(appContainerName),
      windowsWide('SEC Semantic Mutation isolated verifier'),
      windowsWide('Ephemeral profile for one isolated Verification child'),
      null,
      0,
      sidHolder
    );
    if (result < 0) throw executionError('preparation', result);
    const sidPointer = read.ptr(ptr(sidHolder)) as Pointer;
    if (!sidPointer || sidPointerToString(sidPointer, advapi32, toBuffer) !== expectedSid) {
      throw executionError('preparation');
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
    if (length === 0 || length >= capacity) throw executionError('preparation');
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
    primaryError.hostToolFailure?.termination === 'unconfirmed';
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
    throw executionError('preparation');
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
    throw executionError('preparation');
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
    throw executionError('preparation');
  }

  const configRoot = path.join(stagingRoot, HOST_BUN_CONFIG_RELATIVE_ROOT);
  if (await pathExists(configRoot)) {
    const [metadata, canonicalRoot] = await Promise.all([
      lstat(configRoot),
      realpath(configRoot)
    ]);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      foldedWindowsPath(canonicalRoot) !== foldedWindowsPath(configRoot)) {
      throw executionError('preparation');
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
    throw executionError('preparation');
  }

  const configPath = path.join(configRoot, RUNTIME_CONFIG_NAME);
  await durableCreateFile(configPath, ISOLATED_BUN_CONFIG_CONTENT, commitFence);
  const helperBundle = await buildNativeHelperBundle();
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
    throw executionError('preparation');
  }
  const [helperMetadata, canonicalHelperPath, materializedHelper] = await Promise.all([
    lstat(helperPath),
    realpath(helperPath),
    readFile(helperPath)
  ]);
  if (!helperMetadata.isFile() || helperMetadata.isSymbolicLink() || Number(helperMetadata.nlink) !== 1 ||
    foldedWindowsPath(canonicalHelperPath) !== foldedWindowsPath(helperPath) ||
    createHash('sha256').update(materializedHelper).digest('hex') !==
      createHash('sha256').update(helperBundle).digest('hex')) {
    throw executionError('preparation');
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

async function runHostBunCommand(
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined,
  encodedRequest: string
) {
  const { configPath, helperPath } = await materializeHostBunRuntime(stagingRoot, commitFence);
  let result: Awaited<ReturnType<typeof runCommand>> | undefined;
  let primaryError: WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError | undefined;
  const controller = new AbortController();
  let monitorStopped = false;
  let monitorError: unknown;
  const monitor = (async (): Promise<void> => {
    while (!monitorStopped) {
      await new Promise((resolve) => setTimeout(resolve, WINDOWS_APPCONTAINER_LEASE_MONITOR_INTERVAL_MS));
      if (monitorStopped) return;
      try {
        await commitFence();
      } catch (error) {
        monitorError = error;
        controller.abort();
        return;
      }
    }
  })();
  try {
    try {
      result = await runCommand(process.execPath, [
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
        timeoutMs,
        signal: controller.signal
      });
    } finally {
      monitorStopped = true;
      await monitor;
    }
    if (monitorError) throw monitorError;
    await commitFence();
  } catch (error) {
    primaryError = normalizeExecutionError(monitorError ?? error, 'preparation');
  }
  let cleanupError: WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError | undefined;
  try {
    await cleanupHostBunConfig(stagingRoot, commitFence);
  } catch (error) {
    cleanupError = normalizeExecutionError(error, 'cleanup');
  }
  if (primaryError) {
    if (cleanupError) rememberExecutionCleanupFailure(primaryError, cleanupError);
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
  if (!result) throw executionError('preparation');
  return result;
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
  appContainerSidPointer: Pointer,
  prepared: PreparedExecution,
  timeoutMs: number | undefined,
  commitFence: () => Promise<void>,
  nativeResultPath: string
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
  let processCompleted = false;

  try {
    const { ptr } = await import('bun:ffi');
    kernel32 = await openWindowsAppContainerKernel32();

    const securityCapabilities = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityCapabilitiesBytes
    );
    securityCapabilities.writeBigUInt64LE(
      BigInt(appContainerSidPointer),
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityCapabilitiesAppContainerSidOffset
    );
    securityCapabilities.writeBigUInt64LE(
      0n,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityCapabilitiesCapabilitiesOffset
    );
    securityCapabilities.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.capabilityCount,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityCapabilitiesCapabilityCountOffset
    );
    securityCapabilities.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.reserved,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityCapabilitiesReservedOffset
    );
    attributePayloads.push(securityCapabilities);
    const inheritableHandleSecurityAttributes = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityAttributesBytes
    );
    inheritableHandleSecurityAttributes.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityAttributesBytes,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityAttributesLengthOffset
    );
    inheritableHandleSecurityAttributes.writeBigUInt64LE(
      0n,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityAttributesDescriptorOffset
    );
    inheritableHandleSecurityAttributes.writeUInt32LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.inheritHandles,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.securityAttributesInheritHandleOffset
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
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes *
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.standardHandleCount
    );
    standardHandleList.writeBigUInt64LE(standardInputHandle, 0);
    standardHandleList.writeBigUInt64LE(
      standardOutputHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes
    );
    standardHandleList.writeBigUInt64LE(
      standardErrorHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes * 2
    );
    attributePayloads.push(standardHandleList);
    const attributeListSize = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes);
    kernel32.symbols.InitializeProcThreadAttributeList(
      null,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.procThreadAttributeCount,
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
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.procThreadAttributeCount,
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
    const startupInfoEx = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExBytes);
    startupInfoEx.writeUInt32LE(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExBytes, 0);
    startupInfoEx.writeUInt32LE(
      STARTF_USESTDHANDLES,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExFlagsOffset
    );
    startupInfoEx.writeBigUInt64LE(
      standardInputHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExStdInputOffset
    );
    startupInfoEx.writeBigUInt64LE(
      standardOutputHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExStdOutputOffset
    );
    startupInfoEx.writeBigUInt64LE(
      standardErrorHandle,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExStdErrorOffset
    );
    startupInfoEx.writeBigUInt64LE(
      BigInt(ptr(attributeList)),
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExAttributeListOffset
    );

    const jobInformation = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.jobObjectExtendedLimitInformationBytes
    );
    jobInformation.writeUInt32LE(
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.jobObjectLimitFlagsOffset
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

    const processInformation = Buffer.alloc(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.processInformationBytes
    );
    await commitFence();
    if (kernel32.symbols.CreateProcessW(
      prepared.executablePath,
      prepared.commandLine,
      null,
      null,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.inheritHandles,
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.creationFlags,
      prepared.environmentBlock,
      prepared.currentDirectory,
      startupInfoEx,
      processInformation
    ) === 0) throw executionError('launch', kernel32.symbols.GetLastError());
    processHandle = processInformation.readBigUInt64LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.processInformationProcessHandleOffset
    );
    threadHandle = processInformation.readBigUInt64LE(
      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.processInformationThreadHandleOffset
    );
    if (processHandle === 0n || threadHandle === 0n ||
      kernel32.symbols.AssignProcessToJobObject(jobHandle, processHandle) === 0) {
      throw executionError('launch');
    }
    await commitFence();
    if (kernel32.symbols.ResumeThread(threadHandle) === MAXIMUM_RESUME_THREAD_RESULT) {
      throw executionError('launch');
    }
    kernel32.symbols.CloseHandle(threadHandle);
    threadHandle = 0n;

    const startedAt = Date.now();
    while (true) {
      const waitResult = kernel32.symbols.WaitForSingleObject(
        processHandle,
        WINDOWS_APPCONTAINER_NATIVE_WAIT_SLICE_MS
      );
      if (waitResult === WAIT_OBJECT_0) break;
      if (waitResult === WAIT_FAILED || waitResult !== WAIT_TIMEOUT) {
        throw executionError('wait');
      }
      if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) {
        kernel32.symbols.TerminateProcess(processHandle, TERMINATED_EXIT_CODE);
        throw executionError('timeout');
      }
    }

    const exitCodeBuffer = Buffer.alloc(4);
    if (kernel32.symbols.GetExitCodeProcess(processHandle, exitCodeBuffer) === 0) {
      throw executionError('wait');
    }
    processCompleted = true;
    const exitCode = exitCodeBuffer.readUInt32LE(0);
    writeFileSync(nativeResultPath, `${JSON.stringify({ exitCode })}\n`, { flag: 'wx' });
    return exitCode;
  } catch (error) {
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw new WindowsAppContainerCapabilityUnavailableError();
  } finally {
    if (kernel32) {
      if (processHandle !== 0n && !processCompleted) {
        kernel32.symbols.TerminateProcess(processHandle, TERMINATED_EXIT_CODE);
      }
      if (jobHandle !== 0n) {
        kernel32.symbols.CloseHandle(jobHandle);
      }
      if (processHandle !== 0n && !processCompleted) {
        kernel32.symbols.WaitForSingleObject(processHandle, 1000);
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
    // Bun 1.3.6 can crash while releasing this SID after an AppContainer child exits.
    // The native helper boundary is process-scoped, so Windows reclaims it at helper exit.
    void appContainerSidPointer;
  }
}

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function recoveryOwnerLooksValid(value: unknown): value is WindowsAppContainerRecoveryOwnerV1 {
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
    owner.resultFileName === NATIVE_RESULT_FILE_NAME &&
    typeof owner.workspaceIdentityDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(owner.workspaceIdentityDigest) &&
    typeof owner.stagingIdentityDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(owner.stagingIdentityDigest) &&
    typeof owner.stagingDirectoryName === 'string' && owner.stagingDirectoryName.length > 0 &&
    path.basename(owner.stagingDirectoryName) === owner.stagingDirectoryName &&
    typeof owner.appContainerName === 'string' && /^sec\.sm3\.[0-9a-f]{12}\.[0-9a-f]{24}$/u.test(owner.appContainerName) &&
    typeof owner.appContainerSid === 'string' && /^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(owner.appContainerSid);
}

function provisionalOwnerLooksValid(value: unknown): value is WindowsAppContainerProvisionalOwnerV1 {
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

function probeOwnerLooksValid(value: unknown): value is WindowsAppContainerProbeOwnerV1 {
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
  return owner.formatVersion === PROBE_OWNER_FORMAT_VERSION &&
    owner.outerCanaryName === CAPABILITY_OUTER_CANARY_NAME &&
    owner.parentCanaryName === CAPABILITY_PARENT_CANARY_NAME &&
    owner.probeStagingDirectoryName === 's' &&
    typeof owner.outerWorkspaceIdentityDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(owner.outerWorkspaceIdentityDigest) &&
    typeof owner.probeWorkspaceIdentityDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(owner.probeWorkspaceIdentityDigest) &&
    typeof owner.outerStagingIdentityDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/u.test(owner.outerStagingIdentityDigest);
}

async function validateRecoveryStagingBoundary(
  stagingRootInput: string,
  workspaceRootInput: string
): Promise<Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>> {
  if (typeof stagingRootInput !== 'string' || typeof workspaceRootInput !== 'string') {
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
  const [transactionMetadata, canonicalTransactionRoot, canonicalWorkspaceRoot] = await Promise.all([
    lstat(transactionRoot),
    realpath(transactionRoot),
    realpath(path.resolve(workspaceRootInput))
  ]);
  if (!transactionMetadata.isDirectory() || transactionMetadata.isSymbolicLink() ||
    foldedWindowsPath(canonicalTransactionRoot) !== foldedWindowsPath(transactionRoot) ||
    !isInside(canonicalWorkspaceRoot, transactionRoot)) {
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

function recoveryOwnerPath(transactionRoot: string): string {
  return path.join(transactionRoot, RECOVERY_OWNER_FILE_NAME);
}

function recoveryOwnerPendingPath(transactionRoot: string): string {
  return path.join(transactionRoot, RECOVERY_OWNER_PENDING_FILE_NAME);
}

function provisionalOwnerPath(transactionRoot: string): string {
  return path.join(transactionRoot, PROVISIONAL_OWNER_FILE_NAME);
}

function provisionalOwnerPendingPath(transactionRoot: string): string {
  return path.join(transactionRoot, PROVISIONAL_OWNER_PENDING_FILE_NAME);
}

function probeOwnerPath(probeRoot: string): string {
  return path.join(probeRoot, PROBE_OWNER_FILE_NAME);
}

function probeOwnerPendingPath(probeRoot: string): string {
  return path.join(probeRoot, PROBE_OWNER_PENDING_FILE_NAME);
}

function nativeResultPath(transactionRoot: string): string {
  return path.join(transactionRoot, NATIVE_RESULT_FILE_NAME);
}

async function assertRecoveryOwner(
  owner: WindowsAppContainerRecoveryOwnerV1,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  workspaceWriteLease: WorkspaceWriteLeaseToken,
  requestedNativeResultPath: string
): Promise<void> {
  if (!recoveryOwnerLooksValid(owner) ||
    owner.workspaceIdentityDigest !== workspaceWriteLease.workspaceIdentityDigest ||
    owner.stagingIdentityDigest !== boundary.stagingIdentityDigest ||
    owner.stagingDirectoryName !== path.basename(boundary.stagingRoot) ||
    owner.appContainerName !== buildAppContainerName(boundary.stagingRoot, boundary.stagingIdentityDigest) ||
    foldedWindowsPath(requestedNativeResultPath) !== foldedWindowsPath(nativeResultPath(boundary.transactionRoot))) {
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
  owner: WindowsAppContainerProvisionalOwnerV1,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  workspaceWriteLease: WorkspaceWriteLeaseToken
): void {
  if (!provisionalOwnerLooksValid(owner) ||
    owner.workspaceIdentityDigest !== workspaceWriteLease.workspaceIdentityDigest ||
    owner.stagingIdentityDigest !== boundary.stagingIdentityDigest ||
    owner.stagingDirectoryName !== path.basename(boundary.stagingRoot) ||
    owner.appContainerName !== buildAppContainerName(boundary.stagingRoot, boundary.stagingIdentityDigest)) {
    throw executionError('cleanup');
  }
}

function assertProbeOwner(
  owner: WindowsAppContainerProbeOwnerV1,
  outerBoundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  outerWorkspaceWriteLease: WorkspaceWriteLeaseToken,
  probeWorkspaceWriteLease: WorkspaceWriteLeaseToken
): void {
  if (!probeOwnerLooksValid(owner) ||
    owner.outerWorkspaceIdentityDigest !== outerWorkspaceWriteLease.workspaceIdentityDigest ||
    owner.probeWorkspaceIdentityDigest !== probeWorkspaceWriteLease.workspaceIdentityDigest ||
    owner.outerStagingIdentityDigest !== outerBoundary.stagingIdentityDigest) {
    throw executionError('cleanup');
  }
}

async function readRecoveryOwner(ownerPath: string): Promise<WindowsAppContainerRecoveryOwnerV1 | undefined> {
  return readOwnerRecord(ownerPath, recoveryOwnerLooksValid);
}

async function readProvisionalOwner(ownerPath: string): Promise<WindowsAppContainerProvisionalOwnerV1 | undefined> {
  return readOwnerRecord(ownerPath, provisionalOwnerLooksValid);
}

async function readProbeOwner(ownerPath: string): Promise<WindowsAppContainerProbeOwnerV1 | undefined> {
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
  const expectedKeys = ['phase', 'status', ...(record.nativeCode === undefined ? [] : ['nativeCode'])].sort();
  if (!exactObjectKeys(record, expectedKeys) ||
    !WINDOWS_APPCONTAINER_EXECUTION_PHASES.has(record.phase as WindowsAppContainerExecutionPhase) ||
    (record.nativeCode !== undefined && !isWindowsDword(record.nativeCode))) {
    return undefined;
  }
  return Object.freeze({
    phase: record.phase as WindowsAppContainerExecutionPhase,
    nativeCode: record.nativeCode === undefined ? null : Number(record.nativeCode)
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
    helperExit: exitCode,
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
      throw executionError('preparation');
    }
    if (protocol.classification === 'declared-failure') {
      throw executionError(
        protocol.failure.phase,
        protocol.failure.nativeCode ?? undefined
      );
    }
    if (mode === 'execute') {
      if (nativeReceipt.classification === 'declared-failure') {
        throw executionError(
          nativeReceipt.failure.phase,
          nativeReceipt.failure.nativeCode ?? undefined
        );
      }
      if (nativeReceipt.classification !== 'exit-code') throw executionError('wait');
      return nativeReceipt.result;
    }
    if (nativeReceipt.classification !== 'not-applicable') throw executionError('preparation');
    if (mode === 'derive') {
      if (!protocol.appContainerSid) throw executionError('preparation');
      return protocol.appContainerSid;
    }
    return undefined;
  } catch (error) {
    if (error instanceof Error) nativeHelperObservations.set(error, observation);
    throw error;
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
  mode: 'execute',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<WindowsAppContainerExecutionResult>;
async function invokeNativeHelper(
  mode: 'create-profile' | 'execute',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<void | WindowsAppContainerExecutionResult> {
  const serialized = Buffer.from(JSON.stringify({ mode, request: helperRequest }), 'utf8').toString('base64url');
  const result = await runHostBunCommand(
    stagingRoot,
    environment,
    commitFence,
    timeoutMs,
    serialized
  );
  const nativeReceipt = mode === 'execute'
    ? await readNativeReceipt(helperRequest.nativeResultPath, commitFence)
    : Object.freeze({ classification: 'not-applicable' as const });
  if (mode === 'execute') {
    return settleNativeHelperInvocation(
      'execute',
      result.code,
      result.stdout,
      result.stderr !== '',
      nativeReceipt
    );
  }
  settleNativeHelperInvocation(
    'create-profile',
    result.code,
    result.stdout,
    result.stderr !== '',
    nativeReceipt
  );
}

export type WindowsAppContainerNativeReceiptReadForTests =
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
  const serialized = Buffer.from(JSON.stringify({
    mode: 'derive',
    request: { appContainerName }
  }), 'utf8').toString('base64url');
  const result = await runHostBunCommand(
    stagingRoot,
    environment,
    commitFence,
    10_000,
    serialized
  );
  return settleNativeHelperInvocation(
    'derive',
    result.code,
    result.stdout,
    result.stderr !== '',
    Object.freeze({ classification: 'not-applicable' })
  );
}

/** Native-helper-only profile creation. The durable outer owner is the recovery authority. */
export async function createWindowsAppContainerProfileForNativeHelper(
  request: WindowsAppContainerNativeExecutionRequest
): Promise<void> {
  assertCapability();
  const execution = request.execution;
  const commitFence = () => assertWorkspaceWriteLease(
    execution.workspaceRoot,
    execution.workspaceWriteLease
  );
  await commitFence();
  const validated = await validateExecutionRequest(execution);
  validateAndSortEnvironment(execution.environment, validated.stagingRoot);
  await assertRecoveryOwner(
    request.owner,
    validated,
    execution.workspaceWriteLease,
    request.nativeResultPath
  );
  await createAppContainerProfile(
    request.owner.appContainerName,
    request.owner.appContainerSid,
    commitFence
  );
}

/** Native-helper-only launch. No profile, ACL, runtime, or owner cleanup occurs here. */
export async function runWindowsAppContainerNativeChild(
  request: WindowsAppContainerNativeExecutionRequest
): Promise<WindowsAppContainerExecutionResult> {
  assertCapability();
  const execution = request.execution;
  const commitFence = () => assertWorkspaceWriteLease(
    execution.workspaceRoot,
    execution.workspaceWriteLease
  );
  await commitFence();
  const validated = await validateExecutionRequest(execution);
  validateAndSortEnvironment(execution.environment, validated.stagingRoot);
  await assertRecoveryOwner(
    request.owner,
    validated,
    execution.workspaceWriteLease,
    request.nativeResultPath
  );
  const prepared = prepareMaterializedExecution(
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
    throw executionError('preparation');
  }
  const derivedSid = await deriveAppContainerSidPointer(request.owner.appContainerName);
  if (derivedSid.sid !== request.owner.appContainerSid) throw executionError('preparation');
  const exitCode = await executeNativeAppContainer(
    derivedSid.sidPointer,
    prepared,
    execution.timeoutMs,
    commitFence,
    request.nativeResultPath
  );
  return Object.freeze({ exitCode });
}

/** Native cleanup helper. Every planned resource is removed unconditionally. */
async function cleanupWindowsAppContainerNativeOwner(
  request: WindowsAppContainerNativeCleanupRequest,
  provenAppContainerSid: string,
  signal?: AbortSignal
): Promise<void> {
  assertCapability();
  signal?.throwIfAborted();
  const commitFence = () => assertWorkspaceWriteLease(
    request.workspaceRoot,
    request.workspaceWriteLease
  );
  await commitFence();
  const boundary = await validateRecoveryStagingBoundary(request.stagingRoot, request.workspaceRoot);
  await assertRecoveryOwner(
    request.owner,
    boundary,
    request.workspaceWriteLease,
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
  owner: WindowsAppContainerRecoveryOwnerV1,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  commitFence: () => Promise<void>
): Promise<void> {
  const resultPath = nativeResultPath(boundary.transactionRoot);
  const cleanupRequest: WindowsAppContainerNativeCleanupRequest = {
    stagingRoot: boundary.stagingRoot,
    nativeResultPath: resultPath,
    workspaceRoot: execution.workspaceRoot,
    workspaceWriteLease: execution.workspaceWriteLease,
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
  const ownerPath = recoveryOwnerPath(boundary.transactionRoot);
  await durableRemovePendingOwnerFile(recoveryOwnerPendingPath(boundary.transactionRoot), commitFence);
  await durableRemoveFile(ownerPath, commitFence);
}

async function cleanupProvisionalOwner(
  owner: WindowsAppContainerProvisionalOwnerV1,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  workspaceWriteLease: WorkspaceWriteLeaseToken,
  commitFence: () => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  assertProvisionalOwner(owner, boundary, workspaceWriteLease);
  await cleanupHostBunConfig(boundary.stagingRoot, commitFence);
  signal?.throwIfAborted();
  await durableRemovePendingOwnerFile(provisionalOwnerPendingPath(boundary.transactionRoot), commitFence);
  signal?.throwIfAborted();
  await durableRemoveFile(provisionalOwnerPath(boundary.transactionRoot), commitFence);
}

async function publishProvisionalOwner(
  owner: WindowsAppContainerProvisionalOwnerV1,
  transactionRoot: string,
  commitFence: () => Promise<void>,
  testHooks: DurableOwnerPublishTestHooks = {}
): Promise<void> {
  await durablePublishOwnerFile(
    provisionalOwnerPath(transactionRoot),
    provisionalOwnerPendingPath(transactionRoot),
    `${JSON.stringify(owner)}\n`,
    commitFence,
    testHooks
  );
  const canonical = await readProvisionalOwner(provisionalOwnerPath(transactionRoot));
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(owner)) {
    throw executionError('preparation');
  }
}

/** Test-only atomic publication vector; never re-exported from a product facade. */
export async function publishWindowsAppContainerProvisionalOwnerForTests(
  transactionRoot: string,
  interruption: 'after-pending' | 'after-rename'
): Promise<void> {
  const owner: WindowsAppContainerProvisionalOwnerV1 = Object.freeze({
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
  await durableRemovePendingOwnerFile(
    provisionalOwnerPendingPath(transactionRoot),
    async () => undefined
  );
  return await readProvisionalOwner(provisionalOwnerPath(transactionRoot)) ? 'canonical' : 'none';
}

async function publishRecoveryOwner(
  owner: WindowsAppContainerRecoveryOwnerV1,
  transactionRoot: string,
  commitFence: () => Promise<void>
): Promise<void> {
  await durablePublishOwnerFile(
    recoveryOwnerPath(transactionRoot),
    recoveryOwnerPendingPath(transactionRoot),
    `${JSON.stringify(owner)}\n`,
    commitFence
  );
  const canonical = await readRecoveryOwner(recoveryOwnerPath(transactionRoot));
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(owner)) {
    throw executionError('preparation');
  }
}

async function recoverPreviousOwnership(
  execution: WindowsAppContainerExecutionRequest,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  commitFence: () => Promise<void>
): Promise<void> {
  await durableRemovePendingOwnerFile(recoveryOwnerPendingPath(boundary.transactionRoot), commitFence);
  await durableRemovePendingOwnerFile(provisionalOwnerPendingPath(boundary.transactionRoot), commitFence);
  const owner = await readRecoveryOwner(recoveryOwnerPath(boundary.transactionRoot));
  const provisional = await readProvisionalOwner(provisionalOwnerPath(boundary.transactionRoot));
  if (owner) {
    await assertRecoveryOwner(
      owner,
      boundary,
      execution.workspaceWriteLease,
      nativeResultPath(boundary.transactionRoot)
    );
    await cleanupPlannedOwner(execution, owner, boundary, commitFence);
  }
  if (provisional) {
    await cleanupProvisionalOwner(
      provisional,
      boundary,
      execution.workspaceWriteLease,
      commitFence
    );
  }
}

export interface WindowsAppContainerOwnedRecoveryRequest {
  readonly stagingRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  readonly signal?: AbortSignal;
}

/**
 * Bounded-supervisor recovery entrypoint. The caller must first own the exact
 * workspace lease; this function revalidates the transaction boundary and
 * durable owner before removing any ACL, profile, runtime, or owner authority.
 */
export async function recoverWindowsAppContainerOwnedTransaction(
  request: WindowsAppContainerOwnedRecoveryRequest
): Promise<'not-needed' | 'recovered'> {
  assertCapability();
  request.signal?.throwIfAborted();
  const commitFence = () => assertWorkspaceWriteLease(
    request.workspaceRoot,
    request.workspaceWriteLease
  );
  await commitFence();
  request.signal?.throwIfAborted();
  const boundary = await validateRecoveryStagingBoundary(
    request.stagingRoot,
    request.workspaceRoot
  );
  request.signal?.throwIfAborted();
  const hadRecoveryPending = await pathExists(recoveryOwnerPendingPath(boundary.transactionRoot));
  const hadProvisionalPending = await pathExists(provisionalOwnerPendingPath(boundary.transactionRoot));
  await durableRemovePendingOwnerFile(recoveryOwnerPendingPath(boundary.transactionRoot), commitFence);
  request.signal?.throwIfAborted();
  await durableRemovePendingOwnerFile(provisionalOwnerPendingPath(boundary.transactionRoot), commitFence);
  request.signal?.throwIfAborted();
  const owner = await readRecoveryOwner(recoveryOwnerPath(boundary.transactionRoot));
  const provisional = await readProvisionalOwner(provisionalOwnerPath(boundary.transactionRoot));
  if (!owner && !provisional) {
    return hadRecoveryPending || hadProvisionalPending ? 'recovered' : 'not-needed';
  }
  if (owner) {
    const resultPath = nativeResultPath(boundary.transactionRoot);
    await assertRecoveryOwner(owner, boundary, request.workspaceWriteLease, resultPath);
    request.signal?.throwIfAborted();
    const derived = await deriveAppContainerSidPointer(owner.appContainerName);
    request.signal?.throwIfAborted();
    if (derived.sid !== owner.appContainerSid) throw executionError('cleanup');
    await cleanupWindowsAppContainerNativeOwner({
      stagingRoot: boundary.stagingRoot,
      nativeResultPath: resultPath,
      workspaceRoot: request.workspaceRoot,
      workspaceWriteLease: request.workspaceWriteLease,
      owner
    }, derived.sid, request.signal);
    request.signal?.throwIfAborted();
    await durableRemoveFile(recoveryOwnerPath(boundary.transactionRoot), commitFence);
  }
  if (provisional) {
    await cleanupProvisionalOwner(
      provisional,
      boundary,
      request.workspaceWriteLease,
      commitFence,
      request.signal
    );
  }
  return 'recovered';
}

export async function runWindowsAppContainerChild(
  request: WindowsAppContainerExecutionRequest
): Promise<WindowsAppContainerExecutionResult> {
  assertCapability();
  const commitFence = () => assertWorkspaceWriteLease(
    request.workspaceRoot,
    request.workspaceWriteLease
  );
  await commitFence();
  const validated = await validateExecutionRequest(request);
  validateAndSortEnvironment(request.environment, validated.stagingRoot);
  await recoverPreviousOwnership(request, validated, commitFence);

  const appContainerName = buildAppContainerName(
    validated.stagingRoot,
    validated.stagingIdentityDigest
  );
  const provisionalOwner: WindowsAppContainerProvisionalOwnerV1 = Object.freeze({
    formatVersion: PROVISIONAL_OWNER_FORMAT_VERSION,
    workspaceIdentityDigest: request.workspaceWriteLease.workspaceIdentityDigest,
    stagingIdentityDigest: validated.stagingIdentityDigest,
    stagingDirectoryName: path.basename(validated.stagingRoot),
    hostBunConfigRelativePath: HOST_BUN_CONFIG_RELATIVE_ROOT,
    appContainerName
  });
  const resultPath = nativeResultPath(validated.transactionRoot);
  let result: WindowsAppContainerExecutionResult | undefined;
  let owner: WindowsAppContainerRecoveryOwnerV1 | undefined;
  let primaryError:
    | WindowsAppContainerCapabilityUnavailableError
    | WindowsAppContainerExecutionError
    | undefined;

  try {
    await publishProvisionalOwner(provisionalOwner, validated.transactionRoot, commitFence);
    const appContainerSid = await deriveAppContainerSidViaHelper(
      appContainerName,
      validated.stagingRoot,
      request.environment,
      commitFence
    );
    owner = Object.freeze({
      formatVersion: RECOVERY_OWNER_FORMAT_VERSION,
      workspaceIdentityDigest: request.workspaceWriteLease.workspaceIdentityDigest,
      stagingIdentityDigest: validated.stagingIdentityDigest,
      stagingDirectoryName: path.basename(validated.stagingRoot),
      runtimeRelativePath: RUNTIME_DIRECTORY_NAME,
      resultFileName: NATIVE_RESULT_FILE_NAME,
      appContainerName,
      appContainerSid
    });
    await publishRecoveryOwner(owner, validated.transactionRoot, commitFence);
    await durableRemovePendingOwnerFile(provisionalOwnerPendingPath(validated.transactionRoot), commitFence);
    await durableRemoveFile(provisionalOwnerPath(validated.transactionRoot), commitFence);
    await materializeRuntime(validated.stagingRoot, commitFence);
    const systemDirectory = await windowsSystemDirectory();
    const nativeRequest: WindowsAppContainerNativeExecutionRequest = {
      execution: {
        ...request,
        stagingRoot: validated.stagingRoot,
        runnerRelativePath: validated.runnerRelativePath
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
        result = await invokeNativeHelper(
          'execute',
          nativeRequest,
          validated.stagingRoot,
          request.environment,
          commitFence,
          request.timeoutMs === undefined ? undefined : request.timeoutMs + 10_000
        );
      }
    });
  } catch (error) {
    primaryError = normalizeExecutionError(error, 'preparation');
  }

  return completeWindowsAppContainerOwnedExecution(result, primaryError, async () => {
    await commitFence();
    const canonicalOwner = await readRecoveryOwner(recoveryOwnerPath(validated.transactionRoot));
    if (canonicalOwner) {
      if (!owner || JSON.stringify(canonicalOwner) !== JSON.stringify(owner)) {
        throw executionError('cleanup');
      }
      await cleanupPlannedOwner(request, canonicalOwner, validated, commitFence);
    }
    const canonicalProvisional = await readProvisionalOwner(provisionalOwnerPath(validated.transactionRoot));
    if (canonicalProvisional) {
      await cleanupProvisionalOwner(
        canonicalProvisional,
        validated,
        request.workspaceWriteLease,
        commitFence
      );
    }
    await durableRemovePendingOwnerFile(recoveryOwnerPendingPath(validated.transactionRoot), commitFence);
    await durableRemovePendingOwnerFile(provisionalOwnerPendingPath(validated.transactionRoot), commitFence);
  }, 'wait');
}

function capabilityProbeEnvironment(
  source: Readonly<Record<string, string>>,
  stagingRoot: string,
  httpPort: number,
  rawPort: number
): Readonly<Record<string, string>> {
  const processRoot = path.join(stagingRoot, '.process');
  const home = path.join(processRoot, 'home');
  const environment: Record<string, string> = {
    ...source,
    PATH: '',
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(processRoot, 'appdata'),
    LOCALAPPDATA: path.join(processRoot, 'localappdata'),
    TEMP: path.join(processRoot, 'tmp'),
    TMP: path.join(processRoot, 'tmp'),
    TMPDIR: path.join(processRoot, 'tmp'),
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    SEC_APPCONTAINER_PROBE_HTTP_PORT: String(httpPort),
    SEC_APPCONTAINER_PROBE_RAW_PORT: String(rawPort)
  };
  if (environment.BUN_INSTALL_CACHE_DIR !== undefined) {
    environment.BUN_INSTALL_CACHE_DIR = path.join(processRoot, 'bun-install-cache');
  }
  if (environment.PLAYWRIGHT_BROWSERS_PATH !== undefined) {
    environment.PLAYWRIGHT_BROWSERS_PATH = path.join(processRoot, 'playwright-browsers');
  }
  return Object.freeze(environment);
}

async function closeProbeServer(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
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
  owner: WindowsAppContainerProbeOwnerV1,
  probeRoot: string,
  commitFence: () => Promise<void>
): Promise<void> {
  await durablePublishOwnerFile(
    probeOwnerPath(probeRoot),
    probeOwnerPendingPath(probeRoot),
    `${JSON.stringify(owner)}\n`,
    commitFence
  );
  const canonical = await readProbeOwner(probeOwnerPath(probeRoot));
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(owner)) {
    throw executionError('preparation');
  }
}

async function executionRecoveryResidueExists(transactionRoot: string): Promise<boolean> {
  for (const candidate of [
    recoveryOwnerPath(transactionRoot),
    recoveryOwnerPendingPath(transactionRoot),
    provisionalOwnerPath(transactionRoot),
    provisionalOwnerPendingPath(transactionRoot),
    nativeResultPath(transactionRoot)
  ]) {
    if (await pathExists(candidate)) return true;
  }
  return false;
}

async function executionRecoveryAuthorityExists(transactionRoot: string): Promise<boolean> {
  for (const candidate of [
    recoveryOwnerPath(transactionRoot),
    recoveryOwnerPendingPath(transactionRoot),
    provisionalOwnerPath(transactionRoot),
    provisionalOwnerPendingPath(transactionRoot)
  ]) {
    if (await pathExists(candidate)) return true;
  }
  return false;
}

function capabilityReportLooksIsolated(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !exactObjectKeys(value, ['direct', 'spawned', 'spawnedExitCode'])) return false;
  const report = value as Record<string, unknown>;
  const vectorLooksValid = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      !exactObjectKeys(candidate, [
        'fetchConnect',
        'insideWrite',
        'outerRead',
        'outsideWrite',
        'parentRead',
        'rawConnect'
      ])) {
      return false;
    }
    const vector = candidate as Record<string, unknown>;
    return vector.insideWrite === true && vector.outsideWrite === false &&
      vector.parentRead === false && vector.outerRead === false &&
      vector.fetchConnect === false && vector.rawConnect === false;
  };
  return vectorLooksValid(report.direct) && vectorLooksValid(report.spawned) &&
    report.spawnedExitCode === 0;
}

/** Pure status-only projection used by the product facade and redaction tests. */
export function redactWindowsAppContainerProbeCapabilityForTests(
  detailed: WindowsAppContainerDetailedProbeCapability
): WindowsAppContainerProbeCapability {
  return detailed.status === 'available'
    ? Object.freeze({ status: 'available' })
    : Object.freeze({ status: 'unavailable' });
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
  const outerFence = () => assertWorkspaceWriteLease(
    request.workspaceRoot,
    request.workspaceWriteLease
  );
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

  let probeLease: WorkspaceWriteLeaseHandle | undefined;
  let probeLeaseReleased = false;
  let httpServer: Awaited<ReturnType<(typeof import('node:http'))['createServer']>> | undefined;
  let rawServer: Awaited<ReturnType<(typeof import('node:net'))['createServer']>> | undefined;
  let probeRoot: string | undefined;
  let outerCanaryPath: string | undefined;
  let outerCanaryOwned = false;
  let observedLeaseLossProcessIds: readonly number[] = Object.freeze([]);
  let primaryFault: WindowsAppContainerProbeFault | undefined;
  let availableCandidate = false;

  try {
    at('boundary', 'outer-boundary-valid');
    await outerFence();
    const boundary = await validateRecoveryStagingBoundary(request.stagingRoot, request.workspaceRoot);
    validateAndSortEnvironment(request.environment, boundary.stagingRoot);
    probeRoot = path.join(boundary.stagingRoot, CAPABILITY_PROBE_RELATIVE_ROOT);
    outerCanaryPath = path.join(boundary.stagingRoot, CAPABILITY_OUTER_CANARY_NAME);
    const probeStagingRoot = path.join(probeRoot, 's');
    const hadProbeOwner = await pathExists(probeOwnerPath(probeRoot));
    const hadProbeOwnerPending = await pathExists(probeOwnerPendingPath(probeRoot));
    const needsInitialRecovery = await executionRecoveryAuthorityExists(probeRoot);

    at('probe-root', 'probe-root-prepared');
    if (await pathExists(probeRoot) && !hadProbeOwner && !hadProbeOwnerPending && !needsInitialRecovery) {
      await outerFence();
      await rm(probeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
    await outerFence();
    await mkdir(probeStagingRoot, { recursive: true });

    at('server', 'probe-server-listening');
    const { createServer: createHttpServer } = await import('node:http');
    const { createServer: createRawServer } = await import('node:net');
    let httpConnections = 0;
    let rawConnections = 0;
    httpServer = createHttpServer((_incoming, response) => {
      httpConnections += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('reachable');
    });
    rawServer = createRawServer((socket) => {
      rawConnections += 1;
      socket.destroy();
    });
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        httpServer!.once('error', reject);
        httpServer!.listen(0, '127.0.0.1', resolve);
      }),
      new Promise<void>((resolve, reject) => {
        rawServer!.once('error', reject);
        rawServer!.listen(0, '127.0.0.1', resolve);
      })
    ]);
    const httpAddress = httpServer.address();
    const rawAddress = rawServer.address();
    if (!httpAddress || typeof httpAddress === 'string' ||
      !rawAddress || typeof rawAddress === 'string') {
      throwProbeFailure('server', 'probe-address-valid');
    }

    at('environment', 'probe-environment-valid');
    const environment = capabilityProbeEnvironment(
      request.environment,
      probeStagingRoot,
      httpAddress.port,
      rawAddress.port
    );
    validateAndSortEnvironment(environment, probeStagingRoot);
    const processDirectories = [
      environment.HOME,
      environment.APPDATA,
      environment.LOCALAPPDATA,
      environment.TEMP,
      environment.BUN_INSTALL_CACHE_DIR,
      environment.PLAYWRIGHT_BROWSERS_PATH
    ].filter((entry): entry is string => typeof entry === 'string');
    for (const directory of processDirectories) {
      await outerFence();
      await mkdir(directory, { recursive: true });
    }

    at('ownership', 'probe-lease-owned');
    probeLease = await acquireWorkspaceWriteLease(probeRoot);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await probeLease.assertOwned();
    const probeFence = async (): Promise<void> => {
      await outerFence();
      await probeLease!.assertOwned();
    };
    await durableRemovePendingOwnerFile(probeOwnerPendingPath(probeRoot), probeFence);
    const existingProbeOwner = await readProbeOwner(probeOwnerPath(probeRoot));
    if (existingProbeOwner) {
      at('ownership', 'probe-owner-valid');
      assertProbeOwner(existingProbeOwner, boundary, request.workspaceWriteLease, probeLease.token);
      outerCanaryOwned = true;
    } else {
      const parentCanaryPath = path.join(probeRoot, CAPABILITY_PARENT_CANARY_NAME);
      const existingCanary = await pathExists(parentCanaryPath) || await pathExists(outerCanaryPath);
      if (existingCanary && !needsInitialRecovery) {
        throwProbeFailure('canary', 'canary-owned');
      }
      const probeOwner: WindowsAppContainerProbeOwnerV1 = Object.freeze({
        formatVersion: PROBE_OWNER_FORMAT_VERSION,
        outerWorkspaceIdentityDigest: request.workspaceWriteLease.workspaceIdentityDigest,
        probeWorkspaceIdentityDigest: probeLease.token.workspaceIdentityDigest,
        outerStagingIdentityDigest: boundary.stagingIdentityDigest,
        probeStagingDirectoryName: 's',
        parentCanaryName: CAPABILITY_PARENT_CANARY_NAME,
        outerCanaryName: CAPABILITY_OUTER_CANARY_NAME
      });
      at('ownership', 'probe-owner-valid');
      await publishProbeOwner(probeOwner, probeRoot, probeFence);
      outerCanaryOwned = true;
    }

    at('canary', 'canary-owned');
    const parentCanaryPath = path.join(probeRoot, CAPABILITY_PARENT_CANARY_NAME);
    for (const canaryPath of [parentCanaryPath, outerCanaryPath]) {
      if (await pathExists(canaryPath)) {
        await probeFence();
        if (await readFile(canaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT) {
          throwProbeFailure('canary', 'canary-owned');
        }
      } else {
        await outerFence();
        await probeLease.assertOwned();
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
      'lease-loss-runner.mjs',
      'vector-runner.mjs'
    ]) {
      await outerFence();
      await probeLease.assertOwned();
      await rm(path.join(probeStagingRoot, relativePath), { force: true });
    }
    await outerFence();
    await probeLease.assertOwned();
    await writeFile(path.join(probeStagingRoot, 'lease-loss-runner.mjs'), CAPABILITY_LEASE_LOSS_RUNNER, {
      flag: 'wx'
    });
    await outerFence();
    await probeLease.assertOwned();
    await writeFile(path.join(probeStagingRoot, 'vector-runner.mjs'), CAPABILITY_VECTOR_RUNNER, { flag: 'wx' });

    const timeoutMs = request.timeoutMs ?? 10_000;
    if (needsInitialRecovery) {
      at('initial-recovery', 'initial-owner-recovered');
      const recoveryExecution = await runWindowsAppContainerChild({
        stagingRoot: probeStagingRoot,
        runnerRelativePath: 'vector-runner.mjs',
        environment,
        workspaceRoot: probeRoot,
        workspaceWriteLease: probeLease.token,
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
        await probeLease.assertOwned();
        await rm(path.join(probeStagingRoot, relativePath), { force: true });
      }
    }

    at('prefix-recovery', 'prefix-failure-recovered');
    await outerFence();
    await probeLease.assertOwned();
    await mkdir(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME));
    const prefixRejected = await runWindowsAppContainerChild({
      stagingRoot: probeStagingRoot,
      runnerRelativePath: 'vector-runner.mjs',
      environment,
      workspaceRoot: probeRoot,
      workspaceWriteLease: probeLease.token,
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
      runnerRelativePath: 'lease-loss-runner.mjs',
      environment,
      workspaceRoot: probeRoot,
      workspaceWriteLease: probeLease.token,
      timeoutMs
    }).then(() => false, () => true);
    const marker = await waitForProbeMarker(
      path.join(probeStagingRoot, 'lease-loss-marker.json'),
      timeoutMs
    );
    observedLeaseLossProcessIds = Object.freeze([marker.processId, marker.descendantProcessId]);
    await probeLease.release();
    probeLeaseReleased = true;
    if (!await leaseLossRejected || !await pathExists(recoveryOwnerPath(probeRoot))) {
      throwProbeFailure('lease-loss', 'lease-loss-owner-durable');
    }
    at('lease-loss', 'lease-loss-processes-exited');
    await waitForProcessesToExit(observedLeaseLossProcessIds, 5_000);
    observedLeaseLossProcessIds = Object.freeze([]);

    at('isolated-execution', 'isolated-child-succeeded');
    probeLease = await acquireWorkspaceWriteLease(probeRoot);
    probeLeaseReleased = false;
    const execution = await runWindowsAppContainerChild({
      stagingRoot: probeStagingRoot,
      runnerRelativePath: 'vector-runner.mjs',
      environment,
      workspaceRoot: probeRoot,
      workspaceWriteLease: probeLease.token,
      timeoutMs
    });
    if (execution.exitCode !== 0) {
      throwProbeFailure('isolated-execution', 'isolated-child-succeeded');
    }
    at('isolated-execution', 'no-resource-residue');
    if (httpConnections !== 0 || rawConnections !== 0 ||
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
    if (!capabilityReportLooksIsolated(report)) {
      throwProbeFailure('isolation-report', 'isolation-report-valid');
    }
    await outerFence();
    await probeLease.assertOwned();
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
    if (httpServer) {
      await captureCleanup('server-close', async () => closeProbeServer(httpServer!));
      httpServer = undefined;
    }
    if (rawServer) {
      await captureCleanup('server-close', async () => closeProbeServer(rawServer!));
      rawServer = undefined;
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

/**
 * Runs the complete opaque sentinel and exposes only the frozen status-only
 * product capability. No diagnostic path, child output, or typed detail leaves
 * this boundary.
 */
export async function probeWindowsAppContainerCapability(
  request: WindowsAppContainerCapabilityProbeRequest
): Promise<WindowsAppContainerProbeCapability> {
  return redactWindowsAppContainerProbeCapabilityForTests(
    await probeWindowsAppContainerCapabilityForTests(request)
  );
}
