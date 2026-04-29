import type { CommandHandler } from '../command-registry.ts';
import { parseResetArg } from '../args.ts';
import { initWorkspace } from '../../orchestrator.ts';
import { INIT_USAGE } from '../usage.ts';

export const initCommand: CommandHandler = {
  name: 'init',
  usage: INIT_USAGE,
  async execute(args, ctx) {
    await initWorkspace(ctx.cwd, { reset: parseResetArg(args) });
    console.log('Initialized project workspace');
  }
};
