import { sha256 } from '../../../../contracts/canonical.ts';
import {
  inspectGitHubApiCapability,
  withGitHubApiBranchCloseoutWriteSession,
  withGitHubApiIssueCommentWriteSession
} from '../../../providers/github-api/operation-session.ts';
import { executeProductionClosedUnmergedRetirement } from '../branch-lifecycle/closed-unmerged-closeout-production.ts';
import { retireExactRemoteRefs } from '../branch-lifecycle/exact-ref-retirement.ts';
import { retireExactClosedIssueComments } from './comment-retirement.ts';
import type { MaintenanceOperation } from './contract.ts';

export async function preflightRepositoryMaintenanceEffects(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): Promise<void> {
  // Transport never chooses a permission. The effect provider proves both
  // bounded capabilities before any operation can mutate repository state.
  await withGitHubApiBranchCloseoutWriteSession({
    repositoryRoot: input.repositoryRoot, repository: input.repository,
    operation: async (capability) => {
      const observed = inspectGitHubApiCapability(capability);
      if (observed.repository !== input.repository
          || observed.effect !== 'branch-closeout-write'
          || observed.origin !== 'production') {
        throw new Error('repository maintenance branch capability preflight is invalid');
      }
    }
  });
  await withGitHubApiIssueCommentWriteSession({
    repositoryRoot: input.repositoryRoot, repository: input.repository,
    operation: async (capability) => {
      const observed = inspectGitHubApiCapability(capability);
      if (observed.repository !== input.repository
          || observed.effect !== 'issue-comment-write'
          || observed.origin !== 'production') {
        throw new Error('repository maintenance comment capability preflight is invalid');
      }
    }
  });
}

export async function executeRepositoryMaintenanceEffect(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: MaintenanceOperation;
  recoveryRoot?: string;
}>): Promise<unknown> {
  const operation = input.operation;
  if (operation.kind === 'exact-ref-retirement') {
    const retired = await retireExactRemoteRefs({
      repositoryRoot: input.repositoryRoot, repository: input.repository,
      retirement: operation.retirement, recoveryRoot: input.recoveryRoot
    });
    return Object.freeze({ kind: operation.kind, ...retired });
  }
  if (operation.kind === 'closed-pr-retirement') {
    const result = await executeProductionClosedUnmergedRetirement({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      pullRequestNumber: operation.pullRequestNumber,
      reviewCommentId: operation.reviewCommentId
    });
    if (result.status !== 'completed') {
      throw new Error(`closed PR ${operation.pullRequestNumber} retirement did not complete`);
    }
    return Object.freeze({
      kind: operation.kind, pullRequestNumber: operation.pullRequestNumber, status: 'completed',
      receiptDigest: sha256(result)
    });
  }
  const retired = await retireExactClosedIssueComments({
    repositoryRoot: input.repositoryRoot, repository: input.repository,
    issueNumber: operation.issueNumber, comments: operation.comments
  });
  return Object.freeze({ kind: operation.kind, issueNumber: operation.issueNumber, ...retired });
}
