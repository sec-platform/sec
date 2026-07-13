import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Pointer } from 'bun:ffi';
import { runCommand } from './process.ts';
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease,
  type WorkspaceWriteLeaseHandle,
  type WorkspaceWriteLeaseToken
} from './workspace-write-lease.ts';

const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x0002_0009;
const EXTENDED_STARTUPINFO_PRESENT = 0x0008_0000;
const CREATE_UNICODE_ENVIRONMENT = 0x0000_0400;
const CREATE_NO_WINDOW = 0x0800_0000;
const CREATE_SUSPENDED = 0x0000_0004;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;
const WAIT_OBJECT_0 = 0x0000_0000;
const WAIT_TIMEOUT = 0x0000_0102;
const WAIT_FAILED = 0xffff_ffff;
const MAXIMUM_SID_BYTES = 68;
const MAXIMUM_ATTRIBUTE_LIST_BYTES = 1024 * 1024;
const MAXIMUM_RESUME_THREAD_RESULT = 0xffff_ffff;
const TERMINATED_EXIT_CODE = 0x534d_3301;
const RUNTIME_DIRECTORY_NAME = '.sm3r';
const RUNTIME_EXECUTABLE_NAME = 'bun.exe';
const RUNTIME_CONFIG_NAME = 'bunfig.toml';
const HOST_BUN_CONFIG_RELATIVE_ROOT = '.sm3h';
const ISOLATED_BUN_CONFIG_CONTENT = '# isolated runtime\n';
const NATIVE_HELPER_BUNDLE_NAME = 'windows-appcontainer-native-helper.mjs';
const RECOVERY_OWNER_FORMAT_VERSION = 'windows-appcontainer-recovery-owner-v1';
const RECOVERY_OWNER_FILE_NAME = '.semantic-mutation-appcontainer-owner-v1.json';
const NATIVE_RESULT_FILE_NAME = '.semantic-mutation-appcontainer-result-v1.json';
const NATIVE_HELPER_PATH = fileURLToPath(new URL('./windows-appcontainer-native-helper.ts', import.meta.url));

type BunFfiToBuffer = (typeof import('bun:ffi'))['toBuffer'];

let nativeHelperBundlePromise: Promise<Uint8Array> | undefined;

