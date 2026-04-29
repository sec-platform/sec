import type { CommandHandler, CommandContext } from '../command-registry.ts';
import { parseRepairArgs } from '../args.ts';
import { repairWorkspace } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { formatRepairSummary } from '../formatters.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import { REPAIR_USAGE } from '../usage.ts';

export const repairCommand: CommandHandler = {
  name: 'repair',
  usage: REPAIR_USAGE,
  async execute(args, ctx) {
    const repairArgs = parseRepairArgs(args);
    if (repairArgs.mode === 'plan') {
      const { repairPlanPath } = getWorkspacePaths(ctx.cwd);
      if (!(await pathExists(repairPlanPath))) {
        throw new Error('Repair plan not found; run platform repair --dry-run first');
      }
      const repairPlan = await readJson<RepairPlan>(repairPlanPath);
      if (repairArgs.json) {
        console.log(JSON.stringify(repairPlan, null, repairArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatRepairSummary(repairPlan, true));
      return;
    }
    try {
      const { repairPlan } = await repairWorkspace(ctx.cwd, { dryRun: repairArgs.dryRun });
      if (repairArgs.json) {
        console.log(JSON.stringify(repairPlan, null, repairArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatRepairSummary(repairPlan, repairArgs.dryRun));
      return;
    } catch (error) {
      if (repairArgs.json) {
        const { repairPlanPath } = getWorkspacePaths(ctx.cwd);
        if (await pathExists(repairPlanPath)) {
          const repairPlan = await readJson<RepairPlan>(repairPlanPath);
          console.log(JSON.stringify(repairPlan, null, repairArgs.compact ? 0 : 2));
        }
      }
      throw error;
    }
  }
};
