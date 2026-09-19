import type { Command } from 'commander';
import { CompilerError, formatCompilerFailure } from '../../compiler/errors.ts';
import {
  bindRepairCommandHandler,
  bindUpgradeCommandHandler,
  bindWorkspaceViewCommandHandler,
  registerAdvancedWorkspaceCommands
} from '../../entry/cli/register-advanced-workspace-commands.ts';
import { registerCoreWorkspaceCommands } from '../../entry/cli/register-core-workspace-commands.ts';
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
        return readRequiredRepairPlan(
          resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan),
          missingMessage
        );
      },
      readPlanIfPresent: async workspaceRoot => {
        const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { pathExists } = await import('../../adapters/filesystem/files.ts');
        const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
        const { readRequiredRepairPlan } = await import('../../adapters/workspace/required-artifact-read.ts');
        const path = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
        if (!(await pathExists(path))) return null;
        return readRequiredRepairPlan(
          path,
          'Repair plan disappeared before it could be read back.'
        );
      },
      execute: async (workspaceRoot, dryRun) => {
        const { repairPlan } = await repairWorkspace(workspaceRoot, { dryRun });
        return repairPlan;
      },
      progress: runWithOptionalSpinner,
      formatFailure: formatCompilerFailure
    }),

    upgrade: bindUpgradeCommandHandler({
      readPlan: async (workspaceRoot, missingMessage) => {
        const { readUpgradeArtifactSet } = await import('../../adapters/upgrade/artifact-readback.ts');
        const { plan, executionTerminal } = readUpgradeArtifactSet(workspaceRoot);
        if (plan === null) {
          throw new CompilerError('UPGRADE-BLOCKED-003', missingMessage);
        }
        return { plan, executionTerminal };
      },
      readDiagnostics: async (workspaceRoot, missingMessage) => {
        const { readUpgradeArtifactSet } = await import('../../adapters/upgrade/artifact-readback.ts');
        const { diagnostics } = readUpgradeArtifactSet(workspaceRoot);
        if (diagnostics === null) {
          throw new CompilerError('UPGRADE-BLOCKED-003', missingMessage);
        }
        return diagnostics;
      },
      execute: async (workspaceRoot, blockId, targetVersion, dryRun) => {
        const result = await upgradeWorkspace(
          workspaceRoot,
          blockId,
          targetVersion,
          { dryRun }
        );
        return result.resultKind === 'preview'
          ? {
              resultKind: 'preview' as const,
              upgradePlan: result.upgradePlan
            }
          : {
              resultKind: 'applied' as const,
              upgradePlan: result.upgradePlan,
              upgradeExecutionTerminal: result.upgradeExecutionTerminal
            };
      },
      progress: runWithOptionalSpinner
    }),

    view: bindWorkspaceViewCommandHandler({
      readLock: async (workspaceRoot, missingMessage) => {
        const { resolveWorkspaceLockPath } =
          await import('../../adapters/workspace-context.ts');
        const { readRequiredJson } =
          await import('../../adapters/workspace/required-artifact-read.ts');
        return readRequiredJson<
          import('../../application/lock-inspect.ts').LockInspectProjectionSource
        >(await resolveWorkspaceLockPath(workspaceRoot), missingMessage);
      },
      lock: workspaceRoot => lockWorkspace(workspaceRoot),
      readExplain: async (workspaceRoot, missingMessage) => {
        const { CI_ARTIFACT_FILES } =
          await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { resolveWorkspaceArtifactPath } =
          await import('../../adapters/workspace-context.ts');
        const { readRequiredJson } =
          await import('../../adapters/workspace/required-artifact-read.ts');
        return readRequiredJson<
          import('../../application/explain-graph-inspect.ts').ExplainGraphInspectProjectionSource
        >(
          resolveWorkspaceArtifactPath(
            workspaceRoot,
            CI_ARTIFACT_FILES.explainGraph
          ),
          missingMessage
        );
      },
      explain: async workspaceRoot => {
        const { buildE2eMatrix } =
          await import('../../assurance/verification/review/matrix.ts');
        const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
        return {
          graph,
          reviewSummary,
          e2eMatrix: buildE2eMatrix(reviewSummary)
        };
      },
      progress: runWithOptionalSpinner
    }),

    artifacts: async ({ workspaceRoot, invocationPath, input }) => {
      const { executeArtifactCommand } = await import('./artifact-command-execution.ts');
      await executeArtifactCommand(workspaceRoot, invocationPath, input);
    }
  });
}
