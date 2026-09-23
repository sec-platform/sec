import { CompilerError } from '../errors.ts';

const PIPELINE_SOURCE_IDS = Object.freeze(['api', 'cli', 'reference', 'upgrade', 'repair', 'ci'] as const);
export type PipelineSource = (typeof PIPELINE_SOURCE_IDS)[number];

export function requirePipelineSource(value: unknown): PipelineSource {
  if (typeof value !== 'string' || !PIPELINE_SOURCE_IDS.includes(value as PipelineSource)) {
    throw new CompilerError('PIPELINE-USAGE-004', 'Unknown pipeline invocation source');
  }
  return value as PipelineSource;
}
