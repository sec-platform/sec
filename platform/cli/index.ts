#!/usr/bin/env node
import {
  addBlock,
  adaptWorkspace,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  repairWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../orchestrator.ts';
import { loadManifestById } from '../compiler/parse/load-manifest.ts';
import { loadPlan } from '../compiler/parse/load-plan.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import type { VerificationLane } from '../shared/types.ts';

const USAGE = 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain>';
const INIT_USAGE = 'Usage: platform init [--reset]';
const ADD_USAGE = 'Usage: platform add <block-id>';
const VERIFY_USAGE = 'Usage: platform verify [--lane fast|runtime|all]';
const REPAIR_USAGE = 'Usage: platform repair [--dry-run]';
const UPGRADE_USAGE = 'Usage: platform upgrade <block-id> <target-version> [--dry-run]';

function assertNoArgs(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(`Usage: platform ${command}`);
  }
}

function parseResetArg(args: string[]): boolean {
  if (args.length === 0) {
    return false;
  }
  if (args.length === 1 && args[0] === '--reset') {
    return true;
  }
  throw new Error(INIT_USAGE);
}

function parseLaneArg(args: string[]): VerificationLane {
  if (args.length === 0) {
    return 'all';
  }
  if (args.length !== 2 || args[0] !== '--lane') {
    throw new Error(VERIFY_USAGE);
  }

  const value = args[1];
  if (value === 'fast' || value === 'runtime' || value === 'all') {
    return value;
  }

  throw new Error(VERIFY_USAGE);
}

function parseRepairArgs(args: string[]): { dryRun: boolean } {
  if (args.length === 0) {
    return { dryRun: false };
  }
  if (args.length === 1 && args[0] === '--dry-run') {
    return { dryRun: true };
  }
  throw new Error(REPAIR_USAGE);
}

function parseUpgradeArgs(args: string[]): { blockId: string; targetVersion: string; dryRun: boolean } {
  if (args.length === 2) {
    return { blockId: args[0], targetVersion: args[1], dryRun: false };
  }
  if (args.length === 3 && args[2] === '--dry-run') {
    return { blockId: args[0], targetVersion: args[1], dryRun: true };
  }
  throw new Error(UPGRADE_USAGE);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'init':
      await initWorkspace(process.cwd(), { reset: parseResetArg(args) });
      console.log('Initialized project workspace');
      return;
    case 'add': {
      if (args.length !== 1) {
        throw new Error(ADD_USAGE);
      }
      await addBlock(process.cwd(), args[0]);
      const { planPath } = getWorkspacePaths(process.cwd());
      const plan = await loadPlan(planPath);
      const manifestEntry = await loadManifestById(args[0], {
        workspaceRoot: process.cwd(),
        version: plan.blocks.find((block) => block.id === args[0])?.version,
        registrySources: plan.registry.sources
      });
      console.log(`Added block ${args[0]}@${manifestEntry.manifest.version} from ${manifestEntry.registrySourceId} (${manifestEntry.registryKind})`);
      return;
    }
    case 'resolve': {
      assertNoArgs('resolve', args);
      const { lock } = await resolveWorkspace(process.cwd());
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
      return;
    }
    case 'compose':
      assertNoArgs('compose', args);
      await composeWorkspace(process.cwd());
      console.log('Composed project');
      return;
    case 'adapt':
      assertNoArgs('adapt', args);
      await adaptWorkspace(process.cwd());
      console.log('Adapted slots');
      return;
    case 'verify': {
      const { report } = await verifyWorkspace(process.cwd(), { lane: parseLaneArg(args) });
      console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
      return;
    }
    case 'repair': {
      const repairArgs = parseRepairArgs(args);
      const { repairPlan } = await repairWorkspace(process.cwd(), { dryRun: repairArgs.dryRun });
      const suffix = repairPlan.status === 'applied' ? '; verify pending' : repairArgs.dryRun ? ' (dry-run)' : '';
      console.log(`Repair ${repairPlan.status} (${repairPlan.tasks.length} tasks)${suffix}`);
      return;
    }
    case 'upgrade': {
      const upgradeArgs = parseUpgradeArgs(args);
      const { upgradePlan } = await upgradeWorkspace(process.cwd(), upgradeArgs.blockId, upgradeArgs.targetVersion, {
        dryRun: upgradeArgs.dryRun
      });
      const suffix = upgradeArgs.dryRun ? ' (dry-run)' : '';
      console.log(`Upgrade ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}${suffix}`);
      return;
    }
    case 'lock':
      assertNoArgs('lock', args);
      await lockWorkspace(process.cwd());
      console.log('Locked project');
      return;
    case 'explain': {
      assertNoArgs('explain', args);
      const { graph } = await explainWorkspace(process.cwd());
      console.log(`Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`);
      return;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string; details?: unknown };
  console.error(failure.code ?? 'UNEXPECTED', failure.message ?? String(error));
  if (failure.details) {
    console.error(JSON.stringify(failure.details, null, 2));
  }
  process.exit(1);
});
