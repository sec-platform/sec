import { PIPELINE_STAGE_IDS, type PipelineStageId } from './stages.ts';

/** Stage boundary identity derives from the same declared stages that execute. */
export function pipelineStageBoundary<Stage extends PipelineStageId>(stage: Stage): `pipeline-${Stage}` {
  if (!PIPELINE_STAGE_IDS.includes(stage)) throw new Error('Unknown pipeline stage boundary');
  return `pipeline-${stage}`;
}

export const PIPELINE_EXECUTION_BOUNDARIES = Object.freeze([
  'pipeline-bootstrap',
  'pipeline-lease-bind',
  'pipeline-lease-bound',
  'pipeline-transaction-bootstrap',
  'pipeline-transaction',
  ...PIPELINE_STAGE_IDS.map(pipelineStageBoundary),
  'verify-preflight',
  'verify-fast',
  'verify-runtime',
  'verify-artifact-publish'
] as const);
export type PipelineExecutionBoundary = (typeof PIPELINE_EXECUTION_BOUNDARIES)[number];
