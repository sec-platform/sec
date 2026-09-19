import type { Command } from 'commander';
import { ARTIFACT_KIND_OPTION, ARTIFACT_PATHS_OPTION, parseArtifactCommandInput } from './artifact-command-input.ts';
import { addJsonFlags, commandPath, optionalModeCommand } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';
import { reportRepairFailureReadback } from './repair-failure-readback.ts';
import { runRepairWithFailureReadback } from '../../application/repair-execution.ts';
import {
  projectRepairSummary,
  type RepairSummarySource
} from '../../application/repair-summary.ts';
import {
  projectUpgradePlanSource,
  projectUpgradePreviewSource,
  type UpgradeExecutionTerminalSource,
  type UpgradePlanSource,
  type UpgradePreviewSource
} from '../../application/upgrade-planning.ts';
import {
  projectUpgradeDiagnosticsSource,
  type UpgradeDiagnosticsSource
} from '../../application/upgrade-diagnostics.ts';
import { formatUpgradePlanning } from './upgrade-planning.ts';
import { formatUpgradeDiagnosticsSource } from './upgrade-diagnostics.ts';
import {
  projectLockInspect,
  type LockInspectProjectionSource
} from '../../application/lock-inspect.ts';
import {
  projectExplainGraphInspect,
  type ExplainGraphInspectProjectionSource
} from '../../application/explain-graph-inspect.ts';
import {
  projectExplainSummary,
  type ExplainSummarySource
} from '../../application/explain-summary.ts';
import { formatLockInspect } from './lock-inspect.ts';
import { formatExplainGraphInspect } from './explain-graph-inspect.ts';
import { formatExplainSummary } from './explain-summary.ts';
import { formatRepairSummary } from './repair-summary.ts';
import {
  WORKSPACE_DRY_RUN_OPTION,
  WORKSPACE_INSPECTION_MODES,
  parseRepairCommandInput,
  parseUpgradeCommandInput,
  parseWorkspaceViewCommandInput
} from './workspace-command-input.ts';

type RepairInput = ReturnType<typeof parseRepairCommandInput>;
type UpgradeInput = ReturnType<typeof parseUpgradeCommandInput>;
type WorkspaceViewInput = ReturnType<typeof parseWorkspaceViewCommandInput>;
type ArtifactInput = ReturnType<typeof parseArtifactCommandInput>;

interface CommandContext<Input> {
  readonly workspaceRoot: string;
  readonly invocationPath: string;
  readonly input: Input;
}

export interface RepairCommandOperations {
  readPlan(
    workspaceRoot: string,
    missingMessage: string
  ): Promise<RepairSummarySource>;
  readPlanIfPresent(
    workspaceRoot: string
  ): Promise<RepairSummarySource | null>;
  execute(
    workspaceRoot: string,
    dryRun: boolean
  ): Promise<RepairSummarySource>;
  progress<T>(
    text: string,
    output: RepairInput['output'],
    operation: () => Promise<T>
  ): Promise<T>;
  formatFailure(error: unknown): string;
}

export function bindRepairCommandHandler(
  operations: RepairCommandOperations
): AdvancedWorkspaceCommandHandlers['repair'] {
  const required = [
    operations.readPlan,
    operations.readPlanIfPresent,
    operations.execute,
    operations.progress,
    operations.formatFailure
  ];
  if (required.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Repair command operations must be callable');
  }

  const present = (
    plan: RepairSummarySource,
    dryRun: boolean,
    output: RepairInput['output']
  ): void => {
    printJsonOrText(
      plan,
      output,
      value => formatRepairSummary(projectRepairSummary(value, dryRun))
    );
  };

  return async ({ workspaceRoot, invocationPath, input }) => {
    if (input.kind === 'plan') {
      const plan = await operations.readPlan.call(
        operations,
        workspaceRoot,
        `Repair plan not found; run ${invocationPath} --dry-run first`
      );
      present(plan, true, input.output);
      return;
    }

    const plan = await runRepairWithFailureReadback(
      () => operations.progress.call(
        operations,
        input.request.dryRun ? 'Previewing repair' : 'Running repair',
        input.output,
        () => operations.execute.call(
          operations,
          workspaceRoot,
          input.request.dryRun
        )
      ),
      async () => {
        const retained = await operations.readPlanIfPresent.call(
          operations,
          workspaceRoot
        );
        if (retained !== null) {
          present(retained, input.request.dryRun, input.output);
        }
      },
      secondary => reportRepairFailureReadback(
        operations.formatFailure.call(operations, secondary)
      )
    );
    present(plan, input.request.dryRun, input.output);
  };
}

