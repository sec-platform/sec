import { spawnSync } from 'node:child_process';

import {
  createBranchLifecycleGitChildEnvironmentV1,
  decodeBranchLifecycleChildErrorV1,
  decodeBranchLifecycleChildStdoutV1
} from './branch-lifecycle-command.ts';
import {
  assertGitBranchName,
  type BranchPruneConfigurationObservation
} from './branch-lifecycle-contract.ts';

const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

function runConfigGit(repositoryRoot: string, args: readonly string[]) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Clone configuration argument contains NUL.');
  }
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    env: createBranchLifecycleGitChildEnvironmentV1(process.env)
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  };
}

function requireConfigGitText(
  repositoryRoot: string,
  args: readonly string[],
  label: string
): string {
  const result = runConfigGit(repositoryRoot, args);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return decodeBranchLifecycleChildStdoutV1(result);
}

function readBooleanConfig(
  repositoryRoot: string,
  key: string
): boolean | null {
  const result = runConfigGit(repositoryRoot, ['config', '--local', '--bool', '--get', key]);
  if (result.status !== 0) return null;
  const value = decodeBranchLifecycleChildStdoutV1(result).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function configureBranchLifecycleClone(
  input: Readonly<{ repositoryRoot: string; remote?: string }>
): BranchPruneConfigurationObservation {
  const repositoryRoot = requireConfigGitText(
    input.repositoryRoot,
    ['rev-parse', '--show-toplevel'],
    'repository root discovery'
  );
  const remote = input.remote ?? 'origin';
  assertGitBranchName(remote, 'remote name');
  const keys = [
    'fetch.prune',
    `remote.${remote}.prune`,
    'fetch.pruneTags'
  ] as const;

  for (const key of keys) {
    const result = runConfigGit(repositoryRoot, ['config', '--local', key, 'true']);
    if (result.status !== 0) {
      throw new Error(`git config ${key} failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
    }
  }

  const observation: BranchPruneConfigurationObservation = {
    observation: 'resolved',
    fetchPrune: readBooleanConfig(repositoryRoot, 'fetch.prune'),
    remotePrune: readBooleanConfig(repositoryRoot, `remote.${remote}.prune`),
    fetchPruneTags: readBooleanConfig(repositoryRoot, 'fetch.pruneTags'),
    reason: null
  };
  if (
    observation.fetchPrune !== true
    || observation.remotePrune !== true
    || observation.fetchPruneTags !== true
  ) {
    throw new Error('Clone prune configuration readback did not match the requested true values.');
  }
  return observation;
}
