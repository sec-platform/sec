import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { CommitFence } from '../../../../contracts/commit-fence.ts';
import { settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
import type { IndependentProviderProcessCapability } from './independent-provider-process.ts';
import {
  copyBoundedCommandInput,
  runObservedCommand,
  type ObservedCommandOutcome,
  type ObservedNativeProcessResourceLedger
} from './observed-process-stdin.ts';
import {
  assertRetainedNoFollowCapability,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type RetainedNoFollowOrdinaryFile
} from './physical-no-follow.ts';
import {
  assertRetainedCommandBoundaryCurrent,
  issueRetainedCommandBoundaryIdentity,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  retainedCommandBoundaryAuxiliaryInputs,
  type RetainedCommandAuxiliaryInput,
  type RetainedCommandBoundary,
  type RetainedCommandExecutable,
  type RetainedCommandWorkingDirectory
} from './retained-command-boundary.ts';
import { resolveWindowsKnownFolderPath } from './windows-known-folders.ts';

export const ISOLATED_VERIFICATION_ENV_KEY = 'SEC_ISOLATED_VERIFICATION' as const;

export function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

/**
 * Lowest-level executable discovery. The returned path is only a locator;
 * semantic providers must retain and verify the file before execution.
 */
export function resolveExecutableLocator(
  command: string,
  input: Readonly<{ cwd: string; pathValue: string }>
): string | null {
  if (command.length === 0 || command.includes('\0')) {
    throw new Error('Executable locator command must be one non-empty NUL-free string');
  }
  const cwd = path.resolve(input.cwd);
  if (!path.isAbsolute(input.cwd) || cwd !== input.cwd || input.pathValue.includes('\0')) {
    throw new Error('Executable locator input is not canonical');
  }
  return Bun.which(command, { PATH: input.pathValue, cwd });
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ByteCommandResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

export interface ObservedByteCommandResult {
  readonly result: ByteCommandResult;
  readonly outcome: ObservedCommandOutcome;
}

export interface RunCommandOptions {
  admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
  beforeSpawn?: CommitFence;
  whileRunning?: CommitFence;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  envMode?: 'inherit' | 'replace';
  /** Immutable bytes written once to stdin before output settlement. */
  input?: Uint8Array;
  /** Required per-command bound whenever input is supplied. */
  maxStdinBytes?: number;
  maxStderrBytes?: number;
  maxStdoutBytes?: number;
  stallTimeoutMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  independentProvider?: IndependentProviderProcessCapability;
}

export const RETAINED_COMMAND_AUXILIARY_DESCRIPTOR_BASE = 5;
const RETAINED_COMMAND_AUXILIARY_INPUT_LIMIT = 8;

export type RetainedCommandAuxiliaryOrdinaryFileRequest = Readonly<{
  expectedParent: PhysicalDirectoryChain;
  name: string;
  expectedPhysical?: Readonly<{ device: string; inode: string }>;
  label?: string;
}>;

export function retainCommandAuxiliaryOrdinaryFiles(
  requests: readonly [
    RetainedCommandAuxiliaryOrdinaryFileRequest,
    ...RetainedCommandAuxiliaryOrdinaryFileRequest[]
  ]
): readonly [RetainedNoFollowOrdinaryFile, ...RetainedNoFollowOrdinaryFile[]] {
  if (requests.length > RETAINED_COMMAND_AUXILIARY_INPUT_LIMIT) {
    throw new Error(
      `Retained command accepts at most ${RETAINED_COMMAND_AUXILIARY_INPUT_LIMIT} auxiliary files`
    );
  }
  const retained: RetainedNoFollowOrdinaryFile[] = [];
  try {
    for (const [index, request] of requests.entries()) {
      retained.push(retainNoFollowOrdinaryFile(
        request.expectedParent,
        request.name,
        request.expectedPhysical,
        request.label ?? `retained command auxiliary file[${index}]`,
        RETAINED_COMMAND_AUXILIARY_DESCRIPTOR_BASE + index
      ));
    }
    return Object.freeze(retained) as readonly [
      RetainedNoFollowOrdinaryFile,
      ...RetainedNoFollowOrdinaryFile[]
    ];
  } catch (error) {
    settlePhysicalResources({
      primary: Object.freeze({
        label: 'retained command auxiliary-file admission',
        error
      }),
      cleanup: retained.reverse().map((capability, index) => Object.freeze({
        label: `retained command auxiliary-file cleanup[${index}]`,
        settle: () => capability.dispose()
      }))
    });
    throw new Error('Unreachable auxiliary-file settlement state.');
  }
}

export type RunRetainedCommandOptions = Omit<
  RunCommandOptions,
  'cwd' | 'maxStderrBytes' | 'maxStdoutBytes' | 'timeoutMs'
> & Readonly<{
  maxStderrBytes: number;
  maxStdoutBytes: number;
  timeoutMs: number;
  terminationDeadlineMs?: number;
  terminationGraceMs?: number;
}>;

export class RetainedCommandTransportError extends Error {
  constructor(
    message: string,
    readonly outcome: ObservedCommandOutcome
  ) {
    super(message);
    this.name = 'RetainedCommandTransportError';
  }
}

export {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from './retained-command-boundary.ts';

export function issueRetainedCommandBoundary(input: Readonly<{
  executable: RetainedCommandExecutable;
  workingDirectory: RetainedCommandWorkingDirectory;
  auxiliaryInputs?: readonly RetainedCommandAuxiliaryInput[];
}>): RetainedCommandBoundary {
  assertRetainedNoFollowCapability(input.executable, 'executable', 'retained command executable');
  assertRetainedNoFollowCapability(
    input.workingDirectory,
    'working-directory',
    'retained command working directory'
  );
  const auxiliaryInputs = Object.freeze([...(input.auxiliaryInputs ?? [])]);
  if (auxiliaryInputs.length > RETAINED_COMMAND_AUXILIARY_INPUT_LIMIT) {
    throw new Error(
      `Retained command accepts at most ${RETAINED_COMMAND_AUXILIARY_INPUT_LIMIT} sealed auxiliary inputs`
    );
  }
  for (const [index, auxiliary] of auxiliaryInputs.entries()) {
    assertRetainedNoFollowCapability(
      auxiliary.capability,
      auxiliary.kind === 'directory' ? 'working-directory' : 'ordinary-file',
      `retained command auxiliary input[${index}]`
    );
  }
  const boundary = issueRetainedCommandBoundaryIdentity({
    executable: input.executable,
    workingDirectory: input.workingDirectory,
    auxiliaryInputs
  });
  retainedCommandSpawnBoundary(boundary);
  return boundary;
}

const ISOLATED_READ_ONLY_ENV_KEYS = [
  'SYSTEMROOT',
  'WINDIR'
] as const;

const ISOLATED_ADDITIONAL_ENV_KEYS = new Set([
  ISOLATED_VERIFICATION_ENV_KEY,
  'BUN_INSTALL_CACHE_DIR',
  'CI',
  'TEST_PORT'
]);

interface IsolatedProcessDirectories {
  readonly appData: string;
  readonly home: string;
  readonly localAppData: string;
  readonly root: string;
  readonly temp: string;
}

function isolatedProcessDirectories(writableRoot: string): IsolatedProcessDirectories {
  const root = path.resolve(writableRoot);
  return {
    root,
    home: path.join(root, 'home'),
    appData: path.join(root, 'appdata'),
    localAppData: path.join(root, 'localappdata'),
    temp: path.join(root, 'tmp')
  };
}

export async function ensureIsolatedProcessDirectories(
  writableRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const directories = isolatedProcessDirectories(writableRoot);
  for (const directory of Object.values(directories)) {
    await commitFence?.();
    await mkdir(directory, { recursive: true });
  }
}

/**
 * Builds the fixed environment boundary used by isolated compiler children.
 * Variables with command-injection or network effects (for example
 * NODE_OPTIONS, BUN_OPTIONS, and proxy settings) are deliberately absent.
 */
export function buildIsolatedProcessEnvironment(
  writableRoot: string,
  additionalEnv: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const directories = isolatedProcessDirectories(writableRoot);
  const env: NodeJS.ProcessEnv = {
    PATH: '',
    HOME: directories.home,
    USERPROFILE: directories.home,
    APPDATA: directories.appData,
    LOCALAPPDATA: directories.localAppData,
    TEMP: directories.temp,
    TMP: directories.temp,
    TMPDIR: directories.temp,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC'
  };
  for (const key of ISOLATED_READ_ONLY_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  for (const [key, value] of Object.entries(additionalEnv)) {
    if (!ISOLATED_ADDITIONAL_ENV_KEYS.has(key)) {
      throw new Error(`Environment key "${key}" is outside the isolated process allowlist`);
    }
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function terminateCommandProcessTree(child: ChildProcess): Promise<void> {
  if (process.platform !== 'win32' || !child.pid) {
    child.kill('SIGTERM');
    return;
  }
  try {
    const windowsRoot = await resolveWindowsKnownFolderPath('windows');
    const taskkill = path.win32.join(windowsRoot, 'System32', 'taskkill.exe');
    await new Promise<void>((resolve) => {
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
        env: {
          SystemRoot: windowsRoot,
          SYSTEMROOT: windowsRoot,
          WINDIR: windowsRoot
        },
        stdio: 'ignore',
        windowsHide: true
      });
      let complete = false;
      const finish = (): void => {
        if (complete) return;
        complete = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        killer.kill('SIGKILL');
        finish();
      }, 5_000);
      killer.once('error', finish);
      killer.once('close', finish);
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

type RunCommandStdio = Array<'ignore' | 'pipe' | number>;

function retainedCommandSpawnBoundary(boundary: RetainedCommandBoundary): Readonly<{
  cwd: string;
  stdio: RunCommandStdio;
}> {
  assertRetainedCommandBoundaryCurrent(boundary);
  const auxiliaryInputs = retainedCommandBoundaryAuxiliaryInputs(boundary);
  const stdio: RunCommandStdio = ['ignore', 'pipe', 'pipe'];
  if (process.platform === 'win32') {
    if (boundary.executable.stdioSourceDescriptor !== null
        || boundary.workingDirectory.stdioSourceDescriptor !== null
        || auxiliaryInputs.some((entry) => entry.capability.stdioSourceDescriptor !== null)
        || !path.isAbsolute(boundary.executable.childPath)
        || !path.isAbsolute(boundary.workingDirectory.childPath)
        || auxiliaryInputs.some((entry) => !path.isAbsolute(entry.capability.childPath))) {
      throw new Error(
        'Retained Windows command requires a writer-excluded absolute executable, a pinned cwd, and no inherited descriptor'
      );
    }
    return Object.freeze({ cwd: boundary.workingDirectory.childPath, stdio });
  }
  if (process.platform !== 'linux') {
    throw new Error(`Retained command process transport is unavailable on ${process.platform}`);
  }
  const parseDescriptor = (
    capability: RetainedCommandExecutable | RetainedCommandWorkingDirectory | RetainedNoFollowOrdinaryFile,
    label: string,
    expectedChildDescriptor?: number
  ): Readonly<{ childDescriptor: number; sourceDescriptor: number }> => {
    const match = /^\/proc\/self\/fd\/([0-9]+)$/.exec(capability.childPath);
    const childDescriptor = match === null ? Number.NaN : Number(match[1]);
    const sourceDescriptor = capability.stdioSourceDescriptor;
    if (!Number.isSafeInteger(childDescriptor) || childDescriptor < 3 || childDescriptor > 64
        || (expectedChildDescriptor !== undefined && childDescriptor !== expectedChildDescriptor)
        || !Number.isSafeInteger(sourceDescriptor) || (sourceDescriptor ?? -1) < 5) {
      throw new Error(expectedChildDescriptor === undefined
        ? `Retained Linux ${label} requires one bounded /proc/self/fd child descriptor and one valid source descriptor`
        : `Retained Linux ${label} requires the fixed /proc/self/fd/${expectedChildDescriptor} `
          + 'child descriptor and one valid source descriptor');
    }
    return Object.freeze({ childDescriptor, sourceDescriptor: sourceDescriptor! });
  };
  const executable = parseDescriptor(
    boundary.executable,
    'executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR
  );
  const workingDirectory = parseDescriptor(
    boundary.workingDirectory,
    'working directory',
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
  );
  const auxiliary = auxiliaryInputs.map((entry, index) => {
    const mapping = parseDescriptor(entry.capability, `auxiliary input[${index}]`);
    if (mapping.childDescriptor < RETAINED_COMMAND_AUXILIARY_DESCRIPTOR_BASE) {
      throw new Error(
        `Retained Linux auxiliary input[${index}] child descriptor must not overlap executable, cwd, or standard streams`
      );
    }
    return mapping;
  });
  const childDescriptors = [
    executable.childDescriptor,
    workingDirectory.childDescriptor,
    ...auxiliary.map(({ childDescriptor }) => childDescriptor)
  ];
  if (new Set(childDescriptors).size !== childDescriptors.length) {
    throw new Error('Retained Linux child descriptor mappings must remain unique');
  }
  const sourceDescriptors = [
    executable.sourceDescriptor,
    workingDirectory.sourceDescriptor,
    ...auxiliary.map(({ sourceDescriptor }) => sourceDescriptor)
  ];
  if (new Set(sourceDescriptors).size !== sourceDescriptors.length) {
    throw new Error('Retained Linux source descriptor mappings must remain unique');
  }
  while (stdio.length <= RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR) stdio.push('ignore');
  stdio[RETAINED_EXECUTABLE_CHILD_DESCRIPTOR] = executable.sourceDescriptor;
  stdio[RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR] = workingDirectory.sourceDescriptor;
  for (const { childDescriptor, sourceDescriptor } of auxiliary) {
    while (stdio.length <= childDescriptor) stdio.push('ignore');
    stdio[childDescriptor] = sourceDescriptor;
  }
  return Object.freeze({
    cwd: `/proc/self/fd/${workingDirectory.sourceDescriptor}`,
    stdio
  });
}

function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions,
  stdoutMode: 'bytes',
  retainedBoundary?: RetainedCommandBoundary
): Promise<ByteCommandResult>;
function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions,
  stdoutMode: 'text',
  retainedBoundary?: RetainedCommandBoundary
): Promise<CommandResult>;
async function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions,
  stdoutMode: 'bytes' | 'text',
  retainedBoundary?: RetainedCommandBoundary
): Promise<CommandResult | ByteCommandResult> {
  for (const [label, limit] of [
    ['maxStdinBytes', options.maxStdinBytes],
    ['maxStderrBytes', options.maxStderrBytes],
    ['maxStdoutBytes', options.maxStdoutBytes]
  ] as const) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
  const commandInput = copyBoundedCommandInput(options.input, options.maxStdinBytes);
  if (options.stallTimeoutMs !== undefined && (
    !Number.isSafeInteger(options.stallTimeoutMs) || options.stallTimeoutMs < 1
    || !Number.isSafeInteger(options.timeoutMs) || (options.timeoutMs ?? 0) < 1
    || options.stallTimeoutMs >= (options.timeoutMs ?? 0)
    || options.admitProgress === undefined
  )) {
    throw new Error(
      'stallTimeoutMs requires a shorter positive semantic-progress deadline and an absolute timeout'
    );
  }
  const inheritedEnv = options.envMode === 'replace' ? {} : process.env;
  const env = Object.fromEntries(
    Object.entries({
      ...inheritedEnv,
      ...options.env
    }).filter(([, value]) => value !== undefined)
  ) as NodeJS.ProcessEnv;

  options.signal?.throwIfAborted();
  await options.beforeSpawn?.();
  options.signal?.throwIfAborted();
  const baseSpawnBoundary = retainedBoundary === undefined
    ? Object.freeze({ cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] as RunCommandStdio })
    : retainedCommandSpawnBoundary(retainedBoundary);
  const spawnBoundary = commandInput === null
    ? baseSpawnBoundary
    : Object.freeze({
        cwd: baseSpawnBoundary.cwd,
        stdio: Object.assign([...baseSpawnBoundary.stdio], { 0: 'pipe' as const })
      });
  if (retainedBoundary !== undefined) assertRetainedCommandBoundaryCurrent(retainedBoundary);
  return new Promise<CommandResult | ByteCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: spawnBoundary.cwd,
      env,
      stdio: spawnBoundary.stdio
    });
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    const childStdin = child.stdin;
    if (childStdout === null || childStderr === null || (commandInput !== null && childStdin === null)) {
      child.kill('SIGKILL');
      reject(new Error('Bounded command transport failed to create its fixed output pipes'));
      return;
    }

    let stdout = '';
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    const stdoutDecoder = stdoutMode === 'text' ? new StringDecoder('utf8') : null;
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBytes = 0;
    let stderrBytes = 0;

    let settled = false;
    let terminating = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let stallTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId);
      if (stallTimeoutId) clearTimeout(stallTimeoutId);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const terminateAndReject = (message: string): void => {
      if (settled || terminating) return;
      terminating = true;
      void terminateCommandProcessTree(child).then(
        () => settleReject(new Error(message)),
        () => settleReject(new Error(message))
      );
    };
    const onAbort = (): void => {
      terminateAndReject(`Command "${command}" was aborted`);
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        terminateAndReject(`Command "${command}" timed out after ${options.timeoutMs}ms`);
      }, options.timeoutMs);
    }

    const armStallTimeout = (): void => {
      if (options.stallTimeoutMs === undefined) return;
      if (stallTimeoutId) clearTimeout(stallTimeoutId);
      stallTimeoutId = setTimeout(() => {
        terminateAndReject(
          `Command "${command}" made no admitted progress for ${options.stallTimeoutMs}ms`
        );
      }, options.stallTimeoutMs);
    };
    const admitProgress = (chunk: Buffer, stream: 'stdout' | 'stderr'): boolean => {
      if (options.admitProgress === undefined) return true;
      try {
        return options.admitProgress(chunk, stream);
      } catch (error) {
        terminateAndReject(
          `Command "${command}" progress admission failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
      }
    };
    armStallTimeout();

    childStdout.on('data', (chunk) => {
      if (settled || terminating) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (admitProgress(bytes, 'stdout')) armStallTimeout();
      if (terminating) return;
      if (options.maxStdoutBytes !== undefined && stdoutBytes + bytes.byteLength > options.maxStdoutBytes) {
        terminateAndReject(`Command "${command}" stdout exceeded ${options.maxStdoutBytes} bytes`);
        return;
      }
      stdoutBytes += bytes.byteLength;
      if (stdoutMode === 'bytes') {
        stdoutChunks.push(bytes);
      } else {
        stdout += stdoutDecoder!.write(bytes);
      }
    });
    childStderr.on('data', (chunk) => {
      if (settled || terminating) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (admitProgress(bytes, 'stderr')) armStallTimeout();
      if (terminating) return;
      if (options.maxStderrBytes !== undefined && stderrBytes + bytes.byteLength > options.maxStderrBytes) {
        terminateAndReject(`Command "${command}" stderr exceeded ${options.maxStderrBytes} bytes`);
        return;
      }
      stderrBytes += bytes.byteLength;
      stderr += stderrDecoder.write(bytes);
    });
    child.on('error', (error) => {
      if (!terminating) settleReject(error);
    });
    childStdin?.on('error', (error) => {
      if (!terminating) terminateAndReject(`Command "${command}" stdin failed: ${error.message}`);
    });
    if (commandInput !== null) childStdin!.end(commandInput);
    child.on('close', (code) => {
      if (settled || terminating) return;
      try {
        if (retainedBoundary !== undefined) assertRetainedCommandBoundaryCurrent(retainedBoundary);
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      settled = true;
      cleanup();
      stderr += stderrDecoder.end();
      if (stdoutMode === 'bytes') {
        resolve({
          code: code ?? 1,
          stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
          stderr
        });
      } else {
        stdout += stdoutDecoder!.end();
        resolve({
          code: code ?? 1,
          stdout,
          stderr
        });
      }
    });
  });
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions
): Promise<CommandResult> {
  return runCommandCapture(command, args, options, 'text');
}

export function runCommandBytes(
  command: string,
  args: string[],
  options: RunCommandOptions
): Promise<ByteCommandResult> {
  return runCommandCapture(command, args, options, 'bytes');
}

export function runRetainedCommand(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  /** Process-owner internal capability; semantic consumers cannot mint it. */
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): Promise<CommandResult> {
  return runRetainedCommandCapture(boundary, args, options, 'text', nativeResourceLedger)
    .then(({ result }) => result);
}

export function runRetainedCommandBytes(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  /** Process-owner internal capability; semantic consumers cannot mint it. */
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): Promise<ByteCommandResult> {
  return runRetainedCommandCapture(boundary, args, options, 'bytes', nativeResourceLedger)
    .then(({ result }) => result);
}

/** Process-owner internal variant that retains the exact native lifecycle observation. */
export function runRetainedCommandObservedBytes(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  /** Process-owner internal capability; semantic consumers cannot mint it. */
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): Promise<ObservedByteCommandResult> {
  return runRetainedCommandCapture(boundary, args, options, 'bytes', nativeResourceLedger);
}

function retainedCommandTransportError(
  command: string,
  outcome: ObservedCommandOutcome,
  cause?: Error
): RetainedCommandTransportError {
  return new RetainedCommandTransportError(
    cause?.message ?? (
      `Retained command "${command}" did not settle successfully: `
      + `${outcome.status}; childClose=${outcome.termination.childCloseObserved}; `
      + `streamsDrained=${outcome.termination.streamsDrained}; `
      + `treeClosed=${outcome.termination.treeClosed}`
    ),
    outcome
  );
}

function runRetainedCommandCapture(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  stdoutMode: 'text',
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): Promise<Readonly<{ result: CommandResult; outcome: ObservedCommandOutcome }>>;
function runRetainedCommandCapture(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  stdoutMode: 'bytes',
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): Promise<ObservedByteCommandResult>;
async function runRetainedCommandCapture(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  stdoutMode: 'bytes' | 'text',
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): Promise<ObservedByteCommandResult | Readonly<{ result: CommandResult; outcome: ObservedCommandOutcome }>> {
  if (options.maxStdinBytes !== undefined
      && (!Number.isSafeInteger(options.maxStdinBytes) || options.maxStdinBytes < 0)) {
    throw new Error('maxStdinBytes must be a non-negative safe integer');
  }
  for (const [label, value, minimum] of [
    ['timeoutMs', options.timeoutMs, 1],
    ['maxStdoutBytes', options.maxStdoutBytes, 0],
    ['maxStderrBytes', options.maxStderrBytes, 0]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
    }
  }
  const commandInput = copyBoundedCommandInput(
    options.input,
    options.maxStdinBytes,
    'retained command stdin'
  );
  if (options.terminationGraceMs !== undefined
      && (!Number.isSafeInteger(options.terminationGraceMs) || options.terminationGraceMs < 1)) {
    throw new Error('terminationGraceMs must be a positive safe integer');
  }
  if (options.terminationDeadlineMs !== undefined
      && (!Number.isSafeInteger(options.terminationDeadlineMs)
        || options.terminationDeadlineMs < (options.terminationGraceMs ?? 1))) {
    throw new Error('terminationDeadlineMs must be a safe integer no shorter than terminationGraceMs');
  }
  if (options.stallTimeoutMs !== undefined && (
    !Number.isSafeInteger(options.stallTimeoutMs) || options.stallTimeoutMs < 1
    || options.stallTimeoutMs >= options.timeoutMs
    || options.admitProgress === undefined
  )) {
    throw new Error(
      'stallTimeoutMs requires a shorter positive semantic-progress deadline and an admission rule'
    );
  }

  const spawnBoundary = retainedCommandSpawnBoundary(boundary);
  const command = boundary.executable.childPath;
  let expectedExecutableDigest: ReturnType<RetainedCommandExecutable['digest']> | undefined;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let boundaryFailure: Error | undefined;
  let observerFailure: Error | undefined;
  let stallFailure: Error | undefined;
  let callerAborted = options.signal?.aborted === true;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const assertBoundary = (): void => {
    try {
      assertRetainedCommandBoundaryCurrent(boundary);
    } catch (error) {
      boundaryFailure = error instanceof Error ? error : new Error(String(error));
      throw boundaryFailure;
    }
  };
  const assertBoundaryAndExecutableBytes = (): void => {
    assertBoundary();
    if (expectedExecutableDigest === undefined) {
      boundaryFailure = new Error(
        `Retained command "${command}" executable digest admission did not complete`
      );
      throw boundaryFailure;
    }
    const current = boundary.executable.digest();
    if (current.size !== expectedExecutableDigest.size
        || current.byteDigest !== expectedExecutableDigest.byteDigest
        || current.contentDigest !== expectedExecutableDigest.contentDigest) {
      boundaryFailure = new Error(
        `Retained command "${command}" executable bytes changed during the process lifecycle`
      );
      throw boundaryFailure;
    }
  };
  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort();
  };
  const armStallTimer = (): void => {
    if (options.stallTimeoutMs === undefined) return;
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stallFailure = new Error(
        `Retained command "${command}" made no admitted progress for ${options.stallTimeoutMs}ms`
      );
      controller.abort();
    }, options.stallTimeoutMs);
  };
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (callerAborted) controller.abort();

  let outcome: ObservedCommandOutcome;
  try {
    outcome = await runObservedCommand(command, args, {
      afterSettlement: async () => assertBoundaryAndExecutableBytes(),
      beforeSpawn: async () => {
        assertBoundary();
        expectedExecutableDigest = boundary.executable.digest();
        await options.beforeSpawn?.();
        assertBoundaryAndExecutableBytes();
        armStallTimer();
      },
      cwd: spawnBoundary.cwd,
      env: options.env,
      envMode: options.envMode,
      ...(commandInput === null ? {} : { input: commandInput, maxStdinBytes: options.maxStdinBytes }),
      maxObservedOutputBytes: Math.max(options.maxStdoutBytes, options.maxStderrBytes),
      nativeResourceLedger,
      onChunk: (stream, byteLength) => {
        if (stream === 'stdout') {
          stdoutBytes += byteLength;
          if (stdoutBytes > options.maxStdoutBytes) {
            observerFailure = new Error(
              `Retained command "${command}" stdout exceeded ${options.maxStdoutBytes} bytes`
            );
          }
        } else {
          stderrBytes += byteLength;
          if (stderrBytes > options.maxStderrBytes) {
            observerFailure = new Error(
              `Retained command "${command}" stderr exceeded ${options.maxStderrBytes} bytes`
            );
          }
        }
        if (observerFailure !== undefined) throw observerFailure;
      },
      onOutput: (stream, chunk) => {
        const bytes = Buffer.from(chunk);
        if (stream === 'stdout') stdoutChunks.push(bytes);
        else stderrChunks.push(bytes);
        if (options.admitProgress === undefined || options.admitProgress(bytes, stream)) {
          armStallTimer();
        }
      },
      signal: controller.signal,
      stdio: spawnBoundary.stdio,
      terminationDeadlineMs: options.terminationDeadlineMs,
      terminationGraceMs: options.terminationGraceMs,
      timeoutMs: options.timeoutMs,
      independentProvider: options.independentProvider,
      whileRunning: async () => {
        assertBoundary();
        await options.whileRunning?.();
        assertBoundary();
      }
    });
  } finally {
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }

  // Native spawn failures can settle before the generic lifecycle installs its
  // post-settlement hook. Recheck once more before the caller may dispose the
  // capabilities; tree-unproven remains dominant in the typed outcome below.
  try {
    assertBoundaryAndExecutableBytes();
  } catch {
    // assertBoundary records the exact physical failure for the typed error.
  }

  const failure = boundaryFailure ?? observerFailure ?? stallFailure ?? (
    callerAborted ? new Error(`Retained command "${command}" was aborted`) : undefined
  );
  if (outcome.status !== 'exited' || !outcome.termination.treeClosed || failure !== undefined) {
    throw retainedCommandTransportError(command, outcome, failure);
  }
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  return stdoutMode === 'bytes'
    ? Object.freeze({
        result: Object.freeze({ code: outcome.exitCode ?? 1, stdout: new Uint8Array(stdout), stderr }),
        outcome
      })
    : Object.freeze({
        result: Object.freeze({ code: outcome.exitCode ?? 1, stdout: stdout.toString('utf8'), stderr }),
        outcome
      });
}
