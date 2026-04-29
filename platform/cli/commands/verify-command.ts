import type { CommandHandler } from '../command-registry.ts';
import { parseVerifyArgs } from '../args.ts';
import { verifyWorkspace } from '../../orchestrator.ts';
import { formatJson } from '../format-utils.ts';
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
      console.log(formatJson(report, verifyArgs));
      return;
    }
    console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
  }
};
