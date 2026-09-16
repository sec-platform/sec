import path from 'node:path';

import { issueDevelopmentCommitAdmission } from '../commit-admission/operation.ts';
import { acknowledgeDevelopmentCommitResult, acknowledgeNotAppliedDevelopmentCommitResult, runDevelopmentCommit } from '../commit/operation.ts';

/** Public CLI orchestration; all decisions and Effects remain in their domain owners. */
export async function runDevelopmentCommitCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || args[0]!.length === 0) {
    throw new Error('development commit requires exactly one non-empty message argument.');
  }
  const prepared = await issueDevelopmentCommitAdmission({
    repositoryRoot: path.resolve(process.cwd()),
    message: args[0]!
  });
  const result = await runDevelopmentCommit(prepared.request, prepared.admission);
  console.log(JSON.stringify(result, null, 2));
  if (result.disposition === 'applied') acknowledgeDevelopmentCommitResult(result);
  else if (result.disposition === 'not-applied') await acknowledgeNotAppliedDevelopmentCommitResult(result);
  return result.disposition === 'applied' ? 0 : 1;
}
