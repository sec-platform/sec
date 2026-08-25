import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { CommitFence } from './fs.ts';

export const ISOLATED_VERIFICATION_ENV_KEY = 'SEC_ISOLATED_VERIFICATION' as const;

export function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
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

/**
 * The only synchronous process boundary used by semantic observers.
 *
 * Synchronous callers are deliberately kept at this transport edge.  They
 * receive bytes, status, and a start error only; command meaning, argument
 * construction, and fail-closed interpretation belong to the semantic owner
 * above this module.
 */
export interface SyncCommandResult {
  readonly code: number;
  readonly status: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly error?: Error;
}

export interface RunCommandSyncOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly envMode?: 'inherit' | 'replace';
  readonly input?: Uint8Array;
  readonly maxBuffer?: number;
}

export interface RunCommandOptions {
  admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
  beforeSpawn?: CommitFence;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  envMode?: 'inherit' | 'replace';
  maxStderrBytes?: number;
  maxStdoutBytes?: number;
  onOutput?: (chunk: Buffer, stream: 'stdout' | 'stderr') => void;
  retainOutput?: boolean;
  /** Total bounded wait for descendant/process-group termination and close readback. */
  processTreeSettlementTimeoutMs?: number;
  stallTimeoutMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type CommandTerminationReasonV1 =
  | 'aborted'
  | 'absolute-timeout'
  | 'stall-timeout'
  | 'output-limit'
  | 'observer-failure';

/** Machine-readable process-tree settlement failure; presentation text is not control flow. */
export class CommandTerminationErrorV1 extends Error {
  readonly reason: CommandTerminationReasonV1;

  constructor(reason: CommandTerminationReasonV1, message: string) {
    super(message);
    this.name = 'CommandTerminationErrorV1';
    this.reason = reason;
  }
}

const ISOLATED_READ_ONLY_ENV_KEYS = [
  'SYSTEMROOT',
  'WINDIR'
] as const;

const ISOLATED_ADDITIONAL_ENV_KEYS = new Set([
  ISOLATED_VERIFICATION_ENV_KEY,
  'BUN_INSTALL_CACHE_DIR',
  'CI',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  'TEST_PORT'
]);

function boundedMaxBuffer(value: number | undefined): number {
  const maxBuffer = value ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 0) {
    throw new Error('maxBuffer must be a non-negative safe integer');
  }
  return maxBuffer;
}

function commandEnvironment(
  options: Readonly<{ env?: NodeJS.ProcessEnv; envMode?: 'inherit' | 'replace' }>
): NodeJS.ProcessEnv {
  const inheritedEnv = options.envMode === 'replace' ? {} : process.env;
  return Object.fromEntries(
    Object.entries({ ...inheritedEnv, ...options.env })
      .filter(([, value]) => value !== undefined)
  ) as NodeJS.ProcessEnv;
}

export function runCommandSync(
  command: string,
  args: readonly string[],
  options: RunCommandSyncOptions
): SyncCommandResult {
  if (command.length === 0 || command.includes('\0')) {
    throw new Error('Synchronous command executable must be non-empty and NUL-free');
  }
  if (args.some((argument) => argument.includes('\0'))) {
    throw new Error('Synchronous command arguments must be NUL-free');
  }
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'buffer',
    env: commandEnvironment(options),
    input: options.input === undefined ? undefined : Buffer.from(options.input),
    maxBuffer: boundedMaxBuffer(options.maxBuffer),
    windowsHide: true
  });
  return Object.freeze({
    code: result.status ?? 1,
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout)
      ? new Uint8Array(result.stdout)
      : new TextEncoder().encode(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? new Uint8Array(result.stderr)
      : new TextEncoder().encode(String(result.stderr ?? '')),
    ...(result.error === undefined ? {} : { error: result.error })
  });
}

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

function waitForCommandProcessClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(closed);
    };
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', onClose);
  });
}

async function terminateCommandProcessTree(child: ChildProcess, settlementTimeoutMs: number): Promise<void> {
  const firstStageTimeoutMs = Math.max(1, Math.floor(settlementTimeoutMs / 2));
  const finalStageTimeoutMs = Math.max(1, settlementTimeoutMs - firstStageTimeoutMs);
  if (!child.pid) {
    child.kill('SIGTERM');
    if (!await waitForCommandProcessClose(child, settlementTimeoutMs)) {
      throw new Error('Command process did not settle after direct termination.');
    }
    return;
  }
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    if (await waitForCommandProcessClose(child, firstStageTimeoutMs)) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    if (!await waitForCommandProcessClose(child, finalStageTimeoutMs)) {
      throw new Error('Command process group did not settle after SIGKILL.');
    }
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
    }, firstStageTimeoutMs);
    killer.once('error', finish);
    killer.once('close', finish);
  });
  if (!await waitForCommandProcessClose(child, finalStageTimeoutMs)) {
    throw new Error('Windows command process tree did not settle after taskkill.');
  }
}

