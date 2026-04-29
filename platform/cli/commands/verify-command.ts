import type { CommandHandler, CommandContext } from '../command-registry.ts';
import { parseVerifyArgs } from '../args.ts';
import { verifyWorkspace } from '../../orchestrator.ts';
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
    if (verifyArgs.json) {
      console.log(JSON.stringify(report, null, verifyArgs.compact ? 0 : 2));
      return;
    }
    console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
  }
};
