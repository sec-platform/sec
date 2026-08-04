import {
  assertGitBranchName,
  type BranchPruneConfigurationObservation
} from './branch-lifecycle-contract.ts';
import {
  commandErrorText,
  commandText,
  requireBranchCommandText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';

function readBooleanConfig(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  key: string
): boolean | null {
  const result = runBranchCommand(
    ctx,
    'git',
    ['config', '--local', '--bool', '--get', key],
    repositoryRoot
  );
  if (result.status !== 0) return null;
  const value = commandText(result).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function configureBranchLifecycleClone(
  ctx: BranchLifecycleContext
): BranchPruneConfigurationObservation {
  const repositoryRoot = requireBranchCommandText(
    ctx,
    'git',
    ['rev-parse', '--show-toplevel'],
    'repository root discovery'
  );
  const remote = ctx.remote ?? 'origin';
  assertGitBranchName(remote, 'remote name');
  const keys = [
    'fetch.prune',
    `remote.${remote}.prune`,
    'fetch.pruneTags'
  ] as const;

  for (const key of keys) {
    const result = runBranchCommand(
      ctx,
      'git',
      ['config', '--local', key, 'true'],
      repositoryRoot
    );
    if (result.status !== 0) {
      throw new Error(`git config ${key} failed: ${commandErrorText(result)}`);
    }
  }

  const observation: BranchPruneConfigurationObservation = {
    observation: 'resolved',
    fetchPrune: readBooleanConfig(ctx, repositoryRoot, 'fetch.prune'),
    remotePrune: readBooleanConfig(ctx, repositoryRoot, `remote.${remote}.prune`),
    fetchPruneTags: readBooleanConfig(ctx, repositoryRoot, 'fetch.pruneTags'),
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
