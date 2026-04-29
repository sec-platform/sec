import type { ViewMutationReport } from '../../compiler/workbench/apply-view-mutations.ts';
import { applyWorkbenchMutations } from '../../orchestrator.ts';
import { parseWorkbenchArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { printJsonOrText } from '../format-utils.ts';
import { WORKBENCH_USAGE } from '../usage.ts';

function formatWorkbenchMutationReport(report: ViewMutationReport): string {
  const lines = [
    `Workbench mutations ${report.status}; files=${report.mutationFileCount}; applied=${report.appliedCount}; skipped=${report.skippedCount}`,
    `Source root: ${report.sourceRoot}; target: ${report.targetPath}`
  ];
  for (const mutation of report.mutations) {
    lines.push(`Mutation ${mutation.id}: ${mutation.kind}; ${mutation.status}; ${mutation.detail}`);
  }
  return lines.join('\n');
}

export const workbenchCommand: CommandHandler = {
  name: 'workbench',
  usage: WORKBENCH_USAGE,
  async execute(args, ctx) {
    const workbenchArgs = parseWorkbenchArgs(args);
    const report = await applyWorkbenchMutations(ctx.cwd);
    printJsonOrText(report, workbenchArgs, formatWorkbenchMutationReport);
  }
};
