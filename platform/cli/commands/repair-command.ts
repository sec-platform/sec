import { repairWorkspace } from '../../orchestrator.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import { parseRepairArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { printRequiredJson } from '../command-utils.ts';
import { printJsonOrText } from '../format-utils.ts';
import { formatRepairSummary } from '../formatters.ts';
import { REPAIR_USAGE } from '../usage.ts';

type RepairArgs = ReturnType<typeof parseRepairArgs>;

function printRepairPlan(
  repairPlan: RepairPlan,
  repairArgs: RepairArgs,
  dryRun: boolean
): void {
  printJsonOrText(repairPlan, repairArgs, (plan) => formatRepairSummary(plan, dryRun));
}

export const repairCommand: CommandHandler = {
  name: 'repair',
  usage: REPAIR_USAGE,
  async execute(args, ctx) {
    const repairArgs = parseRepairArgs(args);
    if (repairArgs.mode === 'plan') {
      const { repairPlanPath } = getWorkspacePaths(ctx.cwd);
      await printRequiredJson<RepairPlan>(
        repairPlanPath,
        'Repair plan not found; run platform repair --dry-run first',
        repairArgs,
        (plan) => formatRepairSummary(plan, true)
      );
      return;
    }
    try {
      const { repairPlan } = await repairWorkspace(ctx.cwd, { dryRun: repairArgs.dryRun });
      printRepairPlan(repairPlan, repairArgs, repairArgs.dryRun);
      return;
    } catch (error) {
      const { repairPlanPath } = getWorkspacePaths(ctx.cwd);
      if (await pathExists(repairPlanPath)) {
        const repairPlan = await readJson<RepairPlan>(repairPlanPath);
        printRepairPlan(repairPlan, repairArgs, repairArgs.dryRun);
      }
      throw error;
    }
  }
};
