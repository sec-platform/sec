import path from 'node:path';

import type { GeneratedStateCleanupProfile } from '../../runtime-state/generated-state/contract.ts';
import { generatedStateDigest } from '../../runtime-state/generated-state/contract.ts';
import { runCommandBytes } from '../../runtime-state/physical/runtime/process.ts';
import { inspectGeneratedState, planGeneratedStateCleanup, settleGeneratedState } from '../../runtime-state/generated-state/lifecycle.ts';

type GeneratedStateOperation = 'inspect' | 'plan' | 'cleanup';

function parseGeneratedStateOperation(args: readonly string[]): Readonly<{
  operation: GeneratedStateOperation;
  workspaceRoot: string;
  profile: GeneratedStateCleanupProfile;
}> {
  const operation = args[0];
  if (operation !== 'inspect' && operation !== 'plan' && operation !== 'cleanup') {
    throw new Error(
      'Generated-state operation requires inspect, plan, or cleanup with optional '
      + '--workspace <absolute-path> and --profile <automatic|safe|all-rebuildable>.'
    );
  }
  let workspaceRoot = process.cwd();
  let profile: GeneratedStateCleanupProfile = 'safe';
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--workspace') {
      const value = args[index + 1];
      if (value === undefined || !path.isAbsolute(value)) {
        throw new Error('Generated-state --workspace must be one absolute path.');
      }
      workspaceRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--profile') {
      const value = args[index + 1];
      if (value !== 'automatic' && value !== 'safe' && value !== 'all-rebuildable') {
        throw new Error('Generated-state --profile is invalid.');
      }
      profile = value;
      index += 1;
      continue;
    }
    throw new Error(`Generated-state operation argument is unsupported: ${argument}`);
  }
  return Object.freeze({ operation, workspaceRoot, profile });
}

export async function runGeneratedStateOperation(
  args: readonly string[],
  repositoryRoot = process.cwd()
): Promise<unknown> {
  const parsed = parseGeneratedStateOperation(args);
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const inventory = await inspectGeneratedState({
    repositoryRoot: resolvedRepositoryRoot,
    workspaceRoot: parsed.workspaceRoot
  });
  if (parsed.operation === 'inspect') return inventory;
  if (parsed.operation === 'plan') {
    return Object.freeze({
      schema: 'sec-generated-state-cleanup-plan-v1',
      repositoryRoot: resolvedRepositoryRoot,
      workspaceRoot: parsed.workspaceRoot,
      inventoryDigest: inventory.inventoryDigest,
      profile: parsed.profile,
      ...planGeneratedStateCleanup({ inventory, profile: parsed.profile })
    });
  }
  return settleGeneratedState({
    repositoryRoot: resolvedRepositoryRoot,
    workspaceRoot: parsed.workspaceRoot,
    profile: parsed.profile
  });
}

export const ENVIRONMENT_SETTLEMENT_SCHEMA = 'sec-environment-settlement-v1' as const;

export async function settleEnvironment(input: Readonly<{
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
    ? await settleGeneratedState({ repositoryRoot, workspaceRoot, profile: 'safe' })
    : null;
  const generatedState = await inspectGeneratedState({ repositoryRoot, workspaceRoot });
  const blockers = [
    ...(workingRecords === null ? ['git-working-state-unresolved'] : workingRecords.map((entry) => `git:${entry}`)),
    ...generatedState.blockers
  ].sort();
  const material = Object.freeze({
    schema: ENVIRONMENT_SETTLEMENT_SCHEMA,
    repositoryRoot,
    workspaceRoot,
    workingStateDigest: generatedStateDigest(workingRecords),
    generatedStateInventoryDigest: generatedState.inventoryDigest,
    cleanupDigest: cleanup?.settlementDigest ?? null,
    status: blockers.length === 0 ? 'settled' as const : 'blocked' as const,
    blockers: Object.freeze(blockers)
  });
  return Object.freeze({ ...material, settlementDigest: generatedStateDigest(material) });
}
