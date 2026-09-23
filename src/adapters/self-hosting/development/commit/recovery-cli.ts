import path from 'node:path';

import { withGitHubApiReadSession } from '../../../providers/github-api/operation-session.ts';
import {
  acknowledgeDevelopmentCommitResult,
  acknowledgeNotAppliedDevelopmentCommitResult,
  recoverDevelopmentCommit,
  retireMergedDevelopmentCommitJournals
} from './operation.ts';

/** CLI recovery consumer; journal reference is observation-only. */
export async function runDevelopmentCommitRecoveryCommand(args: readonly string[]): Promise<number> {
  if (args.length === 3 && args[0] === '--retire-merged-pr' && /^[1-9][0-9]*$/u.test(args[2]!)) {
    const result = await withGitHubApiReadSession({
      repositoryRoot: path.resolve(process.cwd()), repository: args[1]!,
      operation: (capability) => retireMergedDevelopmentCommitJournals({
        repositoryRoot: path.resolve(process.cwd()), capability, pullRequestNumber: Number(args[2])
      })
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (args.length !== 1 || !path.isAbsolute(args[0]!)) {
    throw new Error('development commit recovery requires one absolute journal path.');
  }
  const recovery = await recoverDevelopmentCommit({
    repositoryRoot: path.resolve(process.cwd()),
    journalPath: path.resolve(args[0]!)
  });
  console.log(JSON.stringify(recovery.result, null, 2));
  if (recovery.result.disposition === 'applied') acknowledgeDevelopmentCommitResult(recovery.result);
  if (recovery.result.disposition === 'not-applied') {
    await acknowledgeNotAppliedDevelopmentCommitResult(recovery.result);
  }
  return recovery.result.disposition === 'unknown' ? 1 : 0;
}
