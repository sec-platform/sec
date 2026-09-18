export const RUNTIME_INSPECTION_STEP_IDS = Object.freeze(['build', 'unit', 'acceptance'] as const);
export type RuntimeInspectionStepId = (typeof RUNTIME_INSPECTION_STEP_IDS)[number];

export type RuntimeInspectionProjectionSource = Readonly<{
  status: string;
  build: RuntimeInspectionStepSource;
  unit: RuntimeInspectionStepSource;
  acceptance: RuntimeInspectionStepSource;
}>;

type RuntimeInspectionStepSource = Readonly<{
  status: string;
  passed: readonly string[];
  failed: readonly string[];
  command: string | null;
}>;

export type RuntimeInspectionStepView = Readonly<{
  id: RuntimeInspectionStepId;
  status: string;
  passedCount: number;
  failedCount: number;
  command: string | null;
  passed: readonly string[];
  failed: readonly string[];
}>;

export type RuntimeInspectionView = Readonly<{
  status: string;
  stepCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  steps: readonly RuntimeInspectionStepView[];
}>;

function projectStep(
  id: RuntimeInspectionStepId,
  step: RuntimeInspectionStepSource
): RuntimeInspectionStepView {
  const passed = [...step.passed];
  const failed = [...step.failed];
  return {
    id,
    status: step.status,
    passedCount: passed.length,
    failedCount: failed.length,
    command: step.command,
    passed,
    failed
  };
}

export function projectRuntimeInspection(source: RuntimeInspectionProjectionSource): RuntimeInspectionView {
  const steps = RUNTIME_INSPECTION_STEP_IDS.map((id) => projectStep(id, source[id]));
  return {
    status: source.status,
    stepCount: steps.length,
    passedCount: steps.filter((step) => step.status === 'passed').length,
    failedCount: steps.filter((step) => step.status === 'failed').length,
    skippedCount: steps.filter((step) => step.status === 'skipped').length,
    steps
  };
}