export interface UpgradeCommandOperations {
  readPlan(
    workspaceRoot: string,
    missingMessage: string
  ): Promise<Readonly<{
    plan: UpgradePlanSource;
    executionTerminal: UpgradeExecutionTerminalSource | null;
  }>>;
  readDiagnostics(
    workspaceRoot: string,
    missingMessage: string
  ): Promise<UpgradeDiagnosticsSource>;
  execute(
    workspaceRoot: string,
    blockId: string,
    targetVersion: string,
    dryRun: boolean
  ): Promise<
    | Readonly<{ resultKind: 'preview'; upgradePlan: UpgradePreviewSource }>
    | Readonly<{
        resultKind: 'applied';
        upgradePlan: UpgradePlanSource;
        upgradeExecutionTerminal: UpgradeExecutionTerminalSource;
      }>
  >;
  progress<T>(
    text: string,
    output: UpgradeInput['output'],
    operation: () => Promise<T>
  ): Promise<T>;
}

export function bindUpgradeCommandHandler(
  operations: UpgradeCommandOperations
): AdvancedWorkspaceCommandHandlers['upgrade'] {
  const required = [
    operations.readPlan,
    operations.readDiagnostics,
    operations.execute,
    operations.progress
  ];
  if (required.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Upgrade command operations must be callable');
  }

  return async ({ workspaceRoot, invocationPath, input }) => {
    if (input.kind === 'plan') {
      const { plan, executionTerminal } = await operations.readPlan.call(
        operations,
        workspaceRoot,
        `Upgrade plan not found; run ${invocationPath} <block-id> <target-version>`
      );
      printJsonOrText(
        plan,
        input.output,
        value => formatUpgradePlanning(projectUpgradePlanSource(value, executionTerminal))
      );
      return;
    }
    if (input.kind === 'diagnostics') {
      const diagnostics = await operations.readDiagnostics.call(
        operations,
        workspaceRoot,
        `Upgrade diagnostics not found; run ${invocationPath} <block-id> <target-version>`
      );
      printJsonOrText(
        diagnostics,
        input.output,
        value => formatUpgradeDiagnosticsSource(projectUpgradeDiagnosticsSource(value))
      );
      return;
    }
    const result = await operations.progress.call(
      operations,
      input.request.dryRun ? 'Previewing upgrade' : 'Running upgrade',
      input.output,
      () => operations.execute.call(
        operations,
        workspaceRoot,
        input.subject,
        input.targetVersion,
        input.request.dryRun
      )
    );
    if (result.resultKind === 'preview') {
      printJsonOrText(
        result.upgradePlan,
        input.output,
        value => formatUpgradePlanning(projectUpgradePreviewSource(value))
      );
      return;
    }
    printJsonOrText(
      result.upgradePlan,
      input.output,
      value => formatUpgradePlanning(
        projectUpgradePlanSource(value, result.upgradeExecutionTerminal)
      )
    );
  };
}

export interface WorkspaceViewCommandOperations {
  readLock(
    workspaceRoot: string,
    missingMessage: string
  ): Promise<LockInspectProjectionSource>;
  lock(workspaceRoot: string): Promise<void>;
  readExplain(
    workspaceRoot: string,
    missingMessage: string
  ): Promise<ExplainGraphInspectProjectionSource>;
  explain(workspaceRoot: string): Promise<ExplainSummarySource>;
  progress<T>(
    text: string,
    output: WorkspaceViewInput['output'],
    operation: () => Promise<T>
  ): Promise<T>;
}

