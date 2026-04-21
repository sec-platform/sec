#!/usr/bin/env node
import {
  addBlock,
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../orchestrator.ts';

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
      const { report } = await verifyWorkspace(process.cwd());
      console.log(`Verification ${report.summary.status}`);
      return;
    }
    case 'lock':
      await lockWorkspace(process.cwd());
      console.log('Locked project');
      return;
    default:
      console.log('Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|lock>');
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
