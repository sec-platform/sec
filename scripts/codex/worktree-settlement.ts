#!/usr/bin/env bun
/**
 * Compatibility CLI adapter for the provider-neutral SEC development tool.
 * Canonical implementation: tooling/sec-dev/workspace/worktree-settlement.ts
 */

import {
  formatWorktreeSettlementReceipt,
  runSettlement
} from '../../tooling/sec-dev/workspace/worktree-settlement.ts';

export { runSettlement } from '../../tooling/sec-dev/workspace/worktree-settlement.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const compact = args.includes('--compact');
  const fix = args.includes('--fix');

  if (compact && !json) {
    throw new Error('Usage: worktree-settlement [--json [--compact]] [--fix]');
  }

  const receipt = await runSettlement(undefined, { fix });
  if (json) {
    if (compact) {
      console.log(JSON.stringify({
        schema: receipt.schema,
        status: receipt.status,
        totalFiles: receipt.totalFiles,
        driftCount: receipt.driftEntries.length,
        untrackedCount: receipt.untrackedCount,
        dirtyCount: receipt.dirtyCount,
        coreAutocrlf: receipt.coreAutocrlf,
        summary: receipt.summary
      }));
    } else {
      console.log(JSON.stringify(receipt, null, 2));
    }
  } else {
    console.log(formatWorktreeSettlementReceipt(receipt));
  }

  if (receipt.status !== 'settled') {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
