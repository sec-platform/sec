import { resolveWorkspace } from '../../orchestrator.ts';
import type { CommandHandler } from '../command-registry.ts';

export const resolveCommand: CommandHandler = {
  name: 'resolve',
  usage: 'Usage: platform resolve',
  async execute(args, ctx) {
    if (args.length > 0) {
      throw new Error('Usage: platform resolve');
    }
    const { lock } = await resolveWorkspace(ctx.cwd);
    console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
  }
};
