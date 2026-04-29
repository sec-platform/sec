import { upgradeWorkspace } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../shared/upgrade-types.ts';
import { parseUpgradeArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { readRequiredJson } from '../command-utils.ts';
import { printJsonOrText } from '../format-utils.ts';
import { formatUpgradeDiagnostics, formatUpgradeSummary } from '../formatters.ts';
import { UPGRADE_USAGE } from '../usage.ts';

export const upgradeCommand: CommandHandler = {
  name: 'upgrade',
  usage: UPGRADE_USAGE,
  async execute(args, ctx) {
    const upgradeArgs = parseUpgradeArgs(args);
    if (upgradeArgs.mode === 'plan') {
      const { upgradePlanPath } = getWorkspacePaths(ctx.cwd);
      const upgradePlan = await readRequiredJson<UpgradePlan>(
        upgradePlanPath,
        'Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first'
      );
      printJsonOrText(upgradePlan, upgradeArgs, (plan) => formatUpgradeSummary(plan, plan.status === 'planned'));
      return;
    }
    if (upgradeArgs.mode === 'diagnostics') {
      const { upgradeDiagnosticsPath } = getWorkspacePaths(ctx.cwd);
      const diagnostics = await readRequiredJson<UpgradeDiagnostics>(
        upgradeDiagnosticsPath,
        'Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first'
      );
      printJsonOrText(diagnostics, upgradeArgs, formatUpgradeDiagnostics);
      return;
    }
    const { upgradePlan } = await upgradeWorkspace(ctx.cwd, upgradeArgs.blockId, upgradeArgs.targetVersion, {
      dryRun: upgradeArgs.dryRun
    });
    printJsonOrText(upgradePlan, upgradeArgs, (plan) => formatUpgradeSummary(plan, upgradeArgs.dryRun));
  }
};
