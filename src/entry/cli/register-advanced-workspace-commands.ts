import type { Command } from 'commander';
import { ARTIFACT_KIND_OPTION, ARTIFACT_PATHS_OPTION, parseArtifactCommandInput } from './artifact-command-input.ts';
import { addJsonFlags, commandPath, optionalModeCommand } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';
import { reportRepairFailureReadback } from './repair-failure-readback.ts';
import { runRepairWithFailureReadback } from '../../application/repair-execution.ts';
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

export type RepairCommandProjection = Readonly<{
  value: unknown;
  text: string;
}>;

export interface RepairCommandOperations {
  readPlan(
    workspaceRoot: string,
    missingMessage: string
  ): Promise<RepairCommandProjection>;
  readPlanIfPresent(workspaceRoot: string): Promise<RepairCommandProjection | null>;
  execute(
    workspaceRoot: string,
    dryRun: boolean
  ): Promise<RepairCommandProjection>;
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

  return async ({ workspaceRoot, invocationPath, input }) => {
    if (input.kind === 'plan') {
      const projection = await operations.readPlan.call(
        operations,
        workspaceRoot,
        `Repair plan not found; run ${invocationPath} --dry-run first`
      );
      printJsonOrText(projection.value, input.output, () => projection.text);
      return;
    }

    const projection = await runRepairWithFailureReadback(
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
          printJsonOrText(retained.value, input.output, () => retained.text);
        }
      },
      secondary => reportRepairFailureReadback(
        operations.formatFailure.call(operations, secondary)
      )
    );
    printJsonOrText(projection.value, input.output, () => projection.text);
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
