import { issueDevelopmentCommitAdmission } from '../commit-admission/operation.ts';
import { decodeDevelopmentCommitCommand } from '../commit-admission/source-checkpoint-contract.ts';
import { runDevelopmentCommit } from '../commit/operation.ts';

/** Public CLI orchestration; all decisions and Effects remain in their domain owners. */
export async function runDevelopmentCommitCommand(args: readonly string[]): Promise<number> {
  const prepared = await issueDevelopmentCommitAdmission(decodeDevelopmentCommitCommand(args, process.cwd()));
  const result = await runDevelopmentCommit(prepared.request, prepared.admission);
  console.log(JSON.stringify(result, null, 2));
  return result.disposition === 'applied' ? 0 : 1;
}
