import { ARTIFACT_PATHS_OPTION, ARTIFACT_KIND_OPTION, parseArtifactCommandInput } from './artifact-command-input.ts';
import { VERIFICATION_LANE_OPTION } from './verification-lane-option.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import type { Command } from 'commander';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { printJsonOrText } from './format-utils.ts';
import { addBlock, composeWorkspace, explainWorkspace, initWorkspace, lockWorkspace, repairWorkspace, resolveWorkspace, upgradeWorkspace, verifyWorkspace } from './lazy-command-domains.ts';
import { jsonOpts, commandPath, usageError, addJsonFlags, optionalModeCommand } from './command-options.ts';
import {
  COMPOSE_LOCK_OPTION, WORKSPACE_DRY_RUN_OPTION,
  parseComposeCommandInput, parseRepairCommandInput, parseUpgradeCommandInput,
  parseVerifyCommandInput, VERIFY_COMMAND_DEFAULT_LANE
} from './workspace-command-input.ts';

export function registerWorkspaceCommands(program: Command): void {
  program.command('init')
    .description('Initialize project workspace')
    .action(async () => {
      const cwd = process.cwd();
      await initWorkspace(cwd);
      console.log('Initialized project workspace');
    });

  program.command('add <block-id>')
    .description('Add a block to the project')
    .action(async (blockId: string) => {
      const cwd = process.cwd();
      const result = await addBlock(cwd, blockId);
      const selected = result.selectedBlock;
      console.log(`${result.changed ? 'Added' : 'Selected'} block ${selected.id}@${selected.version} from ${selected.registrySourceId} (${selected.registryKind})`);
    });

  program.command('resolve')
    .description('Resolve block dependencies')
    .action(async () => {
      const cwd = process.cwd();
      const { withSpinner } = await import('./runtime/spinner.ts');
      const { lock } = await withSpinner('Resolving block dependencies', () => resolveWorkspace(cwd));
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
    });

  program.command('compose')
    .description('Compose project')
    .option(COMPOSE_LOCK_OPTION.flags, 'Lock project files as read-only')
    .action(async (rawOptions: Record<string, unknown>) => {
      const cwd = process.cwd();
      const input = parseComposeCommandInput(rawOptions);
      const { withSpinner } = await import('./runtime/spinner.ts');
      await withSpinner('Composing project', () => composeWorkspace(cwd, { lock: input.lock }));
      console.log('Composed project');
    });

  addJsonFlags(program.command('verify'))
    .description('Run verification')
    .option(VERIFICATION_LANE_OPTION.flags, VERIFICATION_LANE_OPTION.description, VERIFY_COMMAND_DEFAULT_LANE)
    .action(async (rawOptions: Record<string, unknown>) => {
      const cwd = process.cwd();
      const { output, request } = parseVerifyCommandInput(rawOptions);
      const { report } = await runWithOptionalSpinner('Running verification', output, () => verifyWorkspace(cwd, request));
      printJsonOrText(report, output, (v) => `Verification ${v.summary.status} (${v.summary.requestedLane})`);
    });

  addJsonFlags(optionalModeCommand(program.command('repair'), 'mode', ['plan']))
    .description('Run repair')
    .option(WORKSPACE_DRY_RUN_OPTION.flags, 'Dry run repair')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const cwd = process.cwd();
      const invocationPath = commandPath(cmd);
      const input = parseRepairCommandInput(mode, rawOptions);
      const { output } = input;
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { pathExists } = await import('../../workspace/files.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { formatRepairSummary } = await import('./formatters.ts');
      const { readRequiredRepairPlan } = await import('./artifact-command-read.ts');
      if (input.kind === 'plan') {
        const repairPlanPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.repairPlan);
        const repairPlan = readRequiredRepairPlan(
          repairPlanPath,
          `Repair plan not found; run ${invocationPath} --dry-run first`
        );
        printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, true));
        return;
      }
      try {
        const { repairPlan } = await runWithOptionalSpinner(
          input.request.dryRun ? 'Previewing repair' : 'Running repair',
          output,
          () => repairWorkspace(cwd, { dryRun: input.request.dryRun })
        );
        printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, input.request.dryRun));
      } catch (error) {
        const repairPlanPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.repairPlan);
        if (await pathExists(repairPlanPath)) {
          const repairPlan = readRequiredRepairPlan(
            repairPlanPath,
            'Repair plan disappeared before it could be read back.'
          );
          printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, input.request.dryRun));
        }
        throw error;
      }
    });

  addJsonFlags(program.command('upgrade')
    .argument('[subject]')
    .argument('[target-version]'))
    .description('Run upgrade')
    .option(WORKSPACE_DRY_RUN_OPTION.flags, 'Dry run upgrade')
    .action(async (
      subject: string | undefined,
      targetVersion: string | undefined,
      rawOptions: Record<string, unknown>,
      cmd: Command
    ) => {
      const cwd = process.cwd();
      const invocationPath = commandPath(cmd);
      const input = parseUpgradeCommandInput(subject, targetVersion, rawOptions, invocationPath);
      const { output } = input;
      if (input.kind === 'plan') {
        const { readUpgradeArtifactSet } = await import('../../change-management/upgrade/runtime/artifact-readback.ts');
        const { formatUpgradePlan } = await import('./formatters.ts');
        const { plan: upgradePlan, executionTerminal: upgradeExecutionTerminal } = readUpgradeArtifactSet(cwd);
        if (upgradePlan === null) {
          throw new CompilerError(
            'UPGRADE-BLOCKED-003',
            `Upgrade plan not found; run ${invocationPath} <block-id> <target-version>`
          );
        }
        printJsonOrText(
          upgradePlan,
          output,
          (plan) => formatUpgradePlan(plan, upgradeExecutionTerminal)
        );
        return;
      }
      if (input.kind === 'diagnostics') {
        const { readUpgradeArtifactSet } = await import('../../change-management/upgrade/runtime/artifact-readback.ts');
        const { formatUpgradeDiagnostics } = await import('./formatters.ts');
        const { diagnostics: upgradeDiagnostics } = readUpgradeArtifactSet(cwd);
        if (upgradeDiagnostics === null) {
          throw new CompilerError(
            'UPGRADE-BLOCKED-003',
            `Upgrade diagnostics not found; run ${invocationPath} <block-id> <target-version>`
          );
        }
        printJsonOrText(upgradeDiagnostics, output, formatUpgradeDiagnostics);
        return;
      }
      const { formatUpgradePlan, formatUpgradePreview } = await import('./formatters.ts');
      const result = await runWithOptionalSpinner(
        input.request.dryRun ? 'Previewing upgrade' : 'Running upgrade',
        output,
        () => upgradeWorkspace(cwd, input.subject, input.targetVersion, { dryRun: input.request.dryRun })
      );
      if (result.resultKind === 'preview') {
        printJsonOrText(result.upgradePlan, output, formatUpgradePreview);
      } else {
        printJsonOrText(
          result.upgradePlan,
          output,
          (plan) => formatUpgradePlan(plan, result.upgradeExecutionTerminal)
        );
      }
    });

  addJsonFlags(optionalModeCommand(program.command('lock'), 'mode', ['inspect']))
    .description('Lock project')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const output = jsonOpts(opts);
      if (mode === 'inspect') {
        const { resolveWorkspaceLockPath } = await import('../../workspace/runtime/paths.ts');
        const { formatLockInspect } = await import('./formatters.ts');
        const { printRequiredJson } = await import('./artifact-command-read.ts');
        const lockPath = await resolveWorkspaceLockPath(cwd);
        await printRequiredJson<LockFile>(lockPath, `Graph lock not found; run ${commandPath(cmd)} first`, output, formatLockInspect);
        return;
      }
      await runWithOptionalSpinner('Locking project', output, () => lockWorkspace(cwd));
      console.log('Locked project');
    });

  addJsonFlags(optionalModeCommand(program.command('explain'), 'mode', ['graph']))
    .description('Explain project')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const output = jsonOpts(opts);
      if (mode === 'graph') {
        const { formatExplainGraphInspect } = await import('./formatters.ts');
        const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
        const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
        const { printWorkspaceJson } = await import('./artifact-command-read.ts');
        await printWorkspaceJson<import('../../semantic/projection/contract/explain.ts').ExplainGraph>(
          cwd, (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.explainGraph), `Explain graph not found; run ${commandPath(cmd)} first`, output, formatExplainGraphInspect
        );
        return;
      }
      const { buildE2eMatrix } = await import('../../verification/review/runtime/matrix.ts');
      const { formatExplainSummary } = await import('./formatters.ts');
      const { graph, reviewSummary } = await runWithOptionalSpinner('Explaining project', output, () => explainWorkspace(cwd));
      printJsonOrText({ graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) }, output, (s) => formatExplainSummary(s.graph, s.reviewSummary));
    });

  addJsonFlags(optionalModeCommand(program.command('artifacts'), 'mode', ['manifest']))
    .description('Manage CI artifacts')
    .option(ARTIFACT_PATHS_OPTION.flags, ARTIFACT_PATHS_OPTION.description)
    .option(ARTIFACT_KIND_OPTION.flags, ARTIFACT_KIND_OPTION.description)
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const cwd = process.cwd();
      const invocationPath = commandPath(cmd);
      const input = parseArtifactCommandInput(mode, rawOptions);
      const { executeArtifactCommand } = await import('./artifact-command-execution.ts');
      await executeArtifactCommand(cwd, invocationPath, input);
    });
}
