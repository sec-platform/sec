import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { CommitFence } from '../contract/commit-fence.ts';
import {
  copyBoundedCommandInput,
  runObservedCommand,
  type ObservedCommandOutcome
} from './observed-process.ts';
import {
  assertRetainedNoFollowCapability,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from './physical-no-follow.ts';

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

export interface RunCommandOptions {
  admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
  beforeSpawn?: CommitFence;
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
}

/**
 * Caller-owned, already-retained command boundaries. This transport accepts
 * only the capabilities' child-facing paths; it does not expose a general
 * stdio table or grant authority to open a path. The caller remains
 * responsible for disposing both underlying capabilities after settlement.
 */
export type RetainedCommandExecutable = RetainedNoFollowOrdinaryFile;

export type RetainedCommandWorkingDirectory = RetainedNoFollowChildProcessDirectory;

export interface RetainedCommandBoundary {
  readonly executable: RetainedCommandExecutable;
  readonly workingDirectory: RetainedCommandWorkingDirectory;
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
    this.name = 'RetainedCommandTransportErrorV1';
  }
}

export const RETAINED_EXECUTABLE_CHILD_DESCRIPTOR = 3 as const;
export const RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR = 4 as const;

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

export interface IsolatedProcessDirectories {
  readonly appData: string;
  readonly home: string;
  readonly localAppData: string;
  readonly root: string;
  readonly temp: string;
}

export function isolatedProcessDirectories(writableRoot: string): IsolatedProcessDirectories {
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
  const configuredRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? String.raw`C:\Windows`;
  const systemRoot = path.isAbsolute(configuredRoot) ? configuredRoot : String.raw`C:\Windows`;
  const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
  await new Promise<void>((resolve) => {
    const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      env: {
        SystemRoot: systemRoot,
        SYSTEMROOT: systemRoot,
        WINDIR: systemRoot
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
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

type RunCommandStdio = Array<'ignore' | 'pipe' | number>;

function retainedCommandSpawnBoundary(boundary: RetainedCommandBoundary): Readonly<{
  cwd: string;
  stdio: RunCommandStdio;
}> {
  assertRetainedNoFollowCapability(
    boundary.executable,
    'executable',
    'retained command executable'
  );
  assertRetainedNoFollowCapability(
    boundary.workingDirectory,
    'working-directory',
    'retained command working directory'
  );
  const stdio: RunCommandStdio = ['ignore', 'pipe', 'pipe'];
  if (process.platform === 'win32') {
    if (boundary.executable.stdioSourceDescriptor !== null
        || boundary.workingDirectory.stdioSourceDescriptor !== null
        || !path.isAbsolute(boundary.executable.childPath)
        || !path.isAbsolute(boundary.workingDirectory.childPath)) {
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
    capability: RetainedCommandExecutable | RetainedCommandWorkingDirectory,
    expectedChildDescriptor: number,
    label: string
  ): number => {
    const match = /^\/proc\/self\/fd\/([0-9]+)$/.exec(capability.childPath);
    const childDescriptor = match === null ? Number.NaN : Number(match[1]);
    const sourceDescriptor = capability.stdioSourceDescriptor;
    if (childDescriptor !== expectedChildDescriptor
        || !Number.isSafeInteger(sourceDescriptor) || (sourceDescriptor ?? -1) < 5) {
      throw new Error(
        `Retained Linux ${label} requires the fixed /proc/self/fd/${expectedChildDescriptor} `
        + 'child descriptor and one valid source descriptor'
      );
    }
    return sourceDescriptor!;
  };
  const executableSource = parseDescriptor(
    boundary.executable,
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const workingDirectorySource = parseDescriptor(
    boundary.workingDirectory,
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'working directory'
  );
  if (executableSource === workingDirectorySource
      || executableSource === RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
      || workingDirectorySource === RETAINED_EXECUTABLE_CHILD_DESCRIPTOR) {
    throw new Error(
      'Retained Linux executable and working-directory descriptor mappings must remain disjoint'
    );
  }
  while (stdio.length <= RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR) stdio.push('ignore');
  stdio[RETAINED_EXECUTABLE_CHILD_DESCRIPTOR] = executableSource;
  stdio[RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR] = workingDirectorySource;
  return Object.freeze({
    cwd: boundary.workingDirectory.childPath,
    stdio
  });
}

function assertRetainedCommandBoundaryCurrent(boundary: RetainedCommandBoundary): void {
  assertRetainedNoFollowCapability(
    boundary.executable,
    'executable',
    'retained command executable'
  );
  assertRetainedNoFollowCapability(
    boundary.workingDirectory,
    'working-directory',
    'retained command working directory'
  );
  boundary.executable.assertCurrent();
  boundary.workingDirectory.assertCurrent();
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
  options: RunRetainedCommandOptions
): Promise<CommandResult> {
  return runRetainedCommandCaptureV1(boundary, args, options, 'text');
}

export function runRetainedCommandBytes(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions
): Promise<ByteCommandResult> {
  return runRetainedCommandCaptureV1(boundary, args, options, 'bytes');
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

function runRetainedCommandCaptureV1(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  stdoutMode: 'text'
): Promise<CommandResult>;
function runRetainedCommandCaptureV1(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  stdoutMode: 'bytes'
): Promise<ByteCommandResult>;
async function runRetainedCommandCaptureV1(
  boundary: RetainedCommandBoundary,
  args: string[],
  options: RunRetainedCommandOptions,
  stdoutMode: 'bytes' | 'text'
): Promise<ByteCommandResult | CommandResult> {
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
      whileRunning: async () => assertBoundary()
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
    ? { code: outcome.exitCode ?? 1, stdout: new Uint8Array(stdout), stderr }
    : { code: outcome.exitCode ?? 1, stdout: stdout.toString('utf8'), stderr };
}

export async function runCommandWithRetry(
  command: string,
  args: string[],
  options: RunCommandOptions & { maxRetries?: number; retryDelayMs?: number }
): Promise<CommandResult> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  let lastResult: CommandResult | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await runCommand(command, args, options);
      if (result.code === 0) {
        return result;
      }
      lastResult = result;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return lastResult!;
}
