import { resolveWorkspace } from '../../orchestrator.ts';
import type { CommandHandler } from '../command-registry.ts';
import { RESOLVE_USAGE } from '../usage.ts';

export const resolveCommand: CommandHandler = {
  name: 'resolve',
  usage: RESOLVE_USAGE,
  async execute(args, ctx) {
    if (args.length > 0) {
      throw new Error(RESOLVE_USAGE);
    }
    const { lock } = await resolveWorkspace(ctx.cwd);
    console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
  }
};
