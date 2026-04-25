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
import type { VerificationLane } from '../shared/types.ts';

function parseLaneArg(args: string[]): VerificationLane {
  if (args.length === 0) {
    return 'all';
  }
  if (args.length !== 2 || args[0] !== '--lane') {
    throw new Error('Usage: platform verify [--lane fast|runtime|all]');
  }

  const value = args[1];
  if (value === 'fast' || value === 'runtime' || value === 'all') {
    return value;
  }

  throw new Error('Usage: platform verify [--lane fast|runtime|all]');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'init':
      await initWorkspace(process.cwd(), { reset: args.includes('--reset') });
      console.log('Initialized project workspace');
      return;
    case 'add':
      if (!args[0]) {
        throw new Error('Usage: platform add <block-id>');
      }
      await addBlock(process.cwd(), args[0]);
      console.log(`Added block ${args[0]}`);
      return;
    case 'resolve': {
      const { lock } = await resolveWorkspace(process.cwd());
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
      return;
    }
    case 'compose':
      await composeWorkspace(process.cwd());
      console.log('Composed project');
      return;
    case 'adapt':
      await adaptWorkspace(process.cwd());
      console.log('Adapted slots');
      return;
    case 'verify': {
      const { report } = await verifyWorkspace(process.cwd(), { lane: parseLaneArg(args) });
      console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
      return;
    }
    case 'repair': {
      const { repairPlan } = await repairWorkspace(process.cwd());
      const suffix = repairPlan.status === 'applied' ? '; verify pending' : '';
      console.log(`Repair ${repairPlan.status} (${repairPlan.tasks.length} tasks)${suffix}`);
      return;
    }
    case 'upgrade': {
      if (!args[0] || !args[1]) {
        throw new Error('Usage: platform upgrade <block-id> <target-version>');
      }
      const { upgradePlan } = await upgradeWorkspace(process.cwd(), args[0], args[1]);
      console.log(`Upgrade ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`);
      return;
    }
    case 'lock':
      await lockWorkspace(process.cwd());
      console.log('Locked project');
      return;
    case 'explain': {
      const { graph } = await explainWorkspace(process.cwd());
      console.log(`Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`);
      return;
    }
    default:
      console.log('Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain>');
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
