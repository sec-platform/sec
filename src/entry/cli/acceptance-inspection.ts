import type {
  AcceptanceCoverageInspectView,
  AcceptanceInspectionTargetView,
  AcceptanceTargetInspect
} from '../../application/acceptance-inspection.ts';
import { formatFields, formatList } from './format-utils.ts';

function formatAcceptanceTarget(
  label: 'Target' | 'Block',
  target: AcceptanceInspectionTargetView
): string {
  return formatFields([
    `${label} ${target.id}`,
    `declared=${target.declaredAcceptanceCount}`,
    `coveredBy=${formatList(target.coveredBy)}`,
    `uncovered=${target.uncovered}`
  ]);
}

export function formatAcceptanceTargets(report: AcceptanceTargetInspect): string {
  return [
    `Acceptance coverage blocks ${report.status}`,
    formatFields([
      `targets=${report.targetCount}`,
      `covered=${report.coveredCount}`,
      `uncovered=${report.uncoveredCount}`
    ]),
    `Uncovered: ${formatList(report.uncoveredIds)}`,
    ...report.targets.slice(0, 5).map((target) => formatAcceptanceTarget('Target', target))
  ].join('\n');
}

export function formatAcceptanceCoverage(view: AcceptanceCoverageInspectView): string {
  const blockTargets = view.blockTargets;
  return [
    formatFields([
      `Acceptance coverage ${view.status}`,
      `acceptancePassed=${view.acceptancePassedCount}`,
      `blocks=${blockTargets.coveredCount}/${blockTargets.targetCount}`,
      `uncoveredBlocks=${blockTargets.uncoveredCount}`
    ]),
    `Uncovered blocks: ${formatList(blockTargets.uncoveredIds)}`,
    ...blockTargets.targets.slice(0, 3).map((target) => formatAcceptanceTarget('Block', target))
  ].join('\n');
}
