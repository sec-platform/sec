import { CompilerError } from '../../compiler/errors.ts';
import { PIPELINE_STAGE_IDS, type PipelineStageId } from '../../compiler/pipeline/stages.ts';

function booleanFlag(value: unknown, option: string): boolean {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  throw new CompilerError('PIPELINE-USAGE-003', `${option} must be a boolean flag`);
}

function outputOptions(json: unknown, compact: unknown): Readonly<{ json: boolean; compact: boolean }> {
  const output = { json: booleanFlag(json, '--json'), compact: booleanFlag(compact, '--compact') };
  if (output.compact && !output.json) {
    throw new CompilerError('PIPELINE-USAGE-003', '--compact requires --json');
  }
  return Object.freeze(output);
}

function pipelineStage(value: unknown, option: string): PipelineStageId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !PIPELINE_STAGE_IDS.includes(value as PipelineStageId)) {
    throw new CompilerError('PIPELINE-USAGE-001', `${option} must be one of: ${PIPELINE_STAGE_IDS.join(', ')}`);
  }
  return value as PipelineStageId;
}

function verificationLane(value: unknown) {
  if (value !== 'fast' && value !== 'runtime' && value !== 'all') {
    throw new CompilerError('PIPELINE-USAGE-002', '--lane must be fast, runtime, or all');
  }
  return value;
}

/** Decode only command-owned fields before loading an execution domain. */
export function parsePipelineOutputOptions(options: Readonly<Record<string, unknown>>) {
  const { json, compact } = options;
  return outputOptions(json, compact);
}

/** Capture the invocation once; no coercion hooks or mutable CLI object crosses an await. */
export function parsePipelineCompileOptions(options: Readonly<Record<string, unknown>>) {
  const { json, compact, from, through, lane } = options;
  const output = outputOptions(json, compact);
  const first = pipelineStage(from, '--from');
  const last = pipelineStage(through, '--through');
  return Object.freeze({
    output,
    invocation: Object.freeze({
      source: 'cli' as const,
      ...(first === undefined ? {} : { from: first }),
      ...(last === undefined ? {} : { through: last }),
      verificationLane: verificationLane(lane)
    })
  });
}
