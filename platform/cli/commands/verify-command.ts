import type { CommandHandler } from '../command-registry.ts';
import { parseVerifyArgs } from '../args.ts';
import { verifyWorkspace } from '../../orchestrator.ts';
import { printJsonOrText } from '../format-utils.ts';
import { VERIFY_USAGE } from '../usage.ts';

export const verifyCommand: CommandHandler = {
  name: 'verify',
  usage: VERIFY_USAGE,
  async execute(args, ctx) {
    const verifyArgs = parseVerifyArgs(args);
    const { report } = await verifyWorkspace(ctx.cwd, {
      lane: verifyArgs.lane,
      emitTiming: !verifyArgs.json
    });
    printJsonOrText(report, verifyArgs, (value) => `Verification ${value.summary.status} (${value.summary.requestedLane})`);
  }
};
