import type { RepairSummaryView } from '../../application/repair-summary.ts';
import { formatFields, formatList } from './format-utils.ts';

function formatRepairFailure(failure: RepairSummaryView['tasks'][number]['failurePoints'][number]): string {
  return formatFields([
    `Failure ${failure.lane}/${failure.kind}`,
    `issue=${failure.issueType}`,
    `repairable=${failure.repairable}`,
    failure.message
  ]);
}

export function formatRepairSummary(view: RepairSummaryView): string {
  const suffix = view.presentation === 'verify-pending'
    ? '; verify pending'
    : view.presentation === 'dry-run'
      ? ' (dry-run)'
      : '';
  const lines = [
    `Repair ${view.status} (${view.taskCount} tasks, ${view.blockerCount} blockers)${suffix}`,
    `Source verification: ${view.sourceVerificationStatus}; requires verification: ${view.requiresVerification}`
  ];

  for (const task of view.tasks) {
    lines.push(`Task ${task.taskId}: ${task.targetBlock} -> ${task.targetFile}`);
    lines.push(
      formatFields([
        `Review ${task.taskId}: writeBounds=${formatList([...task.review.writeBounds])}`,
        `symbols=${formatList([...task.review.requiredSymbols])}`,
        `tests=${formatList([...task.review.testsToPass])}`,
        `forbidden=${formatList([...task.review.forbiddenOperations])}`,
        `failureTargets=${formatList([...task.review.failureTargets])}`
      ])
    );
    if (task.preview) {
      lines.push(
        formatFields([
          `Preview ${task.taskId}: changed=${task.preview.changed}`,
          `+${task.preview.addedLines}`,
          `-${task.preview.removedLines}`,
          `${task.preview.beforeLines}->${task.preview.afterLines} lines`
        ])
      );
    }
    for (const failure of task.failurePoints) lines.push(formatRepairFailure(failure));
  }

  for (const blocker of view.blockers) {
    lines.push(`Blocker ${blocker.blockerId}: ${blocker.boundary}; ${blocker.reason}`);
    for (const failure of blocker.failurePoints) lines.push(formatRepairFailure(failure));
  }

  return lines.join('\n');
}