export function bindWorkspaceViewCommandHandler(
  operations: WorkspaceViewCommandOperations
): AdvancedWorkspaceCommandHandlers['view'] {
  const required = [
    operations.readLock,
    operations.lock,
    operations.readExplain,
    operations.explain,
    operations.progress
  ];
  if (required.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace view command operations must be callable');
  }

  return async ({ command, workspaceRoot, invocationPath, input }) => {
    if (command === 'lock') {
      if (input.kind === 'inspect') {
        const value = await operations.readLock.call(
          operations,
          workspaceRoot,
          `Graph lock not found; run ${invocationPath} first`
        );
        printJsonOrText(
          value,
          input.output,
          source => formatLockInspect(projectLockInspect(source))
        );
        return;
      }
      await operations.progress.call(
        operations,
        'Locking project',
        input.output,
        () => operations.lock.call(operations, workspaceRoot)
      );
      printJsonOrText(
        { status: 'locked' as const },
        input.output,
        () => 'Locked project'
      );
      return;
    }

    if (input.kind === 'inspect') {
      const value = await operations.readExplain.call(
        operations,
        workspaceRoot,
        `Explain graph not found; run ${invocationPath} first`
      );
      printJsonOrText(
        value,
        input.output,
        source => formatExplainGraphInspect(projectExplainGraphInspect(source))
      );
      return;
    }
    const result = await operations.progress.call(
      operations,
      'Explaining project',
      input.output,
      () => operations.explain.call(operations, workspaceRoot)
    );
    printJsonOrText(
      result,
      input.output,
      value => formatExplainSummary(
        projectExplainSummary(
          value.graph,
          value.reviewSummary,
          value.e2eMatrix
        )
      )
    );
  };
}

export interface AdvancedWorkspaceCommandHandlers {
  readonly repair: (context: CommandContext<RepairInput>) => Promise<void>;
  readonly upgrade: (context: CommandContext<UpgradeInput>) => Promise<void>;
  readonly view: (context: CommandContext<WorkspaceViewInput> & Readonly<{ command: 'lock' | 'explain' }>) => Promise<void>;
  readonly artifacts: (context: CommandContext<ArtifactInput>) => Promise<void>;
}

/** Entry owns advanced command grammar/admission; injected handlers retain distinct effect/recovery lifecycles. */
export function registerAdvancedWorkspaceCommands(program: Command, handlers: AdvancedWorkspaceCommandHandlers): void {
  const { repair, upgrade, view, artifacts } = handlers;
  if ([repair, upgrade, view, artifacts].some((handler) => typeof handler !== 'function')) {
    throw new TypeError('Advanced workspace command handlers must be callable');
  }

  addJsonFlags(optionalModeCommand(program.command('repair'), 'mode', ['plan']))
    .description('Run repair')
    .option(WORKSPACE_DRY_RUN_OPTION.flags, 'Dry run repair')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      await repair({
        workspaceRoot: process.cwd(),
        invocationPath: commandPath(cmd),
        input: parseRepairCommandInput(mode, rawOptions)
      });
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
      const invocationPath = commandPath(cmd);
      await upgrade({
        workspaceRoot: process.cwd(),
        invocationPath,
        input: parseUpgradeCommandInput(subject, targetVersion, rawOptions, invocationPath)
      });
    });

  for (const command of ['lock', 'explain'] as const) {
    addJsonFlags(optionalModeCommand(program.command(command), 'mode', [WORKSPACE_INSPECTION_MODES[command]]))
      .description(command === 'lock' ? 'Lock project' : 'Explain project')
      .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
        await view({
          command,
          workspaceRoot: process.cwd(),
          invocationPath: commandPath(cmd),
          input: parseWorkspaceViewCommandInput(command, mode, rawOptions)
        });
      });
  }

  addJsonFlags(optionalModeCommand(program.command('artifacts'), 'mode', ['manifest']))
    .description('Manage CI artifacts')
    .option(ARTIFACT_PATHS_OPTION.flags, ARTIFACT_PATHS_OPTION.description)
    .option(ARTIFACT_KIND_OPTION.flags, ARTIFACT_KIND_OPTION.description)
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      await artifacts({
        workspaceRoot: process.cwd(),
        invocationPath: commandPath(cmd),
        input: parseArtifactCommandInput(mode, rawOptions)
      });
    });
}
