import type { CommandHandler, CommandContext } from '../command-registry.ts';
import { parseUpgradeArgs } from '../args.ts';
import { upgradeWorkspace } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { formatUpgradeSummary, formatUpgradeDiagnostics } from '../formatters.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../shared/upgrade-types.ts';
import { UPGRADE_USAGE } from '../usage.ts';

export const upgradeCommand: CommandHandler = {
  name: 'upgrade',
  usage: UPGRADE_USAGE,
  async execute(args, ctx) {
    const upgradeArgs = parseUpgradeArgs(args);
    if (upgradeArgs.mode === 'plan') {
      const { upgradePlanPath } = getWorkspacePaths(ctx.cwd);
      if (!(await pathExists(upgradePlanPath))) {
        throw new Error('Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first');
      }
      const upgradePlan = await readJson<UpgradePlan>(upgradePlanPath);
      if (upgradeArgs.json) {
        console.log(JSON.stringify(upgradePlan, null, upgradeArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatUpgradeSummary(upgradePlan, upgradePlan.status === 'planned'));
      return;
    }
    if (upgradeArgs.mode === 'diagnostics') {
      const { upgradeDiagnosticsPath } = getWorkspacePaths(ctx.cwd);
      if (!(await pathExists(upgradeDiagnosticsPath))) {
        throw new Error('Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first');
      }
      const diagnostics = await readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);
      if (upgradeArgs.json) {
        console.log(JSON.stringify(diagnostics, null, upgradeArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatUpgradeDiagnostics(diagnostics));
      return;
    }
    const { upgradePlan } = await upgradeWorkspace(ctx.cwd, upgradeArgs.blockId, upgradeArgs.targetVersion, {
      dryRun: upgradeArgs.dryRun
    });
    if (upgradeArgs.json) {
      console.log(JSON.stringify(upgradePlan, null, upgradeArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatUpgradeSummary(upgradePlan, upgradeArgs.dryRun));
  }
};
