import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
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
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }
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

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}
