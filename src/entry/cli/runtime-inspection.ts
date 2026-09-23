import type {
  RuntimeInspectionStepId,
  RuntimeInspectionStepView,
  RuntimeInspectionView
} from '../../application/runtime-inspection.ts';
import { formatFields } from './format-utils.ts';

function formatRuntimeStep(step: RuntimeInspectionStepView, label: string = step.id): string {
  return formatFields([
    `${label}: ${step.status}`,
    `passed=${step.passedCount}`,
    `failed=${step.failedCount}`,
    `command=${step.command ?? 'none'}`
  ]);
}

export function formatRuntimeStepsInspect(view: RuntimeInspectionView): string {
  return [
    formatFields([
      `Runtime steps ${view.status}`,
      `steps=${view.stepCount}`,
      `passed=${view.passedCount}`,
      `failed=${view.failedCount}`,
      `skipped=${view.skippedCount}`
    ]),
    ...view.steps.map((step) => formatRuntimeStep(step))
  ].join('\n');
}

export function formatRuntimeReport(view: RuntimeInspectionView): string {
  const labels: Record<RuntimeInspectionStepId, string> = {
    build: 'Build',
    unit: 'Unit',
    acceptance: 'Acceptance'
  };
  return [
    `Runtime report ${view.status}`,
    ...view.steps.map((step) => formatRuntimeStep(step, labels[step.id]))
  ].join('\n');
}
