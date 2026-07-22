import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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

export interface RunCommandOptions {
  beforeSpawn?: CommitFence;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  envMode?: 'inherit' | 'replace';
  timeoutMs?: number;
  signal?: AbortSignal;
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
  return new Promise<CommandResult | ByteCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    const stdoutChunks: Buffer[] = [];
    let stderr = '';

    let settled = false;
    let terminating = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId);
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

    child.stdout.on('data', (chunk) => {
      if (stdoutMode === 'bytes') {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      } else {
        stdout += String(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (!terminating) settleReject(error);
    });
    child.on('close', (code) => {
      if (settled || terminating) return;
      settled = true;
      cleanup();
      if (stdoutMode === 'bytes') {
        resolve({
          code: code ?? 1,
          stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
          stderr
        });
      } else {
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
