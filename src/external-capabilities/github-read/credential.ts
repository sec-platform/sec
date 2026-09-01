import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary,
  resolveExecutableLocator,
  runRetainedCommandBytes
} from '../../runtime-state/physical/runtime/process.ts';
import { GITHUB_HOST } from './contract.ts';

const MAX_CREDENTIAL_LIFETIME_MS = 30_000;
const MAX_TOKEN_BYTES = 4_096;
const MAX_ERROR_BYTES = 8_192;

export class GitHubCredentialUnavailableError extends Error {
  readonly code = 'github-credential-unavailable' as const;

  constructor(readonly reason: 'admission' | 'deadline' | 'transport' | 'token') {
    super(`GitHub credential provider is unavailable (${reason})`);
    this.name = 'GitHubCredentialUnavailableError';
  }
}

export type GitHubCredentialInput = Readonly<{
  cwd: string;
  hostname: typeof GITHUB_HOST;
  deadlineAtUnixMs: number;
}>;

function environmentValue(source: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const actual = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actual === undefined ? undefined : source[actual];
}

/** The credential child never inherits PATH, token, host, config, HOME or XDG selectors. */
function githubCredentialEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GH_PROMPT_DISABLED: '1',
    NO_COLOR: '1'
  };
  for (const key of ['SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'] as const) {
    const value = environmentValue(source, key);
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function tokenBytes(stdout: Uint8Array): Uint8Array {
  let start = 0;
  let end = stdout.byteLength;
  while (start < end && stdout[start]! <= 0x20) start += 1;
  while (end > start && stdout[end - 1]! <= 0x20) end -= 1;
  if (end === start || end - start > MAX_TOKEN_BYTES) {
    throw new GitHubCredentialUnavailableError('token');
  }
  const token = stdout.slice(start, end);
  if (token.some((byte) => byte < 0x21 || byte > 0x7e)) {
    token.fill(0);
    throw new GitHubCredentialUnavailableError('token');
  }
  return token;
}

export async function readGitHubToken(input: GitHubCredentialInput): Promise<Uint8Array> {
  const startedAt = Date.now();
  if (input.hostname !== GITHUB_HOST
      || !path.isAbsolute(input.cwd) || path.resolve(input.cwd) !== input.cwd
      || !Number.isSafeInteger(input.deadlineAtUnixMs)) {
    throw new GitHubCredentialUnavailableError('admission');
  }
  const deadlineAt = Math.min(input.deadlineAtUnixMs, startedAt + MAX_CREDENTIAL_LIFETIME_MS);
  const deadlineMonotonicAt = performance.now() + Math.max(0, deadlineAt - startedAt);
  const remainingMs = (): number => Math.min(
    deadlineAt - Date.now(),
    Math.floor(deadlineMonotonicAt - performance.now())
  );
  if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');

  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let workingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  try {
    const locator = resolveExecutableLocator('gh', {
      cwd: input.cwd,
      pathValue: environmentValue(process.env, 'PATH') ?? ''
    });
    if (locator === null || !path.isAbsolute(locator) || path.basename(locator).toLowerCase() !== 'gh.exe') {
      throw new GitHubCredentialUnavailableError('admission');
    }
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(locator), 'GitHub CLI executable parent'),
      path.basename(locator),
      undefined,
      'GitHub CLI executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(input.cwd, 'GitHub credential working directory'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'GitHub credential working directory'
    );
    if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
    let result;
    try {
      result = await runRetainedCommandBytes(boundary, ['auth', 'token', '--hostname', GITHUB_HOST], {
        env: githubCredentialEnvironment(process.env),
        envMode: 'replace',
        maxStderrBytes: MAX_ERROR_BYTES,
        maxStdoutBytes: MAX_TOKEN_BYTES,
        timeoutMs: remainingMs()
      });
    } catch {
      throw new GitHubCredentialUnavailableError(
        remainingMs() < 1 ? 'deadline' : 'transport'
      );
    }
    try {
      if (result.code !== 0 || remainingMs() < 1) {
        throw new GitHubCredentialUnavailableError(remainingMs() < 1 ? 'deadline' : 'transport');
      }
      return tokenBytes(result.stdout);
    } finally {
      result.stdout.fill(0);
    }
  } catch (error) {
    if (error instanceof GitHubCredentialUnavailableError) throw error;
    throw new GitHubCredentialUnavailableError('admission');
  } finally {
    try { workingDirectory?.dispose(); } catch { /* primary result is already settled */ }
    try { executable?.dispose(); } catch { /* primary result is already settled */ }
  }
}
