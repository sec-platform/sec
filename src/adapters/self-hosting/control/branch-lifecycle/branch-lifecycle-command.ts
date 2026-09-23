import { isolatedGitChildEnvironment } from '../../../providers/git-read/runtime/session.ts';

type ChildProcessResultLike = Readonly<{
  status: number | null;
  stdout: Buffer | string | null | undefined;
  stderr: Buffer | string | null | undefined;
}>;

const BRANCH_LIFECYCLE_GITHUB_CREDENTIAL_ARGS = Object.freeze([
  '-c', 'http.extraHeader=',
  '-c', 'http.https://github.com/.extraheader=',
  '-c', 'credential.helper=',
  '-c', 'credential.helper=!gh auth git-credential'
] as const);

/**
 * Return the one finite GitHub credential configuration prefix used by every
 * hosted branch observation and ref effect. The empty generic and canonical
 * github.com extraHeader values remove actions/checkout's persisted HTTP
 * authorization before the explicit gh credential helper is selected.
 */
export function createBranchLifecycleGitHubCredentialArgs(): readonly string[] {
  return BRANCH_LIFECYCLE_GITHUB_CREDENTIAL_ARGS;
}

export interface BranchLifecycleGitHubRemoteObservation {
  readonly repositoryUrl: string;
  readonly argumentsPrefix: readonly string[];
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}

/**
 * Bind a GitHub remote observation to repository identity, not a mutable local
 * remote name. The explicit null Git directory prevents local repository
 * discovery; null global/system config prevents ambient url.insteadOf,
 * include, credential, or transport policy from redirecting the read.
 */
export function createBranchLifecycleGitHubRemoteObservation(
  repository: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform
): BranchLifecycleGitHubRemoteObservation {
  if (repository.length > 201
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(repository)
    || repository.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('GitHub repository must be a bounded owner/name identity.');
  }
  const nullConfigPath = platform === 'win32' ? 'NUL' : '/dev/null';
  const isolatedEnvironment = createBranchLifecycleGitChildEnvironment(environment);
  isolatedEnvironment.GIT_CONFIG_NOSYSTEM = '1';
  isolatedEnvironment.GIT_CONFIG_GLOBAL = nullConfigPath;
  isolatedEnvironment.GIT_CONFIG_SYSTEM = nullConfigPath;
  return Object.freeze({
    repositoryUrl: `https://github.com/${repository}.git`,
    argumentsPrefix: Object.freeze([
      `--git-dir=${nullConfigPath}`,
      ...BRANCH_LIFECYCLE_GITHUB_CREDENTIAL_ARGS
    ]),
    environment: Object.freeze(isolatedEnvironment)
  });
}

/** Historical Branch Lifecycle API; mechanics are shared Git authority. */
export function createBranchLifecycleGitChildEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>
): NodeJS.ProcessEnv {
  return isolatedGitChildEnvironment({ ...environment });
}

export function decodeBranchLifecycleChildStdout(result: ChildProcessResultLike): string {
  return Buffer.isBuffer(result.stdout)
    ? result.stdout.toString('utf8').trim()
    : String(result.stdout ?? '').trim();
}

export function decodeBranchLifecycleChildError(result: ChildProcessResultLike): string {
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString('utf8').trim()
    : String(result.stderr ?? '').trim();
  return stderr || `exit ${result.status ?? 'unknown'}`;
}