function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions,
  stdoutMode: 'bytes'
): Promise<ByteCommandResult>;
function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions,
  stdoutMode: 'text'
): Promise<CommandResult>;
async function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions,
  stdoutMode: 'bytes' | 'text'
): Promise<CommandResult | ByteCommandResult> {
  for (const [label, limit] of [
    ['maxStderrBytes', options.maxStderrBytes],
    ['maxStdoutBytes', options.maxStdoutBytes]
  ] as const) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
  const processTreeSettlementTimeoutMs = options.processTreeSettlementTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(processTreeSettlementTimeoutMs) || processTreeSettlementTimeoutMs < 1
      || processTreeSettlementTimeoutMs > 10 * 60_000) {
    throw new Error('processTreeSettlementTimeoutMs must be a positive bounded safe integer');
  }
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
  const env = commandEnvironment(options);

  options.signal?.throwIfAborted();
  await options.beforeSpawn?.();
  options.signal?.throwIfAborted();
  return new Promise<CommandResult | ByteCommandResult>((resolve, reject) => {
    const retainOutput = options.retainOutput ?? true;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    const stdoutDecoder = stdoutMode === 'text' && retainOutput ? new StringDecoder('utf8') : null;
    const stderrDecoder = retainOutput ? new StringDecoder('utf8') : null;
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
    const terminateAndReject = (reason: CommandTerminationReasonV1, message: string): void => {
      if (settled || terminating) return;
      terminating = true;
      void terminateCommandProcessTree(child, processTreeSettlementTimeoutMs).then(
        () => settleReject(new CommandTerminationErrorV1(reason, message)),
        () => settleReject(new CommandTerminationErrorV1(reason, message))
      );
    };
    const onAbort = (): void => {
      terminateAndReject('aborted', `Command "${command}" was aborted`);
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        terminateAndReject('absolute-timeout', `Command "${command}" timed out after ${options.timeoutMs}ms`);
      }, options.timeoutMs);
    }

    const armStallTimeout = (): void => {
      if (options.stallTimeoutMs === undefined) return;
      if (stallTimeoutId) clearTimeout(stallTimeoutId);
      stallTimeoutId = setTimeout(() => {
        terminateAndReject(
          'stall-timeout',
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
          'observer-failure',
          `Command "${command}" progress admission failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
      }
    };
    const emitOutput = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      try {
        options.onOutput?.(chunk, stream);
      } catch (error) {
        terminateAndReject(
          'observer-failure',
          `Command "${command}" output observation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };
    armStallTimeout();

    child.stdout.on('data', (chunk) => {
      if (settled || terminating) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (admitProgress(bytes, 'stdout')) armStallTimeout();
      if (terminating) return;
      if (options.maxStdoutBytes !== undefined && stdoutBytes + bytes.byteLength > options.maxStdoutBytes) {
        terminateAndReject('output-limit', `Command "${command}" stdout exceeded ${options.maxStdoutBytes} bytes`);
        return;
      }
      emitOutput(bytes, 'stdout');
      if (terminating) return;
      stdoutBytes += bytes.byteLength;
      if (!retainOutput) return;
      if (stdoutMode === 'bytes') {
        stdoutChunks.push(bytes);
      } else {
        stdout += stdoutDecoder!.write(bytes);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (settled || terminating) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (admitProgress(bytes, 'stderr')) armStallTimeout();
      if (terminating) return;
      if (options.maxStderrBytes !== undefined && stderrBytes + bytes.byteLength > options.maxStderrBytes) {
        terminateAndReject('output-limit', `Command "${command}" stderr exceeded ${options.maxStderrBytes} bytes`);
        return;
      }
      emitOutput(bytes, 'stderr');
      if (terminating) return;
      stderrBytes += bytes.byteLength;
      if (retainOutput) stderr += stderrDecoder!.write(bytes);
    });
    child.on('error', (error) => {
      if (!terminating) settleReject(error);
    });
    child.on('close', (code) => {
      if (settled || terminating) return;
      settled = true;
      cleanup();
      if (retainOutput) stderr += stderrDecoder!.end();
      if (stdoutMode === 'bytes') {
        resolve({
          code: code ?? 1,
          stdout: retainOutput ? new Uint8Array(Buffer.concat(stdoutChunks)) : new Uint8Array(),
          stderr
        });
      } else {
        if (retainOutput) stdout += stdoutDecoder!.end();
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
