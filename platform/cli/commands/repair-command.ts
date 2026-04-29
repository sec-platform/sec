import { repairWorkspace } from '../../orchestrator.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import { parseRepairArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { readRequiredJson } from '../command-utils.ts';
import { printJsonOrText } from '../format-utils.ts';
import { formatRepairSummary } from '../formatters.ts';
import { REPAIR_USAGE } from '../usage.ts';

export const repairCommand: CommandHandler = {
  name: 'repair',
  usage: REPAIR_USAGE,
  async execute(args, ctx) {
    const repairArgs = parseRepairArgs(args);
    if (repairArgs.mode === 'plan') {
      const { repairPlanPath } = getWorkspacePaths(ctx.cwd);
      const repairPlan = await readRequiredJson<RepairPlan>(repairPlanPath, 'Repair plan not found; run platform repair --dry-run first');
      printJsonOrText(repairPlan, repairArgs, (plan) => formatRepairSummary(plan, true));
      return;
    }
    try {
      const { repairPlan } = await repairWorkspace(ctx.cwd, { dryRun: repairArgs.dryRun });
      printJsonOrText(repairPlan, repairArgs, (plan) => formatRepairSummary(plan, repairArgs.dryRun));
      return;
    } catch (error) {
      const { repairPlanPath } = getWorkspacePaths(ctx.cwd);
      if (await pathExists(repairPlanPath)) {
        const repairPlan = await readJson<RepairPlan>(repairPlanPath);
        printJsonOrText(repairPlan, repairArgs, (plan) => formatRepairSummary(plan, repairArgs.dryRun));
      }
      throw error;
    }
  }
};
