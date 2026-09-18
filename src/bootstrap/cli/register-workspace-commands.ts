import type { Command } from 'commander';
import type { LockInspectProjectionSource } from '../../application/lock-inspect.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { registerAdvancedWorkspaceCommands } from '../../entry/cli/register-advanced-workspace-commands.ts';
import { registerCoreWorkspaceCommands } from '../../entry/cli/register-core-workspace-commands.ts';
import { printJsonOrText } from '../../entry/cli/format-utils.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import { explainWorkspace, lockWorkspace, repairWorkspace, upgradeWorkspace } from './lazy-command-domains.ts';

export function registerWorkspaceCommands(program: Command): void {
  registerCoreWorkspaceCommands(program, {
    progress: runWithOptionalSpinner,
    init: async (root) => {
      const { initWorkspace } = await import('./lazy-command-domains.ts');
      return initWorkspace(root);
    },
    add: async (root, blockId) => {
      const { addBlock } = await import('./lazy-command-domains.ts');
      return addBlock(root, blockId);
    },
    resolve: async (root) => {
      const { resolveWorkspace } = await import('./lazy-command-domains.ts');
      return resolveWorkspace(root);
    },
    compose: async (root, request) => {
      const { composeWorkspace } = await import('./lazy-command-domains.ts');
      return composeWorkspace(root, { lock: request.lock });
    },
    verify: async (root, request) => {
      const { verifyWorkspace } = await import('./lazy-command-domains.ts');
      return verifyWorkspace(root, request);
    }
  });

  registerAdvancedWorkspaceCommands(program, {
    repair: async ({ workspaceRoot: cwd, invocationPath, input }) => {
      const { output } = input;
      const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
      const { pathExists } = await import('../../adapters/filesystem/files.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
      const { projectRepairSummary } = await import('../../application/repair-summary.ts');
      const { formatRepairSummary } = await import('../../entry/cli/repair-summary.ts');
      const { readRequiredRepairPlan } = await import('./artifact-command-read.ts');
      if (input.kind === 'plan') {
        const repairPlanPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.repairPlan);
        const repairPlan = readRequiredRepairPlan(
          repairPlanPath,
          `Repair plan not found; run ${invocationPath} --dry-run first`
        );
        printJsonOrText(repairPlan, output, (plan) => formatRepairSummary(projectRepairSummary(plan, true)));
        return;
      }
      const { runRepairWithFailureReadback } = await import('./repair-command-execution.ts');
      const { repairPlan } = await runRepairWithFailureReadback(
        () => runWithOptionalSpinner(
          input.request.dryRun ? 'Previewing repair' : 'Running repair',
          output,
          () => repairWorkspace(cwd, { dryRun: input.request.dryRun })
        ),
        async () => {
          const repairPlanPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.repairPlan);
          if (await pathExists(repairPlanPath)) {
            const plan = readRequiredRepairPlan(repairPlanPath, 'Repair plan disappeared before it could be read back.');
            printJsonOrText(plan, output, (value) => formatRepairSummary(projectRepairSummary(value, input.request.dryRun)));
          }
        }
      );
      printJsonOrText(repairPlan, output, (plan) => formatRepairSummary(projectRepairSummary(plan, input.request.dryRun)));
    },

    upgrade: async ({ workspaceRoot: cwd, invocationPath, input }) => {
      const { output } = input;
      if (input.kind === 'plan') {
        const { readUpgradeArtifactSet } = await import('../../adapters/upgrade/artifact-readback.ts');
        const { formatUpgradePlan } = await import('./formatters.ts');
        const { plan: upgradePlan, executionTerminal: upgradeExecutionTerminal } = readUpgradeArtifactSet(cwd);
        if (upgradePlan === null) {
          throw new CompilerError(
            'UPGRADE-BLOCKED-003',
            `Upgrade plan not found; run ${invocationPath} <block-id> <target-version>`
          );
        }
        printJsonOrText(upgradePlan, output, (plan) => formatUpgradePlan(plan, upgradeExecutionTerminal));
        return;
      }
      if (input.kind === 'diagnostics') {
        const { readUpgradeArtifactSet } = await import('../../adapters/upgrade/artifact-readback.ts');
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
        printJsonOrText(result.upgradePlan, output, (plan) => formatUpgradePlan(plan, result.upgradeExecutionTerminal));
      }
    },

    view: async ({ command, workspaceRoot: cwd, invocationPath, input }) => {
      const { output } = input;
      if (command === 'lock') {
        if (input.kind === 'inspect') {
          const { resolveWorkspaceLockPath } = await import('../../adapters/workspace-context.ts');
          const { projectLockInspect } = await import('../../application/lock-inspect.ts');
          const { formatLockInspect } = await import('../../entry/cli/lock-inspect.ts');
          const { printRequiredJson } = await import('./artifact-command-read.ts');
          const lockPath = await resolveWorkspaceLockPath(cwd);
          await printRequiredJson<LockInspectProjectionSource>(
            lockPath,
            `Graph lock not found; run ${invocationPath} first`,
            output,
            (lock) => formatLockInspect(projectLockInspect(lock))
          );
          return;
        }
        await runWithOptionalSpinner('Locking project', output, () => lockWorkspace(cwd));
        printJsonOrText({ status: 'locked' as const }, output, () => 'Locked project');
        return;
      }

      if (input.kind === 'inspect') {
        const { projectExplainGraphInspect } = await import('../../application/explain-graph-inspect.ts');
        const { formatExplainGraphInspect } = await import('../../entry/cli/explain-graph-inspect.ts');
        const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
        const { printWorkspaceJson } = await import('./artifact-command-read.ts');
        await printWorkspaceJson<import('../../application/explain-graph-inspect.ts').ExplainGraphInspectProjectionSource>(
          cwd,
          (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.explainGraph),
          `Explain graph not found; run ${invocationPath} first`,
          output,
          (graph) => formatExplainGraphInspect(projectExplainGraphInspect(graph))
        );
        return;
      }
      const { buildE2eMatrix } = await import('../../adapters/verification/platform/review/runtime/matrix.ts');
      const { formatExplainSummary } = await import('./formatters.ts');
      const { graph, reviewSummary } = await runWithOptionalSpinner('Explaining project', output, () => explainWorkspace(cwd));
      printJsonOrText(
        { graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) },
        output,
        (summary) => formatExplainSummary(summary.graph, summary.reviewSummary)
      );
    },

    artifacts: async ({ workspaceRoot, invocationPath, input }) => {
      const { executeArtifactCommand } = await import('./artifact-command-execution.ts');
      await executeArtifactCommand(workspaceRoot, invocationPath, input);
    }
  });
}
