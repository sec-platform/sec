import { runCommandSync } from '../shared/process.ts';

import { isolatedGitReadEnvironment } from './read-environment.ts';

export type GitReadTransportResult = Readonly<{
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly error: Error | undefined;
}>;

export function runGitReadTransport(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{
    input?: Buffer;
    maxBuffer?: number;
    environmentOverrides?: Readonly<Record<string, string>>;
  }> = {}
): GitReadTransportResult {
  const result = runCommandSync('git', args, {
    cwd: repositoryRoot,
    input: options.input,
    maxBuffer: options.maxBuffer,
    env: isolatedGitReadEnvironment(options.environmentOverrides),
    envMode: 'replace'
  });
  return Object.freeze({
    status: result.status,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr),
    error: result.error
  });
}

export function readGitTransportBytes(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{
    input?: Buffer;
    maxBuffer?: number;
    label?: string;
    environmentOverrides?: Readonly<Record<string, string>>;
  }> = {}
): Buffer {
  const result = runGitReadTransport(repositoryRoot, args, options);
  if (result.error || result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    const label = options.label ?? `git ${args[0] ?? 'command'}`;
    throw new Error(`${label} failed${stderr ? `: ${stderr}` : ''}`, {
      cause: result.error
    });
  }
  return result.stdout;
}

export function readGitTransportText(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{
    input?: Buffer;
    maxBuffer?: number;
    label?: string;
  }> = {}
): string {
  const bytes = readGitTransportBytes(repositoryRoot, args, options);
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) {
    throw new Error(`${options.label ?? 'Git output'} returned non-UTF-8 bytes`);
  }
  return value;
}
