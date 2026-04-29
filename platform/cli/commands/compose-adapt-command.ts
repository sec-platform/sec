import type { CommandHandler } from '../command-registry.ts';
import { composeWorkspace, adaptWorkspace } from '../../orchestrator.ts';

export const composeCommand: CommandHandler = {
  name: 'compose',
  usage: 'Usage: platform compose',
  async execute(args, ctx) {
    if (args.length > 0) {
      throw new Error('Usage: platform compose');
    }
    await composeWorkspace(ctx.cwd);
    console.log('Composed project');
  }
};

export const adaptCommand: CommandHandler = {
  name: 'adapt',
  usage: 'Usage: platform adapt',
  async execute(args, ctx) {
    if (args.length > 0) {
      throw new Error('Usage: platform adapt');
    }
    await adaptWorkspace(ctx.cwd);
    console.log('Adapted slots');
  }
};
