#!/usr/bin/env bun

import path from 'node:path';

import type { GeneratedStateCleanupProfileV1 } from '../../platform/shared/generated-state-contract.ts';
import {
  inspectGeneratedStateV1,
  planGeneratedStateCleanupV1,
  settleGeneratedStateV1
} from '../../tooling/sec-dev/generated-state-lifecycle.ts';

type Operation = 'inspect' | 'plan' | 'cleanup';

function usage(): never {
  throw new Error(
    'Usage: bun scripts/codex/generated-state.ts <inspect|plan|cleanup> '
    + '[--workspace <absolute-path>] [--profile <automatic|safe|all-rebuildable>] [--json]'
  );
}

function parseArgs(args: readonly string[]): Readonly<{
  operation: Operation;
  workspaceRoot: string;
  profile: GeneratedStateCleanupProfileV1;
  json: boolean;
}> {
  const operation = args[0];
  if (operation !== 'inspect' && operation !== 'plan' && operation !== 'cleanup') usage();
  let workspaceRoot = process.cwd();
  let profile: GeneratedStateCleanupProfileV1 = 'safe';
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--workspace') {
      const value = args[index + 1];
      if (value === undefined || !path.isAbsolute(value)) usage();
      workspaceRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--profile') {
      const value = args[index + 1];
      if (value !== 'automatic' && value !== 'safe' && value !== 'all-rebuildable') usage();
      profile = value;
      index += 1;
      continue;
    }
    usage();
  }
  return Object.freeze({ operation, workspaceRoot, profile, json });
}

export async function runGeneratedStateCliV1(
  args: readonly string[],
  repositoryRoot = process.cwd()
): Promise<unknown> {
  const parsed = parseArgs(args);
  const inventory = await inspectGeneratedStateV1({
    repositoryRoot: path.resolve(repositoryRoot),
    workspaceRoot: parsed.workspaceRoot
  });
  if (parsed.operation === 'inspect') return inventory;
  if (parsed.operation === 'plan') {
    return Object.freeze({
      schema: 'sec-generated-state-cleanup-plan-v1',
      repositoryRoot: path.resolve(repositoryRoot),
      workspaceRoot: parsed.workspaceRoot,
      inventoryDigest: inventory.inventoryDigest,
      profile: parsed.profile,
      ...planGeneratedStateCleanupV1({ inventory, profile: parsed.profile })
    });
  }
  return settleGeneratedStateV1({
    repositoryRoot: path.resolve(repositoryRoot),
    workspaceRoot: parsed.workspaceRoot,
    profile: parsed.profile
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const result = await runGeneratedStateCliV1(process.argv.slice(2));
  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (parsed.operation === 'inspect') {
    const inventory = result as Awaited<ReturnType<typeof inspectGeneratedStateV1>>;
    console.log(`Generated state: ${inventory.blockers.length === 0 ? 'settled' : 'blocked'}`);
    console.log(`  inventory: ${inventory.inventoryDigest}`);
    console.log(`  blockers: ${inventory.blockers.length}`);
    return;
  }
  if (parsed.operation === 'plan') {
    const plan = result as ReturnType<typeof planGeneratedStateCleanupV1>;
    console.log(`Generated-state cleanup plan: selected=${plan.selected.length}, protected=${plan.protected.length}`);
    return;
  }
  const settlement = result as Awaited<ReturnType<typeof settleGeneratedStateV1>>;
  console.log(`Generated-state settlement: ${settlement.terminal}`);
  console.log(`  receipt: ${settlement.settlementDigest}`);
  if (settlement.terminal === 'blocked' || settlement.terminal === 'partial-residue') process.exitCode = 1;
}

if (import.meta.main) await main();
