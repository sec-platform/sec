#!/usr/bin/env bun

import {
  cleanGeneratedState,
  inspectGeneratedState
} from '../../platform/dev-runner/generated-state.ts';
import { generatedStateDigest } from '../../platform/shared/generated-state-contract.ts';
import { runSettlement } from './worktree-settlement.ts';

export const ENVIRONMENT_SETTLEMENT_SCHEMA = 'sec-environment-settlement-v1' as const;

export async function settleEnvironment(
  repositoryRoot = process.cwd(),
  options: { fix?: boolean } = {}
): Promise<Readonly<{
  schema: typeof ENVIRONMENT_SETTLEMENT_SCHEMA;
  generatedAt: string;
  repositoryRoot: string;
  status: 'settled' | 'blocked';
  worktree: Awaited<ReturnType<typeof runSettlement>>;
  generatedState: Awaited<ReturnType<typeof inspectGeneratedState>>;
  cleanup: Awaited<ReturnType<typeof cleanGeneratedState>> | null;
  digest: `sha256:${string}`;
}>> {
  const worktree = await runSettlement(repositoryRoot, { fix: options.fix === true });
  const cleanup = options.fix === true && worktree.status === 'settled'
    ? await cleanGeneratedState({ repositoryRoot, profile: 'safe' })
    : null;
  const generatedState = await inspectGeneratedState({ repositoryRoot });
  const status = worktree.status === 'settled'
    && generatedState.blockers.length === 0
    && (cleanup === null || cleanup.status === 'completed' || cleanup.status === 'no-op')
    ? 'settled'
    : 'blocked';
  const withoutDigest = {
    schema: ENVIRONMENT_SETTLEMENT_SCHEMA,
    generatedAt: new Date().toISOString(),
    repositoryRoot,
    status,
    worktree,
    generatedState,
    cleanup
  } as const;
  return Object.freeze({
    ...withoutDigest,
    digest: generatedStateDigest({
      ...withoutDigest,
      generatedAt: '<generated-at>',
      worktree: { ...worktree, generatedAt: '<generated-at>' },
      generatedState: { ...generatedState, observedAt: '<observed-at>' },
      cleanup: cleanup === null ? null : {
        ...cleanup,
        startedAt: '<started-at>',
        completedAt: '<completed-at>'
      }
    })
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const compact = args.includes('--compact');
  const fix = args.includes('--fix');
  const unknown = args.filter((arg) => arg !== '--json' && arg !== '--compact' && arg !== '--fix');
  if (unknown.length > 0 || (compact && !json)) {
    throw new Error('Usage: bun scripts/codex/environment-settlement.ts [--json [--compact]] [--fix]');
  }
  const receipt = await settleEnvironment(process.cwd(), { fix });
  if (json) {
    console.log(JSON.stringify(compact ? {
      schema: receipt.schema,
      status: receipt.status,
      worktreeStatus: receipt.worktree.status,
      generatedStateBlockers: receipt.generatedState.blockers,
      cleanupStatus: receipt.cleanup?.status ?? null,
      digest: receipt.digest
    } : receipt, null, compact ? 0 : 2));
  } else {
    console.log(`Environment Settlement: ${receipt.status}`);
    console.log(`  worktree: ${receipt.worktree.status}`);
    console.log(`  generated-state blockers: ${receipt.generatedState.blockers.length}`);
    if (receipt.cleanup) console.log(`  safe cleanup: ${receipt.cleanup.status}`);
    console.log(`  digest: ${receipt.digest}`);
  }
  if (receipt.status !== 'settled') process.exit(1);
}

if (import.meta.main) await main();
