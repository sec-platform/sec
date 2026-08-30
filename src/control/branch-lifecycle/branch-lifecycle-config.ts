import { runCommandBytes } from '../../runtime-state/physical/runtime/process.ts';

import {
  createBranchLifecycleGitChildEnvironment,
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from './branch-lifecycle-command.ts';
import {
  assertGitBranchName,
  type BranchPruneConfigurationObservation
} from './branch-lifecycle-contract.ts';

const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

async function runConfigGit(repositoryRoot: string, args: readonly string[]) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Clone configuration argument contains NUL.');
  }
  const result = await runCommandBytes('git', [...args], {
    cwd: repositoryRoot,
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxStdoutBytes: COMMAND_MAX_BUFFER,
    maxStderrBytes: 512 * 1024,
    env: createBranchLifecycleGitChildEnvironment(process.env),
    envMode: 'replace'
  });
  return {
    status: result.code,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr)
  };
}

async function requireConfigGitText(
  repositoryRoot: string,
  args: readonly string[],
  label: string
): Promise<string> {
  const result = await runConfigGit(repositoryRoot, args);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
}

async function readBooleanConfig(
  repositoryRoot: string,
  key: string
): Promise<boolean | null> {
  const result = await runConfigGit(repositoryRoot, ['config', '--local', '--bool', '--get', key]);
  if (result.status !== 0) return null;
  const value = decodeBranchLifecycleChildStdout(result).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export async function configureBranchLifecycleClone(
  input: Readonly<{ repositoryRoot: string; remote?: string }>
): Promise<BranchPruneConfigurationObservation> {
  const repositoryRoot = await requireConfigGitText(
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
    const result = await runConfigGit(repositoryRoot, ['config', '--local', key, 'true']);
    if (result.status !== 0) {
      throw new Error(`git config ${key} failed: ${decodeBranchLifecycleChildError(result)}`);
    }
  }

  const observation: BranchPruneConfigurationObservation = {
    observation: 'resolved',
    fetchPrune: await readBooleanConfig(repositoryRoot, 'fetch.prune'),
    remotePrune: await readBooleanConfig(repositoryRoot, `remote.${remote}.prune`),
    fetchPruneTags: await readBooleanConfig(repositoryRoot, 'fetch.pruneTags'),
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
