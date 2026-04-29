import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isNodeScript(candidate: string): boolean {
  return ['.js', '.cjs', '.mjs'].includes(path.extname(candidate).toLowerCase());
}

function npmCliCandidates(): string[] {
  return [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter((candidate): candidate is string => typeof candidate === 'string' && isNodeScript(candidate));
}

export function resolveNpmInvocation(args: string[]): { command: string; args: string[] } {
  const npmCliPath = npmCliCandidates().find((candidate) => existsSync(candidate));
  if (npmCliPath) {
    return {
      command: process.execPath,
      args: [npmCliPath, ...args]
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions
): Promise<CommandResult> {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...options.env
    }).filter(([, value]) => value !== undefined)
  ) as NodeJS.ProcessEnv;

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const onAbort = (): void => {
      child.kill('SIGTERM');
      reject(new Error(`Command "${command}" was aborted`));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command "${command}" timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
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
