import { writeSync } from 'node:fs';

import { issueDevelopmentCommitAdmission } from '../commit-admission/operation.ts';
import { decodeDevelopmentCommitCommand } from '../commit-admission/source-checkpoint-contract.ts';
import { acknowledgeDevelopmentCommitResult, runDevelopmentCommit } from '../commit/operation.ts';

/** Public CLI orchestration; all decisions and Effects remain in their domain owners. */
export async function runDevelopmentCommitCommand(args: readonly string[]): Promise<number> {
  const prepared = await issueDevelopmentCommitAdmission(decodeDevelopmentCommitCommand(args, process.cwd()));
  const result = await runDevelopmentCommit(prepared.request, prepared.admission);
  const output = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, 'utf8');
  // Completion means delivery to the original stdout descriptor, not that a user read it.
  for (let offset = 0; offset < output.byteLength;) {
    const written = writeSync(1, output, offset, output.byteLength - offset);
    if (written === 0) throw new Error('Development commit result delivery made no progress.');
    offset += written;
  }
  if (result.disposition !== 'applied') return 1;
  await acknowledgeDevelopmentCommitResult(result);
  return 0;
}