function buildNativeHelperBundle(): Promise<Uint8Array> {
  nativeHelperBundlePromise ??= (async () => {
    const result = await Bun.build({
      entrypoints: [NATIVE_HELPER_PATH],
      format: 'esm',
      minify: false,
      sourcemap: 'none',
      splitting: false,
      target: 'bun'
    });
    if (!result.success || result.outputs.length !== 1) throw executionError('preparation');
    const bytes = new Uint8Array(await result.outputs[0].arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    if (bytes.byteLength === 0 || /(?:from|import\s*\()\s*["'][^"']+\.ts["']/u.test(text)) {
      throw executionError('preparation');
    }
    return bytes;
  })();
  return nativeHelperBundlePromise;
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
try { await Bun.file(path.resolve(process.cwd(), '..', '..', '..', '.appcontainer-outer-host-read-canary-v1')).text(); result.outerRead = true; } catch {}
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
try { await Bun.file(path.resolve(process.cwd(), '..', '..', '..', '.appcontainer-outer-host-read-canary-v1')).text(); direct.outerRead = true; } catch {}
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
  securityCapabilitiesBytes: 24,
  securityCapabilitiesAppContainerSidOffset: 0,
  securityCapabilitiesCapabilitiesOffset: 8,
  securityCapabilitiesCapabilityCountOffset: 16,
  securityCapabilitiesReservedOffset: 20,
  startupInfoExBytes: 112,
  startupInfoExAttributeListOffset: 104,
  processInformationBytes: 24,
  processInformationProcessHandleOffset: 0,
  processInformationThreadHandleOffset: 8,
  jobObjectExtendedLimitInformationBytes: 144,
  jobObjectLimitFlagsOffset: 16,
  procThreadAttributeSecurityCapabilities: PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
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
    public readonly nativeCode?: number
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

function executionError(
  phase: WindowsAppContainerExecutionPhase,
  nativeCode?: number
): WindowsAppContainerExecutionError {
  return new WindowsAppContainerExecutionError(phase, nativeCode);
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
  const bootstrap = `process.chdir(${JSON.stringify(stagingRoot)});await import(${JSON.stringify(pathToFileURL(runnerPath).href)});`;
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
    if (result < 0) throw executionError('preparation');
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
    if (result < 0) throw executionError('preparation');
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
  commitFence: () => Promise<void>
): Promise<string> {
  const result = await runFencedWindowsCommand(
    path.join(systemDirectory, 'icacls.exe'),
    args,
    systemDirectory,
    commitFence
  );
  if (result.code !== 0) throw executionError('acl');
  return result.stdout;
}

async function runFencedWindowsCommand(
  executable: string,
  args: readonly string[],
  systemDirectory: string,
  commitFence: () => Promise<void>
): Promise<{ code: number; stdout: string }> {
  await commitFence();
  let stdout = '';
  let settled = false;
  const child = spawn(executable, [...args], {
    // All filesystem arguments are absolute. A staging cwd beyond MAX_PATH
    // makes libuv report the real system executable as ENOENT on Windows.
    cwd: systemDirectory,
    env: {
      PATH: '',
      SystemRoot: path.dirname(systemDirectory),
      WINDIR: path.dirname(systemDirectory)
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => {
    if (stdout.length <= 1024 * 1024) stdout += String(chunk);
  });
  const completion = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => {
      settled = true;
      resolve(exitCode ?? 1);
    });
  });
  try {
    while (!settled) {
      const outcome = await Promise.race([
        completion.then((code) => ({ done: true as const, code })),
        new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), 20))
      ]);
      if (outcome.done) return { code: outcome.code, stdout };
      await commitFence();
    }
    return { code: await completion, stdout };
  } catch (error) {
    child.kill();
    await completion.catch(() => undefined);
    throw error;
  }
}

async function appContainerProfileExists(
  systemDirectory: string,
  appContainerName: string,
  commitFence: () => Promise<void>
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
    commitFence
  );
  return result.code === 0 &&
    result.stdout.toLocaleLowerCase('en-US').includes(appContainerName.toLocaleLowerCase('en-US'));
}

