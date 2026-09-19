import type { Command } from 'commander';
import type { LockInspectProjectionSource } from '../../application/lock-inspect.ts';
import { CompilerError, formatCompilerFailure } from '../../compiler/errors.ts';
import {
  bindRepairCommandHandler,
  bindUpgradeCommandHandler,
  registerAdvancedWorkspaceCommands
} from '../../entry/cli/register-advanced-workspace-commands.ts';
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
    repair: bindRepairCommandHandler({
      readPlan: async (workspaceRoot, missingMessage) => {
        const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
        const { readRequiredRepairPlan } = await import('../../adapters/workspace/required-artifact-read.ts');
        const { projectRepairSummary } = await import('../../application/repair-summary.ts');
        const { formatRepairSummary } = await import('../../entry/cli/repair-summary.ts');
        const value = readRequiredRepairPlan(
          resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan),
          missingMessage
        );
        return { value, text: formatRepairSummary(projectRepairSummary(value, true)) };
      },
      readPlanIfPresent: async (workspaceRoot, dryRun) => {
        const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { pathExists } = await import('../../adapters/filesystem/files.ts');
        const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
        const { readRequiredRepairPlan } = await import('../../adapters/workspace/required-artifact-read.ts');
        const { projectRepairSummary } = await import('../../application/repair-summary.ts');
        const { formatRepairSummary } = await import('../../entry/cli/repair-summary.ts');
        const path = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
        if (!(await pathExists(path))) return null;
        const value = readRequiredRepairPlan(
          path,
          'Repair plan disappeared before it could be read back.'
        );
        return {
          value,
          text: formatRepairSummary(projectRepairSummary(value, dryRun))
        };
      },
      execute: async (workspaceRoot, dryRun) => {
        const { projectRepairSummary } = await import('../../application/repair-summary.ts');
        const { formatRepairSummary } = await import('../../entry/cli/repair-summary.ts');
        const { repairPlan: value } = await repairWorkspace(workspaceRoot, { dryRun });
        return {
          value,
          text: formatRepairSummary(projectRepairSummary(value, dryRun))
        };
      },
      progress: runWithOptionalSpinner,
      formatFailure: formatCompilerFailure
    }),

    upgrade: bindUpgradeCommandHandler({
      readPlan: async (workspaceRoot, missingMessage) => {
        const { readUpgradeArtifactSet } = await import('../../adapters/upgrade/artifact-readback.ts');
        const { projectUpgradePlan } = await import('../../application/upgrade-planning.ts');
        const { formatUpgradePlanning } = await import('../../entry/cli/upgrade-planning.ts');
        const { plan, executionTerminal } = readUpgradeArtifactSet(workspaceRoot);
        if (plan === null) {
          throw new CompilerError('UPGRADE-BLOCKED-003', missingMessage);
        }
        return {
          value: plan,
          text: formatUpgradePlanning(projectUpgradePlan(plan, executionTerminal))
        };
      },
      readDiagnostics: async (workspaceRoot, missingMessage) => {
        const { readUpgradeArtifactSet } = await import('../../adapters/upgrade/artifact-readback.ts');
        const { projectUpgradeDiagnostics } = await import('../../application/upgrade-diagnostics.ts');
        const { formatUpgradeDiagnostics } = await import('../../entry/cli/upgrade-diagnostics.ts');
        const { diagnostics } = readUpgradeArtifactSet(workspaceRoot);
        if (diagnostics === null) {
          throw new CompilerError('UPGRADE-BLOCKED-003', missingMessage);
        }
        return {
          value: diagnostics,
          text: formatUpgradeDiagnostics(projectUpgradeDiagnostics(diagnostics))
        };
      },
      execute: async (workspaceRoot, blockId, targetVersion, dryRun) => {
        const { projectUpgradePlan, projectUpgradePreview } =
          await import('../../application/upgrade-planning.ts');
        const { formatUpgradePlanning } =
          await import('../../entry/cli/upgrade-planning.ts');
        const result = await upgradeWorkspace(
          workspaceRoot,
          blockId,
          targetVersion,
          { dryRun }
        );
        if (result.resultKind === 'preview') {
          return {
            value: result.upgradePlan,
            text: formatUpgradePlanning(projectUpgradePreview(result.upgradePlan))
          };
        }
        return {
          value: result.upgradePlan,
          text: formatUpgradePlanning(
            projectUpgradePlan(
              result.upgradePlan,
              result.upgradeExecutionTerminal
            )
          )
        };
      },
      progress: runWithOptionalSpinner
    }),

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
      const { buildE2eMatrix } = await import('../../assurance/verification/review/matrix.ts');
      const { projectExplainSummary } = await import('../../application/explain-summary.ts');
      const { formatExplainSummary } = await import('../../entry/cli/explain-summary.ts');
      const { graph, reviewSummary } = await runWithOptionalSpinner('Explaining project', output, () => explainWorkspace(cwd));
      printJsonOrText(
        { graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) },
        output,
        (summary) => formatExplainSummary(projectExplainSummary(summary.graph, summary.reviewSummary, summary.e2eMatrix))
      );
    },

    artifacts: async ({ workspaceRoot, invocationPath, input }) => {
      const { executeArtifactCommand } = await import('./artifact-command-execution.ts');
      await executeArtifactCommand(workspaceRoot, invocationPath, input);
    }
  });
}
