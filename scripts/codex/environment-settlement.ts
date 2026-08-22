#!/usr/bin/env bun

import path from 'node:path';

import { generatedStateDigestV1 } from '../../platform/shared/generated-state-contract.ts';
import { runCommandBytes } from '../../platform/shared/process.ts';
import {
  inspectGeneratedStateV1,
  settleGeneratedStateV1
} from '../../tooling/sec-dev/generated-state-lifecycle.ts';

export const ENVIRONMENT_SETTLEMENT_SCHEMA_V1 = 'sec-environment-settlement-v1' as const;

export async function settleEnvironmentV1(input: Readonly<{
  repositoryRoot?: string;
  workspaceRoot?: string;
  fix?: boolean;
}> = {}) {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? process.cwd());
  const workspaceRoot = path.resolve(input.workspaceRoot ?? repositoryRoot);
  const working = await runCommandBytes(
    'git', ['-C', workspaceRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: repositoryRoot }
  );
  const workingRecords = working.code === 0
    ? Buffer.from(working.stdout).toString('utf8').split('\0').filter(Boolean).sort()
    : null;
  const cleanup = input.fix === true
    ? await settleGeneratedStateV1({ repositoryRoot, workspaceRoot, profile: 'safe' })
    : null;
  const generatedState = await inspectGeneratedStateV1({ repositoryRoot, workspaceRoot });
  const blockers = [
    ...(workingRecords === null ? ['git-working-state-unresolved'] : workingRecords.map((entry) => `git:${entry}`)),
    ...generatedState.blockers
  ].sort();
  const material = Object.freeze({
    schema: ENVIRONMENT_SETTLEMENT_SCHEMA_V1,
    repositoryRoot,
    workspaceRoot,
    workingStateDigest: generatedStateDigestV1(workingRecords),
    generatedStateInventoryDigest: generatedState.inventoryDigest,
    cleanupDigest: cleanup?.settlementDigest ?? null,
    status: blockers.length === 0 ? 'settled' as const : 'blocked' as const,
    blockers: Object.freeze(blockers)
  });
  return Object.freeze({ ...material, settlementDigest: generatedStateDigestV1(material) });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const fix = args.includes('--fix');
  const unknown = args.filter((argument) => argument !== '--json' && argument !== '--fix');
  if (unknown.length > 0) {
    throw new Error('Usage: bun scripts/codex/environment-settlement.ts [--json] [--fix]');
  }
  const receipt = await settleEnvironmentV1({ fix });
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else {
    console.log(`Environment settlement: ${receipt.status}`);
    console.log(`  receipt: ${receipt.settlementDigest}`);
    console.log(`  blockers: ${receipt.blockers.length}`);
  }
  if (receipt.status !== 'settled') process.exitCode = 1;
}

if (import.meta.main) await main();