async function assertAppContainerAclAbsent(
  systemDirectory: string,
  stagingRoot: string,
  appContainerSid: string,
  commitFence: () => Promise<void>
): Promise<void> {
  const result = await runFencedWindowsCommand(
    path.join(systemDirectory, 'icacls.exe'),
    [stagingRoot, '/findsid', `*${appContainerSid}`, '/T', '/C', '/Q'],
    systemDirectory,
    commitFence
  );
  if (result.stdout.toLocaleLowerCase('en-US').includes(foldedWindowsPath(stagingRoot)) ||
    (result.code !== 0 && result.code !== 1)) {
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
  try {
    const result = await runCommand(process.execPath, [
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
      timeoutMs
    });
    await commitFence();
    return result;
  } finally {
    await cleanupHostBunConfig(stagingRoot, commitFence);
  }
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
  let processHandle = 0n;
  let threadHandle = 0n;
  let jobHandle = 0n;
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

    const attributeListSize = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.pointerBytes);
    kernel32.symbols.InitializeProcThreadAttributeList(null, 1, 0, attributeListSize);
    const requiredAttributeBytes = Number(attributeListSize.readBigUInt64LE(0));
    if (!Number.isSafeInteger(requiredAttributeBytes) || requiredAttributeBytes <= 0 ||
      requiredAttributeBytes > MAXIMUM_ATTRIBUTE_LIST_BYTES) {
      throw executionError('launch');
    }
    attributeList = Buffer.alloc(requiredAttributeBytes);
    if (kernel32.symbols.InitializeProcThreadAttributeList(
      attributeList,
      1,
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

    const startupInfoEx = Buffer.alloc(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExBytes);
    startupInfoEx.writeUInt32LE(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.startupInfoExBytes, 0);
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
      0,
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
      const waitResult = kernel32.symbols.WaitForSingleObject(processHandle, 0);
      if (waitResult === WAIT_OBJECT_0) break;
      if (waitResult === WAIT_FAILED || waitResult !== WAIT_TIMEOUT) {
        throw executionError('wait');
      }
      if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) {
        kernel32.symbols.TerminateProcess(processHandle, TERMINATED_EXIT_CODE);
        throw executionError('timeout');
      }
      await commitFence();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const exitCodeBuffer = Buffer.alloc(4);
    if (kernel32.symbols.GetExitCodeProcess(processHandle, exitCodeBuffer) === 0) {
      throw executionError('wait');
    }
    processCompleted = true;
    const exitCode = exitCodeBuffer.readUInt32LE(0);
    await commitFence();
    await writeFile(nativeResultPath, `${JSON.stringify({ exitCode })}\n`, { flag: 'wx' });
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
      if (attributeListInitialized && attributeList) {
        kernel32.symbols.DeleteProcThreadAttributeList(attributeList);
      }
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

async function readRecoveryOwner(
  ownerPath: string
): Promise<WindowsAppContainerRecoveryOwnerV1 | undefined> {
  try {
    const metadata = await lstat(ownerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1 ||
      metadata.size < 1 || metadata.size > 4096) {
      throw executionError('cleanup');
    }
    const parsed = JSON.parse(await readFile(ownerPath, 'utf8')) as unknown;
    if (!recoveryOwnerLooksValid(parsed)) throw executionError('cleanup');
    return Object.freeze(parsed);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    if (error instanceof WindowsAppContainerExecutionError) throw error;
    throw executionError('cleanup');
  }
}

async function invokeNativeHelper(
  mode: 'create-profile' | 'execute',
  helperRequest: WindowsAppContainerNativeExecutionRequest,
  stagingRoot: string,
  environment: Readonly<Record<string, string>>,
  commitFence: () => Promise<void>,
  timeoutMs: number | undefined
): Promise<number> {
  const serialized = Buffer.from(JSON.stringify({ mode, request: helperRequest }), 'utf8').toString('base64url');
  const result = await runHostBunCommand(
    stagingRoot,
    environment,
    commitFence,
    timeoutMs,
    serialized
  );
  return result.code;
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
  if (result.code !== 0 || result.stderr !== '') throw executionError('preparation');
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw executionError('preparation');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    !exactObjectKeys(parsed, ['appContainerSid'])) {
    throw executionError('preparation');
  }
  const sid = (parsed as Record<string, unknown>).appContainerSid;
  if (typeof sid !== 'string' || !/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(sid)) {
    throw executionError('preparation');
  }
  return sid;
}

function parseNativeResult(value: unknown): WindowsAppContainerExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw executionError('wait');
  const record = value as Record<string, unknown>;
  if (record.status === 'failed') {
    const expectedKeys = ['phase', 'status', ...(record.nativeCode === undefined ? [] : ['nativeCode'])].sort();
    if (!exactObjectKeys(record, expectedKeys) ||
      !['invalid-input', 'preparation', 'acl', 'launch', 'wait', 'timeout', 'cleanup'].includes(String(record.phase)) ||
      (record.nativeCode !== undefined && !Number.isSafeInteger(record.nativeCode))) {
      throw executionError('wait');
    }
    throw executionError(
      record.phase as WindowsAppContainerExecutionPhase,
      record.nativeCode === undefined ? undefined : Number(record.nativeCode)
    );
  }
  if (!exactObjectKeys(record, ['exitCode']) ||
    !Number.isSafeInteger(record.exitCode) || Number(record.exitCode) < 0) {
    throw executionError('wait');
  }
  return Object.freeze({ exitCode: Number(record.exitCode) });
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
  provenAppContainerSid: string
): Promise<void> {
  assertCapability();
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
  ], commitFence);
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
    commitFence
  )) {
    await deleteAppContainerProfile(request.owner.appContainerName, commitFence);
  }
  await commitFence();
  await rm(request.nativeResultPath, { force: true });
  await assertAppContainerAclAbsent(
    systemDirectory,
    boundary.stagingRoot,
    request.owner.appContainerSid,
    commitFence
  );
  await commitFence();
  if (await pathExists(path.join(boundary.stagingRoot, request.owner.runtimeRelativePath))) {
    throw executionError('cleanup', 22);
  }
  if (await pathExists(request.nativeResultPath)) throw executionError('cleanup', 23);
  if (await appContainerProfileExists(
    systemDirectory,
    request.owner.appContainerName,
    commitFence
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
  await durableRemoveFile(ownerPath, commitFence);
}

async function recoverPreviousOwner(
  execution: WindowsAppContainerExecutionRequest,
  boundary: Omit<ValidatedExecutionBoundary, 'runnerRelativePath'>,
  commitFence: () => Promise<void>
): Promise<void> {
  const owner = await readRecoveryOwner(recoveryOwnerPath(boundary.transactionRoot));
  if (!owner) return;
  await assertRecoveryOwner(
    owner,
    boundary,
    execution.workspaceWriteLease,
    nativeResultPath(boundary.transactionRoot)
  );
  await cleanupPlannedOwner(execution, owner, boundary, commitFence);
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
  await recoverPreviousOwner(request, validated, commitFence);

  const appContainerName = buildAppContainerName(
    validated.stagingRoot,
    validated.stagingIdentityDigest
  );
  const owner: WindowsAppContainerRecoveryOwnerV1 = Object.freeze({
    formatVersion: RECOVERY_OWNER_FORMAT_VERSION,
    workspaceIdentityDigest: request.workspaceWriteLease.workspaceIdentityDigest,
    stagingIdentityDigest: validated.stagingIdentityDigest,
    stagingDirectoryName: path.basename(validated.stagingRoot),
    runtimeRelativePath: RUNTIME_DIRECTORY_NAME,
    resultFileName: NATIVE_RESULT_FILE_NAME,
    appContainerName,
    appContainerSid: await deriveAppContainerSidViaHelper(
      appContainerName,
      validated.stagingRoot,
      request.environment,
      commitFence
    )
  });
  const ownerPath = recoveryOwnerPath(validated.transactionRoot);
  const resultPath = nativeResultPath(validated.transactionRoot);
  let ownerCreationAttempted = false;
  let result: WindowsAppContainerExecutionResult | undefined;
  let primaryError:
    | WindowsAppContainerCapabilityUnavailableError
    | WindowsAppContainerExecutionError
    | undefined;

  try {
    await commitFence();
    ownerCreationAttempted = true;
    await durableCreateFile(ownerPath, `${JSON.stringify(owner)}\n`, commitFence);
    await materializeRuntime(validated.stagingRoot, commitFence);
    const systemDirectory = await windowsSystemDirectory();
    await runIcacls(systemDirectory, [
      validated.stagingRoot,
      '/grant',
      `*${owner.appContainerSid}:(OI)(CI)(M)`,
      '/T',
      '/C',
      '/Q'
    ], commitFence);
    const nativeRequest: WindowsAppContainerNativeExecutionRequest = {
      execution: {
        ...request,
        stagingRoot: validated.stagingRoot,
        runnerRelativePath: validated.runnerRelativePath
      },
      nativeResultPath: resultPath,
      owner
    };
    const profileHelperCode = await invokeNativeHelper(
      'create-profile',
      nativeRequest,
      validated.stagingRoot,
      request.environment,
      commitFence,
      10_000
    );
    if (profileHelperCode !== 0) throw executionError('preparation');
    await invokeNativeHelper(
      'execute',
      nativeRequest,
      validated.stagingRoot,
      request.environment,
      commitFence,
      request.timeoutMs === undefined ? undefined : request.timeoutMs + 10_000
    );
    await commitFence();
    const resultMetadata = await lstat(resultPath);
    if (!resultMetadata.isFile() || resultMetadata.isSymbolicLink() ||
      Number(resultMetadata.nlink) !== 1 || resultMetadata.size < 1 || resultMetadata.size > 1024) {
      throw executionError('wait');
    }
    result = parseNativeResult(JSON.parse(await readFile(resultPath, 'utf8')) as unknown);
  } catch (error) {
    primaryError = normalizeExecutionError(error, 'preparation');
  }

  if (ownerCreationAttempted) {
    try {
      await cleanupPlannedOwner(request, owner, validated, commitFence);
    } catch (error) {
      if (error instanceof WindowsAppContainerExecutionError) throw error;
      throw executionError('cleanup');
    }
  }
  if (primaryError) throw primaryError;
  if (!result) throw executionError('wait');
  return result;
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
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
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

/**
 * Runs the complete, opaque AppContainer sentinel in a deterministic subtree of
 * staging. Native helpers execute only a cached bundle materialized beneath
 * staging; neither helper nor AppContainer child reads host TypeScript source.
 * No diagnostic path or child output is returned. Any missing invariant is
 * exactly unavailable.
 */
export async function probeWindowsAppContainerCapability(
  request: WindowsAppContainerCapabilityProbeRequest
): Promise<WindowsAppContainerProbeCapability> {
  if (windowsAppContainerCapability().status !== 'available') {
    return Object.freeze({ status: 'unavailable' });
  }
  const unavailable = (): WindowsAppContainerProbeCapability =>
    Object.freeze({ status: 'unavailable' });
  const outerFence = () => assertWorkspaceWriteLease(
    request.workspaceRoot,
    request.workspaceWriteLease
  );
  let probeLease: WorkspaceWriteLeaseHandle | undefined;
  let probeLeaseReleased = false;
  let httpServer: Awaited<ReturnType<(typeof import('node:http'))['createServer']>> | undefined;
  let rawServer: Awaited<ReturnType<(typeof import('node:net'))['createServer']>> | undefined;
  let probeRoot: string | undefined;
  let outerCanaryPath: string | undefined;
  let outerCanaryOwned = false;
  let probeSucceeded = false;
  try {
    await outerFence();
    const boundary = await validateRecoveryStagingBoundary(request.stagingRoot, request.workspaceRoot);
    validateAndSortEnvironment(request.environment, boundary.stagingRoot);
    probeRoot = path.join(boundary.stagingRoot, CAPABILITY_PROBE_RELATIVE_ROOT);
    outerCanaryPath = path.join(boundary.stagingRoot, CAPABILITY_OUTER_CANARY_NAME);
    const probeStagingRoot = path.join(probeRoot, 's');
    const probeOwnerPath = recoveryOwnerPath(probeRoot);
    const needsInitialRecovery = await pathExists(probeOwnerPath);
    if (await pathExists(probeRoot) && !needsInitialRecovery) {
      await outerFence();
      await rm(probeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
    await outerFence();
    await mkdir(probeStagingRoot, { recursive: true });

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
      !rawAddress || typeof rawAddress === 'string') return unavailable();
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

    probeLease = await acquireWorkspaceWriteLease(probeRoot);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await probeLease.assertOwned();
    const parentCanaryPath = path.join(probeRoot, CAPABILITY_PARENT_CANARY_NAME);
    for (const canaryPath of [parentCanaryPath, outerCanaryPath]) {
      if (await pathExists(canaryPath)) {
        if (!needsInitialRecovery ||
          await readFile(canaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT) return unavailable();
        if (canaryPath === outerCanaryPath) outerCanaryOwned = true;
      } else {
        await outerFence();
        await probeLease.assertOwned();
        await writeFile(canaryPath, CAPABILITY_CANARY_CONTENT, { flag: 'wx' });
        if (canaryPath === outerCanaryPath) outerCanaryOwned = true;
      }
    }
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
      const recoveryExecution = await runWindowsAppContainerChild({
        stagingRoot: probeStagingRoot,
        runnerRelativePath: 'vector-runner.mjs',
        environment,
        workspaceRoot: probeRoot,
        workspaceWriteLease: probeLease.token,
        timeoutMs
      });
      if (recoveryExecution.exitCode !== 0 || await pathExists(probeOwnerPath) ||
        await pathExists(nativeResultPath(probeRoot)) ||
        await pathExists(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME))) {
        return unavailable();
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

    // Force an owner+runtime prefix failure before any profile/ACL creation.
    // Recovery must treat every still-absent planned resource as already clean.
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
    if (!prefixRejected || await pathExists(recoveryOwnerPath(probeRoot)) ||
      await pathExists(nativeResultPath(probeRoot)) ||
      await pathExists(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME))) {
      return unavailable();
    }

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
    await probeLease.release();
    probeLeaseReleased = true;
    if (!await leaseLossRejected || !await pathExists(recoveryOwnerPath(probeRoot))) {
      return unavailable();
    }
    await waitForProcessesToExit([marker.processId, marker.descendantProcessId], 5_000);

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
    if (execution.exitCode !== 0 || httpConnections !== 0 || rawConnections !== 0 ||
      await pathExists(recoveryOwnerPath(probeRoot)) ||
      await pathExists(nativeResultPath(probeRoot)) ||
      await pathExists(path.join(probeStagingRoot, RUNTIME_DIRECTORY_NAME)) ||
      await pathExists(path.join(probeRoot, 'direct-outside.txt')) ||
      await pathExists(path.join(probeRoot, 'spawned-outside.txt'))) {
      return unavailable();
    }
    const report = JSON.parse(await readFile(
      path.join(probeStagingRoot, 'capability-result.json'),
      'utf8'
    )) as unknown;
    if (!capabilityReportLooksIsolated(report) ||
      await readFile(parentCanaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT ||
      await readFile(outerCanaryPath, 'utf8') !== CAPABILITY_CANARY_CONTENT) {
      return unavailable();
    }
    await probeLease.release();
    probeLeaseReleased = true;
    await closeProbeServer(httpServer);
    httpServer = undefined;
    await closeProbeServer(rawServer);
    rawServer = undefined;
    if (outerCanaryOwned) {
      await outerFence();
      await rm(outerCanaryPath, { force: true });
      outerCanaryOwned = false;
    }
    await outerFence();
    await rm(probeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    if (await pathExists(probeRoot) || await pathExists(outerCanaryPath)) {
      return unavailable();
    }
    probeSucceeded = true;
    probeRoot = undefined;
    outerCanaryPath = undefined;
    return Object.freeze({ status: 'available' });
  } catch {
    return unavailable();
  } finally {
    if (probeLease && !probeLeaseReleased) {
      await probeLease.release().catch(() => undefined);
    }
    if (httpServer) await closeProbeServer(httpServer).catch(() => undefined);
    if (rawServer) await closeProbeServer(rawServer).catch(() => undefined);
    if (probeRoot && (probeSucceeded || !await pathExists(recoveryOwnerPath(probeRoot)))) {
      try {
        await outerFence();
        await rm(probeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
        if (outerCanaryPath && outerCanaryOwned) {
          await outerFence();
          await rm(outerCanaryPath, { force: true });
          outerCanaryOwned = false;
        }
      } catch {
        probeSucceeded = false;
      }
    }
  }
}
